import {
  KEYFRAME_PROPERTIES,
  animatableProperty,
  clampPropertyValue,
  keyframePropertiesFor,
  propertyDefault,
  renderPropertyValue,
  type AnimatableProperty,
  type KeyframeProperty,
} from "../spec/animatable";
import type { DesignSystem } from "../spec/design";
import { KEYFRAME_TIME_EPS, type Keyframe, type KeyframeEasingValue, type KeyframeValue, type SceneElement } from "../spec/scene";
import type { ElementPatch } from "../timeline/spec-patch";
import { ease } from "./easing";
import { pathAt } from "./path";
import { mixValues, valueOps } from "./values";

/**
 * Property keyframes — explicit values of an element's x, y, scale, rotation and opacity over time.
 *
 * Time: a keyframe's `time` is seconds after its element appears (the entrance cue plus delay, else the
 * start of its scene or shot — `elementSpan().appear`). Video time → scene time (minus the scene start)
 * → element time (minus when it appears) = keyframe time. Keyframes therefore stay with their element:
 * moving it on the timeline, a new take of the voice-over moving the word it enters on, and copying the
 * scene all keep its animation intact. An edit that only changes when it appears or leaves (a trim, a
 * new entrance cue) keeps the keyframes where they were in the scene — see `retimeKeyframes`.
 *
 * Values: before its first keyframe a property holds the first value, after the last the last value;
 * between two keyframes it follows the earlier one's easing (`hold` keeps the value until the next
 * keyframe). A keyframed property's saved value isn't shown. Entrance, exit, emphasis and idle motion
 * compose on top of the keyframed value exactly as they do on a saved value: cues decide when things
 * happen, motion presets add procedural movement, keyframes set a property's value.
 *
 * What a property is — which elements animate it, its range, precision, default and the element field
 * the renderer reads — is the registry in spec/animatable.ts. This module only reads values out of
 * keyframes and edits them; it has no list of properties of its own.
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------------------
// Element fields — where a property's value lives (the registry's `field`, "style.radius" nests)
// ---------------------------------------------------------------------------------------

/** The value at a field path, or undefined. */
export function readField(element: SceneElement, path: string): unknown {
  if (!path.includes(".")) return (element as Record<string, unknown>)[path];
  let current: unknown = element;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** The same object with one field path set — the objects along the way are copied, never mutated. */
export function writeField<T extends Record<string, unknown>>(target: T, path: string, value: unknown): T {
  const fields = target as Record<string, unknown>;
  if (!path.includes(".")) {
    fields[path] = value;
    return target;
  }
  const [head, ...rest] = path.split(".");
  const branch = { ...((fields[head] as Record<string, unknown> | undefined) ?? {}) };
  writeField(branch, rest.join("."), value);
  fields[head] = branch;
  return target;
}

/** A property's saved value on an element (the field the renderer reads), or the renderer's default when it isn't set. */
export function baseValue(element: SceneElement, property: KeyframeProperty, design?: DesignSystem): KeyframeValue {
  const definition = animatableProperty(property);
  const value = readField(element, definition.field);
  return valueOps(definition).is(value) ? (value as KeyframeValue) : propertyDefault(property, design);
}

/** The same, for a property known to hold numbers (the transform fields the editor scrubs). */
export const baseNumber = (element: SceneElement, property: KeyframeProperty, design?: DesignSystem): number => Number(baseValue(element, property, design)) || 0;

const NO_IDS: ReadonlySet<string> = new Set();

export function newKeyframeId(taken: ReadonlySet<string> = NO_IDS): string {
  for (;;) {
    const id = `kf_${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
    if (!taken.has(id)) return id;
  }
}

// ---------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------

export type KeyframeTracks = ReadonlyMap<KeyframeProperty, readonly Keyframe[]>;

const NO_TRACKS: KeyframeTracks = new Map();
const tracksCache = new WeakMap<readonly Keyframe[], KeyframeTracks>();

/** Keyframes by property, each sorted by time — worked out once per list (edits replace the list, they never mutate it). */
export function keyframeTracks(keyframes: readonly Keyframe[] | undefined): KeyframeTracks {
  if (!keyframes?.length) return NO_TRACKS;
  const cached = tracksCache.get(keyframes);
  if (cached) return cached;
  const tracks = new Map<KeyframeProperty, readonly Keyframe[]>();
  for (const property of KEYFRAME_PROPERTIES) {
    const keys = keyframes
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => k.property === property)
      .sort((a, b) => a.k.time - b.k.time || a.i - b.i)
      .map(({ k }) => k);
    if (keys.length) tracks.set(property, keys);
  }
  tracksCache.set(keyframes, tracks);
  return tracks;
}

/**
 * The value of one property's keyframes (sorted by time) at `t` seconds after the element appears:
 * held before the first and after the last, and in between the earlier keyframe's easing over the
 * property's interpolation strategy (`hold` keeps the value until the next keyframe).
 */
export function trackValueAt(keys: readonly Keyframe[], t: number): KeyframeValue {
  const n = keys.length;
  if (!n) return Number.NaN;
  if (t <= keys[0].time) return keys[0].value;
  if (t >= keys[n - 1].time) return keys[n - 1].value;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].time <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const span = b.time - a.time;
  if (span <= 0) return b.value;
  const definition = animatableProperty(a.property);
  const easing = a.easing ?? definition.defaultEasing;
  if (easing === "hold") return a.value;
  return mixValues(definition, a.value, b.value, ease(easing, (t - a.time) / span, "linear"));
}

/** True when the element has keyframes for a property its renderer applies them to. */
export function isAnimated(element: SceneElement, property: KeyframeProperty): boolean {
  return keyframeTracks(element.keyframes).has(property) && keyframePropertiesFor(element.type).includes(property);
}

/** The properties an element animates, in the inspector's order. */
export function animatedProperties(element: SceneElement): KeyframeProperty[] {
  const tracks = keyframeTracks(element.keyframes);
  return tracks.size ? keyframePropertiesFor(element.type).filter((p) => tracks.has(p)) : [];
}

/** A property's value `localSec` after the element appears: from its keyframes, else its saved value. */
export function valueAt(element: SceneElement, property: KeyframeProperty, localSec: number, design?: DesignSystem): KeyframeValue {
  if (!isAnimated(element, property)) return baseValue(element, property, design);
  return renderPropertyValue(property, trackValueAt(keyframeTracks(element.keyframes).get(property)!, localSec));
}

/** The same, for a property that holds numbers. */
export const numberAt = (element: SceneElement, property: KeyframeProperty, localSec: number, design?: DesignSystem): number => Number(valueAt(element, property, localSec, design)) || 0;

/** True when anything animates the element: keyframes, or a motion path it travels along. */
export const isAnimatedElement = (element: SceneElement): boolean => !!element.keyframes?.length || !!element.motionPath;

/**
 * The element as it shows `localSec` after it appears: every keyframed property resolved into the
 * element field the renderer reads for it (the registry's `field`), then its motion path applied. The
 * same object when nothing animates it. The renderer resolves each element once per frame this way and
 * hands the result to that element's own renderer, so any field a renderer reads can be keyframed —
 * what the field then does stays with the renderer.
 */
export function elementAtTime<T extends SceneElement>(element: T, localSec: number): T {
  const tracks = keyframeTracks(element.keyframes);
  let next: Record<string, unknown> | null = null;
  if (tracks.size) {
    for (const property of keyframePropertiesFor(element.type)) {
      const keys = tracks.get(property);
      if (!keys) continue;
      next ??= { ...element };
      writeField(next, animatableProperty(property).field, renderPropertyValue(property, trackValueAt(keys, localSec)));
    }
  }
  return applyMotionPath((next ?? element) as T);
}

/**
 * An element with a motion path sits where its `pathProgress` has reached along the curve instead of at
 * its own x/y. With `orient` the curve's direction is *added* to its rotation, so a rotation keyframe
 * still turns it further and removing the orientation leaves that rotation untouched.
 */
export function applyMotionPath<T extends SceneElement>(element: T): T {
  const path = element.motionPath;
  if (!path) return element;
  const { point, angle } = pathAt(path, typeof element.pathProgress === "number" ? element.pathProgress : 0);
  const next = { ...element } as Record<string, unknown>;
  next.x = point[0];
  next.y = point[1];
  if (path.orient) next.rotation = (typeof element.rotation === "number" ? element.rotation : 0) + angle;
  return next as T;
}

/** Seconds on an element's keyframe clock at a frame of the video (the element appears at `appearSec`). */
export const keyframeClockSec = (videoFrame: number, fps: number, appearSec: number) => videoFrame / fps - appearSec;

// ---------------------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------------------

/** Stored order: by property (x, y, scale, rotation, opacity), then time. */
export function sortKeyframes(list: readonly Keyframe[]): Keyframe[] {
  const order = (p: KeyframeProperty) => KEYFRAME_PROPERTIES.indexOf(p);
  return list
    .map((k, i) => ({ k, i }))
    .sort((a, b) => order(a.k.property) - order(b.k.property) || a.k.time - b.k.time || a.i - b.i)
    .map(({ k }) => k);
}

/** The keyframe of a property nearest to `time`, within `tolerance` seconds. */
export function keyframeAt(list: readonly Keyframe[] | undefined, property: KeyframeProperty, time: number, tolerance = KEYFRAME_TIME_EPS): Keyframe | null {
  let best: Keyframe | null = null;
  let distance = tolerance;
  for (const k of list ?? []) {
    if (k.property !== property) continue;
    const d = Math.abs(k.time - time);
    if (d <= distance) {
      best = k;
      distance = d;
    }
  }
  return best;
}

export interface KeyframeInput {
  property: KeyframeProperty;
  /** Seconds after the element appears. */
  time: number;
  value: KeyframeValue;
  easing?: KeyframeEasingValue;
}

/**
 * Sets a property's value at a moment: the keyframe already there (within `tolerance`) takes the value,
 * otherwise a keyframe is added with a new id — taking the easing of the stretch it splits.
 */
export function setKeyframe(list: readonly Keyframe[] | undefined, input: KeyframeInput, tolerance = KEYFRAME_TIME_EPS): { keyframes: Keyframe[]; id: string } {
  const current = list ?? [];
  const value = clampPropertyValue(input.property, input.value);
  const existing = keyframeAt(current, input.property, input.time, tolerance);
  if (existing) {
    const updated: Keyframe = { ...existing, value, ...(input.easing ? { easing: input.easing } : {}) };
    if (updated.easing === "linear") delete updated.easing;
    return { keyframes: sortKeyframes(current.map((k) => (k === existing ? updated : k))), id: existing.id };
  }
  const time = r3(Math.max(0, input.time));
  const before = keyframeTracks(current)
    .get(input.property)
    ?.filter((k) => k.time < time)
    .pop();
  const easing = input.easing ?? before?.easing;
  const id = newKeyframeId(new Set(current.map((k) => k.id)));
  const added: Keyframe = { id, property: input.property, time, value, ...(easing && easing !== "linear" ? { easing } : {}) };
  return { keyframes: sortKeyframes([...current, added]), id };
}

export function removeKeyframes(list: readonly Keyframe[] | undefined, ids: Iterable<string>): Keyframe[] {
  const drop = new Set(ids);
  return (list ?? []).filter((k) => !drop.has(k.id));
}

/**
 * A keyframe given a new moment, value or easing (null: back to linear). Its time stays within
 * [0, maxTime]; a keyframe of the same property already at the new moment is replaced by it, so a
 * property never has two values at once and the order stays by time.
 */
export function updateKeyframe(list: readonly Keyframe[] | undefined, id: string, change: { time?: number; value?: KeyframeValue; easing?: KeyframeEasingValue | null }, maxTime = Number.POSITIVE_INFINITY): Keyframe[] {
  const current = list ?? [];
  const target = current.find((k) => k.id === id);
  if (!target) return [...current];
  const next: Keyframe = { ...target };
  if (change.value !== undefined) next.value = clampPropertyValue(target.property, change.value);
  if (change.easing !== undefined) {
    if (change.easing === null || change.easing === "linear") delete next.easing;
    else next.easing = change.easing;
  }
  let others = current.filter((k) => k !== target);
  if (change.time !== undefined) {
    next.time = r3(Math.max(0, Math.min(maxTime, change.time)));
    others = others.filter((k) => !(k.property === target.property && Math.abs(k.time - next.time) <= KEYFRAME_TIME_EPS));
  }
  return sortKeyframes([...others, next]);
}

/** The nearest keyframe more than `tolerance` before (−1) or after (1) `time`, among `properties` (all when omitted). */
export function adjacentKeyframe(list: readonly Keyframe[] | undefined, time: number, direction: -1 | 1, properties?: readonly KeyframeProperty[], tolerance = 0.001): Keyframe | null {
  let best: Keyframe | null = null;
  for (const k of list ?? []) {
    if (properties && !properties.includes(k.property)) continue;
    if ((k.time - time) * direction <= tolerance) continue;
    if (!best || (k.time - best.time) * direction < 0) best = k;
  }
  return best;
}

// ---------------------------------------------------------------------------------------
// Timing, copies and patches
// ---------------------------------------------------------------------------------------

export interface RetimedKeyframes {
  keyframes: Keyframe[];
  /** A stretch with an easing curve was cut at an edge: the part kept runs its curve again from (or to) the cut. */
  reshaped: boolean;
}

const curved = (k: Keyframe | undefined) => !!k && !!k.easing && k.easing !== "hold";

/** A value a fold computes: numbers keep 4 decimals (not the property's own precision), so the motion around the edge stays as it was. */
function foldedValue(property: KeyframeProperty, value: KeyframeValue): KeyframeValue {
  const definition = animatableProperty(property);
  if (typeof value !== "number" || !definition.range) return clampPropertyValue(property, value);
  const [lo, hi] = definition.range;
  return Math.round(Math.min(hi, Math.max(lo, value)) * 10000) / 10000;
}

/**
 * Keyframes moved onto a new time on screen: `shiftSec` is added to every time (the old appearance
 * minus the new one keeps each keyframe at the same moment of the scene), then keyframes outside
 * [0, durationSec] fold into one keyframe at that edge with the value the property had there — so an
 * edit never leaves keyframes where the element isn't on screen, and the motion inside is unchanged
 * (exactly for linear and hold stretches; see `reshaped`).
 */
export function retimeKeyframes(list: readonly Keyframe[] | undefined, shiftSec: number, durationSec: number): RetimedKeyframes {
  const current = list ?? [];
  if (!current.length) return { keyframes: [], reshaped: false };
  const duration = Math.max(0, durationSec);
  const shift = Math.abs(shiftSec) < KEYFRAME_TIME_EPS ? 0 : shiftSec;
  if (!shift && current.every((k) => k.time <= duration + KEYFRAME_TIME_EPS)) return { keyframes: [...current], reshaped: false };
  const out: Keyframe[] = [];
  let reshaped = false;
  for (const [property, keys] of keyframeTracks(current)) {
    const moved = keys.map((k) => ({ ...k, time: k.time + shift }));
    const inside = moved.filter((k) => k.time >= -KEYFRAME_TIME_EPS && k.time <= duration + KEYFRAME_TIME_EPS).map((k) => ({ ...k, time: r3(Math.min(duration, Math.max(0, k.time))) }));
    const before = moved.filter((k) => k.time < -KEYFRAME_TIME_EPS);
    const after = moved.filter((k) => k.time > duration + KEYFRAME_TIME_EPS);
    if (before.length && !inside.some((k) => k.time <= KEYFRAME_TIME_EPS)) {
      const last = before[before.length - 1];
      if (curved(last) && moved.indexOf(last) < moved.length - 1) reshaped = true;
      inside.unshift({ ...last, time: 0, value: foldedValue(property, trackValueAt(moved, 0)) });
    }
    if (after.length && !inside.some((k) => k.time >= duration - KEYFRAME_TIME_EPS)) {
      const first = after[0];
      const previous = [...inside].reverse().find((k) => k.time < duration);
      if (curved(previous)) reshaped = true;
      inside.push({ ...first, time: r3(duration), value: foldedValue(property, trackValueAt(moved, duration)) });
    }
    out.push(...inside);
  }
  return { keyframes: sortKeyframes(out), reshaped };
}

/** Every keyframe with a new id (a copied element or scene); the ids are added to `taken`. */
export function withNewKeyframeIds(list: readonly Keyframe[], taken: Set<string>): Keyframe[] {
  return list.map((k) => {
    const id = newKeyframeId(taken);
    taken.add(id);
    return { ...k, id };
  });
}

/** Keyframes keeping the ids still free in `taken` and getting new ones for the rest (ids are added to `taken`). */
export function withUniqueKeyframeIds(list: readonly Keyframe[], taken: Set<string>): Keyframe[] {
  return list.map((k) => {
    if (!taken.has(k.id)) {
      taken.add(k.id);
      return k;
    }
    const id = newKeyframeId(taken);
    taken.add(id);
    return { ...k, id };
  });
}

/**
 * Keyframed positions moved by (dx, dy) in % of the frame — a copy placed beside its original, or an
 * element given a new anchor, takes its animated path with it. Properties that aren't positions (a
 * width, a pivot inside the element's own box) are left alone; the registry's `axis` says which is which.
 */
export function offsetKeyframeValues(list: readonly Keyframe[], offset: { x?: number; y?: number }): Keyframe[] {
  const dx = offset.x ?? 0;
  const dy = offset.y ?? 0;
  if (!dx && !dy) return [...list];
  return list.map((k) => {
    const definition = animatableProperty(k.property);
    if (!definition.axis) return k;
    if (definition.value === "point" && Array.isArray(k.value)) return { ...k, value: clampPropertyValue(k.property, [k.value[0] + dx, k.value[1] + dy]) };
    const delta = definition.axis === "x" ? dx : definition.axis === "y" ? dy : 0;
    return delta && typeof k.value === "number" ? { ...k, value: clampPropertyValue(k.property, k.value + delta) } : k;
  });
}

// ---------------------------------------------------------------------------------------
// Patches — an edit of a property goes to the part of the patch the registry names
// ---------------------------------------------------------------------------------------

type PatchFields = ElementPatch & Record<string, unknown>;

/** The key a property has inside `style` / `props` (its field path without the leading object). */
const patchKey = (definition: AnimatableProperty) => (definition.field.includes(".") ? definition.field.slice(definition.field.indexOf(".") + 1) : definition.field);

/** The patch that sets one property (null resets it to the renderer's own default). */
export function propertyPatch(property: KeyframeProperty, value: KeyframeValue | null): ElementPatch {
  const definition = animatableProperty(property);
  const key = patchKey(definition);
  // The registry says which group of the patch a property belongs to (element, props, style, effects, clip).
  if (definition.patchIn === "element") return { [key]: value } as ElementPatch;
  return { [definition.patchIn]: { [key]: value } } as ElementPatch;
}

/** What a patch sets for a property, or undefined when it doesn't touch it. */
export function patchValueOf(patch: ElementPatch, property: KeyframeProperty): KeyframeValue | null | undefined {
  const definition = animatableProperty(property);
  const key = patchKey(definition);
  const from = definition.patchIn === "element" ? (patch as PatchFields) : ((patch as PatchFields)[definition.patchIn] as Record<string, unknown> | undefined);
  return from ? (from[key] as KeyframeValue | null | undefined) : undefined;
}

/** `patch` with one property's own change added (later changes win). */
export function withPropertyPatch(patch: ElementPatch, property: KeyframeProperty, value: KeyframeValue | null): ElementPatch {
  const definition = animatableProperty(property);
  const key = patchKey(definition);
  if (definition.patchIn === "element") return { ...patch, [key]: value } as ElementPatch;
  const group = { ...(((patch as PatchFields)[definition.patchIn] as Record<string, unknown> | undefined) ?? {}), [key]: value };
  return { ...patch, [definition.patchIn]: group } as ElementPatch;
}

/** `patch` without one property's change (it became a keyframe instead). */
function withoutProperty(patch: ElementPatch, property: KeyframeProperty): ElementPatch {
  const definition = animatableProperty(property);
  const key = patchKey(definition);
  const next = { ...patch } as PatchFields;
  if (definition.patchIn === "element") {
    delete next[key];
    return next;
  }
  const group = { ...((next[definition.patchIn] as Record<string, unknown> | undefined) ?? {}) };
  delete group[key];
  if (Object.keys(group).length) next[definition.patchIn] = group;
  else delete next[definition.patchIn];
  return next;
}

/**
 * The patch that removes keyframes. A property left without any keeps the value it had `localSec` after
 * the element appears as its saved value (never below the registry's `staticMin` — a saved scale of 0
 * would hide the element), so it doesn't jump there.
 */
export function removeKeyframesPatch(element: SceneElement, ids: Iterable<string>, localSec: number): ElementPatch {
  const keyframes = removeKeyframes(element.keyframes, ids);
  let patch: ElementPatch = { keyframes: keyframes.length ? keyframes : null };
  for (const property of animatedProperties(element)) {
    if (keyframes.some((k) => k.property === property)) continue;
    const definition = animatableProperty(property);
    const value = clampPropertyValue(property, valueAt(element, property, localSec));
    const floor = definition.editing?.staticMin;
    patch = withPropertyPatch(patch, property, floor !== undefined && typeof value === "number" ? Math.max(floor, value) : value);
  }
  return patch;
}

/**
 * An inspector or canvas edit made at the playhead, `localSec` after the element appears: each property
 * it sets that the element animates becomes a keyframe there (a reset sets the default value there)
 * instead of changing the saved value, which a keyframed property doesn't show. Properties without
 * keyframes change as before. The same patch when it sets nothing animated. `tolerance`: how close an
 * existing keyframe must be to be updated rather than joined by a new one (half a frame in the editor).
 */
export function keyframedPatch(element: SceneElement, patch: ElementPatch, localSec: number, tolerance = 0.001): ElementPatch {
  const animated = KEYFRAME_PROPERTIES.filter((p) => patchValueOf(patch, p) !== undefined && isAnimated(element, p));
  if (!animated.length) return patch;
  let next: ElementPatch = { ...patch };
  let keyframes: Keyframe[] = [...(patch.keyframes !== undefined ? (patch.keyframes ?? []) : (element.keyframes ?? []))];
  for (const property of animated) {
    const value = patchValueOf(patch, property);
    keyframes = setKeyframe(keyframes, { property, time: Math.max(0, localSec), value: value === null || value === undefined ? propertyDefault(property) : value }, tolerance).keyframes;
    next = withoutProperty(next, property);
  }
  next.keyframes = keyframes;
  return next;
}
