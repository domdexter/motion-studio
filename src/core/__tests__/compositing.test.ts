import { describe, expect, it } from "vitest";
import { DESIGN_PRESETS } from "../design/presets";
import { elementAtTime, valueAt } from "../motion/keyframes";
import { allSpecElements, isGroup, validateSceneSpec, type SceneElement, type SceneSpec } from "../spec/scene";
import { listSceneMedia } from "../timeline/media-clip";
import { findElementAt, removeElementAt, replaceElementAt } from "../timeline/element-layout";
import { GroupError, groupElements, removeElements, ungroupElements } from "../timeline/element-ops";
import { retimeElement } from "../timeline/scene-restructure";
import { applyElementPatch } from "../timeline/spec-patch";
import { clipIsClosed, clipLayers, clipPath, effectFilter, hasEffects } from "../../remotion/engine/compositing";

/**
 * Phase 9 — compositing. The stack (effects, clip, blend) is one implementation shared by the canvas
 * and the renderer, and a group is an ordinary element that happens to hold others: these tests pin
 * what is drawn, what a patch stores, and that grouping never changes where anything is or when it
 * happens.
 */

const design = DESIGN_PRESETS[0].design;
const u = (n: number) => n * 2; // a 2160-px frame: design units are doubled

const text = (id: string, extra: Partial<SceneElement> = {}): SceneElement => ({ id, type: "text", text: "Hi", ...extra }) as SceneElement;
const spec = (elements: SceneElement[]): SceneSpec => ({ version: 1, elements });

describe("effects", () => {
  it("emits nothing for values that leave the element alone", () => {
    expect(effectFilter(undefined, u, design)).toBeUndefined();
    expect(effectFilter({}, u, design)).toBeUndefined();
    expect(effectFilter({ blur: 0, brightness: 1, contrast: 1, saturate: 1, shadowBlur: 0 }, u, design)).toBeUndefined();
    expect(hasEffects({ brightness: 1 })).toBe(false);
    expect(hasEffects({ brightness: 1.2 })).toBe(true);
  });

  it("applies colour first, then the shape effects that read the coloured pixels", () => {
    const filter = effectFilter({ blur: 4, brightness: 1.2, contrast: 0.9, saturate: 0, glow: 10, shadowX: 1, shadowY: 2, shadowBlur: 6 }, u, design);
    expect(filter).toBe(`blur(8px) brightness(1.2) contrast(0.9) saturate(0) drop-shadow(0 0 20px ${design.colors.primary}) drop-shadow(2px 4px 12px #000000)`);
  });

  it("scales lengths with the frame and takes the colours it is given", () => {
    expect(effectFilter({ glow: 12, glowColor: "#FF0000" }, (n) => n, design)).toBe("drop-shadow(0 0 12px #FF0000)");
    expect(effectFilter({ shadowBlur: 3, shadowColor: "rgba(0,0,0,0.5)" }, (n) => n, design)).toBe("drop-shadow(0px 0px 3px rgba(0,0,0,0.5))");
  });
});

describe("clip", () => {
  it("draws each shape from the element's own box", () => {
    expect(clipLayers({ type: "rect" })).toEqual(["inset(0% 0% 0% 0%)"]);
    expect(clipLayers({ type: "rect", inset: [10, 20, 10, 20], radius: 8 })).toEqual(["inset(10% 20% 10% 20% round 8%)"]);
    expect(clipLayers(undefined)).toEqual([]);
    expect(clipPath(undefined)).toBeUndefined();
  });

  it("keeps a round clip round on a box of any shape", () => {
    // A single circle() percentage resolves against the box diagonal, so the shape goes in its own layer.
    expect(clipLayers({ type: "circle" })).toEqual(["circle(closest-side at 50% 50%)"]);
    expect(clipLayers({ type: "ellipse" })).toEqual(["ellipse(50% 50% at 50% 50%)"]);
    expect(clipLayers({ type: "circle", inset: [0, 25, 0, 25] })).toEqual(["inset(0% 25% 0% 25%)", "circle(closest-side at 50% 50%)"]);
  });

  it("wipes open from the side the reveal names", () => {
    expect(clipPath({ type: "rect", reveal: "right", progress: 0 })).toBe("inset(0% 100% 0% 0%)");
    expect(clipPath({ type: "rect", reveal: "right", progress: 0.25 })).toBe("inset(0% 75% 0% 0%)");
    expect(clipPath({ type: "rect", reveal: "right", progress: 1 })).toBe("inset(0% 0% 0% 0%)");
    expect(clipPath({ type: "rect", reveal: "up", progress: 0.5 })).toBe("inset(50% 0% 0% 0%)");
    // Without a direction the progress means nothing: the shape is simply the shape.
    expect(clipPath({ type: "rect", progress: 0 })).toBe("inset(0% 0% 0% 0%)");
    expect(clipIsClosed({ type: "rect", reveal: "right", progress: 0 })).toBe(true);
    expect(clipIsClosed({ type: "rect", progress: 0 })).toBe(false);
  });
});

describe("compositing patches", () => {
  it("stores blend, effects and the clip, and removes them again", () => {
    const el = text("t");
    const blended = applyElementPatch(el, { blend: "multiply", effects: { glow: 20 }, clip: { type: "circle" } }, {});
    expect(blended.blend).toBe("multiply");
    expect(blended.effects).toEqual({ glow: 20 });
    expect(blended.clip).toEqual({ type: "circle" });
    // Effects merge key by key; a null key removes one, a null effects removes them all.
    const more = applyElementPatch(blended, { effects: { glowColor: "#FFFFFF", brightness: 1.4 } }, {});
    expect(more.effects).toEqual({ glow: 20, glowColor: "#FFFFFF", brightness: 1.4 });
    expect(applyElementPatch(more, { effects: { glow: null } }, {}).effects).toEqual({ glowColor: "#FFFFFF", brightness: 1.4 });
    expect(applyElementPatch(more, { effects: null, blend: "normal", clip: null }, {})).toEqual({ id: "t", type: "text", text: "Hi" });
  });

  it("makes a clip out of a reveal alone, and keeps the schema happy", () => {
    const el = applyElementPatch(text("t"), { clip: { reveal: "left", progress: 0.5 } }, {});
    expect(el.clip).toEqual({ type: "rect", reveal: "left", progress: 0.5 });
    expect(validateSceneSpec(spec([el])).ok).toBe(true);
  });
});

describe("animating compositing", () => {
  it("resolves effect keyframes into the nested field the renderer reads", () => {
    const el = text("t", {
      effects: { glow: 0 },
      keyframes: [
        { id: "a", property: "glow", time: 0, value: 0 },
        { id: "b", property: "glow", time: 1, value: 40 },
        { id: "c", property: "glowColor", time: 0, value: "#000000" },
        { id: "d", property: "glowColor", time: 1, value: "#FFFFFF" },
      ],
    });
    const half = elementAtTime(el, 0.5);
    expect(half.effects?.glow).toBe(20);
    // Colours blend perceptually, so the midpoint is not #808080.
    expect(half.effects?.glowColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(elementAtTime(el, 1).effects).toEqual({ glow: 40, glowColor: "#FFFFFF" });
    // Nothing else of the element is touched by writing a nested field.
    expect(elementAtTime(el, 1).id).toBe("t");
  });

  it("animates a clip reveal", () => {
    const el = text("t", {
      clip: { type: "rect", reveal: "right", progress: 0 },
      keyframes: [
        { id: "a", property: "clipProgress", time: 0, value: 0 },
        { id: "b", property: "clipProgress", time: 2, value: 1 },
      ],
    });
    expect(valueAt(el, "clipProgress", 1)).toBe(0.5);
    expect(clipPath(elementAtTime(el, 1).clip)).toBe("inset(0% 50% 0% 0%)");
  });

  it("refuses a keyframe the registry doesn't know on the element", () => {
    const bad = validateSceneSpec(spec([text("t", { keyframes: [{ id: "a", property: "nope" as never, time: 0, value: 1 }] })]));
    expect(bad.ok).toBe(false);
  });
});

describe("groups", () => {
  const two = () => spec([text("a", { x: 20, y: 30 }), text("b", { x: 60, y: 70, z: 3 }), text("c", { x: 80, y: 10 })]);

  it("puts elements into a group without moving anything", () => {
    const { spec: next, ref } = groupElements(two(), [{ shotId: null, index: 0 }, { shotId: null, index: 1 }]);
    const group = next.elements[ref.index];
    expect(isGroup(group)).toBe(true);
    if (!isGroup(group)) return;
    expect(group.children.map((c) => c.id)).toEqual(["a", "b"]);
    expect(group.children.map((c) => [c.x, c.y])).toEqual([
      [20, 30],
      [60, 70],
    ]);
    // It takes the place and the layer of the topmost member; the others are gone from the list.
    expect(group.z).toBe(3);
    expect(next.elements.map((e) => e.id)).toEqual([group.id, "c"]);
    expect(validateSceneSpec(next).ok).toBe(true);
  });

  it("refuses what it can't group", () => {
    const one = two();
    expect(() => groupElements(one, [{ shotId: null, index: 0 }])).toThrow(GroupError);
    const grouped = groupElements(one, [{ shotId: null, index: 0 }, { shotId: null, index: 1 }]).spec;
    expect(() => groupElements(grouped, [{ shotId: null, index: 0 }, { shotId: null, index: 1 }])).toThrow(/can't contain other groups/);
  });

  it("bakes what it can when a group is taken apart, and says what it dropped", () => {
    const grouped = groupElements(two(), [{ shotId: null, index: 0 }, { shotId: null, index: 1 }], { id: "g" }).spec;
    const moved = replaceElementAt(grouped, { shotId: null, index: 0 }, { ...grouped.elements[0], x: 60, y: 50, opacity: 0.5, rotation: 12 } as SceneElement);
    const { spec: next, refs, dropped } = ungroupElements(moved, { shotId: null, index: 0 });
    expect(next.elements.map((e) => e.id)).toEqual(["a", "b", "c"]);
    // The layer's offset and opacity belong to each child now; its rotation can't.
    expect([next.elements[0].x, next.elements[0].y]).toEqual([30, 30]);
    expect(next.elements[0].opacity).toBe(0.5);
    expect(dropped).toEqual(["rotation"]);
    expect(refs).toEqual([
      { shotId: null, index: 0 },
      { shotId: null, index: 1 },
    ]);
  });

  it("finds, replaces and removes an element inside a group", () => {
    const grouped = groupElements(two(), [{ shotId: null, index: 0 }, { shotId: null, index: 1 }], { id: "g" }).spec;
    const ref = { shotId: null, index: 0, child: 1 };
    expect(findElementAt(grouped, ref)?.id).toBe("b");
    const swapped = replaceElementAt(grouped, ref, text("b", { x: 1, y: 2 }));
    expect(findElementAt(swapped, ref)?.x).toBe(1);
    const without = removeElementAt(grouped, ref);
    const group = without.elements[0];
    expect(isGroup(group) && group.children.map((c) => c.id)).toEqual(["a"]);
    // Removing the last child removes the group with it.
    expect(removeElements(without, [{ shotId: null, index: 0, child: 0 }]).elements.map((e) => e.id)).toEqual(["c"]);
  });

  it("counts children as elements of the scene everywhere", () => {
    const grouped = groupElements(two(), [{ shotId: null, index: 0 }, { shotId: null, index: 1 }], { id: "g" }).spec;
    expect(allSpecElements(grouped).map((e) => e.element.id)).toEqual(["g", "a", "b", "c"]);
    expect(allSpecElements(grouped).find((e) => e.element.id === "b")).toMatchObject({ index: 0, child: 1 });
  });

  it("keeps media inside a group on the scene's media list", () => {
    const withVideo = spec([text("a"), { id: "v", type: "video", assetId: "ast_1" } as SceneElement]);
    const grouped = groupElements(withVideo, [{ shotId: null, index: 0 }, { shotId: null, index: 1 }], { id: "g" }).spec;
    const media = listSceneMedia(grouped, { words: [], sceneStart: 0, sceneEnd: 5 });
    expect(media).toHaveLength(1);
    expect(media[0].ref).toEqual({ shotId: null, index: 0, child: 1 });
  });

  it("retimes a group's children with it", () => {
    const grouped = groupElements(spec([text("a", { enter: { type: "fade", at: { type: "sceneTime", seconds: 2 } } }), text("b")]), [{ shotId: null, index: 0 }, { shotId: null, index: 1 }], { id: "g" }).spec;
    const group = grouped.elements[0];
    const retimed = retimeElement(group, { from: { words: [], sceneStart: 0, sceneEnd: 6 }, to: { words: [], sceneStart: 1, sceneEnd: 7 } });
    expect(isGroup(retimed)).toBe(true);
    if (!isGroup(retimed)) return;
    const enter = retimed.children[0].enter;
    // The moment stays where it was in the video (2s into a scene that now starts 1s later).
    expect(enter?.at).toMatchObject({ type: "sceneTime", seconds: 1 });
  });

  it("validates the keyframes of children the same way", () => {
    const grouped = groupElements(two(), [{ shotId: null, index: 0 }, { shotId: null, index: 1 }], { id: "g" }).spec;
    const withBad = replaceElementAt(grouped, { shotId: null, index: 0, child: 0 }, text("a", { keyframes: [{ id: "k", property: "opacity", time: 0, value: 4 }] }));
    const result = validateSceneSpec(withBad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].path).toContain("children");
  });
});
