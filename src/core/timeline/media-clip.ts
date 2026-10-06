import { isGroup, type ElementOf, type SceneElement, type SceneSpec } from "../spec/scene";
import { resolveShotWindows, resolveTrigger, type TriggerContext } from "../spec/triggers";
import { MIN_ANNOTATION_SEC, clipSecForSource, croppedAspect, sourceSecAt, splitClipTimes } from "./clip-edits";
import { findElementAt, replaceElementAt } from "./element-layout";
import { trimmedLengthSec, type OverlayEndBehavior } from "./overlays";

/**
 * Video speed and the images and videos placed inside scenes. Pure helpers shared by the Remotion
 * engine, the server, the CLI and the scene media panel and lane, so the times they show are the times
 * that render.
 */

export const MIN_PLAYBACK_RATE = 0.1;
export const MAX_PLAYBACK_RATE = 4;
export const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** Shortest time media can be on screen after a timeline drag, in seconds. */
export const MIN_SCENE_MEDIA_SEC = 0.2;

/** Seconds an exit animation takes when the spec doesn't say (used to find when media is gone). */
export const DEFAULT_EXIT_SEC = 0.4;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return r3(Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate)));
}

/** Speed at which `partSec` seconds of source play in exactly `onScreenSec` (clamped to the allowed range). */
export function fitPlaybackRate(partSec: number, onScreenSec: number): number {
  if (!(partSec > 0) || !(onScreenSec > 0)) return 1;
  return clampPlaybackRate(partSec / onScreenSec);
}

export type SceneMediaElement = ElementOf<"image"> | ElementOf<"video">;

/** Where a media element lives in a spec: scene-level (`shotId` null), inside a shot, or inside a group. */
export interface SceneMediaRef {
  shotId: string | null;
  index: number;
  child?: number;
}

export interface SceneMediaItem {
  ref: SceneMediaRef;
  element: SceneMediaElement;
  /** Absolute seconds the media appears (its video starts playing and its zoom clock starts). */
  appearSec: number;
  /** Absolute seconds it is gone (its exit finished, or the end of its scene or shot). */
  goneSec: number;
  /** Absolute bounds of its scene, or of its shot: the window it can be moved in. */
  segmentStartSec: number;
  segmentEndSec: number;
}

/** Stable key of a media element in a scene: `${sceneId}:${shotId}:${index}`. */
export const sceneMediaKey = (sceneId: string, ref: SceneMediaRef) => `${sceneId}:${ref.shotId ?? ""}:${ref.index}${ref.child === undefined ? "" : `:${ref.child}`}`;

export const isSceneMedia = (element: SceneElement): element is SceneMediaElement => element.type === "image" || element.type === "video";

/** Image and video elements of a scene with the seconds they appear and disappear, as the engine plays them. */
export function listSceneMedia(spec: SceneSpec, ctx: TriggerContext): SceneMediaItem[] {
  const base: TriggerContext = { words: ctx.words, sceneStart: ctx.sceneStart, sceneEnd: ctx.sceneEnd };
  const items: SceneMediaItem[] = [];
  const collect = (elements: SceneElement[], shotId: string | null, segment: TriggerContext) => {
    const segmentStart = segment.shotStart ?? segment.sceneStart;
    const segmentEnd = segment.shotEnd ?? segment.sceneEnd;
    const flat = elements.flatMap((element, index) => (isGroup(element) ? element.children.map((child, at) => ({ element: child as SceneElement, index, child: at as number | undefined })) : [{ element, index, child: undefined as number | undefined }]));
    flat.forEach(({ element, index, child }) => {
      if (!isSceneMedia(element)) return;
      // Same rule as the renderer: with an enter trigger (or inside a shot) the media starts when it enters, otherwise at the scene start.
      const appear = element.enter?.at || shotId ? resolveTrigger(element.enter?.at, segment, "sceneStart").time + (element.enter?.delay ?? 0) : ctx.sceneStart;
      const exit = element.exit && element.exit.type !== "none" && element.exit.at ? resolveTrigger(element.exit.at, segment, "sceneEnd").time + (element.exit.duration ?? DEFAULT_EXIT_SEC) : segmentEnd;
      const appearSec = r3(Math.min(Math.max(appear, ctx.sceneStart), segmentEnd));
      items.push({
        ref: { shotId, index, ...(child === undefined ? {} : { child }) },
        element,
        appearSec,
        goneSec: r3(Math.max(appearSec, Math.min(exit, segmentEnd))),
        segmentStartSec: r3(segmentStart),
        segmentEndSec: r3(segmentEnd),
      });
    });
  };
  collect(spec.elements, null, base);
  const windows = resolveShotWindows(spec, ctx);
  (spec.shots ?? []).forEach((shot, i) => collect(shot.elements, shot.id, { ...base, shotStart: windows[i].start, shotEnd: windows[i].end }));
  return items;
}

export function findSceneMedia(spec: SceneSpec, ref: SceneMediaRef): SceneMediaElement | null {
  const element = findElementAt(spec, ref);
  return element && isSceneMedia(element) ? element : null;
}

export function replaceSceneMedia(spec: SceneSpec, ref: SceneMediaRef, element: SceneMediaElement): SceneSpec {
  return replaceElementAt(spec, ref, element);
}

/** “video_1”, or “shot_b/#2” for media without an id. */
export function sceneMediaName(item: Pick<SceneMediaItem, "ref" | "element">): string {
  return item.element.id ?? `${item.ref.shotId ? `${item.ref.shotId}/` : ""}#${item.ref.index + 1}`;
}

/** A scene video's trim, speed and end behaviour in overlay terms (source seconds; images play nothing). */
export function sceneVideoTiming(element: SceneMediaElement, sourceDurationSec: number | null): {
  trimStartSec: number;
  trimEndSec: number | null;
  playbackRate: number;
  endBehavior: OverlayEndBehavior;
  trimmedLengthSec: number | null;
} {
  if (element.type !== "video") return { trimStartSec: 0, trimEndSec: null, playbackRate: 1, endBehavior: "hold", trimmedLengthSec: null };
  const trimStartSec = element.startFrom ?? 0;
  const trimEndSec = sceneVideoEnd(element);
  const playbackRate = element.playbackRate ?? 1;
  const end = trimEndSec ?? sourceDurationSec;
  return {
    trimStartSec,
    trimEndSec,
    playbackRate,
    endBehavior: element.loop ? "loop" : "hold",
    // Speed ramps and freeze frames change how long the trimmed part plays.
    trimmedLengthSec: element.speedSegments?.length
      ? end !== null
        ? r3(clipSecForSource({ trimStartSec, playbackRate, speedSegments: element.speedSegments }, end))
        : null
      : trimmedLengthSec({ kind: "video", trimStartSec, trimEndSec, playbackRate, sourceDurationSec }),
  };
}

type MediaClipFields = Partial<Pick<ElementOf<"video">, "zooms" | "annotations" | "speedSegments" | "startFrom" | "endAt">>;

/**
 * Splits an image or video's own timeline at `atClipSec` seconds after it appears; `resumeClipSec`
 * (≥ at) cuts out the section in between. Zooms, annotations and speed segments stay on their picture:
 * the first part keeps what plays before the split (a video's out-point moves there), the second part
 * starts where the picture resumes. Only the changed fields are returned (empty lists as undefined).
 */
export function splitMediaClip(element: SceneMediaElement, atClipSec: number, resumeClipSec: number, sourceDurationSec: number | null): { first: MediaClipFields; second: MediaClipFields } {
  const video = element.type === "video" ? element : null;
  const remap = { trimStartSec: video?.startFrom ?? 0, playbackRate: video?.playbackRate ?? 1, speedSegments: video?.speedSegments ?? [] };
  const sourceEnd = video ? (sceneVideoEnd(video) ?? sourceDurationSec) : null;
  const sourceAt = (clipSec: number) => r3(sourceEnd !== null ? Math.min(sourceSecAt(remap, clipSec), sourceEnd - 0.05) : sourceSecAt(remap, clipSec));
  const zooms = splitClipTimes(element.zooms ?? [], atClipSec, resumeClipSec);
  const marks = splitClipTimes(element.annotations ?? [], atClipSec, resumeClipSec, MIN_ANNOTATION_SEC);
  const speed = splitClipTimes(video?.speedSegments ?? [], atClipSec, resumeClipSec);
  const list = <T>(items: T[]) => (items.length ? items : undefined);
  return {
    first: { zooms: list(zooms.before), annotations: list(marks.before), ...(video ? { endAt: sourceAt(atClipSec), speedSegments: list(speed.before) } : {}) },
    second: { zooms: list(zooms.after), annotations: list(marks.after), ...(video ? { startFrom: sourceAt(resumeClipSec), speedSegments: list(speed.after) } : {}) },
  };
}

/** The out-point of a scene video (null = the end of the source; an out-point before the in-point is ignored). */
export function sceneVideoEnd(element: ElementOf<"video">): number | null {
  const start = element.startFrom ?? 0;
  return element.endAt !== undefined && element.endAt > start + 0.05 ? element.endAt : null;
}

export type SceneMediaDragEdge = "move" | "start" | "end";

export interface SceneMediaTiming {
  appearSec: number;
  goneSec: number;
  /** A video's in-point (0 for images). */
  trimStartSec: number;
}

/**
 * Applies a timeline drag to media inside a scene. It never leaves its scene (or shot). Moving keeps
 * its length; the left edge trims the in-point, and a video's picture stays anchored in time, so its
 * trim start moves with the edge; the right edge sets when it disappears.
 */
export function dragSceneMedia(
  item: Pick<SceneMediaItem, "appearSec" | "goneSec" | "segmentStartSec" | "segmentEndSec">,
  video: { trimStartSec: number; playbackRate: number } | null,
  edge: SceneMediaDragEdge,
  deltaSec: number,
): SceneMediaTiming {
  const { appearSec: appear, goneSec: gone, segmentStartSec: from, segmentEndSec: to } = item;
  const trim = video?.trimStartSec ?? 0;
  const rate = video?.playbackRate || 1;
  if (edge === "move") {
    const d = Math.max(from - appear, Math.min(to - gone, deltaSec));
    return { appearSec: r3(appear + d), goneSec: r3(gone + d), trimStartSec: trim };
  }
  if (edge === "start") {
    let d = Math.max(from - appear, Math.min(gone - MIN_SCENE_MEDIA_SEC - appear, deltaSec));
    if (video) d = Math.max(d, -trim / rate);
    return { appearSec: r3(appear + d), goneSec: gone, trimStartSec: video ? r3(trim + d * rate) : trim };
  }
  return { appearSec: appear, goneSec: r3(Math.max(appear + MIN_SCENE_MEDIA_SEC, Math.min(to, gone + deltaSec))), trimStartSec: trim };
}

/** Width ÷ height of a media element's box on screen (the engine's sizing, including its crop). */
export function sceneMediaAspect(element: SceneMediaElement, frame: { width: number; height: number }, assetAspect: number | null): number {
  if (element.type === "image" && element.mask === "circle") return 1;
  const aspect = assetAspect && assetAspect > 0 ? croppedAspect(assetAspect, element.crop) : 16 / 9;
  let w = element.width !== undefined ? (element.width / 100) * frame.width : undefined;
  let h = element.height !== undefined ? (element.height / 100) * frame.height : undefined;
  if (w === undefined && h === undefined) w = frame.width * (frame.height > frame.width ? 0.86 : 0.6);
  if (w === undefined) w = (h as number) * aspect;
  if (h === undefined) h = w / aspect;
  return w / h;
}
