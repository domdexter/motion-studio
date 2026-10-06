import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { PROJECT_ID_RE } from "@/server/ids";
import { EDITABLE_CONTEXT_FILES, type EditableContextFile } from "@/server/services/context";
import { projectsRoot } from "@/server/storage/paths";
import { importContextFile } from "@/server/sync/importer";
import { db } from "@/server/db";

/**
 * Watches projects/<id>/.project/ for edits Claude Code makes directly to editable files and
 * imports them (debounced, validated, 3-way merged). Writes done by the materializer are no-ops
 * because the importer compares against the base copy.
 */

const EDITABLE = new Set<string>(EDITABLE_CONTEXT_FILES);
const DEBOUNCE_MS = 700;

export function startContextWatcher(): FSWatcher {
  const root = projectsRoot();
  const timers = new Map<string, NodeJS.Timeout>();
  const running = new Set<string>();

  const schedule = (projectId: string, file: EditableContextFile) => {
    const key = `${projectId}/${file}`;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(async () => {
        timers.delete(key);
        if (running.has(key)) return schedule(projectId, file);
        running.add(key);
        try {
          const exists = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
          if (!exists) return;
          const result = await importContextFile(projectId, file, "file");
          if (result.status !== "unchanged") console.log(`[watcher] ${projectId}/.project/${file}: ${result.status} — ${result.message}`);
        } catch (err) {
          console.error(`[watcher] import failed for ${key}:`, err instanceof Error ? err.message : err);
        } finally {
          running.delete(key);
        }
      }, DEBOUNCE_MS),
    );
  };

  const watcher = watch(root, {
    ignoreInitial: true,
    depth: 2,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
    ignored: (p) => {
      const rel = path.relative(root, p);
      if (!rel || rel.startsWith("..")) return false;
      const parts = rel.split(path.sep);
      if (parts.length >= 2 && parts[1] !== ".project") return true;
      if (parts.length === 3) return !EDITABLE.has(parts[2]);
      return parts.length > 3;
    },
  });

  const onChange = (p: string) => {
    const parts = path.relative(root, p).split(path.sep);
    if (parts.length !== 3 || parts[1] !== ".project" || !EDITABLE.has(parts[2]) || !PROJECT_ID_RE.test(parts[0])) return;
    schedule(parts[0], parts[2] as EditableContextFile);
  };
  watcher.on("add", onChange).on("change", onChange).on("error", (err) => console.error("[watcher] error:", err));
  console.log(`[watcher] watching ${root}${path.sep}*${path.sep}.project for edits`);
  return watcher;
}
