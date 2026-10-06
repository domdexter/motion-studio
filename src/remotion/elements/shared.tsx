import { useId, type CSSProperties, type ReactNode } from "react";
import type { EnterAnimation } from "../../core/spec/scene";
import { alpha, resolveColor } from "../engine/color";
import { useScene, type SceneContextValue } from "../engine/context";
import { clamp01, ease } from "../engine/easing";

export interface ItemMotion {
  style: CSSProperties;
  /** Eased progress (may overshoot for backOut/spring). */
  progress: number;
  raw: number;
  /** Scene-relative frame where this item starts entering. */
  start: number;
}

/** Staggered per-item enter animation (cards, list items, chart bars, diagram nodes). */
export function itemMotion(
  enter: EnterAnimation | undefined,
  index: number,
  frame: number,
  ctx: SceneContextValue,
  options: { baseFrame?: number; staggerFrames?: number; fallback?: EnterAnimation["type"] } = {},
): ItemMotion {
  const type = enter?.type ?? options.fallback ?? "none";
  const base = options.baseFrame ?? ctx.frameAt(enter?.at, "sceneStart", enter?.delay ?? 0);
  if (type === "none") return { style: {}, progress: 1, raw: 1, start: base };
  const { design, u } = ctx;
  const stagger = options.staggerFrames ?? ctx.frames(enter?.stagger ?? design.motion.stagger);
  const start = base + index * stagger;
  const duration = Math.max(1, ctx.frames(enter?.duration ?? design.motion.defaultDuration * ctx.motionScale.duration));
  const raw = clamp01((frame - start) / duration);
  const p = ease(enter?.easing ?? (type === "pop" ? "backOut" : undefined), raw, design.motion.easing);
  const k = ctx.intensity;
  const dist = (d: number) => u(enter?.distance ?? d) * k;
  const fadeIn = Math.min(1, raw * 2.2);
  let style: CSSProperties;
  switch (type) {
    case "fade":
      style = { opacity: p };
      break;
    case "slideUp":
      style = { opacity: fadeIn, transform: `translateY(${(1 - p) * dist(120)}px)` };
      break;
    case "slideDown":
      style = { opacity: fadeIn, transform: `translateY(${-(1 - p) * dist(120)}px)` };
      break;
    case "slideLeft":
      style = { opacity: fadeIn, transform: `translateX(${(1 - p) * dist(160)}px)` };
      break;
    case "slideRight":
      style = { opacity: fadeIn, transform: `translateX(${-(1 - p) * dist(160)}px)` };
      break;
    case "scale":
      style = { opacity: clamp01(p), transform: `scale(${0.86 + 0.14 * p})` };
      break;
    case "pop":
      style = { opacity: clamp01(raw * 2.5), transform: `scale(${0.55 + 0.45 * p})` };
      break;
    case "blur":
      style = { opacity: clamp01(p), filter: p < 0.99 ? `blur(${(1 - p) * u(18)}px)` : undefined };
      break;
    case "zoom":
      style = { opacity: clamp01(p), transform: `scale(${1.25 - 0.25 * p})` };
      break;
    case "flip":
      style = { opacity: clamp01(raw * 2), transform: `perspective(1200px) rotateX(${(1 - p) * 70}deg)` };
      break;
    case "wipe":
      style = { clipPath: `inset(0 ${(1 - clamp01(p)) * 100}% 0 0)` };
      break;
    default:
      // rise and text-level reveals become a soft rise for items
      style = { opacity: clamp01(p), transform: `translateY(${(1 - p) * dist(40)}px)`, filter: p < 0.98 ? `blur(${(1 - clamp01(p)) * u(8)}px)` : undefined };
  }
  return { style, progress: p, raw, start };
}

/** Container keeps exit/emphasis/idle; its items animate individually. */
export function withoutEnter<T extends { enter?: unknown }>(element: T): T {
  return { ...element, enter: undefined };
}

export function seriesColor(ctx: SceneContextValue, index: number, override?: string): string {
  if (override) return resolveColor(override, ctx.design);
  const palette = ctx.design.palette?.length ? ctx.design.palette : ["primary", "secondary", "accent", "success"];
  return resolveColor(palette[index % palette.length], ctx.design);
}

export function formatNumber(value: number, decimals = 0, grouping = true): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouping });
}

export function decimalsOf(value: number): number {
  const s = String(value);
  return s.includes(".") ? Math.min(4, s.split(".")[1].length) : 0;
}

/** Counts the numeric part of a display string ("$48.2k", "12,847", "3.9%") up to its value. */
export function animateNumericText(text: string, progress: number): string {
  if (progress >= 1) return text;
  const m = text.match(/^([^\d\-−]*)([-−]?[\d,]*\.?\d+)(.*)$/);
  if (!m) return text;
  const [, prefix, num, suffix] = m;
  const clean = num.replace(/,/g, "").replace("−", "-");
  const value = Number(clean);
  if (!Number.isFinite(value)) return text;
  const decimals = (clean.split(".")[1] ?? "").length;
  const formatted = formatNumber(value * Math.max(0, progress), decimals, num.includes(","));
  return `${prefix}${num.startsWith("−") ? formatted.replace("-", "−") : formatted}${suffix}`;
}

/** Smooth curve through points (Catmull-Rom → cubic Bézier). */
export function smoothPath(points: [number, number][], tension = 0.18): string {
  if (points.length === 0) return "";
  const f = (n: number) => n.toFixed(2);
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += ` C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

/** SVG-safe unique id (url(#id) references break on the colons React ids may contain). */
export function useSvgId(prefix = "ms"): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** Renders children at a fixed base resolution and scales them to the target width. */
export function Scaled({ baseWidth, baseHeight, width, children }: { baseWidth: number; baseHeight: number; width: number; children: ReactNode }) {
  const s = width / baseWidth;
  return (
    <div style={{ position: "relative", width, height: baseHeight * s }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: baseWidth, height: baseHeight, transform: `scale(${s})`, transformOrigin: "0 0" }}>{children}</div>
    </div>
  );
}

export function MissingAsset({ id, radius = 0 }: { id: string; radius?: number }) {
  const { design, u, preview } = useScene();
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: radius,
        background: alpha(design.colors.surface, 0.9),
        border: preview ? `${Math.max(2, u(3))}px dashed ${alpha(design.colors.danger, 0.75)}` : undefined,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: design.colors.muted,
        fontFamily: "system-ui, sans-serif",
        fontSize: Math.max(12, u(24)),
        textAlign: "center",
        padding: u(16),
      }}
    >
      {preview ? `Missing asset ${id}` : null}
    </div>
  );
}
