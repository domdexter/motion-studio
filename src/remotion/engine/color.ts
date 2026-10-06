import { mixSrgb, parseColor } from "../../core/motion/color";
import type { DesignSystem } from "../../core/spec/design";

type Token = keyof DesignSystem["colors"];

const FIXED: Record<string, string> = { white: "#FFFFFF", black: "#000000", transparent: "transparent" };

/** Resolves a design token ("primary") or literal color; falls back to a token. */
export function resolveColor(value: string | undefined, design: DesignSystem, fallback: Token | "white" | "black" | "transparent" = "text"): string {
  const v = value ?? fallback;
  if (v in design.colors) return design.colors[v as Token];
  if (v in FIXED) return FIXED[v];
  return v;
}

/** Channels of a literal color — parsed by core/motion/color.ts, the same parser keyframed colors use. */
function hexToRgb(color: string): [number, number, number] | null {
  const rgba = parseColor(color);
  return rgba ? [rgba.r, rgba.g, rgba.b] : null;
}

export function alpha(color: string, a: number): string {
  if (color === "transparent") return color;
  const rgb = hexToRgb(color);
  if (rgb) return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, a))})`;
  const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1].split(",").map((p) => p.trim());
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
}

export function mix(a: string, b: string, t: number): string {
  return mixSrgb(a, b, t) ?? `color-mix(in srgb, ${a} ${Math.round((1 - t) * 100)}%, ${b})`;
}

export function luminance(color: string): number {
  const rgb = hexToRgb(color);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const isDark = (color: string) => luminance(color) < 0.35;

/** A readable foreground for a background color. */
export function readableOn(background: string, design: DesignSystem): string {
  return isDark(background) ? (isDark(design.colors.text) ? "#FFFFFF" : design.colors.text) : isDark(design.colors.text) ? design.colors.text : "#0B0B0F";
}

export const SHADOWS = {
  none: () => "none",
  soft: (u: (n: number) => number) => `0 ${u(8)}px ${u(24)}px rgba(0,0,0,0.12)`,
  medium: (u: (n: number) => number) => `0 ${u(14)}px ${u(40)}px rgba(0,0,0,0.22)`,
  deep: (u: (n: number) => number) => `0 ${u(24)}px ${u(80)}px rgba(0,0,0,0.45), 0 ${u(2)}px ${u(6)}px rgba(0,0,0,0.25)`,
  glow: (u: (n: number) => number, color = "#22D3EE") => `0 0 ${u(40)}px ${alpha(color, 0.35)}, 0 ${u(12)}px ${u(40)}px rgba(0,0,0,0.4)`,
};
