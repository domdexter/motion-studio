import { describe, expect, it } from "vitest";
import { elementPropertyKeys, entrancesFor, usesStagger } from "../spec/element-properties";
import { validateSceneSpec, type SceneElement, type SceneSpec } from "../spec/scene";
import { MOTION_CUT_SEC } from "../timeline/element-layout";
import { DEFAULT_EXIT_SEC } from "../timeline/media-clip";
import { applyElementPatch, applySceneLookPatch, elementPatchKeys, SpecPatchError } from "../timeline/spec-patch";

const frame = { width: 1920, height: 1080 };
const ctx = { frame, sceneDurationSec: 6 };
const valid = (element: SceneElement) => validateSceneSpec({ elements: [element] }).ok;

describe("applyElementPatch", () => {
  const card: SceneElement = { type: "card", id: "c", title: "Plans", x: 40, style: { radius: 12, shadow: "soft" }, enter: { type: "rise", at: { type: "word", value: "plans" }, duration: 0.6 } };

  it("merges style keys, removes nulls and drops an empty style", () => {
    const next = applyElementPatch(card, { style: { radius: 24.456, glass: true, shadow: null } }, ctx);
    expect(next.style).toEqual({ radius: 24.46, glass: true });
    expect(applyElementPatch(next, { style: { radius: null, glass: null } }, ctx).style).toBeUndefined();
    expect(valid(next)).toBe(true);
  });

  it("sets and removes type properties, refusing fields that aren't properties of the type", () => {
    const next = applyElementPatch(card, { props: { body: "Monthly or yearly", variant: "glass", title: "Pricing" } }, ctx);
    expect(next).toMatchObject({ title: "Pricing", body: "Monthly or yearly", variant: "glass" });
    expect(applyElementPatch(next, { props: { body: null } }, ctx)).not.toHaveProperty("body");
    expect(() => applyElementPatch(card, { props: { x: 10 } }, ctx)).toThrow(SpecPatchError);
    const image: SceneElement = { type: "image", assetId: "ast_1" };
    expect(() => applyElementPatch(image, { props: { fit: "contain" } }, ctx)).toThrow(/fit/);
    expect(applyElementPatch(image, { props: { mask: "circle" } }, ctx)).toMatchObject({ mask: "circle" });
  });

  it("keeps the entrance cue while its settings change, and resets settings with null", () => {
    const next = applyElementPatch(card, { enter: { easing: "backOut", distance: 80, duration: null } }, ctx);
    expect(next.enter).toEqual({ type: "rise", at: { type: "word", value: "plans" }, easing: "backOut", distance: 80 });
    // "none" would ignore the cue, so a cued element becomes a cut.
    expect(applyElementPatch(card, { enter: { type: "none" } }, ctx).enter).toMatchObject({ type: "fade", duration: MOTION_CUT_SEC, at: { type: "word" } });
  });

  it("keeps the moment a timed exit is gone when its length changes (scene and shot times)", () => {
    const el: SceneElement = { type: "text", text: "Hi", exit: { type: "fade", duration: 0.4, at: { type: "sceneTime", seconds: 3.6 } } };
    expect(applyElementPatch(el, { exit: { duration: 1 } }, ctx).exit).toEqual({ type: "fade", duration: 1, at: { type: "sceneTime", seconds: 3 } });
    const shot: SceneElement = { ...el, exit: { type: "slideUp", duration: 0.5, at: { type: "shotTime", seconds: 1, offset: 0.5 } } };
    expect(applyElementPatch(shot, { exit: { duration: 1, easing: "expoOut" } }, ctx).exit).toEqual({ type: "slideUp", duration: 1, easing: "expoOut", at: { type: "shotTime", seconds: 0.5, offset: 0.5 } });
    expect(applyElementPatch(el, { exit: null }, ctx).exit).toEqual({ type: "fade", duration: MOTION_CUT_SEC, at: { type: "sceneTime", seconds: 3.96 } });
  });

  it("retimes an element with exact scene times and back to its scene or shot", () => {
    const el: SceneElement = { type: "text", text: "Hi", enter: { type: "rise", delay: 0.2, at: { type: "word", value: "hi" } } };
    const appear = applyElementPatch(el, { appearAt: 1.25 }, ctx);
    expect(appear.enter).toEqual({ type: "rise", at: { type: "sceneTime", seconds: 1.25 } });
    expect(applyElementPatch(appear, { appearAt: null }, ctx).enter).toEqual({ type: "rise" });
    expect(() => applyElementPatch(el, { appearAt: 6 }, ctx)).toThrow(/before its scene ends/);
    expect(() => applyElementPatch(el, { appearAt: 1 }, { frame })).toThrow(SpecPatchError);

    // Leaving early without an exit animation cuts; staying to the end removes that cut again.
    const gone = applyElementPatch(el, { disappearAt: 4 }, ctx);
    expect(gone.exit).toEqual({ type: "fade", duration: MOTION_CUT_SEC, at: { type: "sceneTime", seconds: 3.96 } });
    expect(applyElementPatch(gone, { disappearAt: null }, ctx).exit).toBeUndefined();
    const animated: SceneElement = { ...el, exit: { type: "blur", duration: 0.5, at: { type: "sceneTime", seconds: 2 } } };
    expect(applyElementPatch(animated, { disappearAt: null }, ctx).exit).toEqual({ type: "blur", duration: 0.5 });
    expect(applyElementPatch({ type: "text", text: "Hi" }, { appearAt: 1, disappearAt: 1.5 }, ctx).exit).toEqual({ type: "fade", duration: MOTION_CUT_SEC, at: { type: "sceneTime", seconds: 1.46 } });
    expect(() => applyElementPatch(el, { appearAt: 2, disappearAt: 2.05 }, ctx)).toThrow(/after it appears/);
  });

  it("resets transform fields to the renderer defaults", () => {
    const el: SceneElement = { type: "badge", text: "New", x: 20, y: 30, anchor: "top-left", rotation: 12, scale: 1.4, opacity: 0.5, z: 3 };
    const next = applyElementPatch(el, { x: null, y: null, anchor: null, rotation: null, scale: null, opacity: null, z: null }, ctx);
    expect(next).toEqual({ type: "badge", text: "New" });
    expect(applyElementPatch(el, { anchor: "center", scale: 1, opacity: 1, z: 0 }, ctx)).toEqual({ type: "badge", text: "New", x: 20, y: 30, rotation: 12 });
  });

  it("applies placement presets with the inserted-media look, only to media", () => {
    const image: SceneElement = { type: "image", assetId: "ast_1", rotation: 20, style: { borderColor: "primary" } };
    const framed = applyElementPatch(image, { placement: "framed" }, { frame, assetAspect: 16 / 9 });
    expect(framed).toMatchObject({ radius: 24, style: { borderColor: "primary", shadow: "deep" } });
    expect(framed).not.toHaveProperty("rotation");
    const full = applyElementPatch(framed, { placement: "fullscreen" }, { frame, assetAspect: 16 / 9 });
    expect(full).not.toHaveProperty("radius");
    expect(full.style).toEqual({ borderColor: "primary" });
    expect(() => applyElementPatch(card, { placement: "pip" }, ctx)).toThrow(/images and videos/);
    expect(() => applyElementPatch(image, { placement: "pip" }, {})).toThrow(/frame size/);
  });

  it("lists the fields a patch changes", () => {
    expect(elementPatchKeys({ x: 1, style: { radius: 2 }, props: { text: "a", size: 3 }, enter: { type: "fade" } })).toEqual(["x", "style.radius", "props.text", "props.size", "enter"]);
  });
});

describe("element properties", () => {
  it("separates type properties from layout, motion and media-service fields", () => {
    expect(elementPropertyKeys("text")).toEqual(expect.arrayContaining(["text", "size", "font", "highlight"]));
    expect(elementPropertyKeys("text")).not.toEqual(expect.arrayContaining(["x"]));
    expect(elementPropertyKeys("image").sort()).toEqual(["kenBurns", "mask", "radius"]);
    expect(elementPropertyKeys("video")).toEqual(["radius"]);
  });

  it("offers entrances the renderer plays for the type", () => {
    expect(entrancesFor("text")).toEqual(expect.arrayContaining(["typewriter", "wordReveal", "fade"]));
    expect(entrancesFor("rect")).toContain("draw");
    expect(entrancesFor("rect")).not.toContain("typewriter");
    expect(entrancesFor("image")).not.toEqual(expect.arrayContaining(["draw"]));
    expect(usesStagger({ type: "text", text: "a", enter: { type: "wordReveal" } })).toBe(true);
    expect(usesStagger({ type: "text", text: "a", enter: { type: "fade" } })).toBe(false);
    expect(usesStagger({ type: "list", items: [{ text: "a" }] })).toBe(true);
  });
});

describe("applySceneLookPatch", () => {
  const spec: SceneSpec = { elements: [], transitionIn: { type: "slide", direction: "up" }, camera: { type: "pushIn", amount: 0.04 }, motion: { density: "high" } };

  it("merges the transition, or follows the design default with null", () => {
    expect(applySceneLookPatch(spec, { transitionIn: { type: "wipe", duration: 0.6 } }).transitionIn).toEqual({ type: "wipe", direction: "up", duration: 0.6 });
    expect(applySceneLookPatch(spec, { transitionIn: { direction: null } }).transitionIn).toEqual({ type: "slide" });
    expect(applySceneLookPatch(spec, { transitionIn: null })).not.toHaveProperty("transitionIn");
    expect(() => applySceneLookPatch({ elements: [] }, { transitionIn: { duration: 0.5 } })).toThrow(SpecPatchError);
  });

  it("removes a static camera and an unset density", () => {
    expect(applySceneLookPatch(spec, { camera: { amount: 0.1 } }).camera).toEqual({ type: "pushIn", amount: 0.1 });
    expect(applySceneLookPatch(spec, { camera: { type: "static" } })).not.toHaveProperty("camera");
    const next = applySceneLookPatch(spec, { density: null });
    expect(next).not.toHaveProperty("motion");
    expect(validateSceneSpec(applySceneLookPatch(spec, { density: "peak", camera: { type: "drift" } })).ok).toBe(true);
  });

  it("keeps defaults exported for the inspector", () => {
    expect(DEFAULT_EXIT_SEC).toBeGreaterThan(0);
  });
});
