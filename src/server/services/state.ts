import { parseScript } from "@/core/script/script";
import { assetIdsInSpec, validateSceneSpec, type SceneSpec, type SpecIssue } from "@/core/spec/scene";
import { derivePipeline, type PipelineResult } from "@/core/status/pipeline";
import { parseVoiceMix } from "@/core/timeline/audio-clips";
import { parseAnnotations, parseCrop, parseSpeedSegments } from "@/core/timeline/clip-edits";
import { parseZooms } from "@/core/timeline/overlay-zoom";
import { fingerprint } from "@/core/util/hash";
import { db } from "../db";
import { notFound } from "../errors";

/**
 * Derived project state: pipeline status, dependency staleness, scene validity and
 * fingerprints, and the composition hash used to detect stale renders.
 * Memoized per project revision (every mutation — including job transitions — bumps it).
 */

export interface SceneStateInfo {
  id: string;
  key: string;
  valid: boolean;
  issues: SpecIssue[];
  fingerprint: string;
  staleTiming: boolean;
  needsReview: boolean;
  missingAssetIds: string[];
}

export interface ProjectState {
  revision: number;
  pipeline: PipelineResult;
  compositionHash: string | null;
  durationSec: number | null;
  scenes: Record<string, SceneStateInfo>;
  counts: {
    scenes: number;
    approvedScenes: number;
    lockedScenes: number;
    assets: number;
    openRequests: number;
    awaitingApproval: number;
    renders: number;
  };
  latestRender: { id: string; kind: string; status: string; progress: number; createdAt: string; compositionHash: string; stale: boolean } | null;
  activeJobs: { id: string; type: string; status: string; progress: number; stage: string | null }[];
}

const memo = new Map<string, { revision: number; state: ProjectState }>();

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function sceneFingerprint(scene: { startSec: number; endSec: number; spec: unknown }, assetHashes: Map<string, string>): string {
  const spec = scene.spec as SceneSpec;
  const ids = Array.isArray(spec?.elements) ? assetIdsInSpec(spec) : [];
  return fingerprint({
    start: r3(scene.startSec),
    end: r3(scene.endSec),
    spec: scene.spec,
    assets: Object.fromEntries(ids.sort().map((id) => [id, assetHashes.get(id) ?? null])),
  });
}

export interface CompositionHashInput {
  width: number;
  height: number;
  fps: number;
  durationSec: number | null;
  design: unknown;
  brand: unknown;
  transcriptId: string | null;
  voice: { contentHash: string; volume: number; muted: boolean } | null;
  scenes: { key: string; startSec: number; endSec: number; spec: unknown }[];
  tracks: unknown[];
  /** Visible overlay clips. Left out of the hash when there are none, so existing renders stay current. */
  overlayClips?: { assetId: string }[];
  assetHashes: Map<string, string>;
}

export function computeCompositionHash(input: CompositionHashInput): string {
  const referenced = new Set<string>();
  for (const s of input.scenes) {
    const spec = s.spec as SceneSpec;
    if (Array.isArray(spec?.elements)) assetIdsInSpec(spec).forEach((id) => referenced.add(id));
  }
  const brand = input.brand as { logoAssetId?: string | null };
  if (brand?.logoAssetId) referenced.add(brand.logoAssetId);
  for (const t of input.tracks as { assetId?: string }[]) if (t.assetId) referenced.add(t.assetId);
  for (const c of input.overlayClips ?? []) referenced.add(c.assetId);
  return fingerprint({
    v: 1,
    format: [input.width, input.height, input.fps],
    durationSec: input.durationSec === null ? null : r3(input.durationSec),
    design: input.design,
    brand: input.brand,
    transcriptId: input.transcriptId,
    voice: input.voice,
    scenes: input.scenes.map((s) => ({ key: s.key, start: r3(s.startSec), end: r3(s.endSec), spec: s.spec })),
    tracks: input.tracks,
    ...(input.overlayClips?.length ? { overlayClips: input.overlayClips } : {}),
    assets: Object.fromEntries([...referenced].sort().map((id) => [id, input.assetHashes.get(id) ?? null])),
  });
}

const ACTIVE_RENDER = ["queued", "bundling", "rendering", "encoding"];

export async function getProjectState(projectId: string): Promise<ProjectState> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      revision: true,
      width: true,
      height: true,
      fps: true,
      design: true,
      brand: true,
      mix: true,
      activeVoiceTakeId: true,
      activeTranscriptId: true,
      activeTimelineId: true,
      timelineDecision: true,
    },
  });
  if (!project) throw notFound("Project");
  const cached = memo.get(projectId);
  if (cached && cached.revision === project.revision) return cached.state;

  const [script, voice, transcript, timeline, scenes, assets, requests, tracks, renders, jobs, overlayClips] = await Promise.all([
    db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { content: true, contentHash: true } }),
    project.activeVoiceTakeId
      ? db.voiceTake.findUnique({ where: { id: project.activeVoiceTakeId }, select: { id: true, source: true, scriptHash: true, contentHash: true, durationSec: true } })
      : null,
    project.activeTranscriptId ? db.transcript.findUnique({ where: { id: project.activeTranscriptId }, select: { id: true, voiceTakeId: true } }) : null,
    project.activeTimelineId ? db.timeline.findUnique({ where: { id: project.activeTimelineId }, select: { id: true, transcriptId: true, durationSec: true } }) : null,
    db.scene.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
      select: { id: true, key: true, startSec: true, endSec: true, spec: true, status: true, locked: true, timingMode: true, timelineId: true, approvedFingerprint: true },
    }),
    db.asset.findMany({ where: { projectId }, select: { id: true, contentHash: true } }),
    db.assetRequest.groupBy({ by: ["status"], where: { projectId }, _count: { _all: true } }),
    db.audioTrack.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
      select: { assetId: true, kind: true, startSec: true, trimStartSec: true, durationSec: true, volume: true, fadeInSec: true, fadeOutSec: true, muted: true, loop: true, duckUnderVoice: true },
    }),
    db.render.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, kind: true, status: true, progress: true, createdAt: true, compositionHash: true },
    }),
    db.job.findMany({
      where: { projectId, status: { in: ["queued", "running"] } },
      select: { id: true, type: true, status: true, progress: true, stage: true },
      orderBy: { createdAt: "asc" },
    }),
    db.overlayClip.findMany({
      where: { projectId, hidden: false },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: {
        assetId: true,
        placement: true,
        fit: true,
        startSec: true,
        durationSec: true,
        trimStartSec: true,
        trimEndSec: true,
        playbackRate: true,
        endBehavior: true,
        volume: true,
        dim: true,
        opacity: true,
        fadeInSec: true,
        fadeOutSec: true,
        zooms: true,
        crop: true,
        speedSegments: true,
        annotations: true,
        duckUnderVoice: true,
      },
    }),
  ]);

  const assetHashes = new Map(assets.map((a) => [a.id, a.contentHash]));
  const assetIds = new Set(assets.map((a) => a.id));

  const sceneInfos: Record<string, SceneStateInfo> = {};
  let invalid = 0;
  let staleTiming = 0;
  let needsReview = 0;
  const missingIds = new Set<string>();
  for (const s of scenes) {
    const validation = validateSceneSpec(s.spec);
    const fp = sceneFingerprint(s, assetHashes);
    const missing = validation.ok ? assetIdsInSpec(validation.spec).filter((id) => !assetIds.has(id)) : [];
    missing.forEach((id) => missingIds.add(id));
    const info: SceneStateInfo = {
      id: s.id,
      key: s.key,
      valid: validation.ok,
      issues: validation.ok ? [] : validation.issues,
      fingerprint: fp,
      staleTiming: s.timingMode === "audio_locked" && !!project.activeTimelineId && s.timelineId !== project.activeTimelineId,
      needsReview: s.status === "approved" && !!s.approvedFingerprint && s.approvedFingerprint !== fp,
      missingAssetIds: missing,
    };
    if (!info.valid) invalid++;
    if (info.staleTiming) staleTiming++;
    if (info.needsReview) needsReview++;
    sceneInfos[s.id] = info;
  }

  const requestCount = (status: string) => requests.find((r) => r.status === status)?._count._all ?? 0;
  const openRequests = requestCount("requested") + requestCount("generating");
  const awaitingApproval = requestCount("generated");

  const mix = parseVoiceMix(project.mix);
  const durationSec = voice?.durationSec ?? timeline?.durationSec ?? (scenes.length ? Math.max(...scenes.map((s) => s.endSec)) : null);
  const compositionHash =
    scenes.length || voice
      ? computeCompositionHash({
          width: project.width,
          height: project.height,
          fps: project.fps,
          durationSec,
          design: project.design,
          brand: project.brand,
          transcriptId: project.activeTranscriptId,
          // Muted sections join the hash only when present, so existing renders stay current.
          voice: voice ? { contentHash: voice.contentHash, volume: mix.volume, muted: mix.muted, ...(mix.cuts.length ? { cuts: mix.cuts } : {}) } : null,
          scenes,
          tracks,
          // Zooms, crop, speed segments and annotations join the hash only when a clip has them, so existing renders stay current.
          overlayClips: overlayClips.map(({ zooms, crop, speedSegments, annotations, duckUnderVoice, ...clip }) => {
            const parsed = parseZooms(zooms);
            const cropped = parseCrop(crop);
            const segments = parseSpeedSegments(speedSegments);
            const marks = parseAnnotations(annotations);
            return {
              ...clip,
              ...(duckUnderVoice ? { duckUnderVoice } : {}),
              ...(parsed.length ? { zooms: parsed } : {}),
              ...(cropped ? { crop: cropped } : {}),
              ...(segments.length ? { speedSegments: segments } : {}),
              ...(marks.length ? { annotations: marks } : {}),
            };
          }),
          assetHashes,
        })
      : null;

  const finals = renders.filter((r) => r.kind === "final");
  const latestComplete = finals.find((r) => r.status === "complete") ?? null;
  const latestFinal = finals[0] ?? null;
  const renderRunning = renders.some((r) => r.kind === "final" && ACTIVE_RENDER.includes(r.status));

  let wordCount = 0;
  if (script) wordCount = parseScript(script.content).wordCount;

  const pipeline = derivePipeline({
    script: script ? { hash: script.contentHash, wordCount } : null,
    voice: voice ? { id: voice.id, source: voice.source, scriptHash: voice.scriptHash } : null,
    voiceJobRunning: jobs.some((j) => j.type.startsWith("voice.") && j.type !== "voice.preview"),
    alignmentJobRunning: jobs.some((j) => j.type.startsWith("alignment.")),
    transcript: transcript ? { id: transcript.id, voiceTakeId: transcript.voiceTakeId } : null,
    timeline: timeline ? { id: timeline.id, transcriptId: timeline.transcriptId } : null,
    timelineDecision: (project.timelineDecision as { voiceTakeId: string; decision: "keep" | "recalculate" } | null) ?? null,
    scenes: {
      total: scenes.length,
      approved: scenes.filter((s) => s.status === "approved").length,
      staleTiming,
      needsReview,
      invalid,
    },
    assets: { missing: missingIds.size, openRequests, awaitingApproval },
    render: {
      running: renderRunning,
      latestComplete: latestComplete ? { compositionHash: latestComplete.compositionHash } : null,
      latestFailed: latestFinal?.status === "failed",
    },
    compositionHash,
  });

  const latest = renders[0] ?? null;
  const state: ProjectState = {
    revision: project.revision,
    pipeline,
    compositionHash,
    durationSec,
    scenes: sceneInfos,
    counts: {
      scenes: scenes.length,
      approvedScenes: scenes.filter((s) => s.status === "approved").length,
      lockedScenes: scenes.filter((s) => s.locked).length,
      assets: assets.length,
      openRequests,
      awaitingApproval,
      renders: renders.length,
    },
    latestRender: latest
      ? {
          id: latest.id,
          kind: latest.kind,
          status: latest.status,
          progress: latest.progress,
          createdAt: latest.createdAt.toISOString(),
          compositionHash: latest.compositionHash,
          stale: !!compositionHash && latest.compositionHash !== compositionHash,
        }
      : null,
    activeJobs: jobs,
  };
  memo.set(projectId, { revision: project.revision, state });
  return state;
}

export function forgetProjectState(projectId: string): void {
  memo.delete(projectId);
}
