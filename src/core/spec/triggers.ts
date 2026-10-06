import { grammarEnter } from "../creative/grammar";
import { CARDS_COLLAPSE_SECONDS, isGroup, type SceneElement, type SceneSpec, type Trigger } from "./scene";
import type { TimedWord } from "./timing";
import { normalizeWord } from "../util/text";

/**
 * Resolves triggers (sceneStart, word "platform", phrase, time, shotStart …) to absolute seconds on
 * the master timeline. The same function feeds the Remotion engine (→ frames) and the GUI
 * timeline markers, so what you see on the timeline is exactly what renders.
 */

export interface TriggerContext {
  words: TimedWord[];
  sceneStart: number;
  sceneEnd: number;
  /** Bounds of the shot being resolved. Defaults (and element fallbacks) use the scene when absent. */
  shotStart?: number;
  shotEnd?: number;
}

export interface ResolvedTime {
  /** Absolute seconds, clamped into the scene. */
  time: number;
  ok: boolean;
  reason?: string;
  wordIndex?: number;
}

const SCENE_TOLERANCE = 0.08;

/** Index range [first, last+1) of words spoken inside a scene. */
export function sceneWordRange(words: TimedWord[], sceneStart: number, sceneEnd: number): [number, number] {
  let first = -1;
  let last = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.start >= sceneStart - SCENE_TOLERANCE && w.start < sceneEnd) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return first < 0 ? [0, 0] : [first, last + 1];
}

export function wordsInScene(words: TimedWord[], sceneStart: number, sceneEnd: number): TimedWord[] {
  const [a, b] = sceneWordRange(words, sceneStart, sceneEnd);
  return words.slice(a, b);
}

function clampInto(time: number, ctx: TriggerContext, extra: Partial<ResolvedTime> = {}): ResolvedTime {
  if (time < ctx.sceneStart - 1e-6 || time > ctx.sceneEnd + 1e-6) {
    return {
      time: Math.min(ctx.sceneEnd, Math.max(ctx.sceneStart, time)),
      ok: false,
      reason: `Trigger time ${time.toFixed(2)}s is outside the scene (${ctx.sceneStart.toFixed(2)}–${ctx.sceneEnd.toFixed(2)}s)`,
      ...extra,
    };
  }
  return { time, ok: true, ...extra };
}

/** Transcript indexes inside `range` where `value` is spoken (exact matches, else prefix matches for 4+ letters). */
export function findWordMatches(words: TimedWord[], value: string, range: [number, number]): number[] {
  const target = normalizeWord(value);
  if (!target) return [];
  const exact: number[] = [];
  const prefix: number[] = [];
  for (let i = range[0]; i < range[1]; i++) {
    const norm = normalizeWord(words[i].text);
    if (norm === target) exact.push(i);
    else if (target.length >= 4 && norm.startsWith(target)) prefix.push(i);
  }
  return exact.length ? exact : prefix;
}

/** [first, last] transcript indexes inside `range` where the phrase is spoken. */
export function findPhraseMatches(words: TimedWord[], value: string, range: [number, number]): [number, number][] {
  const tokens = value.split(/\s+/).map(normalizeWord).filter(Boolean);
  if (tokens.length === 0) return [];
  const out: [number, number][] = [];
  for (let i = range[0]; i + tokens.length <= range[1]; i++) {
    let ok = true;
    for (let k = 0; k < tokens.length; k++) {
      if (normalizeWord(words[i + k].text) !== tokens[k]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push([i, i + tokens.length - 1]);
  }
  return out;
}

export function resolveTrigger(
  trigger: Trigger | undefined,
  ctx: TriggerContext,
  fallback: "sceneStart" | "sceneEnd" = "sceneStart",
): ResolvedTime {
  const segmentStart = ctx.shotStart ?? ctx.sceneStart;
  const segmentEnd = ctx.shotEnd ?? ctx.sceneEnd;
  const fallbackTime = fallback === "sceneStart" ? segmentStart : segmentEnd;
  if (!trigger) return { time: fallbackTime, ok: true };
  const offset = trigger.offset ?? 0;

  switch (trigger.type) {
    case "sceneStart":
      return clampInto(ctx.sceneStart + offset, ctx);
    case "sceneEnd":
      return clampInto(ctx.sceneEnd + offset, ctx);
    case "shotStart":
      return clampInto(segmentStart + offset, ctx);
    case "shotEnd":
      return clampInto(segmentEnd + offset, ctx);
    case "shotTime":
      return clampInto(segmentStart + trigger.seconds + offset, ctx);
    case "time":
      return clampInto(trigger.seconds + offset, ctx);
    case "sceneTime":
      return clampInto(ctx.sceneStart + trigger.seconds + offset, ctx);
    case "wordIndex": {
      const w = ctx.words[trigger.index];
      if (!w) return { time: fallbackTime, ok: false, reason: `Word index ${trigger.index} does not exist in the transcript` };
      const t = (trigger.edge === "end" ? w.end : w.start) + offset;
      return clampInto(t, ctx, { wordIndex: trigger.index });
    }
    case "word": {
      const range: [number, number] =
        trigger.scope === "global" ? [0, ctx.words.length] : sceneWordRange(ctx.words, ctx.sceneStart, ctx.sceneEnd);
      const matches = findWordMatches(ctx.words, trigger.value, range);
      const occurrence = trigger.occurrence ?? 1;
      const idx = matches[occurrence - 1];
      if (idx === undefined) {
        return {
          time: fallbackTime,
          ok: false,
          reason:
            matches.length === 0
              ? `"${trigger.value}" is not spoken ${trigger.scope === "global" ? "in the voice-over" : "in this scene"}`
              : `"${trigger.value}" is spoken ${matches.length}× but occurrence ${occurrence} was requested`,
        };
      }
      const w = ctx.words[idx];
      return clampInto((trigger.edge === "end" ? w.end : w.start) + offset, ctx, { wordIndex: idx });
    }
    case "phrase": {
      const range: [number, number] =
        trigger.scope === "global" ? [0, ctx.words.length] : sceneWordRange(ctx.words, ctx.sceneStart, ctx.sceneEnd);
      const matches = findPhraseMatches(ctx.words, trigger.value, range);
      const occurrence = trigger.occurrence ?? 1;
      const m = matches[occurrence - 1];
      if (!m) {
        return { time: fallbackTime, ok: false, reason: `Phrase "${trigger.value}" is not spoken in this scene` };
      }
      const t = trigger.edge === "end" ? ctx.words[m[1]].end : ctx.words[m[0]].start;
      return clampInto(t + offset, ctx, { wordIndex: m[0] });
    }
  }
}

// ---------------------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------------------

export interface ShotWindow {
  id: string;
  index: number;
  /** Absolute seconds. Each shot ends where the next starts (the last one at the scene end). */
  start: number;
  end: number;
  ok: boolean;
  reason?: string;
  voiceSynced: boolean;
}

const MIN_SHOT_GAP = 0.04;

/** Resolves the shot sequence of a scene. Invalid starts are repaired so rendering stays deterministic. */
export function resolveShotWindows(spec: SceneSpec, ctx: TriggerContext): ShotWindow[] {
  const shots = spec.shots ?? [];
  if (!shots.length) return [];
  const sceneCtx: TriggerContext = { words: ctx.words, sceneStart: ctx.sceneStart, sceneEnd: ctx.sceneEnd };
  const duration = Math.max(0.001, ctx.sceneEnd - ctx.sceneStart);
  const windows: ShotWindow[] = shots.map((shot, i) => {
    if (!shot.at) {
      const time = ctx.sceneStart + (duration * i) / shots.length;
      return { id: shot.id, index: i, start: time, end: ctx.sceneEnd, ok: i === 0, reason: i === 0 ? undefined : `Shot "${shot.id}" has no \`at\` trigger (only the first shot may omit it)`, voiceSynced: false };
    }
    const r = resolveTrigger(shot.at, sceneCtx, "sceneStart");
    return { id: shot.id, index: i, start: r.time, end: ctx.sceneEnd, ok: r.ok, reason: r.reason, voiceSynced: shot.at.type === "word" || shot.at.type === "phrase" || shot.at.type === "wordIndex" };
  });
  for (let i = 1; i < windows.length; i++) {
    const prev = windows[i - 1];
    if (windows[i].start <= prev.start + MIN_SHOT_GAP) {
      windows[i] = { ...windows[i], ok: false, reason: `Shot "${windows[i].id}" starts at ${windows[i].start.toFixed(2)}s, not after shot "${prev.id}" (${prev.start.toFixed(2)}s)`, start: Math.min(ctx.sceneEnd, prev.start + MIN_SHOT_GAP) };
    }
  }
  for (let i = 0; i < windows.length; i++) windows[i].end = i + 1 < windows.length ? windows[i + 1].start : ctx.sceneEnd;
  return windows;
}

// ---------------------------------------------------------------------------------------
// Events (timeline markers + validation)
// ---------------------------------------------------------------------------------------

export interface SceneEvent {
  elementId: string;
  elementType: SceneElement["type"];
  kind: "enter" | "exit" | "emphasis" | "action" | "shot";
  label: string;
  time: number;
  ok: boolean;
  reason?: string;
  wordIndex?: number;
  /** True when the event is synced to a spoken word/phrase. */
  voiceSynced: boolean;
  /** Shot the element belongs to (null: scene-level). */
  shotId?: string | null;
  /** Animation type (enter/exit type, "collapse", …). */
  animation?: string;
  /** Explicit seconds the motion needs to finish (undefined: the design default or not applicable). */
  duration?: number;
  /** The element cue the event comes from (see `elementCues`). */
  cueId?: CueId;
}

/** True for a trigger on a spoken word or phrase. */
export const isVoiceTrigger = (t: Trigger | undefined) => !!t && (t.type === "word" || t.type === "phrase" || t.type === "wordIndex");

/** Seconds a shot may start before its first word and still own that word. */
export const SHOT_WORD_TOLERANCE = 0.3;

/** Words spoken inside a scene, or inside a shot of it (a word belongs to the shot it starts in). */
export function wordsInSegment(words: TimedWord[], ctx: TriggerContext): TimedWord[] {
  const scene = wordsInScene(words, ctx.sceneStart, ctx.sceneEnd);
  if (ctx.shotStart === undefined) return scene;
  const end = ctx.shotEnd ?? ctx.sceneEnd;
  return scene.filter((w) => w.start >= ctx.shotStart! - SHOT_WORD_TOLERANCE && w.start < end - 0.02);
}

/** Transcript index of the first visible token spoken in the segment (same matching as the text renderer). */
function firstSpokenToken(text: string, ctx: TriggerContext): number | null {
  const segment = wordsInSegment(ctx.words, ctx);
  for (const token of text.split(/\s+/)) {
    const norm = normalizeWord(token);
    if (!norm) continue;
    const hit = segment.find((w) => normalizeWord(w.text) === norm);
    if (hit) return hit.i;
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Cues (every moment an element's motion is timed to)
// ---------------------------------------------------------------------------------------

/**
 * A cue of an element: its entrance or exit, an emphasis moment, an action of its type (a button
 * press, a count-up, a cards collapse, diagram connections), a list or cards item's entrance, a
 * cursor click or a cursor path point. List positions are 0-based.
 */
export type CueId = "enter" | "exit" | "pressAt" | "animateAt" | "collapseAt" | "connectAt" | `emphasis:${number}` | `item:${number}` | `click:${number}` | `path:${number}`;
export const CUE_ID_PATTERN = /^(enter|exit|pressAt|animateAt|collapseAt|connectAt|(emphasis|item|click|path):\d{1,2})$/;
export const isCueId = (value: string): value is CueId => CUE_ID_PATTERN.test(value);

export type CueKind = "enter" | "exit" | "emphasis" | "action" | "path";

export interface ElementCue {
  id: CueId;
  kind: CueKind;
  /** What happens: the animation ("rise", "pulse") or the action ("press", "item 2", "click", "point 3"). */
  name: string;
  /** The trigger it fires on (undefined: its default moment, the start of its scene or shot). */
  trigger: Trigger | undefined;
  /** Absolute seconds it happens (delay included, never after its scene or shot ends). */
  time: number;
  ok: boolean;
  reason?: string;
  wordIndex?: number;
  /** Fires on a spoken word or phrase. */
  voiceSynced: boolean;
  /** Seconds after the trigger (entrances). */
  delay: number;
  animation?: string;
  /** Seconds the motion takes, when set (entrances, exits, emphasis, a collapse). */
  duration?: number;
  /** The entrance comes from the element's motion intent (it has no `enter` of its own). */
  grammar?: boolean;
  /** A voice-synced word reveal: its words appear as they are spoken, whatever its entrance cue says. */
  spoken?: boolean;
  /** Also one of the scene's timed events (validation, creative metrics); path points and card items are cues only. */
  event: boolean;
}

/** Element id used by timed events: its id, else `<type>_<n>`, prefixed with its shot. */
export function eventElementId(element: SceneElement, index: number, shotId: string | null | undefined): string {
  const local = element.id ?? `${element.type}_${index + 1}`;
  return shotId ? `${shotId}/${local}` : local;
}

/**
 * Every cue of an element with the moment it happens, resolved the way the engine plays it. `segment`
 * is its scene's timing, narrowed to its shot (`shotStart`/`shotEnd`) for an element inside a shot.
 */
export function elementCues(el: SceneElement, segment: TriggerContext, shotId: string | null = null): ElementCue[] {
  const cues: ElementCue[] = [];
  const shotStart = segment.shotStart;
  const segEnd = segment.shotEnd ?? segment.sceneEnd;
  const push = (id: CueId, kind: CueKind, name: string, trigger: Trigger | undefined, fallback: "sceneStart" | "sceneEnd", extra: Partial<ElementCue> = {}) => {
    const delay = extra.delay ?? 0;
    const r = resolveTrigger(trigger, segment, fallback);
    const at = r.time + delay;
    let ok = r.ok;
    let reason = r.reason;
    if (shotStart !== undefined && ok && (at < shotStart - 1e-3 || at > segEnd + 1e-3)) {
      ok = false;
      reason = `Fires at ${at.toFixed(2)}s, outside shot "${shotId}" (${shotStart.toFixed(2)}–${segEnd.toFixed(2)}s) when it is not on screen`;
    }
    cues.push({ ...extra, id, kind, name, trigger, time: Math.min(segEnd, at), ok, reason, wordIndex: r.wordIndex, voiceSynced: isVoiceTrigger(trigger), delay, event: extra.event ?? true });
  };
  // The entrance the engine plays: explicit `enter`, else the motion grammar's entrance for the intent.
  const enter = el.enter ?? (el.motionIntent ? grammarEnter(el.motionIntent, el.type) : undefined);
  if (enter && enter.type !== "none") {
    const grammar = !el.enter;
    // Voice-synced word reveals start when their first word is spoken, not at the enter trigger.
    const spoken = el.type === "text" && enter.type === "wordReveal" && el.syncToVoice ? firstSpokenToken(el.text, segment) : null;
    if (spoken !== null) push("enter", "enter", `${enter.type} (voice)`, { type: "wordIndex", index: spoken }, "sceneStart", { animation: enter.type, grammar, spoken: true });
    else push("enter", "enter", `${enter.type}${grammar ? " (grammar)" : ""}`, enter.at, "sceneStart", { delay: enter.delay ?? 0, animation: enter.type, duration: enter.duration, grammar });
  }
  if (el.exit && el.exit.type !== "none" && el.exit.at) push("exit", "exit", el.exit.type, el.exit.at, "sceneEnd", { animation: el.exit.type, duration: el.exit.duration });
  el.emphasis?.forEach((e, k) => push(`emphasis:${k}`, "emphasis", e.type, e.at, "sceneStart", { animation: e.type, duration: e.duration }));
  if (el.type === "cards" && el.collapseAt) push("collapseAt", "action", "collapse", el.collapseAt, "sceneStart", { animation: "collapse", duration: CARDS_COLLAPSE_SECONDS });
  if (el.type === "button" && el.pressAt) push("pressAt", "action", "press", el.pressAt, "sceneStart");
  if ((el.type === "counter" || el.type === "progress" || el.type === "chart") && el.animateAt) push("animateAt", "action", "animate", el.animateAt, "sceneStart");
  if (el.type === "diagram" && el.connectAt) push("connectAt", "action", "connect", el.connectAt, "sceneStart");
  if (el.type === "list") el.items.forEach((it, k) => it.at && push(`item:${k}`, "action", `item ${k + 1}`, it.at, "sceneStart"));
  if (el.type === "cursor") el.clicks?.forEach((c, k) => push(`click:${k}`, "action", "click", c, "sceneStart"));
  if (el.type === "cards") el.items.forEach((it, k) => it.at && push(`item:${k}`, "action", `item ${k + 1}`, it.at, "sceneStart", { event: false }));
  if (el.type === "cursor") el.path.forEach((p, k) => push(`path:${k}`, "path", `point ${k + 1}`, p.at, "sceneStart", { event: false }));
  return cues;
}

function collectElementEvents(elements: SceneElement[], shot: ShotWindow | null, ctx: TriggerContext, events: SceneEvent[]): void {
  const segCtx: TriggerContext = shot ? { ...ctx, shotStart: shot.start, shotEnd: shot.end } : { words: ctx.words, sceneStart: ctx.sceneStart, sceneEnd: ctx.sceneEnd };
  // A group's children keep their own cues, so they are events of the scene like any other element.
  const flat = elements.flatMap((el, index) => (isGroup(el) ? [{ el: el as SceneElement, index }, ...el.children.map((child) => ({ el: child as SceneElement, index }))] : [{ el: el as SceneElement, index }]));
  flat.forEach(({ el, index }) => {
    const elementId = eventElementId(el, index, shot?.id);
    for (const cue of elementCues(el, segCtx, shot?.id ?? null)) {
      if (!cue.event || cue.kind === "path") continue;
      // Motion that has to finish in time (the cut-off check): entrances, exits and a cards collapse.
      const motion = cue.kind === "enter" || cue.kind === "exit" || cue.id === "collapseAt" ? { animation: cue.animation, duration: cue.duration } : {};
      events.push({ elementId, elementType: el.type, kind: cue.kind, label: `${elementId} ${cue.name}`, time: cue.time, ok: cue.ok, reason: cue.reason, wordIndex: cue.wordIndex, voiceSynced: cue.voiceSynced, shotId: shot?.id ?? null, cueId: cue.id, ...motion });
    }
  });
}

/** All timed events of a scene (scene-level elements, shots and shot elements), sorted by time. */
export function collectSceneEvents(spec: SceneSpec, ctx: TriggerContext): SceneEvent[] {
  const events: SceneEvent[] = [];
  collectElementEvents(spec.elements, null, ctx, events);
  const windows = resolveShotWindows(spec, ctx);
  (spec.shots ?? []).forEach((shot, i) => {
    const w = windows[i];
    events.push({ elementId: shot.id, elementType: "rect", kind: "shot", label: `shot ${shot.id}`, time: w.start, ok: w.ok, reason: w.reason, voiceSynced: w.voiceSynced, shotId: shot.id });
    collectElementEvents(shot.elements, w, ctx, events);
  });
  if (spec.transitionIn && spec.transitionIn.type !== "none" && spec.transitionIn.type !== "cut") {
    events.push({ elementId: "scene", elementType: "rect", kind: "action", label: `transition ${spec.transitionIn.type}`, time: ctx.sceneStart, ok: true, voiceSynced: false, shotId: null });
  }
  return events.sort((a, b) => a.time - b.time);
}
