import { z } from "zod";
import { DEFAULT_ZOOM_EASE_SEC, clampZoomRect, normalizeZooms, type OverlayZoom } from "@/core/timeline/overlay-zoom";
import { db } from "../db";
import { AppError, notFound } from "../errors";
import { assertId, assertProjectId } from "../ids";
import { grayFrames } from "../media/ffmpeg";
import { projectFile } from "../storage/paths";

/**
 * Zoom suggestions for a screen recording: small frames are compared over time, and where only part of
 * the picture changes for a while (typing, clicking, a menu opening) a zoom into that area is proposed.
 * The user reviews the suggestions; nothing is applied automatically.
 */

export const ActivityZoomsQuerySchema = z.object({
  trimStartSec: z.coerce.number().min(0).default(0),
  trimEndSec: z.coerce.number().min(0).optional(),
  playbackRate: z.coerce.number().min(0.1).max(4).default(1),
  /** Seconds the clip is on screen (zoom times are clip seconds). */
  clipDurationSec: z.coerce.number().min(0.5).max(3600),
});

const W = 160;
const H = 90;
const FPS = 4;
const MAX_ANALYSIS_SEC = 300;
const MAX_SUGGESTIONS = 8;

export async function suggestActivityZooms(projectId: string, assetId: string, input: z.input<typeof ActivityZoomsQuerySchema> | Record<string, string>): Promise<OverlayZoom[]> {
  assertProjectId(projectId);
  assertId(assetId, "asset id");
  const q = ActivityZoomsQuerySchema.parse(input);
  const asset = await db.asset.findFirst({ where: { id: assetId, projectId } });
  if (!asset) throw notFound("Asset");
  if (!asset.mimeType.startsWith("video/")) throw new AppError("VALIDATION", "Zoom suggestions need a video.");
  const sourceEnd = Math.min(q.trimEndSec ?? asset.durationSec ?? Infinity, q.trimStartSec + q.clipDurationSec * q.playbackRate, q.trimStartSec + MAX_ANALYSIS_SEC);
  const span = sourceEnd - q.trimStartSec;
  if (!(span > 1)) return [];

  const bytes = await grayFrames(projectFile(projectId, asset.filePath), { startSec: q.trimStartSec, durationSec: span, fps: FPS, width: W, height: H });
  const count = Math.floor(bytes.length / (W * H));
  // Frames where only part of the picture changes, with the box around the change.
  const active: ({ x0: number; y0: number; x1: number; y1: number } | null)[] = [null];
  for (let f = 1; f < count; f++) {
    const a = (f - 1) * W * H;
    const b = f * W * H;
    let changed = 0;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (Math.abs(bytes[a + i] - bytes[b + i]) > 24) {
          changed++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    const share = changed / (W * H);
    active.push(share > 0.002 && share < 0.35 ? { x0, y0, x1, y1 } : null);
  }

  // Runs of activity (a one-frame pause doesn't break a run) with the union of their boxes.
  const runs: { from: number; to: number; box: { x0: number; y0: number; x1: number; y1: number } }[] = [];
  let run: (typeof runs)[number] | null = null;
  let gap = 0;
  for (let f = 1; f < active.length; f++) {
    const box = active[f];
    if (box) {
      if (!run) run = { from: f - 1, to: f, box: { ...box } };
      else {
        run.to = f;
        run.box = { x0: Math.min(run.box.x0, box.x0), y0: Math.min(run.box.y0, box.y0), x1: Math.max(run.box.x1, box.x1), y1: Math.max(run.box.y1, box.y1) };
      }
      gap = 0;
    } else if (run && ++gap > 1) {
      runs.push(run);
      run = null;
      gap = 0;
    }
  }
  if (run) runs.push(run);

  const zooms: OverlayZoom[] = [];
  for (const r of runs) {
    const lengthSec = (r.to - r.from) / FPS / q.playbackRate;
    if (lengthSec < 0.75) continue;
    // A square area (in frame fractions) around the change, with some room around it.
    const cx = (r.box.x0 + r.box.x1 + 1) / 2 / W;
    const cy = (r.box.y0 + r.box.y1 + 1) / 2 / H;
    const size = Math.max((r.box.x1 - r.box.x0 + 1) / W, (r.box.y1 - r.box.y0 + 1) / H) * 1.35 + 0.08;
    if (size >= 0.8) continue;
    const rect = clampZoomRect({ x: cx - Math.max(size, 0.3) / 2, y: cy - Math.max(size, 0.3) / 2, size: Math.max(size, 0.3) });
    const startSec = Math.max(0, r.from / FPS / q.playbackRate - 0.3);
    const endSec = Math.min(q.clipDurationSec, r.to / FPS / q.playbackRate + 0.8);
    zooms.push({ id: `auto${zooms.length + 1}${Date.now().toString(36).slice(-4)}`, startSec, endSec, rect, toRect: null, easeSec: DEFAULT_ZOOM_EASE_SEC });
  }
  return normalizeZooms(zooms).slice(0, MAX_SUGGESTIONS);
}
