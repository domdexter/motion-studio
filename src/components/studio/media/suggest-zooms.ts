"use client";

import type { OverlayZoom } from "@/core/timeline/overlay-zoom";
import { http } from "@/lib/api-client";

/** Zoom suggestions for a video clip: moments where only part of the recording changes. */
export async function suggestZooms(
  projectId: string,
  assetId: string,
  clip: { trimStartSec: number; trimEndSec: number | null; playbackRate: number; clipDurationSec: number },
): Promise<OverlayZoom[]> {
  const q = new URLSearchParams({ trimStartSec: String(clip.trimStartSec), playbackRate: String(clip.playbackRate || 1), clipDurationSec: String(Math.max(0.5, clip.clipDurationSec)) });
  if (clip.trimEndSec !== null) q.set("trimEndSec", String(clip.trimEndSec));
  return (await http.get<{ zooms: OverlayZoom[] }>(`/api/projects/${projectId}/assets/${assetId}/activity-zooms?${q}`)).zooms;
}
