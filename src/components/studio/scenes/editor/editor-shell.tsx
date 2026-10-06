"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The scene editor's fixed-height workspace: the toolbar on top, the preview with the side panel
 * (inspector and review) next to it, and the timeline docked at the bottom. The page never scrolls —
 * panels scroll inside. The splitters are draggable (double-click resets, arrow keys nudge) and their
 * sizes are remembered in this browser. Below `NARROW_EDITOR_PX` the side panel floats over the preview.
 */

const LAYOUT_KEY = "motion-studio:editor-layout:v1";
const SIDE = { default: 360, min: 300, max: 560 };
const TIMELINE = { default: 0.38, min: 0.16, max: 0.72 };
const MIN_TIMELINE_PX = 132;
const MIN_PREVIEW_PX = 180;
export const NARROW_EDITOR_PX = 900;

interface Layout {
  sideWidth: number;
  /** Share of the space under the toolbar that the timeline takes. */
  timelineShare: number;
}

const DEFAULT_LAYOUT: Layout = { sideWidth: SIDE.default, timelineShare: TIMELINE.default };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function readLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as Partial<Layout>;
    return {
      sideWidth: typeof raw.sideWidth === "number" ? clamp(raw.sideWidth, SIDE.min, SIDE.max) : SIDE.default,
      timelineShare: typeof raw.timelineShare === "number" ? clamp(raw.timelineShare, TIMELINE.min, TIMELINE.max) : TIMELINE.default,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function writeLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Storage unavailable: the sizes last for this page only.
  }
}

function Splitter({
  orientation,
  label,
  onDrag,
  onDragEnd,
  onReset,
  onStep,
}: {
  /** "vertical": a vertical bar between side-by-side panels; "horizontal": a bar between stacked panels. */
  orientation: "vertical" | "horizontal";
  label: string;
  onDrag: (clientX: number, clientY: number) => void;
  onDragEnd: () => void;
  onReset: () => void;
  /** Arrow keys: -1 shrinks the panel after the splitter, +1 grows it. */
  onStep: (direction: -1 | 1) => void;
}) {
  const [active, setActive] = useState(false);
  const vertical = orientation === "vertical";
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={label}
      title={`${label} — drag to resize, double-click to reset`}
      tabIndex={0}
      className={cn("group relative z-20 shrink-0 touch-none bg-border outline-none select-none", vertical ? "w-px cursor-col-resize" : "h-px cursor-row-resize")}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setActive(true);
      }}
      onPointerMove={(e) => active && onDrag(e.clientX, e.clientY)}
      onPointerUp={(e) => {
        if (!active) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        setActive(false);
        onDragEnd();
      }}
      onPointerCancel={() => {
        setActive(false);
        onDragEnd();
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const grow = vertical ? e.key === "ArrowLeft" : e.key === "ArrowUp";
        const shrink = vertical ? e.key === "ArrowRight" : e.key === "ArrowDown";
        if (!grow && !shrink) return;
        e.preventDefault();
        onStep(grow ? 1 : -1);
      }}
    >
      <div className={cn("absolute transition-colors group-hover:bg-primary/40 group-focus-visible:bg-primary/60", vertical ? "inset-y-0 -right-[3px] -left-[3px]" : "inset-x-0 -top-[3px] -bottom-[3px]", active && "bg-primary/60")} />
    </div>
  );
}

export function EditorShell({
  toolbar,
  banner,
  preview,
  side,
  timeline,
  sideOpen,
  onNarrowChange,
}: {
  toolbar: React.ReactNode;
  /** Optional strip under the toolbar (e.g. "this scene is locked"). */
  banner?: React.ReactNode;
  preview: React.ReactNode;
  side: React.ReactNode;
  timeline: React.ReactNode;
  /** Narrow layouts only: whether the floating side panel is shown. */
  sideOpen: boolean;
  onNarrowChange?: (narrow: boolean) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [bodyHeight, setBodyHeight] = useState(0);
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => setLayout(readLayout()), []);
  useEffect(() => {
    const shell = shellRef.current;
    const body = bodyRef.current;
    if (!shell || !body) return;
    const ro = new ResizeObserver(() => {
      setWidth(Math.floor(shell.clientWidth));
      setBodyHeight(Math.floor(body.clientHeight));
    });
    ro.observe(shell);
    ro.observe(body);
    return () => ro.disconnect();
  }, []);

  const narrow = width > 0 && width < NARROW_EDITOR_PX;
  const onNarrowRef = useRef(onNarrowChange);
  onNarrowRef.current = onNarrowChange;
  useEffect(() => onNarrowRef.current?.(narrow), [narrow]);

  const sideWidth = clamp(layout.sideWidth, SIDE.min, Math.max(SIDE.min, Math.min(SIDE.max, width * 0.45)));
  const timelineHeight = bodyHeight > 0 ? clamp(layout.timelineShare * bodyHeight, MIN_TIMELINE_PX, Math.max(MIN_TIMELINE_PX, bodyHeight - MIN_PREVIEW_PX)) : null;
  const update = (patch: Partial<Layout>) => setLayout((l) => ({ ...l, ...patch }));
  const persist = () => writeLayout(layoutRef.current);

  return (
    <div ref={shellRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {toolbar}
      {banner}
      <div ref={bodyRef} className="relative flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col">{preview}</div>
          {narrow ? (
            sideOpen ? (
              <aside className="absolute inset-y-0 right-0 z-40 flex flex-col border-l border-border bg-panel shadow-2xl" style={{ width: Math.min(sideWidth, Math.max(280, width - 48)) }}>
                {side}
              </aside>
            ) : null
          ) : (
            <>
              <Splitter
                orientation="vertical"
                label="Resize the side panel"
                onDrag={(clientX) => {
                  const rect = shellRef.current?.getBoundingClientRect();
                  if (rect) update({ sideWidth: clamp(rect.right - clientX, SIDE.min, SIDE.max) });
                }}
                onDragEnd={persist}
                onReset={() => {
                  update({ sideWidth: SIDE.default });
                  writeLayout({ ...layoutRef.current, sideWidth: SIDE.default });
                }}
                onStep={(direction) => {
                  const next = { ...layoutRef.current, sideWidth: clamp(sideWidth + direction * 20, SIDE.min, SIDE.max) };
                  setLayout(next);
                  writeLayout(next);
                }}
              />
              <aside className="flex min-h-0 shrink-0 flex-col bg-panel" style={{ width: sideWidth }}>
                {side}
              </aside>
            </>
          )}
        </div>
        <Splitter
          orientation="horizontal"
          label="Resize the timeline"
          onDrag={(_x, clientY) => {
            const rect = bodyRef.current?.getBoundingClientRect();
            if (rect && rect.height > 0) update({ timelineShare: clamp((rect.bottom - clientY) / rect.height, TIMELINE.min, TIMELINE.max) });
          }}
          onDragEnd={persist}
          onReset={() => {
            update({ timelineShare: TIMELINE.default });
            writeLayout({ ...layoutRef.current, timelineShare: TIMELINE.default });
          }}
          onStep={(direction) => {
            const next = { ...layoutRef.current, timelineShare: clamp(layoutRef.current.timelineShare + direction * 0.04, TIMELINE.min, TIMELINE.max) };
            setLayout(next);
            writeLayout(next);
          }}
        />
        <div className="flex min-h-0 shrink-0 flex-col" style={{ height: timelineHeight ?? `${layout.timelineShare * 100}%` }}>
          {timeline}
        </div>
      </div>
    </div>
  );
}
