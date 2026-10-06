import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors";
import { assertProjectId } from "../ids";
import { envProjectsDir } from "../env";
import { getSettings } from "../services/settings";

/**
 * All filesystem access for project data goes through these helpers so paths can never
 * escape a project folder (no traversal, no absolute paths, no symlink escapes).
 */

export function projectsRoot(): string {
  const configured = getSettings().storage.projectsDir;
  return configured ? path.resolve(configured) : envProjectsDir();
}

export function projectDir(projectId: string): string {
  return path.join(projectsRoot(), assertProjectId(projectId));
}

export const PROJECT_SUBDIRS = [
  ".project",
  ".project/tasks",
  "audio/voice",
  "audio/previews",
  "audio/music",
  "audio/sfx",
  "assets/images",
  "assets/videos",
  "assets/logos",
  "assets/fonts",
  "assets/icons",
  "assets/screenshots",
  "assets/audio",
  "assets/brand",
  "assets/references",
  "assets/generated",
  "timing",
  "renders",
  "thumbnails",
  "exports",
  "versions",
] as const;

export async function ensureProjectDirs(projectId: string): Promise<string> {
  const root = projectDir(projectId);
  await Promise.all(PROJECT_SUBDIRS.map((d) => fs.mkdir(path.join(root, d), { recursive: true })));
  return root;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Resolves a relative path inside root. Throws on absolute paths, drive letters, NUL or traversal. */
export function resolveInside(root: string, relPath: string): string {
  if (typeof relPath !== "string" || relPath.length === 0 || relPath.includes("\0")) {
    throw new AppError("BAD_REQUEST", "Invalid file path.");
  }
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith("//")) {
    throw new AppError("FORBIDDEN", "Absolute paths are not allowed.");
  }
  const abs = path.resolve(root, normalized);
  const rel = path.relative(root, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AppError("FORBIDDEN", "Path escapes the project folder.");
  }
  return abs;
}

export function projectFile(projectId: string, relPath: string): string {
  return resolveInside(projectDir(projectId), relPath);
}

/** Like projectFile, but also resolves symlinks and re-checks containment. File must exist. */
export async function existingProjectFile(projectId: string, relPath: string): Promise<string> {
  const root = await fs.realpath(projectDir(projectId)).catch(() => {
    throw new AppError("NOT_FOUND", "Project folder not found.");
  });
  const abs = resolveInside(root, relPath);
  const real = await fs.realpath(abs).catch(() => {
    throw new AppError("NOT_FOUND", "File not found.");
  });
  const rel = path.relative(root, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new AppError("FORBIDDEN", "Path escapes the project folder.");
  return real;
}

/** Strips directories and unsafe characters; keeps a lowercase extension. */
export function safeFileName(original: string, fallback = "file"): string {
  const base = path.basename(original.replace(/\\/g, "/"));
  const ext = path.extname(base).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
  const stem = base
    .slice(0, base.length - path.extname(base).length)
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 60);
  return `${stem || fallback}${ext}`;
}

/** Returns a relative path under dir that does not exist yet: name.ext, name-2.ext, … */
export async function uniqueRelPath(projectId: string, dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let n = 1; n < 10_000; n++) {
    const candidate = `${dir}/${n === 1 ? stem : `${stem}-${n}`}${ext}`;
    try {
      await fs.access(projectFile(projectId, candidate));
    } catch {
      return candidate;
    }
  }
  throw new AppError("CONFLICT", "Could not allocate a file name.");
}

export async function writeFileAtomic(absPath: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, absPath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256File(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(absPath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function directorySize(absPath: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(absPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const p = path.join(absPath, entry.name);
    if (entry.isDirectory()) total += await directorySize(p);
    else if (entry.isFile()) total += (await fs.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}
