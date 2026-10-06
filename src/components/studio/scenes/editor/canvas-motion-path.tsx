"use client";

import { useRef, useState } from "react";
import { pathAt, pathControlPoints, pathData } from "@/core/motion/path";
import type { MotionPath, Point } from "@/core/spec/scene";
import { cn } from "@/lib/utils";
import type { StageGeometry } from "./preview-panel";

/**
 * The motion path on the canvas: the curve the selected element travels, its ends, its shape handles
 * and a marker where the element is on it right now. Dragging a point previews the whole element moving
 * along the new curve and saves once, on release — one undo step per drag.
 *
 * It draws inside the same stage as the selection box and uses the same selection: a path belongs to the
 * element that is selected, so there is no second thing to select.
 */

type Handle = "from" | "to" | "c1" | "c2";

const HANDLE_LABEL: Record<Handle, string> = { from: "Path start", to: "Path end", c1: "Path curve handle", c2: "Path second curve handle" };

export function MotionPathLayer({
  path,
  stage,
  progress,
  locked,
  onPreview,
  onCommit,
}: {
  path: MotionPath;
  stage: StageGeometry;
  /** Where the element is along the path at the playhead (0..1), or null when it isn't on screen. */
  progress: number | null;
  locked: boolean;
  onPreview: (path: MotionPath) => void;
  onCommit: (path: MotionPath) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<Handle | null>(null);
  const toPx = (p: Point): [number, number] => [(p[0] / 100) * stage.width, (p[1] / 100) * stage.height];
  const points = pathControlPoints(path);
  const handles: { handle: Handle; point: Point }[] = [
    { handle: "from", point: path.from },
    { handle: "to", point: path.to },
    ...(path.type !== "linear" ? [{ handle: "c1" as Handle, point: points[1] }] : []),
    ...(path.type === "cubic" ? [{ handle: "c2" as Handle, point: points[2] }] : []),
  ];

  const moved = (handle: Handle, event: { clientX: number; clientY: number }): MotionPath => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return path;
    const x = Math.round((((event.clientX - box.left) / box.width) * 100 + Number.EPSILON) * 100) / 100;
    const y = Math.round((((event.clientY - box.top) / box.height) * 100 + Number.EPSILON) * 100) / 100;
    const point: Point = [Math.max(-50, Math.min(150, x)), Math.max(-50, Math.min(150, y))];
    if (handle === "from" || handle === "to") return { ...path, [handle]: point };
    return { ...path, [handle]: point };
  };

  const start = (handle: Handle) => (event: React.PointerEvent<SVGCircleElement>) => {
    if (locked) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    setDragging(handle);
  };
  const move = (handle: Handle) => (event: React.PointerEvent<SVGCircleElement>) => {
    if (dragging !== handle) return;
    onPreview(moved(handle, event));
  };
  const end = (handle: Handle) => (event: React.PointerEvent<SVGCircleElement>) => {
    if (dragging !== handle) return;
    setDragging(null);
    onCommit(moved(handle, event));
  };

  const at = progress === null ? null : toPx(pathAt(path, progress).point);

  return (
    <svg ref={svgRef} className="pointer-events-none absolute inset-0 overflow-visible" width={stage.width} height={stage.height} aria-hidden={false} role="group" aria-label="Motion path">
      <path d={pathData(path, stage.width / 100, stage.height / 100)} fill="none" stroke="black" strokeOpacity={0.35} strokeWidth={4} />
      <path d={pathData(path, stage.width / 100, stage.height / 100)} fill="none" className="stroke-keyframe" strokeWidth={2} strokeDasharray="6 4" />
      {path.type !== "linear"
        ? handles
            .filter((h) => h.handle === "c1" || h.handle === "c2")
            .map(({ handle, point }) => {
              const anchor = handle === "c1" ? path.from : path.to;
              const [ax, ay] = toPx(anchor);
              const [hx, hy] = toPx(point);
              return <line key={`line-${handle}`} x1={ax} y1={ay} x2={hx} y2={hy} className="stroke-keyframe/50" strokeWidth={1} />;
            })
        : null}
      {at ? <circle cx={at[0]} cy={at[1]} r={5} className="fill-primary stroke-white" strokeWidth={2} /> : null}
      {handles.map(({ handle, point }) => {
        const [x, y] = toPx(point);
        const control = handle === "c1" || handle === "c2";
        return (
          <circle
            key={handle}
            cx={x}
            cy={y}
            r={control ? 5 : 6}
            className={cn("pointer-events-auto stroke-white", control ? "fill-keyframe/80" : "fill-keyframe", locked ? "cursor-default" : "cursor-grab", dragging === handle && "cursor-grabbing")}
            strokeWidth={2}
            role="button"
            aria-label={HANDLE_LABEL[handle]}
            onPointerDown={start(handle)}
            onPointerMove={move(handle)}
            onPointerUp={end(handle)}
            onPointerCancel={end(handle)}
          />
        );
      })}
    </svg>
  );
}
