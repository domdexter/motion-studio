"use client";

import { Film, ImageIcon, Lock, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { dragSceneMedia, type SceneMediaDragEdge, type SceneMediaItem, type SceneMediaTiming } from "@/core/timeline/media-clip";
import type { OverlayZoom } from "@/core/timeline/overlay-zoom";
import { cn } from "@/lib/utils";
import type { SceneTrackContext } from "./timeline-tracks";
import { ClipFilmstrip } from "./filmstrip";
import { ZoomBars } from "./zoom-bars";

/**
 * Scene media lane: the images and videos placed inside scenes, at the time they're on screen. Drag a
 * clip to move it within its scene (or shot), drag its left edge to trim the in-point, drag its right
 * edge to set when it disappears. Snaps to spoken words, the scene edges, the playhead and other media
 * (hold Alt to place freely). Drag a zoom bar to retime a zoom; click a clip or a bar to open its panel.
 */

export interface SceneMediaLaneEntry {
  /** `${sceneId}:${shotId}:${index}` */
  key: string;
  sceneId: string;
  sceneKey: string;
  sceneStartSec: number;
  locked: boolean;
  item: SceneMediaItem;
  name: string;
  /** Seconds the trimmed part of a video plays (null for images or an unknown clip length). */
  trimmedLengthSec: number | null;
  endBehavior: "hold" | "loop";
  playbackRate: number;
  /** A video's in-point (0 for images). */
  trimStartSec: number;
}

interface DragState {
  key: string;
  edge: SceneMediaDragEdge;
  originX: number;
  moved: boolean;
  timing: SceneMediaTiming;
  snappedTo: number | null;
}

const SNAP_PX = 8;

/** Greedy two-row packing so media on screen at the same time (e.g. a background and a framed clip) stay visible. */
function packRows(entries: SceneMediaLaneEntry[]): { rows: Map<string, number>; count: number } {
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const e of [...entries].sort((a, b) => a.item.appearSec - b.item.appearSec)) {
    let row = ends.findIndex((end) => end <= e.item.appearSec + 0.001);
    if (row < 0) row = ends.length < 2 ? ends.length : ends[0] <= ends[1] ? 0 : 1;
    ends[row] = Math.max(ends[row] ?? 0, e.item.goneSec);
    rows.set(e.key, row);
  }
  return { rows, count: Math.max(1, ends.length) };
}

const timingOf = (entry: SceneMediaLaneEntry): SceneMediaTiming => ({ appearSec: entry.item.appearSec, goneSec: entry.item.goneSec, trimStartSec: entry.trimStartSec });
const sameTiming = (a: SceneMediaTiming, b: SceneMediaTiming) => Math.abs(a.appearSec - b.appearSec) < 0.0005 && Math.abs(a.goneSec - b.goneSec) < 0.0005 && Math.abs(a.trimStartSec - b.trimStartSec) < 0.0005;

export function SceneMediaTrackEditor({
  ctx,
  entries,
  selectedKey,
  onSelect,
  onCommitTiming,
  onCommitZooms,
  onFocusZoom,
  projectId,
}: {
  ctx: SceneTrackContext;
  /** Shows filmstrip frames inside video clips. */
  projectId?: string;
  entries: SceneMediaLaneEntry[];
  selectedKey: string | null;
  onSelect: (entry: SceneMediaLaneEntry) => void;
  onCommitTiming: (entry: SceneMediaLaneEntry, timing: SceneMediaTiming) => void;
  onCommitZooms: (entry: SceneMediaLaneEntry, zooms: OverlayZoom[]) => void;
  onFocusZoom: (entry: SceneMediaLaneEntry, zoomId: string) => void;
}) {
  const pps = ctx.pxPerSec;
  const [drag, setDrag] = useState<DragState | null>(null);
  // A committed drag stays on screen until the saved timing comes back, so the clip doesn't jump back.
  const [pending, setPending] = useState<{ key: string; timing: SceneMediaTiming } | null>(null);
  const pendingEntry = pending ? entries.find((e) => e.key === pending.key) : undefined;
  const pendingSettled = !pending || !pendingEntry || sameTiming(timingOf(pendingEntry), pending.timing);
  useEffect(() => {
    if (pending && pendingSettled) setPending(null);
  }, [pending, pendingSettled]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), 4000);
    return () => clearTimeout(timer);
  }, [pending]);

  const { rows, count } = useMemo(() => packRows(entries), [entries]);
  const timeAt = (clientX: number, lane: HTMLElement) => Math.max(0, (clientX - lane.getBoundingClientRect().left) / pps);
  const compact = count > 1;

  const nearest = (value: number, entry: SceneMediaLaneEntry): number | null => {
    const { segmentStartSec: from, segmentEndSec: to } = entry.item;
    const words = ctx.words.filter((w) => w.start >= from - 0.01 && w.start <= to).map((w) => w.start);
    const others = entries.filter((e) => e.key !== entry.key && e.sceneId === entry.sceneId).flatMap((e) => [e.item.appearSec, e.item.goneSec]);
    let best: number | null = null;
    let dist = SNAP_PX / pps;
    for (const p of [from, to, ctx.currentTime, ...others, ...words]) {
      const d = Math.abs(p - value);
      if (d < dist) {
        dist = d;
        best = p;
      }
    }
    return best;
  };

  const liveTiming = (entry: SceneMediaLaneEntry): SceneMediaTiming => {
    if (drag?.key === entry.key) return drag.timing;
    if (pending?.key === entry.key && !pendingSettled) return pending.timing;
    return timingOf(entry);
  };

  return (
    <div
      className="absolute inset-0"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) ctx.seek(timeAt(e.clientX, e.currentTarget));
      }}
    >
      {!entries.length ? <span className="pointer-events-none sticky left-[calc(var(--tl-labels,0px)+0.5rem)] mt-3.5 inline-block text-[11px] text-muted-foreground">Images and videos inside scenes show here — add one from the scene&apos;s Layers</span> : null}
      {entries.map((entry) => {
        const { item } = entry;
        const video = item.element.type === "video";
        const live = liveTiming(entry);
        const duration = Math.max(0, live.goneSec - live.appearSec);
        const row = rows.get(entry.key) ?? 0;
        const trimmed = entry.trimmedLengthSec;
        const tail = trimmed !== null && trimmed < duration - 0.01 ? (duration - trimmed) * pps : 0;
        const zooms = item.element.zooms ?? [];
        const dragging = drag?.key === entry.key && drag.moved;
        return (
          <div
            key={entry.key}
            role="button"
            tabIndex={0}
            title={`${entry.name} · ${entry.sceneKey}\n${item.appearSec.toFixed(2)}–${item.goneSec.toFixed(2)}s${video ? ` · ${entry.playbackRate}×` : ""}\n${entry.locked ? "Scene is locked" : "Drag to move · drag an edge to trim · Alt: no snapping · click to open"}`}
            className={cn(
              "absolute touch-none overflow-hidden rounded-md border text-[11px] leading-tight select-none",
              entry.locked ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
              video ? "border-violet-500/60 bg-violet-500/15" : "border-amber-500/60 bg-amber-500/15",
              selectedKey === entry.key && "ring-2 ring-primary",
            )}
            style={{ left: live.appearSec * pps, width: Math.max(6, duration * pps), top: compact ? (row === 0 ? 3 : 23) : 4, height: compact ? 18 : 36 }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              onSelect(entry);
              if (entry.locked) {
                const lane = e.currentTarget.parentElement;
                if (lane) ctx.seek(Math.max(item.appearSec, Math.min(item.goneSec, timeAt(e.clientX, lane))));
                return;
              }
              e.currentTarget.setPointerCapture(e.pointerId);
              const edge = ((e.target as HTMLElement).closest("[data-edge]")?.getAttribute("data-edge") ?? "move") as SceneMediaDragEdge;
              setDrag({ key: entry.key, edge, originX: e.clientX, moved: false, timing: timingOf(entry), snappedTo: null });
            }}
            onPointerMove={(e) => {
              if (!drag || drag.key !== entry.key) return;
              if (!drag.moved && Math.abs(e.clientX - drag.originX) < 3) return;
              let dt = (e.clientX - drag.originX) / pps;
              let snappedTo: number | null = null;
              if (!e.altKey) {
                const edges = drag.edge === "move" ? [item.appearSec, item.goneSec] : [drag.edge === "start" ? item.appearSec : item.goneSec];
                let bestShift: number | null = null;
                for (const edgeTime of edges) {
                  const s = nearest(edgeTime + dt, entry);
                  if (s !== null && (bestShift === null || Math.abs(s - (edgeTime + dt)) < Math.abs(bestShift))) {
                    bestShift = s - (edgeTime + dt);
                    snappedTo = s;
                  }
                }
                if (bestShift !== null) dt += bestShift;
              }
              const timing = dragSceneMedia(item, video ? { trimStartSec: entry.trimStartSec, playbackRate: entry.playbackRate } : null, drag.edge, dt);
              setDrag({ ...drag, moved: true, timing, snappedTo });
            }}
            onPointerUp={(e) => {
              if (!drag || drag.key !== entry.key) return;
              e.currentTarget.releasePointerCapture(e.pointerId);
              const final = drag;
              setDrag(null);
              if (!final.moved) {
                const lane = e.currentTarget.parentElement;
                if (lane) ctx.seek(Math.max(item.appearSec, Math.min(item.goneSec, timeAt(e.clientX, lane))));
                return;
              }
              if (sameTiming(final.timing, timingOf(entry))) return;
              setPending({ key: entry.key, timing: final.timing });
              onCommitTiming(entry, final.timing);
            }}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSelect(entry);
              }
            }}
          >
            {projectId && video && !compact ? (
              <ClipFilmstrip projectId={projectId} assetId={item.element.assetId} pxPerSec={pps} trimStartSec={live.trimStartSec} playbackRate={entry.playbackRate} playSec={Math.min(duration, trimmed ?? duration)} />
            ) : null}
            {tail > 0 ? (
              <div
                className="pointer-events-none absolute inset-y-0 right-0"
                style={{ width: tail, backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 4px, transparent 4px 8px)" }}
                title={entry.endBehavior === "loop" ? "Loops" : "Holds the last frame"}
              />
            ) : null}
            <div className="pointer-events-none relative flex h-full flex-col justify-center px-2.5">
              <span className="flex items-center gap-1 truncate font-medium">
                {video ? <Film className="size-3 shrink-0" /> : <ImageIcon className="size-3 shrink-0" />}
                {entry.locked ? <Lock className="size-3 shrink-0" /> : null}
                {zooms.length ? <ZoomIn className="size-3 shrink-0" /> : null}
                <span className="truncate">{entry.name}</span>
              </span>
              {!compact ? (
                <span className="truncate font-mono text-[9px] text-muted-foreground">
                  {entry.sceneKey}
                  {video ? ` · ${entry.playbackRate}× · in ${live.trimStartSec.toFixed(2)}s` : ""}
                  {zooms.length ? ` · ${zooms.length} zoom${zooms.length === 1 ? "" : "s"}` : ""}
                </span>
              ) : null}
            </div>
            {!entry.locked ? (
              <>
                <div data-edge="start" className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-foreground/25" />
                <div data-edge="end" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-foreground/25" />
              </>
            ) : null}
            <ZoomBars
              zooms={zooms}
              clipStartSec={item.appearSec}
              clipDurationSec={Math.max(0, item.goneSec - item.appearSec)}
              pxPerSec={pps}
              // While the left edge is dragged, zooms stay on their picture (clip time shifts by the edge's move).
              shiftSec={drag?.key === entry.key && drag.edge === "start" ? live.appearSec - item.appearSec : 0}
              size={compact ? "sm" : "md"}
              disabled={entry.locked}
              snapTimes={ctx.words.map((w) => w.start)}
              onGrab={() => onSelect(entry)}
              onCommit={(next) => onCommitZooms(entry, next)}
              onFocus={(zoomId) => onFocusZoom(entry, zoomId)}
            />
            {dragging ? <span className="sr-only">{`${live.appearSec.toFixed(2)}–${live.goneSec.toFixed(2)}s`}</span> : null}
          </div>
        );
      })}
      {drag?.moved ? (
        <div
          className="pointer-events-none absolute top-0 z-30 -translate-x-1/2 rounded bg-popover px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-popover-foreground shadow"
          style={{ left: (drag.edge === "end" ? drag.timing.goneSec : drag.timing.appearSec) * pps }}
        >
          {drag.edge === "move"
            ? `${drag.timing.appearSec.toFixed(2)}–${drag.timing.goneSec.toFixed(2)}s`
            : drag.edge === "start"
              ? `appears ${drag.timing.appearSec.toFixed(2)}s${entries.find((e) => e.key === drag.key)?.item.element.type === "video" ? ` · in ${drag.timing.trimStartSec.toFixed(2)}s` : ""}`
              : `gone ${drag.timing.goneSec.toFixed(2)}s`}
          {drag.snappedTo !== null ? " · snapped" : ""}
        </div>
      ) : null}
    </div>
  );
}
