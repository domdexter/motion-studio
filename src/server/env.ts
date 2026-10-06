import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Environment & well-known locations. Imported by Next.js route handlers, the worker and
 * the CLI. Next.js loads .env itself; dotenv fills the gaps for tsx processes and never
 * overrides variables that are already set.
 */
dotenv.config({ quiet: true });

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "prisma", "schema.prisma")) && fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export const REPO_ROOT = findRepoRoot(process.cwd());
export const STORAGE_DIR = path.join(REPO_ROOT, "storage");
export const CONFIG_DIR = path.join(STORAGE_DIR, "config");
export const CACHE_DIR = path.join(STORAGE_DIR, "cache");
export const TMP_DIR = path.join(STORAGE_DIR, "tmp");
export const TOOLS_DIR = path.join(STORAGE_DIR, "tools");

export const APP_PORT = 3210;
export const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;

export function envProjectsDir(): string {
  const configured = process.env.STUDIO_PROJECTS_DIR?.trim();
  if (!configured) return path.join(REPO_ROOT, "projects");
  return path.isAbsolute(configured) ? configured : path.resolve(REPO_ROOT, configured);
}
