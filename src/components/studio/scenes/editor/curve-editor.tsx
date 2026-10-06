"use client";

import { useRef, useState } from "react";
import { bezierForEasing, easingFunction, isCustomEasing } from "@/core/motion/easing";
import type { CustomEasing, KeyframeEasingValue } from "@/core/spec/scene";
import { cn } from "@/lib/utils";

/**
 * The curve editor — one visual editor for the easing of an interpolation stretch, whatever the
 * property is. It edits the two control points of a cubic Bézier on a normalised 0..1 box: time runs
 * left to right, the value from bottom (the stretch's first keyframe) to top (its second).
 *
 * The curve itself is sampled from `core/motion/easing.ts`, the one implementation the renderer uses,
 * so what is drawn here is exactly what renders. Dragging previews continuously and saves once, on
 * release — one undo step for a drag.
 */

const BOX = 100;
/** Room above and below the box for a curve that overshoots (backOut, spring). */
const PAD = 34;
const HEIGHT = BOX + PAD * 2;
const SAMPLES = 40;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const toSvg = (x: number, y: number): [number, number] => [x * BOX, PAD + (1 - y) * BOX];

function curvePath(easing: KeyframeEasingValue | undefined): string {
  const fn = easingFunction(isCustomEasing(easing) ? easing : easing === "hold" ? "linear" : easing, "linear");
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const [x, y] = toSvg(t, fn(t));
    points.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

type Handle = 0 | 1;

export function CurveEditor({
  easing,
  disabled,
  onPreview,
  onCommit,
  fromLabel,
  toLabel,
}: {
  easing: KeyframeEasingValue | undefined;
  disabled?: boolean;
  /** While dragging (nothing is saved). */
  onPreview?: (easing: CustomEasing) => void;
  /** On release, on an arrow key: one saved change. */
  onCommit: (easing: CustomEasing) => void;
  fromLabel?: string;
  toLabel?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<Handle | null>(null);
  // `hold` keeps its value until the next keyframe, so there is no curve to draw — show a flat line.
  const stepped = easing === "hold";
  const bezier = bezierForEasing(stepped ? "linear" : easing);
  const points: [number, number][] = [
    [bezier[0], bezier[1]],
    [bezier[2], bezier[3]],
  ];

  const moved = (handle: Handle, x: number, y: number): CustomEasing => {
    const next: CustomEasing["bezier"] = [...bezier];
    next[handle * 2] = round3(clamp01(x));
    next[handle * 2 + 1] = round3(Math.max(-2, Math.min(3, y)));
    return { bezier: next };
  };

  const pointerValue = (event: { clientX: number; clientY: number }): [number, number] => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return [0, 0];
    return [(event.clientX - box.left) / box.width, 1 - (((event.clientY - box.top) / box.height) * HEIGHT - PAD) / BOX];
  };

  const startDrag = (handle: Handle) => (event: React.PointerEvent<SVGCircleElement>) => {
    if (disabled) return;
    event.preventDefault();
    // Capture keeps the drag alive outside the handle; a device that refuses it still drags inside it.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    setDragging(handle);
  };

  const onMove = (handle: Handle) => (event: React.PointerEvent<SVGCircleElement>) => {
    if (dragging !== handle) return;
    const [x, y] = pointerValue(event);
    onPreview?.(moved(handle, x, y));
  };

  const endDrag = (handle: Handle) => (event: React.PointerEvent<SVGCircleElement>) => {
    if (dragging !== handle) return;
    setDragging(null);
    const [x, y] = pointerValue(event);
    onCommit(moved(handle, x, y));
  };

  const nudge = (handle: Handle) => (event: React.KeyboardEvent<SVGCircleElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = delta[event.key];
    if (!move || disabled) return;
    event.preventDefault();
    onCommit(moved(handle, points[handle][0] + move[0], points[handle][1] + move[1]));
  };

  return (
    <div className="space-y-1">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${BOX} ${HEIGHT}`}
        preserveAspectRatio="none"
        className={cn("h-28 w-full touch-none rounded-md border border-border/70 bg-muted/40", disabled && "opacity-50")}
        role="group"
        aria-label="Easing curve"
      >
        <rect x={0} y={PAD} width={BOX} height={BOX} fill="none" stroke="currentColor" strokeWidth={0.5} className="text-border" />
        <line x1={0} y1={PAD + BOX} x2={BOX} y2={PAD} stroke="currentColor" strokeWidth={0.5} strokeDasharray="2 3" className="text-muted-foreground/50" />
        {stepped ? (
          <>
            <line x1={0} y1={PAD + BOX} x2={BOX} y2={PAD + BOX} stroke="currentColor" strokeWidth={2} className="text-keyframe" />
            <line x1={BOX} y1={PAD + BOX} x2={BOX} y2={PAD} stroke="currentColor" strokeWidth={2} strokeDasharray="3 3" className="text-keyframe" />
          </>
        ) : (
          <>
            {points.map((p, i) => {
              const [hx, hy] = toSvg(p[0], p[1]);
              const [ax, ay] = toSvg(i === 0 ? 0 : 1, i === 0 ? 0 : 1);
              return <line key={i} x1={ax} y1={ay} x2={hx} y2={hy} stroke="currentColor" strokeWidth={0.75} className="text-keyframe/50" />;
            })}
            <path d={curvePath(easing)} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" className="text-keyframe" />
            {points.map((p, i) => {
              const [hx, hy] = toSvg(p[0], p[1]);
              return (
                <circle
                  key={i}
                  cx={hx}
                  cy={hy}
                  r={4.5}
                  className={cn("cursor-grab fill-background stroke-keyframe", dragging === i && "cursor-grabbing fill-keyframe")}
                  strokeWidth={2}
                  tabIndex={disabled ? -1 : 0}
                  role="slider"
                  aria-label={`${i === 0 ? "First" : "Second"} curve handle`}
                  aria-valuetext={`${round3(p[0])}, ${round3(p[1])}`}
                  onPointerDown={startDrag(i as Handle)}
                  onPointerMove={onMove(i as Handle)}
                  onPointerUp={endDrag(i as Handle)}
                  onPointerCancel={endDrag(i as Handle)}
                  onKeyDown={nudge(i as Handle)}
                />
              );
            })}
          </>
        )}
      </svg>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="truncate">{fromLabel ?? "Start"}</span>
        <span className="font-mono tabular-nums">{stepped ? "hold" : `${round3(bezier[0])}, ${round3(bezier[1])}, ${round3(bezier[2])}, ${round3(bezier[3])}`}</span>
        <span className="truncate">{toLabel ?? "End"}</span>
      </div>
    </div>
  );
}
