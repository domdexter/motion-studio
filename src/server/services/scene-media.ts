import { z } from "zod";
import { allSpecElements, validateSceneSpec, type ElementOf, type SceneElement } from "@/core/spec/scene";
import { AnnotationSchema, CropSchema, MAX_ANNOTATIONS, MAX_SPEED_SEGMENTS, SpeedSegmentSchema, normalizeAnnotations, normalizeCrop, normalizeSpeedSegments, shiftClipTimes } from "@/core/timeline/clip-edits";
import { SCENE_MEDIA_PLACEMENTS, scenePlacementLayout, type SceneMediaPlacement } from "@/core/timeline/element-layout";
import { DEFAULT_EXIT_SEC, MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE, MIN_SCENE_MEDIA_SEC, findSceneMedia, replaceSceneMedia, sceneMediaName, splitMediaClip, type SceneMediaElement } from "@/core/timeline/media-clip";
import { MAX_ZOOMS_PER_CLIP, OverlayZoomSchema, normalizeZooms, shiftZoomsForTrim } from "@/core/timeline/overlay-zoom";
import { keyframesAfterRetime, segmentOfElement } from "@/core/timeline/scene-restructure";
import { db } from "../db";
import { AppError, notFound } from "../errors";
import { assertProjectId } from "../ids";
import type { Actor } from "./mutation";
import { findScene, loadWords, sceneDto, updateScene, type SceneDto } from "./scenes";

/**
 * Places an image or video asset into a scene's spec (the scene keeps its audio-owned timing; the
 * media plays inside it) and edits it afterwards: trim, speed, loop or hold, fit, darken, clip audio
 * and zoom regions. Every change is a normal scene edit: new scene version, approval reset, undoable.
 */

export const MEDIA_PLACEMENTS = SCENE_MEDIA_PLACEMENTS;
export type MediaPlacement = SceneMediaPlacement;

export const MEDIA_PLACEMENT_LABELS: Record<MediaPlacement, string> = {
  background: "Background — full frame behind the graphics",
  fullscreen: "Full frame — a cutaway over everything",
  framed: "Framed — centered card",
  pip: "Picture-in-picture — corner",
};

const SourceSec = z.number().min(0).max(24 * 3600);

export const InsertMediaSchema = z
  .object({
    assetId: z.string().min(1).max(80),
    placement: z.enum(MEDIA_PLACEMENTS).default("background"),
    fit: z.enum(["cover", "contain"]).optional(),
    /** Seconds into the source clip where playback starts (trim). */
    startFrom: SourceSec.optional(),
    /** Seconds into the source clip where playback ends (default: the end of the clip). */
    endAt: SourceSec.optional(),
    playbackRate: z.number().min(MIN_PLAYBACK_RATE).max(MAX_PLAYBACK_RATE).optional(),
    loop: z.boolean().optional(),
    volume: z.number().min(0).max(1).optional(),
    /** Seconds after the scene starts. */
    appearAt: z.number().min(0).max(3600).optional(),
    disappearAt: z.number().min(0).max(3600).optional(),
    /** Darkening overlay 0..0.9 (keeps text readable over busy footage). */
    dim: z.number().min(0).max(0.9).optional(),
  })
  .strict();

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function assertTrim(sourceSec: number | null, start: number, end: number | null) {
  if (sourceSec && start >= sourceSec - 0.05) throw new AppError("VALIDATION", `Trim start must be before the end of the clip (${sourceSec.toFixed(2)}s).`);
  if (end === null) return;
  if (sourceSec && end > sourceSec + 0.05) throw new AppError("VALIDATION", `Trim end can't be after the end of the clip (${sourceSec.toFixed(2)}s).`);
  if (end <= start + 0.05) throw new AppError("VALIDATION", "Trim end must be after trim start.");
}

/** An out-point at the end of the source is stored as “no out-point”. */
const storedEnd = (end: number | null, sourceSec: number | null) => (end === null || (sourceSec && Math.abs(end - sourceSec) < 0.02) ? undefined : r3(end));

export async function insertMediaIntoScene(
  projectId: string,
  sceneIdOrKey: string,
  input: z.input<typeof InsertMediaSchema>,
  actor: Actor,
): Promise<{ scene: SceneDto; elementId: string }> {
  assertProjectId(projectId);
  const data = InsertMediaSchema.parse(input);
  const [project, asset, scene] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { width: true, height: true } }),
    db.asset.findFirst({ where: { id: data.assetId, projectId } }),
    findScene(db, projectId, sceneIdOrKey),
  ]);
  if (!project) throw notFound("Project");
  if (!asset) throw notFound("Asset");
  const isVideo = asset.mimeType.startsWith("video/");
  if (!isVideo && !asset.mimeType.startsWith("image/")) {
    throw new AppError("VALIDATION", `“${asset.name}” is not an image or video.`, { hint: "Audio goes on the timeline from the Audio page." });
  }
  if (scene.locked) throw new AppError("LOCKED", `${scene.key.replace("scene_", "Scene ")} is locked. Unlock it before adding media.`);
  const current = validateSceneSpec(scene.spec);
  if (!current.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it before adding media.`, { details: current.issues });

  const sceneDuration = Math.max(0, scene.endSec - scene.startSec);
  const appearAt = data.appearAt && data.appearAt > 0 ? data.appearAt : undefined;
  const disappearAt = data.disappearAt;
  if (appearAt !== undefined && appearAt >= sceneDuration) throw new AppError("VALIDATION", `Appear time must be within the scene (0–${sceneDuration.toFixed(2)}s).`);
  if (disappearAt !== undefined && (disappearAt <= (appearAt ?? 0) || disappearAt > sceneDuration)) {
    throw new AppError("VALIDATION", `Disappear time must be after it appears and no later than ${sceneDuration.toFixed(2)}s.`);
  }
  if (isVideo) assertTrim(asset.durationSec, data.startFrom ?? 0, data.endAt ?? null);

  const type = isVideo ? "video" : "image";
  const taken = new Set(current.spec.elements.map((e) => e.id).filter(Boolean));
  let n = 1;
  while (taken.has(`${type}_${n}`)) n++;
  const id = `${type}_${n}`;

  // Size: full-frame placements cover the frame; boxed ones keep the asset's aspect ratio.
  const full = data.placement === "background" || data.placement === "fullscreen";
  const layout = scenePlacementLayout(data.placement, project, asset.width && asset.height ? asset.width / asset.height : null);

  const enter = {
    type: full ? ("fade" as const) : data.placement === "framed" ? ("scale" as const) : ("rise" as const),
    duration: full ? 0.5 : 0.6,
    ...(appearAt !== undefined ? { at: { type: "sceneTime" as const, seconds: r2(appearAt) } } : {}),
  };
  const exit = disappearAt !== undefined && disappearAt < sceneDuration - 0.05 ? { type: "fade" as const, duration: 0.4, at: { type: "sceneTime" as const, seconds: r2(Math.max(0, disappearAt - 0.4)) } } : undefined;
  const dim = data.dim ?? (data.placement === "background" ? 0.35 : 0);
  const overlay = dim > 0 ? { color: "#000000", opacity: r2(dim) } : undefined;
  const boxStyle = full ? {} : { radius: 24, style: { shadow: "deep" as const } };

  let element: SceneElement;
  if (isVideo) {
    const visible = (disappearAt ?? sceneDuration) - (appearAt ?? 0);
    const start = data.startFrom ?? 0;
    const end = data.endAt ?? asset.durationSec;
    const playable = end ? (end - start) / (data.playbackRate ?? 1) : null;
    const endAt = storedEnd(data.endAt ?? null, asset.durationSec);
    element = {
      id,
      type: "video",
      assetId: asset.id,
      ...layout,
      ...boxStyle,
      fit: data.fit ?? "cover",
      ...(start ? { startFrom: r3(start) } : {}),
      ...(endAt !== undefined ? { endAt } : {}),
      ...(data.playbackRate && data.playbackRate !== 1 ? { playbackRate: data.playbackRate } : {}),
      ...(data.volume ? { volume: r2(data.volume) } : {}),
      loop: data.loop ?? (playable !== null && playable < visible),
      ...(overlay ? { overlay } : {}),
      enter,
      ...(exit ? { exit } : {}),
    };
  } else {
    element = {
      id,
      type: "image",
      assetId: asset.id,
      ...layout,
      ...boxStyle,
      fit: data.fit ?? "cover",
      ...(full ? { kenBurns: { from: 1, to: 1.08 } } : {}),
      ...(overlay ? { overlay } : {}),
      enter,
      ...(exit ? { exit } : {}),
    };
  }

  const spec = { ...current.spec, elements: data.placement === "background" ? [element, ...current.spec.elements] : [...current.spec.elements, element] };
  const validated = validateSceneSpec(spec);
  if (!validated.ok) throw new AppError("VALIDATION", "Could not place the media in this scene.", { details: validated.issues });

  await db.asset.updateMany({ where: { id: asset.id, projectId, sceneId: null }, data: { sceneId: scene.id } });
  const updated = await updateScene(projectId, scene.id, { spec: validated.spec }, actor, {
    message: `Added ${type} “${asset.name}” (${data.placement}${appearAt !== undefined ? ` from ${r2(appearAt)}s` : ""})`,
    historyLabel: `add ${type} to ${scene.key}`,
  });
  return { scene: updated, elementId: id };
}

export const SceneMediaPatchSchema = z
  .object({
    fit: z.enum(["cover", "contain"]),
    /** Trim in: seconds into the source clip. */
    startFrom: SourceSec,
    /** Trim out: seconds into the source clip (null = the end of the clip). */
    endAt: SourceSec.nullable(),
    playbackRate: z.number().min(MIN_PLAYBACK_RATE).max(MAX_PLAYBACK_RATE),
    /** Loop the trimmed part (otherwise it holds its last frame). */
    loop: z.boolean(),
    volume: z.number().min(0).max(1),
    /** Lower the clip's audio while the narrator speaks. */
    duckUnderVoice: z.boolean(),
    /** Darkening overlay 0..0.9. */
    dim: z.number().min(0).max(0.9),
    /** When it appears, in seconds into the scene (a timeline move or left-edge trim). */
    appearAt: z.number().min(0).max(3600),
    /** When it's gone, in seconds into the scene, or null to stay until the end of its scene or shot. */
    disappearAt: z.number().min(0).max(3600).nullable(),
    /** Zoom regions in seconds from when the media appears; replaces the whole list. */
    zooms: z.array(OverlayZoomSchema).max(MAX_ZOOMS_PER_CLIP),
    /** Cut from the edges (fractions of the media), or null for none. */
    crop: CropSchema.nullable(),
    /** Videos: speed ramps and freeze frames in seconds from when it appears (rate 0 freezes); replaces the whole list. */
    speedSegments: z.array(SpeedSegmentSchema).max(MAX_SPEED_SEGMENTS),
    /** Blur, boxes, arrows, labels, spotlights and click ripples in seconds from when it appears; replaces the whole list. */
    annotations: z.array(AnnotationSchema).max(MAX_ANNOTATIONS),
  })
  .partial()
  .strict();
export type SceneMediaPatch = z.input<typeof SceneMediaPatchSchema>;

export const UpdateSceneMediaSchema = z
  .object({
    /** Where the media is: scene-level (shotId null) or inside a shot, by element index. */
    ref: z.object({ shotId: z.string().min(1).max(64).nullable(), index: z.number().int().min(0).max(1000) }).strict(),
    /** The asset the element is expected to show, so an edit never lands on an element that changed underneath. */
    assetId: z.string().min(1).max(80).optional(),
    patch: SceneMediaPatchSchema,
  })
  .strict();

const VIDEO_ONLY = ["startFrom", "endAt", "playbackRate", "loop", "volume"] as const;

export async function updateSceneMedia(
  projectId: string,
  sceneIdOrKey: string,
  input: z.input<typeof UpdateSceneMediaSchema>,
  actor: Actor,
): Promise<{ scene: SceneDto; element: SceneMediaElement | null }> {
  assertProjectId(projectId);
  const { ref, assetId, patch } = UpdateSceneMediaSchema.parse(input);
  const scene = await findScene(db, projectId, sceneIdOrKey);
  if (scene.locked) throw new AppError("LOCKED", `${scene.key.replace("scene_", "Scene ")} is locked. Unlock it before editing its media.`);
  const current = validateSceneSpec(scene.spec);
  if (!current.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it before editing its media.`, { details: current.issues });
  const element = findSceneMedia(current.spec, ref);
  if (!element || (assetId && element.assetId !== assetId)) {
    throw new AppError("PRECONDITION", `That image or video is no longer at this place in ${scene.key} — the scene changed.`, { hint: "Reload the scene and pick the media again." });
  }
  const keys = Object.keys(patch);
  if (!keys.length) return { scene: sceneDto(scene), element };
  const isVideo = element.type === "video";
  const videoOnly = VIDEO_ONLY.filter((k) => patch[k] !== undefined);
  if (!isVideo && videoOnly.length) throw new AppError("VALIDATION", `${videoOnly.join(", ")} only apply to videos.`);

  const asset = await db.asset.findFirst({ where: { id: element.assetId, projectId }, select: { name: true, durationSec: true } });
  const next: Record<string, unknown> = { ...element };
  const set = (key: string, value: unknown) => {
    if (value === undefined) delete next[key];
    else next[key] = value;
  };
  if (patch.fit !== undefined) set("fit", patch.fit);
  if (isVideo) {
    const video = element as ElementOf<"video">;
    const sourceSec = asset?.durationSec ?? null;
    const oldStart = video.startFrom ?? 0;
    const start = r3(patch.startFrom ?? oldStart);
    const end = patch.endAt !== undefined ? (patch.endAt === null ? null : r3(patch.endAt)) : (video.endAt ?? null);
    if (patch.startFrom !== undefined || patch.endAt !== undefined) {
      assertTrim(sourceSec, start, end);
      set("startFrom", start > 0 ? start : undefined);
      set("endAt", storedEnd(end, sourceSec));
    }
    const rate = patch.playbackRate ?? video.playbackRate ?? 1;
    if (patch.playbackRate !== undefined) set("playbackRate", Math.abs(patch.playbackRate - 1) < 0.0005 ? undefined : r3(patch.playbackRate));
    if (patch.loop !== undefined) set("loop", patch.loop);
    if (patch.volume !== undefined) set("volume", patch.volume > 0 ? r2(patch.volume) : undefined);
    if (patch.duckUnderVoice !== undefined) set("duckUnderVoice", patch.duckUnderVoice || undefined);
    // A new in-point moves the picture under the frame, so zooms and annotations follow the picture they were drawn on.
    if (patch.zooms === undefined && patch.startFrom !== undefined && video.zooms?.length) {
      const shifted = shiftZoomsForTrim(video.zooms, oldStart, start, rate);
      set("zooms", shifted.length ? shifted : undefined);
    }
    if (patch.annotations === undefined && patch.startFrom !== undefined && video.annotations?.length) {
      const shifted = shiftClipTimes(video.annotations, (start - oldStart) / rate);
      set("annotations", shifted.length ? shifted : undefined);
    }
  }
  if (patch.dim !== undefined) set("overlay", patch.dim > 0 ? { color: element.overlay?.color ?? "#000000", opacity: r2(patch.dim) } : undefined);
  if (patch.zooms !== undefined) {
    const zooms = normalizeZooms(patch.zooms);
    set("zooms", zooms.length ? zooms : undefined);
  }
  if (patch.crop !== undefined) set("crop", normalizeCrop(patch.crop) ?? undefined);
  if (patch.speedSegments !== undefined) {
    if (!isVideo && patch.speedSegments.length) throw new AppError("VALIDATION", "Speed ramps and freeze frames only apply to videos.");
    const segments = normalizeSpeedSegments(patch.speedSegments);
    set("speedSegments", segments.length ? segments : undefined);
  }
  if (patch.annotations !== undefined) {
    const annotations = normalizeAnnotations(patch.annotations);
    set("annotations", annotations.length ? annotations : undefined);
  }
  // Timeline moves and trims: exact scene times replace whatever triggered the entrance and exit.
  const sceneDuration = Math.max(0, scene.endSec - scene.startSec);
  if (patch.appearAt !== undefined) {
    if (patch.appearAt >= sceneDuration - 0.05) throw new AppError("VALIDATION", `It must appear before the end of ${scene.key} (${sceneDuration.toFixed(2)}s).`);
    const { delay: _delay, ...enter } = element.enter ?? { type: "fade" as const, duration: 0.3 };
    set("enter", { ...enter, at: { type: "sceneTime", seconds: r3(patch.appearAt) } });
  }
  if (patch.disappearAt !== undefined) {
    if (patch.disappearAt === null || patch.disappearAt >= sceneDuration - 0.02) set("exit", undefined);
    else {
      if (patch.appearAt !== undefined && patch.disappearAt <= patch.appearAt + 0.1) throw new AppError("VALIDATION", "It must disappear after it appears.");
      const exit = element.exit && element.exit.type !== "none" ? element.exit : { type: "fade" as const, duration: DEFAULT_EXIT_SEC };
      const onScreen = patch.appearAt !== undefined ? patch.disappearAt - patch.appearAt : Infinity;
      const duration = r3(Math.min(exit.duration ?? DEFAULT_EXIT_SEC, onScreen / 2));
      set("exit", { ...exit, duration, at: { type: "sceneTime", seconds: r3(Math.max(0, patch.disappearAt - duration)) } });
    }
  }
  // Keyframes count from when it appears: a timeline move takes them along, a trim keeps them where they were in the scene.
  if (element.keyframes?.length && (patch.appearAt !== undefined || patch.disappearAt !== undefined)) {
    const segment = segmentOfElement(current.spec, { start: scene.startSec, end: scene.endSec }, ref.shotId, await loadWords(db, projectId));
    set("keyframes", keyframesAfterRetime(element, next as SceneMediaElement, segment));
  }

  const validated = validateSceneSpec(replaceSceneMedia(current.spec, ref, next as SceneMediaElement));
  if (!validated.ok) throw new AppError("VALIDATION", "Could not apply that change to the media.", { details: validated.issues });

  const retimed = keys.some((k) => k === "appearAt" || k === "disappearAt");
  const what = keys.some((k) => k === "startFrom" || k === "endAt") ? "trim" : retimed ? "retime" : keys.every((k) => k === "zooms") ? "zoom" : keys.every((k) => k === "playbackRate") ? "speed" : "edit";
  const label = asset ? `“${asset.name}”` : sceneMediaName({ ref, element });
  const message = {
    trim: `Trimmed ${element.type} ${label}`,
    retime: `Retimed ${element.type} ${label} on the timeline`,
    zoom: `Changed the zoom regions of ${element.type} ${label}`,
    speed: `Set ${element.type} ${label} to ${r3(rate(patch, element))}×`,
    edit: `Edited ${keys.join(", ")} of ${element.type} ${label}`,
  }[what];
  const updated = await updateScene(projectId, scene.id, { spec: validated.spec }, actor, {
    message,
    historyLabel: `${what} ${element.type} ${label} in ${scene.key}`,
    // Repeated tweaks of the same panel control merge into one undo step; trims and zoom edits are one step each.
    coalesceKey: what === "edit" || what === "speed" ? `scene-media:${scene.id}:${ref.shotId ?? ""}:${ref.index}:${[...keys].sort().join(",")}` : undefined,
  });
  const spec = validateSceneSpec(updated.spec);
  return { scene: updated, element: spec.ok ? findSceneMedia(spec.spec, ref) : null };
}

const rate = (patch: z.output<typeof SceneMediaPatchSchema>, element: SceneMediaElement) => patch.playbackRate ?? (element.type === "video" ? (element.playbackRate ?? 1) : 1);

export const SplitSceneMediaSchema = z
  .object({
    ref: z.object({ shotId: z.string().min(1).max(64).nullable(), index: z.number().int().min(0).max(1000) }).strict(),
    assetId: z.string().min(1).max(80).optional(),
    /** Video second to split at. */
    atSec: z.number().min(0).max(24 * 3600),
    /** Cut out the section up to this video second; the rest appears at `atSec`. */
    removeUntilSec: z.number().min(0).max(24 * 3600).optional(),
    /** When the media appears and is gone, in video seconds (from the scene media lane or `scene:media:list`). */
    appearSec: z.number().min(0).max(24 * 3600),
    goneSec: z.number().min(0).max(24 * 3600),
  })
  .strict();

/**
 * Splits an image or video in a scene into two elements at a video second, or cuts out a section: the
 * second part appears where the section started. Zooms, annotations and speed segments stay on their
 * picture; the second part gets its own element id.
 */
export async function splitSceneMedia(projectId: string, sceneIdOrKey: string, input: z.input<typeof SplitSceneMediaSchema>, actor: Actor): Promise<{ scene: SceneDto }> {
  assertProjectId(projectId);
  const { ref, assetId, atSec, removeUntilSec, appearSec, goneSec } = SplitSceneMediaSchema.parse(input);
  const scene = await findScene(db, projectId, sceneIdOrKey);
  if (scene.locked) throw new AppError("LOCKED", `${scene.key.replace("scene_", "Scene ")} is locked. Unlock it before editing its media.`);
  const current = validateSceneSpec(scene.spec);
  if (!current.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it before editing its media.`, { details: current.issues });
  const element = findSceneMedia(current.spec, ref);
  if (!element || (assetId && element.assetId !== assetId)) {
    throw new AppError("PRECONDITION", `That image or video is no longer at this place in ${scene.key} — the scene changed.`, { hint: "Reload the scene and pick the media again." });
  }
  const at = r3(atSec - appearSec);
  const resume = r3((removeUntilSec ?? atSec) - appearSec);
  if (at < MIN_SCENE_MEDIA_SEC || resume < at || resume > goneSec - appearSec - MIN_SCENE_MEDIA_SEC) {
    throw new AppError("VALIDATION", `Split inside the time it's on screen (${appearSec.toFixed(2)}–${goneSec.toFixed(2)}s), at least ${MIN_SCENE_MEDIA_SEC}s from its edges.`);
  }

  const asset = await db.asset.findFirst({ where: { id: element.assetId, projectId }, select: { name: true, durationSec: true } });
  const parts = splitMediaClip(element, at, resume, asset?.durationSec ?? null);
  const sceneTime = (videoSec: number) => ({ type: "sceneTime" as const, seconds: r3(Math.max(0, videoSec - scene.startSec)) });
  const QUICK = 0.04;

  const taken = new Set(allSpecElements(current.spec).map(({ element: e }) => e.id).filter(Boolean));
  const baseId = element.id ?? element.type;
  let n = 2;
  while (taken.has(`${baseId}_${n}`)) n++;
  const removed = resume - at;
  const exit = element.exit && element.exit.type !== "none" && element.exit.at ? element.exit : null;
  const first = JSON.parse(JSON.stringify({ ...element, ...parts.first, exit: { type: "fade", duration: QUICK, at: sceneTime(atSec - QUICK) } })) as SceneMediaElement;
  const second = JSON.parse(
    JSON.stringify({
      ...element,
      id: `${baseId}_${n}`,
      enter: { type: "fade", duration: QUICK, at: sceneTime(atSec) },
      ...parts.second,
      // A cut-out section makes the rest end earlier by the same amount.
      exit: exit ? { ...exit, at: sceneTime(Math.max(atSec + 0.1, goneSec - removed - (exit.duration ?? DEFAULT_EXIT_SEC))) } : element.exit,
    }),
  ) as SceneMediaElement;

  const insert = (elements: SceneElement[]) => elements.flatMap((e, i) => (i === ref.index ? [first, second] : [e]));
  const spec = ref.shotId === null ? { ...current.spec, elements: insert(current.spec.elements) } : { ...current.spec, shots: (current.spec.shots ?? []).map((s) => (s.id === ref.shotId ? { ...s, elements: insert(s.elements) } : s)) };
  const validated = validateSceneSpec(spec);
  if (!validated.ok) throw new AppError("VALIDATION", "Could not split that media.", { details: validated.issues });
  const label = asset ? `“${asset.name}”` : sceneMediaName({ ref, element });
  const cut = removeUntilSec !== undefined;
  const updated = await updateScene(projectId, scene.id, { spec: validated.spec }, actor, {
    message: cut ? `Cut ${removed.toFixed(2)}s out of ${element.type} ${label}` : `Split ${element.type} ${label} at ${atSec.toFixed(2)}s`,
    historyLabel: cut ? `cut a section from ${element.type} ${label} in ${scene.key}` : `split ${element.type} ${label} in ${scene.key}`,
  });
  return { scene: updated };
}
