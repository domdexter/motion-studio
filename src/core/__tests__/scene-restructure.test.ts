import { describe, expect, it } from "vitest";
import { validateSceneSpec, type SceneSpec } from "../spec/scene";
import type { TimedWord } from "../spec/timing";
import { collectSceneEvents } from "../spec/triggers";
import { listSceneMedia } from "../timeline/media-clip";
import { SceneMergeLimitError, copySceneSpec, mergeSceneSpecs, retimeTrigger, splitSceneSpec } from "../timeline/scene-restructure";

/** One word per second: "w0" at 0 s, "w1" at 1 s, … */
const timed = (texts: string[]): TimedWord[] => texts.map((text, i) => ({ i, text, start: i, end: i + 0.5 }));
const words = timed(Array.from({ length: 12 }, (_, i) => `w${i}`));
const spec = (value: object) => {
  const v = validateSceneSpec({ version: 1, ...value });
  if (!v.ok) throw new Error(JSON.stringify(v.issues));
  return v.spec;
};
const valid = (s: SceneSpec) => expect(validateSceneSpec(s)).toMatchObject({ ok: true });
/** Enter and exit moments by element id. */
const moments = (s: SceneSpec, sceneStart: number, sceneEnd: number) =>
  Object.fromEntries(
    collectSceneEvents(s, { words, sceneStart, sceneEnd })
      .filter((e) => e.kind === "enter" || e.kind === "exit" || e.kind === "emphasis")
      .map((e) => [`${e.elementId}:${e.kind}`, Number(e.time.toFixed(3))]),
  );

describe("retiming triggers", () => {
  it("recounts a spoken word's occurrence in the new scene", () => {
    const w = timed(["a", "go", "b", "c", "d", "e", "f", "go", "g", "h"]);
    const r = retimeTrigger({ type: "word", value: "go", occurrence: 2 }, "sceneStart", { from: { words: w, sceneStart: 0, sceneEnd: 10 }, to: { words: w, sceneStart: 5, sceneEnd: 10 } });
    expect(r).toEqual({ trigger: { type: "word", value: "go" }, time: 7, placement: "inside" });
  });

  it("turns scene-relative times into times from the new start", () => {
    const r = retimeTrigger({ type: "sceneTime", seconds: 7 }, "sceneStart", { from: { words, sceneStart: 0, sceneEnd: 10 }, to: { words, sceneStart: 5, sceneEnd: 10 } });
    expect(r.trigger).toEqual({ type: "sceneTime", seconds: 2 });
    expect(retimeTrigger(undefined, "sceneEnd", { from: { words, sceneStart: 0, sceneEnd: 10 }, to: { words, sceneStart: 0, sceneEnd: 5 } }).placement).toBe("after");
  });
});

describe("splitting a scene", () => {
  const original = spec({
    background: { type: "solid", color: "#111111" },
    elements: [
      { type: "text", id: "title", text: "Title", emphasis: [{ type: "pulse", at: { type: "word", value: "w8" } }] },
      { type: "text", id: "early", text: "Early", exit: { type: "fade", duration: 0.5, at: { type: "sceneTime", seconds: 2 } } },
      { type: "text", id: "late", text: "Late", enter: { type: "rise", at: { type: "word", value: "w7" } } },
      {
        type: "video",
        id: "video_1",
        assetId: "ast_v",
        startFrom: 2,
        enter: { type: "fade", at: { type: "sceneTime", seconds: 1 } },
        exit: { type: "fade", duration: 0.4, at: { type: "sceneTime", seconds: 7 } },
        zooms: [{ id: "z1", startSec: 3, endSec: 5, rect: { x: 0.2, y: 0.2, size: 0.5 }, toRect: null, easeSec: 0.3 }],
      },
      { type: "counter", id: "count", to: 42, animateAt: { type: "sceneTime", seconds: 1 } },
    ],
  });
  const { first, second, notes } = splitSceneSpec(original, { start: 0, end: 10 }, 5, { words, sourceDurationSec: () => 60 });

  it("keeps each element in the part where it is on screen", () => {
    valid(first);
    valid(second);
    expect(first.elements.map((e) => e.id)).toEqual(["title", "early", "video_1", "count"]);
    expect(second.elements.map((e) => e.id)).toEqual(["title", "late", "video_1", "count"]);
    expect(second.transitionIn).toEqual({ type: "cut" });
    expect(second.background).toEqual(original.background);
    expect(notes[0]).toMatch(/3 elements are on screen across the cut/);
  });

  it("fires every entrance, exit and emphasis at the same moment", () => {
    expect(moments(first, 0, 5)).toMatchObject({ "early:exit": 2, "video_1:enter": 1 });
    expect(moments(second, 5, 10)).toMatchObject({ "late:enter": 7, "video_1:exit": 7, "title:emphasis": 8 });
    expect(first.elements[0].emphasis).toBeUndefined();
    expect(second.elements[1].enter?.at).toEqual({ type: "word", value: "w7" });
  });

  it("continues media and finished animations across the cut", () => {
    const [firstVideo] = listSceneMedia(first, { words, sceneStart: 0, sceneEnd: 5 });
    const [secondVideo] = listSceneMedia(second, { words, sceneStart: 5, sceneEnd: 10 });
    expect(firstVideo.element).toMatchObject({ startFrom: 2, endAt: 6, zooms: [{ startSec: 3, endSec: 4 }] });
    expect(firstVideo.element.exit).toBeUndefined();
    expect(secondVideo).toMatchObject({ appearSec: 5, goneSec: 7.4 });
    expect(secondVideo.element).toMatchObject({ startFrom: 6, enter: { type: "none" }, zooms: [{ startSec: 0, endSec: 1 }] });
    expect(second.elements[3]).toMatchObject({ from: 42 });
    expect(second.elements[3]).not.toHaveProperty("animateAt");
  });

  it("divides shots at the cut: the shot on screen opens the second part", () => {
    const withShots = spec({
      elements: [],
      shots: [
        { id: "s1", elements: [{ type: "text", id: "a", text: "A" }] },
        { id: "s2", at: { type: "sceneTime", seconds: 6 }, transitionIn: { type: "fade" }, elements: [{ type: "text", id: "b", text: "B" }] },
      ],
    });
    const parts = splitSceneSpec(withShots, { start: 0, end: 10 }, 5, { words });
    valid(parts.first);
    valid(parts.second);
    expect(parts.first.shots?.map((s) => s.id)).toEqual(["s1"]);
    expect(parts.second.shots).toMatchObject([
      { id: "s1", elements: [{ id: "a", enter: { type: "none" } }] },
      { id: "s2", at: { type: "sceneTime", seconds: 1 }, transitionIn: { type: "fade" } },
    ]);
    expect(parts.second.shots?.[0].at).toBeUndefined();
  });
});

describe("merging scenes", () => {
  it("keeps both designs as shots at their own times", () => {
    const a = spec({ background: { type: "solid", color: "#ff0000" }, elements: [{ type: "text", id: "title", text: "A", enter: { type: "fade" } }] });
    const b = spec({ transitionIn: { type: "fade", duration: 0.5 }, camera: { type: "pushIn" }, elements: [{ type: "text", id: "title", text: "B", enter: { type: "rise", at: { type: "word", value: "w7" } } }] });
    const { spec: merged, notes } = mergeSceneSpecs({ key: "scene_01", spec: a, start: 0, end: 5 }, { key: "scene_02", spec: b, start: 5, end: 10 }, { words });
    valid(merged);
    expect(merged.elements).toEqual([]);
    expect(merged.shots).toMatchObject([
      { id: "scene_01", background: { type: "solid", color: "#ff0000" }, elements: [{ id: "title", text: "A" }] },
      { id: "scene_02", at: { type: "sceneTime", seconds: 5 }, camera: { type: "pushIn" }, transitionIn: { type: "fade", duration: 0.5 }, elements: [{ id: "title_2", text: "B" }] },
    ]);
    expect(moments(merged, 0, 10)).toMatchObject({ "scene_01/title:enter": 0, "scene_02/title_2:enter": 7 });
    expect(notes.join(" ")).toMatch(/scene_02's design is kept as shot “scene_02”/);
  });

  it("bounds scene-level elements of scenes with shots and renames clashing shots", () => {
    const a = spec({ elements: [{ type: "text", id: "logo", text: "L" }], shots: [{ id: "s1", elements: [{ type: "text", id: "x", text: "X" }] }] });
    const b = spec({ elements: [{ type: "text", id: "tag", text: "T" }], shots: [{ id: "s1", elements: [{ type: "text", id: "y", text: "Y" }] }] });
    const { spec: merged, renamedShots } = mergeSceneSpecs({ key: "scene_01", spec: a, start: 0, end: 5 }, { key: "scene_02", spec: b, start: 5, end: 10 }, { words });
    valid(merged);
    expect(merged.shots?.map((s) => [s.id, s.at])).toEqual([
      ["s1", undefined],
      ["s1_2", { type: "sceneTime", seconds: 5 }],
    ]);
    expect(renamedShots.get("s1")).toBe("s1_2");
    expect(merged.elements).toMatchObject([
      { id: "logo", exit: { type: "fade", duration: 0.04, at: { type: "sceneTime", seconds: 4.96 } } },
      { id: "tag", enter: { type: "fade", duration: 0.04, at: { type: "sceneTime", seconds: 5 } } },
    ]);
  });

  it("refuses a merge that can't fit one scene", () => {
    const shots = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, ...(i ? { at: { type: "sceneTime", seconds: i * 0.5 } } : {}), elements: [] }));
    const a = spec({ elements: [], shots: shots(7, "a") });
    const b = spec({ elements: [], shots: shots(6, "b") });
    expect(() => mergeSceneSpecs({ key: "scene_01", spec: a, start: 0, end: 5 }, { key: "scene_02", spec: b, start: 5, end: 10 }, { words })).toThrow(SceneMergeLimitError);
  });
});

describe("copying a scene to another time", () => {
  it("keeps every moment's place in the scene without narration", () => {
    const original = spec({
      elements: [
        { type: "text", id: "a", text: "A", enter: { type: "fade", at: { type: "word", value: "w3" } }, exit: { type: "fade", at: { type: "time", seconds: 5 } } },
        { type: "kinetic", id: "k" },
      ],
    });
    const { spec: copy, notes } = copySceneSpec(original, { start: 2, end: 6 }, { start: 20, end: 24 }, words);
    valid(copy);
    expect(copy.elements[0]).toMatchObject({ enter: { at: { type: "sceneTime", seconds: 1 } }, exit: { at: { type: "sceneTime", seconds: 3 } } });
    expect(notes[0]).toMatch(/no narration/);
  });
});
