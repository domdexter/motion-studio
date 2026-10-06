"use client";

import { useMemo } from "react";
import { isCustomEasing } from "@/core/motion/easing";
import { baseValue, keyframeAt, keyframedPatch, propertyPatch, readField, removeKeyframesPatch, setKeyframe, valueAt } from "@/core/motion/keyframes";
import { animatableProperty, formatPropertyValue, keyframePropertiesFor, propertyDefault, type AnimatableProperty, type KeyframeProperty } from "@/core/spec/animatable";
import type { DesignSystem } from "@/core/spec/design";
import type { KeyframeEasingValue, KeyframeValue, Point, SceneElement } from "@/core/spec/scene";
import type { TriggerContext } from "@/core/spec/triggers";
import { elementSpan } from "@/core/timeline/scene-restructure";
import { cn } from "@/lib/utils";
import type { SceneElementPatch } from "@/server/services/scene-elements";
import type { ElementFieldContext } from "./element-fields";
import { useInspectorEnv, usePlayheadTime } from "./inspector-env";
import { ScrubField, SliderRow } from "./inspector-section";
import { ColorField } from "./property-fields";

/**
 * Keyframe controls for the inspector's animatable properties — whichever the registry
 * (core/spec/animatable.ts) says the element animates, drawn with the control, label, unit, range and
 * step that property describes. A field shows the property's value at the playhead. While the property
 * has keyframes, changing it sets a keyframe at the playhead (its saved value isn't shown, so it isn't
 * changed). The diamond next to a field adds a keyframe at the playhead or removes the one there, and
 * shows whether the property is animated.
 */

export interface KeyframeClock {
  /** Video seconds at the playhead. */
  time: number;
  /** Seconds after the element appears, at the playhead (kept within its time on screen). */
  local: number;
  /** Video seconds it appears and is gone. */
  appear: number;
  gone: number;
  /** The playhead is where the element is on screen. */
  onScreen: boolean;
  /** Half a frame: a keyframe this close to the playhead is at it. */
  tolerance: number;
}

/** The element's keyframe clock at the playhead — the calling component follows the playhead — or null without a playhead or the element's timing. */
export function useKeyframeClock(element: SceneElement, segment: TriggerContext | null): KeyframeClock | null {
  const env = useInspectorEnv();
  const time = usePlayheadTime();
  const span = useMemo(() => (segment ? elementSpan(element, segment) : null), [element, segment]);
  if (!span || !env?.playhead) return null;
  const tolerance = 0.5 / (env.fps ?? 30);
  const raw = time - span.appear;
  return { time, local: Math.min(span.gone - span.appear, Math.max(0, raw)), appear: span.appear, gone: span.gone, onScreen: raw >= -tolerance && time <= span.gone + tolerance, tolerance };
}

/** A keyframe marker, shaped by how the value leaves it: linear — a diamond, a curve — a circle, hold — a square. */
export function keyframeMarkerClass(easing: KeyframeEasingValue | undefined): string {
  const curved = isCustomEasing(easing) || (!!easing && easing !== "linear" && easing !== "hold");
  return cn("block shrink-0 border border-background/70 bg-keyframe", easing === "hold" ? "rounded-[1px]" : curved ? "rounded-full" : "rotate-45 rounded-[1px]");
}

/** The inspector's keyframe diamond: filled on a keyframe, outlined while the property is animated, faint when it isn't. */
export function KeyframeGlyph({ state }: { state: "off" | "animated" | "on" }) {
  return <span aria-hidden className={cn("block size-2 rotate-45 rounded-[1px] border", state === "on" ? "border-keyframe bg-keyframe" : state === "animated" ? "border-keyframe" : "border-muted-foreground/60")} />;
}

/** What a property's control shows right now, and what a change to it saves. */
export interface PropertyState {
  definition: AnimatableProperty;
  /** Its value at the playhead (keyframed or saved). */
  value: KeyframeValue;
  animated: boolean;
  /** A keyframe sits at the playhead. */
  at: { id: string; time: number } | null;
  /** It can take a keyframe right now (the playhead is over it). */
  keyable: boolean;
  supported: boolean;
}

/**
 * What the inspector needs to draw one animatable property of the selected element: its value at the
 * playhead, whether it is animated, and whether a keyframe can be set right now. `fallback` is the value
 * a property that has no default of its own renders at (a size from its content, a design system colour).
 */
export function propertyState(ctx: ElementFieldContext, property: KeyframeProperty, fallback?: KeyframeValue): PropertyState {
  const definition = animatableProperty(property);
  const el = ctx.element;
  const clock = ctx.clock;
  const supported = keyframePropertiesFor(el.type).includes(property);
  const animated = supported && !!ctx.element.keyframes?.some((k) => k.property === property);
  const raw = animated ? valueAt(el, property, clock?.local ?? 0) : baseValue(el, property);
  const unset = !animated && definition.defaultValue === null && fallback !== undefined;
  const at = animated && clock ? keyframeAt(el.keyframes, property, clock.local, clock.tolerance) : null;
  return { definition, value: unset ? fallback : raw, animated, at: at ? { id: at.id, time: at.time } : null, keyable: animated && !!clock?.onScreen, supported };
}

/** What a field change saves: a keyframe at the playhead while the property is animated, else the value itself. */
export function propertyChangePatch(ctx: ElementFieldContext, property: KeyframeProperty, value: KeyframeValue, animated: boolean): SceneElementPatch {
  const patch = propertyPatch(property, value) as SceneElementPatch;
  return animated && ctx.clock ? (keyframedPatch(ctx.element, patch, ctx.clock.local, ctx.clock.tolerance) as SceneElementPatch) : patch;
}

/** Adds a keyframe for the property at the playhead with the value it has there, or removes the one there. */
export function KeyframeToggle({ ctx, property, state }: { ctx: ElementFieldContext; property: KeyframeProperty; state: PropertyState }) {
  const clock = ctx.clock;
  const name = state.definition.label.toLowerCase();
  const label = !clock
    ? "Keyframes are set at the playhead"
    : !clock.onScreen
      ? `Move the playhead to where it's on screen to key its ${name}`
      : state.at
        ? `Remove the ${name} keyframe at the playhead`
        : state.animated
          ? `Add a ${name} keyframe at the playhead`
          : `Animate its ${name}: add a keyframe at the playhead`;
  return (
    <button
      type="button"
      aria-pressed={!!state.at}
      aria-label={label}
      title={label}
      disabled={ctx.disabled || !clock?.onScreen}
      className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted disabled:opacity-40"
      onClick={() => {
        if (!clock) return;
        ctx.commit(
          state.at
            ? (removeKeyframesPatch(ctx.element, [state.at.id], state.at.time) as SceneElementPatch)
            : ({ keyframes: setKeyframe(ctx.element.keyframes, { property, time: clock.local, value: state.value }, clock.tolerance).keyframes } as SceneElementPatch),
        );
      }}
    >
      <KeyframeGlyph state={state.at ? "on" : state.animated ? "animated" : "off"} />
    </button>
  );
}

/**
 * The control a property's metadata asks for — a scrub field, a slider, a colour or a point. It edits a
 * value, not an element, so the same control serves a property at the playhead and the value of one
 * selected keyframe.
 */
export function PropertyInput({
  definition,
  value,
  label,
  disabled,
  title,
  className,
  onPreview,
  onCancel,
  onCommit,
  onReset,
}: {
  definition: AnimatableProperty;
  value: KeyframeValue;
  /** Overrides the property's own short label. */
  label?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  onPreview?: (value: KeyframeValue) => void;
  onCancel?: () => void;
  onCommit: (value: KeyframeValue) => void;
  onReset?: () => void;
}) {
  const env = useInspectorEnv();
  const editing = definition.editing;
  const [lo, hi] = editing?.staticRange ?? definition.range ?? [0, 1];
  const name = label ?? definition.short;
  if (editing?.kind === "color") {
    return (
      <ColorField
        value={typeof value === "string" ? value : undefined}
        design={env?.design ?? null}
        disabled={disabled}
        ariaLabel={definition.label}
        onPreview={(v) => onPreview?.(v)}
        onCancel={onCancel}
        onCommit={(v) => (v === null ? onReset?.() : onCommit(v))}
      />
    );
  }
  if (editing?.kind === "point") {
    const point: Point = Array.isArray(value) ? (value as Point) : [0, 0];
    const axis = (index: 0 | 1) => (
      <ScrubField
        label={index === 0 ? "X" : "Y"}
        value={point[index]}
        step={editing.step}
        min={lo}
        max={hi}
        unit={definition.display.suffix}
        disabled={disabled}
        title={`${definition.description} — ${index === 0 ? "horizontal" : "vertical"}`}
        className={className}
        onPreview={(n) => onPreview?.(index === 0 ? [n, point[1]] : [point[0], n])}
        onCancel={onCancel}
        onCommit={(n) => onCommit(index === 0 ? [n, point[1]] : [point[0], n])}
      />
    );
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {axis(0)}
        {axis(1)}
      </div>
    );
  }
  const numeric = typeof value === "number" ? value : 0;
  if (editing?.kind === "slider") {
    return (
      <SliderRow
        label={name}
        value={numeric}
        display={(v) => formatPropertyValue(definition.id as KeyframeProperty, v)}
        min={lo}
        max={hi}
        step={editing.step}
        disabled={disabled}
        title={title ?? definition.description}
        className={className}
        onPreview={(v) => onPreview?.(v)}
        onCommit={(v) => onCommit(v)}
      />
    );
  }
  return (
    <ScrubField
      label={name}
      value={numeric}
      step={editing?.step ?? 1}
      min={lo}
      max={hi}
      unit={definition.display.suffix}
      disabled={disabled}
      title={title ?? definition.description}
      className={className}
      onPreview={(n) => onPreview?.(n)}
      onCancel={onCancel}
      onCommit={(n) => onCommit(n)}
      onReset={onReset}
    />
  );
}

/** One animatable property of the selected element: its value at the playhead, with its keyframe diamond. */
export function AnimatedPropertyField({ ctx, property, label, fallback }: { ctx: ElementFieldContext; property: KeyframeProperty; label?: string; fallback?: KeyframeValue }) {
  const state = propertyState(ctx, property, fallback);
  const { definition, animated } = state;
  const locked = ctx.disabled || (animated && !state.keyable);
  const title = animated ? `${definition.description} — animated: ${state.keyable ? "a change sets a keyframe at the playhead" : "move the playhead to where it's on screen to change it"}` : definition.description;
  const change = (value: KeyframeValue) => propertyChangePatch(ctx, property, value, animated);
  const unset = !animated && definition.defaultValue === null && readField(ctx.element, definition.field) === undefined;
  return (
    <div className={cn("flex min-w-0 items-center gap-0.5", definition.editing?.kind === "slider" && "flex-1")}>
      <div className="min-w-0 flex-1">
        <PropertyInput
          definition={definition}
          value={state.value}
          label={label}
          disabled={locked}
          title={title}
          className={cn(animated && (definition.editing?.kind === "slider" ? "text-keyframe" : "border-keyframe/50"), state.at && "bg-keyframe/[0.08]")}
          onPreview={(v) => ctx.preview(change(v))}
          onCancel={ctx.cancel}
          onCommit={(v) => ctx.commit(change(v))}
          onReset={!animated && !unset ? () => ctx.commit(propertyPatch(property, null) as SceneElementPatch) : undefined}
        />
      </div>
      {state.supported ? <KeyframeToggle ctx={ctx} property={property} state={state} /> : null}
    </div>
  );
}

/** X, Y, rotation, scale and the other scrubbed transform properties. */
export function AnimatedScrubField({ ctx, property, fallback }: { ctx: ElementFieldContext; property: KeyframeProperty; fallback?: number }) {
  return <AnimatedPropertyField ctx={ctx} property={property} fallback={fallback} />;
}

/** Opacity: the value at the playhead, with its keyframe diamond. */
export function AnimatedOpacityField({ ctx }: { ctx: ElementFieldContext }) {
  return <AnimatedPropertyField ctx={ctx} property="opacity" label="Opacity" />;
}

/** A property's value written the way the inspector, timeline and CLI write it. */
export const formatKeyframeValue = (property: KeyframeProperty, value: KeyframeValue): string => formatPropertyValue(property, value);

/** The value a property with no default of its own starts a keyframe from, when the editor knows it. */
export function propertyFallback(property: KeyframeProperty, design: DesignSystem | null): KeyframeValue | undefined {
  const definition = animatableProperty(property);
  if (definition.defaultValue !== null) return undefined;
  return propertyDefault(property, design ?? undefined);
}
