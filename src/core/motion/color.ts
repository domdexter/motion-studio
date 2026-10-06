/**
 * Colors as values that can be animated — the one place colors are parsed and blended, shared by the
 * keyframe resolver, the renderer and the editor.
 *
 * Two blends live here because they answer different questions. `mixOklab` walks the shortest
 * perceptual path between two colors (no grey dip halfway, no hue swing), which is what a color
 * keyframe wants. `mixSrgb` is the plain channel blend the renderer has always used for emphasis and
 * design tints; it stays exactly as it was so existing videos render identically.
 */

export interface Rgba {
  /** 0..255 */
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");

/** A literal color (hex, rgb(a) or hsl(a)) as channels, or null when it isn't one (a design token, say). */
export function parseColor(value: string): Rgba | null {
  const text = value.trim();
  const hex = /^#?([0-9a-f]{3,8})$/i.exec(text);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const fn = /^(rgba?|hsla?)\(([^)]+)\)$/i.exec(text);
  if (!fn) return null;
  const parts = fn[2].split(/[,/]/).map((p) => p.trim());
  if (parts.length < 3) return null;
  const num = (p: string) => Number.parseFloat(p);
  const alphaOf = (p: string | undefined) => (p === undefined ? 1 : clamp(p.endsWith("%") ? num(p) / 100 : num(p), 0, 1));
  if (fn[1].toLowerCase().startsWith("rgb")) {
    const channel = (p: string) => clamp(p.endsWith("%") ? (num(p) / 100) * 255 : num(p), 0, 255);
    return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alphaOf(parts[3]) };
  }
  const h = ((num(parts[0]) % 360) + 360) % 360;
  const s = clamp(num(parts[1]) / 100, 0, 1);
  const l = clamp(num(parts[2]) / 100, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a: alphaOf(parts[3]) };
}

export const isColorValue = (value: unknown): value is string => typeof value === "string" && parseColor(value) !== null;

/** Channels written back the way the renderer and the schema take them. */
export function formatColor({ r, g, b, a }: Rgba): string {
  if (a >= 0.999) return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
  return `rgba(${Math.round(clamp(r, 0, 255))}, ${Math.round(clamp(g, 0, 255))}, ${Math.round(clamp(b, 0, 255))}, ${Math.round(clamp(a, 0, 1) * 1000) / 1000})`;
}

// sRGB ⇄ OKLab (Björn Ottosson). Blending here keeps a blend's lightness and chroma even.
const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return clamp(s * 255, 0, 255);
};

function toOklab({ r, g, b }: Rgba): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function fromOklab([L, A, B]: [number, number, number], a: number): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: clamp(a, 0, 1),
  };
}

/** `t` of the way from `a` to `b` through OKLab — how color keyframes travel. Unparseable colors step at the halfway point. */
export function mixOklab(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return t < 0.5 ? a : b;
  if (t <= 0) return a;
  if (t >= 1) return b;
  const la = toOklab(ca);
  const lb = toOklab(cb);
  return formatColor(fromOklab([la[0] + (lb[0] - la[0]) * t, la[1] + (lb[1] - la[1]) * t, la[2] + (lb[2] - la[2]) * t], ca.a + (cb.a - ca.a) * t));
}

/** The plain channel blend the renderer has always used (design tints, emphasis). */
export function mixSrgb(a: string, b: string, t: number): string | null {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  return `rgb(${Math.round(ca.r + (cb.r - ca.r) * t)}, ${Math.round(ca.g + (cb.g - ca.g) * t)}, ${Math.round(ca.b + (cb.b - ca.b) * t)})`;
}
