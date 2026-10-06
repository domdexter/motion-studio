import fs from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { fingerprint } from "@/core/util/hash";
import { CACHE_DIR, REPO_ROOT } from "../env";

/**
 * Remotion bundle cache. The composition source (src/remotion + src/core) is bundled once and
 * reused until any source file changes; old bundles are pruned.
 */

const ENTRY = path.join(REPO_ROOT, "src", "remotion", "index.ts");
const SOURCE_DIRS = [path.join(REPO_ROOT, "src", "remotion"), path.join(REPO_ROOT, "src", "core")];
const BUNDLES_DIR = path.join(CACHE_DIR, "remotion-bundles");

async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...(await listSourceFiles(full)));
    } else if (/\.(tsx?|css|json)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function sourceKey(): Promise<string> {
  const files = (await Promise.all(SOURCE_DIRS.map(listSourceFiles))).flat().sort();
  const stats = await Promise.all(
    files.map(async (file) => {
      const s = await fs.stat(file);
      return [path.relative(REPO_ROOT, file), s.size, Math.floor(s.mtimeMs)];
    }),
  );
  const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  return fingerprint({ stats, remotion: pkg.dependencies?.remotion ?? "" }).slice(0, 16);
}

let inflight: { key: string; promise: Promise<string> } | null = null;

export async function getRemotionBundle(onProgress?: (fraction: number) => void): Promise<{ serveUrl: string; cached: boolean }> {
  const key = await sourceKey();
  const outDir = path.join(BUNDLES_DIR, key);
  try {
    await fs.access(path.join(outDir, "index.html"));
    return { serveUrl: outDir, cached: true };
  } catch {
    // not bundled yet
  }
  if (!inflight || inflight.key !== key) {
    const promise = (async () => {
      const tmp = `${outDir}.tmp-${process.pid}-${Date.now()}`;
      await fs.mkdir(BUNDLES_DIR, { recursive: true });
      await bundle({ entryPoint: ENTRY, outDir: tmp, enableCaching: true, onProgress: (p) => onProgress?.(Math.max(0, Math.min(1, p / 100))) });
      await fs.rm(outDir, { recursive: true, force: true });
      await fs.rename(tmp, outDir);
      void pruneBundles(key);
      return outDir;
    })();
    inflight = { key, promise };
    promise.catch(() => {
      if (inflight?.key === key) inflight = null;
    });
  }
  return { serveUrl: await inflight.promise, cached: false };
}

async function pruneBundles(keep: string): Promise<void> {
  try {
    const entries = await fs.readdir(BUNDLES_DIR, { withFileTypes: true });
    const dirs = await Promise.all(
      entries
        .filter((e) => e.isDirectory() && e.name !== keep)
        .map(async (e) => {
          const full = path.join(BUNDLES_DIR, e.name);
          return { full, tmp: e.name.includes(".tmp-"), mtime: (await fs.stat(full)).mtimeMs };
        }),
    );
    const stale = dirs.filter((d) => d.tmp && Date.now() - d.mtime > 60 * 60 * 1000);
    const old = dirs.filter((d) => !d.tmp).sort((a, b) => b.mtime - a.mtime).slice(2);
    for (const d of [...stale, ...old]) await fs.rm(d.full, { recursive: true, force: true });
  } catch {
    // best effort
  }
}
