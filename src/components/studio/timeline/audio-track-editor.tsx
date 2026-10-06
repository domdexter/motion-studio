"use client";

import { AudioLines, Mic, Music, Repeat, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { audioClipLengthSec, dragAudioClip, type AudioClipPatch, type AudioClipTiming, type AudioDragEdge } from "@/core/timeline/audio-clips";
import { cn } from "@/lib/utils";
import type { AudioTrackDto } from "@/server/services/audio-tracks";
import { drawWaveform, usePeaks } from "../audio/waveform-player";
import type { SceneTrackContext } from "./timeline-tracks";

/**
 * Interactive audio lane: music, sound effects and voice lines. Drag a clip to move it; drag its left
 * edge to trim the in-point or its right edge to set the length. Snaps to scene cuts, the playhead and
 * other clips (hold Alt to place freely).
 */

interface DragState {
  id: string;
  edge: AudioDragEdge;
  originX: number;
  moved: boolean;
  patch: AudioClipPatch;
  snappedTo: number | null;
}

const SNAP_PX = 8;
const KIND_STYLE: Record<AudioTrackDto["kind"], string> = {
  music: "border-emerald-500/60 bg-emerald-500/15 text-emerald-200",
  sfx: "border-amber-500/60 bg-amber-500/15 text-amber-200",
  voice: "border-sky-500/60 bg-sky-500/20 text-sky-200",
};

const timingOf = (t: AudioTrackDto, patch?: AudioClipPatch): AudioClipTiming => ({
  startSec: patch?.startSec ?? t.startSec,
  trimStartSec: patch?.trimStartSec ?? t.trimStartSec,
  durationSec: patch ? patch.durationSec : t.durationSec,
  loop: t.loop,
  sourceDurationSec: t.sourceDurationSec,
});

function packRows(tracks: AudioTrackDto[], videoEndSec: number): { rows: Map<string, number>; count: number } {
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const t of [...tracks].sort((a, b) => a.startSec - b.startSec)) {
    const end = t.startSec + audioClipLengthSec(timingOf(t), videoEndSec);
    let row = ends.findIndex((e) => e <= t.startSec + 0.001);
    if (row < 0) row = ends.length < 2 ? ends.length : ends[0] <= ends[1] ? 0 : 1;
    ends[row] = Math.max(ends[row] ?? 0, end);
    rows.set(t.id, row);
  }
  return { rows, count: Math.max(1, ends.length) };
}

function ClipWaveform({ peaksUrl, fromSec, toSec, widthPx, heightPx }: { peaksUrl: string; fromSec: number; toSec: number; widthPx: number; heightPx: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peaks = usePeaks(peaksUrl);
  // Canvas resolution is capped; CSS stretches it across the clip at any zoom.
  const width = Math.max(1, Math.min(1600, Math.round(widthPx)));
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = width;
    canvas.height = heightPx;
    drawWaveform(ctx, peaks.data, { width, height: heightPx, from: fromSec, to: toSec, barWidth: 1, gap: 1 });
  }, [peaks.data, fromSec, toSec, width, heightPx]);
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full opacity-70" />;
}

export function AudioTrackEditor({
  ctx,
  tracks,
  selectedId,
  onSelect,
  onCommit,
  onRemove,
  snapPoints,
  videoEndSec,
  busy,
}: {
  ctx: SceneTrackContext;
  tracks: AudioTrackDto[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, patch: AudioClipPatch) => void;
  onRemove?: (id: string) => void;
  snapPoints: number[];
  videoEndSec: number;
  busy?: boolean;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const pps = ctx.pxPerSec;
  const { rows, count } = useMemo(() => packRows(tracks, videoEndSec), [tracks, videoEndSec]);
  const timeAt = (clientX: number) => Math.max(0, (clientX - laneRef.current!.getBoundingClientRect().left) / pps);
  const endOf = (t: AudioTrackDto, patch?: AudioClipPatch) => {
    const timing = timingOf(t, patch);
    return timing.startSec + audioClipLengthSec(timing, videoEndSec);
  };

  const nearest = (value: number, ignoreId: string): number | null => {
    const points = [0, ...snapPoints, ctx.currentTime, ...tracks.filter((t) => t.id !== ignoreId).flatMap((t) => [t.startSec, endOf(t)])];
    let best: number | null = null;
    let dist = SNAP_PX / pps;
    for (const p of points) {
      const d = Math.abs(p - value);
      if (d < dist) {
        dist = d;
        best = p;
      }
    }
    return best;
  };

  const onPointerMove = (e: React.PointerEvent, track: AudioTrackDto) => {
    if (!drag || drag.id !== track.id) return;
    if (!drag.moved && Math.abs(e.clientX - drag.originX) < 3) return;
    let dt = (e.clientX - drag.originX) / pps;
    let snappedTo: number | null = null;
    const start = track.startSec;
    const end = endOf(track);
    if (!e.altKey) {
      if (drag.edge === "move") {
        const s = nearest(start + dt, track.id);
        const en = nearest(end + dt, track.id);
        const ds = s === null ? Infinity : Math.abs(s - (start + dt));
        const de = en === null ? Infinity : Math.abs(en - (end + dt));
        if (s !== null && ds <= de) {
          dt = s - start;
          snappedTo = s;
        } else if (en !== null) {
          dt = en - end;
          snappedTo = en;
        }
      } else {
        const edgeTime = drag.edge === "start" ? start : end;
        const s = nearest(edgeTime + dt, track.id);
        if (s !== null) {
          dt = s - edgeTime;
          snappedTo = s;
        }
      }
    }
    setDrag({ ...drag, moved: true, patch: dragAudioClip(timingOf(track), drag.edge, dt, videoEndSec), snappedTo });
  };

  const onPointerUp = (e: React.PointerEvent, track: AudioTrackDto) => {
    if (!drag || drag.id !== track.id) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const final = drag;
    setDrag(null);
    if (!final.moved) {
      ctx.seek(Math.max(track.startSec, Math.min(endOf(track), timeAt(e.clientX))));
      return;
    }
    const changed = final.patch.startSec !== track.startSec || final.patch.trimStartSec !== track.trimStartSec || final.patch.durationSec !== track.durationSec;
    if (changed) onCommit(track.id, final.patch);
  };

  const dragged = drag?.moved ? tracks.find((t) => t.id === drag.id) : undefined;

  return (
    <div
      ref={laneRef}
      className="absolute inset-0"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        onSelect(null);
        ctx.seek(timeAt(e.clientX));
      }}
    >
      {!tracks.length ? <span className="pointer-events-none sticky left-[calc(var(--tl-labels,0px)+0.5rem)] mt-3.5 inline-block text-[11px] text-muted-foreground">No music or sound effects yet — add them on the Audio page</span> : null}
      {tracks.map((track) => {
        const live = drag?.id === track.id && drag.moved ? drag.patch : undefined;
        const timing = timingOf(track, live);
        const length = audioClipLengthSec(timing, videoEndSec);
        const row = rows.get(track.id) ?? 0;
        const compact = count > 1;
        const width = Math.max(6, length * pps);
        const height = compact ? 18 : 36;
        const fadeIn = Math.min(width / 2, track.fadeInSec * pps);
        const fadeOut = Math.min(width / 2, track.fadeOutSec * pps);
        const Icon = track.kind === "music" ? Music : track.kind === "voice" ? Mic : AudioLines;
        return (
          <div
            key={track.id}
            role="button"
            tabIndex={0}
            title={`${track.name}\n${timing.startSec.toFixed(2)}–${(timing.startSec + length).toFixed(2)}s · plays ${timing.trimStartSec.toFixed(2)}s–${(timing.trimStartSec + length).toFixed(2)}s of the file\nDrag to move · drag an edge to trim · Delete removes · Alt: no snapping`}
            className={cn(
              "absolute touch-none overflow-hidden rounded-md border text-[11px] leading-tight select-none",
              busy ? "cursor-progress" : "cursor-grab active:cursor-grabbing",
              KIND_STYLE[track.kind],
              selectedId === track.id && "ring-2 ring-primary",
              track.muted && "border-dashed opacity-45",
            )}
            style={{ left: timing.startSec * pps, width, top: compact ? (row === 0 ? 3 : 23) : 4, height }}
            onPointerDown={(e) => {
              if (busy || e.button !== 0) return;
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              onSelect(track.id);
              const edge = ((e.target as HTMLElement).closest("[data-edge]")?.getAttribute("data-edge") ?? "move") as AudioDragEdge;
              setDrag({ id: track.id, edge, originX: e.clientX, moved: false, patch: { startSec: track.startSec, trimStartSec: track.trimStartSec, durationSec: track.durationSec }, snappedTo: null });
            }}
            onPointerMove={(e) => onPointerMove(e, track)}
            onPointerUp={(e) => onPointerUp(e, track)}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => {
              if ((e.key === "Delete" || e.key === "Backspace") && onRemove) {
                e.preventDefault();
                onRemove(track.id);
              }
            }}
          >
            <ClipWaveform peaksUrl={track.peaksUrl} fromSec={timing.trimStartSec} toSec={timing.trimStartSec + length} widthPx={width} heightPx={height} />
            {fadeIn > 0 ? <div className="pointer-events-none absolute inset-y-0 left-0" style={{ width: fadeIn, background: "linear-gradient(to right, rgba(0,0,0,0.45), transparent)" }} /> : null}
            {fadeOut > 0 ? <div className="pointer-events-none absolute inset-y-0 right-0" style={{ width: fadeOut, background: "linear-gradient(to left, rgba(0,0,0,0.45), transparent)" }} /> : null}
            <div className="pointer-events-none relative flex h-full flex-col justify-center px-2.5 text-foreground">
              <span className="flex items-center gap-1 truncate font-medium">
                <Icon className="size-3 shrink-0" />
                {track.muted ? <VolumeX className="size-3 shrink-0" /> : null}
                {track.loop ? <Repeat className="size-3 shrink-0" /> : null}
                <span className="truncate">{track.name}</span>
              </span>
              {!compact ? (
                <span className="truncate font-mono text-[9px] text-muted-foreground">
                  {length.toFixed(2)}s{timing.trimStartSec > 0 ? ` · in ${timing.trimStartSec.toFixed(2)}s` : ""} · {Math.round(track.volume * 100)}%
                </span>
              ) : null}
            </div>
            <div data-edge="start" className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-foreground/25" />
            <div data-edge="end" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-foreground/25" />
          </div>
        );
      })}
      {drag?.moved && dragged ? (
        <div
          className="pointer-events-none absolute top-0 z-30 -translate-x-1/2 rounded bg-popover px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-popover-foreground shadow"
          style={{ left: (drag.edge === "end" ? endOf(dragged, drag.patch) : drag.patch.startSec) * pps }}
        >
          {drag.edge === "move"
            ? `${drag.patch.startSec.toFixed(2)}–${endOf(dragged, drag.patch).toFixed(2)}s`
            : drag.edge === "start"
              ? `start ${drag.patch.startSec.toFixed(2)}s · in ${drag.patch.trimStartSec.toFixed(2)}s`
              : `end ${endOf(dragged, drag.patch).toFixed(2)}s`}
          {drag.snappedTo !== null ? " · snapped" : ""}
        </div>
      ) : null}
    </div>
  );
}
