"use client";

import { EyeOff, Film, ImageIcon, ZoomIn } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { OverlayZoom } from "@/core/timeline/overlay-zoom";
import { dragOverlay, trimmedLengthSec, type OverlayDragEdge, type OverlayTimingPatch } from "@/core/timeline/overlays";
import { cn } from "@/lib/utils";
import type { OverlayClipDto } from "@/server/services/overlay-clips";
import { ClipFilmstrip } from "./filmstrip";
import type { SceneTrackContext } from "./timeline-tracks";
import { ZoomBars } from "./zoom-bars";

/**
 * Interactive overlay lane. Drag a clip to move it; drag its left or right edge to trim the in or
 * out point. Snaps to scene cuts, the playhead and other clips (hold Alt to place freely).
 * Double-click the empty lane to add an overlay at that time.
 */

interface DragState {
  id: string;
  edge: OverlayDragEdge;
  originX: number;
  moved: boolean;
  patch: OverlayTimingPatch;
  snappedTo: number | null;
}

const SNAP_PX = 8;
const TIMING_KEYS = ["startSec", "durationSec", "trimStartSec", "trimEndSec"] as const;

/** Greedy two-row packing so overlapping clips stay visible. */
function packRows(clips: OverlayClipDto[]): { rows: Map<string, number>; count: number } {
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const c of [...clips].sort((a, b) => a.startSec - b.startSec)) {
    let row = ends.findIndex((end) => end <= c.startSec + 0.001);
    if (row < 0) row = ends.length < 2 ? ends.length : ends[0] <= ends[1] ? 0 : 1;
    ends[row] = Math.max(ends[row] ?? 0, c.endSec);
    rows.set(c.id, row);
  }
  return { rows, count: Math.max(1, ends.length) };
}

export function OverlayTrackEditor({
  ctx,
  clips,
  selectedId,
  onSelect,
  onCommit,
  onAddAt,
  onRemove,
  snapPoints,
  maxEndSec,
  busy,
  onCommitZooms,
  onFocusZoom,
  projectId,
}: {
  ctx: SceneTrackContext;
  clips: OverlayClipDto[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, patch: OverlayTimingPatch) => void;
  onAddAt: (timeSec: number) => void;
  onRemove?: (id: string) => void;
  snapPoints: number[];
  maxEndSec?: number;
  busy?: boolean;
  /** Zoom bars inside clips: drag to move, drag an edge to resize. */
  onCommitZooms?: (id: string, zooms: OverlayZoom[]) => void;
  /** A zoom bar was clicked (open it in the overlay panel). */
  onFocusZoom?: (clipId: string, zoomId: string) => void;
  /** Shows filmstrip frames inside video clips. */
  projectId?: string;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const pps = ctx.pxPerSec;
  const { rows, count } = useMemo(() => packRows(clips), [clips]);
  const timeAt = (clientX: number) => Math.max(0, (clientX - laneRef.current!.getBoundingClientRect().left) / pps);

  const nearest = (value: number, ignoreId: string): number | null => {
    const points = [0, ...snapPoints, ctx.currentTime, ...clips.filter((c) => c.id !== ignoreId).flatMap((c) => [c.startSec, c.endSec])];
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

  const onPointerMove = (e: React.PointerEvent, clip: OverlayClipDto) => {
    if (!drag || drag.id !== clip.id) return;
    if (!drag.moved && Math.abs(e.clientX - drag.originX) < 3) return;
    let dt = (e.clientX - drag.originX) / pps;
    let snappedTo: number | null = null;
    if (!e.altKey) {
      if (drag.edge === "move") {
        const s = nearest(clip.startSec + dt, clip.id);
        const en = nearest(clip.endSec + dt, clip.id);
        const ds = s === null ? Infinity : Math.abs(s - (clip.startSec + dt));
        const de = en === null ? Infinity : Math.abs(en - (clip.endSec + dt));
        if (s !== null && ds <= de) {
          dt = s - clip.startSec;
          snappedTo = s;
        } else if (en !== null) {
          dt = en - clip.endSec;
          snappedTo = en;
        }
      } else {
        const edgeTime = drag.edge === "start" ? clip.startSec : clip.endSec;
        const s = nearest(edgeTime + dt, clip.id);
        if (s !== null) {
          dt = s - edgeTime;
          snappedTo = s;
        }
      }
    }
    const patch = dragOverlay(
      { kind: clip.kind, startSec: clip.startSec, durationSec: clip.durationSec, trimStartSec: clip.trimStartSec, trimEndSec: clip.trimEndSec, playbackRate: clip.playbackRate, endBehavior: clip.endBehavior, sourceDurationSec: clip.sourceDurationSec },
      drag.edge,
      dt,
      maxEndSec,
    );
    setDrag({ ...drag, moved: true, patch, snappedTo });
  };

  const onPointerUp = (e: React.PointerEvent, clip: OverlayClipDto) => {
    if (!drag || drag.id !== clip.id) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const final = drag;
    setDrag(null);
    if (!final.moved) {
      ctx.seek(Math.max(clip.startSec, Math.min(clip.endSec, timeAt(e.clientX))));
      return;
    }
    if (TIMING_KEYS.some((k) => final.patch[k] !== clip[k])) onCommit(clip.id, final.patch);
  };

  return (
    <div
      ref={laneRef}
      className="absolute inset-0"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        onSelect(null);
        ctx.seek(timeAt(e.clientX));
      }}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) onAddAt(timeAt(e.clientX));
      }}
    >
      {!clips.length ? <span className="pointer-events-none sticky left-[calc(var(--tl-labels,0px)+0.5rem)] mt-3.5 inline-block text-[11px] text-muted-foreground">Double-click to add an image or video overlay here</span> : null}
      {clips.map((clip) => {
        const live = drag?.id === clip.id ? drag.patch : clip;
        const row = rows.get(clip.id) ?? 0;
        const compact = count > 1;
        const trimmed = trimmedLengthSec({ kind: clip.kind, trimStartSec: live.trimStartSec, trimEndSec: live.trimEndSec, playbackRate: clip.playbackRate, sourceDurationSec: clip.sourceDurationSec });
        const tail = trimmed !== null && trimmed < live.durationSec - 0.01 ? (live.durationSec - trimmed) * pps : 0;
        const active = drag?.id === clip.id && drag.moved;
        const end = live.startSec + live.durationSec;
        return (
          <div
            key={clip.id}
            role="button"
            tabIndex={0}
            title={`${clip.name}\n${clip.startSec.toFixed(2)}–${clip.endSec.toFixed(2)}s${clip.kind === "video" ? ` · plays ${clip.trimStartSec.toFixed(2)}–${(clip.trimEndSec ?? clip.sourceDurationSec ?? 0).toFixed(2)}s of the clip` : ""}\nDrag to move · drag an edge to trim · Alt: no snapping`}
            className={cn(
              "absolute touch-none overflow-hidden rounded-md border text-[11px] leading-tight select-none",
              busy ? "cursor-progress" : "cursor-grab active:cursor-grabbing",
              clip.kind === "video" ? "border-sky-500/60 bg-sky-500/20" : "border-emerald-500/60 bg-emerald-500/15",
              selectedId === clip.id && "ring-2 ring-primary",
              clip.hidden && "border-dashed opacity-45",
            )}
            style={{ left: live.startSec * pps, width: Math.max(6, live.durationSec * pps), top: compact ? (row === 0 ? 3 : 23) : 4, height: compact ? 18 : 36 }}
            onPointerDown={(e) => {
              if (busy || e.button !== 0) return;
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              onSelect(clip.id);
              const edge = ((e.target as HTMLElement).closest("[data-edge]")?.getAttribute("data-edge") ?? "move") as OverlayDragEdge;
              setDrag({ id: clip.id, edge, originX: e.clientX, moved: false, patch: { startSec: clip.startSec, durationSec: clip.durationSec, trimStartSec: clip.trimStartSec, trimEndSec: clip.trimEndSec }, snappedTo: null });
            }}
            onPointerMove={(e) => onPointerMove(e, clip)}
            onPointerUp={(e) => onPointerUp(e, clip)}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => {
              if ((e.key === "Delete" || e.key === "Backspace") && onRemove) {
                e.preventDefault();
                onRemove(clip.id);
              }
            }}
          >
            {projectId && clip.kind === "video" && !compact ? (
              <ClipFilmstrip projectId={projectId} assetId={clip.assetId} pxPerSec={pps} trimStartSec={live.trimStartSec} playbackRate={clip.playbackRate} playSec={Math.min(live.durationSec, trimmed ?? live.durationSec)} />
            ) : null}
            {tail > 0 ? (
              <div
                className="pointer-events-none absolute inset-y-0 right-0"
                style={{ width: tail, backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 4px, transparent 4px 8px)" }}
                title={clip.endBehavior === "loop" ? "Loops" : "Holds the last frame"}
              />
            ) : null}
            <div className="pointer-events-none relative flex h-full flex-col justify-center px-2.5">
              <span className="flex items-center gap-1 truncate font-medium">
                {clip.kind === "video" ? <Film className="size-3 shrink-0" /> : <ImageIcon className="size-3 shrink-0" />}
                {clip.hidden ? <EyeOff className="size-3 shrink-0" /> : null}
                {clip.zooms.length ? <ZoomIn className="size-3 shrink-0" /> : null}
                <span className="truncate">{clip.name}</span>
              </span>
              {!compact ? (
                <span className="truncate font-mono text-[9px] text-muted-foreground">
                  {live.durationSec.toFixed(2)}s{clip.kind === "video" ? ` · in ${live.trimStartSec.toFixed(2)}s${live.trimEndSec !== null ? ` · out ${live.trimEndSec.toFixed(2)}s` : ""}` : ""}
                </span>
              ) : null}
            </div>
            <div data-edge="start" className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-foreground/25" />
            <div data-edge="end" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-foreground/25" />
            {!compact ? (
              <ZoomBars
                zooms={clip.zooms}
                clipStartSec={clip.startSec}
                clipDurationSec={clip.durationSec}
                pxPerSec={pps}
                // While the in-point is dragged, zooms stay on their picture (clip time shifts by −Δtrim / rate).
                shiftSec={(live.trimStartSec - clip.trimStartSec) / (clip.playbackRate || 1)}
                disabled={busy}
                snapTimes={ctx.words.map((w) => w.start)}
                onGrab={() => onSelect(clip.id)}
                onCommit={(zooms) => onCommitZooms?.(clip.id, zooms)}
                onFocus={(zoomId) => onFocusZoom?.(clip.id, zoomId)}
              />
            ) : null}
            {active ? <span className="sr-only">{`${live.startSec.toFixed(2)}–${end.toFixed(2)}s`}</span> : null}
          </div>
        );
      })}
      {drag?.moved ? (
        <div
          className="pointer-events-none absolute top-0 z-30 -translate-x-1/2 rounded bg-popover px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-popover-foreground shadow"
          style={{ left: (drag.edge === "end" ? drag.patch.startSec + drag.patch.durationSec : drag.patch.startSec) * pps }}
        >
          {drag.edge === "move"
            ? `${drag.patch.startSec.toFixed(2)}–${(drag.patch.startSec + drag.patch.durationSec).toFixed(2)}s`
            : drag.edge === "start"
              ? `start ${drag.patch.startSec.toFixed(2)}s${clips.find((c) => c.id === drag.id)?.kind === "video" ? ` · in ${drag.patch.trimStartSec.toFixed(2)}s` : ""}`
              : `end ${(drag.patch.startSec + drag.patch.durationSec).toFixed(2)}s`}
          {drag.snappedTo !== null ? " · snapped" : ""}
        </div>
      ) : null}
    </div>
  );
}
