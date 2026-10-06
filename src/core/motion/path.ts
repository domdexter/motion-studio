import type { MotionPath, Point } from "../spec/scene";

/**
 * Motion paths — the curve an element travels instead of sitting at a fixed x/y.
 *
 * A path is structured data on the element (`motionPath`): a start, an end and up to two control
 * points, all in % of the frame like x/y. `pathProgress` (0 → 1, usually keyframed) picks the point
 * on it, so the keyframe system still owns *when* the element moves and the path owns *where* — no
 * second animation system.
 *
 * Progress is measured along the curve's length, not its Bézier parameter, so an even progress moves
 * at an even speed. Length is measured in % space (x and y count the same), which keeps a path
 * resolving identically whatever the frame's shape — the same spec renders the same way in 16:9 and
 * 9:16. The sample table is built once per path object and cached.
 */

const SAMPLES = 64;

export const pathControlPoints = (path: MotionPath): Point[] =>
  path.type === "cubic" ? [path.from, path.c1 ?? path.from, path.c2 ?? path.to, path.to] : path.type === "quadratic" ? [path.from, path.c1 ?? midpoint(path.from, path.to), path.to] : [path.from, path.to];

export const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** The point at Bézier parameter `t` (0..1) — not the same as progress along the curve. */
function pointAtParam(path: MotionPath, t: number): Point {
  const p = pathControlPoints(path);
  if (p.length === 2) return [p[0][0] + (p[1][0] - p[0][0]) * t, p[0][1] + (p[1][1] - p[0][1]) * t];
  const u = 1 - t;
  if (p.length === 3) {
    const a = u * u;
    const b = 2 * u * t;
    const c = t * t;
    return [a * p[0][0] + b * p[1][0] + c * p[2][0], a * p[0][1] + b * p[1][1] + c * p[2][1]];
  }
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}

/** The direction at Bézier parameter `t`, as a vector. */
function derivativeAtParam(path: MotionPath, t: number): Point {
  const p = pathControlPoints(path);
  if (p.length === 2) return [p[1][0] - p[0][0], p[1][1] - p[0][1]];
  const u = 1 - t;
  if (p.length === 3) return [2 * u * (p[1][0] - p[0][0]) + 2 * t * (p[2][0] - p[1][0]), 2 * u * (p[1][1] - p[0][1]) + 2 * t * (p[2][1] - p[1][1])];
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return [a * (p[1][0] - p[0][0]) + b * (p[2][0] - p[1][0]) + c * (p[3][0] - p[2][0]), a * (p[1][1] - p[0][1]) + b * (p[2][1] - p[1][1]) + c * (p[3][1] - p[2][1])];
}

interface PathTable {
  /** Cumulative length at each sample, 0 … total. */
  lengths: Float64Array;
  total: number;
}

const tables = new WeakMap<MotionPath, PathTable>();

function tableFor(path: MotionPath): PathTable {
  const cached = tables.get(path);
  if (cached) return cached;
  const lengths = new Float64Array(SAMPLES + 1);
  let previous = pointAtParam(path, 0);
  let total = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    const point = pointAtParam(path, i / SAMPLES);
    total += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    lengths[i] = total;
    previous = point;
  }
  const table = { lengths, total };
  tables.set(path, table);
  return table;
}

/** The Bézier parameter at `progress` (0..1) of the curve's length. */
function paramAtProgress(path: MotionPath, progress: number): number {
  if (path.type === "linear") return progress;
  const { lengths, total } = tableFor(path);
  if (total <= 0) return progress;
  const target = progress * total;
  let lo = 0;
  let hi = SAMPLES;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = lengths[hi] - lengths[lo];
  const within = span > 0 ? (target - lengths[lo]) / span : 0;
  return (lo + within) / SAMPLES;
}

/** The length of the path in % units (x and y count the same). */
export const pathLength = (path: MotionPath): number => (path.type === "linear" ? Math.hypot(path.to[0] - path.from[0], path.to[1] - path.from[1]) : tableFor(path).total);

/** Where the element sits at `progress` (0..1, clamped) and which way the curve is heading there, in degrees. */
export function pathAt(path: MotionPath, progress: number): { point: Point; angle: number } {
  const p = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
  const t = paramAtProgress(path, p);
  const [dx, dy] = derivativeAtParam(path, t);
  const angle = dx === 0 && dy === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI;
  return { point: pointAtParam(path, t), angle };
}

export const pathPointAt = (path: MotionPath, progress: number): Point => pathAt(path, progress).point;

/** The path as SVG path data in its own % coordinates — scale it by the frame to draw it. */
export function pathData(path: MotionPath, scaleX = 1, scaleY = 1): string {
  const p = pathControlPoints(path).map(([x, y]) => `${(x * scaleX).toFixed(2)},${(y * scaleY).toFixed(2)}`);
  if (p.length === 2) return `M${p[0]} L${p[1]}`;
  if (p.length === 3) return `M${p[0]} Q${p[1]} ${p[2]}`;
  return `M${p[0]} C${p[1]} ${p[2]} ${p[3]}`;
}

/** A straight path between two points — what "add a motion path" starts from. */
export const straightPath = (from: Point, to: Point): MotionPath => ({ type: "linear", from, to });

/** The same path with its points moved by (dx, dy) — a copied or nudged element takes its path with it. */
export const offsetPath = (path: MotionPath, dx: number, dy: number): MotionPath => ({
  ...path,
  from: [path.from[0] + dx, path.from[1] + dy],
  to: [path.to[0] + dx, path.to[1] + dy],
  ...(path.c1 ? { c1: [path.c1[0] + dx, path.c1[1] + dy] as Point } : {}),
  ...(path.c2 ? { c2: [path.c2[0] + dx, path.c2[1] + dy] as Point } : {}),
});

/** Turning a path into another type keeps its shape as closely as the new type allows. */
export function pathAsType(path: MotionPath, type: MotionPath["type"]): MotionPath {
  if (type === path.type) return path;
  if (type === "linear") return { type, from: path.from, to: path.to, ...(path.orient ? { orient: true } : {}) };
  if (type === "quadratic") {
    const c1 = path.c1 ?? midpoint(path.from, path.to);
    return { type, from: path.from, to: path.to, c1, ...(path.orient ? { orient: true } : {}) };
  }
  // A cubic keeps a quadratic's curve exactly: its control points sit two thirds of the way to the quadratic's.
  const q = path.c1 ?? midpoint(path.from, path.to);
  const third = (a: Point, b: Point): Point => [a[0] + ((b[0] - a[0]) * 2) / 3, a[1] + ((b[1] - a[1]) * 2) / 3];
  return { type, from: path.from, to: path.to, c1: path.c2 ? (path.c1 ?? third(path.from, q)) : third(path.from, q), c2: path.c2 ?? third(path.to, q), ...(path.orient ? { orient: true } : {}) };
}
