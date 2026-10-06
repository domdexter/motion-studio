import type { AnimatableProperty, InterpolationId, PropertyValueType } from "../spec/animatable";
import type { KeyframeValue, Point } from "../spec/scene";
import { formatColor, isColorValue, mixOklab, parseColor } from "./color";

/**
 * Value types and interpolation strategies — what a keyframe may hold and how two of them blend.
 *
 * A property in the registry names a value type (what it is) and an interpolation strategy (how it
 * travels). Both are looked up in the tables below, so a resolver never asks "is this a color?": it
 * asks the property. Easing is separate and applies to every type — progress goes through the curve
 * first, then the strategy turns that progress into a value. Adding a type means adding one entry
 * here, one strategy, and marking the property in the registry.
 */

export interface ValueOps<V extends KeyframeValue = KeyframeValue> {
  readonly id: PropertyValueType;
  is(value: unknown): value is V;
  /** A value the way it is stored: inside the property's range, at its precision. */
  clamp(value: V, property: AnimatableProperty): V;
  /** Why this value can't be stored for the property, or null when it can. */
  issue(value: unknown, property: AnimatableProperty): string | null;
  /** A resolved value the renderer can take — eased curves overshoot, `renderRange` says how far. */
  render(value: V, property: AnimatableProperty): V;
  /** How the inspector, the timeline and the CLI write it. `exact` keeps every stored decimal. */
  format(value: V, property: AnimatableProperty, exact?: boolean): string;
  /** What to use when a property has no value anywhere (a reset with no default). */
  blank(property: AnimatableProperty): V;
}

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const within = (value: number, range: readonly [number, number] | undefined) => (range ? Math.min(range[1], Math.max(range[0], value)) : value);
const isPoint = (value: unknown): value is Point => Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number" && Number.isFinite(value[0]) && Number.isFinite(value[1]);

const numberOps: ValueOps<number> = {
  id: "number",
  is: (value): value is number => typeof value === "number" && Number.isFinite(value),
  clamp: (value, p) => round(within(value, p.range), p.precision),
  issue: (value, p) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${p.id} keyframes take a number`;
    const [lo, hi] = p.range ?? [-Infinity, Infinity];
    return value < lo || value > hi ? `${p.id} keyframes take values from ${lo} to ${hi}` : null;
  },
  render: (value, p) => within(value, p.renderRange),
  format: (value, p, exact) => `${round(value * p.display.factor, exact ? p.precision : p.display.decimals)}${p.display.suffix}`,
  blank: (p) => (typeof p.defaultValue === "number" ? p.defaultValue : 0),
};

const colorOps: ValueOps<string> = {
  id: "color",
  is: isColorValue,
  // Stored as written when it parses, normalised otherwise — a color has no range or precision.
  clamp: (value) => {
    const rgba = parseColor(value);
    return rgba ? (value.trim().startsWith("#") ? value.trim().toUpperCase() : formatColor(rgba)) : value;
  },
  issue: (value, p) => {
    if (typeof value !== "string") return `${p.id} keyframes take a color`;
    return parseColor(value) ? null : `${p.id} keyframes take a hex or rgb() color — design tokens like “${value}” can't be blended`;
  },
  render: (value) => value,
  format: (value) => value.toUpperCase(),
  blank: (p) => (typeof p.defaultValue === "string" ? p.defaultValue : "#FFFFFF"),
};

const pointOps: ValueOps<Point> = {
  id: "point",
  is: isPoint,
  clamp: (value, p) => [round(within(value[0], p.range), p.precision), round(within(value[1], p.range), p.precision)],
  issue: (value, p) => {
    if (!isPoint(value)) return `${p.id} keyframes take a point, [x, y]`;
    const [lo, hi] = p.range ?? [-Infinity, Infinity];
    return value.some((n) => n < lo || n > hi) ? `${p.id} keyframes take points from ${lo} to ${hi}` : null;
  },
  render: (value, p) => [within(value[0], p.renderRange), within(value[1], p.renderRange)],
  format: (value, p, exact) => {
    const d = exact ? p.precision : p.display.decimals;
    return `${round(value[0], d)}, ${round(value[1], d)}${p.display.suffix}`;
  },
  blank: (p) => (isPoint(p.defaultValue) ? p.defaultValue : [50, 50]),
};

/** Every value type a property may take. */
export const VALUE_TYPES: Record<PropertyValueType, ValueOps> = {
  number: numberOps as ValueOps,
  color: colorOps as ValueOps,
  point: pointOps as ValueOps,
};

export const valueOps = (property: AnimatableProperty): ValueOps => VALUE_TYPES[property.value];

/** `t` (0..1, the easing already applied) of the way from `a` to `b`. */
export type Interpolator = (a: never, b: never, t: number) => KeyframeValue;

const mixNumber = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * How values of each kind travel. A property names one; nothing branches on the value itself.
 * `oklab` blends colors perceptually (see motion/color.ts), `point` moves each component in step.
 */
export const INTERPOLATIONS: Record<InterpolationId, Interpolator> = {
  number: mixNumber as Interpolator,
  oklab: mixOklab as Interpolator,
  point: (((a: Point, b: Point, t: number): Point => [mixNumber(a[0], b[0], t), mixNumber(a[1], b[1], t)]) as unknown) as Interpolator,
};

/** The value `t` of the way between two of this property's values, by its own strategy. */
export function mixValues(property: AnimatableProperty, a: KeyframeValue, b: KeyframeValue, t: number): KeyframeValue {
  return (INTERPOLATIONS[property.interpolation] as (a: KeyframeValue, b: KeyframeValue, t: number) => KeyframeValue)(a, b, t);
}
