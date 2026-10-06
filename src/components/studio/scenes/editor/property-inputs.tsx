"use client";

import type { ReactNode } from "react";
import { valueAt } from "@/core/motion/keyframes";
import { propertyForPatch, type KeyframeProperty } from "@/core/spec/animatable";
import type { StyleKey } from "@/core/spec/element-properties";
import type { SceneElementPatch } from "@/server/services/scene-elements";
import type { ElementFieldContext } from "./element-fields";
import { useInspectorEnv } from "./inspector-env";
import { ScrubField } from "./inspector-section";
import { ColorField, FieldRow, SegmentedField, SelectField, SwitchField, TextField } from "./property-fields";

/**
 * Inspector inputs bound to one property of the selected element. Each reads the value as shown
 * (including an edit that is still saving) and saves through the section's field context; null resets
 * the property to the renderer's default.
 */

export const humanize = (value: string) => value.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

export function options<T extends string>(values: readonly T[], label: (value: T) => string = humanize): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: label(value) }));
}

export interface Binding<T> {
  value: T | undefined;
  /** Saves the value; null resets it. */
  commit: (value: T | null) => void;
  preview: (value: T) => void;
  cancel: () => void;
  disabled: boolean;
}

export function bindPatch<T>(ctx: ElementFieldContext, value: T | undefined, toPatch: (value: T | null) => SceneElementPatch): Binding<T> {
  return { value, commit: (v) => ctx.commit(toPatch(v)), preview: (v) => ctx.preview(toPatch(v)), cancel: ctx.cancel, disabled: ctx.disabled };
}

/**
 * The value a control shows: while the element animates that property, the value it has at the
 * playhead (its saved value isn't what renders). Saving is handled for every control at once — the
 * field context turns a change to an animated property into a keyframe at the playhead.
 */
function shownValue<T>(ctx: ElementFieldContext, patchIn: "props" | "style", key: string, saved: T | undefined): T | undefined {
  const property = propertyForPatch(patchIn, key);
  if (!property || !ctx.clock || !ctx.element.keyframes?.some((k) => k.property === property.id)) return saved;
  return valueAt(ctx.element, property.id as KeyframeProperty, ctx.clock.local) as T;
}

/** A type property (text, size, variant…). */
export function propBinding<T>(ctx: ElementFieldContext, key: string): Binding<T> {
  const saved = (ctx.element as Record<string, unknown>)[key] as T | undefined;
  return bindPatch<T>(ctx, shownValue(ctx, "props", key, saved), (v) => ({ props: { [key]: v } }));
}

/** A `style` key. */
export function styleBinding<T>(ctx: ElementFieldContext, key: StyleKey): Binding<T> {
  const saved = ctx.element.style?.[key] as T | undefined;
  return bindPatch<T>(ctx, shownValue(ctx, "style", key, saved), (v) => ({ style: { [key]: v } }) as SceneElementPatch);
}

export const withDisabled = <T,>(b: Binding<T>, disabled: boolean): Binding<T> => ({ ...b, disabled: b.disabled || disabled });

export function NumberInput({
  b,
  label,
  unit,
  step = 1,
  min,
  max,
  placeholder,
  title,
}: {
  b: Binding<number>;
  label: string;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  /** The default it renders at when unset. */
  placeholder?: number | string;
  title?: string;
}) {
  return (
    <ScrubField
      label={label}
      value={b.value ?? null}
      placeholder={placeholder === undefined ? undefined : String(placeholder)}
      scrubStart={typeof placeholder === "number" ? placeholder : undefined}
      step={step}
      min={min}
      max={max}
      unit={unit}
      title={title}
      disabled={b.disabled}
      onPreview={b.preview}
      onCancel={b.cancel}
      onCommit={(n) => b.commit(n)}
      onReset={b.value !== undefined ? () => b.commit(null) : undefined}
    />
  );
}

export function ColorInput({ b, label, fallback, hint }: { b: Binding<string>; label: string; fallback?: string; hint?: string }) {
  const env = useInspectorEnv();
  return (
    <FieldRow label={label} hint={hint} onReset={b.value !== undefined ? () => b.commit(null) : undefined} disabled={b.disabled}>
      <ColorField value={b.value} fallback={fallback} design={env?.design ?? null} ariaLabel={label} disabled={b.disabled} onPreview={b.preview} onCancel={b.cancel} onCommit={(c) => b.commit(c)} />
    </FieldRow>
  );
}

export function SelectInput<T extends string>({ b, label, options: choices, defaultLabel, hint }: { b: Binding<T>; label: string; options: readonly { value: T; label: string }[]; defaultLabel?: string; hint?: string }) {
  return (
    <FieldRow label={label} hint={hint} onReset={b.value !== undefined ? () => b.commit(null) : undefined} disabled={b.disabled}>
      <SelectField value={b.value} options={choices} defaultLabel={defaultLabel} ariaLabel={label} disabled={b.disabled} onChange={(v) => b.commit(v ?? null)} />
    </FieldRow>
  );
}

/** Side-by-side choices; picking the default removes the property. */
export function SegmentInput<T extends string>({ b, label, options: choices, fallback, hint }: { b: Binding<T>; label: string; options: readonly { value: T; label: string; icon?: ReactNode }[]; fallback: T; hint?: string }) {
  return (
    <FieldRow label={label} hint={hint} onReset={b.value !== undefined ? () => b.commit(null) : undefined} disabled={b.disabled}>
      <SegmentedField value={b.value ?? fallback} options={choices} ariaLabel={label} disabled={b.disabled} onChange={(v) => b.commit(v === fallback ? null : v)} />
    </FieldRow>
  );
}

export function SwitchInput({ b, label, fallback, hint }: { b: Binding<boolean>; label: string; fallback: boolean; hint?: string }) {
  return (
    <FieldRow label={label} hint={hint} onReset={b.value !== undefined ? () => b.commit(null) : undefined} disabled={b.disabled}>
      <SwitchField checked={b.value ?? fallback} label={label} disabled={b.disabled} onChange={(checked) => b.commit(checked === fallback ? null : checked)} />
    </FieldRow>
  );
}

/** Text; an empty optional text removes the property. Multiline text has its label above. */
export function TextInput({
  b,
  label,
  placeholder,
  required,
  multiline,
  rows,
  hint,
}: {
  b: Binding<string>;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  hint?: string;
}) {
  const field = (
    <TextField
      value={b.value ?? ""}
      ariaLabel={label}
      placeholder={placeholder}
      required={required}
      multiline={multiline}
      rows={rows}
      disabled={b.disabled}
      onCommit={(v) => b.commit(v === "" && !required ? null : v)}
    />
  );
  if (!multiline) {
    return (
      <FieldRow label={label} hint={hint}>
        {field}
      </FieldRow>
    );
  }
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-muted-foreground" title={hint}>
        {label}
      </span>
      {field}
    </div>
  );
}
