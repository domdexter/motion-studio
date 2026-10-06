import type { CSSProperties } from "react";
import type { Clip, Effects, SceneElement } from "../../core/spec/scene";
import { resolveColor } from "./color";
import type { DesignSystem } from "../../core/spec/design";

/**
 * Compositing: how a resolved element is drawn onto what is already there — effects, clip and blend.
 * One implementation, used by the canvas preview and the Remotion render alike (both are Chrome, so
 * every value here composites identically in the editor and in the exported file).
 *
 * The stack, outermost to innermost — this is the order the DOM produces and the order documented in
 * REMOTION.md:
 *
 *   position (x/y, anchor, width/height, z)      ElementBox's outer div
 *     └ blend (mix-blend-mode)                   the element mixes with the layer below
 *       └ transform (motion: translate/rotate/scale, around the pivot)
 *         └ motion filters (entrance blur, emphasis glow)
 *           └ effects (blur → brightness → contrast → saturate → glow → drop shadow)
 *             └ clip (clip-path, in % of the element's own box)
 *               └ opacity
 *                 └ the element's own renderer
 *
 * Effects and clip sit inside the transform, so a scaled element's blur and clip scale with it — what
 * you see when you scale a group in the canvas is what renders.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Effect values that leave an element alone, so nothing is emitted for them. */
const NEUTRAL: Record<string, number> = { blur: 0, glow: 0, shadowBlur: 0, shadowX: 0, shadowY: 0, brightness: 1, contrast: 1, saturate: 1 };

export const hasEffects = (effects: Effects | undefined): boolean =>
  !!effects && Object.entries(effects).some(([key, value]) => typeof value === "number" && Math.abs(value - (NEUTRAL[key] ?? 0)) > 0.0005);

/**
 * The CSS `filter` for an element's effects, in a fixed order: colour first, then the shape effects
 * that read the coloured pixels. `u` converts design units to pixels, so effects scale with the frame.
 */
export function effectFilter(effects: Effects | undefined, u: (n: number) => number, design: DesignSystem): string | undefined {
  if (!effects) return undefined;
  const parts: string[] = [];
  if (effects.blur !== undefined && effects.blur > 0.005) parts.push(`blur(${r2(u(effects.blur))}px)`);
  if (effects.brightness !== undefined && Math.abs(effects.brightness - 1) > 0.0005) parts.push(`brightness(${r2(effects.brightness)})`);
  if (effects.contrast !== undefined && Math.abs(effects.contrast - 1) > 0.0005) parts.push(`contrast(${r2(effects.contrast)})`);
  if (effects.saturate !== undefined && Math.abs(effects.saturate - 1) > 0.0005) parts.push(`saturate(${r2(effects.saturate)})`);
  if (effects.glow !== undefined && effects.glow > 0.005) parts.push(`drop-shadow(0 0 ${r2(u(effects.glow))}px ${resolveColor(effects.glowColor, design, "primary")})`);
  const { shadowBlur = 0, shadowX = 0, shadowY = 0 } = effects;
  if (shadowBlur > 0.005 || Math.abs(shadowX) > 0.005 || Math.abs(shadowY) > 0.005) {
    parts.push(`drop-shadow(${r2(u(shadowX))}px ${r2(u(shadowY))}px ${r2(u(shadowBlur))}px ${resolveColor(effects.shadowColor, design, "black")})`);
  }
  return parts.length ? parts.join(" ") : undefined;
}

const pct = (n: number) => `${r2(n)}%`;

/**
 * The `clip-path` layers of a clip, outermost first. Percentages are of the element's own box, and a
 * `reveal` direction turns `progress` into a wipe: at 0 nothing shows, at 1 the whole shape does.
 *
 * A round clip takes two layers: the box (inset and wipe) and then the shape inside it. That keeps a
 * circle round on a box of any shape — CSS resolves a single `circle()` percentage against the box's
 * diagonal, so `closest-side` on a box the inset has already cut is the only exact way to say
 * "the largest circle that fits".
 */
export function clipLayers(clip: Clip | undefined): string[] {
  if (!clip) return [];
  const [top, right, bottom, left] = clip.inset ?? [0, 0, 0, 0];
  const progress = clip.progress ?? 1;
  const reveal = clip.reveal ?? "none";
  // The wipe closes the side the reveal comes *from*: revealing "right" means the right side opens last.
  const hidden = Math.max(0, Math.min(1, 1 - progress)) * 100;
  const wipe = {
    none: [0, 0, 0, 0],
    right: [0, hidden, 0, 0],
    left: [0, 0, 0, hidden],
    down: [0, 0, hidden, 0],
    up: [hidden, 0, 0, 0],
  }[reveal];
  const t = top + wipe[0];
  const r = right + wipe[1];
  const b = bottom + wipe[2];
  const l = left + wipe[3];
  const boxed = t !== 0 || r !== 0 || b !== 0 || l !== 0;
  if (clip.type === "rect") {
    const radius = clip.radius ? ` round ${pct(clip.radius)}` : "";
    return [`inset(${pct(t)} ${pct(r)} ${pct(b)} ${pct(l)}${radius})`];
  }
  const shape = clip.type === "circle" ? "circle(closest-side at 50% 50%)" : "ellipse(50% 50% at 50% 50%)";
  return boxed ? [`inset(${pct(t)} ${pct(r)} ${pct(b)} ${pct(l)})`, shape] : [shape];
}

/** The outermost clip layer — what a single-layer clip renders as. */
export const clipPath = (clip: Clip | undefined): string | undefined => clipLayers(clip)[0];

/** True when the clip hides the element completely (a reveal that hasn't started). */
export const clipIsClosed = (clip: Clip | undefined): boolean => !!clip && (clip.reveal ?? "none") !== "none" && (clip.progress ?? 1) <= 0.0001;

/**
 * The style of the compositing layer that sits between the element's position and its motion: the
 * blend mode, and `isolation` so a blend mixes with the scene rather than escaping the layer.
 */
export function blendStyle(element: SceneElement): CSSProperties {
  const blend = element.blend;
  if (!blend || blend === "normal") return {};
  return { mixBlendMode: blend === "colorDodge" ? "color-dodge" : blend === "softLight" ? "soft-light" : blend };
}

/**
 * The compositing layers between the element's motion and its own renderer, outermost first: the
 * effects filter, then the clip (which may itself take two layers — see `clipLayers`). Empty when the
 * element composites plainly, so nothing is wrapped that doesn't need to be.
 */
export function compositingLayers(element: SceneElement, u: (n: number) => number, design: DesignSystem): CSSProperties[] {
  const filter = effectFilter(element.effects, u, design);
  const clips = clipLayers(element.clip);
  const layers: CSSProperties[] = [];
  if (filter) layers.push({ filter, width: "100%", height: "100%" });
  for (const clipPath of clips) layers.push({ clipPath, width: "100%", height: "100%" });
  return layers;
}

export const hasCompositing = (element: SceneElement): boolean => hasEffects(element.effects) || !!element.clip || (!!element.blend && element.blend !== "normal");
