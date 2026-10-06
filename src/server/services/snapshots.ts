import { Prisma } from "@/generated/prisma/client";
import { stableStringify } from "@/core/util/hash";
import { db, json, type DbOrTx } from "../db";
import { AppError, notFound } from "../errors";
import { assertProjectId } from "../ids";
import { mutateProject, type Actor } from "./mutation";
import { recordSceneVersion, recordStoryboardRevision, sceneSnapshot, type SceneSnapshot } from "./scene-history";

/**
 * Named project versions: the full creative state (scenes, design, brand, markers, mix, active
 * voice/transcript/timeline pointers, audio tracks, overlay clips). Binaries are referenced, never copied —
 * every voice take, transcript and timeline is itself an immutable revision.
 */

export async function buildSnapshotData(client: DbOrTx, projectId: string) {
  const [project, scenes, tracks, creativePlan, overlays] = await Promise.all([
    client.project.findUnique({
      where: { id: projectId },
      select: { name: true, fps: true, width: true, height: true, brief: true, brand: true, design: true, markers: true, mix: true, activeVoiceTakeId: true, activeTranscriptId: true, activeTimelineId: true, timelineDecision: true },
    }),
    client.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
    client.audioTrack.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
    client.creativeRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { version: true, data: true } }),
    client.overlayClip.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
  ]);
  return {
    format: "motion-studio.snapshot",
    version: 1,
    project,
    scenes: scenes.map(sceneSnapshot),
    audioTracks: tracks.map(({ createdAt: _c, updatedAt: _u, ...t }) => t),
    overlayClips: overlays.map(({ createdAt: _c, updatedAt: _u, ...c }) => c),
    creativePlan: creativePlan ? { version: creativePlan.version, data: creativePlan.data } : null,
  };
}

export async function createSnapshot(client: DbOrTx, projectId: string, label: string, reason: string): Promise<{ id: string; version: number }> {
  const [data, last] = await Promise.all([
    buildSnapshotData(client, projectId),
    client.projectSnapshot.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { version: true } }),
  ]);
  const version = (last?.version ?? 0) + 1;
  const row = await client.projectSnapshot.create({ data: { projectId, version, label, reason, data: json(data) } });
  return { id: row.id, version };
}

export async function listSnapshots(projectId: string) {
  const rows = await db.projectSnapshot.findMany({
    where: { projectId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, label: true, reason: true, createdAt: true, data: true },
  });
  return rows.map(({ data, ...r }) => {
    const d = data as { scenes?: unknown[]; audioTracks?: unknown[] } | null;
    return { ...r, scenes: Array.isArray(d?.scenes) ? d.scenes.length : 0, audioTracks: Array.isArray(d?.audioTracks) ? d.audioTracks.length : 0, createdAt: r.createdAt.toISOString() };
  });
}

export async function saveSnapshot(projectId: string, label: string, actor: Actor) {
  assertProjectId(projectId);
  const clean = label.trim() || "Saved version";
  return mutateProject(projectId, actor, async (tx) => {
    const snap = await createSnapshot(tx, projectId, clean, "manual");
    return { result: snap, activity: { type: "snapshot.created", message: `Saved project version v${snap.version} “${clean}”`, data: snap } };
  });
}

type SnapshotData = Awaited<ReturnType<typeof buildSnapshotData>>;
type StoredTrack = SnapshotData["audioTracks"][number];
type StoredOverlay = SnapshotData["overlayClips"][number];

/**
 * Restores a project version: creative state, scenes (keeping each scene's version history),
 * audio tracks and the active voice/transcript/timeline pointers. The current state is saved
 * as a new version first, so a restore can always be undone.
 */
export async function restoreSnapshot(projectId: string, version: number, actor: Actor) {
  assertProjectId(projectId);
  const row = await db.projectSnapshot.findUnique({ where: { projectId_version: { projectId, version } } });
  if (!row) throw notFound(`Project version v${version}`);
  const data = row.data as unknown as SnapshotData;
  if (data?.format !== "motion-studio.snapshot" || !data.project) throw new AppError("VALIDATION", "This version was saved in an unsupported format.");
  const locked = await db.scene.findMany({ where: { projectId, locked: true }, select: { key: true } });
  if (locked.length) {
    throw new AppError("LOCKED", `Unlock ${locked.map((s) => s.key).join(", ")} before restoring a project version.`, { hint: "Locked scenes are never overwritten." });
  }

  return mutateProject(projectId, actor, async (tx) => {
    const backup = await createSnapshot(tx, projectId, `Before restoring v${version}`, "before_restore");
    const p = data.project!;
    const [voice, transcript, timeline] = await Promise.all([
      p.activeVoiceTakeId ? tx.voiceTake.findFirst({ where: { id: p.activeVoiceTakeId, projectId }, select: { id: true } }) : null,
      p.activeTranscriptId ? tx.transcript.findFirst({ where: { id: p.activeTranscriptId, projectId }, select: { id: true } }) : null,
      p.activeTimelineId ? tx.timeline.findFirst({ where: { id: p.activeTimelineId, projectId }, select: { id: true } }) : null,
    ]);
    await tx.project.update({
      where: { id: projectId },
      data: {
        brief: p.brief,
        brand: json(p.brand),
        design: json(p.design),
        markers: json(p.markers ?? []),
        mix: json(p.mix ?? { volume: 1, muted: false }),
        activeVoiceTakeId: voice?.id ?? null,
        activeTranscriptId: transcript?.id ?? null,
        activeTimelineId: timeline?.id ?? null,
        timelineDecision: p.timelineDecision ? json(p.timelineDecision) : Prisma.DbNull,
      },
    });

    const current = await tx.scene.findMany({ where: { projectId } });
    const snapScenes = (data.scenes ?? []) as SceneSnapshot[];
    const keep = new Set(snapScenes.map((s) => s.id));
    // Free every key first so restored keys never collide mid-way.
    for (const s of current) await tx.scene.update({ where: { id: s.id }, data: { key: `__restore_${s.id}` } });
    const removed = current.filter((s) => !keep.has(s.id)).map((s) => s.id);
    if (removed.length) await tx.scene.deleteMany({ where: { id: { in: removed } } });
    const existing = new Map(current.map((s) => [s.id, s]));
    for (const s of snapScenes) {
      const fields = {
        key: s.key,
        order: s.order,
        name: s.name,
        startSec: s.startSec,
        endSec: s.endSec,
        timingMode: s.timingMode,
        wordStart: s.wordStart,
        wordEnd: s.wordEnd,
        timelineId: s.timelineId,
        voiceText: s.voiceText,
        visualConcept: s.visualConcept,
        visualType: s.visualType,
        animationNotes: json(s.animationNotes),
        onScreenText: s.onScreenText,
        assetsRequired: json(s.assetsRequired),
        notes: s.notes,
        spec: json(s.spec),
        // Snapshots saved before creative intent existed leave the current intent in place.
        ...(s.creative !== undefined ? { creative: s.creative === null ? Prisma.DbNull : json(s.creative) } : {}),
        status: s.status,
        locked: false,
        approvedFingerprint: s.approvedFingerprint,
        approvedAt: s.status === "approved" ? new Date() : null,
        source: "restore",
      };
      const prev = existing.get(s.id);
      const saved = prev
        ? await tx.scene.update({ where: { id: s.id }, data: { ...fields, version: prev.version + 1 } })
        : await tx.scene.create({ data: { id: s.id, projectId, ...fields, version: Math.max(1, s.version) } });
      await recordSceneVersion(tx, saved, "restore", `Restored from project version v${version}`);
    }

    await tx.audioTrack.deleteMany({ where: { projectId } });
    const assetIds = new Set((await tx.asset.findMany({ where: { projectId }, select: { id: true } })).map((a) => a.id));
    const tracks = ((data.audioTracks ?? []) as StoredTrack[]).filter((t) => assetIds.has(t.assetId));
    if (tracks.length) await tx.audioTrack.createMany({ data: tracks.map((t) => ({ ...t, projectId })) });
    // Versions saved before the overlay track existed leave the current overlays in place.
    const storedOverlays = (data as { overlayClips?: StoredOverlay[] }).overlayClips;
    let overlayCount = 0;
    if (storedOverlays) {
      await tx.overlayClip.deleteMany({ where: { projectId } });
      const overlays = storedOverlays.filter((c) => assetIds.has(c.assetId));
      if (overlays.length) {
        await tx.overlayClip.createMany({
          data: overlays.map((c) => ({ ...c, projectId, zooms: json(c.zooms ?? []), crop: c.crop === null || c.crop === undefined ? Prisma.DbNull : json(c.crop), speedSegments: json(c.speedSegments ?? []), annotations: json(c.annotations ?? []) })),
        });
      }
      overlayCount = overlays.length;
    }
    if (data.creativePlan) {
      const currentPlan = await tx.creativeRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" } });
      if (!currentPlan || stableStringify(currentPlan.data) !== stableStringify(data.creativePlan.data)) {
        await tx.creativeRevision.create({ data: { projectId, version: (currentPlan?.version ?? 0) + 1, source: "restore", note: `Restored with project version v${version}`, data: json(data.creativePlan.data) } });
      }
    }
    await recordStoryboardRevision(tx, projectId, "restore", `Restored project version v${version}`);

    const result = { restoredVersion: version, backupVersion: backup.version, scenes: snapScenes.length, audioTracks: tracks.length, overlayClips: overlayCount, missingVoice: !!p.activeVoiceTakeId && !voice };
    return { result, activity: { type: "snapshot.restored", message: `Restored project version v${version} “${row.label}” (current state saved as v${backup.version})`, data: result } };
  });
}
