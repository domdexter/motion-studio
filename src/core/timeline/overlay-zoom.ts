import { z } from "zod";

/**
 * Zoom regions on overlay clips: zoom into an area of a screen recording or screenshot, hold while
 * the narrator talks about it (optionally panning to a second area), then ease back out.
 *
 * Areas are squares in fractions of the clip's visible frame (x, y = top-left, size = side), so a
 * square area has the frame's own aspect ratio and the zoom never distorts. Times are seconds from
 * the clip's start on the timeline. Pure helpers shared by the renderer, the server and the editor.
 */

/** Smallest area (10% of the frame = 10× zoom). */
export const MIN_ZOOM_SIZE = 0.1;
/** Shortest zoom, in seconds. */
export const MIN_ZOOM_SEC = 0.3;
export const DEFAULT_ZOOM_EASE_SEC = 0.5;
export const MAX_ZOOMS_PER_CLIP = 20;

export const ZoomRectSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  size: z.number().min(MIN_ZOOM_SIZE).max(1),
});
export type ZoomRect = z.infer<typeof ZoomRectSchema>;

export const OverlayZoomSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  startSec: z.number().min(0).max(24 * 3600),
  endSec: z.number().min(0).max(24 * 3600),
  /** The area the zoom moves into. */
  rect: ZoomRectSchema,
  /** Optional second area: the view pans from `rect` to `toRect` while the zoom holds. */
  toRect: ZoomRectSchema.nullable().default(null),
  /** Seconds to zoom in and to zoom back out. */
  easeSec: z.number().min(0).max(5).default(DEFAULT_ZOOM_EASE_SEC),
});
export type OverlayZoom = z.infer<typeof OverlayZoomSchema>;

export const FULL_VIEW: ZoomRect = { x: 0, y: 0, size: 1 };

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (p: number) => {
  const t = clamp(p, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/** Keeps an area inside the frame and at least MIN_ZOOM_SIZE. */
export function clampZoomRect(r: ZoomRect): ZoomRect {
  const size = clamp(r.size, MIN_ZOOM_SIZE, 1);
  return { x: r4(clamp(r.x, 0, 1 - size)), y: r4(clamp(r.y, 0, 1 - size)), size: r4(size) };
}

/** Sorted, clamped zooms that never overlap (a zoom that starts inside the previous one starts at its end). */
export function normalizeZooms(zooms: readonly OverlayZoom[]): OverlayZoom[] {
  const out: OverlayZoom[] = [];
  for (const z of [...zooms].sort((a, b) => a.startSec - b.startSec)) {
    const prevEnd = out.length ? out[out.length - 1].endSec : 0;
    const startSec = r3(Math.max(z.startSec, prevEnd, 0));
    const endSec = r3(Math.max(z.endSec, startSec));
    if (endSec - startSec < MIN_ZOOM_SEC) continue;
    out.push({ id: z.id, startSec, endSec, rect: clampZoomRect(z.rect), toRect: z.toRect ? clampZoomRect(z.toRect) : null, easeSec: r3(clamp(z.easeSec, 0, 5)) });
  }
  return out.slice(0, MAX_ZOOMS_PER_CLIP);
}

/** Reads a stored zooms value (invalid entries are dropped). */
export function parseZooms(value: unknown): OverlayZoom[] {
  if (!Array.isArray(value)) return [];
  const valid = value.flatMap((v) => {
    const parsed = OverlayZoomSchema.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
  return normalizeZooms(valid);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRect = (a: ZoomRect, b: ZoomRect, t: number): ZoomRect => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), size: lerp(a.size, b.size, t) });

/** The part of the clip frame on screen at `clipSec` (the full frame when no zoom is active). */
export function zoomViewAt(clipSec: number, zooms: readonly OverlayZoom[]): ZoomRect {
  for (const z of zooms) {
    if (clipSec <= z.startSec || clipSec >= z.endSec) continue;
    const length = z.endSec - z.startSec;
    const ease = Math.min(z.easeSec, length / 2);
    const inP = ease > 0 ? smooth((clipSec - z.startSec) / ease) : 1;
    const outP = ease > 0 ? smooth((z.endSec - clipSec) / ease) : 1;
    const amount = Math.min(inP, outP);
    let target = clampZoomRect(z.rect);
    if (z.toRect) {
      const holdStart = z.startSec + ease;
      const holdEnd = z.endSec - ease;
      const pan = holdEnd > holdStart ? smooth((clipSec - holdStart) / (holdEnd - holdStart)) : clipSec >= z.startSec + length / 2 ? 1 : 0;
      target = lerpRect(target, clampZoomRect(z.toRect), pan);
    }
    return lerpRect(FULL_VIEW, target, amount);
  }
  return FULL_VIEW;
}

/** CSS transform (with transform-origin 0 0) that shows `view` of an element filling its frame. */
export function zoomTransform(view: ZoomRect): string | undefined {
  if (view.size >= 0.9999 && view.x <= 0.0001 && view.y <= 0.0001) return undefined;
  return `scale(${1 / view.size}) translate(${-view.x * 100}%, ${-view.y * 100}%)`;
}

/**
 * Keeps zooms on the same picture when the clip's in-point changes: the source shown at clip time t
 * is trimStart + t × rate, so a new trim start moves every zoom by −Δtrim / rate.
 */
export function shiftZoomsForTrim(zooms: readonly OverlayZoom[], oldTrimStartSec: number, newTrimStartSec: number, playbackRate: number): OverlayZoom[] {
  const delta = (newTrimStartSec - oldTrimStartSec) / (playbackRate || 1);
  if (Math.abs(delta) < 0.0005) return [...zooms];
  return normalizeZooms(zooms.filter((z) => z.endSec - delta > MIN_ZOOM_SEC).map((z) => ({ ...z, startSec: Math.max(0, z.startSec - delta), endSec: z.endSec - delta })));
}
