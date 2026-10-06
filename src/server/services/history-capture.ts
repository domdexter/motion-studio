import type { AudioTrack, OverlayClip, Scene } from "@/generated/prisma/client";
import { diffEditState, isEmptyChanges, mergeChanges, type EditChanges, type EditState, type EntityState, type HistoryScope } from "@/core/history/edit-steps";
import { json, type Tx } from "../db";
import type { Actor } from "./mutation";
import { sceneSnapshot } from "./scene-history";

/** Steps kept per project and actor. */
export const MAX_EDIT_STEPS = 100;
/** Edits with the same coalesce key this close together become one step. */
export const COALESCE_MS = 2000;

export interface HistoryOptions {
  /** Shown as “Undo <label>”. */
  label: string;
  /** What the edit can change — only these are captured. */
  scope: readonly HistoryScope[];
  coalesceKey?: string;
}

export type SceneState = ReturnType<typeof sceneState>;
export function sceneState(scene: Scene) {
  return { ...sceneSnapshot(scene), approvedAt: scene.approvedAt?.toISOString() ?? null };
}

export type OverlayState = Omit<OverlayClip, "createdAt" | "updatedAt">;
export function overlayState(clip: OverlayClip): OverlayState {
  const { createdAt: _c, updatedAt: _u, ...rest } = clip;
  return rest;
}

export type AudioTrackState = Omit<AudioTrack, "createdAt" | "updatedAt">;
export function audioTrackState(track: AudioTrack): AudioTrackState {
  const { createdAt: _c, updatedAt: _u, ...rest } = track;
  return rest;
}

export async function captureEditState(tx: Tx, projectId: string, scope: readonly HistoryScope[]): Promise<EditState> {
  const state: EditState = {};
  if (scope.includes("scenes")) {
    const scenes = await tx.scene.findMany({ where: { projectId } });
    state.scenes = Object.fromEntries(scenes.map((s) => [s.id, sceneState(s) as EntityState]));
  }
  if (scope.includes("overlays")) {
    const clips = await tx.overlayClip.findMany({ where: { projectId } });
    state.overlays = Object.fromEntries(clips.map((c) => [c.id, overlayState(c) as EntityState]));
  }
  if (scope.includes("audioTracks")) {
    const tracks = await tx.audioTrack.findMany({ where: { projectId } });
    state.audioTracks = Object.fromEntries(tracks.map((t) => [t.id, audioTrackState(t) as EntityState]));
  }
  if (scope.includes("markers") || scope.includes("mix")) {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { markers: true, mix: true } });
    if (scope.includes("markers")) state.markers = project?.markers ?? [];
    if (scope.includes("mix")) state.mix = project?.mix ?? null;
  }
  return state;
}

/** Saves what an edit changed as the actor's newest undo step (and clears their redo steps). */
export async function recordEditStep(tx: Tx, projectId: string, actor: Actor, history: HistoryOptions, before: EditState): Promise<void> {
  const after = await captureEditState(tx, projectId, history.scope);
  const changes = diffEditState(before, after);
  if (isEmptyChanges(changes)) return;
  await tx.editStep.deleteMany({ where: { projectId, actor, undone: true } });
  if (history.coalesceKey) {
    const last = await tx.editStep.findFirst({ where: { projectId, actor }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (last && last.coalesceKey === history.coalesceKey && Date.now() - last.updatedAt.getTime() < COALESCE_MS) {
      const merged = mergeChanges(last.changes as unknown as EditChanges, changes);
      if (isEmptyChanges(merged)) await tx.editStep.delete({ where: { id: last.id } });
      else await tx.editStep.update({ where: { id: last.id }, data: { label: history.label, changes: json(merged) } });
      return;
    }
  }
  await tx.editStep.create({ data: { projectId, actor, label: history.label, coalesceKey: history.coalesceKey ?? null, changes: json(changes) } });
  const stale = await tx.editStep.findMany({ where: { projectId, actor }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: MAX_EDIT_STEPS, select: { id: true } });
  if (stale.length) await tx.editStep.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
}
