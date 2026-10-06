import { z } from "zod";

/**
 * Edits for clips on the overlay track and media inside scenes: crop, speed ramps and freeze frames
 * (a time remap), and annotations pinned to the picture (blur, boxes, arrows, labels, spotlights and
 * click ripples). Pure helpers shared by the renderer, the server and the editors.
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ID = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const Sec = z.number().min(0).max(24 * 3600);

// ---------------------------------------------------------------------------------------
// Crop
// ---------------------------------------------------------------------------------------

/** Most that can be cut from one side (the visible part stays at least 10% wide or tall). */
export const MAX_CROP = 0.45;

export const CropSchema = z.strictObject({
  left: z.number().min(0).max(MAX_CROP),
  top: z.number().min(0).max(MAX_CROP),
  right: z.number().min(0).max(MAX_CROP),
  bottom: z.number().min(0).max(MAX_CROP),
});
export type Crop = z.infer<typeof CropSchema>;

/** Clamped crop, or null when nothing is cut. */
export function normalizeCrop(crop: Partial<Crop> | null | undefined): Crop | null {
  if (!crop) return null;
  const c = { left: r4(clamp(crop.left ?? 0, 0, MAX_CROP)), top: r4(clamp(crop.top ?? 0, 0, MAX_CROP)), right: r4(clamp(crop.right ?? 0, 0, MAX_CROP)), bottom: r4(clamp(crop.bottom ?? 0, 0, MAX_CROP)) };
  return c.left + c.top + c.right + c.bottom < 0.0005 ? null : c;
}

/** Visible fraction of the media's width and height. */
export function cropVisible(crop: Crop | null | undefined): { w: number; h: number } {
  return { w: 1 - (crop?.left ?? 0) - (crop?.right ?? 0), h: 1 - (crop?.top ?? 0) - (crop?.bottom ?? 0) };
}

/** Width ÷ height of the visible part of media with the given aspect ratio. */
export function croppedAspect(aspect: number, crop: Crop | null | undefined): number {
  const v = cropVisible(crop);
  return (aspect * v.w) / v.h;
}

/** Box of the media inside its (cropped) frame, as CSS percentages, so the visible part fills the frame. */
export function cropBox(crop: Crop | null | undefined): { left: string; top: string; width: string; height: string } | null {
  if (!crop) return null;
  const v = cropVisible(crop);
  return { left: `${(-crop.left / v.w) * 100}%`, top: `${(-crop.top / v.h) * 100}%`, width: `${100 / v.w}%`, height: `${100 / v.h}%` };
}

// ---------------------------------------------------------------------------------------
// Speed ramps and freeze frames
// ---------------------------------------------------------------------------------------

export const MAX_SEGMENT_RATE = 16;
export const MIN_SEGMENT_SEC = 0.1;
export const MAX_SPEED_SEGMENTS = 40;

/**
 * A stretch of the clip (in clip seconds, from where the clip starts) that plays at its own speed.
 * Rate 0 is a freeze frame: the picture holds while the time passes, and the rest of the clip plays later.
 */
export const SpeedSegmentSchema = z.strictObject({
  id: ID,
  startSec: Sec,
  endSec: Sec,
  rate: z.number().min(0).max(MAX_SEGMENT_RATE),
});
export type SpeedSegment = z.infer<typeof SpeedSegmentSchema>;

export function normalizeSpeedSegments(segments: readonly SpeedSegment[] | null | undefined): SpeedSegment[] {
  const out: SpeedSegment[] = [];
  for (const s of [...(segments ?? [])].sort((a, b) => a.startSec - b.startSec)) {
    const prevEnd = out.length ? out[out.length - 1].endSec : 0;
    const startSec = r3(Math.max(0, s.startSec, prevEnd));
    const endSec = r3(Math.max(s.endSec, startSec));
    if (endSec - startSec < MIN_SEGMENT_SEC) continue;
    out.push({ id: s.id, startSec, endSec, rate: r3(clamp(s.rate, 0, MAX_SEGMENT_RATE)) });
  }
  return out.slice(0, MAX_SPEED_SEGMENTS);
}

export interface RemapClip {
  trimStartSec: number;
  /** Speed outside the segments. */
  playbackRate: number;
  speedSegments?: readonly SpeedSegment[] | null;
}

export const hasTimeRemap = (clip: Pick<RemapClip, "speedSegments">) => !!clip.speedSegments?.length;

/** Source second shown at clip second `t` (before any hold or loop past the trimmed part). */
export function sourceSecAt(clip: RemapClip, t: number): number {
  const base = clip.playbackRate || 1;
  let src = clip.trimStartSec;
  let cursor = 0;
  const time = Math.max(0, t);
  for (const s of clip.speedSegments ?? []) {
    if (s.startSec >= time) break;
    src += Math.max(0, s.startSec - cursor) * base;
    const end = Math.min(time, s.endSec);
    src += Math.max(0, end - Math.max(s.startSec, cursor)) * s.rate;
    cursor = Math.max(cursor, end);
  }
  return src + Math.max(0, time - cursor) * base;
}

/** Clip second at which source second `src` is reached (the inverse of sourceSecAt; freezes are skipped). */
export function clipSecForSource(clip: RemapClip, src: number): number {
  const base = clip.playbackRate || 1;
  let remaining = Math.max(0, src - clip.trimStartSec);
  let cursor = 0;
  for (const s of clip.speedSegments ?? []) {
    const gap = Math.max(0, s.startSec - cursor);
    if (remaining <= gap * base) return cursor + remaining / base;
    remaining -= gap * base;
    const length = s.endSec - Math.max(s.startSec, cursor);
    if (s.rate > 0 && remaining <= length * s.rate) return Math.max(s.startSec, cursor) + remaining / s.rate;
    remaining -= Math.max(0, length) * s.rate;
    cursor = s.endSec;
  }
  return cursor + remaining / base;
}

// ---------------------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------------------

export const ANNOTATION_TYPES = ["blur", "box", "arrow", "label", "spotlight", "click"] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];
export const MAX_ANNOTATIONS = 40;
export const MIN_ANNOTATION_SEC = 0.2;
/** How long a click ripple takes. */
export const CLICK_RIPPLE_SEC = 0.7;

export const ANNOTATION_LABELS: Record<AnnotationType, string> = {
  blur: "Blur (hide details)",
  box: "Box",
  arrow: "Arrow",
  label: "Label",
  spotlight: "Spotlight",
  click: "Click ripple",
};

/**
 * Something drawn on a clip's picture for a while, in fractions of the clip's (cropped) frame. It sits
 * under zoom regions, so it stays on the part of the picture it marks. Blur, box, label and spotlight
 * use the area (x, y = top-left, w, h). An arrow points from (x, y) to (x + w, y + h). A click ripple is
 * centred on (x, y).
 */
export const AnnotationSchema = z.strictObject({
  id: ID,
  type: z.enum(ANNOTATION_TYPES),
  startSec: Sec,
  endSec: Sec,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(-1).max(1),
  h: z.number().min(-1).max(1),
  text: z.string().max(120).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** Blur strength or spotlight darkness, 0..1. */
  strength: z.number().min(0).max(1).optional(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export function normalizeAnnotations(list: readonly Annotation[] | null | undefined): Annotation[] {
  return [...(list ?? [])]
    .map((a) => {
      let { x, y, w, h } = a;
      if (a.type !== "arrow") {
        // Areas keep a positive size; a flipped drag moves the corner instead.
        if (w < 0) {
          x += w;
          w = -w;
        }
        if (h < 0) {
          y += h;
          h = -h;
        }
        x = clamp(x, 0, 1);
        y = clamp(y, 0, 1);
        w = clamp(w, a.type === "click" ? 0 : 0.01, 1 - x);
        h = clamp(h, a.type === "click" ? 0 : 0.01, 1 - y);
      } else {
        x = clamp(x, 0, 1);
        y = clamp(y, 0, 1);
        w = clamp(x + w, 0, 1) - x;
        h = clamp(y + h, 0, 1) - y;
      }
      const startSec = r3(Math.max(0, a.startSec));
      const endSec = r3(Math.max(startSec + (a.type === "click" ? CLICK_RIPPLE_SEC : MIN_ANNOTATION_SEC), a.endSec));
      return { ...a, x: r4(x), y: r4(y), w: r4(w), h: r4(h), startSec, endSec, ...(a.text !== undefined ? { text: a.text.slice(0, 120) } : {}) };
    })
    .sort((a, b) => a.startSec - b.startSec)
    .slice(0, MAX_ANNOTATIONS);
}

/** 0..1 visibility of an annotation at clip second `t`, with short fades. */
export function annotationVisibility(a: Pick<Annotation, "startSec" | "endSec">, t: number, fadeSec = 0.2): number {
  if (t < a.startSec || t > a.endSec) return 0;
  const fade = Math.min(fadeSec, (a.endSec - a.startSec) / 2);
  if (fade <= 0) return 1;
  return clamp(Math.min((t - a.startSec) / fade, (a.endSec - t) / fade), 0, 1);
}

// ---------------------------------------------------------------------------------------
// Reading stored values (invalid data is dropped)
// ---------------------------------------------------------------------------------------

export function parseCrop(value: unknown): Crop | null {
  const parsed = CropSchema.safeParse(value);
  return parsed.success ? normalizeCrop(parsed.data) : null;
}

export function parseSpeedSegments(value: unknown): SpeedSegment[] {
  if (!Array.isArray(value)) return [];
  return normalizeSpeedSegments(value.flatMap((v) => {
    const parsed = SpeedSegmentSchema.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  }));
}

export function parseAnnotations(value: unknown): Annotation[] {
  if (!Array.isArray(value)) return [];
  return normalizeAnnotations(value.flatMap((v) => {
    const parsed = AnnotationSchema.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  }));
}

/**
 * Splits timed items (zooms, annotations, speed segments) of a clip that is cut at clip second `at`.
 * The second part starts at `resumeAt` (later than `at` when a section is cut out); its items are
 * re-timed from its own start. Items crossing a cut are clipped to each side.
 */
export function splitClipTimes<T extends { startSec: number; endSec: number }>(items: readonly T[], at: number, resumeAt = at, minSec = MIN_SEGMENT_SEC): { before: T[]; after: T[] } {
  const before: T[] = [];
  const after: T[] = [];
  for (const i of items) {
    const end = Math.min(i.endSec, at);
    if (i.startSec < at && end - i.startSec >= minSec) before.push({ ...i, endSec: r3(end) });
    const start = Math.max(i.startSec, resumeAt);
    if (i.endSec > resumeAt && i.endSec - start >= minSec) after.push({ ...i, startSec: r3(start - resumeAt), endSec: r3(i.endSec - resumeAt) });
  }
  return { before, after };
}

/** Moves annotations and freeze/speed segments with the picture when a clip's in-point moves by `deltaClipSec` (clip seconds). */
export function shiftClipTimes<T extends { startSec: number; endSec: number }>(items: readonly T[], deltaClipSec: number): T[] {
  if (Math.abs(deltaClipSec) < 0.0005) return [...items];
  return items.filter((i) => i.endSec - deltaClipSec > MIN_ANNOTATION_SEC).map((i) => ({ ...i, startSec: r3(Math.max(0, i.startSec - deltaClipSec)), endSec: r3(i.endSec - deltaClipSec) }));
}
