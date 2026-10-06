"use client";

import { AlignCenter, AlignLeft, AlignRight, Braces, Clipboard, ClipboardCopy, ClipboardPaste, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { MOTION_GRAMMAR, grammarEnter } from "@/core/creative/grammar";
import { animatedProperties, isAnimated, offsetKeyframeValues } from "@/core/motion/keyframes";
import { animatableProperty } from "@/core/spec/animatable";
import { CURATED_FONTS, TEXT_ROLE_SIZES, TYPE_SCALE_MULTIPLIER } from "@/core/spec/design";
import { APPEARANCE_PROPS, SHADOW_KINDS, STYLE_SUPPORT, TRAVEL_ENTRANCES, TRAVEL_EXITS, TYPOGRAPHY_PROPS, entrancesFor, styleLabel, usesStagger, type StyleKey } from "@/core/spec/element-properties";
import {
  EASINGS,
  EXIT_ANIMATIONS,
  IdleSchema,
  MOTION_INTENTS,
  MOTION_ROLES,
  TEXT_ROLES,
  type Anchor,
  type ElementOf,
  type EnterAnimation,
  type ExitAnimation,
  type MotionIntent,
  type MotionRole,
  type SceneElement,
} from "@/core/spec/scene";
import { isVoiceTrigger, type TriggerContext } from "@/core/spec/triggers";
import { describeTrigger } from "@/core/timeline/element-cues";
import { MOTION_CUT_SEC } from "@/core/timeline/element-layout";
import { ALIGN_LABELS, ALIGN_MODES, ARRANGE_ACTIONS, ARRANGE_LABELS } from "@/core/timeline/element-ops";
import { DEFAULT_EXIT_SEC } from "@/core/timeline/media-clip";
import { elementSpan } from "@/core/timeline/scene-restructure";
import type { SceneElementPatch } from "@/server/services/scene-elements";
import type { SceneDto } from "@/server/services/scenes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ALIGN_ICONS, ARRANGE_ICONS, ARRANGE_SHORTCUTS, type ElementActions } from "./element-actions";
import { OpacityField, TransformFields, hasPosition, sizeModeOf, type ElementFieldContext } from "./element-fields";
import { useInspectorEnv, usePlayheadTime } from "./inspector-env";
import { IconAction, InspectorSection, ScrubField } from "./inspector-section";
import { copyProperties, pastePatch, usePropertyClip, type PropertyGroup } from "./property-clipboard";
import { AnchorField, FieldHint, FieldRow, ResetButton, SegmentedField, SelectField, TextField, ColorField, compact } from "./property-fields";
import { ColorInput, NumberInput, SegmentInput, SelectInput, SwitchInput, bindPatch, humanize, options, propBinding, styleBinding, type Binding } from "./property-inputs";

/**
 * The inspector's shared sections for a selected element — transform, appearance, typography,
 * animation, timing, arrange and advanced. Each shows only what the element's renderer reads (see
 * core/spec/element-properties.ts) and saves through the element's field context, so the preview, the
 * canvas and the timeline follow every change and each save is one undoable scene edit.
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------------------
// Header, notes and the property clipboard
// ---------------------------------------------------------------------------------------

export function InspectorHeader({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-panel px-3 py-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={title}>
          {title}
        </p>
        <p className="truncate font-mono text-[10px] text-muted-foreground" title={subtitle}>
          {subtitle}
        </p>
      </div>
      {children}
    </div>
  );
}

export function BlockedNote({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <p className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Lock className="mr-1 inline size-3" /> {reason}
    </p>
  );
}

/** Copy this element's transform, appearance, animation or timing, or paste what was copied. `segment`: its scene (and shot) timing, for timing. */
export function ClipboardMenu({ ctx, group, name, segment }: { ctx: ElementFieldContext; group: PropertyGroup; name: string; segment?: TriggerContext | null }) {
  const clip = usePropertyClip(group);
  const paste = () => {
    if (!clip) return;
    const patch = pastePatch(clip, ctx.saved, segment ?? undefined);
    if (!patch) {
      toast(`A ${clip.type}'s ${group} doesn't apply to a ${ctx.saved.type}.`);
      return;
    }
    ctx.commit(patch);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`Copy or paste ${group}`} title={`Copy or paste ${group}`}>
          <Clipboard />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem
          onSelect={() => {
            copyProperties(group, ctx.saved, name, segment ?? undefined);
            toast.success(`Copied the ${group} of ${name}`, { description: "Select another element and paste it." });
          }}
        >
          <ClipboardCopy /> Copy {group}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!clip || ctx.disabled} onSelect={paste}>
          <ClipboardPaste /> Paste {group}
          {clip ? <span className="ml-auto truncate pl-2 font-mono text-[10px] text-muted-foreground">{clip.name}</span> : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------------------

const ANCHOR_POINT: Record<Anchor, [number, number]> = {
  "top-left": [0, 0],
  top: [0.5, 0],
  "top-right": [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  "bottom-left": [0, 1],
  bottom: [0.5, 1],
  "bottom-right": [1, 1],
};
const clampPosition = (n: number) => Math.max(-100, Math.min(200, n));

export function TransformSection({
  ctx,
  id,
  name,
  auto,
  keepAspect,
  onKeepAspect,
  hint,
}: {
  ctx: ElementFieldContext;
  id: string;
  name: string;
  auto: { width: number; height: number };
  keepAspect: boolean;
  onKeepAspect: (on: boolean) => void;
  hint?: ReactNode;
}) {
  const env = useInspectorEnv();
  const el = ctx.element;
  if (!hasPosition(el.type)) return null;
  const anchor = el.anchor ?? "center";
  const mode = sizeModeOf(el);
  const sizeProp = mode === "maxWidth" ? "maxWidth" : mode === "size" ? "size" : null;
  const set =
    el.x !== undefined || el.y !== undefined || el.width !== undefined || el.height !== undefined || el.anchor !== undefined || el.rotation !== undefined || el.rotateX !== undefined || el.rotateY !== undefined || el.scale !== undefined || (sizeProp !== null && (el as Record<string, unknown>)[sizeProp] !== undefined);
  const reset = () => ctx.commit({ x: null, y: null, width: null, height: null, anchor: null, rotation: null, scale: null, ...(sizeProp ? { props: { [sizeProp]: null } } : {}) });

  // A new anchor keeps the element where it is: x/y move to the new anchor point of its box.
  const changeAnchor = (next: Anchor) => {
    if (next === anchor) return;
    const box = env?.measure(ctx.sceneId, ctx.elementRef) ?? null;
    if (!box) {
      ctx.commit({ anchor: next });
      toast("X and Y now place a different point, so it moved.", { id: "anchor-moved", description: "Move the playhead to where it's on screen to change the anchor without moving it." });
      return;
    }
    const [fx, fy] = ANCHOR_POINT[next];
    const [ox, oy] = ANCHOR_POINT[anchor];
    // Keyframed positions move by the same amount, so the animation keeps its path on screen.
    const keyed = isAnimated(el, "x") || isAnimated(el, "y");
    const offset = { x: (((fx - ox) * box.width) / ctx.frame.width) * 100, y: (((fy - oy) * box.height) / ctx.frame.height) * 100 };
    ctx.commit({
      anchor: next,
      x: clampPosition(((box.left + fx * box.width) / ctx.frame.width) * 100),
      y: clampPosition(((box.top + fy * box.height) / ctx.frame.height) * 100),
      ...(keyed ? { keyframes: offsetKeyframeValues(el.keyframes ?? [], offset) } : {}),
    });
  };
  const animated = animatedProperties(el).filter((p) => p !== "opacity");

  return (
    <InspectorSection
      id={id}
      title="Transform"
      summary={animated.length ? `◆ ${animated.map((p) => animatableProperty(p).label.toLowerCase()).join(", ")}` : `${el.x ?? 50}, ${el.y ?? 50}${el.rotation ? ` · ${el.rotation}°` : ""}${el.scale && el.scale !== 1 ? ` · ${el.scale}×` : ""}`}
      actions={
        <>
          <ClipboardMenu ctx={ctx} group="transform" name={name} />
          {set ? <ResetButton label="Reset transform" onClick={reset} disabled={ctx.disabled} /> : null}
        </>
      }
    >
      <TransformFields ctx={ctx} auto={auto} keepAspect={keepAspect} onKeepAspect={onKeepAspect} />
      <div className="flex items-center gap-2.5">
        <AnchorField value={anchor} onChange={changeAnchor} disabled={ctx.disabled} />
        <FieldHint>
          X and Y place its <span className="text-foreground">{anchor.replace("-", " ")}</span>, in % of the frame. Rotation and scale turn around its centre.
        </FieldHint>
      </div>
      {hint}
    </InspectorSection>
  );
}

// ---------------------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------------------

const CARD_VARIANTS = ["default", "glass", "solid", "outline", "app", "stat", "feature", "testimonial"] as const;
type Theme = "auto" | "light" | "dark";
const THEMES: { value: Theme; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function ThemeInput({ ctx }: { ctx: ElementFieldContext }) {
  const b = propBinding<"light" | "dark">(ctx, "theme");
  return (
    <FieldRow label="Theme" hint="Auto follows the scene's background" onReset={b.value ? () => b.commit(null) : undefined} disabled={b.disabled}>
      <SegmentedField value={b.value ?? "auto"} options={THEMES} ariaLabel="Theme" disabled={b.disabled} onChange={(v) => b.commit(v === "auto" ? null : v)} />
    </FieldRow>
  );
}

/** The look fields of the element's own type (fill, stroke, variant, theme…). */
function TypeAppearance({ ctx }: { ctx: ElementFieldContext }) {
  const env = useInspectorEnv();
  const el = ctx.element;
  const p = <T,>(key: string) => propBinding<T>(ctx, key);
  switch (el.type) {
    case "rect": {
      const fill = el.fill ?? true;
      return (
        <>
          <SwitchInput b={p<boolean>("fill")} label="Filled" fallback />
          <ColorInput b={p<string>("color")} label={fill ? "Color" : "Stroke"} fallback={fill ? "surface" : "primary"} />
          <div className="grid grid-cols-2 gap-1.5">
            {!fill ? <NumberInput b={p<number>("strokeWidth")} label="Stroke" unit="px" placeholder={3} min={0.5} max={100} step={0.5} /> : null}
            <NumberInput b={p<number>("radius")} label="Radius" unit="px" placeholder={env?.design?.shape.radius ?? 0} min={0} max={2000} />
          </div>
        </>
      );
    }
    case "circle": {
      const fill = el.fill ?? false;
      return (
        <>
          <SwitchInput b={p<boolean>("fill")} label="Filled" fallback={false} />
          <ColorInput b={p<string>("color")} label={fill ? "Color" : "Stroke"} fallback="primary" />
          {!fill ? <NumberInput b={p<number>("strokeWidth")} label="Stroke" unit="px" placeholder={4} min={0.5} max={100} step={0.5} /> : null}
        </>
      );
    }
    case "line":
      return (
        <>
          <ColorInput b={p<string>("color")} label="Color" fallback="primary" />
          <NumberInput b={p<number>("strokeWidth")} label="Stroke" unit="px" placeholder={4} min={0.5} max={100} step={0.5} />
          <SwitchInput b={p<boolean>("dashed")} label="Dashed" fallback={false} />
          <SwitchInput b={p<boolean>("arrow")} label="Arrowhead" fallback={false} />
        </>
      );
    case "grid":
      return (
        <>
          <SegmentInput b={p<"lines" | "dots">("variant")} label="Pattern" options={options(["lines", "dots"] as const)} fallback="lines" />
          <ColorInput b={p<string>("color")} label="Color" fallback="text" />
          <NumberInput b={p<number>("spacing")} label="Spacing" unit="px" placeholder={72} min={1} max={1000} />
          <SwitchInput b={p<boolean>("perspective")} label="Perspective" fallback={false} hint="Tilted floor that drifts" />
        </>
      );
    case "progress":
      return (
        <>
          <SegmentInput b={p<"bar" | "ring">("variant")} label="Style" options={options(["bar", "ring"] as const)} fallback="bar" />
          <ColorInput b={p<string>("color")} label="Color" fallback="primary" />
        </>
      );
    case "icon":
      return (
        <>
          <ColorInput b={p<string>("color")} label="Color" fallback="primary" />
          <SelectInput b={p<"none" | "circle" | "square" | "glass">("container")} label="Container" options={options(["none", "circle", "square", "glass"] as const)} defaultLabel="Default (none)" />
          <NumberInput b={p<number>("strokeWidth")} label="Stroke" placeholder={1.8} step={0.1} min={0.1} max={10} />
        </>
      );
    case "image":
      return (
        <>
          <SelectInput b={p<"none" | "circle" | "rounded">("mask")} label="Mask" options={options(["none", "circle", "rounded"] as const)} defaultLabel="Default (none)" />
          <NumberInput b={p<number>("radius")} label="Radius" unit="px" placeholder={el.mask === "rounded" ? (env?.design?.shape.radius ?? 0) * 1.5 : 0} min={0} max={2000} />
        </>
      );
    case "video":
      return <NumberInput b={p<number>("radius")} label="Radius" unit="px" placeholder={0} min={0} max={2000} />;
    case "card":
    case "cards":
      return (
        <>
          <SelectInput b={p<(typeof CARD_VARIANTS)[number]>("variant")} label="Variant" options={options(CARD_VARIANTS)} defaultLabel="Default" />
          <ColorInput b={p<string>("accent")} label="Accent" fallback="primary" />
        </>
      );
    case "badge":
      return <SegmentInput b={p<"solid" | "soft" | "outline" | "glass">("variant")} label="Variant" options={options(["solid", "soft", "outline", "glass"] as const)} fallback="soft" />;
    case "button":
      return (
        <>
          <SelectInput b={p<"primary" | "secondary" | "outline" | "ghost">("variant")} label="Variant" options={options(["primary", "secondary", "outline", "ghost"] as const)} defaultLabel="Default (primary)" />
          <SegmentInput b={p<"sm" | "md" | "lg">("size")} label="Size" options={options(["sm", "md", "lg"] as const, (s) => s.toUpperCase())} fallback="lg" />
        </>
      );
    case "notification":
      return <SegmentInput b={p<"toast" | "ios" | "banner">("variant")} label="Style" options={options(["toast", "ios", "banner"] as const, (v) => (v === "ios" ? "iOS" : humanize(v)))} fallback="toast" />;
    case "chart":
    case "diagram":
      return <ColorInput b={p<string>("color")} label="Color" fallback="primary" />;
    case "browser":
    case "phone":
    case "dashboard":
      return <ThemeInput ctx={ctx} />;
    case "desktop":
      return (
        <>
          <ThemeInput ctx={ctx} />
          <SegmentInput b={p<"laptop" | "monitor">("device")} label="Device" options={options(["laptop", "monitor"] as const)} fallback="laptop" />
        </>
      );
    case "logo":
      return (
        <>
          <SelectInput b={p<"mark" | "wordmark" | "lockup">("variant")} label="Variant" options={options(["mark", "wordmark", "lockup"] as const)} defaultLabel="Default (mark, or the name)" />
          <ColorInput b={p<string>("color")} label="Name color" fallback="text" />
        </>
      );
    case "captions":
      return (
        <>
          <SelectInput b={p<"minimal" | "boxed" | "bold" | "karaoke">("variant")} label="Style" options={options(["minimal", "boxed", "bold", "karaoke"] as const)} defaultLabel="Default (boxed)" />
          <SegmentInput b={p<"bottom" | "center" | "top">("position")} label="Position" options={options(["top", "center", "bottom"] as const)} fallback="bottom" />
        </>
      );
    case "cursor":
      return <SegmentInput b={p<"arrow" | "hand">("variant")} label="Pointer" options={options(["arrow", "hand"] as const)} fallback="arrow" />;
    default:
      return null;
  }
}

/** `style` keys the element's renderer reads. */
function StyleFields({ ctx }: { ctx: ElementFieldContext }) {
  const env = useInspectorEnv();
  const el = ctx.element;
  const keys = STYLE_SUPPORT[el.type];
  const has = (key: StyleKey) => keys.includes(key);
  const s = <T,>(key: StyleKey) => styleBinding<T>(ctx, key);
  const surface = el.type === "card" || el.type === "cards";
  const variant = surface ? (el as ElementOf<"card">).variant : undefined;
  const glass = el.style?.glass ?? variant === "glass";
  const media = el.type === "image" || el.type === "video";
  const radius = env?.design?.shape.radius ?? 0;
  return (
    <div className="space-y-1.5 border-t border-border/60 pt-2">
      {has("background") ? <ColorInput b={s<string>("background")} label={styleLabel(el.type, "background")} fallback={surface ? "surface" : el.type === "button" ? "primary" : undefined} /> : null}
      {has("color") ? <ColorInput b={s<string>("color")} label={styleLabel(el.type, "color")} fallback={el.type === "button" ? undefined : "primary"} /> : null}
      {has("borderColor") ? <ColorInput b={s<string>("borderColor")} label="Border" hint={media ? "Draws a border around it" : undefined} /> : null}
      <div className="grid grid-cols-2 gap-1.5">
        {has("borderWidth") && (!media || el.style?.borderColor) ? <NumberInput b={s<number>("borderWidth")} label="Border" unit="px" placeholder={media ? 2 : Math.max(1, env?.design?.shape.borderWidth ?? 1)} min={0} max={40} step={0.5} /> : null}
        {has("radius") ? <NumberInput b={s<number>("radius")} label="Radius" unit="px" placeholder={el.type === "button" ? Math.max(12, radius * 1.2) : radius} min={0} max={2000} /> : null}
        {has("padding") ? <NumberInput b={s<number>("padding")} label="Padding" unit="px" placeholder={variant === "stat" ? 34 : 38} min={0} max={400} /> : null}
        {has("blur") && glass ? <NumberInput b={s<number>("blur")} label="Blur" unit="px" placeholder={24} min={0} max={200} /> : null}
      </div>
      {has("shadow") ? <SelectInput b={s<(typeof SHADOW_KINDS)[number]>("shadow")} label="Shadow" options={options(SHADOW_KINDS)} defaultLabel={`Default (${media ? "none" : (env?.design?.shape.shadow ?? "design")})`} /> : null}
      {has("glass") ? <SwitchInput b={s<boolean>("glass")} label="Glass" fallback={variant === "glass"} hint="A frosted, see-through surface" /> : null}
    </div>
  );
}

export function AppearanceSection({ ctx, id, name, extra }: { ctx: ElementFieldContext; id: string; name: string; extra?: ReactNode }) {
  const el = ctx.element;
  const styleKeys = STYLE_SUPPORT[el.type];
  const propKeys = APPEARANCE_PROPS[el.type] ?? [];
  const record = el as Record<string, unknown>;
  const changed = el.opacity !== undefined || styleKeys.some((k) => el.style?.[k] !== undefined) || propKeys.some((k) => record[k] !== undefined);
  const reset = () =>
    ctx.commit({
      opacity: null,
      ...(styleKeys.length ? { style: Object.fromEntries(styleKeys.map((k) => [k, null])) } : {}),
      ...(propKeys.length ? { props: Object.fromEntries(propKeys.map((k) => [k, null])) } : {}),
    });
  return (
    <InspectorSection
      id={id}
      title="Appearance"
      summary={isAnimated(el, "opacity") ? "◆ opacity" : `${Math.round((el.opacity ?? 1) * 100)}%`}
      actions={
        <>
          <ClipboardMenu ctx={ctx} group="appearance" name={name} />
          {changed ? <ResetButton label="Reset appearance" onClick={reset} disabled={ctx.disabled} /> : null}
        </>
      }
    >
      <OpacityField ctx={ctx} />
      {extra}
      <TypeAppearance ctx={ctx} />
      {styleKeys.length ? <StyleFields ctx={ctx} /> : null}
    </InspectorSection>
  );
}

// ---------------------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------------------

const HEADING_ROLES = new Set<string>(["display", "headline", "title", "quote"]);
/** Weights the renderer loads for every curated font. */
const WEIGHTS = [400, 500, 600, 700, 800];
const WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black" };
const ALIGN_OPTIONS: { value: "left" | "center" | "right"; label: string; icon: ReactNode }[] = [
  { value: "left", label: "Left", icon: <AlignLeft /> },
  { value: "center", label: "Center", icon: <AlignCenter /> },
  { value: "right", label: "Right", icon: <AlignRight /> },
];
const CASE_OPTIONS: { value: "none" | "uppercase" | "lowercase"; label: string }[] = [
  { value: "none", label: "Aa" },
  { value: "uppercase", label: "AA" },
  { value: "lowercase", label: "aa" },
];

function FontInput({ ctx, heading, mono }: { ctx: ElementFieldContext; heading: boolean; mono: boolean }) {
  const env = useInspectorEnv();
  const t = env?.design?.typography;
  const choices = [
    { value: "heading", label: `Heading font${t ? ` · ${t.headingFont}` : ""}` },
    { value: "body", label: `Body font${t ? ` · ${t.bodyFont}` : ""}` },
    ...(mono ? [{ value: "mono", label: `Mono font${t ? ` · ${t.monoFont}` : ""}` }] : []),
    ...[...new Set([...(env?.fonts ?? []), ...CURATED_FONTS])].map((family) => ({ value: family, label: family })),
  ];
  return <SelectInput b={propBinding<string>(ctx, "font")} label="Font" options={choices} defaultLabel={`Default (${heading ? "heading" : "body"} font)`} hint="Design fonts follow brand changes" />;
}

function WeightInput({ ctx, fallback }: { ctx: ElementFieldContext; fallback: number }) {
  const b = propBinding<number>(ctx, "weight");
  const list = b.value !== undefined && !WEIGHTS.includes(b.value) ? [...WEIGHTS, b.value].sort((x, y) => x - y) : WEIGHTS;
  return (
    <FieldRow label="Weight" onReset={b.value !== undefined ? () => b.commit(null) : undefined} disabled={b.disabled}>
      <SelectField
        value={b.value === undefined ? undefined : String(b.value)}
        options={list.map((w) => ({ value: String(w), label: `${w} · ${WEIGHT_NAMES[w] ?? ""}` }))}
        defaultLabel={`Default (${fallback})`}
        ariaLabel="Weight"
        disabled={b.disabled}
        onChange={(v) => b.commit(v === undefined ? null : Number(v))}
      />
    </FieldRow>
  );
}

function HighlightInput({ ctx }: { ctx: ElementFieldContext }) {
  const env = useInspectorEnv();
  const el = ctx.element as ElementOf<"text">;
  const h = el.highlight;
  type Highlight = NonNullable<typeof h>;
  const save = (next: Highlight | null) => ctx.commit({ props: { highlight: next } });
  const change = (patch: Partial<Highlight>) => h && save(compact({ ...h, ...patch }));
  return (
    <div className="space-y-1.5 border-t border-border/60 pt-2">
      <FieldRow label="Highlight" hint="Words to highlight, separated by commas" onReset={h ? () => save(null) : undefined} disabled={ctx.disabled}>
        <TextField
          value={h?.words.join(", ") ?? ""}
          ariaLabel="Highlighted words"
          placeholder="words, to highlight"
          disabled={ctx.disabled}
          onCommit={(text) => {
            const words = text
              .split(",")
              .map((w) => w.trim())
              .filter(Boolean)
              .slice(0, 20);
            save(words.length ? { ...(h ?? {}), words } : null);
          }}
        />
      </FieldRow>
      {h ? (
        <>
          <FieldRow label="Style">
            <SegmentedField value={h.style ?? "color"} options={options(["color", "marker", "underline", "box"] as const)} ariaLabel="Highlight style" disabled={ctx.disabled} onChange={(v) => change({ style: v === "color" ? undefined : v })} />
          </FieldRow>
          <FieldRow label="Color" onReset={h.color ? () => change({ color: undefined }) : undefined} disabled={ctx.disabled}>
            <ColorField
              value={h.color}
              fallback="primary"
              design={env?.design ?? null}
              ariaLabel="Highlight color"
              disabled={ctx.disabled}
              onPreview={(color) => ctx.preview({ props: { highlight: { ...h, color } } })}
              onCancel={ctx.cancel}
              onCommit={(color) => change({ color: color ?? undefined })}
            />
          </FieldRow>
          <FieldRow label="When">
            <SegmentedField
              value={h.at ?? "enter"}
              options={[
                { value: "enter", label: "As it enters" },
                { value: "spoken", label: "When spoken" },
              ]}
              ariaLabel="When the highlight lands"
              disabled={ctx.disabled}
              onChange={(v) => change({ at: v === "enter" ? undefined : v })}
            />
          </FieldRow>
        </>
      ) : null}
    </div>
  );
}

function TypographyFields({ ctx }: { ctx: ElementFieldContext }) {
  const env = useInspectorEnv();
  const design = env?.design ?? null;
  const el = ctx.element;
  const p = <T,>(key: string) => propBinding<T>(ctx, key);
  const portrait = ctx.frame.height > ctx.frame.width;
  switch (el.type) {
    case "text": {
      const role = el.role ?? "title";
      const heading = HEADING_ROLES.has(role);
      const size = Math.round(TEXT_ROLE_SIZES[role] * (design ? TYPE_SCALE_MULTIPLIER[design.typography.scale] : 1));
      const weight = role === "eyebrow" || role === "label" ? 600 : heading ? (design?.typography.headingWeight ?? 700) : (design?.typography.bodyWeight ?? 400);
      const lineHeight = heading ? (design?.typography.lineHeight ?? 1.1) : 1.4;
      const tracking = role === "eyebrow" ? 0.16 : heading ? (design?.typography.headingLetterSpacing ?? 0) : 0;
      const textCase = role === "eyebrow" ? "uppercase" : heading ? (design?.typography.headingTransform ?? "none") : "none";
      return (
        <>
          <SelectInput b={p<(typeof TEXT_ROLES)[number]>("role")} label="Role" options={options(TEXT_ROLES)} defaultLabel="Default (title)" hint="Sets the default size, weight and font" />
          <FontInput ctx={ctx} heading={heading} mono />
          <WeightInput ctx={ctx} fallback={weight} />
          <div className="grid grid-cols-3 gap-1.5">
            <NumberInput b={p<number>("size")} label="Size" placeholder={size} min={1} max={1200} title="Font size in pixels at 1080p" />
            <NumberInput b={p<number>("lineHeight")} label="Line" step={0.05} min={0.5} max={3} placeholder={lineHeight} title="Line height, × the font size" />
            <NumberInput b={p<number>("letterSpacing")} label="Track" step={0.005} min={-0.2} max={1} placeholder={tracking} title="Letter spacing in em" />
          </div>
          <SegmentInput b={p<"left" | "center" | "right">("align")} label="Align" options={ALIGN_OPTIONS} fallback="center" />
          <SegmentInput b={p<"none" | "uppercase" | "lowercase">("transform")} label="Case" options={CASE_OPTIONS} fallback={textCase} />
          <ColorInput b={p<string>("color")} label="Color" fallback={role === "caption" || role === "label" || role === "eyebrow" ? "muted" : "text"} />
          <SwitchInput b={p<boolean>("gradient")} label="Gradient" fallback={false} hint="Primary to secondary color across the text" />
          <HighlightInput ctx={ctx} />
        </>
      );
    }
    case "kinetic": {
      const size = el.mode === "word" ? 180 : portrait ? 100 : 112;
      return (
        <>
          <FontInput ctx={ctx} heading mono={false} />
          <WeightInput ctx={ctx} fallback={design?.typography.headingWeight ?? 700} />
          <NumberInput b={p<number>("size")} label="Size" placeholder={size} min={1} max={1200} title="Font size in pixels at 1080p" />
          <SegmentInput b={p<"left" | "center" | "right">("align")} label="Align" options={ALIGN_OPTIONS} fallback="center" />
          <SegmentInput b={p<"none" | "uppercase" | "lowercase">("transform")} label="Case" options={CASE_OPTIONS} fallback={design?.typography.headingTransform ?? "none"} />
          <ColorInput b={p<string>("color")} label="Color" fallback="text" />
          <ColorInput b={p<string>("activeColor")} label="Emphasis" fallback="primary" hint="Emphasis words and the word being spoken" />
        </>
      );
    }
    case "badge":
      return (
        <div className="space-y-1.5">
          <NumberInput b={p<number>("size")} label="Size" placeholder={24} min={1} max={1200} title="Font size in pixels at 1080p" />
          <ColorInput b={p<string>("color")} label="Color" fallback="primary" />
        </div>
      );
    case "counter":
      return (
        <div className="space-y-1.5">
          <NumberInput b={p<number>("size")} label="Size" placeholder={180} min={1} max={1200} title="Number size in pixels at 1080p" />
          <ColorInput b={p<string>("color")} label="Color" fallback="text" />
        </div>
      );
    case "list":
      return (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <NumberInput b={p<number>("size")} label="Size" placeholder={44} min={1} max={1200} title="Text size in pixels at 1080p" />
            <NumberInput b={p<number>("gap")} label="Gap" placeholder={26} min={0} max={400} title="Space between items in pixels" />
          </div>
          <ColorInput b={p<string>("color")} label="Color" fallback="text" />
        </div>
      );
    case "captions":
      return <NumberInput b={p<number>("size")} label="Size" placeholder={el.variant === "bold" ? 64 : 44} min={1} max={1200} title="Text size in pixels at 1080p" />;
    case "logo":
      return <NumberInput b={p<number>("size")} label="Size" placeholder={120} min={1} max={1200} title="Logo height in pixels at 1080p" />;
    default:
      return null;
  }
}

export function TypographySection({ ctx, id }: { ctx: ElementFieldContext; id: string }) {
  const el = ctx.element;
  // Resetting typography keeps the text role: it's what the element is, not how it's set.
  const keys = (TYPOGRAPHY_PROPS[el.type] ?? []).filter((k) => k !== "role");
  if (!TYPOGRAPHY_PROPS[el.type]) return null;
  const record = el as Record<string, unknown>;
  const changed = keys.some((k) => record[k] !== undefined);
  const summary = [record.role, record.font, record.size !== undefined ? `${record.size}px` : null].filter(Boolean).join(" · ") || "design defaults";
  return (
    <InspectorSection id={id} title="Typography" summary={summary} actions={changed ? <ResetButton label="Reset typography to the design defaults" onClick={() => ctx.commit({ props: Object.fromEntries(keys.map((k) => [k, null])) })} disabled={ctx.disabled} /> : null}>
      <TypographyFields ctx={ctx} />
    </InspectorSection>
  );
}

// ---------------------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------------------

const isCut = (m: EnterAnimation | ExitAnimation | undefined) => !!m && (m.type === "none" || (m.type === "fade" && (m.duration ?? 1) <= MOTION_CUT_SEC + 0.005));

/** "default" (no entrance of its own), "none" (a cut) or the entrance type. */
export const enterChoice = (el: SceneElement): string => (!el.enter ? "default" : isCut(el.enter) ? "none" : el.enter.type);

/** "none" (no exit, or a cut) or the exit type. */
export function exitChoice(el: SceneElement): string {
  const exit = el.exit && el.exit.type !== "none" ? el.exit : undefined;
  return !exit || isCut(exit) ? "none" : exit.type;
}
const ENTER_DISTANCE: Record<string, number> = { rise: 48, slideUp: 140, slideDown: 140, slideLeft: 200, slideRight: 200 };
const EXIT_DISTANCE: Record<string, number> = { slideUp: 120, slideDown: 120, slideLeft: 200, slideRight: 200 };
const IDLES = IdleSchema.options.filter((i) => i !== "none");

function motionLabel(m: EnterAnimation | ExitAnimation | undefined, empty: string): string {
  if (!m) return empty;
  if (isCut(m)) return "cut";
  return `${humanize(m.type).toLowerCase()}${m.duration ? ` ${m.duration}s` : ""}`;
}

export function motionSummary(el: SceneElement): string {
  return `in ${motionLabel(el.enter, "default")} · out ${el.exit && el.exit.type !== "none" ? motionLabel(el.exit, "none") : "none"}`;
}

export function AnimationSection({ ctx, id, name, extra }: { ctx: ElementFieldContext; id: string; name: string; extra?: ReactNode }) {
  const env = useInspectorEnv();
  const design = env?.design ?? null;
  const el = ctx.element;
  const enter = el.enter;
  const exit = el.exit && el.exit.type !== "none" ? el.exit : undefined;
  const grammar = !enter && el.motionIntent ? grammarEnter(el.motionIntent, el.type) : undefined;
  const liveEnter = enter && !isCut(enter) ? enter : undefined;
  const liveExit = exit && !isCut(exit) ? exit : undefined;
  const types = entrancesFor(el.type);
  const enterTypes = liveEnter && !types.includes(liveEnter.type) ? [liveEnter.type, ...types] : types;
  const exitTypes = EXIT_ANIMATIONS.filter((t) => t !== "none" && (t !== "converge" || exit?.type === "converge"));
  const enterField = <T,>(value: T | undefined, key: keyof EnterAnimation, enabled: boolean): Binding<T> => ({
    ...bindPatch<T>(ctx, value, (v) => ({ enter: { [key]: v } }) as SceneElementPatch),
    disabled: ctx.disabled || !enabled,
  });

  const changed = !!(liveEnter && (liveEnter.duration !== undefined || liveEnter.easing || liveEnter.stagger !== undefined || liveEnter.distance !== undefined)) || !!(liveExit && (liveExit.easing || liveExit.distance !== undefined)) || !!el.idle;
  const reset = () =>
    ctx.commit({
      ...(liveEnter ? { enter: { duration: null, easing: null, stagger: null, distance: null } } : {}),
      ...(liveExit ? { exit: { easing: null, distance: null } } : {}),
      idle: null,
    });

  return (
    <InspectorSection
      id={id}
      title="Animation"
      summary={motionSummary(el)}
      actions={
        <>
          <ClipboardMenu ctx={ctx} group="animation" name={name} />
          {changed ? <ResetButton label="Reset length, easing, travel, stagger and idle motion to the design defaults" onClick={reset} disabled={ctx.disabled} /> : null}
        </>
      }
    >
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Entrance</p>
      <FieldRow label="Type">
        <SelectField
          value={!enter ? undefined : isCut(enter) ? "none" : enter.type}
          defaultLabel={!enter ? `Default (${grammar ? `${humanize(grammar.type).toLowerCase()}, from its intent` : "appears"})` : undefined}
          options={[{ value: "none", label: "Cut (no animation)" }, ...enterTypes.map((t) => ({ value: t, label: humanize(t) }))]}
          ariaLabel="Entrance"
          disabled={ctx.disabled}
          onChange={(v) => {
            if (!v) return;
            // A cut's own length goes, so the new animation takes the design's length.
            ctx.commit({ enter: v === "none" ? { type: "none" } : { type: v as EnterAnimation["type"], ...(enter && isCut(enter) ? { duration: null } : {}) } });
          }}
        />
      </FieldRow>
      <div className="grid grid-cols-2 gap-1.5">
        <NumberInput b={enterField(liveEnter?.duration, "duration", !!liveEnter)} label="Length" unit="s" step={0.05} min={0.05} max={10} placeholder={liveEnter ? (design?.motion.defaultDuration ?? 0.6) : "—"} title="How long the entrance takes" />
        <NumberInput b={enterField(enter?.delay, "delay", !!enter)} label="Delay" unit="s" step={0.05} min={-5} max={30} placeholder={enter ? 0 : "—"} title="Seconds after its cue" />
        {liveEnter && usesStagger(el) ? (
          <NumberInput b={enterField(liveEnter.stagger, "stagger", true)} label="Stagger" unit="s" step={0.01} min={0} max={2} placeholder={el.type === "text" && liveEnter.type === "charReveal" ? 0.022 : (design?.motion.stagger ?? 0.06)} title="Seconds between parts (words, characters, items)" />
        ) : null}
        {liveEnter && TRAVEL_ENTRANCES.has(liveEnter.type) ? <NumberInput b={enterField(liveEnter.distance, "distance", true)} label="Travel" unit="px" min={0} max={2000} placeholder={ENTER_DISTANCE[liveEnter.type]} title="How far it travels in, in pixels" /> : null}
      </div>
      <FieldRow label="Easing" onReset={liveEnter?.easing ? () => ctx.commit({ enter: { easing: null } }) : undefined} disabled={ctx.disabled}>
        <SelectField
          value={liveEnter?.easing}
          defaultLabel={`Default (${liveEnter?.type === "pop" ? "back out" : humanize(design?.motion.easing ?? "smooth").toLowerCase()})`}
          options={options(EASINGS)}
          ariaLabel="Entrance easing"
          disabled={ctx.disabled || !liveEnter}
          onChange={(v) => ctx.commit({ enter: { easing: v ?? null } })}
        />
      </FieldRow>
      {el.type === "text" && liveEnter?.type === "wordReveal" ? <SwitchInput b={propBinding<boolean>(ctx, "syncToVoice")} label="Voice sync" fallback={false} hint="Each word appears exactly when the narrator says it" /> : null}

      <p className="pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Exit</p>
      <FieldRow label="Type">
        <SelectField
          value={liveExit ? liveExit.type : "none"}
          options={[{ value: "none", label: "None / cut" }, ...exitTypes.map((t) => ({ value: t, label: humanize(t) }))]}
          ariaLabel="Exit"
          disabled={ctx.disabled}
          onChange={(v) => ctx.commit({ exit: !v || v === "none" ? null : { type: v as ExitAnimation["type"], ...(!liveExit ? { duration: DEFAULT_EXIT_SEC } : {}) } })}
        />
      </FieldRow>
      <div className="grid grid-cols-2 gap-1.5">
        <ScrubField
          label="Length"
          unit="s"
          value={liveExit ? (liveExit.duration ?? DEFAULT_EXIT_SEC) : null}
          placeholder="—"
          step={0.05}
          min={0.05}
          max={10}
          disabled={ctx.disabled || !liveExit}
          title="How long the exit takes (the moment it's gone stays put)"
          onCommit={(n) => ctx.commit({ exit: { duration: n } })}
        />
        {liveExit && TRAVEL_EXITS.has(liveExit.type) ? (
          <NumberInput b={{ ...bindPatch<number>(ctx, liveExit.distance, (v) => ({ exit: { distance: v } })) }} label="Travel" unit="px" min={0} max={2000} placeholder={EXIT_DISTANCE[liveExit.type]} title="How far it travels out, in pixels" />
        ) : null}
      </div>
      <FieldRow label="Easing" onReset={liveExit?.easing ? () => ctx.commit({ exit: { easing: null } }) : undefined} disabled={ctx.disabled}>
        <SelectField value={liveExit?.easing} defaultLabel="Default (ease in)" options={options(EASINGS)} ariaLabel="Exit easing" disabled={ctx.disabled || !liveExit} onChange={(v) => ctx.commit({ exit: { easing: v ?? null } })} />
      </FieldRow>

      <p className="pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">While on screen</p>
      <SelectInput b={bindPatch<(typeof IDLES)[number]>(ctx, el.idle === "none" ? undefined : el.idle, (v) => ({ idle: v }))} label="Idle" options={options(IDLES)} defaultLabel="None" hint="A gentle loop while it's on screen (scaled by the scene's motion density)" />
      {el.emphasis?.length ? (
        <FieldHint>
          {el.emphasis.length} emphasis moment{el.emphasis.length === 1 ? "" : "s"} ({[...new Set(el.emphasis.map((e) => e.type))].join(", ")}) — add, retime and edit them under Cues.
        </FieldHint>
      ) : null}
      {extra}
      <FieldHint>When it enters and leaves follows its cues — see Timing and Cues.</FieldHint>
    </InspectorSection>
  );
}

// ---------------------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------------------

const MIN_ON_SCREEN = 0.1;

/** Where the playhead is against the element: before it appears, while it's on screen, or after it's gone. */
function PlayheadStatus({ span, scene }: { span: { appear: number; gone: number }; scene: SceneDto }) {
  const t = usePlayheadTime();
  const text =
    t < scene.startSec - 0.001 || t > scene.endSec + 0.001
      ? "The playhead is outside this scene."
      : t < span.appear
        ? `Appears ${(span.appear - t).toFixed(2)}s after the playhead.`
        : t < span.gone
          ? `On screen at the playhead · ${(t - span.appear).toFixed(2)}s in.`
          : `Gone ${(t - span.gone).toFixed(2)}s before the playhead.`;
  return <p className="font-mono text-[10px] text-muted-foreground">{text}</p>;
}

export function TimingSection({ ctx, id, scene, segment }: { ctx: ElementFieldContext; id: string; scene: SceneDto; segment: TriggerContext | null }) {
  const env = useInspectorEnv();
  if (!segment) return null;
  const el = ctx.element;
  const span = elementSpan(el, segment);
  const shot = segment.shotStart !== undefined;
  const segmentStart = segment.shotStart ?? segment.sceneStart;
  const segmentEnd = segment.shotEnd ?? segment.sceneEnd;
  const enterCue = el.enter && el.enter.type !== "none" ? el.enter.at : undefined;
  const exitCue = el.exit && el.exit.type !== "none" ? el.exit.at : undefined;
  const timed = !!(el.enter?.at || el.enter?.delay || el.exit?.at);
  const words = env?.words ?? [];

  const setAppear = (t: number) => {
    const v = Math.min(Math.max(t, segmentStart), span.gone - MIN_ON_SCREEN);
    ctx.commit({ appearAt: v <= segmentStart + 0.005 ? null : r3(v - scene.startSec) });
  };
  const setGone = (t: number) => {
    const v = Math.max(Math.min(t, segmentEnd), span.appear + MIN_ON_SCREEN);
    ctx.commit({ disappearAt: v >= segmentEnd - 0.02 ? null : r3(v - scene.startSec) });
  };

  return (
    <InspectorSection
      id={id}
      title="Timing"
      summary={`${span.appear.toFixed(2)}–${span.gone.toFixed(2)}s`}
      actions={timed ? <ResetButton label={`Clear its cues: it follows ${shot ? "its shot" : "the scene"} again`} onClick={() => ctx.commit({ appearAt: null, disappearAt: null })} disabled={ctx.disabled} /> : null}
    >
      <div className="grid grid-cols-3 gap-1.5">
        <ScrubField label="In" unit="s" value={span.appear} step={0.01} min={segmentStart} max={span.gone - MIN_ON_SCREEN} disabled={ctx.disabled} title="When it appears (video seconds)" onCommit={setAppear} />
        <ScrubField label="Out" unit="s" value={span.gone} step={0.01} min={span.appear + MIN_ON_SCREEN} max={segmentEnd} disabled={ctx.disabled} title="When it's gone (video seconds)" onCommit={setGone} />
        <ScrubField label="Len" unit="s" value={span.gone - span.appear} step={0.01} min={MIN_ON_SCREEN} max={segmentEnd - span.appear} disabled={ctx.disabled} title="How long it's on screen" onCommit={(n) => setGone(span.appear + n)} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" disabled={ctx.disabled || !env} onClick={() => env && setAppear(env.getTime())}>
          Start at playhead
        </Button>
        <Button size="xs" variant="outline" disabled={ctx.disabled || !env} onClick={() => env && setGone(env.getTime())}>
          End at playhead
        </Button>
        <Button size="xs" variant="ghost" disabled={!env} onClick={() => env?.seek(span.appear)}>
          Go to it
        </Button>
      </div>
      <FieldHint>
        Enters {describeTrigger(enterCue, "start", shot, words)}
        {el.enter?.delay ? ` + ${el.enter.delay}s` : ""}; {exitCue ? `leaves ${describeTrigger(exitCue, "end", shot, words)}` : `stays until ${shot ? "its shot" : "the scene"} ends`}. It can move within {shot ? "its shot" : scene.key} ({segmentStart.toFixed(2)}–{segmentEnd.toFixed(2)}s).
      </FieldHint>
      {env?.playhead ? <PlayheadStatus span={span} scene={scene} /> : null}
      {isVoiceTrigger(enterCue) || isVoiceTrigger(exitCue) ? <FieldHint>Its cue follows the narration. A time set here replaces the cue, so it stops moving with the voice-over — cue it to a word under Cues to keep it on the voice.</FieldHint> : null}
    </InspectorSection>
  );
}

// ---------------------------------------------------------------------------------------
// Arrange and advanced
// ---------------------------------------------------------------------------------------

export function ArrangeSection({ ctx, id, actions }: { ctx: ElementFieldContext; id: string; actions?: ElementActions }) {
  const z = ctx.element.z;
  const blocked = ctx.disabled || !!actions?.blockedReason;
  return (
    <InspectorSection id={id} title="Arrange" summary={`layer ${z ?? 0}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="w-24 shrink-0">
          <ScrubField label="Layer" value={z ?? 0} step={1} min={-100} max={100} disabled={ctx.disabled} title="Higher draws on top; negative sits behind the scene's shots" onCommit={(n) => ctx.commit({ z: Math.round(n) })} onReset={z !== undefined ? () => ctx.commit({ z: null }) : undefined} />
        </div>
        {actions ? (
          <div className="flex items-center gap-0.5" role="group" aria-label="Layer order">
            {ARRANGE_ACTIONS.map((action) => {
              const Icon = ARRANGE_ICONS[action];
              return (
                <IconAction key={action} label={`${ARRANGE_LABELS[action]} (${ARRANGE_SHORTCUTS[action]})`} disabled={blocked} onClick={() => actions.arrange(action)}>
                  <Icon />
                </IconAction>
              );
            })}
          </div>
        ) : null}
      </div>
      {actions && hasPosition(ctx.element.type) ? (
        <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Align to the frame">
          <span className="mr-1 text-[11px] text-muted-foreground">Align to frame</span>
          {ALIGN_MODES.map((mode) => {
            const Icon = ALIGN_ICONS[mode];
            return (
              <IconAction key={mode} label={`Align ${ALIGN_LABELS[mode].toLowerCase()} to the frame`} disabled={blocked} onClick={() => actions.align(mode)}>
                <Icon />
              </IconAction>
            );
          })}
        </div>
      ) : null}
    </InspectorSection>
  );
}

export function AdvancedSection({ ctx, id, onOpenSpec }: { ctx: ElementFieldContext; id: string; onOpenSpec?: () => void }) {
  const el = ctx.element;
  return (
    <InspectorSection id={id} title="Advanced" defaultOpen={false}>
      <FieldRow label="Id">
        <span className="truncate font-mono text-[11px]">{el.id ?? "—"}</span>
      </FieldRow>
      <SelectInput b={bindPatch<MotionRole>(ctx, el.motionRole, (v) => ({ motionRole: v }))} label="Motion role" options={options(MOTION_ROLES)} defaultLabel="Default" hint="How much attention its motion may claim" />
      <SelectInput
        b={bindPatch<MotionIntent>(ctx, el.motionIntent, (v) => ({ motionIntent: v }))}
        label="Intent"
        options={MOTION_INTENTS.map((intent) => ({ value: intent, label: `${MOTION_GRAMMAR[intent].label} — ${MOTION_GRAMMAR[intent].meaning.toLowerCase()}` }))}
        defaultLabel="None"
        hint="Why it moves: without an entrance of its own it gets the motion grammar's"
      />
      <pre className="scrollbar-thin max-h-60 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">{JSON.stringify(el, null, 2)}</pre>
      {onOpenSpec ? (
        <Button size="xs" variant="outline" onClick={onOpenSpec}>
          <Braces /> Edit in the scene spec
        </Button>
      ) : null}
    </InspectorSection>
  );
}
