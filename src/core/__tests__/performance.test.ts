import { describe, expect, it } from "vitest";
import { elementAtTime } from "../motion/keyframes";
import { collectSceneEvents } from "../spec/triggers";
import { allSpecElements, validateSceneSpec, type SceneElement, type SceneSpec } from "../spec/scene";

/**
 * Phase 11 — the per-frame budget. Everything the renderer does for one frame of a heavy scene runs
 * here: each element resolved on its own clock (keyframes, curves, motion paths, effects). The budgets
 * are deliberately loose — they are a guard against a change that makes this path an order of magnitude
 * more expensive, not a benchmark. On the machine this was written on a frame costs ~0.07 ms.
 */

const COLORS = ["#38BDF8", "#F472B6", "#FBBF24", "#34D399"];
const CURVES = [{ bezier: [0.16, 1, 0.3, 1] }, { bezier: [0.45, 0, 0.2, 1] }, "easeInOut", "spring"] as const;

/** The stress scene: 24 animated shapes, 8 travellers on motion paths, a group of labels. */
function stressScene(): SceneSpec {
  const elements: SceneElement[] = [];
  for (let i = 0; i < 24; i++) {
    const y = 24 + Math.floor(i / 8) * 18;
    elements.push({
      id: `cell_${i + 1}`,
      type: i % 3 === 0 ? "circle" : "rect",
      fill: true,
      color: COLORS[i % COLORS.length],
      ...(i % 3 === 0 ? { size: 70 } : { width: 8, height: 10 }),
      x: 10 + (i % 8) * 11.4,
      y,
      ...(i % 7 === 0 ? { effects: { glow: 18 } } : {}),
      ...(i % 5 === 0 ? { clip: { type: "rect", reveal: "up", progress: 1 } } : {}),
      keyframes: [
        { id: `k${i}a`, property: "y", time: 0, value: y, easing: CURVES[i % CURVES.length] },
        { id: `k${i}b`, property: "y", time: 1.4, value: y - 6, easing: "easeInOut" },
        { id: `k${i}c`, property: "y", time: 2.8, value: y },
        { id: `k${i}d`, property: "rotation", time: 0, value: 0 },
        { id: `k${i}e`, property: "rotation", time: 3.2, value: 180 },
        { id: `k${i}f`, property: "opacity", time: 0, value: 0.45 },
        { id: `k${i}g`, property: "opacity", time: 1.6, value: 1 },
      ],
    } as SceneElement);
  }
  for (let i = 0; i < 8; i++) {
    elements.push({
      id: `path_${i + 1}`,
      type: "circle",
      fill: true,
      color: COLORS[i % COLORS.length],
      size: 34,
      x: 8,
      y: 62 + (i % 4) * 8,
      motionPath: { type: "quadratic", from: [8, 62], to: [92, 52], c1: [50, 28], orient: i % 2 === 0 },
      pathProgress: 0,
      keyframes: [
        { id: `p${i}a`, property: "pathProgress", time: 0, value: 0, easing: CURVES[i % CURVES.length] },
        { id: `p${i}b`, property: "pathProgress", time: 3, value: 1 },
        { id: `p${i}c`, property: "scaleX", time: 0, value: 1 },
        { id: `p${i}d`, property: "scaleX", time: 1.5, value: 1.6 },
      ],
    } as SceneElement);
  }
  elements.push({
    id: "labels",
    type: "group",
    children: Array.from({ length: 4 }, (_, i) => ({
      id: `label_${i + 1}`,
      type: "text",
      text: `label ${i + 1}`,
      x: 20 + i * 20,
      y: 94,
      keyframes: [
        { id: `l${i}a`, property: "letterSpacing", time: 0, value: 0.2 },
        { id: `l${i}b`, property: "letterSpacing", time: 1.2, value: 0 },
      ],
    })),
    keyframes: [
      { id: "gx1", property: "x", time: 0, value: 46, easing: { bezier: [0.16, 1, 0.3, 1] } },
      { id: "gx2", property: "x", time: 2, value: 50 },
    ],
  } as SceneElement);
  return { version: 1, elements };
}

const spec = stressScene();

describe("per-frame budget", () => {
  it("is a valid scene of the size a heavy project reaches", () => {
    const result = validateSceneSpec(spec);
    expect(result.ok).toBe(true);
    const all = allSpecElements(spec);
    // 24 shapes + 8 travellers + a group of 4 labels.
    expect(all.length).toBe(37);
    expect(all.reduce((n, e) => n + (e.element.keyframes?.length ?? 0), 0)).toBeGreaterThanOrEqual(200);
  });

  it("resolves every element of a frame well inside one frame's time", () => {
    const elements = allSpecElements(spec).map((e) => e.element);
    // Warm the per-list caches (keyframe tracks, arc-length tables), as playback does.
    for (const el of elements) elementAtTime(el, 0);
    const started = performance.now();
    const frames = 90;
    for (let f = 0; f < frames; f++) for (const el of elements) elementAtTime(el, f / 30);
    const perFrame = (performance.now() - started) / frames;
    expect(perFrame).toBeLessThan(4);
  });

  it("collects the timeline's events of a heavy scene quickly", () => {
    const ctx = { words: [], sceneStart: 0, sceneEnd: 6 };
    collectSceneEvents(spec, ctx);
    const started = performance.now();
    for (let i = 0; i < 50; i++) collectSceneEvents(spec, ctx);
    expect((performance.now() - started) / 50).toBeLessThan(6);
  });
});
