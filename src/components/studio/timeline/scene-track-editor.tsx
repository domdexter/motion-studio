"use client";

import { Lock } from "lucide-react";
import { useRef, useState } from "react";
import type { TimedWord } from "@/core/spec/timing";
import { cn } from "@/lib/utils";
import type { SceneTrackContext } from "./timeline-tracks";

/**
 * Interactive scene track: scene blocks plus draggable boundaries. Dragging snaps to the gap
 * before the nearest spoken word (scenes stay audio-locked); hold Alt for free timing
 * (scenes become user-adjusted). The voice-over itself is never modified. A scene's transition in
 * shows as a hatched band over its first moments; clicking it opens the transition.
 */

export interface EditableTrackScene {
  id: string;
  key: string;
  name: string;
  startSec: number;
  endSec: number;
  timingMode: string;
  locked: boolean;
  staleTiming?: boolean;
  status?: string;
}

/** How a scene enters: it plays over the scene's first `duration` seconds (and the end of the previous scene underneath). */
export interface TrackTransition {
  type: string;
  duration: number;
  /** Set on the scene itself (false: the design system's default). */
  own: boolean;
}

function cutBeforeWord(words: TimedWord[], k: number): number {
  const w = words[k];
  const prevEnd = k > 0 ? words[k - 1].end : 0;
  const gap = Math.max(0, w.start - prevEnd);
  return w.start - Math.min(0.12, gap / 2);
}

/** Nearest cut point (just before a word) to `t`, strictly inside (min, max). */
export function snapToWord(words: TimedWord[], t: number, min: number, max: number): { time: number; word: TimedWord | null } {
  let best: { time: number; word: TimedWord | null } = { time: t, word: null };
  let bestDist = Infinity;
  for (let k = 1; k < words.length; k++) {
    const cut = cutBeforeWord(words, k);
    if (cut <= min || cut >= max) continue;
    const d = Math.abs(cut - t);
    if (d < bestDist) {
      bestDist = d;
      best = { time: cut, word: words[k] };
    }
  }
  return best;
}

interface DragState {
  index: number;
  time: number;
  snapped: boolean;
  word: TimedWord | null;
}

/** Keeps the transition's hit target clear of the boundary handle it starts at. */
const BOUNDARY_CLEARANCE_PX = 6;

export function SceneTrackEditor({
  ctx,
  scenes,
  words,
  selectedId,
  onSelect,
  onCommitBoundary,
  busy,
  transitions,
  selectedTransitionId,
  onSelectTransition,
}: {
  ctx: SceneTrackContext;
  scenes: EditableTrackScene[];
  words: TimedWord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCommitBoundary: (leftSceneId: string, timeSec: number, snap: boolean) => void;
  busy?: boolean;
  /** Each scene's transition in, by scene id (scenes that cut in have none). */
  transitions?: ReadonlyMap<string, TrackTransition>;
  /** The scene whose transition is selected. */
  selectedTransitionId?: string | null;
  onSelectTransition?: (sceneId: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const pps = ctx.pxPerSec;
  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return (clientX - rect.left) / pps;
  };

  return (
    <div ref={trackRef} className="absolute inset-0">
      {scenes.map((s, i) => {
        const width = Math.max(2, (s.endSec - s.startSec) * pps);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              onSelect(s.id);
              ctx.seek(s.startSec);
            }}
            title={`${s.key} · ${s.name}\n${s.startSec.toFixed(2)}–${s.endSec.toFixed(2)}s (${(s.endSec - s.startSec).toFixed(2)}s) · ${s.timingMode === "audio_locked" ? "audio-locked" : "user-adjusted"}${s.locked ? " · locked" : ""}`}
            className={cn(
              "absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border px-2 text-left text-[11px] leading-tight",
              i % 2 ? "border-track-scene/50 bg-track-scene/20" : "border-track-scene/40 bg-track-scene/12",
              selectedId === s.id && "ring-2 ring-primary",
              s.staleTiming && "border-stale/70 bg-stale/15",
            )}
            style={{ left: s.startSec * pps, width }}
          >
            <span className="block truncate font-medium">
              {s.locked ? <Lock className="mr-1 inline size-2.5" /> : null}
              {s.key.replace("scene_", "S")} {s.name}
            </span>
            <span className="block truncate font-mono text-[9px] text-muted-foreground">
              {(s.endSec - s.startSec).toFixed(2)}s{width > 170 ? ` · ${s.startSec.toFixed(2)}–${s.endSec.toFixed(2)}` : ""} · {s.timingMode === "audio_locked" ? "audio-locked" : "user-adjusted"}
            </span>
          </button>
        );
      })}
      {transitions
        ? scenes.map((s) => {
            const t = transitions.get(s.id);
            if (!t) return null;
            const left = s.startSec * pps;
            const width = Math.max(4, t.duration * pps);
            const selected = selectedTransitionId === s.id;
            const title = `${t.type} ${t.duration.toFixed(2)}s into ${s.key}${t.own ? "" : " (design default)"} — it plays over the end of the previous scene${onSelectTransition ? " · click to edit" : ""}`;
            return (
              <div key={`transition-${s.id}`}>
                <div
                  className={cn("pointer-events-none absolute top-1.5 bottom-1.5 z-10 rounded-l-md text-track-scene/70", selected && "text-primary")}
                  style={{ left, width, backgroundImage: "repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 6px)" }}
                />
                {onSelectTransition ? (
                  <button
                    type="button"
                    aria-label={title}
                    title={title}
                    className={cn("absolute top-1.5 bottom-1.5 z-10 rounded-sm hover:bg-foreground/10", selected && "ring-2 ring-primary")}
                    style={{ left: left + BOUNDARY_CLEARANCE_PX, width: Math.max(8, width - BOUNDARY_CLEARANCE_PX) }}
                    onClick={() => onSelectTransition(s.id)}
                  />
                ) : null}
              </div>
            );
          })
        : null}
      {scenes.slice(0, -1).map((s, i) => {
        const next = scenes[i + 1];
        if (Math.abs(next.startSec - s.endSec) > 0.05) return null;
        const locked = s.locked || next.locked;
        const active = drag?.index === i;
        const x = (active ? drag.time : s.endSec) * pps;
        return (
          <div
            key={`boundary-${s.id}`}
            className={cn("absolute top-0 bottom-0 z-20 w-3 -translate-x-1/2 touch-none", locked || busy ? "cursor-not-allowed" : "cursor-col-resize")}
            style={{ left: x }}
            title={locked ? `${s.locked ? s.key : next.key} is locked` : "Drag to move this boundary — snaps to words (hold Alt for free timing)"}
            onPointerDown={(e) => {
              if (locked || busy) return;
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ index: i, time: s.endSec, snapped: true, word: null });
            }}
            onPointerMove={(e) => {
              if (!active) return;
              const raw = Math.min(next.endSec - 0.2, Math.max(s.startSec + 0.2, timeAt(e.clientX)));
              if (e.altKey || !words.length) {
                setDrag({ index: i, time: raw, snapped: false, word: null });
              } else {
                const snap = snapToWord(words, raw, s.startSec + 0.05, next.endSec - 0.05);
                setDrag({ index: i, time: snap.word ? snap.time : raw, snapped: !!snap.word, word: snap.word });
              }
            }}
            onPointerUp={(e) => {
              if (!active) return;
              e.currentTarget.releasePointerCapture(e.pointerId);
              const final = drag;
              setDrag(null);
              if (Math.abs(final.time - s.endSec) > 0.01) onCommitBoundary(s.id, final.time, final.snapped);
            }}
          >
            <div className={cn("mx-auto h-full w-0.5 transition-colors", active ? "bg-primary" : locked ? "bg-muted-foreground/25" : "bg-foreground/35 hover:bg-primary")} />
            {active ? (
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-popover px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-popover-foreground shadow">
                {drag.time.toFixed(2)}s {drag.word ? `· before “${drag.word.text}”` : "· free timing"}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
