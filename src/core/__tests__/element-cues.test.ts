import { describe, expect, it } from "vitest";
import { MOTION_CUT_SEC } from "../timeline/element-layout";
import { SceneSpecSchema, validateSceneSpec, type ElementOf, type SceneElement, type Trigger } from "../spec/scene";
import type { TimedWord } from "../spec/timing";
import { collectSceneEvents, elementCues, resolveTrigger, type TriggerContext } from "../spec/triggers";
import { CueError, dragElementSpan, elementTimingPatch, moveLimits, setElementCue, shiftedTrigger, spokenTrigger, wordAtTime, type TimingChange } from "../timeline/element-cues";
import { elementSpan } from "../timeline/scene-restructure";
import { ElementPatchSchema, SpecPatchError, applyElementPatch, elementPatchKeys } from "../timeline/spec-patch";
import { clusterByDistance, snapEdges } from "../timeline/time-snap";

function words(text: string, start = 0, step = 0.5): TimedWord[] {
  return text.split(/\s+/).map((t, i) => ({ i, text: t, start: start + i * step, end: start + i * step + step * 0.8 }));
}

// Meet 0 · the 0.5 · new 1.0 · platform. 1.5 · The 2.0 · platform 2.5 · runs 3.0 · every 3.5 · team. 4.0
const w = words("Meet the new platform. The platform runs every team.");
const scene: TriggerContext = { words: w, sceneStart: 0, sceneEnd: 5 };
const patchCtx = { sceneDurationSec: 5 };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const spec = SceneSpecSchema.parse({
  elements: [
    {
      id: "title",
      type: "text",
      text: "Meet the platform",
      enter: { type: "rise", at: { type: "word", value: "new" }, delay: 0.1 },
      exit: { type: "fade", duration: 0.4, at: { type: "sceneTime", seconds: 4 } },
      emphasis: [{ type: "pulse", at: { type: "word", value: "platform", occurrence: 2 } }],
    },
    { id: "cta", type: "button", label: "Start", pressAt: { type: "sceneTime", seconds: 3 } },
    { id: "deck", type: "cards", items: [{ title: "A", at: { type: "word", value: "runs" } }, { title: "B" }], collapseAt: { type: "sceneTime", seconds: 4.2 } },
    {
      id: "cur",
      type: "cursor",
      path: [
        { x: 10, y: 10, at: { type: "sceneStart" } },
        { x: 50, y: 50, at: { type: "sceneTime", seconds: 2 } },
      ],
      clicks: [{ type: "sceneTime", seconds: 2.1 }],
    },
  ],
});
const [title, cta, deck, cursor] = spec.elements;

describe("element cues", () => {
  it("lists every cue of an element with the moment it happens", () => {
    expect(elementCues(title, scene).map((c) => [c.id, c.kind, r3(c.time), c.voiceSynced])).toEqual([
      ["enter", "enter", 1.1, true],
      ["exit", "exit", 4, false],
      ["emphasis:0", "emphasis", 2.5, true],
    ]);
    expect(elementCues(deck, scene).map((c) => [c.id, r3(c.time), c.event])).toEqual([
      ["collapseAt", 4.2, true],
      ["item:0", 3, false],
    ]);
    expect(elementCues(cursor, scene).map((c) => [c.id, r3(c.time), c.event])).toEqual([
      ["click:0", 2.1, true],
      ["path:0", 0, false],
      ["path:1", 2, false],
    ]);
  });

  it("builds the scene's timed events from the cues, as before", () => {
    const events = collectSceneEvents(spec, scene);
    expect(events.map((e) => e.label)).toEqual(["title rise", "cur click", "title pulse", "cta press", "title fade", "deck collapse"]);
    expect(events.map((e) => e.cueId)).toEqual(["enter", "click:0", "emphasis:0", "pressAt", "exit", "collapseAt"]);
    expect(events.find((e) => e.cueId === "collapseAt")).toMatchObject({ animation: "collapse", duration: 0.8 });
    expect(events.find((e) => e.cueId === "emphasis:0")?.animation).toBeUndefined();
  });

  it("keeps what a cue means when its scene's timing moves", () => {
    const el: SceneElement = { type: "text", text: "x", enter: { type: "fade", at: { type: "sceneTime", seconds: 1 } }, emphasis: [{ type: "pop", at: { type: "word", value: "runs" } }] };
    // A time stays relative to the scene start; a word cue stays on its word.
    expect(elementCues(el, { words: w, sceneStart: 2, sceneEnd: 5 }).map((c) => c.time)).toEqual([3, 3]);
    expect(elementCues(el, { words: w, sceneStart: 2.5, sceneEnd: 5 }).map((c) => c.time)).toEqual([3.5, 3]);
  });
});

describe("setElementCue", () => {
  const on: Trigger = { type: "word", value: "runs" };

  it("cues the entrance, keeping its animation and dropping its delay", () => {
    expect(setElementCue(title, "enter", on).enter).toEqual({ type: "rise", at: on });
    expect(setElementCue({ type: "text", text: "Hi" }, "enter", on).enter).toEqual({ type: "fade", duration: MOTION_CUT_SEC, at: on });
    expect(setElementCue({ type: "text", text: "Hi", motionIntent: "support" }, "enter", on).enter).toEqual({ type: "rise", distance: 26, at: on });
    expect(setElementCue({ type: "text", text: "Hi", enter: { type: "none" } }, "enter", on).enter).toEqual({ type: "fade", duration: MOTION_CUT_SEC, at: on });
    expect(setElementCue(title, "enter", null).enter).toEqual({ type: "rise" });
    const plain: SceneElement = { type: "text", text: "Hi", enter: { type: "fade" } };
    expect(setElementCue(plain, "enter", null)).toBe(plain);
  });

  it("cues the exit; clearing removes a cut and lets an animation play at the end", () => {
    const gone = setElementCue({ type: "text", text: "Hi" }, "exit", { type: "sceneTime", seconds: 2 });
    expect(gone.exit).toEqual({ type: "fade", duration: MOTION_CUT_SEC, at: { type: "sceneTime", seconds: 2 } });
    expect(setElementCue(gone, "exit", null)).not.toHaveProperty("exit");
    expect(setElementCue(title, "exit", null).exit).toEqual({ type: "fade", duration: 0.4 });
  });

  it("moves or removes emphasis moments, actions, items, clicks and path points", () => {
    expect(setElementCue(title, "emphasis:0", { type: "sceneTime", seconds: 1 }).emphasis).toEqual([{ type: "pulse", at: { type: "sceneTime", seconds: 1 } }]);
    expect(setElementCue(title, "emphasis:0", null)).not.toHaveProperty("emphasis");
    expect(() => setElementCue(title, "emphasis:2", null)).toThrow(CueError);
    expect(() => setElementCue(title, "pressAt", { type: "sceneStart" })).toThrow(/no press cue/);
    expect(setElementCue(cta, "pressAt", null)).not.toHaveProperty("pressAt");
    expect((setElementCue(deck, "item:1", { type: "word", value: "every" }) as ElementOf<"cards">).items[1]).toEqual({ title: "B", at: { type: "word", value: "every" } });
    expect((setElementCue(deck, "item:0", null) as ElementOf<"cards">).items[0]).toEqual({ title: "A" });
    const clicked = setElementCue(cursor, "click:1", { type: "sceneTime", seconds: 3 }) as ElementOf<"cursor">;
    expect(clicked.clicks).toHaveLength(2);
    expect(setElementCue(setElementCue(clicked, "click:0", null), "click:0", null)).not.toHaveProperty("clicks");
    expect(() => setElementCue(cursor, "path:0", null)).toThrow(/needs a moment/);
    expect((setElementCue(cursor, "path:1", { type: "sceneTime", seconds: 2.5 }) as ElementOf<"cursor">).path[1].at).toEqual({ type: "sceneTime", seconds: 2.5 });
    expect(validateSceneSpec({ elements: [clicked, setElementCue(deck, "item:1", on)] }).ok).toBe(true);
  });
});

describe("spoken cues", () => {
  it("cues a word by its text and occurrence in the scene", () => {
    expect(spokenTrigger(w, 3, 3, scene)).toEqual({ type: "word", value: "platform" });
    expect(spokenTrigger(w, 5, 5, scene)).toEqual({ type: "word", value: "platform", occurrence: 2 });
    // Occurrences count inside the scene.
    expect(spokenTrigger(w, 5, 5, { sceneStart: 2, sceneEnd: 5 })).toEqual({ type: "word", value: "platform" });
    for (const index of [1, 3, 4, 5, 8]) expect(resolveTrigger(spokenTrigger(w, index, index, scene), scene).wordIndex).toBe(index);
  });

  it("cues a phrase, its end, and falls back to the transcript index", () => {
    const phrase = spokenTrigger(w, 4, 5, scene, { edge: "end" });
    expect(phrase).toEqual({ type: "phrase", value: "the platform", edge: "end" });
    expect(resolveTrigger(phrase, scene).time).toBeCloseTo(w[5].end);
    expect(spokenTrigger(words("go — now"), 1, 1, { sceneStart: 0, sceneEnd: 2 })).toEqual({ type: "wordIndex", index: 1 });
    expect(wordAtTime(w, 2.6)).toBe(5);
    expect(wordAtTime(w, 2.92)).toBe(5);
    expect(wordAtTime(w, 9)).toBeNull();
  });

  it("shifts timed cues and leaves voice cues on their words", () => {
    expect(shiftedTrigger({ type: "sceneTime", seconds: 2 }, 0.5, scene)).toEqual({ type: "sceneTime", seconds: 2.5 });
    expect(shiftedTrigger({ type: "sceneStart", offset: 0.3 }, 1, scene)).toEqual({ type: "sceneTime", seconds: 1.3 });
    expect(shiftedTrigger({ type: "word", value: "runs" }, 1, scene)).toBeNull();
    expect(shiftedTrigger(undefined, 1, scene)).toBeNull();
    expect(shiftedTrigger({ type: "shotStart" }, 0.5, { ...scene, shotStart: 2, shotEnd: 4 })).toEqual({ type: "shotTime", seconds: 0.5 });
  });
});

describe("element timing on the timeline", () => {
  it("moves and trims a span inside its bounds", () => {
    const span = { appear: 1, gone: 3 };
    const bounds = { start: 0, end: 5 };
    expect(moveLimits(span, bounds)).toEqual([-1, 2]);
    expect(dragElementSpan(span, bounds, "move", 3)).toEqual({ appear: 3, gone: 5 });
    expect(dragElementSpan(span, bounds, "move", -2)).toEqual({ appear: 0, gone: 2 });
    expect(dragElementSpan(span, bounds, "start", 2.5)).toEqual({ appear: 2.8, gone: 3 });
    expect(dragElementSpan(span, bounds, "start", -5)).toEqual({ appear: 0, gone: 3 });
    expect(dragElementSpan(span, bounds, "end", -5)).toEqual({ appear: 1, gone: 1.2 });
    expect(dragElementSpan(span, bounds, "end", 5)).toEqual({ appear: 1, gone: 5 });
  });

  const retimed = (el: SceneElement, segment: TriggerContext, change: TimingChange) => {
    const patch = elementTimingPatch(el, segment, change);
    const next = applyElementPatch(el, patch, patchCtx);
    expect(validateSceneSpec({ elements: [next] }).ok).toBe(true);
    return { patch, next, span: elementSpan(next, segment) };
  };

  it("saves a trimmed start on a spoken word as a word cue, anywhere else as a time", () => {
    const onWord = retimed(title, scene, { appear: 2.5, gone: 4.4, appearWord: { index: 5, edge: "start" } });
    expect(onWord.patch).toEqual({ cues: { enter: { type: "word", value: "platform", occurrence: 2 } } });
    expect(onWord.span.appear).toBeCloseTo(2.5);
    const free = retimed(title, scene, { appear: 0.7, gone: 4.4 });
    expect(free.patch).toEqual({ appearAt: 0.7 });
    expect(free.span.appear).toBeCloseTo(0.7);
    expect(retimed(title, scene, { appear: 0, gone: 4.4 }).next.enter).toEqual({ type: "rise" });
  });

  it("saves a trimmed end as when it's gone, or clears it at the end of its scene", () => {
    const early = retimed(title, scene, { appear: 1.1, gone: 3.2 });
    expect(early.patch).toEqual({ disappearAt: 3.2 });
    expect(early.span.gone).toBeCloseTo(3.2);
    expect(retimed(title, scene, { appear: 1.1, gone: 5 }).span.gone).toBe(5);
  });

  it("moves an element with its timed cues; cues on words stay on their words", () => {
    const moved = retimed(title, scene, { appear: 1.6, gone: 4.9 });
    expect(moved.patch).toEqual({ appearAt: 1.6, disappearAt: 4.9 });
    expect(moved.span.appear).toBeCloseTo(1.6);
    expect(moved.span.gone).toBeCloseTo(4.9);
    const button: SceneElement = { type: "button", label: "Go", enter: { type: "pop", at: { type: "sceneTime", seconds: 1 } }, emphasis: [{ type: "pulse", at: { type: "sceneTime", seconds: 2 } }], pressAt: { type: "sceneTime", seconds: 2.5 } };
    const shifted = retimed(button, scene, { appear: 0.5, gone: 4.5 });
    expect(shifted.patch).toEqual({ appearAt: 0.5, disappearAt: 4.5, cues: { "emphasis:0": { type: "sceneTime", seconds: 1.5 }, pressAt: { type: "sceneTime", seconds: 2 } } });
    expect(shifted.span.gone).toBeCloseTo(4.5);
  });

  it("moves a cards collapse when that's when the cards are gone, and times shot elements in their shot", () => {
    const stack: SceneElement = { type: "cards", items: [{ title: "A" }], enter: { type: "fade" }, collapseAt: { type: "sceneTime", seconds: 3 } };
    const collapsed = retimed(stack, scene, { appear: 0, gone: 3.2 });
    expect(collapsed.patch).toEqual({ cues: { collapseAt: { type: "sceneTime", seconds: 2.4 } } });
    expect(collapsed.span.gone).toBeCloseTo(3.2);

    const shot: TriggerContext = { ...scene, shotStart: 2, shotEnd: 4 };
    const inShot: SceneElement = { type: "text", text: "x", enter: { type: "fade" } };
    expect(retimed(inShot, shot, { appear: 2.5, gone: 4 }).span.appear).toBeCloseTo(2.5);
    const cut = retimed(inShot, shot, { appear: 2, gone: 3.5 });
    expect(cut.patch).toEqual({ disappearAt: 3.5 });
    expect(cut.span.gone).toBeCloseTo(3.5);
    expect(retimed(inShot, shot, { appear: 2, gone: 4 }).patch).toEqual({});
  });
});

describe("cue and emphasis patches", () => {
  const el: SceneElement = { type: "button", label: "Go", pressAt: { type: "sceneTime", seconds: 1 }, emphasis: [{ type: "pulse", at: { type: "sceneTime", seconds: 2 } }] };
  const ctx = { sceneDurationSec: 6 };

  it("sets cues and replaces emphasis moments through the element patch", () => {
    expect(applyElementPatch(el, { cues: { pressAt: { type: "word", value: "go" }, enter: { type: "sceneTime", seconds: 0.5 } } }, ctx)).toMatchObject({
      pressAt: { type: "word", value: "go" },
      enter: { type: "fade", duration: MOTION_CUT_SEC, at: { type: "sceneTime", seconds: 0.5 } },
    });
    const glow = [{ type: "glow" as const, at: { type: "word" as const, value: "go" }, color: "accent" }];
    expect(applyElementPatch(el, { emphasis: glow }, ctx).emphasis).toEqual(glow);
    expect(applyElementPatch(el, { emphasis: null }, ctx)).not.toHaveProperty("emphasis");
    expect(applyElementPatch(el, { cues: { "emphasis:0": null } }, ctx)).not.toHaveProperty("emphasis");
  });

  it("refuses unknown cues, missing moments and a time and a cue for the same edge", () => {
    expect(() => applyElementPatch(el, { cues: { "emphasis:4": null } }, ctx)).toThrow(SpecPatchError);
    expect(() => applyElementPatch(el, { appearAt: 1, cues: { enter: null } }, ctx)).toThrow(SpecPatchError);
    expect(ElementPatchSchema.safeParse({ cues: { wobble: null } }).success).toBe(false);
    expect(ElementPatchSchema.safeParse({ cues: { "click:3": { type: "sceneTime", seconds: 1 } } }).success).toBe(true);
    expect(elementPatchKeys({ cues: { enter: null, "emphasis:0": null }, emphasis: [] })).toEqual(["cues.enter", "cues.emphasis:0", "emphasis"]);
  });
});

describe("timeline snapping", () => {
  it("snaps the nearest dragged edge to the nearest target, earlier targets winning ties", () => {
    const targets = [
      { time: 1, kind: "scene" as const, label: "scene start" },
      { time: 2.02, kind: "word" as const, label: "“runs”", word: { index: 6, edge: "start" as const } },
    ];
    const snapped = snapEdges([1.95, 3], targets, 0.1);
    expect(snapped.target?.kind).toBe("word");
    expect(snapped.shift).toBeCloseTo(0.07);
    expect(snapped.edge).toBe(0);
    expect(snapEdges([1.5], targets, 0.1).target).toBeNull();
    const tie = snapEdges([2.03], [{ time: 2, kind: "playhead", label: "playhead" }, { time: 2, kind: "word", label: "w" }], 0.1);
    expect(tie.target?.kind).toBe("playhead");
  });

  it("groups markers that are too close to click one by one", () => {
    const groups = clusterByDistance([{ time: 1.5 }, { time: 1 }, { time: 1.01 }, { time: 3 }], 100, 8);
    expect(groups.map((g) => g.items.map((i) => i.time))).toEqual([[1, 1.01], [1.5], [3]]);
  });
});
