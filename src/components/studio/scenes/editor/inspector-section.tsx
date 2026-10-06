"use client";

import { ChevronRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/** Building blocks of the editor inspector: collapsible sections (open state remembered), compact number fields, sliders and icon actions. */

const SECTIONS_KEY = "motion-studio:inspector-sections";
let remembered: Record<string, boolean> | null = null;

function rememberedSections(): Record<string, boolean> {
  if (remembered) return remembered;
  try {
    remembered = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    remembered = {};
  }
  return remembered;
}

export function InspectorSection({
  id,
  title,
  summary,
  actions,
  defaultOpen = true,
  focused = false,
  children,
}: {
  /** Remembers whether it's open, per section kind (e.g. "media.zoom"). */
  id: string;
  title: string;
  /** Shown next to the title while collapsed. */
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  /** Opens the section, scrolls it into view and tints it (what was picked on the timeline). */
  focused?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const saved = rememberedSections()[id];
    if (saved !== undefined) setOpen(saved);
  }, [id]);
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);
  const change = (next: boolean) => {
    setOpen(next);
    remembered = { ...rememberedSections(), [id]: next };
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(remembered));
    } catch {
      // Storage unavailable: the section stays as set for this page only.
    }
  };
  return (
    <Collapsible ref={rootRef} open={open} onOpenChange={change} className={cn("border-b border-border transition-colors", focused && "bg-primary/[0.05]")}>
      <div className="flex h-9 items-center gap-1 pr-2">
        <CollapsibleTrigger className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 text-left text-[11px] font-semibold tracking-wide text-foreground/85 uppercase outline-none hover:text-foreground focus-visible:text-primary">
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="shrink-0">{title}</span>
          {summary !== undefined && summary !== null && !open ? <span className="min-w-0 truncate font-mono text-[10px] font-normal tracking-normal text-muted-foreground normal-case">{summary}</span> : null}
        </CollapsibleTrigger>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      <CollapsibleContent className="space-y-3 px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** A small icon button for inspector headers; the label is its tooltip and accessible name. */
export function IconAction({ label, ...props }: { label: string } & Omit<React.ComponentProps<typeof Button>, "size" | "variant" | "aria-label" | "title">) {
  return <Button size="icon-xs" variant="ghost" aria-label={label} title={label} {...props} />;
}

const round = (n: number, step: number) => {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(n.toFixed(decimals));
};

/**
 * A compact number field. Drag its label sideways to scrub the value (Shift: 10× steps), or press ↑/↓
 * in the field (Shift: 10×); type a value and press Enter or leave the field to commit. `onPreview`
 * shows scrubbed values before they commit; `onCancel` runs when a scrub ends where it started;
 * `onReset` (while the value is set) adds a button back to the default.
 */
export function ScrubField({
  label,
  value,
  onCommit,
  onPreview,
  onCancel,
  onReset,
  scrubStart,
  step = 1,
  min,
  max,
  unit,
  placeholder,
  disabled,
  title,
  className,
}: {
  label: string;
  value: number | null;
  onCommit: (n: number) => void;
  onPreview?: (n: number) => void;
  onCancel?: () => void;
  onReset?: () => void;
  /** Where scrubbing starts while the value is empty (e.g. the size an "auto" side has). */
  scrubStart?: number;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const shown = value === null ? "" : String(round(value, step));
  const [text, setText] = useState(shown);
  const [scrubbing, setScrubbing] = useState(false);
  const drag = useRef<{ x: number; start: number; last: number } | null>(null);
  const stepping = useRef(false);
  // Typed (or stepped with the arrow keys) since the last save. Only then does leaving the field save: its text is otherwise the value
  // rounded to the step, and it may already show another value (the field now edits something else).
  const dirty = useRef(false);
  useEffect(() => {
    if (scrubbing) return;
    setText(shown);
    dirty.current = false;
  }, [shown, scrubbing]);
  const clampValue = (n: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));

  const commitText = () => {
    if (!dirty.current) return;
    dirty.current = false;
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return setText(shown);
    const next = round(clampValue(n), step);
    if (value === null || Math.abs(next - value) > step / 1000) onCommit(next);
    else setText(shown);
  };

  return (
    <label className={cn("flex h-7 min-w-0 items-center rounded-md border border-input bg-background/60 focus-within:border-ring dark:bg-input/30", disabled && "opacity-50", className)} title={title}>
      <span
        className={cn("flex h-full shrink-0 touch-none items-center px-1.5 text-[10px] font-medium text-muted-foreground select-none", !disabled && "cursor-ew-resize hover:text-foreground")}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          const start = round(value ?? scrubStart ?? 0, step);
          drag.current = { x: e.clientX, start, last: start };
          setScrubbing(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const next = round(clampValue(d.start + Math.round((e.clientX - d.x) / 3) * step * (e.shiftKey ? 10 : 1)), step);
          if (next === d.last) return;
          d.last = next;
          setText(String(next));
          onPreview?.(next);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          drag.current = null;
          setScrubbing(false);
          if (d.last !== d.start) onCommit(d.last);
          else onCancel?.();
        }}
      >
        {label}
      </span>
      <input
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="decimal"
        className="h-full w-full min-w-0 bg-transparent pr-1 font-mono text-[11px] tabular-nums outline-none placeholder:text-muted-foreground/70"
        onChange={(e) => {
          dirty.current = true;
          setText(e.target.value);
        }}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitText();
          if (e.key === "Escape") {
            dirty.current = false;
            setText(shown);
            e.currentTarget.blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            // Step from what's typed (or the value, or where scrubbing starts); saves when the key is released.
            e.preventDefault();
            const typed = Number(text);
            const from = text.trim() !== "" && Number.isFinite(typed) ? typed : (value ?? scrubStart ?? 0);
            const next = round(clampValue(from + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)), step);
            stepping.current = true;
            dirty.current = true;
            setText(String(next));
            onPreview?.(next);
          }
        }}
        onKeyUp={(e) => {
          if ((e.key === "ArrowUp" || e.key === "ArrowDown") && stepping.current) {
            stepping.current = false;
            commitText();
          }
        }}
      />
      {unit ? <span className="shrink-0 pr-1.5 text-[10px] text-muted-foreground">{unit}</span> : null}
      {onReset && !disabled ? (
        <button
          type="button"
          className="mr-0.5 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Reset ${label} to its default`}
          title={`Reset ${label} to its default`}
          onClick={(e) => {
            e.preventDefault();
            onReset();
          }}
        >
          <RotateCcw className="size-2.5" />
        </button>
      ) : null}
    </label>
  );
}

/** A labelled slider with its value; `onPreview` follows the drag, `onCommit` saves on release. `accessory` sits after the value (a keyframe toggle). */
export function SliderRow({
  label,
  value,
  display,
  min = 0,
  max = 1,
  step = 0.01,
  disabled,
  onPreview,
  onCommit,
  accessory,
  title,
  className,
}: {
  label: string;
  value: number;
  display: (value: number) => string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onPreview?: (value: number) => void;
  onCommit: (value: number) => void;
  accessory?: React.ReactNode;
  title?: string;
  className?: string;
}) {
  const [live, setLive] = useState<number | null>(null);
  useEffect(() => setLive(null), [value]);
  const shown = live ?? value;
  return (
    <div className="space-y-1.5" title={title}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1">
          <span className={cn("font-mono text-[11px] tabular-nums", className)}>{display(shown)}</span>
          {accessory}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[shown]}
        disabled={disabled}
        aria-label={label}
        onValueChange={([v]) => {
          setLive(v);
          onPreview?.(v);
        }}
        onValueCommit={([v]) => onCommit(v)}
      />
    </div>
  );
}
