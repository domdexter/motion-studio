import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db, json } from "../db";
import { REPO_ROOT } from "../env";
import { ffmpegPaths } from "../media/ffmpeg";
import { projectsRoot } from "../storage/paths";
import { getSettings } from "./settings";

export const WORKER_HEARTBEAT_KEY = "worker.heartbeat";

export interface WorkerHeartbeat {
  workerId: string;
  pid: number;
  at: string;
  startedAt: string;
  handlers: string[];
}

export async function writeWorkerHeartbeat(hb: WorkerHeartbeat): Promise<void> {
  await db.appSetting.upsert({ where: { key: WORKER_HEARTBEAT_KEY }, create: { key: WORKER_HEARTBEAT_KEY, value: json(hb) }, update: { value: json(hb) } });
}

export async function getWorkerStatus(): Promise<{ online: boolean; lastSeen: string | null; heartbeat: WorkerHeartbeat | null }> {
  const row = await db.appSetting.findUnique({ where: { key: WORKER_HEARTBEAT_KEY } });
  const hb = (row?.value ?? null) as WorkerHeartbeat | null;
  const online = !!hb && Date.now() - new Date(hb.at).getTime() < 20_000;
  return { online, lastSeen: hb?.at ?? null, heartbeat: hb };
}

let claudeCache: { at: number; value: { found: boolean; path: string | null; version: string | null } } | null = null;

/** Locates the Claude Code CLI (for the optional headless task executor). */
export function detectClaudeCli(): { found: boolean; path: string | null; version: string | null } {
  if (claudeCache && Date.now() - claudeCache.at < 60_000) return claudeCache.value;
  const configured = getSettings().ai.claudeCliPath;
  let found: string | null = configured && fs.existsSync(configured) ? configured : null;
  if (!found) {
    const lookup = process.platform === "win32" ? spawnSync("where.exe", ["claude"], { encoding: "utf8", windowsHide: true }) : spawnSync("which", ["claude"], { encoding: "utf8" });
    const candidates = (lookup.stdout ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    found = candidates.find((c) => /\.(exe|cmd)$/i.test(c)) ?? candidates[0] ?? null;
  }
  let version: string | null = null;
  if (found) {
    const res = spawnSync(found, ["--version"], { encoding: "utf8", windowsHide: true, shell: /\.(cmd|bat)$/i.test(found), timeout: 15_000 });
    version = res.status === 0 ? (res.stdout ?? "").trim() || null : null;
  }
  const value = { found: !!found, path: found, version };
  claudeCache = { at: Date.now(), value };
  return value;
}

function readVersion(pkg: string): string | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "node_modules", pkg, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

export async function getSystemHealth() {
  let database: { ok: boolean; error?: string } = { ok: true };
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (err) {
    database = { ok: false, error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
  let ffmpeg: { ok: boolean; path: string | null } = { ok: false, path: null };
  try {
    ffmpeg = { ok: true, path: ffmpegPaths().ffmpeg };
  } catch {
    // reported as not ok
  }
  const worker = database.ok ? await getWorkerStatus() : { online: false, lastSeen: null, heartbeat: null };
  const root = projectsRoot();
  return {
    database,
    worker: { online: worker.online, lastSeen: worker.lastSeen },
    ffmpeg,
    claudeCli: detectClaudeCli(),
    storage: { projectsDir: root, exists: fs.existsSync(root) },
    versions: { node: process.versions.node, remotion: readVersion("remotion"), next: readVersion("next"), prisma: readVersion("@prisma/client") },
    platform: `${process.platform}-${process.arch}`,
  };
}
export type SystemHealth = Awaited<ReturnType<typeof getSystemHealth>>;
