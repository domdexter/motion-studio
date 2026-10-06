"use client";

import { Trash2 } from "lucide-react";
import { isGroup, type SceneElement, type SceneSpec } from "@/core/spec/scene";
import type { ElementRef } from "@/core/timeline/element-layout";
import { sameRef } from "@/core/timeline/element-ops";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ElementMenuItems, type ElementActions } from "./element-actions";
import { elementIcon, elementName, summarizeElement } from "./element-summary";

/** A list's elements in the order they draw, top first (higher layer first, then later in the list). */
function topFirst(elements: SceneElement[]): { element: SceneElement; index: number }[] {
  return elements.map((element, index) => ({ element, index })).sort((a, b) => (b.element.z ?? 0) - (a.element.z ?? 0) || b.index - a.index);
}

/**
 * The scene's elements and its shots' elements, top layer first. Click selects, Shift (or Ctrl/⌘)
 * click adds to or removes from the selection; right-click opens the element menu.
 */
export function LayersList({
  spec,
  selected,
  blockedReason,
  busy,
  actions,
  onSelect,
  onRemove,
}: {
  spec: SceneSpec;
  selected: readonly ElementRef[];
  blockedReason: string | null;
  busy: boolean;
  actions: ElementActions;
  onSelect: (ref: ElementRef, additive: boolean) => void;
  onRemove: (ref: ElementRef) => void;
}) {
  const isSelected = (ref: ElementRef) => selected.some((r) => sameRef(r, ref));
  /** A group's children are listed under it, indented, and selected the same way. */
  const rows = (element: SceneElement, ref: ElementRef) =>
    isGroup(element) ? [row(element, ref), <li key={`${ref.index}-children`} className="ml-3 border-l border-border pl-1"><ul className="space-y-px">{topFirst(element.children as SceneElement[]).map(({ element: child, index }) => row(child, { ...ref, child: index }))}</ul></li>] : [row(element, ref)];
  const row = (element: SceneElement, ref: ElementRef) => {
    const Icon = elementIcon(element.type);
    const name = elementName(element, ref);
    const summary = summarizeElement(element);
    const active = isSelected(ref);
    return (
      <ContextMenu key={`${ref.shotId ?? ""}:${ref.index}:${ref.child ?? ""}`}>
        <ContextMenuTrigger asChild>
          <li
            className={cn("group flex items-center gap-0.5 rounded-md hover:bg-muted/60", active && "bg-primary/10 ring-1 ring-primary/40 ring-inset")}
            onContextMenu={() => {
              if (!active) onSelect(ref, false);
            }}
          >
            <button
              type="button"
              aria-pressed={active}
              onClick={(e) => onSelect(ref, e.shiftKey || e.metaKey || e.ctrlKey)}
              className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left"
              title={`${element.type} ${name}${summary ? ` — ${summary}` : ""}${element.z !== undefined ? ` · layer ${element.z}` : ""}`}
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 font-mono text-[11px]">{name}</span>
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">{summary || element.type}</span>
              {element.z ? <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">z{element.z}</span> : null}
            </button>
            <Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" disabled={!!blockedReason || busy} onClick={() => onRemove(ref)} aria-label={`Remove ${name}`} title="Remove (Ctrl+Z undoes it)">
              <Trash2 />
            </Button>
          </li>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <ElementMenuItems actions={actions} kind="context" />
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground">Top layer first · Shift+click to select several · right-click for more</p>
      <ul className="-mx-1.5 space-y-px">{topFirst(spec.elements).flatMap(({ element, index }) => rows(element, { shotId: null, index }))}</ul>
      {(spec.shots ?? []).map((shot) => (
        <div key={shot.id}>
          <div className="flex items-center gap-1.5 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Shot <span className="font-mono normal-case">{shot.id}</span>
            <span className="ml-auto normal-case">{shot.transitionIn ? shot.transitionIn.type : "cut"}</span>
          </div>
          <ul className="-mx-1.5 space-y-px border-l border-border pl-1.5">{topFirst(shot.elements).flatMap(({ element, index }) => rows(element, { shotId: shot.id, index }))}</ul>
        </div>
      ))}
    </div>
  );
}
