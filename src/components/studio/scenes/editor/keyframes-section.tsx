"use client";

import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { bezierForEasing, describeEasing, isCustomEasing } from "@/core/motion/easing";
import { adjacentKeyframe, animatedProperties, keyframeTracks, removeKeyframesPatch, setKeyframe, updateKeyframe, valueAt } from "@/core/motion/keyframes";
import { animatableProperty, availableProperties, formatPropertyValue, type KeyframeProperty, type PropertyCategory } from "@/core/spec/animatable";
import { KEYFRAME_EASINGS, type Keyframe, type KeyframeEasingValue, type KeyframeValue } from "@/core/spec/scene";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CurveEditor } from "./curve-editor";
import type { ElementFieldContext } from "./element-fields";
import { ClipboardMenu } from "./element-sections";
import { useInspectorEnv } from "./inspector-env";
import { IconAction, InspectorSection, ScrubField } from "./inspector-section";
import { PropertyInput, keyframeMarkerClass, type KeyframeClock } from "./keyframe-fields";
import { FieldHint, FieldRow, SelectField } from "./property-fields";
import { humanize } from "./property-inputs";

/**
 * The inspector's Keyframes section: each animated property as a small track of its keyframes over the
 * element's time on screen (click one to select it and move the playhead there, step with ‹ ›), the value
 * it has at the playhead, and the selected keyframe's time, value and the curve it travels on to the
 * next one. Every change is an element patch (`keyframes`), so the preview, the timeline's keyframe rows
 * and undo follow.
 *
 * Which properties it offers, their labels, ranges, steps, units and the control each one needs all come
 * from the animatable property registry (core/spec/animatable.ts) — this section has no list of its own.
 * A stretch between two keyframes belongs to the earlier one: selecting a keyframe shows the curve
 * leaving it, so two neighbouring stretches are edited separately.
 */

const EASING_OPTIONS = [...KEYFRAME_EASINGS.map((e) => ({ value: e, label: e === "hold" ? "Hold, then jump" : humanize(e) })), { value: "custom", label: "Custom curve…" }];
const CATEGORY_LABELS: Record<PropertyCategory, string> = { transform: "Transform", path: "Motion path", appearance: "Appearance", typography: "Type", compositing: "Effects" };

function TrackStrip({ keys, duration, clock, selectedId, onPick }: { keys: readonly Keyframe[]; duration: number; clock: KeyframeClock; selectedId: string | null; onPick: (k: Keyframe) => void }) {
  const at = (t: number) => (duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0);
  return (
    <div className="relative h-5 min-w-0 flex-1 rounded-sm bg-muted/60" aria-label="Keyframes over its time on screen">
      {keys.slice(1).map((k, i) => {
        const prev = keys[i];
        return (
          <span
            key={k.id}
            className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2", prev.easing === "hold" ? "h-0 border-t border-dashed border-keyframe/70" : "h-px bg-keyframe/60", prev.id === selectedId && "h-0.5 bg-keyframe")}
            style={{ left: `${at(prev.time)}%`, width: `${at(k.time) - at(prev.time)}%` }}
          />
        );
      })}
      <span className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: `${at(clock.local)}%` }} />
      {keys.map((k) => {
        const outside = k.time > duration + 0.001;
        return (
          <button
            key={k.id}
            type="button"
            title={`${animatableProperty(k.property).label} ${formatPropertyValue(k.property, k.value)} · ${k.time.toFixed(2)}s after it appears${outside ? " (after it's gone)" : ""} — click to select`}
            aria-label={`${animatableProperty(k.property).label} keyframe at ${k.time.toFixed(2)} seconds`}
            aria-pressed={k.id === selectedId}
            onClick={() => onPick(k)}
            className="group absolute top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: `${at(k.time)}%` }}
          >
            <span className={cn(keyframeMarkerClass(k.easing), "transition-transform group-hover:scale-125", k.id === selectedId ? "size-2.5 ring-2 ring-foreground" : "size-2", outside && "opacity-40")} />
          </button>
        );
      })}
    </div>
  );
}

function SelectedKeyframe({ ctx, keyframe, clock, onFocus }: { ctx: ElementFieldContext; keyframe: Keyframe; clock: KeyframeClock; onFocus: (id: string | null) => void }) {
  const env = useInspectorEnv();
  const el = ctx.element;
  const definition = animatableProperty(keyframe.property);
  const keys = keyframeTracks(el.keyframes).get(keyframe.property) ?? [];
  const index = keys.findIndex((k) => k.id === keyframe.id);
  const duration = clock.gone - clock.appear;
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: "nearest" });
  }, [keyframe.id]);
  const changed = (change: { time?: number; value?: KeyframeValue; easing?: KeyframeEasingValue | null }) => ({ keyframes: updateKeyframe(el.keyframes, keyframe.id, change, duration) });
  const next = keys[index + 1] ?? null;
  const easing = keyframe.easing ?? "linear";
  const setEasing = (value: string) => {
    // Switching to a custom curve starts from the one the named easing draws, so nothing jumps.
    if (value === "custom") ctx.commit(changed({ easing: { bezier: bezierForEasing(isCustomEasing(keyframe.easing) ? keyframe.easing : keyframe.easing === "hold" ? "linear" : keyframe.easing) } }));
    else ctx.commit(changed({ easing: value as KeyframeEasingValue }));
  };
  return (
    <div ref={boxRef} className="space-y-1.5 rounded-md border border-keyframe/40 bg-keyframe/[0.05] p-2">
      <div className="flex items-center gap-1.5">
        <span className={cn(keyframeMarkerClass(keyframe.easing), "size-2")} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {definition.label} keyframe {index + 1} of {keys.length}
        </span>
        <Button size="xs" variant="ghost" className="h-6" onClick={() => env?.seek(clock.appear + keyframe.time)}>
          Go to
        </Button>
        <IconAction
          label="Delete this keyframe (Del)"
          disabled={ctx.disabled}
          onClick={() => {
            ctx.commit(removeKeyframesPatch(el, [keyframe.id], keyframe.time));
            onFocus(null);
          }}
        >
          <Trash2 />
        </IconAction>
      </div>
      <div className={cn("grid gap-1.5", definition.editing?.kind === "point" ? "grid-cols-1" : "grid-cols-2")}>
        <ScrubField
          label="At"
          unit="s"
          value={clock.appear + keyframe.time}
          step={0.01}
          min={clock.appear}
          max={clock.gone}
          disabled={ctx.disabled}
          title="When, in video seconds (within its time on screen). Landing on another keyframe of this property replaces it."
          onPreview={(n) => ctx.preview(changed({ time: n - clock.appear }))}
          onCancel={ctx.cancel}
          onCommit={(n) => ctx.commit(changed({ time: n - clock.appear }))}
        />
        <PropertyInput
          definition={definition}
          value={keyframe.value}
          label="Value"
          disabled={ctx.disabled}
          title={`${definition.label} at this keyframe`}
          onPreview={(v) => ctx.preview(changed({ value: v }))}
          onCancel={ctx.cancel}
          onCommit={(v) => ctx.commit(changed({ value: v }))}
        />
      </div>
      <FieldRow label="Curve" hint={next ? `How the value travels to keyframe ${index + 2}` : "Set once another keyframe follows it"}>
        <SelectField
          value={isCustomEasing(keyframe.easing) ? "custom" : (easing as string)}
          options={EASING_OPTIONS}
          ariaLabel="Easing to the next keyframe"
          disabled={ctx.disabled}
          onChange={(v) => v && setEasing(v)}
        />
      </FieldRow>
      <CurveEditor
        easing={keyframe.easing}
        disabled={ctx.disabled}
        fromLabel={formatPropertyValue(keyframe.property, keyframe.value)}
        toLabel={next ? formatPropertyValue(keyframe.property, next.value) : "—"}
        onPreview={(curve) => ctx.preview(changed({ easing: curve }))}
        onCommit={(curve) => ctx.commit(changed({ easing: curve }))}
      />
      <FieldHint>
        {keyframe.time.toFixed(2)}s after it appears · {describeEasing(keyframe.easing)}
        {next ? ` to ${next.time.toFixed(2)}s` : " · the last keyframe, so its curve only matters once another follows it"}.
      </FieldHint>
    </div>
  );
}

export function KeyframesSection({
  ctx,
  id,
  name,
  focusedKeyframe = null,
  onFocusKeyframe,
}: {
  ctx: ElementFieldContext;
  id: string;
  name: string;
  /** The keyframe selected on the timeline or here. */
  focusedKeyframe?: string | null;
  onFocusKeyframe?: (id: string | null) => void;
}) {
  const env = useInspectorEnv();
  const clock = ctx.clock;
  if (!ctx.segment) return null;
  const el = ctx.element;
  const supported = availableProperties(el);
  const animated = animatedProperties(el);
  const tracks = keyframeTracks(el.keyframes);
  const count = animated.reduce((n, p) => n + (tracks.get(p)?.length ?? 0), 0);
  const selected = focusedKeyframe ? ((el.keyframes ?? []).find((k) => k.id === focusedKeyframe) ?? null) : null;
  const focus = (keyframeId: string | null) => onFocusKeyframe?.(keyframeId);
  const pick = (k: Keyframe) => {
    focus(k.id);
    if (clock) env?.seek(clock.appear + k.time);
  };
  const add = (property: KeyframeProperty) => {
    if (!clock?.onScreen) return;
    const result = setKeyframe(el.keyframes, { property, time: clock.local, value: valueAt(el, property, clock.local, env?.design ?? undefined) }, clock.tolerance);
    ctx.commit({ keyframes: result.keyframes });
    focus(result.id);
  };
  const groups = [...new Set(supported.map((p) => animatableProperty(p).category))];

  return (
    <InspectorSection
      id={id}
      title="Keyframes"
      summary={count ? `${count} · ${animated.map((p) => animatableProperty(p).label.toLowerCase()).join(", ")}` : "none"}
      focused={!!selected}
      actions={
        <>
          <ClipboardMenu ctx={ctx} group="keyframes" name={name} segment={ctx.segment} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="ghost" className="h-6" disabled={ctx.disabled || !clock?.onScreen} title={clock?.onScreen ? "Add a keyframe at the playhead with the value there" : "Move the playhead to where it's on screen to add keyframes"}>
                <Plus /> Key
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
              {groups.map((group) => (
                <div key={group}>
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">{CATEGORY_LABELS[group]}</DropdownMenuLabel>
                  {supported
                    .filter((p) => animatableProperty(p).category === group)
                    .map((property) => (
                      <DropdownMenuItem key={property} onSelect={() => add(property)}>
                        {animatableProperty(property).label} at the playhead
                      </DropdownMenuItem>
                    ))}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      {animated.length && clock ? (
        <div className="space-y-1">
          {animated.map((property) => {
            const keys = tracks.get(property)!;
            const prev = adjacentKeyframe(keys, clock.local, -1, undefined, clock.tolerance);
            const next = adjacentKeyframe(keys, clock.local, 1, undefined, clock.tolerance);
            const label = animatableProperty(property).label;
            return (
              <div key={property} className="flex items-center gap-0.5">
                <span className="w-14 shrink-0 truncate text-[11px] text-muted-foreground" title={label}>
                  {label}
                </span>
                <IconAction label={`Previous ${label.toLowerCase()} keyframe`} className="size-5" disabled={!prev} onClick={() => prev && pick(prev)}>
                  <ChevronLeft />
                </IconAction>
                <TrackStrip keys={keys} duration={clock.gone - clock.appear} clock={clock} selectedId={selected?.id ?? null} onPick={pick} />
                <IconAction label={`Next ${label.toLowerCase()} keyframe`} className="size-5" disabled={!next} onClick={() => next && pick(next)}>
                  <ChevronRight />
                </IconAction>
                <span className="w-12 shrink-0 truncate text-right font-mono text-[10px] tabular-nums" title="At the playhead">
                  {formatPropertyValue(property, valueAt(el, property, clock.local))}
                </span>
                <IconAction
                  label={`Remove the ${label.toLowerCase()} animation (it keeps its value at the playhead)`}
                  className="size-5"
                  disabled={ctx.disabled}
                  onClick={() => {
                    ctx.commit(removeKeyframesPatch(el, keys.map((k) => k.id), clock.local));
                    if (selected?.property === property) focus(null);
                  }}
                >
                  <Trash2 />
                </IconAction>
              </div>
            );
          })}
        </div>
      ) : (
        <FieldHint>
          No keyframes. Use + Key, or the diamond next to a property, to set its value at the playhead — then move the playhead and change the value to animate it. It can animate{" "}
          {supported
            .map((p) => animatableProperty(p).label.toLowerCase())
            .join(", ")
            .replace(/, ([^,]*)$/, " and $1")}
          .
        </FieldHint>
      )}
      {selected && clock ? <SelectedKeyframe key={selected.id} ctx={ctx} keyframe={selected} clock={clock} onFocus={focus} /> : null}
      <FieldHint>Keyframes count from when it appears, so they move with it; its cues decide when it enters. The entrance, exit and emphasis play on top. [ and ] step between keyframes.</FieldHint>
    </InspectorSection>
  );
}
