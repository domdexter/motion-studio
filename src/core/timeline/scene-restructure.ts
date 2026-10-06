import { grammarEnter } from "../creative/grammar";
import { retimeKeyframes, withNewKeyframeIds, withUniqueKeyframeIds } from "../motion/keyframes";
import { CARDS_COLLAPSE_SECONDS, allSpecElements, type Keyframe, type SceneElement, type SceneSpec, type ShotSpec, type Transition, type Trigger } from "../spec/scene";
import type { TimedWord } from "../spec/timing";
import { findPhraseMatches, findWordMatches, resolveShotWindows, resolveTrigger, sceneWordRange, type TriggerContext } from "../spec/triggers";
import { MOTION_CUT_SEC } from "./element-layout";
import { uniqueElementId } from "./element-ops";
import { DEFAULT_EXIT_SEC, isSceneMedia, splitMediaClip, type SceneMediaElement } from "./media-clip";

/**
 * Structural scene edits that keep what the viewer sees: splitting a scene at a cut, merging a scene
 * with the next one, and copying a scene to another time. Every trigger is written again for its new
 * scene so it fires at the same moment — a spoken word stays a spoken word while it is still spoken in
 * that scene, anything else becomes a time from the scene (or shot) start. Nothing is dropped silently:
 * what can't be kept exactly is reported in `notes`.
 */

const EPS = 0.002;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const TEXT_REVEALS = new Set<string>(["wordReveal", "charReveal", "typewriter", "mask"]);

export interface SceneWindow {
  start: number;
  end: number;
}

export interface RetimeContext {
  /** Where the trigger was written: its scene, and its shot for shot elements. */
  from: TriggerContext;
  /** Where it will live. */
  to: TriggerContext;
  /** Seconds added to every moment (copying a scene to another time). */
  shift?: number;
  /** Keep spoken-word triggers while the word is spoken in the new scene (false: the new time has no narration). */
  keepVoice?: boolean;
}

export type Placement = "before" | "inside" | "after";

export interface RetimedTrigger {
  /** A trigger that fires at the same moment in the new scene (undefined: the default still does). */
  trigger: Trigger | undefined;
  /** Absolute seconds it fires, after `shift`. */
  time: number;
  /** Before, inside or after the new scene (or shot). */
  placement: Placement;
}

const segmentStart = (c: TriggerContext) => c.shotStart ?? c.sceneStart;
const segmentEnd = (c: TriggerContext) => c.shotEnd ?? c.sceneEnd;

/** A trigger at absolute `time`: seconds from the start of the shot, or of the scene. */
export function triggerAtTime(time: number, to: TriggerContext): Trigger {
  return to.shotStart !== undefined ? { type: "shotTime", seconds: r3(time - to.shotStart) } : { type: "sceneTime", seconds: r3(time - to.sceneStart) };
}

function firesAt(trigger: Trigger | undefined, fallback: "sceneStart" | "sceneEnd", time: number, to: TriggerContext): boolean {
  const r = resolveTrigger(trigger, to, fallback);
  return r.ok && Math.abs(r.time - time) < EPS;
}

/** The word or phrase trigger with its occurrence counted in the new scene, or null when it isn't spoken there. */
function spokenIn(trigger: Extract<Trigger, { type: "word" | "phrase" }>, wordIndex: number, to: TriggerContext): Trigger | null {
  if (trigger.scope === "global") return trigger;
  const range = sceneWordRange(to.words, to.sceneStart, to.sceneEnd);
  const k = trigger.type === "word" ? findWordMatches(to.words, trigger.value, range).indexOf(wordIndex) : findPhraseMatches(to.words, trigger.value, range).findIndex((m) => m[0] === wordIndex);
  if (k < 0) return null;
  const { occurrence: _occurrence, ...rest } = trigger;
  return (k === 0 ? rest : { ...rest, occurrence: k + 1 }) as Trigger;
}

export function retimeTrigger(trigger: Trigger | undefined, fallback: "sceneStart" | "sceneEnd", ctx: RetimeContext): RetimedTrigger {
  const resolved = resolveTrigger(trigger, ctx.from, fallback);
  const time = resolved.time + (ctx.shift ?? 0);
  const placement: Placement = time < segmentStart(ctx.to) - EPS ? "before" : time > segmentEnd(ctx.to) + EPS ? "after" : "inside";
  // A trigger that never resolved (a word that isn't spoken) stays as it was written.
  if (!resolved.ok) return { trigger, time, placement };
  if (!trigger) return { trigger: firesAt(undefined, fallback, time, ctx.to) ? undefined : triggerAtTime(time, ctx.to), time, placement };
  const keepVoice = ctx.keepVoice !== false;
  const voiced = trigger.type === "word" || trigger.type === "phrase";
  const candidate = voiced ? (keepVoice && resolved.wordIndex !== undefined ? spokenIn(trigger, resolved.wordIndex, ctx.to) : null) : trigger;
  if (candidate && firesAt(candidate, fallback, time, ctx.to)) return { trigger: candidate, time, placement };
  if (keepVoice && resolved.wordIndex !== undefined && (voiced || trigger.type === "wordIndex")) {
    const word = ctx.to.words[resolved.wordIndex];
    const byIndex: Trigger | null = word ? { type: "wordIndex", index: resolved.wordIndex, ...(Math.abs(time - word.start) > 0.0005 ? { offset: r3(time - word.start) } : {}) } : null;
    if (byIndex && firesAt(byIndex, fallback, time, ctx.to)) return { trigger: byIndex, time, placement };
  }
  return { trigger: triggerAtTime(time, ctx.to), time, placement };
}

export interface ElementSpan {
  /** Absolute seconds it appears. */
  appear: number;
  /** When it starts leaving (its exit starts, its cards collapse, or its scene/shot ends). */
  exitStart: number;
  /** When it is gone. */
  gone: number;
}

/** When an element is on screen in its scene (or shot), with the engine's timing rules. */
export function elementSpan(element: SceneElement, segment: TriggerContext): ElementSpan {
  const start = segmentStart(segment);
  const end = segmentEnd(segment);
  const clamp = (t: number) => Math.min(end, Math.max(start, t));
  const enter = element.enter;
  const appear = clamp(enter && enter.type !== "none" ? resolveTrigger(enter.at, segment, "sceneStart").time + (enter.delay ?? 0) : start);
  const exit = element.exit && element.exit.type !== "none" && element.exit.at ? element.exit : undefined;
  let exitStart = exit ? resolveTrigger(exit.at, segment, "sceneEnd").time : end;
  let gone = exit ? exitStart + (exit.duration ?? DEFAULT_EXIT_SEC) : end;
  if (element.type === "cards" && element.collapseAt) {
    const collapse = resolveTrigger(element.collapseAt, segment, "sceneStart").time;
    exitStart = Math.min(exitStart, collapse);
    gone = Math.min(gone, collapse + CARDS_COLLAPSE_SECONDS);
  }
  return { appear, exitStart: Math.max(appear, clamp(exitStart)), gone: Math.max(appear, clamp(gone)) };
}

/**
 * An element's keyframes after an edit changed when it appears or leaves (`before` → `after`, both in
 * `segment`). Moved — both edges by the same amount — they go along, since they count from its
 * appearance. Otherwise (a trim, a new entrance cue) each keeps its moment in the scene, and keyframes
 * outside the new time on screen fold into its edges (see `retimeKeyframes`).
 */
export function keyframesAfterRetime(before: SceneElement, after: SceneElement, segment: TriggerContext): Keyframe[] | undefined {
  const keyframes = after.keyframes;
  if (!keyframes?.length) return keyframes;
  const was = elementSpan(before, segment);
  const now = elementSpan(after, segment);
  const dAppear = now.appear - was.appear;
  const dGone = now.gone - was.gone;
  if (Math.abs(dAppear) < EPS && Math.abs(dGone) < EPS) return keyframes;
  if (Math.abs(dAppear) >= EPS && Math.abs(dAppear - dGone) < EPS) return keyframes;
  return retimeKeyframes(keyframes, was.appear - now.appear, now.gone - now.appear).keyframes;
}

/** An element's scene timing, narrowed to its shot's window for an element inside a shot. */
export function segmentOfElement(spec: SceneSpec, scene: SceneWindow, shotId: string | null, words: TimedWord[]): TriggerContext {
  const base: TriggerContext = { words, sceneStart: scene.start, sceneEnd: scene.end };
  if (!shotId) return base;
  const index = spec.shots?.findIndex((s) => s.id === shotId) ?? -1;
  const window = index >= 0 ? resolveShotWindows(spec, base)[index] : undefined;
  return window ? { ...base, shotStart: window.start, shotEnd: window.end } : base;
}

export interface RetimeElementOptions {
  /** On screen when the new scene starts (the second part of a split): it shows at once, without its entrance. */
  continues?: boolean;
  /** It used to start with its scene; now it must not show before this absolute second. */
  startFrom?: number;
  /** It used to last until its scene ended; now it must be gone by this absolute second. */
  endBy?: number;
}

interface RetimeFlags {
  /** A one-off animation that had already played now plays at the start. */
  replayed?: boolean;
  /** A text reveal was cut mid-way (it shows complete). */
  textReveal?: boolean;
  /** An image's Ken Burns pan restarts. */
  pan?: boolean;
  /** Keyframed motion was cut mid-curve (the kept part runs its easing from the cut). */
  keyframes?: boolean;
}

/** An element with every trigger written for its new scene (see `retimeTrigger`). */
export function retimeElement(element: SceneElement, ctx: RetimeContext, options: RetimeElementOptions = {}, flags: RetimeFlags = {}): SceneElement {
  const next = clean(element) as Record<string, unknown>;
  const set = (key: string, value: unknown) => {
    if (value === undefined) delete next[key];
    else next[key] = value;
  };
  const at = (trigger: Trigger | undefined, fallback: "sceneStart" | "sceneEnd" = "sceneStart") => retimeTrigger(trigger, fallback, ctx);
  const start = segmentStart(ctx.to);
  const end = segmentEnd(ctx.to);

  // Entrance.
  if (options.continues) {
    set("enter", { type: "none" });
    if (element.enter && TEXT_REVEALS.has(element.enter.type)) flags.textReveal = true;
  } else if (element.enter) {
    const r = at(element.enter.at);
    const enter: Record<string, unknown> = { ...element.enter };
    if (r.placement === "before" && element.enter.delay) {
      // Its cue is before the new scene but its delay lands inside: start at that moment.
      enter.at = triggerAtTime(r.time + element.enter.delay, ctx.to);
      delete enter.delay;
    } else if (r.trigger === undefined) delete enter.at;
    else enter.at = r.trigger;
    set("enter", enter);
  }
  if (options.startFrom !== undefined && !options.continues) {
    const enter = element.enter ?? (element.motionIntent ? grammarEnter(element.motionIntent, element.type) : undefined);
    // Without a cue it would start with the new (longer) scene. A "cut" entrance keeps its look without animating.
    if (!enter || enter.type === "none") set("enter", { type: "fade", duration: MOTION_CUT_SEC, at: triggerAtTime(options.startFrom, ctx.to) });
    else if (!enter.at) set("enter", { ...enter, at: triggerAtTime(options.startFrom, ctx.to) });
  }

  // Exit.
  const exit = element.exit && element.exit.type !== "none" ? element.exit : undefined;
  if (exit?.at) {
    const r = at(exit.at, "sceneEnd");
    // Leaving after the new scene ends: the scene's end is its exit now.
    set("exit", r.placement === "after" ? undefined : { ...exit, at: r.trigger });
  } else if (options.endBy !== undefined) {
    const duration = exit ? (exit.duration ?? DEFAULT_EXIT_SEC) : MOTION_CUT_SEC;
    set("exit", { ...(exit ?? { type: "fade" }), duration, at: triggerAtTime(options.endBy - duration, ctx.to) });
  }

  // Emphasis: only the moments inside the new scene.
  if (element.emphasis?.length) {
    const kept = element.emphasis.flatMap((e) => {
      const r = at(e.at);
      return r.placement === "inside" ? [{ ...e, at: r.trigger }] : [];
    });
    set("emphasis", kept.length ? kept : undefined);
  }

  // One-off actions.
  for (const key of ["animateAt", "connectAt", "pressAt", "collapseAt"] as const) {
    const trigger = (element as Record<string, unknown>)[key] as Trigger | undefined;
    if (!trigger) continue;
    const r = at(trigger);
    if (r.placement === "inside") set(key, r.trigger);
    else if (r.placement === "after") set(key, triggerAtTime(end, ctx.to));
    else if (element.type === "counter") {
      // It already played: show where it ended.
      set("from", element.to);
      set(key, undefined);
    } else if (element.type === "progress") {
      set("from", element.value);
      set(key, undefined);
    } else if (element.type === "button") set(key, undefined);
    else {
      set(key, triggerAtTime(start, ctx.to));
      flags.replayed = true;
    }
  }
  if (options.continues) {
    // Animations that run with the entrance already played.
    if (element.type === "counter" && !element.animateAt) set("from", element.to);
    if (element.type === "progress" && !element.animateAt) set("from", element.value);
    if ((element.type === "chart" && !element.animateAt) || (element.type === "diagram" && !element.connectAt)) flags.replayed = true;
  }

  // Items that enter on their own cue.
  const items = <T extends { at?: Trigger }>(list: T[]): T[] =>
    list.map((item) => {
      if (!item.at) return item;
      const r = at(item.at);
      const { at: _at, ...rest } = item;
      // Already shown: it appears with the element.
      if (r.placement === "before") return rest as T;
      return { ...rest, at: r.placement === "after" ? triggerAtTime(end, ctx.to) : r.trigger } as T;
    });
  if (element.type === "list" || element.type === "cards") set("items", items(element.items as { at?: Trigger }[]));

  // A cursor keeps the waypoints inside, starting from the last one before and heading to the next one after.
  if (element.type === "cursor") {
    const points = element.path.map((p) => ({ p, r: at(p.at) }));
    const before = [...points].reverse().find(({ r }) => r.placement === "before");
    const after = points.find(({ r }) => r.placement === "after");
    const path = [
      ...(before ? [{ ...before.p, at: triggerAtTime(start, ctx.to) }] : []),
      ...points.filter(({ r }) => r.placement === "inside").map(({ p, r }) => ({ ...p, at: r.trigger })),
      ...(after ? [{ ...after.p, at: triggerAtTime(end, ctx.to) }] : []),
    ];
    set("path", path.slice(0, 30));
    const clicks = (element.clicks ?? []).flatMap((c) => {
      const r = at(c);
      return r.placement === "inside" ? [r.trigger] : [];
    });
    set("clicks", clicks.length ? clicks : undefined);
  }

  // Keyframes count from when the element appears: rebase them so each stays at its moment, folding the ones outside its new time on screen.
  if (element.keyframes?.length) {
    const was = elementSpan(element, ctx.from).appear + (ctx.shift ?? 0);
    const now = elementSpan(next as SceneElement, ctx.to);
    const retimed = retimeKeyframes(element.keyframes, was - now.appear, now.gone - now.appear);
    set("keyframes", retimed.keyframes.length ? retimed.keyframes : undefined);
    if (retimed.reshaped) flags.keyframes = true;
  }

  // A group's children each keep their own cues and keyframes, so they are retimed like any element.
  if (element.type === "group") set("children", element.children.map((child) => retimeElement(child, ctx, options, flags)));

  return next as SceneElement;
}

const KEN_BURNS_SCALE: [number, number] = [0.5, 4];

/** An image's Ken Burns runs over its scene (or shot); keep the zoom it has at each moment when that window changes. */
function fitKenBurns(element: SceneElement, from: SceneWindow, to: SceneWindow, flags: RetimeFlags): SceneElement {
  if (element.type !== "image" || !element.kenBurns) return element;
  if (Math.abs(from.start - to.start) < EPS && Math.abs(from.end - to.end) < EPS) return element;
  const kb = element.kenBurns;
  const progress = (t: number) => (t - from.start) / Math.max(0.001, from.end - from.start);
  const scaleAt = (t: number) => r3(Math.min(KEN_BURNS_SCALE[1], Math.max(KEN_BURNS_SCALE[0], (kb.from ?? 1) + ((kb.to ?? 1.12) - (kb.from ?? 1)) * progress(t))));
  const travel = progress(to.end) - progress(to.start);
  if ((kb.panX || kb.panY) && Math.abs(progress(to.start)) > EPS) flags.pan = true;
  const pan = (v: number | undefined) => (v === undefined ? undefined : Math.max(-50, Math.min(50, r3(v * travel))));
  return clean({ ...element, kenBurns: { ...kb, from: scaleAt(to.start), to: scaleAt(to.end), panX: pan(kb.panX), panY: pan(kb.panY) } });
}

function withFields<T extends object>(element: T, fields: Record<string, unknown>): T {
  const next = { ...element } as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

// ---------------------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------------------

export interface SceneSplit {
  first: SceneSpec;
  second: SceneSpec;
  /** What couldn't be kept exactly, for the user. */
  notes: string[];
}

/**
 * Splits a scene's design at `cutSec`. Elements that are gone (or leaving) by the cut stay in the
 * first part, elements that appear after it move to the second, and elements on screen across the
 * cut are in both: the first part ends them at the cut, the second shows them at once (media continue
 * where they were: trim, zooms, annotations and speed segments follow the picture). Shots are divided
 * the same way. The second part starts with a cut, so the video looks the same.
 */
export function splitSceneSpec(spec: SceneSpec, scene: SceneWindow, cutSec: number, options: { words: TimedWord[]; sourceDurationSec?: (assetId: string) => number | null }): SceneSplit {
  const { words } = options;
  const cut = cutSec;
  const original: TriggerContext = { words, sceneStart: scene.start, sceneEnd: scene.end };
  const firstScene: TriggerContext = { words, sceneStart: scene.start, sceneEnd: cut };
  const secondScene: TriggerContext = { words, sceneStart: cut, sceneEnd: scene.end };
  const flags: RetimeFlags = {};
  const keyframeIds = new Set(allSpecElements(spec).flatMap(({ element }) => element.keyframes?.map((k) => k.id) ?? []));
  let continued = 0;
  let loops = false;
  let camera = !!spec.camera && spec.camera.type !== "static";
  const windowOf = (c: TriggerContext): SceneWindow => ({ start: segmentStart(c), end: segmentEnd(c) });

  const mediaParts = (element: SceneMediaElement, span: ElementSpan) => {
    const atClip = r3(cut - span.appear);
    const parts = splitMediaClip(element, atClip, atClip, options.sourceDurationSec?.(element.assetId) ?? null);
    if (element.type === "video" && element.loop) {
      // A loop plays its whole trimmed part again and again: it starts its loop again at the cut.
      loops = true;
      return { first: { ...parts.first, endAt: element.endAt }, second: { ...parts.second, startFrom: element.startFrom } };
    }
    return parts;
  };

  const divide = (elements: SceneElement[], from: TriggerContext, toFirst: TriggerContext | null, toSecond: TriggerContext | null) => {
    const first: SceneElement[] = [];
    const second: SceneElement[] = [];
    for (const element of elements) {
      const span = elementSpan(element, from);
      let where: "first" | "second" | "both" = span.exitStart <= cut + EPS ? "first" : span.appear >= cut - EPS ? "second" : "both";
      if (!toFirst) where = "second";
      if (!toSecond) where = "first";
      const media = where === "both" && isSceneMedia(element) ? mediaParts(element, span) : null;
      if (where !== "second" && toFirst) {
        const el = retimeElement(element, { from, to: toFirst }, {}, flags);
        first.push(fitKenBurns(media ? withFields(el, media.first) : el, windowOf(from), windowOf(toFirst), flags));
      }
      if (where !== "first" && toSecond) {
        const retimed = retimeElement(element, { from, to: toSecond }, { continues: where === "both" }, flags);
        // What stays on screen across the cut is in both parts: the second part's keyframes get their own ids.
        const el = where === "both" && retimed.keyframes?.length ? ({ ...retimed, keyframes: withNewKeyframeIds(retimed.keyframes, keyframeIds) } as SceneElement) : retimed;
        second.push(fitKenBurns(media ? withFields(el, media.second) : el, windowOf(from), windowOf(toSecond), flags));
        if (where === "both") continued++;
      }
    }
    return { first, second };
  };

  const windows = resolveShotWindows(spec, original);
  const firstShots: ShotSpec[] = [];
  const secondShots: ShotSpec[] = [];
  (spec.shots ?? []).forEach((shot, i) => {
    const w = windows[i];
    const from: TriggerContext = { ...original, shotStart: w.start, shotEnd: w.end };
    const toFirst: TriggerContext | null = w.start < cut - EPS ? { ...firstScene, shotStart: w.start, shotEnd: Math.min(w.end, cut) } : null;
    const toSecond: TriggerContext | null = w.end > cut + EPS ? { ...secondScene, shotStart: Math.max(w.start, cut), shotEnd: w.end } : null;
    if (toFirst && toSecond && shot.camera && shot.camera.type !== "static") camera = true;
    const parts = divide(shot.elements, from, toFirst, toSecond);
    if (toFirst) firstShots.push(clean({ ...shot, at: shot.at ? retimeTrigger(shot.at, "sceneStart", { from: original, to: firstScene }).trigger : undefined, elements: parts.first }));
    if (toSecond) {
      // The shot on screen at the cut opens the second part.
      const opening = !secondShots.length && w.start <= cut + EPS;
      secondShots.push(
        clean({
          ...shot,
          at: opening || !shot.at ? undefined : retimeTrigger(shot.at, "sceneStart", { from: original, to: secondScene }).trigger,
          transitionIn: opening ? undefined : shot.transitionIn,
          elements: parts.second,
        }),
      );
    }
  });

  const sceneLevel = divide(spec.elements, original, firstScene, secondScene);
  const first = clean({ ...spec, elements: sceneLevel.first, shots: firstShots.length ? firstShots : undefined });
  const second = clean({ ...spec, elements: sceneLevel.second, shots: secondShots.length ? secondShots : undefined, transitionIn: { type: "cut" as const } });

  const notes: string[] = [];
  if (continued) notes.push(`${continued} element${continued === 1 ? " is" : "s are"} on screen across the cut and continue${continued === 1 ? "s" : ""} in the second part without playing ${continued === 1 ? "its" : "their"} entrance again.`);
  if (flags.textReveal) notes.push("Text that was still revealing at the cut shows complete in the second part.");
  if (loops) notes.push("Looping videos start their loop again at the cut.");
  if (flags.replayed) notes.push("Charts, diagrams and card collapses that had already played run again at the start of the second part.");
  if (flags.pan) notes.push("Ken Burns pans start again in the second part.");
  if (flags.keyframes) notes.push("Keyframed motion that was mid-curve at the cut runs its easing again from the cut (linear and hold keyframes continue exactly).");
  if (camera) notes.push("Camera moves now run over each part.");
  return { first, second, notes };
}

// ---------------------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------------------

export interface MergePart {
  key: string;
  spec: SceneSpec;
  start: number;
  end: number;
}

export interface SceneMerge {
  spec: SceneSpec;
  notes: string[];
  /** Shot ids of the second scene that were renamed to stay unique. */
  renamedShots: Map<string, string>;
}

/** The merged scene would exceed the scene spec's limits; nothing should change. */
export class SceneMergeLimitError extends Error {}

const MAX_SHOTS = 12;
const MAX_SCENE_LEVEL = 60;
const MAX_SHOT_LEVEL = 40;

function withUniqueElementIds(spec: SceneSpec, taken: Set<string>): SceneSpec {
  const rename = (elements: SceneElement[]) =>
    elements.map((element) => {
      if (!element.id) return element;
      const id = taken.has(element.id) ? uniqueElementId(element.id, taken) : element.id;
      taken.add(id);
      return id === element.id ? element : { ...element, id };
    });
  return { ...spec, elements: rename(spec.elements), ...(spec.shots ? { shots: spec.shots.map((s) => ({ ...s, elements: rename(s.elements) })) } : {}) };
}

const liveTransition = (t: Transition | undefined) => (t && t.type !== "none" && t.type !== "cut" ? t : undefined);

/**
 * Merges scene `b` into the scene `a` before it, keeping both designs. Each scene becomes shots of the
 * merged scene over its own time: a scene without shots becomes one shot (with its background, camera
 * and — for the second — its transition in); a scene with shots keeps them, and its scene-level
 * elements stay scene-level but end (or start) where that scene did. Triggers keep firing at the same
 * moments; clashing ids are renamed. Throws `SceneMergeLimitError` when the result can't fit a scene.
 */
export function mergeSceneSpecs(a: MergePart, b: MergePart, options: { words: TimedWord[]; transition?: Transition }): SceneMerge {
  const { words } = options;
  const merged: TriggerContext = { words, sceneStart: a.start, sceneEnd: b.end };
  const shots: ShotSpec[] = [];
  const elements: SceneElement[] = [];
  const notes: string[] = [];
  const shotIds = new Set<string>();
  const renamedShots = new Map<string, string>();
  const takeShotId = (id: string) => {
    let out = id;
    for (let n = 2; shotIds.has(out); n++) out = `${id.slice(0, 36)}_${n}`;
    shotIds.add(out);
    return out;
  };
  const elementIds = new Set(allSpecElements(a.spec).flatMap(({ element }) => (element.id ? [element.id] : [])));

  const add = (part: MergePart, second: boolean) => {
    const own: TriggerContext = { words, sceneStart: part.start, sceneEnd: part.end };
    const spec = second ? withUniqueElementIds(part.spec, elementIds) : part.spec;
    const startAt = second ? triggerAtTime(part.start, merged) : undefined;
    const transitionIn = second ? liveTransition(part.spec.transitionIn ?? options.transition) : undefined;
    const look = { background: spec.background, camera: spec.camera };
    if (!spec.shots?.length) {
      const to: TriggerContext = { ...merged, shotStart: part.start, shotEnd: part.end };
      const id = takeShotId(part.key);
      shots.push(clean({ id, at: startAt, ...look, transitionIn, elements: spec.elements.map((el) => retimeElement(el, { from: own, to })), notes: `${part.key} before the merge` }));
      notes.push(`${part.key}'s design is kept as shot “${id}” (${part.start.toFixed(2)}–${part.end.toFixed(2)}s).`);
      return;
    }
    const windows = resolveShotWindows(spec, own);
    for (const el of spec.elements) elements.push(retimeElement(el, { from: own, to: merged }, second ? { startFrom: part.start } : { endBy: part.end }));
    if (spec.elements.length) notes.push(`${part.key}'s scene-level elements stay on screen only during ${part.start.toFixed(2)}–${part.end.toFixed(2)}s.`);
    if (spec.camera && spec.camera.type !== "static" && spec.elements.length) notes.push(`${part.key}'s camera move now applies to its shots only.`);
    const gap = windows[0].start > part.start + EPS;
    if (gap) shots.push(clean({ id: takeShotId(part.key), at: startAt, ...look, transitionIn, elements: [] }));
    spec.shots.forEach((shot, i) => {
      const w = windows[i];
      const id = takeShotId(shot.id);
      if (id !== shot.id) renamedShots.set(shot.id, id);
      const opening = i === 0 && !gap;
      // A scene's first shot used to enter with the scene's transition; now it enters over the previous shot.
      const shotTransitionIn = i === 0 ? (opening ? transitionIn : undefined) : shot.transitionIn;
      if (shot.camera && spec.camera && spec.camera.type !== "static") notes.push(`Shot “${id}” keeps its own camera; ${part.key}'s scene camera no longer adds to it.`);
      const from: TriggerContext = { ...own, shotStart: w.start, shotEnd: w.end };
      const to: TriggerContext = { ...merged, shotStart: w.start, shotEnd: w.end };
      shots.push(
        clean({
          ...shot,
          id,
          at: opening ? startAt : shot.at ? retimeTrigger(shot.at, "sceneStart", { from: own, to: merged }).trigger : undefined,
          transitionIn: shotTransitionIn,
          background: shot.background ?? spec.background,
          camera: shot.camera ?? spec.camera,
          elements: shot.elements.map((el) => retimeElement(el, { from, to })),
        }),
      );
    });
    notes.push(`${part.key}'s ${spec.shots.length} shot${spec.shots.length === 1 ? " is" : "s are"} kept${renamedShots.size && second ? ` (renamed: ${[...renamedShots].map(([o, n]) => `${o} → ${n}`).join(", ")})` : ""}.`);
  };

  add(a, false);
  add(b, true);

  if (shots.length > MAX_SHOTS) throw new SceneMergeLimitError(`Merged, ${a.key} and ${b.key} would need ${shots.length} shots, and a scene holds at most ${MAX_SHOTS}.`);
  if (elements.length > MAX_SCENE_LEVEL) throw new SceneMergeLimitError(`Merged, ${a.key} and ${b.key} would have ${elements.length} scene-level elements, and a scene holds at most ${MAX_SCENE_LEVEL}.`);
  const crowded = shots.find((s) => s.elements.length > MAX_SHOT_LEVEL);
  if (crowded) throw new SceneMergeLimitError(`Shot “${crowded.id}” would hold ${crowded.elements.length} elements, and a shot holds at most ${MAX_SHOT_LEVEL}.`);
  const density = [a.spec.motion?.density, b.spec.motion?.density];
  if (density[0] && density[1] && density[0] !== density[1]) notes.push(`Motion density follows ${a.key} (${density[0]}); ${b.key} used ${density[1]}.`);

  const specNotes = [a.spec.notes, b.spec.notes].filter(Boolean).join("\n\n").slice(0, 4000);
  // Keyframes keep their times (they count from each element's appearance, which doesn't move); their ids stay unique in the merged scene.
  const keyframeIds = new Set<string>();
  const uniqueKeyframes = (list: SceneElement[]) => list.map((el) => (el.keyframes?.length ? ({ ...el, keyframes: withUniqueKeyframeIds(el.keyframes, keyframeIds) } as SceneElement) : el));
  const spec = clean({ version: 1 as const, transitionIn: a.spec.transitionIn, motion: a.spec.motion ?? b.spec.motion, elements: uniqueKeyframes(elements), shots: shots.map((s) => ({ ...s, elements: uniqueKeyframes(s.elements) })), notes: specNotes || undefined });
  return { spec, notes, renamedShots };
}

// ---------------------------------------------------------------------------------------
// Copy to another time
// ---------------------------------------------------------------------------------------

/**
 * A scene's design for a copy that plays at another time (with no narration there): triggers become
 * times from the scene or shot start, so every animation keeps its place in the scene.
 */
export function copySceneSpec(spec: SceneSpec, from: SceneWindow, to: SceneWindow, words: TimedWord[]): { spec: SceneSpec; notes: string[] } {
  const shift = to.start - from.start;
  const own: TriggerContext = { words, sceneStart: from.start, sceneEnd: from.end };
  const target: TriggerContext = { words: [], sceneStart: to.start, sceneEnd: to.end };
  const windows = resolveShotWindows(spec, own);
  const ctx = (source: TriggerContext, destination: TriggerContext): RetimeContext => ({ from: source, to: destination, shift, keepVoice: false });
  const copy = clean({
    ...spec,
    elements: spec.elements.map((el) => retimeElement(el, ctx(own, target))),
    shots: spec.shots?.map((shot, i) => ({
      ...shot,
      at: shot.at ? retimeTrigger(shot.at, "sceneStart", ctx(own, target)).trigger : undefined,
      elements: shot.elements.map((el) => retimeElement(el, ctx({ ...own, shotStart: windows[i].start, shotEnd: windows[i].end }, { ...target, shotStart: windows[i].start + shift, shotEnd: windows[i].end + shift }))),
    })),
  });
  // The copy's keyframes are its own: same times and values, new ids.
  const keyframeIds = new Set<string>();
  const renew = (list: SceneElement[]) => list.map((el) => (el.keyframes?.length ? ({ ...el, keyframes: withNewKeyframeIds(el.keyframes, keyframeIds) } as SceneElement) : el));
  const fresh: SceneSpec = { ...copy, elements: renew(copy.elements), ...(copy.shots ? { shots: copy.shots.map((s) => ({ ...s, elements: renew(s.elements) })) } : {}) };
  const voiced = allSpecElements(spec).some(
    ({ element: el }) => (el.type === "kinetic" && (el.source === "voice" || !el.text)) || el.type === "captions" || (el.type === "text" && (el.syncToVoice || el.highlight?.at === "spoken")),
  );
  return { spec: fresh, notes: voiced ? ["Voice-driven text (kinetic text, captions, word-synced reveals) has no narration at the copy's time."] : [] };
}
