import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { newId, newProjectId } from "../ids";
import { ensureProjectDirs, projectDir } from "../storage/paths";
import { materializeSafely, type Actor } from "./mutation";

/**
 * Portable project bundle: every row that makes up a project, with ids that are remapped on
 * import. Used by Duplicate, project package export/import, and snapshots.
 */

export const BUNDLE_FORMAT = "motion-studio.project-bundle";

export async function exportProjectBundle(projectId: string, options: { includeRenders?: boolean } = {}) {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound("Project");
  const [scriptRevisions, voiceTakes, transcripts, timelines, storyboardRevisions, scenes, sceneVersions, assetRequests, assets, audioTracks, snapshots, renders, creativeRevisions, creativeReviews, overlayClips] =
    await Promise.all([
      db.scriptRevision.findMany({ where: { projectId }, orderBy: { version: "asc" } }),
      db.voiceTake.findMany({ where: { projectId }, orderBy: { version: "asc" } }),
      db.transcript.findMany({ where: { projectId }, orderBy: { version: "asc" } }),
      db.timeline.findMany({ where: { projectId }, orderBy: { version: "asc" } }),
      db.storyboardRevision.findMany({ where: { projectId }, orderBy: { version: "asc" } }),
      db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
      db.sceneVersion.findMany({ where: { scene: { projectId } }, orderBy: { version: "asc" } }),
      db.assetRequest.findMany({ where: { projectId } }),
      db.asset.findMany({ where: { projectId } }),
      db.audioTrack.findMany({ where: { projectId } }),
      db.projectSnapshot.findMany({ where: { projectId }, orderBy: { version: "asc" } }),
      options.includeRenders ? db.render.findMany({ where: { projectId, status: "complete" } }) : Promise.resolve([]),
      db.creativeRevision.findMany({ where: { projectId }, orderBy: { version: "asc" } }),
      db.creativeReview.findMany({ where: { projectId }, orderBy: { version: "asc" } }),
      db.overlayClip.findMany({ where: { projectId } }),
    ]);
  return {
    format: BUNDLE_FORMAT,
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    sourceProjectId: projectId,
    project,
    scriptRevisions,
    voiceTakes,
    transcripts,
    timelines,
    storyboardRevisions,
    scenes,
    sceneVersions,
    assetRequests,
    assets,
    audioTracks,
    snapshots,
    renders,
    creativeRevisions,
    creativeReviews,
    overlayClips,
  };
}
export type ProjectBundle = Awaited<ReturnType<typeof exportProjectBundle>>;

/** Replaces every string that exactly equals a known old id (ids are long random tokens). */
function remapDeep(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remapDeep(v, ids));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, remapDeep(v, ids)]));
  }
  return value;
}

const jsonOrNull = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : json(v));

function freshIdFor(oldId: string): string {
  if (oldId.startsWith("ast_")) return newId.asset();
  if (oldId.startsWith("req_")) return newId.assetRequest();
  if (oldId.startsWith("rnd_")) return newId.render();
  return newId.row();
}

export async function importProjectBundle(
  bundle: ProjectBundle,
  options: { projectId: string; name: string; actor: Actor; activityMessage: string; workflow?: string },
): Promise<void> {
  if (bundle.format !== BUNDLE_FORMAT) throw new AppError("BAD_REQUEST", "Not a Motion Studio project bundle.");
  const ids = new Map<string, string>([[bundle.sourceProjectId, options.projectId]]);
  const collections = [
    bundle.scriptRevisions,
    bundle.voiceTakes,
    bundle.transcripts,
    bundle.timelines,
    bundle.storyboardRevisions,
    bundle.scenes,
    bundle.sceneVersions,
    bundle.assetRequests,
    bundle.assets,
    bundle.audioTracks,
    bundle.snapshots,
    bundle.renders,
    // Bundles exported before the overlay track have no overlay rows.
    bundle.overlayClips ?? [],
  ] as { id: string }[][];
  for (const rows of collections) for (const row of rows) ids.set(row.id, freshIdFor(row.id));
  const id = (old: string | null | undefined) => (old ? ids.get(old) ?? old : null);
  const R = <T>(v: T) => remapDeep(v, ids) as T;
  const pid = options.projectId;
  const p = bundle.project;

  await db.$transaction(
    async (tx) => {
      await tx.project.create({
        data: {
          id: pid,
          name: options.name,
          description: p.description,
          workflow: options.workflow ?? p.workflow,
          formatPreset: p.formatPreset,
          width: p.width,
          height: p.height,
          fps: p.fps,
          brief: p.brief,
          brand: json(R(p.brand)),
          design: json(p.design),
          markers: json(R(p.markers)),
          mix: json(p.mix),
          timelineDecision: jsonOrNull(R(p.timelineDecision)),
          thumbnailPath: p.thumbnailPath,
          revision: 1,
        },
      });
      if (bundle.scriptRevisions.length)
        await tx.scriptRevision.createMany({
          data: bundle.scriptRevisions.map((r) => ({ ...r, id: id(r.id)!, projectId: pid, analysis: jsonOrNull(R(r.analysis)) })),
        });
      if (bundle.voiceTakes.length)
        await tx.voiceTake.createMany({
          data: bundle.voiceTakes.map((r) => ({
            ...r,
            id: id(r.id)!,
            projectId: pid,
            scriptRevisionId: id(r.scriptRevisionId),
            settings: jsonOrNull(r.settings),
            providerMeta: jsonOrNull(r.providerMeta),
          })),
        });
      if (bundle.transcripts.length)
        await tx.transcript.createMany({
          data: bundle.transcripts.map((r) => ({
            ...r,
            id: id(r.id)!,
            projectId: pid,
            voiceTakeId: id(r.voiceTakeId)!,
            parentId: id(r.parentId),
            words: json(r.words),
            quality: jsonOrNull(r.quality),
            meta: jsonOrNull(R(r.meta)),
          })),
        });
      if (bundle.timelines.length)
        await tx.timeline.createMany({
          data: bundle.timelines.map((r) => ({ ...r, id: id(r.id)!, projectId: pid, transcriptId: id(r.transcriptId), data: json(r.data) })),
        });
      if (bundle.scenes.length)
        await tx.scene.createMany({
          data: bundle.scenes.map((r) => ({
            ...r,
            id: id(r.id)!,
            projectId: pid,
            timelineId: id(r.timelineId),
            animationNotes: json(r.animationNotes),
            assetsRequired: json(R(r.assetsRequired)),
            spec: json(R(r.spec)),
            creative: jsonOrNull(R(r.creative ?? null)),
          })),
        });
      if (bundle.sceneVersions.length)
        await tx.sceneVersion.createMany({
          data: bundle.sceneVersions.map((r) => ({ ...r, id: id(r.id)!, sceneId: id(r.sceneId)!, snapshot: json(R(r.snapshot)) })),
        });
      if (bundle.assetRequests.length)
        await tx.assetRequest.createMany({
          data: bundle.assetRequests.map((r) => ({ ...r, id: id(r.id)!, projectId: pid, sceneId: id(r.sceneId), approvedAssetId: id(r.approvedAssetId), brief: jsonOrNull(r.brief ?? null) })),
        });
      if (bundle.assets.length)
        await tx.asset.createMany({
          data: bundle.assets.map((r) => ({
            ...r,
            id: id(r.id)!,
            projectId: pid,
            sceneId: id(r.sceneId),
            requestId: id(r.requestId),
            tags: json(r.tags),
            meta: jsonOrNull(r.meta),
          })),
        });
      if (bundle.audioTracks.length)
        await tx.audioTrack.createMany({ data: bundle.audioTracks.map((r) => ({ ...r, id: id(r.id)!, projectId: pid, assetId: id(r.assetId)! })) });
      const overlayClips = bundle.overlayClips ?? [];
      if (overlayClips.length)
        await tx.overlayClip.createMany({
          data: overlayClips.map((r) => ({
            ...r,
            id: id(r.id)!,
            projectId: pid,
            assetId: id(r.assetId)!,
            zooms: json(r.zooms ?? []),
            crop: jsonOrNull(r.crop ?? null),
            speedSegments: json(r.speedSegments ?? []),
            annotations: json(r.annotations ?? []),
          })),
        });
      if (bundle.storyboardRevisions.length)
        await tx.storyboardRevision.createMany({
          data: bundle.storyboardRevisions.map((r) => ({ ...r, id: id(r.id)!, projectId: pid, timelineId: id(r.timelineId), scenes: json(R(r.scenes)) })),
        });
      if (bundle.snapshots.length)
        await tx.projectSnapshot.createMany({ data: bundle.snapshots.map((r) => ({ ...r, id: id(r.id)!, projectId: pid, data: json(R(r.data)) })) });
      if (bundle.renders.length)
        await tx.render.createMany({
          data: bundle.renders.map((r) => ({ ...r, id: id(r.id)!, projectId: pid, jobId: null, settings: json(r.settings), error: jsonOrNull(r.error) })),
        });
      // Bundles exported before the creative system have no creative rows.
      const creativeRevisions = bundle.creativeRevisions ?? [];
      const creativeReviews = bundle.creativeReviews ?? [];
      if (creativeRevisions.length)
        await tx.creativeRevision.createMany({ data: creativeRevisions.map((r) => ({ ...r, id: newId.row(), projectId: pid, data: json(R(r.data)) })) });
      if (creativeReviews.length)
        await tx.creativeReview.createMany({
          data: creativeReviews.map((r) => ({
            ...r,
            id: newId.review(),
            projectId: pid,
            scores: json(r.scores),
            strengths: json(r.strengths),
            issues: json(R(r.issues)),
            scope: json(r.scope),
            weakestScenes: json(r.weakestScenes),
            basedOn: jsonOrNull(R(r.basedOn)),
            measured: jsonOrNull(R(r.measured)),
          })),
        });
      await tx.project.update({
        where: { id: pid },
        data: {
          activeVoiceTakeId: id(p.activeVoiceTakeId),
          activeTranscriptId: id(p.activeTranscriptId),
          activeTimelineId: id(p.activeTimelineId),
        },
      });
      await tx.activity.create({ data: { projectId: pid, actor: options.actor, type: "project.imported", message: options.activityMessage } });
    },
    { maxWait: 10_000, timeout: 180_000 },
  );
}

const DUPLICATE_EXCLUDES = new Set(["renders", "exports", ".project"]);

export async function duplicateProject(projectId: string, name: string | undefined, actor: Actor = "user"): Promise<string> {
  const bundle = await exportProjectBundle(projectId);
  const newName = name?.trim() || `${bundle.project.name} (copy)`;
  const targetId = newProjectId(newName);
  const src = projectDir(projectId);
  const dst = projectDir(targetId);
  await ensureProjectDirs(targetId);
  await fs.cp(src, dst, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (source) => {
      const rel = path.relative(src, source);
      return !rel || !DUPLICATE_EXCLUDES.has(rel.split(path.sep)[0]);
    },
  });
  try {
    await importProjectBundle(bundle, { projectId: targetId, name: newName, actor, activityMessage: `Duplicated from “${bundle.project.name}”` });
  } catch (err) {
    await fs.rm(dst, { recursive: true, force: true });
    throw err;
  }
  await materializeSafely(targetId);
  return targetId;
}
