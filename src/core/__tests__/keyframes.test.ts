import { Easing } from "remotion";
import { describe, expect, it } from "vitest";
import { EASING_FUNCTIONS, ease } from "../motion/easing";
import {
  adjacentKeyframe,
  animatedProperties,
  elementAtTime,
  keyframeAt,
  keyframeClockSec,
  keyframeTracks,
  keyframedPatch,
  newKeyframeId,
  removeKeyframes,
  removeKeyframesPatch,
  retimeKeyframes,
  setKeyframe,
  trackValueAt,
  updateKeyframe,
  valueAt,
  withNewKeyframeIds,
  withUniqueKeyframeIds,
} from "../motion/keyframes";
import type { KeyframeProperty } from "../spec/animatable";
import { KEYFRAME_ID_RE, SceneSpecSchema, validateSceneSpec, type Keyframe, type KeyframeEasing, type SceneElement, type SceneSpec } from "../spec/scene";
import type { TriggerContext } from "../spec/triggers";
import { elementTimingPatch } from "../timeline/element-cues";
import { duplicateElements } from "../timeline/element-ops";
import { copySceneSpec, elementSpan, keyframesAfterRetime, mergeSceneSpecs, splitSceneSpec } from "../timeline/scene-restructure";
import { applyElementPatch } from "../timeline/spec-patch";

const kf = (id: string, property: KeyframeProperty, time: number, value: number, easing?: KeyframeEasing): Keyframe => ({ id, property, time, value, ...(easing ? { easing } : {}) });
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Keyframe values are a union (number, color, point); these tests animate numbers. */
const num = (v: unknown) => Number(v);

// A scene from 10 s to 20 s; the title appears 2 s in (at 12 s) and stays until the scene ends.
const scene: TriggerContext = { words: [], sceneStart: 10, sceneEnd: 20 };
const spec = SceneSpecSchema.parse({
  elements: [
    {
      id: "title",
      type: "text",
      text: "Keyframes",
      x: 30,
      enter: { type: "fade", at: { type: "sceneTime", seconds: 2 } },
      keyframes: [kf("a", "x", 0, 20), kf("b", "x", 2, 60), kf("c", "x", 4, 80), kf("o1", "opacity", 1, 0.5, "hold"), kf("o2", "opacity", 3, 1)],
    },
  ],
});
const title = spec.elements[0];

/** A property's value at a second of the video, resolved the way the renderer does (its clock starts when it appears). */
const atVideoSec = (el: SceneElement, segment: TriggerContext, property: KeyframeProperty, sec: number) => num(valueAt(el, property, sec - elementSpan(el, segment).appear));

describe("easing", () => {
  it("is the same curve Remotion's Easing module draws", () => {
    const samples = [0, 0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
    const pairs: [keyof typeof EASING_FUNCTIONS, (t: number) => number][] = [
      ["easeIn", Easing.in(Easing.cubic)],
      ["easeOut", Easing.out(Easing.cubic)],
      ["easeInOut", Easing.inOut(Easing.cubic)],
      ["snappy", Easing.bezier(0.2, 0.9, 0.1, 1)],
      ["smooth", Easing.bezier(0.45, 0, 0.2, 1)],
    ];
    for (const [name, reference] of pairs) for (const t of samples) expect(EASING_FUNCTIONS[name](t)).toBeCloseTo(reference(t), 12);
    expect(ease("easeIn", 2)).toBe(1);
    expect(ease("easeIn", -1)).toBe(0);
  });
});

describe("keyframe model", () => {
  it("adds a keyframe with a stable id and updates the one at the same moment instead of adding another", () => {
    const first = setKeyframe([], { property: "x", time: 1, value: 40 });
    expect(first.id).toMatch(KEYFRAME_ID_RE);
    expect(first.keyframes).toEqual([{ id: first.id, property: "x", time: 1, value: 40 }]);
    const same = setKeyframe(first.keyframes, { property: "x", time: 1.0004, value: 45 });
    expect(same.id).toBe(first.id);
    expect(same.keyframes).toEqual([{ id: first.id, property: "x", time: 1, value: 45 }]);
    const second = setKeyframe(same.keyframes, { property: "x", time: 0.5, value: 10 });
    expect(second.id).not.toBe(first.id);
    expect(second.keyframes.map((k) => [k.time, k.value])).toEqual([
      [0.5, 10],
      [1, 45],
    ]);
    // Other properties at the same moment are separate keyframes; values are clamped to the property's range.
    const opacity = setKeyframe(second.keyframes, { property: "opacity", time: 1, value: 1.4 });
    expect(opacity.keyframes).toHaveLength(3);
    expect(opacity.keyframes.find((k) => k.id === opacity.id)?.value).toBe(1);
  });

  it("gives a new keyframe the easing of the stretch it splits", () => {
    const list = [kf("a", "scale", 0, 1, "easeOut"), kf("b", "scale", 2, 2)];
    const { keyframes, id } = setKeyframe(list, { property: "scale", time: 1, value: 1.5 });
    expect(keyframes.find((k) => k.id === id)?.easing).toBe("easeOut");
    expect(setKeyframe(list, { property: "scale", time: 3, value: 1, easing: "hold" }).keyframes.at(-1)?.easing).toBe("hold");
  });

  it("moves, re-values, re-eases and removes keyframes", () => {
    const list = [kf("a", "x", 0, 20), kf("b", "x", 2, 60), kf("c", "x", 4, 80)];
    expect(updateKeyframe(list, "b", { time: 3 }).map((k) => [k.id, k.time])).toEqual([
      ["a", 0],
      ["b", 3],
      ["c", 4],
    ]);
    // Past a neighbour the order follows time; onto a neighbour's moment it replaces that keyframe; times stay in bounds.
    expect(updateKeyframe(list, "a", { time: 5 }).map((k) => k.id)).toEqual(["b", "c", "a"]);
    expect(updateKeyframe(list, "a", { time: 4 }).map((k) => [k.id, k.time, k.value])).toEqual([
      ["b", 2, 60],
      ["a", 4, 20],
    ]);
    expect(updateKeyframe(list, "c", { time: 9 }, 6).at(-1)?.time).toBe(6);
    expect(updateKeyframe(list, "b", { value: 250 }).find((k) => k.id === "b")?.value).toBe(200);
    const eased = updateKeyframe(list, "a", { easing: "easeInOut" });
    expect(eased[0].easing).toBe("easeInOut");
    expect(updateKeyframe(eased, "a", { easing: null })[0]).toEqual(kf("a", "x", 0, 20));
    expect(removeKeyframes(list, ["a", "c"])).toEqual([kf("b", "x", 2, 60)]);
  });

  it("finds the keyframe at a moment and the ones before and after it", () => {
    const list = [kf("a", "x", 0, 20), kf("b", "x", 2, 60), kf("s", "scale", 1, 1)];
    expect(keyframeAt(list, "x", 2.01, 0.02)?.id).toBe("b");
    expect(keyframeAt(list, "x", 2.05, 0.02)).toBeNull();
    expect(adjacentKeyframe(list, 2, 1)).toBeNull();
    expect(adjacentKeyframe(list, 2, -1)?.id).toBe("s");
    expect(adjacentKeyframe(list, 2, -1, ["x"])?.id).toBe("a");
    expect(adjacentKeyframe(list, 1.99, 1, ["x"], 0.02)).toBeNull();
    expect(adjacentKeyframe(list, 0.5, 1)?.id).toBe("s");
  });

  it("gives copies new ids and keeps ids unique", () => {
    const taken = new Set(["a", "b"]);
    const renewed = withNewKeyframeIds([kf("a", "x", 0, 1), kf("b", "x", 1, 2)], taken);
    expect(renewed.map((k) => k.id).some((id) => id === "a" || id === "b")).toBe(false);
    expect(new Set(renewed.map((k) => k.id)).size).toBe(2);
    expect(taken.size).toBe(4);
    const unique = withUniqueKeyframeIds([kf("a", "x", 0, 1), kf("z", "y", 0, 1)], new Set(["a"]));
    expect(unique[0].id).not.toBe("a");
    expect(unique[1].id).toBe("z");
    const ids = new Set(Array.from({ length: 200 }, () => newKeyframeId()));
    expect(ids.size).toBe(200);
  });
});

describe("keyframe resolution", () => {
  const x = keyframeTracks(title.keyframes).get("x")!;

  it("holds the first value before the first keyframe and the last value after the last", () => {
    expect(trackValueAt(x, -1)).toBe(20);
    expect(trackValueAt(x, 0)).toBe(20);
    expect(trackValueAt(x, 4)).toBe(80);
    expect(trackValueAt(x, 10)).toBe(80);
  });

  it("is exact at keyframes and interpolates between them with each stretch's easing", () => {
    expect(trackValueAt(x, 2)).toBe(60);
    expect(trackValueAt(x, 1)).toBe(40);
    expect(trackValueAt(x, 3)).toBe(70);
    const easedIn = [kf("a", "x", 0, 0, "easeIn"), kf("b", "x", 2, 100)];
    expect(trackValueAt(easedIn, 1)).toBeCloseTo(12.5, 10);
    const opacity = keyframeTracks(title.keyframes).get("opacity")!;
    expect(trackValueAt(opacity, 2.999)).toBe(0.5);
    expect(trackValueAt(opacity, 3)).toBe(1);
  });

  it("animates x, y, scale, rotation and opacity and leaves other properties alone", () => {
    const el = SceneSpecSchema.parse({
      elements: [
        {
          type: "rect",
          width: 10,
          height: 10,
          x: 5,
          y: 6,
          rotation: 7,
          scale: 2,
          opacity: 0.9,
          keyframes: [kf("x0", "x", 0, 10), kf("x1", "x", 1, 20), kf("y0", "y", 0, 30), kf("y1", "y", 1, 50), kf("s0", "scale", 0, 1), kf("s1", "scale", 1, 3), kf("r0", "rotation", 0, 0), kf("r1", "rotation", 1, 90), kf("o0", "opacity", 0, 0), kf("o1", "opacity", 1, 1)],
        },
      ],
    }).elements[0];
    const mid = elementAtTime(el, 0.5);
    expect([mid.x, mid.y, mid.scale, mid.rotation, mid.opacity, mid.width]).toEqual([15, 40, 2, 45, 0.5, 10]);
    expect(el.x).toBe(5);
    expect(animatedProperties(el)).toEqual(["x", "y", "scale", "rotation", "opacity"]);
    const plain = spec.elements[0];
    const still = { ...plain, keyframes: undefined } as SceneElement;
    expect(elementAtTime(still, 1)).toBe(still);
    // Overshooting curves never render opacity outside 0..1 or a negative scale.
    const bouncy = { type: "rect", keyframes: [kf("a", "opacity", 0, 0, "backOut"), kf("b", "opacity", 1, 1), kf("c", "scale", 0, 0.01, "spring"), kf("d", "scale", 1, 0)] } as SceneElement;
    for (let t = 0; t <= 1; t += 0.05) {
      const shown = elementAtTime(bouncy, t);
      expect(shown.opacity).toBeGreaterThanOrEqual(0);
      expect(shown.opacity).toBeLessThanOrEqual(1);
      expect(shown.scale).toBeGreaterThanOrEqual(0);
    }
  });

  it("only applies keyframes to properties the element's renderer places it by", () => {
    const line = { type: "line", from: [0, 0], to: [10, 10], keyframes: [kf("a", "x", 0, 90), kf("b", "opacity", 0, 0.25)] } as SceneElement;
    const shown = elementAtTime(line, 0);
    expect(shown.x).toBeUndefined();
    expect(shown.opacity).toBe(0.25);
    expect(animatedProperties(line)).toEqual(["opacity"]);
  });

  it("sorts once per keyframe list and resolves lists stored in any order", () => {
    expect(keyframeTracks(title.keyframes)).toBe(keyframeTracks(title.keyframes));
    const shuffled = { ...title, keyframes: [...title.keyframes!].reverse() };
    for (const t of [-1, 0.5, 1.7, 3.2, 5]) expect(valueAt(shuffled, "x", t)).toBe(valueAt(title, "x", t));
  });

  it("resolves the same value at the same instant whatever the frame rate — preview and render share it", () => {
    const appear = elementSpan(title, scene).appear;
    expect(appear).toBe(12);
    for (const sec of [11, 12, 12.5, 13, 14.25, 16, 21]) {
      const at30 = keyframeClockSec(sec * 30, 30, appear);
      const at60 = keyframeClockSec(sec * 60, 60, appear);
      expect(elementAtTime(title, at30)).toEqual(elementAtTime(title, at60));
      expect(elementAtTime(title, at30)).toEqual(elementAtTime(title, at30));
    }
    expect(elementAtTime(title, keyframeClockSec(13 * 30, 30, appear)).x).toBe(40);
  });
});

describe("keyframes in the scene spec", () => {
  const issues = (elements: unknown[]) => {
    const v = validateSceneSpec({ elements });
    return v.ok ? [] : v.issues.map((i) => i.path);
  };

  it("accepts valid keyframes and refuses ones the renderer can't apply", () => {
    expect(issues([{ type: "rect", keyframes: [kf("a", "x", 0, 10), kf("b", "x", 1, 20)] }])).toEqual([]);
    expect(issues([{ type: "line", from: [0, 0], to: [1, 1], keyframes: [kf("a", "x", 0, 10)] }])).toEqual(["elements.0.keyframes.0.property"]);
    expect(issues([{ type: "rect", keyframes: [kf("a", "x", 0, 10), kf("a", "y", 1, 20)] }])).toEqual(["elements.0.keyframes.1.id"]);
    expect(issues([{ type: "rect", keyframes: [kf("a", "x", 1, 10), kf("b", "x", 1.0002, 20)] }])).toEqual(["elements.0.keyframes.1.time"]);
    expect(issues([{ type: "rect", keyframes: [kf("a", "opacity", 0, 2)] }])).toEqual(["elements.0.keyframes.0.value"]);
  });
});

describe("editing animated properties", () => {
  it("turns an edit of an animated property at the playhead into a keyframe, leaving other properties' saved values", () => {
    const patch = keyframedPatch(title, { x: 70, y: 40 }, 1);
    expect(patch.y).toBe(40);
    expect(patch.x).toBeUndefined();
    const added = patch.keyframes!.filter((k) => k.property === "x");
    expect(added.map((k) => [k.time, k.value])).toEqual([
      [0, 20],
      [1, 70],
      [2, 60],
      [4, 80],
    ]);
    // At an existing keyframe (within the tolerance) that keyframe changes; a reset sets the default value there.
    const onKey = keyframedPatch(title, { x: 65 }, 2.0004, 0.001).keyframes!;
    expect(onKey.find((k) => k.id === "b")?.value).toBe(65);
    expect(onKey).toHaveLength(title.keyframes!.length);
    expect(keyframedPatch(title, { opacity: null }, 1).keyframes!.find((k) => k.id === "o1")?.value).toBe(1);
    // Nothing animated: the same patch.
    const plain = { x: 1 };
    expect(keyframedPatch({ ...title, keyframes: undefined } as SceneElement, plain, 1)).toBe(plain);
  });

  it("removes keyframes without a jump: a property left without keyframes keeps the value it had there", () => {
    const one = removeKeyframesPatch(title, ["b"], 2);
    expect(one.keyframes!.map((k) => k.id)).toEqual(["a", "c", "o1", "o2"]);
    expect(one.x).toBeUndefined();
    const allX = removeKeyframesPatch(title, ["a", "b", "c"], 3);
    expect(allX.x).toBe(70);
    expect(allX.opacity).toBeUndefined();
    const everything = removeKeyframesPatch(title, title.keyframes!.map((k) => k.id), 2);
    expect(everything.keyframes).toBeNull();
    expect([everything.x, everything.opacity]).toEqual([60, 0.5]);
    const next = applyElementPatch(title, everything, {});
    expect(next.keyframes).toBeUndefined();
    expect(elementAtTime(next, 9)).toMatchObject({ x: 60, opacity: 0.5 });
  });

  it("saves keyframes through the element patch: a list replaces the keyframes in stored order, null removes them", () => {
    const next = applyElementPatch(title, { keyframes: [kf("z", "opacity", 1, 1), kf("y", "x", 2, 2), kf("w", "x", 1, 1)] }, {});
    expect(next.keyframes!.map((k) => k.id)).toEqual(["w", "y", "z"]);
    expect(applyElementPatch(title, { keyframes: null }, {}).keyframes).toBeUndefined();
    expect(validateSceneSpec({ elements: [next] }).ok).toBe(true);
  });
});

describe("keyframes and element timing", () => {
  const retime = (change: { appear: number; gone: number }) => applyElementPatch(title, elementTimingPatch(title, scene, change), { sceneDurationSec: 10, segment: scene });

  it("go along when the element is moved", () => {
    const moved = retime({ appear: 11, gone: 19 });
    expect(elementSpan(moved, scene)).toMatchObject({ appear: 11, gone: 19 });
    expect(moved.keyframes).toEqual(title.keyframes);
    expect(atVideoSec(moved, scene, "x", 12)).toBe(atVideoSec(title, scene, "x", 13));
  });

  it("stay where they were in the scene when its start is trimmed, folding the ones before the new start", () => {
    const trimmed = retime({ appear: 13, gone: 20 });
    expect(elementSpan(trimmed, scene).appear).toBe(13);
    for (const sec of [13, 13.5, 14, 15.2, 16, 19]) {
      expect(atVideoSec(trimmed, scene, "x", sec)).toBeCloseTo(atVideoSec(title, scene, "x", sec), 9);
      expect(atVideoSec(trimmed, scene, "opacity", sec)).toBe(atVideoSec(title, scene, "opacity", sec));
    }
    expect(trimmed.keyframes!.filter((k) => k.property === "x").map((k) => [k.id, k.time, k.value])).toEqual([
      ["a", 0, 40],
      ["b", 1, 60],
      ["c", 3, 80],
    ]);
    expect(validateSceneSpec({ elements: [trimmed] }).ok).toBe(true);
  });

  it("fold into its end when its end is trimmed, so none are left where it isn't on screen", () => {
    const trimmed = retime({ appear: 12, gone: 15 });
    expect(trimmed.keyframes!.filter((k) => k.property === "x").map((k) => [k.time, k.value])).toEqual([
      [0, 20],
      [2, 60],
      [3, 70],
    ]);
    expect(Math.max(...trimmed.keyframes!.map((k) => k.time))).toBeLessThanOrEqual(3);
  });

  it("stay in place when a new entrance cue changes when it appears, and follow it when nothing is edited", () => {
    const cued = applyElementPatch(title, { cues: { enter: { type: "sceneTime", seconds: 3 } } }, { sceneDurationSec: 10, segment: scene });
    expect(atVideoSec(cued, scene, "x", 14)).toBeCloseTo(atVideoSec(title, scene, "x", 14), 9);
    expect(applyElementPatch(title, { cues: { enter: { type: "sceneTime", seconds: 3 } } }, { sceneDurationSec: 10 }).keyframes).toEqual(title.keyframes);
    expect(keyframesAfterRetime(title, title, scene)).toBe(title.keyframes);
  });

  it("report when folding cut an eased stretch", () => {
    expect(retimeKeyframes([kf("a", "x", 0, 0), kf("b", "x", 2, 100)], -1, 5).reshaped).toBe(false);
    const eased = retimeKeyframes([kf("a", "x", 0, 0, "easeIn"), kf("b", "x", 2, 100)], -1, 5);
    expect(eased.reshaped).toBe(true);
    expect(eased.keyframes.map((k) => [k.time, r3(num(k.value))])).toEqual([
      [0, 12.5],
      [1, 100],
    ]);
    // A keyframe exactly on the new edge is kept as it is.
    expect(retimeKeyframes([kf("a", "x", 0, 0), kf("b", "x", 2, 100), kf("c", "x", 3, 0)], 0, 2).keyframes.map((k) => k.id)).toEqual(["a", "b"]);
  });
});

describe("keyframes when elements and scenes are copied, split and merged", () => {
  it("duplicating an element copies its keyframes with new ids, offset like the copy", () => {
    const { spec: next, copies } = duplicateElements(spec, [{ shotId: null, index: 0 }], { x: 2, y: 3 });
    const copy = next.elements[copies[0].index];
    expect(copy.keyframes).not.toBe(title.keyframes);
    expect(copy.keyframes!.map((k) => [k.property, k.time, k.value])).toEqual(title.keyframes!.map((k) => [k.property, k.time, k.property === "x" ? num(k.value) + 2 : k.value]));
    expect(copy.keyframes!.some((k) => title.keyframes!.some((o) => o.id === k.id))).toBe(false);
    copy.keyframes!.push(kf("new", "y", 1, 1));
    expect(title.keyframes).toHaveLength(5);
    expect(validateSceneSpec(next).ok).toBe(true);
  });

  it("duplicating a scene keeps every keyframe at its moment with new ids", () => {
    const { spec: copy } = copySceneSpec(spec, { start: 10, end: 20 }, { start: 30, end: 40 }, []);
    const el = copy.elements[0];
    const target: TriggerContext = { words: [], sceneStart: 30, sceneEnd: 40 };
    expect(el.keyframes!.map((k) => [k.property, k.time, k.value])).toEqual(title.keyframes!.map((k) => [k.property, k.time, k.value]));
    expect(el.keyframes!.some((k) => title.keyframes!.some((o) => o.id === k.id))).toBe(false);
    for (const t of [0, 1.5, 3.3, 6]) expect(atVideoSec(el, target, "x", 32 + t)).toBeCloseTo(atVideoSec(title, scene, "x", 12 + t), 9);
  });

  it("splitting keeps keyframes before the cut in the first part and moves the rest to the second, with the same motion", () => {
    const { first, second, notes } = splitSceneSpec(spec, { start: 10, end: 20 }, 15, { words: [] });
    const a = first.elements[0];
    const b = second.elements[0];
    const firstScene: TriggerContext = { words: [], sceneStart: 10, sceneEnd: 15 };
    const secondScene: TriggerContext = { words: [], sceneStart: 15, sceneEnd: 20 };
    expect(a.keyframes!.filter((k) => k.property === "x").map((k) => [k.time, k.value])).toEqual([
      [0, 20],
      [2, 60],
      [3, 70],
    ]);
    // The keyframe on the cut (opacity at 3 s after it appears) ends the first part and starts the second.
    expect(a.keyframes!.filter((k) => k.property === "opacity").map((k) => k.time)).toEqual([1, 3]);
    expect(b.keyframes!.filter((k) => k.property === "x").map((k) => [k.time, k.value])).toEqual([
      [0, 70],
      [1, 80],
    ]);
    expect(b.keyframes!.filter((k) => k.property === "opacity").map((k) => [k.time, k.value])).toEqual([[0, 1]]);
    for (const sec of [12, 12.5, 14, 14.9]) for (const p of ["x", "opacity"] as const) expect(atVideoSec(a, firstScene, p, sec)).toBeCloseTo(atVideoSec(title, scene, p, sec), 9);
    for (const sec of [15, 15.5, 16, 19]) for (const p of ["x", "opacity"] as const) expect(atVideoSec(b, secondScene, p, sec)).toBeCloseTo(atVideoSec(title, scene, p, sec), 9);
    expect(b.keyframes!.some((k) => a.keyframes!.some((o) => o.id === k.id))).toBe(false);
    expect(notes.some((n) => n.includes("Keyframed"))).toBe(false);
    expect(validateSceneSpec(first).ok && validateSceneSpec(second).ok).toBe(true);
  });

  it("merging keeps both scenes' keyframes at their moments with unique ids", () => {
    const other: SceneSpec = SceneSpecSchema.parse({
      elements: [{ id: "title", type: "text", text: "Next", enter: { type: "fade", at: { type: "sceneTime", seconds: 1 } }, keyframes: [kf("a", "scale", 0, 1), kf("b", "scale", 2, 1.5, "easeOut")] }],
    });
    const { spec: merged } = mergeSceneSpecs({ key: "scene_01", spec, start: 10, end: 20 }, { key: "scene_02", spec: other, start: 20, end: 30 }, { words: [] });
    expect(validateSceneSpec(merged).ok).toBe(true);
    const [shotA, shotB] = merged.shots!;
    const mergedCtx: TriggerContext = { words: [], sceneStart: 10, sceneEnd: 30 };
    const inA = { ...mergedCtx, shotStart: 10, shotEnd: 20 };
    const inB = { ...mergedCtx, shotStart: 20, shotEnd: 30 };
    const otherCtx: TriggerContext = { words: [], sceneStart: 20, sceneEnd: 30 };
    for (const sec of [12, 13.3, 17]) expect(atVideoSec(shotA.elements[0], inA, "x", sec)).toBe(atVideoSec(title, scene, "x", sec));
    for (const sec of [21, 22, 23.5]) expect(atVideoSec(shotB.elements[0], inB, "scale", sec)).toBe(atVideoSec(other.elements[0], otherCtx, "scale", sec));
    const ids = [...shotA.elements, ...shotB.elements].flatMap((el) => el.keyframes!.map((k) => k.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
