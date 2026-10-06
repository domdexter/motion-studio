"use client";

import { Link2, Link2Off } from "lucide-react";
import { toast } from "sonner";
import { keyframedPatch } from "@/core/motion/keyframes";
import { sizeModeOf, type SizeMode } from "@/core/spec/element-properties";
import type { ElementType, SceneElement } from "@/core/spec/scene";
import type { TriggerContext } from "@/core/spec/triggers";
import type { ElementRef, FrameSize } from "@/core/timeline/element-layout";
import { applyElementPatch, type ElementPatchContext } from "@/core/timeline/spec-patch";
import type { SceneElementPatch } from "@/server/services/scene-elements";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { elementDrafts } from "./element-drafts";
import { ScrubField } from "./inspector-section";
import { AnimatedOpacityField, AnimatedPropertyField, AnimatedScrubField, KeyframeToggle, propertyState, useKeyframeClock, type KeyframeClock } from "./keyframe-fields";
import { FieldRow } from "./property-fields";
import { useElementEdits } from "./use-element-edits";

/**
 * The field context shared by the inspector sections. Scrubbing a field, dragging a slider or picking a
 * colour shows the change in the preview right away (an element draft, made with the same patch
 * function the server applies); releasing saves it through the scene element service. A change the
 * server would refuse is explained instead of sent.
 */

export interface ElementFieldContext {
  sceneId: string;
  elementRef: ElementRef;
  /** As shown: the in-flight draft while an edit saves, else the saved element. */
  element: SceneElement;
  /** As saved. */
  saved: SceneElement;
  frame: FrameSize;
  /** Its scene's timing, narrowed to its shot (keyframes, timing and cues), or null when unknown. */
  segment: TriggerContext | null;
  /** Where the playhead is on the element's own keyframe clock, or null without one. */
  clock: KeyframeClock | null;
  disabled: boolean;
  /** Shows the element with the patch applied in the preview (nothing is saved). */
  preview: (patch: SceneElementPatch) => void;
  /** Drops a preview that wasn't committed. */
  cancel: () => void;
  /** Saves a patch (nothing happens when it changes nothing). */
  commit: (patch: SceneElementPatch) => void;
}

export const TRANSFORM_DEFAULTS: Record<string, number> = { x: 50, y: 50, rotation: 0, scale: 1, opacity: 1, z: 0 };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function useElementFieldContext({
  projectId,
  sceneId,
  elementRef,
  saved,
  element,
  blockedReason,
  frame,
  assetAspect,
  sceneDurationSec,
  segment = null,
}: {
  projectId: string;
  sceneId: string;
  elementRef: ElementRef;
  saved: SceneElement;
  element: SceneElement;
  blockedReason: string | null;
  frame: FrameSize;
  assetAspect: number | null;
  /** The scene's length (retiming). */
  sceneDurationSec?: number;
  /** Its scene's timing, narrowed to its shot: keyframes follow the playhead with it, and retiming keeps them in place. */
  segment?: TriggerContext | null;
}) {
  const edits = useElementEdits(projectId);
  const clock = useKeyframeClock(element, segment);
  const disabled = !!blockedReason;
  const context: ElementPatchContext = { frame, assetAspect, sceneDurationSec, segment: segment ?? undefined };
  const attempt = (base: SceneElement, patch: SceneElementPatch): SceneElement | Error => {
    try {
      return applyElementPatch(base, patch, context);
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  };
  /**
   * A change to a property the element animates is a keyframe at the playhead, not a new saved value —
   * wherever in the inspector or on the canvas it came from. A patch that sets the keyframes itself
   * (adding, removing or moving one) already says what it wants and is left alone.
   */
  const atPlayhead = (patch: SceneElementPatch): SceneElementPatch => (patch.keyframes !== undefined || !clock ? patch : (keyframedPatch(element, patch, clock.local, clock.tolerance) as SceneElementPatch));
  const ctx: ElementFieldContext = {
    sceneId,
    elementRef,
    element,
    saved,
    frame,
    segment,
    clock,
    disabled,
    preview: (raw) => {
      if (disabled) return;
      const patch = atPlayhead(raw);
      const next = attempt(element, patch);
      if (!(next instanceof Error)) elementDrafts.set(sceneId, elementRef, next, saved);
    },
    cancel: () => elementDrafts.clear(sceneId, elementRef),
    commit: (raw) => {
      if (disabled) return;
      const patch = atPlayhead(raw);
      const next = attempt(saved, patch);
      if (next instanceof Error) {
        toast.error(next.message);
        elementDrafts.clear(sceneId, elementRef);
        return;
      }
      if (JSON.stringify(next) === JSON.stringify(saved)) {
        elementDrafts.clear(sceneId, elementRef);
        return;
      }
      // The preview keeps anything still being scrubbed elsewhere; the server applies the patch to the saved element.
      const shown = attempt(element, patch);
      edits.commitLayout(sceneId, elementRef, saved, patch, shown instanceof Error ? next : shown);
    },
  };
  return { ctx, edits };
}

/** How an element's size is set — the rule lives in core with the rest of the element's shape. */
export { sizeModeOf, type SizeMode };

/** Lines and cursors are placed by their own points, not by x/y. */
export const hasPosition = (type: ElementType) => type !== "line" && type !== "cursor";

const SIZE_DEFAULTS: Partial<Record<ElementType, number>> = { circle: 160, icon: 96, progress: 280 };

export function TransformFields({
  ctx,
  auto,
  keepAspect,
  onKeepAspect,
}: {
  ctx: ElementFieldContext;
  /** The size an unset ("auto") side renders at, in percent of the frame. */
  auto: { width: number; height: number };
  keepAspect: boolean;
  onKeepAspect: (on: boolean) => void;
}) {
  const el = ctx.element;
  const mode = sizeModeOf(el);
  const portrait = ctx.frame.height > ctx.frame.width;
  // Position, rotation and scale show their value at the playhead and can be keyframed; their label,
  // unit, range and step come from the animatable property registry (core/spec/animatable.ts).
  // Width and height can be keyframed too: the diamond keys the size it renders at, so an "auto" side
  // starts from what the element actually measures rather than from nothing.
  const size = (key: "width" | "height", label: string, linked: boolean) => {
    const other = key === "width" ? "height" : "width";
    // Proportional: the other side goes back to auto. Free: an auto other side is pinned at its current size.
    const extra = !linked ? {} : keepAspect ? { [other]: null } : el[other] === undefined ? { [other]: r2(auto[other]) } : {};
    const state = propertyState(ctx, key, r2(auto[key]));
    return (
      <div className="flex min-w-0 items-center gap-0.5">
        <div className="min-w-0 flex-1">
          <ScrubField
            label={label}
            value={state.animated ? Number(state.value) : (el[key] ?? null)}
            placeholder="auto"
            scrubStart={r2(auto[key])}
            step={0.1}
            min={0.5}
            max={400}
            unit="%"
            disabled={ctx.disabled || (state.animated && !state.keyable)}
            title={key === "width" ? "Width, % of the frame width (empty: from its content)" : "Height, % of the frame height (empty: from its content)"}
            className={cn(state.animated && "border-keyframe/50", state.at && "bg-keyframe/[0.08]")}
            onPreview={(n) => ctx.preview({ [key]: n, ...(state.animated ? {} : extra) })}
            onCancel={ctx.cancel}
            onCommit={(n) => ctx.commit({ [key]: n, ...(state.animated ? {} : extra) })}
          />
        </div>
        {state.supported ? <KeyframeToggle ctx={ctx} property={key} state={state} /> : null}
      </div>
    );
  };
  const prop = (key: "maxWidth" | "size", label: string, o: { unit: string; placeholder: number; max: number; step: number; title: string }) => {
    const value = (el as Record<string, unknown>)[key] as number | undefined;
    return (
      <ScrubField
        label={label}
        value={value ?? null}
        placeholder={String(o.placeholder)}
        scrubStart={o.placeholder}
        step={o.step}
        min={1}
        max={o.max}
        unit={o.unit}
        disabled={ctx.disabled}
        title={o.title}
        onPreview={(n) => ctx.preview({ props: { [key]: n } })}
        onCancel={ctx.cancel}
        onCommit={(n) => ctx.commit({ props: { [key]: n } })}
        onReset={value !== undefined ? () => ctx.commit({ props: { [key]: null } }) : undefined}
      />
    );
  };
  return (
    <div className="space-y-1.5">
      {hasPosition(el.type) ? (
        <div className="grid grid-cols-2 gap-1.5">
          <AnimatedScrubField ctx={ctx} property="x" />
          <AnimatedScrubField ctx={ctx} property="y" />
        </div>
      ) : null}
      {mode === "box" ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
          {size("width", "W", true)}
          <Button
            size="icon-xs"
            variant={keepAspect ? "secondary" : "ghost"}
            aria-pressed={keepAspect}
            aria-label={keepAspect ? "Keep proportions (on)" : "Keep proportions (off)"}
            title={keepAspect ? "Width and height keep their proportions — click to size them separately" : "Width and height are set separately — click to keep proportions"}
            disabled={ctx.disabled}
            onClick={() => onKeepAspect(!keepAspect)}
          >
            {keepAspect ? <Link2 /> : <Link2Off />}
          </Button>
          {size("height", "H", true)}
        </div>
      ) : mode === "width" ? (
        size("width", "W", false)
      ) : mode === "maxWidth" ? (
        prop("maxWidth", "Max W", { unit: "%", placeholder: el.type === "kinetic" ? (portrait ? 88 : 80) : portrait ? 86 : 76, max: 100, step: 0.5, title: "Wraps at this width, % of the frame width" })
      ) : mode === "size" ? (
        prop("size", "Size", { unit: "px", placeholder: SIZE_DEFAULTS[el.type] ?? 100, max: 1200, step: 1, title: "Size in pixels at 1080p" })
      ) : null}
      <div className="grid grid-cols-2 gap-1.5">
        <AnimatedScrubField ctx={ctx} property="rotation" />
        <AnimatedScrubField ctx={ctx} property="scale" />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <AnimatedScrubField ctx={ctx} property="scaleX" />
        <AnimatedScrubField ctx={ctx} property="scaleY" />
      </div>
      <FieldRow label="Pivot" hint="What rotation and scale turn around, in % of its own box">
        <AnimatedPropertyField ctx={ctx} property="pivot" />
      </FieldRow>
      {/* 3D tilt: the element stays flat, seen from `depth` away. Depth only reads once it is tilted. */}
      <div className="grid grid-cols-2 gap-1.5">
        <AnimatedScrubField ctx={ctx} property="rotateX" />
        <AnimatedScrubField ctx={ctx} property="rotateY" />
      </div>
      <FieldRow label="Depth" hint="How far the viewer is from a tilt: a smaller depth is a stronger perspective (a flat element ignores it)">
        <AnimatedPropertyField ctx={ctx} property="depth" />
      </FieldRow>
    </div>
  );
}

export function OpacityField({ ctx }: { ctx: ElementFieldContext }) {
  return <AnimatedOpacityField ctx={ctx} />;
}
