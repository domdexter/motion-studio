import { describe, expect, it } from "vitest";
import type { SceneSpec } from "../spec/scene";
import { alignShifts, applyLayers, arrangeLayers, distributeShifts, duplicateElements, removeElements, unionBox, uniqueElementId } from "../timeline/element-ops";

const spec = (elements: object[], shots?: object[]) => ({ version: 1, elements, ...(shots ? { shots } : {}) }) as unknown as SceneSpec;
const text = (id: string, extra: object = {}) => ({ type: "text", id, text: id, ...extra });
const at = (index: number, shotId: string | null = null) => ({ shotId, index });
/** Ids bottom → top, the way the engine draws the list. */
const stack = (s: SceneSpec) =>
  s.elements
    .map((e, i) => ({ id: e.id, z: e.z ?? 0, i }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((e) => e.id);

describe("element ops", () => {
  it("names copies with the next free id", () => {
    expect(uniqueElementId("title", new Set(["title"]))).toBe("title_2");
    expect(uniqueElementId("video_1", new Set(["video_1", "video_2"]))).toBe("video_3");
  });

  it("duplicates elements right above their originals with new ids and an offset", () => {
    const zoom = { id: "z1", startSec: 0, endSec: 1, rect: { x: 0, y: 0, size: 0.5 }, toRect: null, easeSec: 0.5 };
    const s = spec([text("a", { x: 10, y: 20 }), { type: "image", id: "image_1", assetId: "ast_1", zooms: [zoom] }, text("b")]);
    const { spec: next, copies } = duplicateElements(s, [at(0), at(1)], { x: 2, y: 3 });
    expect(next.elements.map((e) => e.id)).toEqual(["a", "a_2", "image_1", "image_2", "b"]);
    expect(copies).toEqual([at(1), at(3)]);
    expect(next.elements[1]).toMatchObject({ x: 12, y: 23, text: "a" });
    expect(next.elements[3]).toMatchObject({ assetId: "ast_1", x: 52, y: 53, zooms: [zoom] });
    expect(next.elements[3]).not.toBe(s.elements[1]);
  });

  it("moves a duplicated line's points and a cursor's path", () => {
    const s = spec([{ type: "line", from: [10, 10], to: [20, 30] }, { type: "cursor", path: [{ x: 5, y: 5, at: { type: "sceneStart" } }] }]);
    const { spec: next } = duplicateElements(s, [at(0), at(1)], { x: 1, y: 1 });
    expect(next.elements[1]).toMatchObject({ from: [11, 11], to: [21, 31] });
    expect(next.elements[3]).toMatchObject({ path: [{ x: 6, y: 6 }] });
  });

  it("removes several elements from the scene and its shots at once", () => {
    const s = spec([text("a"), text("b"), text("c")], [{ id: "s1", elements: [text("d"), text("e")] }]);
    const next = removeElements(s, [at(0), at(2), at(1, "s1")]);
    expect(next.elements.map((e) => e.id)).toEqual(["b"]);
    expect(next.shots?.[0].elements.map((e) => e.id)).toEqual(["d"]);
  });

  it("brings layers to the front keeping their order among themselves", () => {
    // C at the bottom, then B, A on top (same layer, list order).
    const s = spec([text("C"), text("B"), text("A")]);
    const front = applyLayers(s, arrangeLayers(s, [at(0), at(2)], "front"));
    expect(stack(front)).toEqual(["B", "C", "A"]);
    expect(front.elements[1].z).toBeUndefined();
  });

  it("sends to the back and moves one step forward or backward", () => {
    const s = spec([text("a"), text("b"), text("c"), text("d")]);
    expect(stack(applyLayers(s, arrangeLayers(s, [at(3)], "back")))).toEqual(["d", "a", "b", "c"]);
    expect(stack(applyLayers(s, arrangeLayers(s, [at(0)], "forward")))).toEqual(["b", "a", "c", "d"]);
    expect(stack(applyLayers(s, arrangeLayers(s, [at(2)], "backward")))).toEqual(["a", "c", "b", "d"]);
    expect(stack(applyLayers(s, arrangeLayers(s, [at(1), at(2)], "forward")))).toEqual(["a", "d", "b", "c"]);
    expect(arrangeLayers(s, [at(3)], "front").size).toBe(0);
  });

  it("keeps scene-level elements on their side of the shots", () => {
    const s = spec([text("bg1", { z: -50 }), text("bg2", { z: -40 }), text("title")], [{ id: "s1", elements: [text("x")] }]);
    const changes = arrangeLayers(s, [at(0)], "front");
    expect(changes.get(":0")).toBeGreaterThan(-40);
    expect(changes.get(":0")).toBeLessThan(0);
  });

  it("aligns boxes and spaces them evenly", () => {
    const boxes = [
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 30, top: 5, width: 20, height: 10 },
      { left: 100, top: 50, width: 10, height: 30 },
    ];
    const bounds = unionBox(boxes);
    expect(bounds).toEqual({ left: 0, top: 0, width: 110, height: 80 });
    expect(alignShifts(boxes, "right", bounds).map((s) => s.dx)).toEqual([100, 60, 0]);
    expect(alignShifts(boxes, "vcenter", bounds).map((s) => s.dy)).toEqual([35, 30, -25]);
    expect(distributeShifts(boxes, "horizontal").map((s) => s.dx)).toEqual([0, 15, 0]);
    expect(distributeShifts(boxes.slice(0, 2), "vertical")).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
  });
});
