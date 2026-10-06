/**
 * Overlay track: images and videos drawn above the scenes, placed in absolute video time and
 * independent of scene boundaries. Pure helpers shared by the Remotion engine, the server and the
 * timeline editor, so a drag in the GUI means exactly what renders.
 */

export const OVERLAY_PLACEMENTS = ["fullscreen", "framed", "pip"] as const;
export type OverlayPlacement = (typeof OVERLAY_PLACEMENTS)[number];

export const OVERLAY_PLACEMENT_LABELS: Record<OverlayPlacement, string> = {
  fullscreen: "Full frame",
  framed: "Framed",
  pip: "Picture-in-picture",
};

/** What a video does when it stays on screen longer than its trimmed part. */
export const OVERLAY_END_BEHAVIORS = ["hold", "loop"] as const;
export type OverlayEndBehavior = (typeof OVERLAY_END_BEHAVIORS)[number];

/** Shortest clip the timeline allows, in seconds. */
export const MIN_OVERLAY_SEC = 0.2;

/** Default on-screen length of an image overlay, in seconds. */
export const DEFAULT_IMAGE_OVERLAY_SEC = 4;

export interface OverlayTiming {
  kind: "image" | "video";
  startSec: number;
  durationSec: number;
  trimStartSec: number;
  /** null = the end of the source. */
  trimEndSec: number | null;
  playbackRate: number;
  endBehavior: OverlayEndBehavior;
  sourceDurationSec: number | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Seconds the video's trimmed part plays at its rate (null for images or an unknown source length). */
export function trimmedLengthSec(c: Pick<OverlayTiming, "kind" | "trimStartSec" | "trimEndSec" | "playbackRate" | "sourceDurationSec">): number | null {
  if (c.kind !== "video") return null;
  const end = c.trimEndSec ?? c.sourceDurationSec;
  if (end === null) return null;
  return Math.max(0, end - c.trimStartSec) / (c.playbackRate || 1);
}

export type OverlayDragEdge = "move" | "start" | "end";
export type OverlayTimingPatch = Pick<OverlayTiming, "startSec" | "durationSec" | "trimStartSec" | "trimEndSec">;

/**
 * Applies a timeline drag. Moving keeps the trim. The left edge trims the in-point: the picture
 * stays anchored in time, so a video's trim start moves with the edge. The right edge trims the
 * out-point; a video that doesn't loop can't be stretched past the end of its source.
 */
export function dragOverlay(c: OverlayTiming, edge: OverlayDragEdge, deltaSec: number, maxEndSec?: number): OverlayTimingPatch {
  const rate = c.playbackRate || 1;
  const base: OverlayTimingPatch = { startSec: c.startSec, durationSec: c.durationSec, trimStartSec: c.trimStartSec, trimEndSec: c.trimEndSec };
  if (edge === "move") {
    let start = Math.max(0, c.startSec + deltaSec);
    if (maxEndSec !== undefined) start = Math.min(start, Math.max(0, maxEndSec - c.durationSec));
    return { ...base, startSec: r3(start) };
  }
  if (edge === "start") {
    let d = Math.max(deltaSec, -c.startSec);
    if (c.kind === "video") d = Math.max(d, -c.trimStartSec / rate);
    d = Math.min(d, c.durationSec - MIN_OVERLAY_SEC);
    return { ...base, startSec: r3(c.startSec + d), durationSec: r3(c.durationSec - d), trimStartSec: c.kind === "video" ? r3(c.trimStartSec + d * rate) : c.trimStartSec };
  }
  let duration = Math.max(MIN_OVERLAY_SEC, c.durationSec + deltaSec);
  if (maxEndSec !== undefined) duration = Math.min(duration, Math.max(MIN_OVERLAY_SEC, maxEndSec - c.startSec));
  if (c.kind === "video" && c.endBehavior !== "loop" && c.sourceDurationSec !== null) {
    duration = Math.max(MIN_OVERLAY_SEC, Math.min(duration, (c.sourceDurationSec - c.trimStartSec) / rate));
    const out = c.trimStartSec + duration * rate;
    return { ...base, durationSec: r3(duration), trimEndSec: Math.abs(out - c.sourceDurationSec) < 0.02 ? null : r3(out) };
  }
  return { ...base, durationSec: r3(duration) };
}

/**
 * Pixel box of an overlay. Full frame covers the frame; framed and picture-in-picture keep the
 * media's aspect ratio (framed is centered, picture-in-picture sits in the bottom-right corner).
 */
export function overlayBox(placement: OverlayPlacement, frame: { width: number; height: number }, mediaAspect: number | null): { left: number; top: number; width: number; height: number; rounded: boolean } {
  const W = frame.width;
  const H = frame.height;
  if (placement === "fullscreen") return { left: 0, top: 0, width: W, height: H, rounded: false };
  const aspect = mediaAspect && mediaAspect > 0 ? mediaAspect : 16 / 9;
  const landscape = W >= H;
  const [maxW, maxH] = placement === "framed" ? [0.66, 0.7] : landscape ? [0.3, 0.34] : [0.46, 0.26];
  let w = maxW * W;
  let h = w / aspect;
  if (h > maxH * H) {
    h = maxH * H;
    w = h * aspect;
  }
  if (placement === "framed") return { left: (W - w) / 2, top: (H - h) / 2, width: w, height: h, rounded: true };
  const margin = Math.min(W, H) * 0.06;
  return { left: W - w - margin, top: H - h - margin, width: w, height: h, rounded: true };
}

/** Clip opacity at `frame` with fades that share the clip's length when they would overlap. */
export function overlayOpacity(frame: number, lengthFrames: number, fps: number, clip: { opacity: number; fadeInSec: number; fadeOutSec: number }): number {
  const total = (clip.fadeInSec + clip.fadeOutSec) * fps;
  const k = total > lengthFrames && total > 0 ? lengthFrames / total : 1;
  const fadeIn = clip.fadeInSec * fps * k;
  const fadeOut = clip.fadeOutSec * fps * k;
  let o = clip.opacity;
  if (fadeIn > 0) o *= Math.min(1, frame / fadeIn);
  if (fadeOut > 0) o *= Math.max(0, Math.min(1, (lengthFrames - frame) / fadeOut));
  return Math.max(0, Math.min(1, o));
}
