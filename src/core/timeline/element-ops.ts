import { offsetKeyframeValues, withNewKeyframeIds } from "../motion/keyframes";
import { offsetPath } from "../motion/path";
import { allSpecElements, isGroup, MAX_GROUP_CHILDREN, type GroupChild, type SceneElement, type SceneSpec } from "../spec/scene";
import type { BoxPx, ElementRef } from "./element-layout";

/**
 * Editing several elements of a scene at once: removing, duplicating, layer order, alignment and
 * distribution. Pure helpers shared by the scene editor and the scene element service, so what the
 * canvas previews is exactly what saves. Layer order uses the engine's rule: an element list draws
 * sorted by `z`, ties in list order.
 */

export const refKey = (ref: ElementRef) => `${ref.shotId ?? ""}:${ref.index}${ref.child === undefined ? "" : `:${ref.child}`}`;
export const sameRef = (a: ElementRef, b: ElementRef) => a.shotId === b.shotId && a.index === b.index && a.child === b.child;

/** The schema's limits on elements per scene and per shot. */
export const MAX_SCENE_ELEMENTS = 60;
export const MAX_SHOT_ELEMENTS = 40;

const r2 = (n: number) => Math.round(n * 100) / 100;
const clampPosition = (n: number) => Math.max(-100, Math.min(200, r2(n)));

/** The next free id in `title` → `title_2`, `video_1` → `video_2` style. */
export function uniqueElementId(id: string, taken: ReadonlySet<string>): string {
  const match = /^(.*?)_(\d+)$/.exec(id);
  const base = (match ? match[1] : id).slice(0, 56) || "element";
  let n = match ? Number(match[2]) + 1 : 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function mapLists(spec: SceneSpec, fn: (elements: SceneElement[], shotId: string | null) => SceneElement[]): SceneSpec {
  return { ...spec, elements: fn(spec.elements, null), ...(spec.shots ? { shots: spec.shots.map((s) => ({ ...s, elements: fn(s.elements, s.id) })) } : {}) };
}

export function removeElements(spec: SceneSpec, refs: readonly ElementRef[]): SceneSpec {
  const drop = new Set(refs.map(refKey));
  return mapLists(spec, (elements, shotId) =>
    elements.flatMap((element, index): SceneElement[] => {
      if (drop.has(refKey({ shotId, index }))) return [];
      // Children of a group are removed inside it; a group left empty goes with its last child.
      if (!isGroup(element)) return [element];
      const children = element.children.filter((_, child) => !drop.has(refKey({ shotId, index, child })));
      if (children.length === element.children.length) return [element];
      return children.length ? [{ ...element, children }] : [];
    }),
  );
}

/** A copy of an element moved by `offset` percent of the frame (lines and cursor paths move their points too). */
function offsetCopy(element: SceneElement, offset: { x: number; y: number }): SceneElement {
  const copy = JSON.parse(JSON.stringify(element)) as SceneElement;
  copy.x = clampPosition((element.x ?? 50) + offset.x);
  copy.y = clampPosition((element.y ?? 50) + offset.y);
  if (copy.type === "line") {
    copy.from = [r2(copy.from[0] + offset.x), r2(copy.from[1] + offset.y)];
    copy.to = [r2(copy.to[0] + offset.x), r2(copy.to[1] + offset.y)];
  }
  if (copy.type === "cursor") copy.path = copy.path.map((p) => ({ ...p, x: r2(p.x + offset.x), y: r2(p.y + offset.y) }));
  return copy;
}

/**
 * Duplicates elements in place: each copy sits right above its original (same layer, next in the
 * list), offset by `offset` percent of the frame, with a new id when the original has one. Media copies
 * reference the same asset. Returns where the copies ended up.
 */
export function duplicateElements(spec: SceneSpec, refs: readonly ElementRef[], offset: { x: number; y: number }): { spec: SceneSpec; copies: ElementRef[] } {
  const selected = new Set(refs.map(refKey));
  const taken = new Set(allSpecElements(spec).flatMap(({ element }) => (element.id ? [element.id] : [])));
  const keyframeIds = new Set(allSpecElements(spec).flatMap(({ element }) => element.keyframes?.map((k) => k.id) ?? []));
  const copies: ElementRef[] = [];
  const next = mapLists(spec, (elements, shotId) => {
    const out: SceneElement[] = [];
    elements.forEach((element, index) => {
      out.push(element);
      if (!selected.has(refKey({ shotId, index }))) return;
      const copy = offsetCopy(element, offset);
      // Its own keyframes: the same animation, offset like the copy, with new ids.
      if (copy.keyframes?.length) copy.keyframes = withNewKeyframeIds(offsetKeyframeValues(copy.keyframes, { x: offset.x, y: offset.y }), keyframeIds);
      // A motion path travels with the copy, so it runs beside the original instead of over it.
      if (copy.motionPath) copy.motionPath = offsetPath(copy.motionPath, offset.x, offset.y);
      if (copy.id) {
        copy.id = uniqueElementId(copy.id, taken);
        taken.add(copy.id);
      }
      out.push(copy);
      copies.push({ shotId, index: out.length - 1 });
    });
    return out;
  });
  return { spec: next, copies };
}

// ---------------------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------------------

export class GroupError extends Error {}

/**
 * Puts several elements of one list into a group, in their existing draw order. The group takes the
 * place and the layer of the topmost member, and its children keep the coordinates they already had —
 * grouping never moves anything. Returns where the group ended up.
 */
export function groupElements(spec: SceneSpec, refs: readonly ElementRef[], options: { id?: string; name?: string } = {}): { spec: SceneSpec; ref: ElementRef } {
  if (refs.length < 2) throw new GroupError("Select at least two elements to group.");
  if (refs.some((r) => r.child !== undefined)) throw new GroupError("Elements inside a group are already grouped.");
  const shotIds = new Set(refs.map((r) => r.shotId));
  if (shotIds.size > 1) throw new GroupError("Group elements that live in the same shot.");
  const shotId = refs[0].shotId;
  const list = shotId === null ? spec.elements : (spec.shots?.find((s) => s.id === shotId)?.elements ?? []);
  const picked = [...new Set(refs.map((r) => r.index))].sort((a, b) => a - b);
  const members = picked.map((i) => list[i]).filter(Boolean);
  if (members.length !== picked.length) throw new GroupError("One of those elements is no longer there.");
  if (members.some(isGroup)) throw new GroupError("Groups can't contain other groups — ungroup it first.");
  if (members.length > MAX_GROUP_CHILDREN) throw new GroupError(`A group holds at most ${MAX_GROUP_CHILDREN} elements.`);
  // Children draw in the order they had in the scene, so grouping doesn't change what covers what.
  const children = [...members].sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || picked[members.indexOf(a)] - picked[members.indexOf(b)]) as GroupChild[];
  const taken = new Set(allSpecElements(spec).flatMap(({ element }) => (element.id ? [element.id] : [])));
  const id = options.id && !taken.has(options.id) ? options.id : uniqueElementId(options.id ?? "group", taken);
  const top = Math.max(...picked);
  const group: SceneElement = {
    type: "group",
    id,
    ...(options.name ? { name: options.name } : {}),
    ...(list[top].z !== undefined ? { z: list[top].z } : {}),
    children,
  };
  const drop = new Set(picked);
  const next = list.flatMap((element, i) => (i === top ? [group] : drop.has(i) ? [] : [element]));
  const at = next.indexOf(group);
  return { spec: replaceList(spec, shotId, next), ref: { shotId, index: at } };
}

/**
 * Takes a group apart: its children go back into the list where the group was, in the same order. The
 * group's own offset and opacity are baked into them so nothing jumps; a transform that can't belong to
 * a single element (scale, rotation, its own animation or keyframes) is dropped, and `dropped` says so.
 */
export function ungroupElements(spec: SceneSpec, ref: ElementRef): { spec: SceneSpec; refs: ElementRef[]; dropped: string[] } {
  const list = ref.shotId === null ? spec.elements : (spec.shots?.find((s) => s.id === ref.shotId)?.elements ?? []);
  const group = list[ref.index];
  if (!group || !isGroup(group)) throw new GroupError("That element isn't a group.");
  const dropped: string[] = [];
  if (group.scale !== undefined && group.scale !== 1) dropped.push("scale");
  if (group.scaleX !== undefined && group.scaleX !== 1) dropped.push("scale X");
  if (group.scaleY !== undefined && group.scaleY !== 1) dropped.push("scale Y");
  if (group.rotation) dropped.push("rotation");
  if (group.rotateX || group.rotateY) dropped.push("3D tilt");
  if (group.keyframes?.length) dropped.push("keyframes");
  if (group.motionPath) dropped.push("motion path");
  if (group.enter && group.enter.type !== "none") dropped.push("entrance");
  if (group.exit && group.exit.type !== "none") dropped.push("exit");
  if (group.effects || group.clip || (group.blend && group.blend !== "normal")) dropped.push("effects");
  const offset = { x: (group.x ?? 50) - 50, y: (group.y ?? 50) - 50 };
  const children = group.children.map((child) => {
    const out = offset.x || offset.y ? offsetCopy(child, offset) : ({ ...child } as SceneElement);
    if (group.opacity !== undefined && group.opacity < 1) out.opacity = Math.round((out.opacity ?? 1) * group.opacity * 1000) / 1000;
    if (group.z !== undefined && out.z === undefined) out.z = group.z;
    return out;
  });
  const next = list.flatMap((element, i) => (i === ref.index ? children : [element]));
  return {
    spec: replaceList(spec, ref.shotId, next),
    refs: children.map((_, i) => ({ shotId: ref.shotId, index: ref.index + i })),
    dropped,
  };
}

function replaceList(spec: SceneSpec, shotId: string | null, elements: SceneElement[]): SceneSpec {
  if (shotId === null) return { ...spec, elements };
  return { ...spec, shots: (spec.shots ?? []).map((s) => (s.id === shotId ? { ...s, elements } : s)) };
}

// ---------------------------------------------------------------------------------------
// Layer order
// ---------------------------------------------------------------------------------------

export const ARRANGE_ACTIONS = ["front", "forward", "backward", "back"] as const;
export type ArrangeAction = (typeof ARRANGE_ACTIONS)[number];
export const ARRANGE_LABELS: Record<ArrangeAction, string> = { front: "Bring to front", forward: "Bring forward", backward: "Send backward", back: "Send to back" };

interface Layer {
  index: number;
  z: number;
}

/** The stack (bottom → top) after the action; selected layers keep their order among themselves. */
function reorder(stack: Layer[], selected: ReadonlySet<number>, action: ArrangeAction): Layer[] {
  const isSel = (l: Layer) => selected.has(l.index);
  if (action === "front") return [...stack.filter((l) => !isSel(l)), ...stack.filter(isSel)];
  if (action === "back") return [...stack.filter(isSel), ...stack.filter((l) => !isSel(l))];
  const order = [...stack];
  if (action === "forward") {
    for (let i = order.length - 2; i >= 0; i--) if (isSel(order[i]) && !isSel(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]];
  } else {
    for (let i = 1; i < order.length; i++) if (isSel(order[i]) && !isSel(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]];
  }
  return order;
}

/**
 * z values that make the list draw in `order`, changing as few layers as possible — preferably the
 * selected ones — and staying within [min, max]. Falls back to renumbering the group.
 */
function realize(order: Layer[], selected: ReadonlySet<number>, min: number, max: number): Map<number, number> {
  const pass = (upward: boolean): Map<number, number> | null => {
    const z = new Map<number, number>();
    let prev: Layer | null = null;
    for (const layer of upward ? order : [...order].reverse()) {
      let v = layer.z;
      if (prev) {
        const pz = z.get(prev.index)!;
        if (upward && !(v > pz || (v === pz && layer.index > prev.index))) v = layer.index > prev.index ? pz : pz + 1;
        if (!upward && !(v < pz || (v === pz && layer.index < prev.index))) v = layer.index < prev.index ? pz : pz - 1;
      }
      if (v < min || v > max) return null;
      z.set(layer.index, v);
      prev = layer;
    }
    return z;
  };
  const cost = (z: Map<number, number>) => order.reduce((n, l) => n + (z.get(l.index) !== l.z ? (selected.has(l.index) ? 1 : 1000) : 0), 0);
  const candidates = [pass(true), pass(false)].filter((z): z is Map<number, number> => z !== null);
  if (candidates.length) return candidates.reduce((best, z) => (cost(z) < cost(best) ? z : best));
  const sorted = order.map((l) => l.z).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const start = Math.max(min, Math.min(max - order.length + 1, Math.round(median - (order.length - 1) / 2)));
  return new Map(order.map((l, i) => [l.index, start + i]));
}

/**
 * New layers (`z`) for a layer-order action, keyed by `refKey`. Only changed elements are returned.
 * Each list (the scene, each shot) is ordered on its own; in a scene with shots, scene-level elements
 * stay on their side of the shots (z < 0 below them, z ≥ 0 above).
 */
export function arrangeLayers(spec: SceneSpec, refs: readonly ElementRef[], action: ArrangeAction): Map<string, number> {
  const selected = new Set(refs.map(refKey));
  const changes = new Map<string, number>();
  const hasShots = !!spec.shots?.length;
  const lists: { shotId: string | null; elements: SceneElement[] }[] = [{ shotId: null, elements: spec.elements }, ...(spec.shots ?? []).map((s) => ({ shotId: s.id, elements: s.elements }))];
  for (const { shotId, elements } of lists) {
    const layers = elements.map((e, index) => ({ index, z: e.z ?? 0 }));
    const groups = shotId === null && hasShots ? [{ min: -100, max: -1, layers: layers.filter((l) => l.z < 0) }, { min: 0, max: 100, layers: layers.filter((l) => l.z >= 0) }] : [{ min: -100, max: 100, layers }];
    for (const group of groups) {
      const picked = new Set(group.layers.filter((l) => selected.has(refKey({ shotId, index: l.index }))).map((l) => l.index));
      if (!picked.size) continue;
      const stack = [...group.layers].sort((a, b) => a.z - b.z || a.index - b.index);
      const z = realize(reorder(stack, picked, action), picked, group.min, group.max);
      for (const l of group.layers) if (z.get(l.index) !== l.z) changes.set(refKey({ shotId, index: l.index }), z.get(l.index)!);
    }
  }
  return changes;
}

/** Writes new layers from `arrangeLayers` (layer 0 is stored as no `z`). */
export function applyLayers(spec: SceneSpec, changes: ReadonlyMap<string, number>): SceneSpec {
  return mapLists(spec, (elements, shotId) =>
    elements.map((element, index) => {
      const z = changes.get(refKey({ shotId, index }));
      if (z === undefined) return element;
      const { z: _z, ...rest } = element;
      return (z === 0 ? rest : { ...rest, z }) as SceneElement;
    }),
  );
}

// ---------------------------------------------------------------------------------------
// Alignment and distribution (frame pixels; the editor turns the shifts into x/y)
// ---------------------------------------------------------------------------------------

export const ALIGN_MODES = ["left", "hcenter", "right", "top", "vcenter", "bottom"] as const;
export type AlignMode = (typeof ALIGN_MODES)[number];
export const ALIGN_LABELS: Record<AlignMode, string> = { left: "Left", hcenter: "Center", right: "Right", top: "Top", vcenter: "Middle", bottom: "Bottom" };

export type DistributeAxis = "horizontal" | "vertical";

export function unionBox(boxes: readonly BoxPx[]): BoxPx {
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** Shifts that line boxes up with an edge or centre of `to` (the frame, or the selection's bounds). */
export function alignShifts(boxes: readonly BoxPx[], mode: AlignMode, to: BoxPx): { dx: number; dy: number }[] {
  return boxes.map((b) => {
    switch (mode) {
      case "left":
        return { dx: to.left - b.left, dy: 0 };
      case "hcenter":
        return { dx: to.left + to.width / 2 - (b.left + b.width / 2), dy: 0 };
      case "right":
        return { dx: to.left + to.width - (b.left + b.width), dy: 0 };
      case "top":
        return { dx: 0, dy: to.top - b.top };
      case "vcenter":
        return { dx: 0, dy: to.top + to.height / 2 - (b.top + b.height / 2) };
      case "bottom":
        return { dx: 0, dy: to.top + to.height - (b.top + b.height) };
    }
  });
}

/** Shifts that leave equal gaps between boxes along an axis; the outermost two stay put. */
export function distributeShifts(boxes: readonly BoxPx[], axis: DistributeAxis): { dx: number; dy: number }[] {
  const shifts = boxes.map(() => ({ dx: 0, dy: 0 }));
  if (boxes.length < 3) return shifts;
  const start = (b: BoxPx) => (axis === "horizontal" ? b.left : b.top);
  const length = (b: BoxPx) => (axis === "horizontal" ? b.width : b.height);
  const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => start(p.b) - start(q.b) || p.i - q.i);
  const first = order[0].b;
  const last = order[order.length - 1].b;
  const span = start(last) + length(last) - start(first);
  const gap = (span - order.reduce((n, { b }) => n + length(b), 0)) / (order.length - 1);
  let cursor = start(first);
  for (const { b, i } of order) {
    const d = cursor - start(b);
    shifts[i] = axis === "horizontal" ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    cursor += length(b) + gap;
  }
  return shifts;
}
