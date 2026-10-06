import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { db } from "../db";
import { AppError, notFound } from "../errors";
import { newProjectId } from "../ids";
import { ensureProjectDirs, projectDir, resolveInside } from "../storage/paths";
import { exportProjectBundle, importProjectBundle, type ProjectBundle } from "./bundle";
import { materializeSafely, type Actor } from "./mutation";

/**
 * Project packages (.zip): a manifest with the full project bundle plus the project folder.
 * Streaming in both directions so multi-GB projects never load into memory.
 */

const MANIFEST = "motion-studio-package.json";
const COMPRESSIBLE = new Set([".json", ".md", ".txt", ".srt", ".vtt", ".svg"]);
const SKIP_DIRS = new Set([".project", "exports"]);

async function* walk(dir: string, rel = ""): AsyncGenerator<string> {
  const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!rel && SKIP_DIRS.has(e.name)) continue;
      yield* walk(dir, r);
    } else if (e.isFile()) {
      yield r;
    }
  }
}

export async function exportProjectPackage(
  projectId: string,
  options: { includeRenders: boolean; onProgress?: (fraction: number) => void; signal?: AbortSignal },
): Promise<{ relPath: string; sizeBytes: number }> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) throw notFound("Project");
  const bundle = await exportProjectBundle(projectId, { includeRenders: options.includeRenders });
  const root = projectDir(projectId);
  const files: string[] = [];
  for await (const rel of walk(root)) {
    if (!options.includeRenders && rel.startsWith("renders/")) continue;
    files.push(rel);
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const relPath = `exports/${projectId}-package-${stamp}.zip`;
  const outAbs = path.join(root, relPath);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  const out = createWriteStream(outAbs);
  let needDrain = false;
  let zipError: Error | null = null;
  const finished = new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      zipError = err;
      return;
    }
    if (!out.write(chunk)) needDrain = true;
    if (final) out.end();
  });
  const drain = async () => {
    if (needDrain) {
      await new Promise<void>((r) => out.once("drain", () => r()));
      needDrain = false;
    }
  };

  const manifest = new ZipDeflate(MANIFEST, { level: 6 });
  zip.add(manifest);
  manifest.push(new TextEncoder().encode(JSON.stringify({ format: "motion-studio.package", version: 1, projectName: project.name, exportedAt: new Date().toISOString(), bundle })), true);
  await drain();

  const total = files.length || 1;
  for (let i = 0; i < files.length; i++) {
    if (options.signal?.aborted) throw new AppError("BAD_REQUEST", "Export cancelled.");
    const rel = files[i];
    const entry = COMPRESSIBLE.has(path.extname(rel).toLowerCase()) ? new ZipDeflate(`files/${rel}`, { level: 6 }) : new ZipPassThrough(`files/${rel}`);
    zip.add(entry);
    const stream = createReadStream(path.join(root, rel), { highWaterMark: 1024 * 1024 });
    let pending: Buffer | null = null;
    for await (const chunk of stream) {
      if (pending) {
        entry.push(pending);
        await drain();
      }
      pending = chunk as Buffer;
    }
    entry.push(pending ?? new Uint8Array(0), true);
    await drain();
    options.onProgress?.((i + 1) / total);
  }
  zip.end();
  await finished;
  if (zipError) throw zipError;
  const stat = await fs.stat(outAbs);
  return { relPath, sizeBytes: stat.size };
}

export async function importProjectPackage(zipPath: string, actor: Actor): Promise<string> {
  const tmpId = `import-${Date.now()}`;
  let bundle: ProjectBundle | null = null;
  let projectName = "Imported project";
  const manifestChunks: Uint8Array[] = [];
  const stagedFiles: { rel: string; chunks: Uint8Array[] }[] = [];
  let targetId: string | null = null;
  let targetRoot: string | null = null;
  const writes: Promise<void>[] = [];

  // First pass: stream entries. The manifest is written first, so we know the project id before files arrive.
  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.onfile = (file) => {
      if (file.name === MANIFEST) {
        file.ondata = (err, data, final) => {
          if (err) return reject(err);
          manifestChunks.push(data);
          if (final) {
            try {
              const text = Buffer.concat(manifestChunks.map((c) => Buffer.from(c))).toString("utf8");
              const parsed = JSON.parse(text) as { format?: string; projectName?: string; bundle?: ProjectBundle };
              if (parsed.format !== "motion-studio.package" || !parsed.bundle) throw new AppError("BAD_REQUEST", "This zip is not a Motion Studio project package.");
              bundle = parsed.bundle;
              projectName = parsed.projectName ?? bundle.project.name;
            } catch (e) {
              reject(e);
            }
          }
        };
        file.start();
        return;
      }
      if (!file.name.startsWith("files/") || file.name.endsWith("/")) return;
      const rel = file.name.slice("files/".length);
      const record = { rel, chunks: [] as Uint8Array[] };
      if (targetRoot) {
        const abs = resolveInside(targetRoot, rel);
        const p = fs.mkdir(path.dirname(abs), { recursive: true }).then(
          () =>
            new Promise<void>((res, rej) => {
              const ws = createWriteStream(abs);
              ws.on("error", rej);
              ws.on("finish", () => res());
              file.ondata = (err, data, final) => {
                if (err) return rej(err);
                ws.write(data);
                if (final) ws.end();
              };
              file.start();
            }),
        );
        writes.push(p);
      } else {
        stagedFiles.push(record);
        file.ondata = (err, data) => {
          if (err) return reject(err);
          record.chunks.push(data);
        };
        file.start();
      }
    };
    const input = createReadStream(zipPath, { highWaterMark: 1024 * 1024 });
    input.on("data", (chunk) => {
      try {
        unzip.push(chunk as Uint8Array);
        if (bundle && !targetId) {
          const b = bundle as ProjectBundle;
          targetId = newProjectId(projectName || b.project.name);
          targetRoot = projectDir(targetId);
        }
      } catch (e) {
        reject(e);
      }
    });
    input.on("end", () => {
      try {
        unzip.push(new Uint8Array(0), true);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    input.on("error", reject);
  });

  if (!bundle || !targetId || !targetRoot) throw new AppError("BAD_REQUEST", `The package is missing ${MANIFEST}.`);
  await ensureProjectDirs(targetId);
  await Promise.all(writes);
  for (const staged of stagedFiles) {
    const abs = resolveInside(targetRoot, staged.rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.concat(staged.chunks.map((c) => Buffer.from(c))));
  }
  try {
    await importProjectBundle(bundle, { projectId: targetId, name: projectName, actor, activityMessage: `Imported from project package (${tmpId})`, workflow: "imported" });
  } catch (err) {
    await fs.rm(targetRoot, { recursive: true, force: true });
    throw err;
  }
  await materializeSafely(targetId);
  return targetId;
}
