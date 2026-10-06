import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Render } from "@/generated/prisma/client";
import { RENDER_PRESETS, renderFileStem, sameAspect } from "@/core/spec/format";
import { durationToTotalFrames, formatClock, secondsToFrames } from "@/core/timing/frames";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { assertId, assertProjectId, newId } from "../ids";
import { enqueueJob, publicJob, requestCancel } from "../jobs/queue";
import { projectFile } from "../storage/paths";
import { renderMachineInfo } from "../render/concurrency";
import { buildComposition } from "./composition";
import { bumpRevision, recordActivity, type Actor } from "./mutation";
import { fileUrl } from "./projects";
import { getProjectState } from "./state";

/**
 * Render requests, history and lifecycle. The worker (src/server/render/run-render.ts) does
 * the actual Remotion work; this module validates, queues, lists, cancels and retries.
 */

export const ACTIVE_RENDER_STATUSES = ["queued", "bundling", "rendering", "encoding"];

export const RENDER_QUALITIES = {
  high: { label: "High", crf: 18, jpegQuality: 92 },
  standard: { label: "Standard", crf: 23, jpegQuality: 85 },
  draft: { label: "Draft", crf: 30, jpegQuality: 70 },
} as const;
export type RenderQuality = keyof typeof RENDER_QUALITIES;

export const RenderRequestSchema = z.object({
  kind: z.enum(["final", "preview", "scene", "range"]).default("final"),
  preset: z.enum(["project", "youtube", "tiktok", "instagram_feed", "square", "custom"]).default("project"),
  width: z.number().int().min(144).max(4320).optional(),
  height: z.number().int().min(144).max(4320).optional(),
  quality: z.enum(["high", "standard", "draft"]).default("high"),
  sceneId: z.string().min(1).max(80).optional(),
  startSec: z.number().min(0).optional(),
  endSec: z.number().positive().optional(),
  includeAudio: z.boolean().default(true),
  label: z.string().trim().max(120).optional(),
  /** Render the final video even when some scenes are not approved. */
  force: z.boolean().default(false),
  /** Queue behind a render that is already running (renders run one at a time), e.g. several sizes at once. */
  queue: z.boolean().default(false),
  /** Browser tabs rendering frames in parallel (default: Settings → Render, else automatic). */
  concurrency: z.number().int().min(1).max(32).optional(),
  /** Output frame rate (default: the project's). Timing is in seconds, so every frame rate stays in sync with the voice-over. */
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).optional(),
  /** Normalize the finished mix to a loudness target (the audio is measured and adjusted after rendering). */
  loudness: z.enum(["off", "youtube", "podcast", "broadcast"]).default("off"),
  /** Burn subtitles from the voice-over's words into the video. */
  captions: z.enum(["off", "minimal", "boxed", "bold", "karaoke"]).default("off"),
  captionPosition: z.enum(["bottom", "top", "center"]).default("bottom"),
});
export type RenderRequest = z.input<typeof RenderRequestSchema>;

export const RENDER_FRAME_RATES = [24, 25, 30, 50, 60] as const;

export interface RenderSettings {
  request: z.infer<typeof RenderRequestSchema>;
  /** Output file name without extension (renders/<fileName>.mp4). Renders queued before names existed use their id. */
  fileName?: string;
  width: number;
  height: number;
  fps: number;
  /** Parallel frames asked for by this render (null = Settings → Render, else automatic). */
  concurrency?: number | null;
  /** Loudness target for the finished mix ("off" or missing = unchanged). */
  loudness?: "off" | "youtube" | "podcast" | "broadcast";
  /** What loudness normalization measured and changed. */
  loudnessResult?: { target: string; targetLufs: number; measuredLufs: number | null; gainDb: number; limitedByPeak: boolean };
  presetLabel: string;
  quality: RenderQuality;
  crf: number;
  jpegQuality: number;
  includeAudio: boolean;
  /** Inclusive frame range, or null for the whole video. */
  frameRange: [number, number] | null;
  sceneKey: string | null;
  startSec: number;
  endSec: number;
}

export interface RenderErrorInfo {
  message: string;
  stage?: string;
  frame?: number | null;
  sceneKey?: string | null;
  sceneName?: string | null;
  logs?: string[];
  stack?: string;
}

/** Which of a render's files were deleted from disk (e.g. in the file explorer) after it finished. */
async function missingRenderFiles(r: Render): Promise<{ video: boolean; thumb: boolean }> {
  const gone = async (rel: string | null) => {
    if (!rel) return false;
    try {
      await fs.access(projectFile(r.projectId, rel));
      return false;
    } catch {
      return true;
    }
  };
  const [video, thumb] = await Promise.all([r.status === "complete" ? gone(r.outputPath) : false, gone(r.thumbnailPath)]);
  return { video, thumb };
}

export function renderDto(r: Render, currentHash: string | null, missing: { video?: boolean; thumb?: boolean } = {}) {
  const settings = r.settings as unknown as RenderSettings;
  const complete = r.status === "complete" && !!r.outputPath;
  const playable = complete && !missing.video;
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    progress: r.progress,
    stage: r.stage,
    label: r.label,
    settings,
    url: playable ? fileUrl(r.projectId, r.outputPath!, r.id) : null,
    downloadUrl: playable ? `${fileUrl(r.projectId, r.outputPath!)}?download=1` : null,
    thumbnailUrl: r.thumbnailPath && !missing.thumb ? fileUrl(r.projectId, r.thumbnailPath, r.id) : null,
    /** The render finished but its video file is no longer on disk. */
    fileMissing: complete && !!missing.video,
    outputPath: r.outputPath,
    sizeBytes: r.sizeBytes,
    durationSec: r.durationSec,
    renderedFrames: r.renderedFrames,
    totalFrames: r.totalFrames,
    compositionHash: r.compositionHash,
    stale: complete && !!currentHash && r.compositionHash !== currentHash,
    active: ACTIVE_RENDER_STATUSES.includes(r.status),
    error: (r.error as RenderErrorInfo | null) ?? null,
    jobId: r.jobId,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
export type RenderDto = ReturnType<typeof renderDto>;

/** Renders whose job ended without updating the render row (worker crash) are marked failed. */
async function reconcileRenders(projectId: string): Promise<void> {
  const active = await db.render.findMany({ where: { projectId, status: { in: ACTIVE_RENDER_STATUSES }, jobId: { not: null } }, select: { id: true, jobId: true } });
  if (!active.length) return;
  const jobs = await db.job.findMany({ where: { id: { in: active.map((r) => r.jobId!) } }, select: { id: true, status: true, error: true } });
  const byId = new Map(jobs.map((j) => [j.id, j]));
  for (const r of active) {
    const job = byId.get(r.jobId!);
    if (job && (job.status === "queued" || job.status === "running")) continue;
    await db.render.update({
      where: { id: r.id },
      data: {
        status: job?.status === "cancelled" ? "cancelled" : "failed",
        stage: null,
        finishedAt: new Date(),
        error: json(job?.error ?? { message: "The render stopped unexpectedly." }),
      },
    });
  }
}

export async function listRenders(projectId: string): Promise<RenderDto[]> {
  assertProjectId(projectId);
  await reconcileRenders(projectId);
  const [rows, state] = await Promise.all([db.render.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 60 }), getProjectState(projectId)]);
  return Promise.all(rows.map(async (r) => renderDto(r, state.compositionHash, await missingRenderFiles(r))));
}

export async function getRender(projectId: string, renderId: string): Promise<RenderDto> {
  assertProjectId(projectId);
  assertId(renderId, "render id");
  const r = await db.render.findFirst({ where: { id: renderId, projectId } });
  if (!r) throw notFound("Render");
  const [state, missing] = await Promise.all([getProjectState(projectId), missingRenderFiles(r)]);
  return renderDto(r, state.compositionHash, missing);
}

export async function getRenderReadiness(projectId: string) {
  const build = await buildComposition(projectId);
  const { props, issues } = build;
  return {
    width: props.width,
    height: props.height,
    fps: props.fps,
    durationSec: props.durationSec,
    totalFrames: durationToTotalFrames(props.durationSec, props.fps),
    /** CPU, memory and the parallel-frames default for the Render page. */
    machine: renderMachineInfo(Object.values(props.assets).some((a) => a.mimeType.startsWith("video/"))),
    sceneCount: props.scenes.length,
    approvedCount: props.scenes.length - issues.unapprovedScenes.length,
    hasVoice: !!props.voice,
    trackCount: props.tracks.length,
    scenes: props.scenes.map((s) => ({ id: s.id, key: s.key, name: s.name, start: s.start, end: s.end })),
    issues,
    compositionHash: build.compositionHash,
    blocking: props.scenes.length === 0 || issues.invalidScenes.length > 0 || issues.missingAssets.length > 0,
  };
}
export type RenderReadiness = Awaited<ReturnType<typeof getRenderReadiness>>;

export async function createRender(projectId: string, input: RenderRequest, actor: Actor = "user") {
  assertProjectId(projectId);
  const req = RenderRequestSchema.parse(input);
  const build = await buildComposition(projectId);
  const { props, issues } = build;
  const scenesHref = `/projects/${projectId}/scenes`;

  if (!props.scenes.length) {
    throw new AppError("PRECONDITION", "Generate a storyboard before rendering.", { action: { label: "Open Storyboard", href: `/projects/${projectId}/storyboard` } });
  }
  if (issues.invalidScenes.length) {
    const first = issues.invalidScenes[0];
    throw new AppError("VALIDATION", `Scene ${first.key} has an invalid spec: ${first.issues[0]?.path} — ${first.issues[0]?.message}`, { details: issues.invalidScenes, action: { label: "Open Scenes", href: scenesHref } });
  }
  if (issues.missingAssets.length) {
    const first = issues.missingAssets[0];
    throw new AppError("PRECONDITION", `Scene ${first.sceneKey} requires asset ${first.assetId}.`, { details: issues.missingAssets, action: { label: "Open Images", href: `/projects/${projectId}/assets/images` } });
  }
  if (req.kind === "final" && issues.unapprovedScenes.length && !req.force) {
    throw new AppError("PRECONDITION", `Approve all scenes before the final render (${issues.unapprovedScenes.length} of ${props.scenes.length} not approved).`, {
      hint: "Review and approve scenes, or choose “Render anyway”.",
      details: { unapproved: issues.unapprovedScenes, canForce: true },
      action: { label: "Review scenes", href: scenesHref },
    });
  }

  let width = props.width;
  let height = props.height;
  let presetLabel = "Project format";
  if (req.preset === "custom") {
    if (!req.width || !req.height) throw new AppError("VALIDATION", "Enter a width and height for a custom render size.");
    width = req.width;
    height = req.height;
    presetLabel = "Custom";
  } else if (req.preset !== "project") {
    const preset = RENDER_PRESETS.find((p) => p.id === req.preset)!;
    width = preset.width;
    height = preset.height;
    presetLabel = preset.label;
  }
  if (!sameAspect(width, height, props.width, props.height)) {
    throw new AppError("VALIDATION", `${presetLabel} (${width}×${height}) doesn't match this project's aspect ratio (${props.width}×${props.height}).`, {
      hint: "Choose a size with the same aspect ratio, or change the project format.",
    });
  }
  width = Math.round(width / 2) * 2;
  height = Math.round(height / 2) * 2;

  const fps = req.fps ?? props.fps;
  const totalFrames = durationToTotalFrames(props.durationSec, fps);
  let frameRange: [number, number] | null = null;
  let sceneKey: string | null = null;
  let startSec = 0;
  let endSec = props.durationSec;
  if (req.kind === "scene") {
    const scene = props.scenes.find((s) => s.id === req.sceneId || s.key === req.sceneId);
    if (!scene) throw notFound("Scene");
    startSec = scene.start;
    endSec = scene.end;
    sceneKey = scene.key;
  } else if (req.kind === "range") {
    if (req.startSec === undefined || req.endSec === undefined) throw new AppError("VALIDATION", "Enter a start and end time for a range render.");
    if (req.endSec <= req.startSec) throw new AppError("VALIDATION", "The range end must be after its start.");
    startSec = Math.min(req.startSec, props.durationSec);
    endSec = Math.min(req.endSec, props.durationSec);
    if (endSec - startSec < 1 / fps) throw new AppError("VALIDATION", "The range is outside the video.");
  }
  if (req.kind === "scene" || req.kind === "range") {
    const first = Math.max(0, secondsToFrames(startSec, fps));
    const last = Math.min(totalFrames - 1, Math.max(first, secondsToFrames(endSec, fps) - 1));
    frameRange = [first, last];
  }

  const running = await db.render.count({ where: { projectId, status: { in: ACTIVE_RENDER_STATUSES } } });
  if (running && !req.queue) throw new AppError("CONFLICT", "A render is already running for this project.", { hint: "Wait for it to finish or cancel it." });

  const quality: RenderQuality = req.kind === "preview" ? "draft" : req.quality;
  const version = await nextRenderVersion(projectId);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true } });
  const fileName = await uniqueRenderFileName(
    projectId,
    renderFileStem({ projectName: project?.name ?? projectId, version, kind: req.kind, sceneKey, startSec, endSec, size: req.preset === "project" ? null : { width, height } }),
  );
  const settings: RenderSettings = {
    request: req,
    fileName,
    width,
    height,
    fps,
    concurrency: req.concurrency ?? null,
    loudness: req.includeAudio ? req.loudness : "off",
    presetLabel,
    quality,
    crf: RENDER_QUALITIES[quality].crf,
    jpegQuality: RENDER_QUALITIES[quality].jpegQuality,
    includeAudio: req.includeAudio,
    frameRange,
    sceneKey,
    startSec,
    endSec,
  };
  const kindLabel = req.kind === "final" ? "Final" : req.kind === "preview" ? "Draft preview" : req.kind === "scene" ? `Scene ${sceneKey}` : `Range ${formatClock(startSec, 1)}–${formatClock(endSec, 1)}`;
  const label = req.label || `v${version} · ${kindLabel} · ${width}×${height}`;
  const renderId = newId.render();
  await db.render.create({
    data: {
      id: renderId,
      projectId,
      kind: req.kind,
      status: "queued",
      label,
      settings: json(settings),
      compositionHash: build.compositionHash ?? "",
      totalFrames: frameRange ? frameRange[1] - frameRange[0] + 1 : totalFrames,
    },
  });
  const job = await enqueueJob({ projectId, type: "render.video", payload: { renderId } });
  const render = await db.render.update({ where: { id: renderId }, data: { jobId: job.id } });
  await recordActivity(projectId, actor, { type: "render.queued", message: `Queued render ${label}`, data: { renderId, kind: req.kind, width, height, quality } });
  return { render: renderDto(render, build.compositionHash), job: publicJob(job) };
}

/**
 * Next render number: one above the highest numbered render still in the history (so numbers don't
 * repeat after older renders are deleted), else the render count + 1.
 */
async function nextRenderVersion(projectId: string): Promise<number> {
  const rows = await db.render.findMany({ where: { projectId }, select: { settings: true } });
  let max = rows.length;
  for (const r of rows) {
    const name = (r.settings as unknown as RenderSettings | null)?.fileName ?? "";
    const matches = [...name.matchAll(/-v(\d+)-(?:final|preview|scene|range)/g)];
    if (matches.length) max = Math.max(max, Number(matches[matches.length - 1][1]));
  }
  return max + 1;
}

/** A render file name that no other render of the project uses and no file on disk occupies. */
async function uniqueRenderFileName(projectId: string, stem: string, excludeRenderId?: string): Promise<string> {
  const rows = await db.render.findMany({ where: { projectId, ...(excludeRenderId ? { id: { not: excludeRenderId } } : {}) }, select: { outputPath: true, settings: true } });
  const taken = new Set<string>();
  for (const r of rows) {
    const name = (r.settings as unknown as RenderSettings | null)?.fileName;
    if (name) taken.add(name);
    if (r.outputPath) taken.add(path.posix.basename(r.outputPath, ".mp4"));
  }
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? stem : `${stem}-${n}`;
    if (taken.has(candidate)) continue;
    const onDisk = await fs.access(projectFile(projectId, `renders/${candidate}.mp4`)).then(
      () => true,
      () => false,
    );
    if (!onDisk) return candidate;
  }
}

/**
 * Renames completed renders still stored under their id (renders/rnd_….mp4) to project-named files,
 * numbered by render order like new renders. `renumber` also renames files that already have names.
 */
export async function renameLegacyRenderFiles(projectId: string, actor: Actor = "user", options: { renumber?: boolean } = {}) {
  assertProjectId(projectId);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true, thumbnailPath: true } });
  if (!project) throw notFound("Project");
  const rows = await db.render.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  const renamed: { id: string; from: string; to: string }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  let projectThumb = project.thumbnailPath;
  if (options.renumber) {
    // Move named files back to their id first, so renumbering never collides with a name still in use.
    for (const r of rows) {
      if (r.status !== "complete" || !r.outputPath || r.outputPath === `renders/${r.id}.mp4`) continue;
      const idPath = `renders/${r.id}.mp4`;
      try {
        await fs.rename(projectFile(projectId, r.outputPath), projectFile(projectId, idPath));
      } catch (err) {
        skipped.push({ id: r.id, reason: err instanceof Error ? err.message : String(err) });
        continue;
      }
      let thumbnailPath = r.thumbnailPath;
      if (thumbnailPath && thumbnailPath === r.outputPath.replace(/\.mp4$/, ".jpg")) {
        const idThumb = `renders/${r.id}.jpg`;
        const moved = await fs.rename(projectFile(projectId, thumbnailPath), projectFile(projectId, idThumb)).then(
          () => true,
          () => false,
        );
        if (moved) thumbnailPath = idThumb;
      }
      const { fileName: _previous, ...settings } = r.settings as unknown as RenderSettings;
      await db.render.update({ where: { id: r.id }, data: { outputPath: idPath, thumbnailPath, settings: json(settings) } });
      if (thumbnailPath !== r.thumbnailPath && projectThumb === r.thumbnailPath) {
        await db.project.update({ where: { id: projectId }, data: { thumbnailPath } });
        projectThumb = thumbnailPath;
      }
      Object.assign(r, { outputPath: idPath, thumbnailPath, settings });
    }
  }
  for (const [index, r] of rows.entries()) {
    if (r.status !== "complete" || r.outputPath !== `renders/${r.id}.mp4`) continue;
    const settings = r.settings as unknown as RenderSettings;
    const version = index + 1;
    const preset = settings.request?.preset ?? "project";
    const fileName = await uniqueRenderFileName(
      projectId,
      renderFileStem({ projectName: project.name, version, kind: r.kind as RenderSettings["request"]["kind"], sceneKey: settings.sceneKey, startSec: settings.startSec, endSec: settings.endSec, size: preset === "project" ? null : { width: settings.width, height: settings.height } }),
      r.id,
    );
    const outputPath = `renders/${fileName}.mp4`;
    try {
      await fs.rename(projectFile(projectId, r.outputPath), projectFile(projectId, outputPath));
    } catch (err) {
      skipped.push({ id: r.id, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    let thumbnailPath = r.thumbnailPath;
    if (r.thumbnailPath === `renders/${r.id}.jpg`) {
      const next = `renders/${fileName}.jpg`;
      const moved = await fs.rename(projectFile(projectId, r.thumbnailPath), projectFile(projectId, next)).then(
        () => true,
        () => false,
      );
      if (moved) thumbnailPath = next;
    }
    await db.render.update({ where: { id: r.id }, data: { outputPath, thumbnailPath, settings: json({ ...settings, fileName }) } });
    if (thumbnailPath !== r.thumbnailPath && projectThumb === r.thumbnailPath) {
      await db.project.update({ where: { id: projectId }, data: { thumbnailPath } });
      projectThumb = thumbnailPath;
    }
    renamed.push({ id: r.id, from: r.outputPath, to: outputPath });
  }
  if (renamed.length) {
    await recordActivity(projectId, actor, { type: "render.rename", message: `Renamed ${renamed.length} render file${renamed.length === 1 ? "" : "s"} after the project`, data: { renamed } });
    await bumpRevision(projectId);
  }
  return { renamed, skipped };
}

export async function cancelRender(projectId: string, renderId: string, actor: Actor = "user") {
  const r = await getRender(projectId, renderId);
  if (!r.active) throw new AppError("CONFLICT", `This render is already ${r.status}.`);
  const job = r.jobId ? await db.job.findUnique({ where: { id: r.jobId } }) : null;
  if (job?.status === "running") {
    await requestCancel(job.id);
  } else {
    if (job?.status === "queued") await requestCancel(job.id);
    await db.render.update({ where: { id: renderId }, data: { status: "cancelled", stage: null, finishedAt: new Date(), error: json({ message: "Cancelled." }) } });
    await bumpRevision(projectId);
  }
  await recordActivity(projectId, actor, { type: "render.cancel", message: `Cancelled render ${r.label}`, data: { renderId } });
  return getRender(projectId, renderId);
}

export async function retryRender(projectId: string, renderId: string, actor: Actor = "user") {
  const r = await getRender(projectId, renderId);
  if (r.active) throw new AppError("CONFLICT", "This render is still running.");
  const request = r.settings?.request;
  if (!request) throw new AppError("VALIDATION", "This render has no stored settings to retry.");
  return createRender(projectId, { ...request, label: undefined }, actor);
}

export async function deleteRender(projectId: string, renderId: string, actor: Actor = "user") {
  const r = await getRender(projectId, renderId);
  if (r.active) throw new AppError("CONFLICT", "Cancel the render before deleting it.");
  const row = await db.render.findUnique({ where: { id: renderId }, select: { outputPath: true, thumbnailPath: true } });
  for (const rel of [row?.outputPath, row?.thumbnailPath]) {
    if (rel) await fs.rm(projectFile(projectId, rel), { force: true }).catch(() => undefined);
  }
  await db.render.delete({ where: { id: renderId } });
  const project = await db.project.findUnique({ where: { id: projectId }, select: { thumbnailPath: true } });
  if (project?.thumbnailPath && project.thumbnailPath === row?.thumbnailPath) await db.project.update({ where: { id: projectId }, data: { thumbnailPath: null } });
  await recordActivity(projectId, actor, { type: "render.delete", message: `Deleted render ${r.label}`, data: { renderId } });
  await bumpRevision(projectId);
}

export const StillRequestSchema = z.object({
  sec: z.number().min(0).optional(),
  purpose: z.enum(["thumbnail", "still"]).default("thumbnail"),
  format: z.enum(["jpeg", "png"]).default("jpeg"),
});

export const ThumbnailRequestSchema = z
  .object({
    /** Video second of the frame behind the text (default: 35% into the video). */
    sec: z.number().min(0).optional(),
    title: z.string().trim().min(1).max(60),
    /** Short tag under the title. */
    subtitle: z.string().trim().max(40).optional(),
    layout: z.enum(["left", "center", "bottom"]).default("left"),
    /** How much the frame darkens behind the text, 0..0.85. */
    darken: z.number().min(0).max(0.85).default(0.55),
  })
  .strict();

/** Queues a YouTube thumbnail (1280×720 JPEG): a frame of the video with a title and a tag. */
export async function enqueueThumbnail(projectId: string, input: z.input<typeof ThumbnailRequestSchema>) {
  assertProjectId(projectId);
  const data = ThumbnailRequestSchema.parse(input);
  const scenes = await db.scene.count({ where: { projectId } });
  if (!scenes) throw new AppError("PRECONDITION", "Generate a storyboard before making a thumbnail.", { action: { label: "Open Storyboard", href: `/projects/${projectId}/storyboard` } });
  return publicJob(await enqueueJob({ projectId, type: "render.thumbnail", payload: data }));
}

export async function enqueueStill(projectId: string, input: z.input<typeof StillRequestSchema>) {
  assertProjectId(projectId);
  const data = StillRequestSchema.parse(input);
  const scenes = await db.scene.count({ where: { projectId } });
  if (!scenes) throw new AppError("PRECONDITION", "Generate a storyboard before exporting a thumbnail.", { action: { label: "Open Storyboard", href: `/projects/${projectId}/storyboard` } });
  return publicJob(await enqueueJob({ projectId, type: "render.still", payload: data }));
}
