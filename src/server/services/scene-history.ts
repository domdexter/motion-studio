import type { Scene } from "@/generated/prisma/client";
import { json, type Tx } from "../db";

/** Plain serializable snapshot of a scene (used by scene versions, storyboard revisions, snapshots). */
export function sceneSnapshot(scene: Scene) {
  return {
    id: scene.id,
    key: scene.key,
    order: scene.order,
    name: scene.name,
    startSec: scene.startSec,
    endSec: scene.endSec,
    timingMode: scene.timingMode,
    wordStart: scene.wordStart,
    wordEnd: scene.wordEnd,
    timelineId: scene.timelineId,
    voiceText: scene.voiceText,
    visualConcept: scene.visualConcept,
    visualType: scene.visualType,
    animationNotes: scene.animationNotes,
    onScreenText: scene.onScreenText,
    assetsRequired: scene.assetsRequired,
    notes: scene.notes,
    spec: scene.spec,
    creative: scene.creative,
    status: scene.status,
    locked: scene.locked,
    approvedFingerprint: scene.approvedFingerprint,
    version: scene.version,
    source: scene.source,
  };
}
export type SceneSnapshot = ReturnType<typeof sceneSnapshot>;

/** Records the scene's current state as its version row (call after creating/updating the scene). */
export async function recordSceneVersion(tx: Tx, scene: Scene, source: string, message: string): Promise<void> {
  await tx.sceneVersion.upsert({
    where: { sceneId_version: { sceneId: scene.id, version: scene.version } },
    create: { sceneId: scene.id, version: scene.version, snapshot: json(sceneSnapshot(scene)), source, message },
    update: { snapshot: json(sceneSnapshot(scene)), source, message },
  });
}

/** Snapshot of every scene after a storyboard-level change. */
export async function recordStoryboardRevision(tx: Tx, projectId: string, source: string, note: string): Promise<number> {
  const [scenes, last, project] = await Promise.all([
    tx.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
    tx.storyboardRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { version: true } }),
    tx.project.findUnique({ where: { id: projectId }, select: { activeTimelineId: true } }),
  ]);
  const version = (last?.version ?? 0) + 1;
  await tx.storyboardRevision.create({
    data: { projectId, version, timelineId: project?.activeTimelineId ?? null, source, note, scenes: json(scenes.map(sceneSnapshot)) },
  });
  return version;
}
