"use client";

import { Scissors, X } from "lucide-react";
import { useRef, useState } from "react";
import { dragVoiceCut, normalizeVoiceCuts, setVoiceTrim, type VoiceCut, type VoiceCutEdge } from "@/core/timeline/audio-clips";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SceneTrackContext } from "./timeline-tracks";

/**
 * Voice-over trimming, drawn over the waveform. The voice-over never moves (every scene is anchored
 * to its words), so trimming mutes: drag the bracket at either end to trim the start or the end,
 * double-click to mute a section, drag a muted section or its edges, press Delete to remove it.
 * Snaps to word starts/ends and the playhead (hold Alt to place freely).
 */

interface DragState {
  target: number | "in" | "out";
  edge: VoiceCutEdge;
  originX: number;
  moved: boolean;
  cuts: VoiceCut[];
  snappedTo: number | null;
}

const SNAP_PX = 8;
const EDGE_EPS = 0.0005;
const HATCH = "repeating-linear-gradient(135deg, rgba(0,0,0,0.45) 0 4px, rgba(0,0,0,0.2) 4px 8px)";
const sameCuts = (a: VoiceCut[], b: VoiceCut[]) => JSON.stringify(a) === JSON.stringify(b);

export function VoiceCutEditor({
  ctx,
  cuts,
  durationSec,
  selected,
  onSelect,
  onCommit,
  busy,
}: {
  ctx: SceneTrackContext;
  cuts: VoiceCut[];
  /** Length of the voice-over (the video can run longer). */
  durationSec: number;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onCommit: (cuts: VoiceCut[]) => void;
  busy?: boolean;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const pps = ctx.pxPerSec;
  const shown = drag?.moved ? drag.cuts : cuts;
  const hasLead = shown.some((c) => c.startSec <= EDGE_EPS);
  const hasTail = shown.some((c) => c.endSec >= durationSec - EDGE_EPS);
  const timeAt = (clientX: number) => Math.max(0, Math.min(durationSec, (clientX - laneRef.current!.getBoundingClientRect().left) / pps));

  const nearest = (value: number, ignore?: VoiceCut): number | null => {
    const others = cuts.filter((c) => c !== ignore).flatMap((c) => [c.startSec, c.endSec]);
    const points = [0, durationSec, ctx.currentTime, ...others, ...ctx.words.flatMap((w) => [w.start, w.end])];
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

  const begin = (e: React.PointerEvent, target: DragState["target"], edge: VoiceCutEdge) => {
    if (busy || e.button !== 0) return;
    e.stopPropagation();
    laneRef.current?.setPointerCapture(e.pointerId);
    setDrag({ target, edge, originX: e.clientX, moved: false, cuts, snappedTo: null });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.originX) < 3) return;
    let dt = (e.clientX - drag.originX) / pps;
    let snappedTo: number | null = null;
    if (drag.target === "in" || drag.target === "out") {
      let t = (drag.target === "in" ? 0 : durationSec) + dt;
      const s = e.altKey ? null : nearest(t);
      if (s !== null) {
        t = s;
        snappedTo = s;
      }
      setDrag({ ...drag, moved: true, cuts: setVoiceTrim(cuts, drag.target, t, durationSec), snappedTo });
      return;
    }
    const cut = cuts[drag.target];
    if (!cut) return;
    if (!e.altKey) {
      if (drag.edge === "move") {
        const s = nearest(cut.startSec + dt, cut);
        const en = nearest(cut.endSec + dt, cut);
        const ds = s === null ? Infinity : Math.abs(s - (cut.startSec + dt));
        const de = en === null ? Infinity : Math.abs(en - (cut.endSec + dt));
        if (s !== null && ds <= de) {
          dt = s - cut.startSec;
          snappedTo = s;
        } else if (en !== null) {
          dt = en - cut.endSec;
          snappedTo = en;
        }
      } else {
        const edgeTime = drag.edge === "start" ? cut.startSec : cut.endSec;
        const s = nearest(edgeTime + dt, cut);
        if (s !== null) {
          dt = s - edgeTime;
          snappedTo = s;
        }
      }
    }
    setDrag({ ...drag, moved: true, cuts: dragVoiceCut(cuts, drag.target, drag.edge, dt, durationSec), snappedTo });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    if (laneRef.current?.hasPointerCapture(e.pointerId)) laneRef.current.releasePointerCapture(e.pointerId);
    const final = drag;
    setDrag(null);
    if (!final.moved) {
      ctx.seek(timeAt(e.clientX));
      return;
    }
    const next = normalizeVoiceCuts(final.cuts, durationSec);
    if (!sameCuts(next, cuts)) {
      onCommit(next);
      onSelect(null);
    }
  };

  const draggedCut = drag?.moved ? (typeof drag.target === "number" ? drag.cuts[drag.target] : null) : null;
  const readoutAt = drag?.moved ? (drag.snappedTo ?? (draggedCut ? (drag.edge === "end" ? draggedCut.endSec : draggedCut.startSec) : null)) : null;

  return (
    <div
      ref={laneRef}
      className="absolute inset-0"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget || busy) return;
        const t = timeAt(e.clientX);
        if (t >= durationSec) return;
        onCommit(normalizeVoiceCuts([...cuts, { startSec: t - 0.25, endSec: t + 0.25 }], durationSec));
      }}
    >
      {shown.map((cut, i) => {
        const width = Math.max(4, (cut.endSec - cut.startSec) * pps);
        return (
          <div
            key={`${i}-${cut.startSec}`}
            role="button"
            tabIndex={0}
            aria-label={`Muted ${cut.startSec.toFixed(2)}–${cut.endSec.toFixed(2)}s`}
            title={`Muted ${cut.startSec.toFixed(2)}–${cut.endSec.toFixed(2)}s\nDrag to move · drag an edge to resize · Delete removes · Alt: no snapping`}
            className={cn(
              "absolute inset-y-0 touch-none border-x-2 border-destructive/70 select-none",
              busy ? "cursor-progress" : "cursor-grab active:cursor-grabbing",
              selected === i && "ring-2 ring-primary ring-inset",
            )}
            style={{ left: cut.startSec * pps, width, backgroundImage: HATCH }}
            onPointerDown={(e) => {
              onSelect(i);
              const edge = ((e.target as HTMLElement).closest("[data-edge]")?.getAttribute("data-edge") ?? "move") as VoiceCutEdge;
              begin(e, i, edge);
            }}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                onCommit(cuts.filter((_, j) => j !== i));
                onSelect(null);
              }
            }}
          >
            {width > 52 ? (
              <span className="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 rounded bg-black/60 px-1 text-[9px] font-medium tracking-wide text-white uppercase">muted</span>
            ) : null}
            <div data-edge="start" className="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize hover:bg-destructive/40" />
            <div data-edge="end" className="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize hover:bg-destructive/40" />
          </div>
        );
      })}
      {!hasLead ? (
        <div
          role="slider"
          aria-label="Trim the start of the voice-over"
          aria-valuenow={0}
          title="Drag to trim the start of the voice-over (mutes it; timing stays)"
          className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize touch-none rounded-l border-y-2 border-l-4 border-track-voice/80 hover:bg-track-voice/25"
          onPointerDown={(e) => begin(e, "in", "move")}
        />
      ) : null}
      {!hasTail ? (
        <div
          role="slider"
          aria-label="Trim the end of the voice-over"
          aria-valuenow={durationSec}
          title="Drag to trim the end of the voice-over (mutes it; timing stays)"
          className="absolute inset-y-0 w-2.5 cursor-ew-resize touch-none rounded-r border-y-2 border-r-4 border-track-voice/80 hover:bg-track-voice/25"
          style={{ left: Math.max(0, durationSec * pps - 10) }}
          onPointerDown={(e) => begin(e, "out", "move")}
        />
      ) : null}
      {readoutAt !== null ? (
        <div className="pointer-events-none absolute top-0 z-30 -translate-x-1/2 rounded bg-popover px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-popover-foreground shadow" style={{ left: readoutAt * pps }}>
          {readoutAt.toFixed(2)}s{drag?.snappedTo !== null ? " · snapped" : ""}
        </div>
      ) : drag?.moved && (drag.target === "in" || drag.target === "out") ? (
        <div className="pointer-events-none absolute top-0 z-30 -translate-x-1/2 rounded bg-popover px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-popover-foreground shadow" style={{ left: (drag.target === "in" ? 0 : durationSec) * pps }}>
          {drag.target === "in" ? "start" : "end"}
        </div>
      ) : null}
    </div>
  );
}

/** The muted sections as chips under the timeline: click to jump there, ✕ to remove. */
export function VoiceCutsBar({ cuts, onSeek, onCommit, busy }: { cuts: VoiceCut[]; onSeek: (t: number) => void; onCommit: (cuts: VoiceCut[]) => void; busy?: boolean }) {
  if (!cuts.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="flex items-center gap-1 text-muted-foreground">
        <Scissors className="size-3.5" /> Muted voice-over:
      </span>
      {cuts.map((c, i) => (
        <span key={`${i}-${c.startSec}`} className="flex items-center rounded-md border border-destructive/40 bg-destructive/10">
          <button type="button" className="px-1.5 py-0.5 font-mono" onClick={() => onSeek(c.startSec)} title="Jump to this section">
            {c.startSec.toFixed(2)}–{c.endSec.toFixed(2)}s
          </button>
          <button type="button" disabled={busy} className="border-l border-destructive/30 px-1 py-0.5 hover:bg-destructive/20" aria-label="Unmute this section" onClick={() => onCommit(cuts.filter((_, j) => j !== i))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      {cuts.length > 1 ? (
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => onCommit([])}>
          Unmute all
        </Button>
      ) : null}
    </div>
  );
}
