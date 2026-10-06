import { Easing } from "remotion";
import { describe, expect, it } from "vitest";
import { formatColor, mixOklab, mixSrgb, parseColor } from "../motion/color";
import { bezierForEasing, cubicBezier, describeEasing, ease, easingFunction, isCustomEasing } from "../motion/easing";
import { applyMotionPath, elementAtTime, isAnimatedElement, setKeyframe, trackValueAt, valueAt } from "../motion/keyframes";
import { midpoint, offsetPath, pathAsType, pathAt, pathData, pathLength, pathPointAt, straightPath } from "../motion/path";
import { INTERPOLATIONS, VALUE_TYPES, mixValues } from "../motion/values";
import { animatableProperty } from "../spec/animatable";
import { SceneSpecSchema, type Keyframe, type MotionPath, type SceneElement } from "../spec/scene";
import type { TriggerContext } from "../spec/triggers";
import { duplicateElements } from "../timeline/element-ops";
import { copySceneSpec, elementSpan, splitSceneSpec } from "../timeline/scene-restructure";
import { applyElementPatch } from "../timeline/spec-patch";

/**
 * Advanced motion: custom Bézier curves, the value types and their interpolation strategies, and motion
 * paths. Everything here is what both the editor and the renderer run — they call these functions, so a
 * curve or a path that resolves to a value in these tests resolves to the same value on screen.
 */

const kf = (id: string, property: string, time: number, value: unknown, easing?: unknown): Keyframe => ({ id, property, time, value, ...(easing ? { easing } : {}) }) as Keyframe;
const num = (v: unknown) => Number(v);
const scene: TriggerContext = { words: [], sceneStart: 0, sceneEnd: 10 };

describe("custom Bézier easing", () => {
  it("is the same solver the named curves use", () => {
    const custom = { bezier: [0.2, 0.9, 0.1, 1] as [number, number, number, number] };
    const direct = cubicBezier(0.2, 0.9, 0.1, 1);
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) expect(ease(custom, t)).toBeCloseTo(direct(t), 10);
    // `snappy` is that same curve by name, so a custom copy of it renders identically.
    for (const t of [0.15, 0.5, 0.85]) expect(ease(custom, t)).toBeCloseTo(ease("snappy", t), 10);
  });

  it("matches Remotion's own bezier easing", () => {
    const remotion = Easing.bezier(0.33, 1, 0.68, 1);
    const ours = easingFunction({ bezier: [0.33, 1, 0.68, 1] });
    for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) expect(ours(t)).toBeCloseTo(remotion(t), 6);
  });

  it("starts and ends where the keyframes do, and may overshoot in between", () => {
    const overshoot = easingFunction({ bezier: [0.34, 1.8, 0.64, 1] });
    expect(overshoot(0)).toBe(0);
    expect(overshoot(1)).toBe(1);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => overshoot(i / 49)))).toBeGreaterThan(1);
  });

  it("resolves the same value every time it is asked (the curve is cached, not rebuilt)", () => {
    const first = Array.from({ length: 20 }, (_, i) => ease({ bezier: [0.2, 0.9, 0.1, 1] }, i / 19));
    const second = Array.from({ length: 20 }, (_, i) => ease({ bezier: [0.2, 0.9, 0.1, 1] }, i / 19));
    expect(second).toEqual(first);
  });

  it("names, describes and seeds curves for the editor", () => {
    expect(isCustomEasing({ bezier: [0, 0, 1, 1] })).toBe(true);
    expect(isCustomEasing("easeOut")).toBe(false);
    expect(describeEasing(undefined)).toBe("linear");
    expect(describeEasing("easeOut")).toBe("easeOut");
    expect(describeEasing({ bezier: [0.2, 0.9, 0.1, 1] })).toBe("custom(0.2, 0.9, 0.1, 1)");
    expect(bezierForEasing("snappy")).toEqual([0.2, 0.9, 0.1, 1]);
    expect(bezierForEasing({ bezier: [0.1, 0.2, 0.3, 0.4] })).toEqual([0.1, 0.2, 0.3, 0.4]);
    // `hold` has no curve of its own, so editing one starts from a straight line.
    expect(bezierForEasing("hold")).toEqual([0, 0, 1, 1]);
  });

  it("is stored, validated and resolved on a keyframe", () => {
    const spec = SceneSpecSchema.safeParse({
      elements: [{ id: "t", type: "text", text: "Hi", keyframes: [kf("a", "x", 0, 0, { bezier: [0.2, 0.9, 0.1, 1] }), kf("b", "x", 1, 100)] }],
    });
    expect(spec.success).toBe(true);
    const element = spec.data!.elements[0];
    expect(num(valueAt(element, "x", 0.5))).toBeCloseTo(ease({ bezier: [0.2, 0.9, 0.1, 1] }, 0.5) * 100, 6);
    // Time can't run backwards: x outside 0..1 is refused.
    expect(SceneSpecSchema.safeParse({ elements: [{ type: "text", text: "Hi", keyframes: [kf("a", "x", 0, 0, { bezier: [1.4, 0, 0.2, 1] })] }] }).success).toBe(false);
  });

  it("gives neighbouring stretches their own curves", () => {
    const keys = [kf("a", "x", 0, 0, { bezier: [0.9, 0, 1, 0.2] }), kf("b", "x", 1, 50, "linear"), kf("c", "x", 2, 100)];
    // The first stretch starts slowly (its curve), the second runs straight.
    expect(num(trackValueAt(keys, 0.25))).toBeLessThan(12.5);
    expect(num(trackValueAt(keys, 1.5))).toBeCloseTo(75, 6);
    // Editing the first stretch's curve leaves the second alone.
    expect(num(trackValueAt(keys, 1.5))).toBe(num(trackValueAt([kf("a", "x", 0, 0, "linear"), keys[1], keys[2]], 1.5)));
  });
});

describe("value types and interpolation strategies", () => {
  it("mixes numbers, colours and points, each by its own strategy", () => {
    expect(mixValues(animatableProperty("x"), 0, 10, 0.25)).toBe(2.5);
    expect(mixValues(animatableProperty("pivot"), [0, 0], [10, 20], 0.5)).toEqual([5, 10]);
    // Halfway between black and white is an even mid grey (perceptually, not by channel value).
    const half = parseColor(mixValues(animatableProperty("color"), "#000000", "#FFFFFF", 0.5) as string)!;
    expect(half.r).toBeGreaterThan(70);
    expect(half.r).toBeLessThan(180);
    expect(half.r).toBe(half.g);
  });

  it("keeps a colour's ends exact and blends through OKLab in between", () => {
    expect(mixOklab("#FF0000", "#0000FF", 0)).toBe("#FF0000");
    expect(mixOklab("#FF0000", "#0000FF", 1)).toBe("#0000FF");
    const mid = parseColor(mixOklab("#FF0000", "#0000FF", 0.5))!;
    // A perceptual blend keeps some colour rather than dipping through grey.
    expect(Math.max(mid.r, mid.b)).toBeGreaterThan(120);
    expect(mid.g).toBeLessThan(120);
  });

  it("parses the colours the schema accepts", () => {
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor("rgba(10, 20, 30, 0.5)")!.a).toBe(0.5);
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("primary")).toBeNull();
    expect(formatColor({ r: 255, g: 136, b: 0, a: 1 })).toBe("#FF8800");
    expect(formatColor({ r: 255, g: 136, b: 0, a: 0.5 })).toBe("rgba(255, 136, 0, 0.5)");
  });

  it("keeps the renderer's own sRGB blend unchanged", () => {
    expect(mixSrgb("#000000", "#FFFFFF", 0.5)).toBe("rgb(128, 128, 128)");
    expect(mixSrgb("primary", "#FFFFFF", 0.5)).toBeNull();
  });

  it("checks, clamps and writes values through the value type, not the property name", () => {
    const color = animatableProperty("color");
    expect(VALUE_TYPES.color.is("#FFFFFF")).toBe(true);
    expect(VALUE_TYPES.color.is("primary")).toBe(false);
    expect(VALUE_TYPES.point.issue([1, 2], animatableProperty("pivot"))).toBeNull();
    expect(VALUE_TYPES.color.format("#ff0000", color)).toBe("#FF0000");
    expect(Object.keys(INTERPOLATIONS)).toEqual(["number", "oklab", "point"]);
  });

  it("animates a colour and a point over time", () => {
    const spec = SceneSpecSchema.parse({
      elements: [
        { id: "t", type: "text", text: "Hi", color: "#FF0000", keyframes: [kf("c1", "color", 0, "#FF0000"), kf("c2", "color", 1, "#00FF00")] },
        { type: "line", from: [10, 10], to: [20, 20], keyframes: [kf("p1", "to", 0, [20, 20]), kf("p2", "to", 2, [80, 60])] },
      ],
    });
    const text = spec.elements[0];
    expect(valueAt(text, "color", 0)).toBe("#FF0000");
    expect(valueAt(text, "color", 1)).toBe("#00FF00");
    expect((elementAtTime(text, 0.5) as SceneElement & { color?: string }).color).not.toBe("#FF0000");
    const line = spec.elements[1] as SceneElement & { to: [number, number] };
    expect(valueAt(line, "to", 1)).toEqual([50, 40]);
    expect((elementAtTime(line, 1) as typeof line).to).toEqual([50, 40]);
  });

  it("writes a nested style field without touching the element's saved style", () => {
    const spec = SceneSpecSchema.parse({
      elements: [{ id: "c", type: "card", title: "Hi", style: { blur: 10, radius: 20 }, keyframes: [kf("b1", "blur", 0, 10), kf("b2", "blur", 1, 40)] }],
    });
    const card = spec.elements[0];
    const at = elementAtTime(card, 0.5);
    expect(at.style?.blur).toBe(25);
    expect(at.style?.radius).toBe(20);
    expect(card.style?.blur).toBe(10);
  });
});

describe("motion paths", () => {
  const straight: MotionPath = { type: "linear", from: [10, 50], to: [90, 50] };
  const curved: MotionPath = { type: "quadratic", from: [10, 80], to: [90, 80], c1: [50, 10] };
  const s: MotionPath = { type: "cubic", from: [10, 80], to: [90, 80], c1: [30, 10], c2: [70, 90] };

  it("starts at the start, ends at the end, whatever its shape", () => {
    for (const path of [straight, curved, s]) {
      expect(pathPointAt(path, 0)).toEqual(path.from);
      expect(pathPointAt(path, 1)).toEqual(path.to);
      // Progress outside 0..1 is held at the ends.
      expect(pathPointAt(path, -1)).toEqual(path.from);
      expect(pathPointAt(path, 2)).toEqual(path.to);
    }
  });

  it("moves at an even speed along the curve, not by its parameter", () => {
    const steps = Array.from({ length: 11 }, (_, i) => pathPointAt(s, i / 10));
    const distances = steps.slice(1).map((p, i) => Math.hypot(p[0] - steps[i][0], p[1] - steps[i][1]));
    const longest = Math.max(...distances);
    const shortest = Math.min(...distances);
    // Equal progress steps cover nearly equal distance (a parameter walk would vary far more).
    expect(longest / shortest).toBeLessThan(1.25);
    expect(pathLength(straight)).toBeCloseTo(80, 6);
    expect(pathLength(curved)).toBeGreaterThan(80);
  });

  it("knows which way the curve is heading", () => {
    expect(pathAt(straight, 0.5).angle).toBeCloseTo(0, 6);
    expect(pathAt({ type: "linear", from: [50, 10], to: [50, 90] }, 0.5).angle).toBeCloseTo(90, 6);
    // A rising curve heads up at its start and down at its end.
    expect(pathAt(curved, 0.05).angle).toBeLessThan(0);
    expect(pathAt(curved, 0.95).angle).toBeGreaterThan(0);
  });

  it("places an element on its path instead of at its x/y", () => {
    const element = { type: "text", text: "Hi", x: 5, y: 5, motionPath: straight, pathProgress: 0.5 } as unknown as SceneElement;
    const placed = applyMotionPath(element);
    expect([placed.x, placed.y]).toEqual([50, 50]);
    expect(placed.rotation).toBeUndefined();
    expect(isAnimatedElement(element)).toBe(true);
  });

  it("turns with the path when asked, adding to its own rotation", () => {
    const down: MotionPath = { type: "linear", from: [50, 10], to: [50, 90], orient: true };
    const plain = applyMotionPath({ type: "text", text: "Hi", motionPath: down, pathProgress: 0.5 } as unknown as SceneElement);
    expect(plain.rotation).toBeCloseTo(90, 6);
    const turned = applyMotionPath({ type: "text", text: "Hi", rotation: 15, motionPath: down, pathProgress: 0.5 } as unknown as SceneElement);
    expect(turned.rotation).toBeCloseTo(105, 6);
    // Without `orient` the element keeps exactly the rotation it was given.
    expect(applyMotionPath({ type: "text", text: "Hi", rotation: 15, motionPath: { ...down, orient: undefined }, pathProgress: 0.5 } as unknown as SceneElement).rotation).toBe(15);
  });

  it("travels the path from keyframed progress, through the same resolution the renderer uses", () => {
    const spec = SceneSpecSchema.parse({
      elements: [{ id: "t", type: "text", text: "Hi", motionPath: straight, keyframes: [kf("p1", "pathProgress", 0, 0), kf("p2", "pathProgress", 2, 1)] }],
    });
    const element = spec.elements[0];
    expect([elementAtTime(element, 0).x, elementAtTime(element, 0).y]).toEqual([10, 50]);
    expect(elementAtTime(element, 1).x).toBeCloseTo(50, 6);
    expect(elementAtTime(element, 2).x).toBeCloseTo(90, 6);
    // Halfway in time is halfway along the path: progress is linear here.
    expect(num(valueAt(element, "pathProgress", 1))).toBeCloseTo(0.5, 6);
  });

  it("is kept by copies, and moves with a duplicated element", () => {
    const spec = SceneSpecSchema.parse({ elements: [{ id: "t", type: "text", text: "Hi", motionPath: curved, keyframes: [kf("p1", "pathProgress", 0, 0), kf("p2", "pathProgress", 1, 1)] }] });
    const { spec: next, copies } = duplicateElements(spec, [{ shotId: null, index: 0 }], { x: 5, y: 3 });
    const copy = next.elements[copies[0].index];
    expect(copy.motionPath).toEqual(offsetPath(curved, 5, 3));
    expect(copy.motionPath).not.toBe(curved);
    // A copied scene keeps the path exactly where it was.
    expect(copySceneSpec(spec, { start: 0, end: 10 }, { start: 20, end: 30 }, []).spec.elements[0].motionPath).toEqual(curved);
  });

  it("survives a scene split with the rest of the element", () => {
    const withPath = SceneSpecSchema.parse({ elements: [{ id: "t", type: "text", text: "Hi", motionPath: straight, keyframes: [kf("p1", "pathProgress", 0, 0), kf("p2", "pathProgress", 4, 1)] }] });
    const split = splitSceneSpec(withPath, { start: 0, end: 6 }, 3, scene);
    for (const part of [split.first, split.second]) expect(part.elements[0].motionPath).toEqual(straight);
  });

  it("changes shape without moving its ends", () => {
    for (const type of ["linear", "quadratic", "cubic"] as const) {
      const next = pathAsType(curved, type);
      expect(next.type).toBe(type);
      expect(next.from).toEqual(curved.from);
      expect(next.to).toEqual(curved.to);
    }
    // A cubic made from a quadratic draws the same curve.
    const asCubic = pathAsType(curved, "cubic");
    for (const p of [0.25, 0.5, 0.75]) {
      const a = pathPointAt(curved, p);
      const b = pathPointAt(asCubic, p);
      expect(b[0]).toBeCloseTo(a[0], 4);
      expect(b[1]).toBeCloseTo(a[1], 4);
    }
    expect(midpoint([0, 0], [10, 20])).toEqual([5, 10]);
    expect(straightPath([1, 2], [3, 4])).toEqual({ type: "linear", from: [1, 2], to: [3, 4] });
  });

  it("draws itself for the canvas without any DOM", () => {
    expect(pathData(straight)).toBe("M10.00,50.00 L90.00,50.00");
    expect(pathData(curved, 2, 2)).toBe("M20.00,160.00 Q100.00,20.00 180.00,160.00");
    expect(pathData(s).startsWith("M10.00,80.00 C")).toBe(true);
  });

  it("is saved and removed through the element patch", () => {
    const element = SceneSpecSchema.parse({ elements: [{ id: "t", type: "text", text: "Hi" }] }).elements[0];
    const withPath = applyElementPatch(element, { motionPath: curved, pathProgress: 0.5 }, {});
    expect(withPath.motionPath).toEqual(curved);
    expect(withPath.pathProgress).toBe(0.5);
    expect(applyElementPatch(withPath, { motionPath: null }, {}).motionPath).toBeUndefined();
  });
});

describe("the new transform properties reach the renderer", () => {
  it("keeps one-axis scale and a pivot on the element for the renderer to read", () => {
    const element = SceneSpecSchema.parse({ elements: [{ id: "t", type: "text", text: "Hi" }] }).elements[0];
    const squashed = applyElementPatch(element, { scaleX: 1.2, scaleY: 0.8, pivot: [50, 100] }, {});
    expect([squashed.scaleX, squashed.scaleY, squashed.pivot]).toEqual([1.2, 0.8, [50, 100]]);
    // The defaults are left off: a scale of 1 and a centred pivot are what the renderer does anyway.
    expect(applyElementPatch(squashed, { scaleX: 1, scaleY: 1, pivot: [50, 50] }, {})).not.toHaveProperty("scaleX");
  });

  it("animates them like any other property", () => {
    const spec = SceneSpecSchema.parse({
      elements: [{ id: "t", type: "text", text: "Hi", keyframes: [kf("a", "scaleY", 0, 1), kf("b", "scaleY", 1, 0.5), kf("c", "pivot", 0, [50, 100]), kf("d", "pivot", 1, [0, 0])] }],
    });
    const element = spec.elements[0];
    expect(num(valueAt(element, "scaleY", 0.5))).toBeCloseTo(0.75, 6);
    expect(valueAt(element, "pivot", 0.5)).toEqual([25, 50]);
    const at = elementAtTime(element, 0.5);
    expect(at.scaleY).toBeCloseTo(0.75, 6);
    expect(at.pivot).toEqual([25, 50]);
  });
});

describe("older projects keep working", () => {
  const legacy = {
    elements: [
      {
        id: "title",
        type: "text",
        text: "Keyframes",
        x: 30,
        enter: { type: "fade", at: { type: "sceneTime", seconds: 2 } },
        keyframes: [
          { id: "a", property: "x", time: 0, value: 20 },
          { id: "b", property: "x", time: 2, value: 60, easing: "easeOut" },
          { id: "o1", property: "opacity", time: 1, value: 0.5, easing: "hold" },
          { id: "o2", property: "opacity", time: 3, value: 1 },
        ],
      },
    ],
  };

  it("loads a spec written before custom curves, value types and paths", () => {
    const parsed = SceneSpecSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    const element = parsed.data!.elements[0];
    expect(element.motionPath).toBeUndefined();
    // The curve of a stretch is the earlier keyframe's, so "a" (no easing) runs straight to "b".
    expect(num(valueAt(element, "x", 1))).toBeCloseTo(40, 6);
    expect(num(valueAt(element, "x", 2))).toBe(60);
    // `hold` still steps, and the element resolves without any new field.
    expect(num(valueAt(element, "opacity", 2.9))).toBe(0.5);
    expect(num(valueAt(element, "opacity", 3))).toBe(1);
    expect(elementSpan(element, scene).appear).toBe(2);
  });

  it("adds a keyframe to it the same way it always did", () => {
    const element = SceneSpecSchema.parse(legacy).elements[0];
    const { keyframes } = setKeyframe(element.keyframes, { property: "x", time: 1, value: 44 }, 0.001);
    expect(keyframes.filter((k) => k.property === "x").map((k) => k.time)).toEqual([0, 1, 2]);
    // The new keyframe takes the curve of the stretch it splits, as before.
    expect(keyframes.find((k) => k.property === "x" && k.time === 1)?.easing).toBeUndefined();
  });
});
