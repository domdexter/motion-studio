"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Clapperboard, Loader2, XCircle } from "lucide-react";
import type { ProductionStatus, StageState, StageStateKind } from "@/core/status/pipeline";
import { STATUS_LABELS } from "@/core/status/pipeline";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<ProductionStatus, string> = {
  DRAFT: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20",
  VOICE_READY: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
  TIMELINE_READY: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20",
  STORYBOARD_READY: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20",
  ASSETS_READY: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20",
  ANIMATION_READY: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/20",
  READY_TO_RENDER: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  RENDERING: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
  COMPLETE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
};

const STATUS_DOT: Record<ProductionStatus, string> = {
  DRAFT: "bg-zinc-400",
  VOICE_READY: "bg-sky-400",
  TIMELINE_READY: "bg-cyan-400",
  STORYBOARD_READY: "bg-indigo-400",
  ASSETS_READY: "bg-violet-400",
  ANIMATION_READY: "bg-fuchsia-400",
  READY_TO_RENDER: "bg-amber-400",
  RENDERING: "bg-blue-400 animate-pulse",
  COMPLETE: "bg-emerald-400",
};

export function StatusPill({ status, className }: { status: ProductionStatus; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap", STATUS_STYLES[status], className)}>
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABELS[status]}
    </span>
  );
}

const STAGE_DOT: Record<StageStateKind, string> = {
  missing: "border border-zinc-600 bg-transparent",
  ready: "bg-success",
  stale: "bg-stale",
  attention: "bg-warning",
  running: "bg-info animate-pulse",
  optional: "border border-dashed border-zinc-500 bg-transparent",
};

export const STAGE_TEXT: Record<StageStateKind, string> = {
  missing: "text-muted-foreground",
  ready: "text-success",
  stale: "text-stale",
  attention: "text-warning",
  running: "text-info",
  optional: "text-muted-foreground",
};

export function StageDot({ state, className, title }: { state: StageStateKind; className?: string; title?: string }) {
  const dot = <span className={cn("inline-block size-2 shrink-0 rounded-full", STAGE_DOT[state], className)} />;
  if (!title) return dot;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{dot}</TooltipTrigger>
      <TooltipContent side="right">{title}</TooltipContent>
    </Tooltip>
  );
}

export function StageIcon({ stage, className }: { stage: StageState; className?: string }) {
  const cls = cn("size-4 shrink-0", STAGE_TEXT[stage.state], className);
  switch (stage.state) {
    case "ready":
      return <CheckCircle2 className={cls} />;
    case "stale":
    case "attention":
      return <AlertTriangle className={cls} />;
    case "running":
      return <Loader2 className={cn(cls, "animate-spin")} />;
    default:
      return <CircleDashed className={cls} />;
  }
}

export function RenderStatusLine({ render }: { render: { status: string; progress: number; stale: boolean } | null }) {
  if (!render) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Clapperboard className="size-3.5" /> Not rendered
      </span>
    );
  }
  if (["queued", "bundling", "rendering", "encoding"].includes(render.status)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-info">
        <Loader2 className="size-3.5 animate-spin" /> Rendering {Math.round(render.progress * 100)}%
      </span>
    );
  }
  if (render.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive">
        <XCircle className="size-3.5" /> Render failed
      </span>
    );
  }
  if (render.status === "complete") {
    return render.stale ? (
      <span className="inline-flex items-center gap-1.5 text-stale">
        <AlertTriangle className="size-3.5" /> Render out of date
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-success">
        <CheckCircle2 className="size-3.5" /> Rendered
      </span>
    );
  }
  return <span className="text-muted-foreground capitalize">{render.status}</span>;
}
