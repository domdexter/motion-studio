import type { CustomEasing, Easing as EasingName, KeyframeEasingValue } from "../spec/scene";

/**
 * Easing curves on a 0..1 timeline — the one implementation behind entrances, exits, transitions and
 * keyframe interpolation, shared by the renderer, the editor and the CLI. The cubic curves and the
 * bezier solver follow Remotion's Easing module, so motion rendered before these curves moved to core
 * is unchanged.
 */

export const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

const cubic = (t: number) => t * t * t;
const easeInCubic = cubic;
const easeOutCubic = (t: number) => 1 - cubic(1 - t);
const easeInOutCubic = (t: number) => (t < 0.5 ? cubic(t * 2) / 2 : 1 - cubic((1 - t) * 2) / 2);

// Cubic bezier timing (x1, y1, x2, y2), solved for x by Newton–Raphson with a bisection fallback — the
// same solver Remotion uses (from React Native's Animated).
const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 0.0000001;
const SUBDIVISION_MAX_ITERATIONS = 10;
const SPLINE_TABLE_SIZE = 11;
const SAMPLE_STEP = 1 / (SPLINE_TABLE_SIZE - 1);

const coefA = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
const coefB = (a1: number, a2: number) => 3 * a2 - 6 * a1;
const coefC = (a1: number) => 3 * a1;
const calcBezier = (t: number, a1: number, a2: number) => ((coefA(a1, a2) * t + coefB(a1, a2)) * t + coefC(a1)) * t;
const slope = (t: number, a1: number, a2: number) => 3 * coefA(a1, a2) * t * t + 2 * coefB(a1, a2) * t + coefC(a1);

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const samples = new Float32Array(SPLINE_TABLE_SIZE);
  const linear = x1 === y1 && x2 === y2;
  if (!linear) for (let i = 0; i < SPLINE_TABLE_SIZE; i++) samples[i] = calcBezier(i * SAMPLE_STEP, x1, x2);

  const tForX = (x: number) => {
    let start = 0;
    let current = 1;
    const last = SPLINE_TABLE_SIZE - 1;
    for (; current !== last && samples[current] <= x; ++current) start += SAMPLE_STEP;
    --current;
    const dist = (x - samples[current]) / (samples[current + 1] - samples[current]);
    let guess = start + dist * SAMPLE_STEP;
    const initialSlope = slope(guess, x1, x2);
    if (initialSlope >= NEWTON_MIN_SLOPE) {
      for (let i = 0; i < NEWTON_ITERATIONS; i++) {
        const s = slope(guess, x1, x2);
        if (s === 0) return guess;
        guess -= (calcBezier(guess, x1, x2) - x) / s;
      }
      return guess;
    }
    if (initialSlope === 0) return guess;
    let a = start;
    let b = start + SAMPLE_STEP;
    let t = 0;
    let i = 0;
    let currentX = 0;
    do {
      t = a + (b - a) / 2;
      currentX = calcBezier(t, x1, x2) - x;
      if (currentX > 0) b = t;
      else a = t;
    } while (Math.abs(currentX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS);
    return t;
  };

  return (x: number) => {
    const clamped = Math.min(1, Math.max(0, x));
    if (linear) return clamped;
    if (clamped === 0) return 0;
    if (clamped === 1) return 1;
    return calcBezier(tForX(clamped), y1, y2);
  };
}

const expoOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const expoInOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2);
const backOut = (t: number) => {
  const s = 1.70158;
  return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
};
const circOut = (t: number) => Math.sqrt(1 - Math.pow(t - 1, 2));
/** Critically-damped-ish spring shape on a 0..1 timeline (ends exactly at 1). */
const springish = (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(9 * t) * (1 - t) - Math.exp(-6.5) * t);

export const EASING_FUNCTIONS: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeIn: easeInCubic,
  easeOut: easeOutCubic,
  easeInOut: easeInOutCubic,
  expoOut,
  expoInOut,
  backOut,
  circOut,
  spring: springish,
  snappy: cubicBezier(0.2, 0.9, 0.1, 1),
  smooth: cubicBezier(0.45, 0, 0.2, 1),
};

/**
 * A curve: one of the named presets, or a custom cubic Bézier `{ bezier: [x1, y1, x2, y2] }` (the two
 * control points, like CSS `cubic-bezier`). Both go through the solver above, so a curve drawn in the
 * editor renders exactly as it previews.
 */
export type EasingValue = EasingName | CustomEasing;

export const isCustomEasing = (value: unknown): value is CustomEasing => typeof value === "object" && value !== null && Array.isArray((value as CustomEasing).bezier);

// Custom curves are solved once and kept: a resolver runs for every frame and building the sample
// table each time would allocate. The key is the four control values.
const customCurves = new Map<string, (t: number) => number>();

function customCurve([x1, y1, x2, y2]: CustomEasing["bezier"]): (t: number) => number {
  const key = `${x1},${y1},${x2},${y2}`;
  let fn = customCurves.get(key);
  if (!fn) {
    if (customCurves.size > 500) customCurves.clear();
    fn = cubicBezier(x1, y1, x2, y2);
    customCurves.set(key, fn);
  }
  return fn;
}

/** The function a curve describes — sample it to draw one, or call it to ease a value. */
export function easingFunction(value: EasingValue | undefined, fallback: EasingName = "easeOut"): (t: number) => number {
  if (isCustomEasing(value)) return customCurve(value.bezier);
  return EASING_FUNCTIONS[value ?? fallback] ?? EASING_FUNCTIONS.easeOut;
}

/** Progress `t` (clamped to 0..1) through a named or custom curve. */
export function ease(value: EasingValue | undefined, t: number, fallback: EasingName = "easeOut"): number {
  return easingFunction(value, fallback)(clamp01(t));
}

/**
 * The control points a named curve starts from when it is opened in the curve editor. The three cubic
 * curves have exact Bézier forms and `snappy`/`smooth` are Béziers already; the rest (expo, spring,
 * circ, back) can't be drawn as one cubic Bézier, so editing them starts from the closest smooth curve
 * — the named curve itself keeps rendering exactly as before until it is edited.
 */
const NAMED_BEZIERS: Partial<Record<EasingName, CustomEasing["bezier"]>> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.32, 0, 0.67, 0],
  easeOut: [0.33, 1, 0.68, 1],
  easeInOut: [0.65, 0, 0.35, 1],
  snappy: [0.2, 0.9, 0.1, 1],
  smooth: [0.45, 0, 0.2, 1],
  backOut: [0.34, 1.56, 0.64, 1],
  circOut: [0, 0.55, 0.45, 1],
  expoOut: [0.16, 1, 0.3, 1],
  expoInOut: [0.87, 0, 0.13, 1],
  spring: [0.24, 1.32, 0.38, 1],
};

export function bezierForEasing(value: KeyframeEasingValue | undefined): CustomEasing["bezier"] {
  if (isCustomEasing(value)) return value.bezier;
  // `hold` has no curve — editing one starts from a straight line.
  const name = value === "hold" ? "linear" : value;
  return NAMED_BEZIERS[name ?? "easeOut"] ?? [0.33, 1, 0.68, 1];
}

/** How a curve is written in the inspector, the timeline and the CLI. */
export function describeEasing(value: KeyframeEasingValue | undefined, fallback: string = "linear"): string {
  if (!value) return fallback;
  return isCustomEasing(value) ? `custom(${value.bezier.map((n) => Math.round(n * 100) / 100).join(", ")})` : value;
}

/** 0 → 1 → 0 bell for emphasis effects. */
export const bell = (t: number) => Math.sin(Math.PI * clamp01(t));
