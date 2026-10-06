"use client";

import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api-client";
import type { Filmstrip as FilmstripData } from "@/server/services/filmstrip";

/**
 * Frames of a video drawn inside its timeline clip, so you can see what plays where while trimming.
 * Only the trimmed part of the source is shown; a held or looping tail stays empty.
 */
export function ClipFilmstrip({
  projectId,
  assetId,
  pxPerSec,
  trimStartSec,
  playbackRate,
  playSec,
}: {
  projectId: string;
  assetId: string;
  pxPerSec: number;
  /** Source second at the clip's left edge. */
  trimStartSec: number;
  playbackRate: number;
  /** Clip seconds the trimmed part plays (the width to fill). */
  playSec: number;
}) {
  const q = useQuery({
    queryKey: ["filmstrip", projectId, assetId],
    queryFn: async () => (await http.get<{ filmstrip: FilmstripData }>(`/api/projects/${projectId}/assets/${assetId}/filmstrip`)).filmstrip,
    staleTime: Infinity,
    retry: false,
  });
  const strip = q.data;
  if (!strip || playSec <= 0) return null;
  const rate = playbackRate || 1;
  const tileWidth = (strip.stepSec / rate) * pxPerSec;
  if (tileWidth < 6) return null;
  const sourceEnd = trimStartSec + playSec * rate;
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden opacity-35" style={{ width: playSec * pxPerSec }}>
      {strip.frames
        .filter((f) => f.timeSec + strip.stepSec / 2 > trimStartSec && f.timeSec - strip.stepSec / 2 < sourceEnd)
        .map((f) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={f.url}
            src={f.url}
            alt=""
            draggable={false}
            className="absolute inset-y-0 h-full object-cover"
            style={{ left: ((f.timeSec - strip.stepSec / 2 - trimStartSec) / rate) * pxPerSec, width: tileWidth + 1 }}
          />
        ))}
    </div>
  );
}
