import { Prisma } from "@/generated/prisma/client";
import { describeConflicts, findConflicts, scopesOf, targetOf, type EditChanges, type HistoryConflict, type HistoryDirection } from "@/core/history/edit-steps";
import { db, json, type Tx } from "../db";
import { AppError } from "../errors";
import { assertProjectId } from "../ids";
import { captureEditState, type AudioTrackState, type OverlayState, type SceneState } from "./history-capture";
import { mutateProject, type Actor } from "./mutation";
import { recordSceneVersion, recordStoryboardRevision } from "./scene-history";

/**
 * Undo / redo of editing steps (scene edits and timing, overlay clips, markers). Each actor has a
 * linear history; undo restores the newest step's `before`, redo re-applies the oldest undone step.
 * A step whose entities changed since (Claude, a file import, a storyboard regeneration) can't be
 * applied safely: it is dropped from the history and the user is told what changed.
 */

const NEWEST: Prisma.EditStepOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];
const OLDEST: Prisma.EditStepOrderByWithRelationInput[] = [{ createdAt: "asc" }, { id: "asc" }];
const SOURCE_FOR_ACTOR: Record<Actor, string> = { user: "user", claude: "claude", file: "file", worker: "system", system: "system" };

export async function getEditHistory(projectId: string, actor: Actor = "user") {
  assertProjectId(projectId);
  const select = { id: true, label: true, updatedAt: true } as const;
  const [undo, redo, undoCount, redoCount] = await Promise.all([
    db.editStep.findFirst({ where: { projectId, actor, undone: false }, orderBy: NEWEST, select }),
    db.editStep.findFirst({ where: { projectId, actor, undone: true }, orderBy: OLDEST, select }),
    db.editStep.count({ where: { projectId, actor, undone: false } }),
    db.editStep.count({ where: { projectId, actor, undone: true } }),
  ]);
  const dto = (s: typeof undo) => (s ? { id: s.id, label: s.label, at: s.updatedAt.toISOString() } : null);
  return { undo: dto(undo), redo: dto(redo), undoCount, redoCount };
}
export type EditHistoryDto = Awaited<ReturnType<typeof getEditHistory>>;

class StaleStepError extends Error {
  constructor(
    readonly reason: string,
    readonly conflicts: HistoryConflict[] = [],
  ) {
    super(reason);
  }
}

export const undoEdit = (projectId: string, actor: Actor) => stepEdit(projectId, actor, "undo");
export const redoEdit = (projectId: string, actor: Actor) => stepEdit(projectId, actor, "redo");

async function stepEdit(projectId: string, actor: Actor, direction: HistoryDirection) {
  assertProjectId(projectId);
  const step = await db.editStep.findFirst({ where: { projectId, actor, undone: direction === "redo" }, orderBy: direction === "undo" ? NEWEST : OLDEST });
  if (!step) throw new AppError("PRECONDITION", direction === "undo" ? "Nothing to undo." : "Nothing to redo.");
  const changes = step.changes as unknown as EditChanges;
  try {
    return await mutateProject(projectId, actor, async (tx) => {
      // Claiming the step serializes double-presses: the second request finds it already moved.
      const claimed = await tx.editStep.updateMany({ where: { id: step.id, undone: direction === "redo" }, data: { undone: direction === "undo" } });
      if (!claimed.count) throw new AppError("CONFLICT", `“${step.label}” was already ${direction === "undo" ? "undone" : "redone"}.`);
      const conflicts = findConflicts(changes, await captureEditState(tx, projectId, scopesOf(changes)), direction);
      if (conflicts.length) throw new StaleStepError(describeConflicts(conflicts), conflicts);
      await applyChanges(tx, projectId, actor, changes, direction, step.label);
      const verb = direction === "undo" ? "Undid" : "Redid";
      return { result: { direction, label: step.label }, activity: { type: `history.${direction}`, message: `${verb} “${step.label}”`, data: { stepId: step.id } } };
    });
  } catch (err) {
    if (!(err instanceof StaleStepError)) throw err;
    // Undo: this step can never apply again, earlier ones still can. Redo: later redo steps build on this one.
    await db.editStep.deleteMany({ where: direction === "undo" ? { id: step.id } : { projectId, actor, undone: true } });
    throw new AppError("CONFLICT", `Can't ${direction} “${step.label}”: ${err.reason}.`, {
      details: err.conflicts,
      hint: direction === "undo" ? "It was removed from the undo history. Undo again to go further back, or use a scene's Versions tab." : "The redo history was cleared.",
    });
  }
}

function sceneFields(t: SceneState) {
  return {
    key: t.key,
    order: t.order,
    name: t.name,
    startSec: t.startSec,
    endSec: t.endSec,
    timingMode: t.timingMode,
    wordStart: t.wordStart,
    wordEnd: t.wordEnd,
    timelineId: t.timelineId,
    voiceText: t.voiceText,
    visualConcept: t.visualConcept,
    visualType: t.visualType,
    animationNotes: json(t.animationNotes ?? []),
    onScreenText: t.onScreenText,
    assetsRequired: json(t.assetsRequired ?? []),
    notes: t.notes,
    spec: json(t.spec),
    creative: t.creative === null || t.creative === undefined ? Prisma.DbNull : json(t.creative),
    status: t.status,
    approvedFingerprint: t.approvedFingerprint,
    approvedAt: t.approvedAt ? new Date(t.approvedAt) : null,
  };
}

async function applyChanges(tx: Tx, projectId: string, actor: Actor, changes: EditChanges, direction: HistoryDirection, label: string) {
  const source = SOURCE_FOR_ACTOR[actor];
  const message = `${direction === "undo" ? "Undid" : "Redid"} “${label}”`;

  if (changes.scenes?.length) {
    const rows = await tx.scene.findMany({ where: { projectId, id: { in: changes.scenes.map((c) => c.id) } } });
    const locked = rows.filter((r) => r.locked);
    if (locked.length) {
      throw new AppError("LOCKED", `Unlock ${locked.map((s) => s.key).join(", ")} to ${direction} “${label}”.`, { hint: "Locked scenes are never changed, not even by undo." });
    }
    const existing = new Map(rows.map((r) => [r.id, r]));
    // Free the touched keys first so restored keys never collide mid-way (split/merge renumber scenes).
    for (const r of rows) await tx.scene.update({ where: { id: r.id }, data: { key: `__history_${r.id}` } });
    const removed = changes.scenes.filter((c) => !targetOf(c, direction) && existing.has(c.id)).map((c) => c.id);
    if (removed.length) await tx.scene.deleteMany({ where: { projectId, id: { in: removed } } });
    for (const change of changes.scenes) {
      const t = targetOf(change, direction) as SceneState | null;
      if (!t) continue;
      const prev = existing.get(change.id);
      const row = prev
        ? await tx.scene.update({ where: { id: prev.id }, data: { ...sceneFields(t), version: prev.version + 1, source } })
        : await tx.scene.create({ data: { id: change.id, projectId, ...sceneFields(t), version: Math.max(1, t.version ?? 1), source } });
      await recordSceneVersion(tx, row, source, message);
    }
    const structural = changes.scenes.some((c) => !c.before || !c.after || c.before.startSec !== c.after.startSec || c.before.endSec !== c.after.endSec || c.before.key !== c.after.key);
    if (structural) await recordStoryboardRevision(tx, projectId, source, message);
  }

  if (changes.overlays?.length) {
    const targets = changes.overlays.map((c) => ({ id: c.id, t: targetOf(c, direction) as OverlayState | null }));
    const assetIds = [...new Set(targets.flatMap(({ t }) => (t ? [t.assetId] : [])))];
    const assets = new Set((await tx.asset.findMany({ where: { projectId, id: { in: assetIds } }, select: { id: true } })).map((a) => a.id));
    const orphan = targets.find(({ t }) => t && !assets.has(t.assetId));
    if (orphan?.t) throw new StaleStepError(`the media of overlay “${orphan.t.name}” was deleted`);
    const removed = targets.filter(({ t }) => !t).map(({ id }) => id);
    if (removed.length) await tx.overlayClip.deleteMany({ where: { projectId, id: { in: removed } } });
    for (const { id, t } of targets) {
      if (!t) continue;
      const { id: _id, projectId: _p, zooms, crop, speedSegments, annotations, ...rest } = t;
      const data = { ...rest, zooms: json(zooms ?? []), crop: crop === null || crop === undefined ? Prisma.DbNull : json(crop), speedSegments: json(speedSegments ?? []), annotations: json(annotations ?? []) };
      await tx.overlayClip.upsert({ where: { id }, create: { id, projectId, ...data }, update: data });
    }
  }

  if (changes.audioTracks?.length) {
    const targets = changes.audioTracks.map((c) => ({ id: c.id, t: targetOf(c, direction) as AudioTrackState | null }));
    const assetIds = [...new Set(targets.flatMap(({ t }) => (t ? [t.assetId] : [])))];
    const assets = new Set((await tx.asset.findMany({ where: { projectId, id: { in: assetIds } }, select: { id: true } })).map((a) => a.id));
    const orphan = targets.find(({ t }) => t && !assets.has(t.assetId));
    if (orphan?.t) throw new StaleStepError(`the audio of track “${orphan.t.name}” was deleted`);
    const removed = targets.filter(({ t }) => !t).map(({ id }) => id);
    if (removed.length) await tx.audioTrack.deleteMany({ where: { projectId, id: { in: removed } } });
    for (const { id, t } of targets) {
      if (!t) continue;
      const { id: _id, projectId: _p, ...data } = t;
      await tx.audioTrack.upsert({ where: { id }, create: { id, projectId, ...data }, update: data });
    }
  }

  if (changes.markers) {
    const markers = direction === "undo" ? changes.markers.before : changes.markers.after;
    await tx.project.update({ where: { id: projectId }, data: { markers: json(markers ?? []) } });
  }

  if (changes.mix) {
    const mix = direction === "undo" ? changes.mix.before : changes.mix.after;
    await tx.project.update({ where: { id: projectId }, data: { mix: json(mix ?? { volume: 1, muted: false }) } });
  }
}
