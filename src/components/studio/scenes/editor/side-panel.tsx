"use client";

import { ClipboardCheck, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type SideTab = "inspector" | "review";

/**
 * The editor's side panel with two modes: the Inspector edits what is selected, Review holds the
 * creative intent, QA findings, storyboard, spec and versions. Both stay mounted, so switching keeps
 * unsaved text.
 */
export function SidePanel({
  tab,
  onTab,
  inspector,
  review,
  reviewBadge,
  onClose,
}: {
  tab: SideTab;
  onTab: (tab: SideTab) => void;
  inspector: React.ReactNode;
  review: React.ReactNode;
  /** Measured Creative QA findings for the scene. */
  reviewBadge?: number;
  /** Floating (narrow) panels can be closed. */
  onClose?: () => void;
}) {
  const item = (id: SideTab, label: string, Icon: LucideIcon, badge?: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => onTab(id)}
      className={cn(
        "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors",
        tab === id ? "bg-background text-foreground shadow-sm dark:bg-input/40" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" /> {label}
      {badge ? <span className="rounded-full bg-warning/20 px-1.5 text-[10px] leading-4 text-warning">{badge}</span> : null}
    </button>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <div role="tablist" aria-label="Side panel" className="flex flex-1 gap-0.5 rounded-lg bg-muted p-0.5">
          {item("inspector", "Inspector", SlidersHorizontal)}
          {item("review", "Review", ClipboardCheck, reviewBadge)}
        </div>
        {onClose ? (
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close the side panel">
            <X />
          </Button>
        ) : null}
      </div>
      <div className={cn("min-h-0 flex-1 flex-col", tab === "inspector" ? "flex" : "hidden")}>{inspector}</div>
      <div className={cn("min-h-0 flex-1 flex-col", tab === "review" ? "flex" : "hidden")}>{review}</div>
    </div>
  );
}
