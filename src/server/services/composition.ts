import { DEFAULT_DESIGN } from "@/core/design/presets";
import { BrandProfileSchema } from "@/core/spec/brand";
import { EMPTY_COMPOSITION_DURATION, type CompositionAsset, type CompositionOverlayClip, type CompositionScene, type CompositionTrack, type StudioVideoProps } from "@/core/spec/composition";
import { normalizeVoiceCuts, parseVoiceMix } from "@/core/timeline/audio-clips";
import { parseAnnotations, parseCrop, parseSpeedSegments } from "@/core/timeline/clip-edits";
import { parseZooms } from "@/core/timeline/overlay-zoom";
import { OVERLAY_PLACEMENTS, type OverlayPlacement } from "@/core/timeline/overlays";
import { DesignSystemSchema } from "@/core/spec/design";
import { EMPTY_SCENE_SPEC, validateSceneSpec, type SpecIssue } from "@/core/spec/scene";
import { TimedWordSchema, type TimedWord } from "@/core/spec/timing";
import { secondsToFrames } from "@/core/timing/frames";
import { db } from "../db";
import { notFound } from "../errors";
import { assertProjectId } from "../ids";
import { fileUrl } from "./projects";
import { getProjectState } from "./state";

/**
 * Builds the single StudioVideoProps input consumed by the Remotion composition — for the GUI
 * Player (media served by the Next.js file route) and for server renders (media served by the
 * worker's private loopback server). Preview and render share this builder, so they never diverge.
 */

export type MediaUrlFn = (relPath: string, version: string) => string;

export interface CompositionIssues {
  invalidScenes: { key: string; issues: SpecIssue[] }[];
  missingAssets: { sceneKey: string; assetId: string }[];
  unapprovedScenes: string[];
  staleTimingScenes: string[];
}

export interface CompositionBuild {
  props: StudioVideoProps;
  compositionHash: string | null;
  revision: number;
  issues: CompositionIssues;
  sceneFrames: { id: string; key: string; name: string; status: string; locked: boolean; startFrame: number; endFrame: number }[];
}

function parseWords(raw: unknown): TimedWord[] {
  if (!Array.isArray(raw)) return [];
  const out: TimedWord[] = [];
  for (const w of raw) {
    const r = TimedWordSchema.safeParse(w);
    if (r.success) out.push(r.data);
  }
  return out;
}

const isVisual = (a: { kind: string; mimeType: string }) => a.mimeType.startsWith("image/") || a.mimeType.startsWith("video/") || a.kind === "logo";

export async function buildComposition(projectId: string, options: { mediaUrl?: MediaUrlFn; overlays?: StudioVideoProps["overlays"] } = {}): Promise<CompositionBuild> {
  assertProjectId(projectId);
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, width: true, height: true, fps: true, design: true, brand: true, mix: true, revision: true, activeVoiceTakeId: true, activeTranscriptId: true },
  });
  if (!project) throw notFound("Project");
  const mediaUrl: MediaUrlFn = options.mediaUrl ?? ((rel, version) => fileUrl(projectId, rel, version));

  const [voice, transcript, scenes, assets, tracks, state, overlayRows] = await Promise.all([
    project.activeVoiceTakeId ? db.voiceTake.findUnique({ where: { id: project.activeVoiceTakeId }, select: { filePath: true, contentHash: true, durationSec: true } }) : null,
    project.activeTranscriptId ? db.transcript.findUnique({ where: { id: project.activeTranscriptId }, select: { words: true } }) : null,
    db.scene.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
      select: { id: true, key: true, name: true, startSec: true, endSec: true, spec: true, status: true, locked: true },
    }),
    db.asset.findMany({
      where: { projectId },
      select: { id: true, kind: true, name: true, filePath: true, mimeType: true, width: true, height: true, durationSec: true, contentHash: true, version: true },
    }),
    db.audioTrack.findMany({ where: { projectId }, orderBy: { order: "asc" }, include: { asset: { select: { filePath: true, contentHash: true, durationSec: true } } } }),
    getProjectState(projectId),
    db.overlayClip.findMany({
      where: { projectId, hidden: false },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: { asset: { select: { filePath: true, contentHash: true, durationSec: true, mimeType: true, width: true, height: true } } },
    }),
  ]);

  const design = DesignSystemSchema.safeParse(project.design);
  const brand = BrandProfileSchema.parse(project.brand ?? {});
  const mix = parseVoiceMix(project.mix);
  const versionOf = (a: { contentHash: string; version?: number }) => `${a.version ?? 1}-${a.contentHash.slice(0, 10)}`;

  const byId = new Map(assets.map((a) => [a.id, a]));
  const assetMap: Record<string, CompositionAsset> = {};
  for (const a of assets) {
    if (!isVisual(a)) continue;
    assetMap[a.id] = { id: a.id, kind: a.kind, name: a.name, src: mediaUrl(a.filePath, versionOf(a)), mimeType: a.mimeType, width: a.width, height: a.height, durationSec: a.durationSec };
  }

  const issues: CompositionIssues = { invalidScenes: [], missingAssets: [], unapprovedScenes: [], staleTimingScenes: [] };
  const compositionScenes: CompositionScene[] = scenes.map((s) => {
    const validation = validateSceneSpec(s.spec);
    const info = state.scenes[s.id];
    if (!validation.ok) issues.invalidScenes.push({ key: s.key, issues: validation.issues });
    for (const assetId of info?.missingAssetIds ?? []) issues.missingAssets.push({ sceneKey: s.key, assetId });
    if (s.status !== "approved") issues.unapprovedScenes.push(s.key);
    if (info?.staleTiming) issues.staleTimingScenes.push(s.key);
    return { id: s.id, key: s.key, name: s.name, start: s.startSec, end: s.endSec, spec: validation.ok ? validation.spec : EMPTY_SCENE_SPEC, valid: validation.ok };
  });

  const compositionTracks: CompositionTrack[] = tracks.map((t) => ({
    id: t.id,
    kind: t.kind === "sfx" || t.kind === "voice" ? t.kind : "music",
    name: t.name,
    src: mediaUrl(t.asset.filePath, t.asset.contentHash.slice(0, 10)),
    startSec: t.startSec,
    trimStartSec: t.trimStartSec,
    durationSec: t.durationSec,
    sourceDurationSec: t.asset.durationSec,
    volume: t.volume,
    fadeInSec: t.fadeInSec,
    fadeOutSec: t.fadeOutSec,
    muted: t.muted,
    loop: t.loop,
    duckUnderVoice: t.duckUnderVoice,
  }));

  const compositionOverlayClips: CompositionOverlayClip[] = overlayRows.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.asset.mimeType.startsWith("video/") ? "video" : "image",
    src: mediaUrl(c.asset.filePath, c.asset.contentHash.slice(0, 10)),
    width: c.asset.width,
    height: c.asset.height,
    sourceDurationSec: c.asset.durationSec,
    placement: (OVERLAY_PLACEMENTS as readonly string[]).includes(c.placement) ? (c.placement as OverlayPlacement) : "fullscreen",
    fit: c.fit === "contain" ? "contain" : "cover",
    startSec: c.startSec,
    durationSec: c.durationSec,
    trimStartSec: c.trimStartSec,
    trimEndSec: c.trimEndSec,
    playbackRate: c.playbackRate,
    endBehavior: c.endBehavior === "loop" ? "loop" : "hold",
    volume: c.volume,
    dim: c.dim,
    opacity: c.opacity,
    fadeInSec: c.fadeInSec,
    fadeOutSec: c.fadeOutSec,
    zooms: parseZooms(c.zooms),
    crop: parseCrop(c.crop),
    speedSegments: parseSpeedSegments(c.speedSegments),
    annotations: parseAnnotations(c.annotations),
    duckUnderVoice: c.duckUnderVoice,
  }));

  const fonts = brand.customFonts.flatMap((f) => {
    const a = byId.get(f.assetId);
    return a ? [{ family: f.family, src: mediaUrl(a.filePath, versionOf(a)) }] : [];
  });

  const sceneEnd = scenes.length ? Math.max(...scenes.map((s) => s.endSec)) : 0;
  const durationSec = Math.max(state.durationSec ?? 0, sceneEnd) || EMPTY_COMPOSITION_DURATION;

  const props: StudioVideoProps = {
    projectId,
    width: project.width,
    height: project.height,
    fps: project.fps,
    durationSec,
    design: design.success ? design.data : DEFAULT_DESIGN,
    brand: { brandName: brand.brandName, logoAssetId: brand.logoAssetId },
    scenes: compositionScenes,
    words: transcript ? parseWords(transcript.words) : [],
    voice: voice
      ? { src: mediaUrl(voice.filePath, voice.contentHash.slice(0, 12)), volume: mix.volume, muted: mix.muted, durationSec: voice.durationSec, cuts: normalizeVoiceCuts(mix.cuts, voice.durationSec) }
      : null,
    tracks: compositionTracks,
    overlayClips: compositionOverlayClips,
    assets: assetMap,
    fonts,
    ...(options.overlays ? { overlays: options.overlays } : {}),
  };

  return {
    props,
    compositionHash: state.compositionHash,
    revision: project.revision,
    issues,
    sceneFrames: scenes.map((s) => ({
      id: s.id,
      key: s.key,
      name: s.name,
      status: s.status,
      locked: s.locked,
      startFrame: secondsToFrames(s.startSec, project.fps),
      endFrame: secondsToFrames(s.endSec, project.fps),
    })),
  };
}
