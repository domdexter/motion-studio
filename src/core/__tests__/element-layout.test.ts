import { describe, expect, it } from "vitest";
import type { SceneSpec } from "../spec/scene";
import { angleDelta, detectScenePlacement, findElementAt, layoutBoxPx, moveLayout, pointerAngle, removeElementAt, replaceElementAt, resizeLayout, scenePlacementLayout, snapRotation, snapTargets } from "../timeline/element-layout";

const frame = { width: 1920, height: 1080 };
const size = { width: 960, height: 540 };

describe("element layout", () => {
  it("lays out placement presets and keeps the media's aspect ratio in boxed ones", () => {
    expect(scenePlacementLayout("background", frame, 16 / 9)).toEqual({ x: 50, y: 50, width: 100, height: 100, z: -50 });
    expect(scenePlacementLayout("fullscreen", frame, 16 / 9).z).toBe(50);
    expect(scenePlacementLayout("framed", frame, 16 / 9)).toEqual({ x: 50, y: 50, width: 66, z: 5 });
    expect(scenePlacementLayout("framed", frame, 0.5)).toEqual({ x: 50, y: 50, height: 70, z: 5 });
    expect(scenePlacementLayout("pip", frame, 16 / 9)).toEqual({ x: 80, y: 74, width: 30, z: 10 });
    expect(scenePlacementLayout("pip", { width: 1080, height: 1920 }, 16 / 9)).toMatchObject({ x: 72, y: 80 });
  });

  it("recognises a preset and reports hand-placed media as custom", () => {
    expect(detectScenePlacement({ x: 50, y: 50, width: 66, z: 5 }, frame, 16 / 9)).toBe("framed");
    expect(detectScenePlacement({ x: 50, y: 50, width: 100, height: 100, z: -50 }, frame, 16 / 9)).toBe("background");
    expect(detectScenePlacement({ x: 50, y: 50, width: 100, height: 100, z: 50 }, frame, 16 / 9)).toBe("fullscreen");
    expect(detectScenePlacement({ x: 30, y: 50, width: 66 }, frame, 16 / 9)).toBeNull();
    expect(detectScenePlacement({ x: 50, y: 50, width: 66, rotation: 5 }, frame, 16 / 9)).toBeNull();
  });

  it("measures the layout box from the anchor", () => {
    expect(layoutBoxPx({ x: 50, y: 50 }, size, frame)).toEqual({ left: 480, top: 270, width: 960, height: 540 });
    expect(layoutBoxPx({ x: 10, y: 10, anchor: "top-left" }, size, frame)).toMatchObject({ left: 192, top: 108 });
  });

  it("moves by frame pixels and snaps the centre to the frame's centre lines", () => {
    expect(moveLayout({ x: 50, y: 50 }, size, frame, 192, -108)).toMatchObject({ x: 60, y: 40, guides: { vertical: false, horizontal: false } });
    expect(moveLayout({ x: 50, y: 50 }, size, frame, 5, -4, 8)).toMatchObject({ x: 50, y: 50, guides: { vertical: true, horizontal: true } });
    expect(moveLayout({ x: 10, y: 10, anchor: "top-left" }, size, frame, 96, 0)).toMatchObject({ x: 15, y: 10 });
  });

  it("resizes from a corner with the opposite corner fixed", () => {
    expect(resizeLayout({ x: 50, y: 50 }, size, frame, "se", 192, 108, { keepAspect: true })).toMatchObject({ x: 55, y: 55, width: 60, height: 60 });
    expect(resizeLayout({ x: 50, y: 50 }, size, frame, "nw", -192, -108, { keepAspect: true })).toMatchObject({ x: 45, y: 45, width: 60, height: 60 });
    expect(resizeLayout({ x: 50, y: 50 }, size, frame, "se", 192, 0, { keepAspect: false })).toMatchObject({ x: 55, y: 50, width: 60, height: 50 });
    const tiny = resizeLayout({ x: 50, y: 50 }, size, frame, "se", -2000, -2000, { keepAspect: true });
    expect(tiny.box.height).toBeCloseTo(16);
    expect(tiny.box.width / tiny.box.height).toBeCloseTo(16 / 9);
  });

  it("snaps edges and centres to other elements and to the frame's edges", () => {
    const targets = snapTargets(frame, [{ left: 100, top: 100, width: 200, height: 100 }]);
    // The moved box's left edge lands 3 px right of the other box's right edge (300).
    const beside = moveLayout({ x: 50, y: 50 }, size, frame, 303 - 480, 0, 8, targets);
    expect(beside.box.left).toBe(300);
    expect(beside.lines).toContainEqual({ axis: "x", pos: 300, start: 100, end: 810 });
    expect(moveLayout({ x: 50, y: 50 }, size, frame, -476, 200, 8, targets).box.left).toBe(0);
    expect(moveLayout({ x: 50, y: 50 }, size, frame, 50, 100, 8, targets).lines).toEqual([]);
  });

  it("snaps a dragged edge while resizing", () => {
    const r = resizeLayout({ x: 50, y: 50 }, size, frame, "se", 477, 0, { keepAspect: false, snap: { targets: snapTargets(frame), threshold: 8 } });
    expect(r.box.width).toBe(1440);
    expect(r.lines).toContainEqual(expect.objectContaining({ axis: "x", pos: 1920 }));
    const proportional = resizeLayout({ x: 50, y: 50 }, size, frame, "se", 477, 268, { keepAspect: true, snap: { targets: snapTargets(frame), threshold: 8 } });
    expect(proportional.box.width + proportional.box.left).toBeCloseTo(1920);
    expect(proportional.box.width / proportional.box.height).toBeCloseTo(16 / 9);
  });

  it("measures pointer angles and snaps rotation", () => {
    expect(pointerAngle({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(0);
    expect(pointerAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90);
    expect(angleDelta(170, -170)).toBeCloseTo(20);
    expect(snapRotation(37, { step: 15 })).toBe(30);
    expect(snapRotation(88.5, { magnet: 3 })).toBe(90);
    expect(snapRotation(12.34)).toBe(12.3);
  });

  it("finds, replaces and removes elements in the scene or in a shot", () => {
    const spec = {
      version: 1,
      elements: [{ type: "text", text: "A" }],
      shots: [{ id: "b", elements: [{ type: "text", text: "B1" }, { type: "text", text: "B2" }] }],
    } as unknown as SceneSpec;
    expect(findElementAt(spec, { shotId: "b", index: 1 })).toMatchObject({ text: "B2" });
    expect(findElementAt(spec, { shotId: null, index: 3 })).toBeNull();
    const replaced = replaceElementAt(spec, { shotId: "b", index: 0 }, { type: "text", text: "X" } as SceneSpec["elements"][number]);
    expect(findElementAt(replaced, { shotId: "b", index: 0 })).toMatchObject({ text: "X" });
    expect(findElementAt(replaced, { shotId: null, index: 0 })).toMatchObject({ text: "A" });
    expect(removeElementAt(spec, { shotId: "b", index: 0 }).shots?.[0].elements).toHaveLength(1);
    expect(removeElementAt(spec, { shotId: null, index: 0 }).elements).toHaveLength(0);
  });
});
