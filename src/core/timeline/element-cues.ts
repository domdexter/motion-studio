import { z } from "zod";
import { grammarEnter } from "../creative/grammar";
import { ELEMENT_TYPE_LABELS } from "../spec/element-properties";
import { CARDS_COLLAPSE_SECONDS, TriggerSchema, type ExitAnimation, type SceneElement, type Trigger } from "../spec/scene";
import type { TimedWord } from "../spec/timing";
import { CUE_ID_PATTERN, elementCues, findPhraseMatches, findWordMatches, isVoiceTrigger, resolveTrigger, sceneWordRange, type CueId, type TriggerContext } from "../spec/triggers";
import { formatClock } from "../timing/frames";
import { normalizeWord } from "../util/text";
import { MOTION_CUT_SEC } from "./element-layout";
import { elementSpan, triggerAtTime } from "./scene-restructure";
import type { ElementPatch } from "./spec-patch";

/**
 * Cues — the moments an element's motion is timed to: when it enters and leaves, its emphasis
 * moments, its type's actions (a button press, a count-up, a cards collapse, diagram connections),
 * list and cards item entrances, and cursor clicks and path points. Every cue is a trigger in the
 * scene spec (core/spec/triggers.ts lists and resolves them), so a cue on a spoken word keeps
 * following the voice-over. These pure helpers set, move and describe cues and build the element
 * patches the timeline saves; the server applies the same patches (spec-patch.ts).
 *
 * Deliberately separate concepts: scene timing (a scene's start and end, owned by the voice-over),
 * element timing (when an element is on screen), cues (moments tied to triggers), motion presets
 * (entrance, exit and idle types) and — later — property keyframes, which would animate values over
 * time on tracks of their own without replacing any of these.
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A cue that can't be set on this element (the server reports it as a validation error). */
export class CueError extends Error {}

/** `{ "enter": trigger, "emphasis:0": null, … }` — cues to set; null clears one. */
export const CuePatchSchema = z.record(z.string().regex(CUE_ID_PATTERN, "Unknown cue"), TriggerSchema.nullable());

/** An exit that only makes an element leave on time (a very short fade) rather than an animation. */
export const isCutExit = (exit: ExitAnimation) => exit.type === "fade" && (exit.duration ?? 1) <= MOTION_CUT_SEC + 0.005;

export type ActionCueId = "pressAt" | "animateAt" | "collapseAt" | "connectAt";

const ACTION_TYPES: Record<ActionCueId, readonly SceneElement["type"][]> = {
  pressAt: ["button"],
  animateAt: ["counter", "progress", "chart"],
  collapseAt: ["cards"],
  connectAt: ["diagram"],
};

/** The action cues an element type has, set or not. */
export function actionCuesFor(type: SceneElement["type"]): ActionCueId[] {
  return (Object.keys(ACTION_TYPES) as ActionCueId[]).filter((id) => ACTION_TYPES[id].includes(type));
}

/** Cues that can be removed: emphasis moments, actions, item cues and clicks (an element keeps its entrance, exit and cursor path). */
export function cueRemovable(id: CueId): boolean {
  return !(id === "enter" || id === "exit" || id.startsWith("path:"));
}

function parseCueId(id: CueId): { key: string; index: number } {
  const [key, n] = id.split(":");
  return { key, index: n === undefined ? -1 : Number(n) };
}

/** “Entrance”, “Emphasis 2”, “Press”, “Count-up”, “Item 3”, “Click 1”, “Path point 2”. */
export function cueLabel(id: CueId, type?: SceneElement["type"]): string {
  const { key, index } = parseCueId(id);
  switch (key) {
    case "enter":
      return "Entrance";
    case "exit":
      return "Exit";
    case "emphasis":
      return `Emphasis ${index + 1}`;
    case "pressAt":
      return "Press";
    case "animateAt":
      return type === "counter" ? "Count-up" : type === "progress" ? "Fill" : "Animate";
    case "collapseAt":
      return "Collapse";
    case "connectAt":
      return "Connections";
    case "item":
      return `Item ${index + 1}`;
    case "click":
      return `Click ${index + 1}`;
    default:
      return `Path point ${index + 1}`;
  }
}

/**
 * The element with one cue set to `trigger`, or cleared with null: an entrance or exit then follows
 * its scene or shot again, an emphasis moment or a click is removed, an action or item goes back to
 * its default moment. A cursor path point always needs a moment. A new click can be added at the
 * index after the last one.
 */
export function setElementCue(element: SceneElement, id: CueId, trigger: Trigger | null): SceneElement {
  const next = { ...element } as Record<string, unknown>;
  const { key, index } = parseCueId(id);
  const typeLabel = ELEMENT_TYPE_LABELS[element.type];
  switch (key) {
    case "enter": {
      const current = element.enter ?? (element.motionIntent ? grammarEnter(element.motionIntent, element.type) : undefined);
      if (trigger === null) {
        if (!current || (!current.at && !current.delay)) return element;
        const { at: _at, delay: _delay, ...rest } = current;
        next.enter = rest;
      } else {
        const { delay: _delay, ...rest } = current ?? { type: "fade" as const, duration: MOTION_CUT_SEC };
        // "none" ignores the cue, so an element cued to appear later becomes a cut.
        next.enter = { ...rest, ...(rest.type === "none" ? { type: "fade", duration: MOTION_CUT_SEC } : {}), at: trigger };
      }
      break;
    }
    case "exit": {
      const old = element.exit && element.exit.type !== "none" ? element.exit : undefined;
      if (trigger === null) {
        if (!old || !old.at) return element;
        // A cut that only made it leave early goes; an animation plays at the end of its scene or shot again.
        const { at: _at, ...rest } = old;
        if (isCutExit(old)) delete next.exit;
        else next.exit = rest;
      } else {
        next.exit = { ...(old ?? { type: "fade", duration: MOTION_CUT_SEC }), at: trigger };
      }
      break;
    }
    case "emphasis": {
      const list = element.emphasis ?? [];
      if (!list[index]) throw new CueError(`This ${typeLabel.toLowerCase()} has no emphasis moment ${index + 1}.`);
      const emphasis = trigger === null ? list.filter((_, k) => k !== index) : list.map((e, k) => (k === index ? { ...e, at: trigger } : e));
      if (emphasis.length) next.emphasis = emphasis;
      else delete next.emphasis;
      break;
    }
    case "pressAt":
    case "animateAt":
    case "collapseAt":
    case "connectAt": {
      if (!ACTION_TYPES[key].includes(element.type)) throw new CueError(`${typeLabel} elements have no ${cueLabel(key, element.type).toLowerCase()} cue.`);
      if (trigger === null) delete next[key];
      else next[key] = trigger;
      break;
    }
    case "item": {
      if (element.type !== "list" && element.type !== "cards") throw new CueError(`${typeLabel} elements have no items.`);
      const items = element.items as { at?: Trigger }[];
      if (!items[index]) throw new CueError(`There is no item ${index + 1}.`);
      next.items = items.map((item, k) => {
        if (k !== index) return item;
        const { at: _at, ...rest } = item;
        return trigger === null ? rest : { ...rest, at: trigger };
      });
      break;
    }
    case "click": {
      if (element.type !== "cursor") throw new CueError(`${typeLabel} elements have no clicks.`);
      const clicks = element.clicks ?? [];
      if (index > clicks.length || (index === clicks.length && trigger === null)) throw new CueError(`There is no click ${index + 1}.`);
      const list = trigger === null ? clicks.filter((_, k) => k !== index) : index === clicks.length ? [...clicks, trigger] : clicks.map((c, k) => (k === index ? trigger : c));
      if (list.length) next.clicks = list;
      else delete next.clicks;
      break;
    }
    case "path": {
      if (element.type !== "cursor" || !element.path[index]) throw new CueError(`There is no path point ${index + 1}.`);
      if (trigger === null) throw new CueError("A cursor path point needs a moment — remove the point from the cursor's path instead.");
      next.path = element.path.map((p, k) => (k === index ? { ...p, at: trigger } : p));
      break;
    }
    default:
      throw new CueError(`Unknown cue “${id}”.`);
  }
  return next as SceneElement;
}

/**
 * A cue on spoken words `first`…`last` of a scene: the word (or phrase) by its text and its occurrence
 * in the scene, so it stays on those words with a new take of the voice-over; by transcript index when
 * the text can't pick them out. `edge: "end"` fires as the last word ends.
 */
export function spokenTrigger(
  words: readonly TimedWord[],
  first: number,
  last: number,
  scene: Pick<TriggerContext, "sceneStart" | "sceneEnd">,
  options: { edge?: "start" | "end"; offset?: number } = {},
): Trigger {
  const lo = Math.min(first, last);
  const hi = Math.max(first, last);
  const extra = { ...(options.edge === "end" ? { edge: "end" as const } : {}), ...(options.offset ? { offset: r3(options.offset) } : {}) };
  const ctx: TriggerContext = { words: [...words], sceneStart: scene.sceneStart, sceneEnd: scene.sceneEnd };
  const range = sceneWordRange(ctx.words, scene.sceneStart, scene.sceneEnd);
  if (lo === hi) {
    const value = normalizeWord(words[lo]?.text ?? "");
    const k = value ? findWordMatches(ctx.words, value, range).indexOf(lo) : -1;
    if (k >= 0) {
      const trigger: Trigger = { type: "word", value, ...(k > 0 ? { occurrence: k + 1 } : {}), ...extra };
      if (resolveTrigger(trigger, ctx).wordIndex === lo) return trigger;
    }
    return { type: "wordIndex", index: lo, ...extra };
  }
  const tokens = words.slice(lo, hi + 1).map((w) => normalizeWord(w.text));
  if (tokens.every(Boolean)) {
    const value = tokens.join(" ");
    const k = findPhraseMatches(ctx.words, value, range).findIndex((m) => m[0] === lo);
    if (k >= 0) {
      const trigger: Trigger = { type: "phrase", value, ...(k > 0 ? { occurrence: k + 1 } : {}), ...extra };
      if (resolveTrigger(trigger, ctx).wordIndex === lo) return trigger;
    }
  }
  return { type: "wordIndex", index: options.edge === "end" ? hi : lo, ...extra };
}

/** Index of the word being spoken at `time`, else the nearest word within `toleranceSec`, else null. */
export function wordAtTime(words: readonly TimedWord[], time: number, toleranceSec = 0.3): number | null {
  let best: number | null = null;
  let bestDist = toleranceSec;
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (time >= w.start && time <= w.end) return k;
    const d = Math.min(Math.abs(time - w.start), Math.abs(time - w.end));
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  return best;
}

const signed = (n: number | undefined) => (n ? ` ${n > 0 ? "+" : "−"} ${Math.abs(n).toFixed(2)}s` : "");

/** “on the word “platform””, “1.20s into the scene”… — how a cue reads in the inspector and the CLI. */
export function describeTrigger(trigger: Trigger | undefined, edge: "start" | "end", inShot: boolean, words: readonly TimedWord[]): string {
  const segment = inShot ? "its shot" : "the scene";
  if (!trigger) return `when ${segment} ${edge === "start" ? "starts" : "ends"}`;
  const ending = "edge" in trigger && trigger.edge === "end" ? " as it ends" : "";
  switch (trigger.type) {
    case "word":
      return `on the word “${trigger.value}”${trigger.occurrence && trigger.occurrence > 1 ? ` (time ${trigger.occurrence})` : ""}${ending}${signed(trigger.offset)}`;
    case "phrase":
      return `on “${trigger.value}”${trigger.occurrence && trigger.occurrence > 1 ? ` (time ${trigger.occurrence})` : ""}${ending}${signed(trigger.offset)}`;
    case "wordIndex":
      return `on “${words[trigger.index]?.text ?? `word ${trigger.index}`}”${ending}${signed(trigger.offset)}`;
    case "sceneTime":
      return `${(trigger.seconds + (trigger.offset ?? 0)).toFixed(2)}s into the scene`;
    case "shotTime":
      return `${(trigger.seconds + (trigger.offset ?? 0)).toFixed(2)}s into its shot`;
    case "time":
      return `at ${formatClock(trigger.seconds + (trigger.offset ?? 0), 2)}`;
    case "sceneStart":
      return `when the scene starts${signed(trigger.offset)}`;
    case "sceneEnd":
      return `when the scene ends${signed(trigger.offset)}`;
    case "shotStart":
      return `when its shot starts${signed(trigger.offset)}`;
    case "shotEnd":
      return `when its shot ends${signed(trigger.offset)}`;
  }
}

/**
 * A trigger that fires `deltaSec` later in the same segment, or null when it doesn't move with the
 * element: cues on spoken words stay on their words, and a default moment follows its entrance.
 */
export function shiftedTrigger(trigger: Trigger | undefined, deltaSec: number, segment: TriggerContext, fallback: "sceneStart" | "sceneEnd" = "sceneStart"): Trigger | null {
  if (!trigger || Math.abs(deltaSec) < 0.0005 || isVoiceTrigger(trigger)) return null;
  switch (trigger.type) {
    case "sceneTime":
    case "shotTime":
      return { ...trigger, seconds: r3(trigger.seconds + deltaSec) };
    case "time":
      return { ...trigger, seconds: r3(Math.max(0, trigger.seconds + deltaSec)) };
    default:
      return triggerAtTime(resolveTrigger(trigger, segment, fallback).time + deltaSec, segment);
  }
}

// ---------------------------------------------------------------------------------------
// Element timing (timeline bars)
// ---------------------------------------------------------------------------------------

/** Shortest time an element stays on screen after a timeline trim, in seconds. */
export const MIN_ELEMENT_SEC = 0.2;

export type TimingEdge = "move" | "start" | "end";

export interface TimeSpan {
  /** Absolute seconds it appears. */
  appear: number;
  /** Absolute seconds it is gone. */
  gone: number;
}

/** How far a span can move inside `bounds`: [earliest, latest] shift in seconds. */
export function moveLimits(span: TimeSpan, bounds: { start: number; end: number }): [number, number] {
  return [Math.min(0, bounds.start - span.appear), Math.max(0, bounds.end - span.gone)];
}

/** A timeline drag applied to an element's time on screen: moving keeps its length inside its scene (or shot); an edge changes when it appears or is gone. */
export function dragElementSpan(span: TimeSpan, bounds: { start: number; end: number }, edge: TimingEdge, deltaSec: number): TimeSpan {
  if (edge === "move") {
    const [lo, hi] = moveLimits(span, bounds);
    const d = Math.max(lo, Math.min(hi, deltaSec));
    return { appear: r3(span.appear + d), gone: r3(span.gone + d) };
  }
  if (edge === "start") return { appear: r3(Math.max(bounds.start, Math.min(span.gone - MIN_ELEMENT_SEC, span.appear + deltaSec))), gone: span.gone };
  return { appear: span.appear, gone: r3(Math.min(bounds.end, Math.max(span.appear + MIN_ELEMENT_SEC, span.gone + deltaSec))) };
}

export interface TimingChange extends TimeSpan {
  /** The appear edge landed on a spoken word: the entrance is cued to it and keeps following the voice-over. */
  appearWord?: { index: number; edge: "start" | "end" } | null;
}

/**
 * The element patch for a timeline move or trim — the fields the inspector's Timing section saves, so
 * both save the same way. Only edges that moved change: an appear edge on a spoken word becomes a word
 * cue, any other edge an exact time (the end of its scene or shot clears it). A cards element that
 * collapses has its collapse moved instead. Moving the whole element takes its timed cues along
 * (emphasis, actions, items, clicks and path points); cues on spoken words stay on their words.
 */
export function elementTimingPatch(element: SceneElement, segment: TriggerContext, change: TimingChange): ElementPatch {
  const before = elementSpan(element, segment);
  const start = segment.shotStart ?? segment.sceneStart;
  const end = segment.shotEnd ?? segment.sceneEnd;
  const dAppear = change.appear - before.appear;
  const dGone = change.gone - before.gone;
  const patch: ElementPatch = {};
  const cues: Record<string, Trigger | null> = {};

  if (Math.abs(dAppear) > 0.0005) {
    if (change.appearWord) cues.enter = spokenTrigger(segment.words, change.appearWord.index, change.appearWord.index, segment, { edge: change.appearWord.edge });
    else patch.appearAt = change.appear <= start + 0.005 ? null : r3(change.appear - segment.sceneStart);
  }
  if (Math.abs(dGone) > 0.0005) {
    const collapse = element.type === "cards" && element.collapseAt ? resolveTrigger(element.collapseAt, segment, "sceneStart").time + CARDS_COLLAPSE_SECONDS : null;
    if (collapse !== null && Math.abs(Math.min(end, collapse) - before.gone) < 0.002) cues.collapseAt = triggerAtTime(change.gone - CARDS_COLLAPSE_SECONDS, segment);
    else patch.disappearAt = change.gone >= end - 0.02 ? null : r3(change.gone - segment.sceneStart);
  }
  if (Math.abs(dAppear) > 0.0005 && Math.abs(dAppear - dGone) < 0.001) {
    for (const cue of elementCues(element, segment)) {
      if (cue.kind === "enter" || cue.kind === "exit" || cues[cue.id] !== undefined) continue;
      const moved = shiftedTrigger(cue.trigger, dAppear, segment);
      if (moved) cues[cue.id] = moved;
    }
  }
  if (Object.keys(cues).length) patch.cues = cues;
  return patch;
}
