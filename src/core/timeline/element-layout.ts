import { isGroup, type Anchor, type SceneElement, type SceneSpec } from "../spec/scene";

/**
 * Where an element sits in the frame, and how the scene editor moves, resizes and places it. Pure
 * helpers shared by the editor canvas, the server and the CLI, so a drag saves exactly what renders.
 * Positions follow the engine (src/remotion/engine/layout.tsx): x/y are percent of the frame at the
 * element's anchor point, width is percent of the frame width and height percent of the frame height.
 */

/**
 * Where an element lives in a spec: scene-level (`shotId` null) or inside a shot, by index — and, for
 * an element inside a group, which child of that group it is. A ref without `child` is the group itself.
 */
export interface ElementRef {
  shotId: string | null;
  index: number;
  child?: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

/** A box in frame pixels (unrotated). */
export interface BoxPx {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LayoutFields {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  anchor?: Anchor;
}

/** Entrance or exit length stored for a "cut": an element with a set time still needs one to start or stop on time. */
export const MOTION_CUT_SEC = 0.04;

const r2 = (n: number) => Math.round(n * 100) / 100;
const clampPosition = (n: number) => Math.max(-100, Math.min(200, n));
const clampSize = (n: number) => Math.max(0.01, Math.min(400, n));

export function findElementAt(spec: SceneSpec, ref: ElementRef): SceneElement | null {
  const elements = ref.shotId === null ? spec.elements : spec.shots?.find((s) => s.id === ref.shotId)?.elements;
  const element = elements?.[ref.index] ?? null;
  if (ref.child === undefined || !element) return element;
  return isGroup(element) ? (element.children[ref.child] ?? null) : null;
}

function mapElements(spec: SceneSpec, ref: ElementRef, fn: (elements: SceneElement[]) => SceneElement[]): SceneSpec {
  if (ref.shotId === null) return { ...spec, elements: fn(spec.elements) };
  return { ...spec, shots: (spec.shots ?? []).map((s) => (s.id === ref.shotId ? { ...s, elements: fn(s.elements) } : s)) };
}

/** Replaces the element the ref points at — inside its group when the ref names a child. */
export function replaceElementAt(spec: SceneSpec, ref: ElementRef, element: SceneElement): SceneSpec {
  return mapElements(spec, ref, (elements) =>
    elements.map((e, i) => {
      if (i !== ref.index) return e;
      if (ref.child === undefined) return element;
      if (!isGroup(e) || element.type === "group") return e;
      return { ...e, children: e.children.map((c, j) => (j === ref.child ? element : c)) };
    }),
  );
}

/** Removes the element the ref points at. A group left with no children goes with its last child. */
export function removeElementAt(spec: SceneSpec, ref: ElementRef): SceneSpec {
  if (ref.child === undefined) return mapElements(spec, ref, (elements) => elements.filter((_, i) => i !== ref.index));
  return mapElements(spec, ref, (elements) =>
    elements.flatMap((e, i) => {
      if (i !== ref.index || !isGroup(e)) return [e];
      const children = e.children.filter((_, j) => j !== ref.child);
      return children.length ? [{ ...e, children }] : [];
    }),
  );
}

/** Where the anchor sits inside the element's box, as fractions of its width and height. */
export const ANCHOR_POINTS: Record<Anchor, [number, number]> = {
  center: [0.5, 0.5],
  "top-left": [0, 0],
  top: [0.5, 0],
  "top-right": [1, 0],
  left: [0, 0.5],
  right: [1, 0.5],
  "bottom-left": [0, 1],
  bottom: [0.5, 1],
  "bottom-right": [1, 1],
};

/** The element's layout box in frame pixels, given the size it renders at. */
export function layoutBoxPx(layout: LayoutFields, size: { width: number; height: number }, frame: FrameSize): BoxPx {
  const [ax, ay] = ANCHOR_POINTS[layout.anchor ?? "center"];
  return {
    left: ((layout.x ?? 50) / 100) * frame.width - ax * size.width,
    top: ((layout.y ?? 50) / 100) * frame.height - ay * size.height,
    width: size.width,
    height: size.height,
  };
}

/** x/y percent of a box's anchor point. */
function anchorPercent(box: BoxPx, anchor: Anchor | undefined, frame: FrameSize): { x: number; y: number } {
  const [ax, ay] = ANCHOR_POINTS[anchor ?? "center"];
  return { x: clampPosition(r2(((box.left + ax * box.width) / frame.width) * 100)), y: clampPosition(r2(((box.top + ay * box.height) / frame.height) * 100)) };
}

/** A line a box can snap to, in frame pixels: `pos` on its axis ("x": a vertical line), drawn from `start` to `end` along the other axis. */
export interface SnapLine {
  axis: "x" | "y";
  pos: number;
  start: number;
  end: number;
}

export interface SnapTargets {
  x: SnapLine[];
  y: SnapLine[];
}

/** The frame's centre lines (and its edges), plus the edges and centres of other elements' boxes. */
export function snapTargets(frame: FrameSize, boxes: readonly BoxPx[] = [], options: { frameEdges?: boolean } = {}): SnapTargets {
  const xs = options.frameEdges === false ? [frame.width / 2] : [0, frame.width / 2, frame.width];
  const ys = options.frameEdges === false ? [frame.height / 2] : [0, frame.height / 2, frame.height];
  const x: SnapLine[] = xs.map((pos) => ({ axis: "x", pos, start: 0, end: frame.height }));
  const y: SnapLine[] = ys.map((pos) => ({ axis: "y", pos, start: 0, end: frame.width }));
  for (const b of boxes) {
    for (const pos of [b.left, b.left + b.width / 2, b.left + b.width]) x.push({ axis: "x", pos, start: b.top, end: b.top + b.height });
    for (const pos of [b.top, b.top + b.height / 2, b.top + b.height]) y.push({ axis: "y", pos, start: b.left, end: b.left + b.width });
  }
  return { x, y };
}

/** The smallest shift that puts one of `values` on a line within `threshold`, or null. */
function nearestShift(values: readonly number[], lines: readonly SnapLine[], threshold: number): number | null {
  let best: number | null = null;
  for (const v of values) {
    for (const line of lines) {
      const d = line.pos - v;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

/** The lines `values` now sit on, each stretched to also cover the moving box (`span`). */
function guidesAt(values: readonly number[], lines: readonly SnapLine[], span: [number, number]): SnapLine[] {
  const out = new Map<number, SnapLine>();
  for (const line of lines) {
    if (!values.some((v) => Math.abs(line.pos - v) < 0.5)) continue;
    const key = Math.round(line.pos * 2);
    const prev = out.get(key);
    out.set(key, { axis: line.axis, pos: line.pos, start: Math.min(line.start, span[0], prev?.start ?? Infinity), end: Math.max(line.end, span[1], prev?.end ?? -Infinity) });
  }
  return [...out.values()];
}

/** Snaps a box's edges or centre to the nearest lines within `threshold` frame pixels (per axis). */
export function snapBox(box: BoxPx, targets: SnapTargets, threshold: number): { dx: number; dy: number; lines: SnapLine[] } {
  if (!(threshold > 0)) return { dx: 0, dy: 0, lines: [] };
  const dx = nearestShift([box.left, box.left + box.width / 2, box.left + box.width], targets.x, threshold);
  const dy = nearestShift([box.top, box.top + box.height / 2, box.top + box.height], targets.y, threshold);
  const left = box.left + (dx ?? 0);
  const top = box.top + (dy ?? 0);
  return {
    dx: dx ?? 0,
    dy: dy ?? 0,
    lines: [
      ...(dx !== null ? guidesAt([left, left + box.width / 2, left + box.width], targets.x, [top, top + box.height]) : []),
      ...(dy !== null ? guidesAt([top, top + box.height / 2, top + box.height], targets.y, [left, left + box.width]) : []),
    ],
  };
}

export interface MoveResult {
  x: number;
  y: number;
  box: BoxPx;
  /** The box snapped to the frame's vertical / horizontal centre line. */
  guides: { vertical: boolean; horizontal: boolean };
  /** Every line the box snapped to (frame pixels). */
  lines: SnapLine[];
}

/**
 * Moves an element by frame pixels. Within `snapPx` (0: no snapping) its edges or centre snap to
 * `targets` — by default the frame's centre lines.
 */
export function moveLayout(layout: LayoutFields, size: { width: number; height: number }, frame: FrameSize, dxPx: number, dyPx: number, snapPx = 0, targets?: SnapTargets): MoveResult {
  const start = layoutBoxPx(layout, size, frame);
  let box: BoxPx = { left: start.left + dxPx, top: start.top + dyPx, width: size.width, height: size.height };
  let lines: SnapLine[] = [];
  if (snapPx > 0) {
    const snapped = snapBox(box, targets ?? snapTargets(frame, [], { frameEdges: false }), snapPx);
    box = { ...box, left: box.left + snapped.dx, top: box.top + snapped.dy };
    lines = snapped.lines;
  }
  const vertical = lines.some((l) => l.axis === "x" && Math.abs(l.pos - frame.width / 2) < 0.5);
  const horizontal = lines.some((l) => l.axis === "y" && Math.abs(l.pos - frame.height / 2) < 0.5);
  return { ...anchorPercent(box, layout.anchor, frame), box, guides: { vertical, horizontal }, lines };
}

// ---------------------------------------------------------------------------------------
// Rotation (degrees, clockwise, around the element's centre — as the engine rotates it)
// ---------------------------------------------------------------------------------------

/** Shift snaps rotation to this many degrees. */
export const ROTATION_SNAP_STEP = 15;
/** Without Shift, rotation clicks onto 0°, 90°, 180°… within this many degrees (Alt: off). */
export const ROTATION_MAGNET = 3;

/** Direction from `center` to `point` in degrees: 0 points up, clockwise positive. */
export function pointerAngle(center: { x: number; y: number }, point: { x: number; y: number }): number {
  return (Math.atan2(point.x - center.x, -(point.y - center.y)) * 180) / Math.PI;
}

/** The turn from angle `from` to angle `to`, in (-180, 180]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Rounds a rotation: to `step` degrees, or onto a right angle within `magnet` degrees, else to 0.1°. */
export function snapRotation(deg: number, options: { step?: number; magnet?: number } = {}): number {
  const clamp = (n: number) => Math.max(-3600, Math.min(3600, n));
  if (options.step) return clamp(Math.round(deg / options.step) * options.step);
  if (options.magnet) {
    const right = Math.round(deg / 90) * 90;
    if (Math.abs(deg - right) <= options.magnet) return clamp(right);
  }
  return clamp(Math.round(deg * 10) / 10);
}

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

export interface ResizeResult {
  x: number;
  y: number;
  /** Percent of the frame width / height. */
  width: number;
  height: number;
  box: BoxPx;
  /** Lines the dragged edges snapped to (frame pixels). */
  lines: SnapLine[];
}

export interface ResizeSnap {
  targets: SnapTargets;
  /** Frame pixels. */
  threshold: number;
  /** Which sides may snap (an element sized from its content only resizes the sides it has a size for). */
  axes?: { x: boolean; y: boolean };
}

/**
 * Resizes from a corner with the opposite corner fixed. `keepAspect` scales both sides together (media
 * keeps its picture undistorted); otherwise each side follows the pointer. With `snap`, the dragged
 * edges snap to lines (keeping proportions, the closer of the two decides).
 */
export function resizeLayout(
  layout: LayoutFields,
  size: { width: number; height: number },
  frame: FrameSize,
  corner: ResizeCorner,
  dxPx: number,
  dyPx: number,
  options: { keepAspect: boolean; minPx?: number; snap?: ResizeSnap },
): ResizeResult {
  const start = layoutBoxPx(layout, size, frame);
  const min = options.minPx ?? 16;
  const east = corner === "ne" || corner === "se";
  const south = corner === "sw" || corner === "se";
  let width = start.width + (east ? dxPx : -dxPx);
  let height = start.height + (south ? dyPx : -dyPx);
  const proportional = options.keepAspect && start.width > 0 && start.height > 0;
  if (proportional) {
    const scale = Math.max(min / Math.min(start.width, start.height), (width / start.width + height / start.height) / 2);
    width = start.width * scale;
    height = start.height * scale;
  } else {
    width = Math.max(min, width);
    height = Math.max(min, height);
  }
  const edgeX = (w: number) => (east ? start.left + w : start.left + start.width - w);
  const edgeY = (h: number) => (south ? start.top + h : start.top + start.height - h);
  let snappedX = false;
  let snappedY = false;
  const snap = options.snap;
  if (snap && snap.threshold > 0) {
    const sx = snap.axes?.x === false ? null : nearestShift([edgeX(width)], snap.targets.x, snap.threshold);
    const sy = snap.axes?.y === false ? null : nearestShift([edgeY(height)], snap.targets.y, snap.threshold);
    const nextWidth = sx === null ? width : width + (east ? sx : -sx);
    const nextHeight = sy === null ? height : height + (south ? sy : -sy);
    if (proportional) {
      const useX = sx !== null && (sy === null || Math.abs(sx) <= Math.abs(sy));
      const scale = useX ? nextWidth / start.width : sy !== null ? nextHeight / start.height : null;
      if (scale !== null && Math.min(start.width, start.height) * scale >= min) {
        width = start.width * scale;
        height = start.height * scale;
        snappedX = useX;
        snappedY = !useX;
      }
    } else {
      if (sx !== null && nextWidth >= min) {
        width = nextWidth;
        snappedX = true;
      }
      if (sy !== null && nextHeight >= min) {
        height = nextHeight;
        snappedY = true;
      }
    }
  }
  const box = { left: east ? start.left : start.left + start.width - width, top: south ? start.top : start.top + start.height - height, width, height };
  const lines = snap
    ? [...(snappedX ? guidesAt([edgeX(width)], snap.targets.x, [box.top, box.top + height]) : []), ...(snappedY ? guidesAt([edgeY(height)], snap.targets.y, [box.left, box.left + width]) : [])]
    : [];
  return { ...anchorPercent(box, layout.anchor, frame), width: clampSize(r2((width / frame.width) * 100)), height: clampSize(r2((height / frame.height) * 100)), box, lines };
}

// ---------------------------------------------------------------------------------------
// Placement presets for images and videos
// ---------------------------------------------------------------------------------------

export const SCENE_MEDIA_PLACEMENTS = ["background", "fullscreen", "framed", "pip"] as const;
export type SceneMediaPlacement = (typeof SCENE_MEDIA_PLACEMENTS)[number];

export const SCENE_MEDIA_PLACEMENT_NAMES: Record<SceneMediaPlacement, string> = {
  background: "Background",
  fullscreen: "Full frame",
  framed: "Framed",
  pip: "Picture-in-picture",
};

export interface PlacementLayout {
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
}

/**
 * Layout of a placement preset. Full-frame placements cover the frame (background sits behind the
 * graphics, full frame above them); boxed ones keep the media's aspect ratio (only one side is set).
 */
export function scenePlacementLayout(placement: SceneMediaPlacement, frame: FrameSize, mediaAspect: number | null): PlacementLayout {
  if (placement === "background" || placement === "fullscreen") return { x: 50, y: 50, width: 100, height: 100, z: placement === "background" ? -50 : 50 };
  const aspect = mediaAspect && mediaAspect > 0 ? mediaAspect : 16 / 9;
  const boxed = (maxWidth: number, maxHeight: number) => {
    const widthAtMaxHeight = ((maxHeight / 100) * frame.height * aspect) / frame.width;
    return widthAtMaxHeight * 100 <= maxWidth ? { height: maxHeight } : { width: maxWidth };
  };
  if (placement === "framed") return { x: 50, y: 50, ...boxed(66, 70), z: 5 };
  const landscape = frame.width >= frame.height;
  return { x: landscape ? 80 : 72, y: landscape ? 74 : 80, ...boxed(landscape ? 30 : 46, landscape ? 34 : 26), z: 10 };
}

/** The placement preset an element's layout matches, or null when it was placed by hand. */
export function detectScenePlacement(element: LayoutFields & { z?: number; rotation?: number }, frame: FrameSize, mediaAspect: number | null): SceneMediaPlacement | null {
  if ((element.anchor && element.anchor !== "center") || (element.rotation ?? 0) !== 0) return null;
  const near = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? a === b : Math.abs(a - b) < 0.6);
  for (const placement of SCENE_MEDIA_PLACEMENTS) {
    const layout = scenePlacementLayout(placement, frame, mediaAspect);
    if (!near(element.x ?? 50, layout.x) || !near(element.y ?? 50, layout.y) || !near(element.width, layout.width) || !near(element.height, layout.height)) continue;
    if (placement === "background" && (element.z ?? 0) >= 0) continue;
    if (placement === "fullscreen" && (element.z ?? 0) < 0) continue;
    return placement;
  }
  return null;
}
