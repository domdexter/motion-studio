import fs from "node:fs/promises";
import { planPartOfCreativeFile } from "@/core/creative/schema";
import { stableStringify } from "@/core/util/hash";
import { db, json } from "../db";
import { applyCreativePlan, getCreativePlan } from "../services/creative";
import { AppError, isAppError } from "../errors";
import { updateDesign } from "../services/brand";
import { EDITABLE_CONTEXT_FILES, acknowledgeFile, basePath, contextPath, readBase, type EditableContextFile } from "../services/context";
import { materializeSafely, recordActivity, type Actor } from "../services/mutation";
import { updateProject } from "../services/projects";
import { saveScript } from "../services/script";
import { applyScenesFile, applyStoryboardFile, type ApplyReport } from "../services/storyboard-io";

/**
 * Imports edits Claude Code (or anyone) made directly to editable files in .project/.
 * Uses the base copy written by the materializer for a 3-way merge; invalid edits are never
 * applied — they become SyncIssues visible in the GUI and reported by the CLI.
 */

export interface ImportResult {
  file: EditableContextFile;
  status: "unchanged" | "applied" | "rejected";
  message: string;
  report?: ApplyReport;
}

async function readText(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

export async function recordSyncIssue(projectId: string, file: string, message: string, details?: unknown): Promise<void> {
  const existing = await db.syncIssue.findFirst({ where: { projectId, file, resolved: false, message } });
  if (existing) return;
  await db.syncIssue.create({ data: { projectId, file, message, ...(details !== undefined ? { details: json(details) } : {}) } });
  await db.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
}

export async function resolveSyncIssues(projectId: string, file: string): Promise<void> {
  const res = await db.syncIssue.updateMany({ where: { projectId, file, resolved: false }, data: { resolved: true } });
  if (res.count) await db.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
}

function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new AppError("VALIDATION", `${file} is not valid JSON: ${(err as Error).message}`);
  }
}

export async function importContextFile(projectId: string, file: EditableContextFile, actor: Actor): Promise<ImportResult> {
  const disk = await readText(contextPath(projectId, file));
  const base = await readBase(projectId, file);
  if (disk === null || (base !== null && disk === base)) return { file, status: "unchanged", message: "No pending edits." };

  try {
    let report: ApplyReport | undefined;
    switch (file) {
      case "script.md": {
        const res = await saveScript(projectId, { content: disk, note: "Edited .project/script.md" }, actor);
        await acknowledgeFile(projectId, file);
        await resolveSyncIssues(projectId, file);
        await materializeSafely(projectId);
        return { file, status: res.created ? "applied" : "unchanged", message: res.created ? `Saved script v${res.version}` : "Script unchanged." };
      }
      case "creative-brief.md": {
        await updateProject(projectId, { brief: disk.trim() }, actor);
        break;
      }
      case "creative.json": {
        const parsedDisk = parseJson(disk, file);
        if (!parsedDisk || typeof parsedDisk !== "object" || Array.isArray(parsedDisk)) throw new AppError("VALIDATION", "creative.json must contain a JSON object.");
        const diskPlan = planPartOfCreativeFile(parsedDisk as Record<string, unknown>);
        let basePlan: Record<string, unknown> | null = null;
        try {
          basePlan = base ? planPartOfCreativeFile(JSON.parse(base) as Record<string, unknown>) : null;
        } catch {
          basePlan = null;
        }
        const finish = async (status: ImportResult["status"], message: string): Promise<ImportResult> => {
          await acknowledgeFile(projectId, file);
          await materializeSafely(projectId);
          return { file, status, message };
        };
        if (basePlan && stableStringify(diskPlan) === stableStringify(basePlan)) {
          await resolveSyncIssues(projectId, file);
          return finish("unchanged", "Only read-only fields changed.");
        }
        const current = await getCreativePlan(projectId);
        if (basePlan && stableStringify(current?.plan ?? {}) !== stableStringify(basePlan)) {
          const message = "creative.json changed in the GUI and in the file — kept the GUI version.";
          await recordSyncIssue(projectId, file, message);
          return finish("rejected", message);
        }
        const res = await applyCreativePlan(projectId, diskPlan, actor, { mode: "replace", note: "Edited .project/creative.json" });
        await resolveSyncIssues(projectId, file);
        return finish(res.changed ? "applied" : "unchanged", res.changed ? `Saved creative plan v${res.plan?.version} (${res.changedSections.join(", ")})${res.warnings.length ? ` · ${res.warnings.join(" ")}` : ""}` : "Creative plan unchanged.");
      }
      case "design.json": {
        await updateDesign(projectId, parseJson(disk, file), actor, "Design system edited in .project/design.json");
        break;
      }
      case "storyboard.json": {
        report = await applyStoryboardFile(projectId, parseJson(disk, file), actor, { base: base ? JSON.parse(base) : undefined });
        break;
      }
      case "scenes.json": {
        report = await applyScenesFile(projectId, parseJson(disk, file), actor, { base: base ? JSON.parse(base) : undefined });
        break;
      }
    }
    if (report?.errors.length) {
      const message = `${file}: ${report.errors.length} validation error${report.errors.length === 1 ? "" : "s"} — nothing was applied.`;
      await recordSyncIssue(projectId, file, message, report.errors);
      return { file, status: "rejected", message, report };
    }
    await acknowledgeFile(projectId, file);
    await resolveSyncIssues(projectId, file);
    if (report && (report.skippedLocked.length || report.conflicts.length)) {
      await recordActivity(projectId, "system", {
        type: "sync.partial",
        message: `${file}: ${[report.skippedLocked.length ? `locked scenes unchanged (${report.skippedLocked.join(", ")})` : "", report.conflicts.length ? `${report.conflicts.length} conflict(s) kept the GUI version` : ""].filter(Boolean).join("; ")}`,
        data: report,
      });
    }
    await materializeSafely(projectId);
    const applied = report ? report.applied.length : 1;
    return { file, status: applied ? "applied" : "unchanged", message: report ? `Applied ${report.applied.length} scene change(s).` : `Imported ${file}.`, report };
  } catch (err) {
    const message = isAppError(err) ? err.message : err instanceof Error ? err.message : String(err);
    await recordSyncIssue(projectId, file, message, isAppError(err) ? (err as AppError).details : undefined);
    return { file, status: "rejected", message };
  }
}

export async function importPendingContextFiles(projectId: string, actor: Actor): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const file of EDITABLE_CONTEXT_FILES) results.push(await importContextFile(projectId, file, actor));
  return results;
}

/** Throws away pending edits of an editable file and rewrites it from the database. */
export async function discardContextFileEdits(projectId: string, file: EditableContextFile): Promise<void> {
  await fs.rm(contextPath(projectId, file), { force: true });
  await fs.rm(basePath(projectId, file), { force: true });
  await resolveSyncIssues(projectId, file);
  await materializeSafely(projectId);
}
