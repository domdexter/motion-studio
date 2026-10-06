"use client";

import { useEffect, useState } from "react";
import { MIN_ZOOM_SEC, normalizeZooms, type OverlayZoom } from "@/core/timeline/overlay-zoom";
import { cn } from "@/lib/utils";

/**
 * Zoom regions drawn as bars along the bottom of a timeline clip (overlay clips and media inside
 * scenes). Drag a bar to move it, drag an edge to resize it, click it to open it in the clip's panel.
 * Edges snap to spoken words (hold Alt to place freely).
 */

interface BarDrag {
  zoomId: string;
  edge: "move" | "start" | "end";
  originX: number;
  moved: boolean;
  zooms: OverlayZoom[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const SNAP_PX = 8;

export function ZoomBars({
  zooms,
  clipStartSec,
  clipDurationSec,
  pxPerSec,
  shiftSec = 0,
  size = "md",
  disabled,
  snapTimes,
  onGrab,
  onCommit,
  onFocus,
}: {
  zooms: OverlayZoom[];
  /** Video seconds the clip starts (zoom times count from here). */
  clipStartSec: number;
  /** Seconds the clip is on screen (zooms stay inside it). */
  clipDurationSec: number;
  pxPerSec: number;
  /** Clip seconds the bars shift left by (e.g. while the clip's in-point is dragged). */
  shiftSec?: number;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Video seconds zoom edges snap to (e.g. when words are spoken). */
  snapTimes?: readonly number[];
  /** The pointer went down on a bar (e.g. select the clip). */
  onGrab?: () => void;
  onCommit: (zooms: OverlayZoom[]) => void;
  /** A bar was clicked without dragging. */
  onFocus?: (zoomId: string) => void;
}) {
  const [drag, setDrag] = useState<BarDrag | null>(null);
  // A committed drag stays on screen until the saved zooms come back, so the bar doesn't jump back.
  const [pending, setPending] = useState<OverlayZoom[] | null>(null);
  const savedKey = JSON.stringify(zooms);
  useEffect(() => setPending(null), [savedKey]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), 4000);
    return () => clearTimeout(timer);
  }, [pending]);
  const base = pending ?? zooms;
  const shown = drag ? drag.zooms : base;

  /** Clip-second snap offset for an edge at clip second `t` (0 when nothing is near). */
  const snapOffset = (t: number): number => {
    if (!snapTimes?.length) return 0;
    let best = 0;
    let dist = SNAP_PX / pxPerSec;
    for (const s of snapTimes) {
      const d = s - clipStartSec - t;
      if (Math.abs(d) < dist) {
        dist = Math.abs(d);
        best = d;
      }
    }
    return best;
  };

  return (
    <>
      {shown.map((z, i) => {
        const original = base.find((x) => x.id === z.id);
        return (
          <div
            key={z.id}
            role="button"
            tabIndex={-1}
            title={`Zoom ${i + 1} · ${(clipStartSec + z.startSec).toFixed(2)}–${(clipStartSec + z.endSec).toFixed(2)}s · ${(1 / z.rect.size).toFixed(1)}×\nClick to edit · drag to move · drag an edge to resize · snaps to words (Alt: free)`}
            className={cn("absolute bottom-0.5 z-10 touch-none rounded-sm bg-foreground/75 hover:bg-foreground", size === "sm" ? "h-1.5" : "h-2", disabled ? "cursor-not-allowed" : "cursor-grab")}
            style={{ left: (z.startSec - shiftSec) * pxPerSec, width: Math.max(4, (z.endSec - z.startSec) * pxPerSec) }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              onGrab?.();
              if (disabled) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              const edge = ((e.target as HTMLElement).closest("[data-zedge]")?.getAttribute("data-zedge") ?? "move") as BarDrag["edge"];
              setDrag({ zoomId: z.id, edge, originX: e.clientX, moved: false, zooms: base });
            }}
            onPointerMove={(e) => {
              if (!drag || drag.zoomId !== z.id || !original) return;
              if (!drag.moved && Math.abs(e.clientX - drag.originX) < 3) return;
              let dt = (e.clientX - drag.originX) / pxPerSec;
              if (!e.altKey) {
                // Snap the edge being dragged (or the nearer edge of a moved bar) to a spoken word.
                const startSnap = snapOffset(original.startSec + dt);
                const endSnap = snapOffset(original.endSec + dt);
                if (drag.edge === "start") dt += startSnap;
                else if (drag.edge === "end") dt += endSnap;
                else if (startSnap || endSnap) dt += startSnap && (!endSnap || Math.abs(startSnap) <= Math.abs(endSnap)) ? startSnap : endSnap;
              }
              let start = original.startSec;
              let end = original.endSec;
              if (drag.edge === "move") {
                const length = end - start;
                start = Math.max(0, Math.min(clipDurationSec - length, start + dt));
                end = start + length;
              } else if (drag.edge === "start") start = Math.max(0, Math.min(end - MIN_ZOOM_SEC, start + dt));
              else end = Math.min(clipDurationSec, Math.max(start + MIN_ZOOM_SEC, end + dt));
              setDrag({ ...drag, moved: true, zooms: base.map((x) => (x.id === z.id ? { ...x, startSec: r3(start), endSec: r3(end) } : x)) });
            }}
            onPointerUp={(e) => {
              if (!drag || drag.zoomId !== z.id) {
                if (disabled) onFocus?.(z.id);
                return;
              }
              e.stopPropagation();
              e.currentTarget.releasePointerCapture(e.pointerId);
              const final = drag;
              setDrag(null);
              if (!final.moved) return onFocus?.(z.id);
              const next = normalizeZooms(final.zooms);
              setPending(next);
              onCommit(next);
            }}
            onPointerCancel={() => setDrag(null)}
          >
            <div data-zedge="start" className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" />
            <div data-zedge="end" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" />
          </div>
        );
      })}
    </>
  );
}
