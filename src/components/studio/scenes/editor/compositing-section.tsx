"use client";

import { Plus, X } from "lucide-react";
import { isAnimated } from "@/core/motion/keyframes";
import { BLEND_MODES, CLIP_REVEALS, CLIP_SHAPES, type BlendMode, type Clip, type ClipShape } from "@/core/spec/scene";
import type { SceneElementPatch } from "@/server/services/scene-elements";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ElementFieldContext } from "./element-fields";
import { useInspectorEnv } from "./inspector-env";
import { InspectorSection } from "./inspector-section";
import { AnimatedPropertyField } from "./keyframe-fields";
import { FieldRow, ResetButton, SegmentedField } from "./property-fields";
import { NumberInput, SelectInput, bindPatch, humanize } from "./property-inputs";

/**
 * Compositing — how the element is drawn onto what is already there: blend mode, effects and the clip
 * shape it is seen through (src/remotion/engine/compositing.ts draws all three, in the canvas and in
 * the render alike). Effects are shown one group at a time: nothing is on screen until it is added,
 * and each parameter is an ordinary animatable property, so every one of them takes keyframes through
 * the same control as position or colour.
 */

/** The effect groups, in the order the renderer applies them. `on` is what adding one starts from. */
const EFFECT_GROUPS = [
  { id: "blur", label: "Blur", properties: ["effectBlur"] as const, keys: ["blur"] as const, on: { blur: 8 } },
  { id: "glow", label: "Glow", properties: ["glow", "glowColor"] as const, keys: ["glow", "glowColor"] as const, on: { glow: 24 } },
  { id: "shadow", label: "Drop shadow", properties: ["shadowX", "shadowY", "shadowBlur", "shadowColor"] as const, keys: ["shadowX", "shadowY", "shadowBlur", "shadowColor"] as const, on: { shadowY: 8, shadowBlur: 24 } },
  { id: "color", label: "Colour", properties: ["brightness", "contrast", "saturate"] as const, keys: ["brightness", "contrast", "saturate"] as const, on: { saturate: 1 } },
] as const;

type EffectGroup = (typeof EFFECT_GROUPS)[number];

const isOn = (ctx: ElementFieldContext, group: EffectGroup): boolean => {
  const effects = ctx.element.effects;
  return (!!effects && group.keys.some((k) => effects[k] !== undefined)) || group.properties.some((p) => isAnimated(ctx.element, p));
};

const CLIP_OPTIONS: { value: ClipShape | "none"; label: string }[] = [{ value: "none", label: "None" }, ...CLIP_SHAPES.map((value) => ({ value, label: humanize(value) }))];

function ClipFields({ ctx }: { ctx: ElementFieldContext }) {
  const clip = ctx.element.clip;
  if (!clip) return null;
  const inset = clip.inset ?? [0, 0, 0, 0];
  const setInset = (i: number) =>
    bindPatch<number>(ctx, inset[i], (v) => {
      const next = [...inset] as [number, number, number, number];
      next[i] = v ?? 0;
      return { clip: { inset: next.every((n) => n === 0) ? null : next } } as SceneElementPatch;
    });
  return (
    <>
      <FieldRow label="Inset" hint="Percent of the element's own box">
        <div className="grid grid-cols-4 gap-1">
          <NumberInput b={setInset(0)} label="Top" unit="%" step={1} min={-100} max={100} />
          <NumberInput b={setInset(1)} label="Right" unit="%" step={1} min={-100} max={100} />
          <NumberInput b={setInset(2)} label="Bottom" unit="%" step={1} min={-100} max={100} />
          <NumberInput b={setInset(3)} label="Left" unit="%" step={1} min={-100} max={100} />
        </div>
      </FieldRow>
      {clip.type === "rect" ? (
        <FieldRow label="Corners">
          <NumberInput b={bindPatch<number>(ctx, clip.radius, (v) => ({ clip: { radius: v } }) as SceneElementPatch)} label="Corner radius" unit="%" step={1} min={0} max={50} placeholder="0" />
        </FieldRow>
      ) : null}
      <FieldRow label="Reveal" hint="The side the clip opens from — animate “Clip reveal” to wipe it open">
        <SelectInput
          b={bindPatch<string>(ctx, clip.reveal ?? "none", (v) => ({ clip: { reveal: (v as Clip["reveal"]) ?? null } }) as SceneElementPatch)}
          label="Reveal direction"
          options={CLIP_REVEALS.map((value) => ({ value, label: value === "none" ? "No wipe" : humanize(value) }))}
        />
      </FieldRow>
      {clip.reveal && clip.reveal !== "none" ? (
        <FieldRow label="Revealed">
          <AnimatedPropertyField ctx={ctx} property="clipProgress" label="Clip reveal" />
        </FieldRow>
      ) : null}
    </>
  );
}

export function CompositingSection({ ctx, id }: { ctx: ElementFieldContext; id: string }) {
  const el = ctx.element;
  const primary = useInspectorEnv()?.design?.colors.primary;
  const groups = EFFECT_GROUPS.filter((g) => isOn(ctx, g));
  const missing = EFFECT_GROUPS.filter((g) => !isOn(ctx, g));
  const blend = el.blend ?? "normal";
  const changed = blend !== "normal" || groups.length > 0 || !!el.clip;
  const summary = [blend !== "normal" ? humanize(blend) : null, ...groups.map((g) => g.label.toLowerCase()), el.clip ? `${el.clip.type} clip` : null].filter(Boolean).join(" · ");
  const removeGroup = (group: EffectGroup) => ctx.commit({ effects: Object.fromEntries(group.keys.map((k) => [k, null])) } as SceneElementPatch);

  return (
    <InspectorSection
      id={id}
      title="Compositing"
      defaultOpen={false}
      summary={summary || "none"}
      actions={changed ? <ResetButton label="Reset compositing" onClick={() => ctx.commit({ blend: null, effects: null, clip: null })} disabled={ctx.disabled} /> : null}
    >
      <FieldRow label="Blend" hint="How its pixels mix with the layer below">
        <SelectInput b={bindPatch<BlendMode>(ctx, blend, (v) => ({ blend: v }) as SceneElementPatch)} label="Blend mode" options={BLEND_MODES.map((value) => ({ value, label: humanize(value) }))} />
      </FieldRow>

      {groups.map((group) => (
        <div key={group.id} className="space-y-1 border-t border-border/60 pt-2 first:border-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</span>
            <button type="button" aria-label={`Remove ${group.label.toLowerCase()}`} title={`Remove ${group.label.toLowerCase()}`} disabled={ctx.disabled} className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40" onClick={() => removeGroup(group)}>
              <X className="size-3" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {group.properties.map((property) => (
              // An unset glow colour is the design system's primary — the control shows the colour it draws with.
              <AnimatedPropertyField key={property} ctx={ctx} property={property} fallback={property === "glowColor" ? primary : undefined} />
            ))}
          </div>
        </div>
      ))}

      {missing.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 w-full justify-center gap-1 text-xs" disabled={ctx.disabled}>
              <Plus className="size-3" /> Add an effect
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {missing.map((group) => (
              <DropdownMenuItem key={group.id} onSelect={() => ctx.commit({ effects: group.on } as SceneElementPatch)}>
                {group.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <div className="space-y-1 border-t border-border/60 pt-2">
        <FieldRow label="Clip" hint="A shape it is seen through, in % of its own box">
          <SegmentedField
            ariaLabel="Clip shape"
            value={el.clip?.type ?? "none"}
            options={CLIP_OPTIONS}
            disabled={ctx.disabled}
            onChange={(value) => ctx.commit({ clip: value === "none" ? null : ({ type: value as ClipShape } as Clip) } as SceneElementPatch)}
          />
        </FieldRow>
        <ClipFields ctx={ctx} />
      </div>
    </InspectorSection>
  );
}

