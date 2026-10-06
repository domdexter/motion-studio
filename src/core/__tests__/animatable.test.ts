import { describe, expect, it } from "vitest";
import { elementAtTime, valueAt } from "../motion/keyframes";
import { INTERPOLATIONS, VALUE_TYPES } from "../motion/values";
import {
  ANIMATABLE_PROPERTIES,
  DEFAULT_DEPTH,
  KEYFRAME_PROPERTIES,
  animatableProperty,
  availableProperties,
  clampPropertyValue,
  findKeyframeProperty,
  formatPropertyValue,
  keyframePropertiesFor,
  propertyDefault,
  propertyForPatch,
  propertySupportIssue,
  propertyValueIssue,
  renderPropertyValue,
  supportsKeyframeProperty,
} from "../spec/animatable";
import { STYLE_SUPPORT, sizeModesOfType } from "../spec/element-properties";
import { ELEMENT_TYPES, KEYFRAME_EASINGS, SceneSpecSchema, type ElementType } from "../spec/scene";

/**
 * The animatable property registry — the single description of what can be keyframed. These tests pin
 * the metadata every other system reads (schema, resolver, inspector, timeline, CLI, renderer), check
 * each element-support list against the rule it stands for, and check that properties which aren't
 * enabled stay invisible everywhere.
 */

const ENABLED = ANIMATABLE_PROPERTIES.filter((p) => p.status === "enabled");
const PLANNED = ANIMATABLE_PROPERTIES.filter((p) => p.status === "planned");
/** Phase 4's rule: lines and cursors are placed by their points and a grid fills the frame. */
const UNPLACED: ElementType[] = ["line", "cursor", "grid"];

const textWith = (keyframes: object[]): object => ({ id: "t", type: "text", text: "Hi", keyframes });

describe("registry", () => {
  it("describes the properties Motion Studio animates, in the editor's order", () => {
    expect(KEYFRAME_PROPERTIES).toEqual([
      // Transform and path
      "x", "y", "scale", "scaleX", "scaleY", "rotation", "pivot", "rotateX", "rotateY", "depth", "width", "height", "pathProgress",
      // Appearance and typography
      "opacity", "color", "background", "radius", "borderWidth", "strokeWidth", "blur", "size", "letterSpacing", "from", "to",
      // Compositing
      "effectBlur", "glow", "glowColor", "shadowX", "shadowY", "shadowBlur", "shadowColor", "brightness", "contrast", "saturate", "clipProgress",
    ]);
    expect(ENABLED.map((p) => p.id)).toEqual([...KEYFRAME_PROPERTIES]);
  });

  it("gives every property a unique id, and looks it up", () => {
    const ids = ANIMATABLE_PROPERTIES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of KEYFRAME_PROPERTIES) {
      expect(animatableProperty(id).id).toBe(id);
      expect(findKeyframeProperty(id)?.id).toBe(id);
    }
    expect(findKeyframeProperty("nope")).toBeNull();
  });

  it("keeps each definition's metadata consistent", () => {
    for (const p of ANIMATABLE_PROPERTIES) {
      expect(p.label.length, p.id).toBeGreaterThan(0);
      expect(p.short.length, p.id).toBeGreaterThan(0);
      expect(p.description.length, p.id).toBeGreaterThan(0);
      expect(p.field.length, p.id).toBeGreaterThan(0);
      expect(VALUE_TYPES[p.value], p.id).toBeTruthy();
      expect(INTERPOLATIONS[p.interpolation], p.id).toBeTruthy();
      expect(KEYFRAME_EASINGS, p.id).toContain(p.defaultEasing);
      expect(["element", "props", "style", "effects", "clip"], p.id).toContain(p.patchIn);
      // A nested field belongs to one of the element's own objects; everything else is a plain field or a prop.
      expect(p.field.includes("."), p.id).toBe(p.patchIn === "style" || p.patchIn === "effects" || p.patchIn === "clip");
      if (p.field.includes(".")) expect(p.field.split(".")[0], p.id).toBe(p.patchIn);
      if (p.value === "number" || p.value === "point") {
        expect(p.range, p.id).toBeTruthy();
        expect(p.range![0], p.id).toBeLessThan(p.range![1]);
        if (p.renderRange) {
          expect(p.renderRange[0], p.id).toBeLessThanOrEqual(p.range![0]);
          expect(p.renderRange[1], p.id).toBeGreaterThanOrEqual(p.range![1]);
        }
        if (typeof p.defaultValue === "number") {
          expect(p.defaultValue, p.id).toBeGreaterThanOrEqual(p.range![0]);
          expect(p.defaultValue, p.id).toBeLessThanOrEqual(p.range![1]);
        }
      }
      expect(p.precision, p.id).toBeGreaterThanOrEqual(0);
      expect(p.display.factor, p.id).toBeGreaterThan(0);
      if (p.editing) expect(p.editing.step, p.id).toBeGreaterThan(0);
    }
  });

  it("covers the three value types, each with its own strategy", () => {
    const byType = (value: string) => ENABLED.filter((p) => p.value === value).map((p) => p.id);
    expect(byType("color")).toEqual(["color", "background", "glowColor", "shadowColor"]);
    expect(byType("point")).toEqual(["pivot", "from", "to"]);
    expect(byType("number").length).toBe(ENABLED.length - 7);
    expect(new Set(ENABLED.map((p) => p.interpolation))).toEqual(new Set(["number", "oklab", "point"]));
  });

  it("carries the ranges, units and defaults the editor and the schema use", () => {
    expect(ENABLED.filter((p) => ["x", "scale", "opacity", "pathProgress"].includes(p.id)).map((p) => [p.id, p.range, p.unit, p.defaultValue])).toEqual([
      ["x", [-100, 200], "percentOfFrame", 50],
      ["scale", [0, 20], "multiplier", 1],
      ["pathProgress", [0, 1], "fraction", 0],
      ["opacity", [0, 1], "fraction", 1],
    ]);
    expect(propertyDefault("pivot")).toEqual([50, 50]);
    // A flat element: no tilt, seen from the default distance.
    expect(propertyDefault("rotateX")).toBe(0);
    expect(propertyDefault("depth")).toBe(DEFAULT_DEPTH);
    // Properties whose default comes from the design system say so, and read it when one is given.
    expect(animatableProperty("radius").designDefault).toBe("radius");
    expect(propertyDefault("radius", { shape: { radius: 18, borderWidth: 2, shadow: "soft" } } as never)).toBe(18);
  });

  it("says how the editor shows and edits each property", () => {
    for (const p of ENABLED) {
      expect(p.editing, p.id).not.toBeNull();
      expect(p.timeline, p.id).toBe(true);
    }
    expect(animatableProperty("opacity").editing?.kind).toBe("slider");
    expect(animatableProperty("x").editing).toEqual({ kind: "scrub", step: 0.1 });
    expect(animatableProperty("color").editing?.kind).toBe("color");
    expect(animatableProperty("pivot").editing?.kind).toBe("point");
    // A keyframe may scale from nothing; the element's own scale may not.
    expect(animatableProperty("scale").editing).toEqual({ kind: "scrub", step: 0.01, staticRange: [0.05, 20], staticMin: 0.01 });
  });

  it("knows which control edits which property, for the inspector's own bindings", () => {
    expect(propertyForPatch("props", "radius")?.id).toBe("radius");
    expect(propertyForPatch("style", "blur")?.id).toBe("blur");
    expect(propertyForPatch("style", "background")?.id).toBe("background");
    expect(propertyForPatch("props", "text")).toBeNull();
  });
});

describe("element support", () => {
  it("keeps Phase 4's rule for x and y on every element type", () => {
    for (const type of ELEMENT_TYPES) {
      const has = keyframePropertiesFor(type);
      expect(has.includes("x"), type).toBe(!UNPLACED.includes(type));
      expect(has.includes("y"), type).toBe(!UNPLACED.includes(type));
      // Scale, rotation, the 3D tilt and opacity animate on everything, as before.
      for (const id of ["scale", "rotation", "rotateX", "rotateY", "depth", "opacity"] as const) expect(has, `${id} on ${type}`).toContain(id);
    }
  });

  it("offers width and height only where the renderer reads them", () => {
    for (const type of ELEMENT_TYPES) {
      const modes = sizeModesOfType(type);
      expect(keyframePropertiesFor(type).includes("width"), `width on ${type}`).toBe(modes.includes("box") || modes.includes("width"));
      expect(keyframePropertiesFor(type).includes("height"), `height on ${type}`).toBe(modes.includes("box"));
    }
    // Text sizes itself from its content and wraps at a max width, so animating its box is not offered.
    expect(keyframePropertiesFor("text")).not.toContain("width");
  });

  it("offers style properties only where that style key is honoured", () => {
    for (const type of ELEMENT_TYPES) {
      const style = STYLE_SUPPORT[type];
      for (const id of ["blur", "borderWidth", "background"] as const) {
        const key = id === "background" ? "background" : id;
        if (keyframePropertiesFor(type).includes(id)) expect(style, `${id} on ${type}`).toContain(key);
      }
    }
    expect(keyframePropertiesFor("card")).toContain("blur");
    expect(keyframePropertiesFor("text")).not.toContain("blur");
  });

  it("offers each type only the properties its own renderer reads", () => {
    const compositing = ENABLED.filter((p) => p.category === "compositing").map((p) => p.id);
    // Compositing applies to the whole element, so every type has it; the rest is what the renderer reads.
    expect(keyframePropertiesFor("line")).toEqual(
      ["scale", "scaleX", "scaleY", "rotation", "pivot", "rotateX", "rotateY", "depth", "opacity", "color", "strokeWidth", "from", "to", ...compositing].sort((a, b) => KEYFRAME_PROPERTIES.indexOf(a as never) - KEYFRAME_PROPERTIES.indexOf(b as never)),
    );
    expect(keyframePropertiesFor("text")).toContain("letterSpacing");
    expect(keyframePropertiesFor("badge")).toContain("size");
    expect(keyframePropertiesFor("text")).not.toContain("size");
    expect(keyframePropertiesFor("cursor")).toEqual(["scale", "scaleX", "scaleY", "rotation", "pivot", "rotateX", "rotateY", "depth", "opacity", ...compositing]);
  });

  it("answers whether a type supports a property, and why not", () => {
    expect(supportsKeyframeProperty("text", "x")).toBe(true);
    expect(supportsKeyframeProperty("cursor", "x")).toBe(false);
    expect(supportsKeyframeProperty("text", "weight")).toBe(false);
    expect(propertySupportIssue("text", "x")).toBeNull();
    expect(propertySupportIssue("cursor", "x")).toContain("cursor elements can't keyframe x");
  });

  it("hides path progress until the element has a path", () => {
    expect(keyframePropertiesFor("text")).toContain("pathProgress");
    expect(availableProperties({ type: "text" })).not.toContain("pathProgress");
    expect(availableProperties({ type: "text", motionPath: { type: "linear", from: [0, 0], to: [1, 1] } })).toContain("pathProgress");
    // The same rule for the clip reveal: it needs a clip.
    expect(availableProperties({ type: "text" })).not.toContain("clipProgress");
    expect(availableProperties({ type: "text", clip: { type: "rect", reveal: "right" } })).toContain("clipProgress");
  });

  it("returns the same list each time (it is read per frame)", () => {
    expect(keyframePropertiesFor("text")).toBe(keyframePropertiesFor("text"));
  });
});

describe("values", () => {
  it("clamps and rounds a stored value to the property's range and precision", () => {
    expect(clampPropertyValue("x", 55.386)).toBe(55.39);
    expect(clampPropertyValue("x", -300)).toBe(-100);
    expect(clampPropertyValue("scale", 0.82661)).toBe(0.827);
    expect(clampPropertyValue("opacity", 1.4)).toBe(1);
    expect(clampPropertyValue("pivot", [120.44, -300])).toEqual([120.4, -100]);
    expect(clampPropertyValue("color", "#ff8800")).toBe("#FF8800");
  });

  it("clamps a resolved value only where the renderer needs it", () => {
    expect(renderPropertyValue("opacity", 1.08)).toBe(1);
    expect(renderPropertyValue("scale", -0.5)).toBe(0);
    expect(renderPropertyValue("pathProgress", 1.4)).toBe(1);
    // An eased x may overshoot as far as it likes — it is only a position.
    expect(renderPropertyValue("x", 260)).toBe(260);
  });

  it("says why a value can't be stored, in its own value type's words", () => {
    expect(propertyValueIssue("opacity", 0.5)).toBeNull();
    expect(propertyValueIssue("opacity", 50)).toBe("opacity keyframes take values from 0 to 1");
    expect(propertyValueIssue("x", Number.NaN)).toBe("x keyframes take a number");
    expect(propertyValueIssue("color", "#123456")).toBeNull();
    expect(propertyValueIssue("color", "primary")).toContain("can't be blended");
    expect(propertyValueIssue("color", 4)).toBe("color keyframes take a color");
    expect(propertyValueIssue("pivot", [10, 20])).toBeNull();
    expect(propertyValueIssue("pivot", 10)).toBe("pivot keyframes take a point, [x, y]");
    expect(propertyValueIssue("from", [10, 900])).toContain("take points from");
  });

  it("formats a value in its display units for the inspector, the timeline and the CLI", () => {
    expect(formatPropertyValue("opacity", 0.5)).toBe("50%");
    expect(formatPropertyValue("x", 55.38)).toBe("55.38%");
    expect(formatPropertyValue("scale", 0.8)).toBe("0.8×");
    expect(formatPropertyValue("rotation", 20)).toBe("20°");
    expect(formatPropertyValue("pathProgress", 0.25)).toBe("25%");
    expect(formatPropertyValue("color", "#aabbcc")).toBe("#AABBCC");
    expect(formatPropertyValue("pivot", [50, 25])).toBe("50, 25%");
    // `exact` keeps every stored decimal (the CLI lists them).
    expect(formatPropertyValue("opacity", 0.555, true)).toBe("55.5%");
    expect(formatPropertyValue("scale", 0.825, true)).toBe("0.825×");
  });
});

describe("the keyframe system reads the registry", () => {
  const spec = SceneSpecSchema.parse({
    elements: [
      {
        id: "t",
        type: "text",
        text: "Hi",
        keyframes: [
          { id: "a", property: "x", time: 0, value: 20 },
          { id: "b", property: "x", time: 2, value: 60, easing: "backOut" },
          { id: "c", property: "x", time: 4, value: 80 },
          { id: "o1", property: "opacity", time: 0, value: 0.2, easing: "backOut" },
          { id: "o2", property: "opacity", time: 2, value: 1 },
        ],
      },
    ],
  });
  const element = spec.elements[0];

  it("interpolates with the property's strategy", () => {
    expect(valueAt(element, "x", 1)).toBeCloseTo(INTERPOLATIONS.number(20 as never, 60 as never, 0.5) as number, 6);
  });

  it("clamps what it resolves with the property's render range", () => {
    const overshoot = Array.from({ length: 40 }, (_, i) => Number(valueAt(element, "opacity", (i / 40) * 2)));
    expect(Math.max(...overshoot)).toBeLessThanOrEqual(1);
    expect(Math.max(...Array.from({ length: 40 }, (_, i) => Number(valueAt(element, "x", 2 + (i / 40) * 2))))).toBeGreaterThan(80);
  });

  it("resolves into the element field the registry names", () => {
    const at = elementAtTime(element, 1);
    expect(at.x).toBeCloseTo(Number(valueAt(element, "x", 1)), 6);
    expect((at as { opacity?: number }).opacity).toBeCloseTo(Number(valueAt(element, "opacity", 1)), 6);
    expect(at.keyframes).toBe(element.keyframes);
  });

  it("validates against the registry's element support and ranges", () => {
    const outOfRange = SceneSpecSchema.safeParse({ elements: [textWith([{ id: "a", property: "opacity", time: 0, value: 8 }])] });
    expect(outOfRange.success).toBe(false);
    expect(outOfRange.error?.issues[0].message).toBe("opacity keyframes take values from 0 to 1");

    const unsupported = SceneSpecSchema.safeParse({ elements: [{ id: "g", type: "grid", keyframes: [{ id: "a", property: "x", time: 0, value: 20 }] }] });
    expect(unsupported.success).toBe(false);
    expect(unsupported.error?.issues[0].message).toContain("grid elements can't keyframe x");

    // A colour keyframe takes a literal colour, not a design token that can't be blended.
    expect(SceneSpecSchema.safeParse({ elements: [textWith([{ id: "a", property: "color", time: 0, value: "#FF0000" }])] }).success).toBe(true);
    expect(SceneSpecSchema.safeParse({ elements: [textWith([{ id: "a", property: "color", time: 0, value: "primary" }])] }).success).toBe(false);
    // A point keyframe on a line.
    expect(SceneSpecSchema.safeParse({ elements: [{ type: "line", from: [10, 10], to: [40, 40], keyframes: [{ id: "a", property: "to", time: 0, value: [80, 20] }] }] }).success).toBe(true);
  });
});

describe("properties that aren't enabled", () => {
  it("are described with a reason, and nothing offers them", () => {
    expect(PLANNED.map((p) => p.id)).toEqual(["weight"]);
    for (const p of PLANNED) {
      expect(p.blocked, p.id).toBeTruthy();
      expect(KEYFRAME_PROPERTIES as readonly string[], p.id).not.toContain(p.id);
      expect(findKeyframeProperty(p.id), p.id).toBeNull();
      for (const type of ELEMENT_TYPES) expect(keyframePropertiesFor(type) as readonly string[], `${p.id} on ${type}`).not.toContain(p.id);
    }
  });

  it("can't be stored", () => {
    expect(SceneSpecSchema.safeParse({ elements: [textWith([{ id: "a", property: "weight", time: 0, value: 700 }])] }).success).toBe(false);
  });
});

describe("no other module keeps its own list of animatable properties", () => {
  const sources = ["src/core/motion/keyframes.ts", "src/core/spec/scene.ts", "src/components/studio/scenes/editor/keyframe-fields.tsx", "src/components/studio/scenes/editor/keyframes-section.tsx", "src/components/studio/timeline/element-track-editor.tsx"];

  it("keeps property names, ranges and labels in the registry", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const file of sources) {
      const text = await readFile(new URL(`../../../${file}`, import.meta.url), "utf8");
      // A second list would read like ["x", "y", "scale"…] — the registry is the only place that spells them out.
      expect(text, file).not.toMatch(/"x",\s*"y",\s*"scale"/);
    }
  });
});
