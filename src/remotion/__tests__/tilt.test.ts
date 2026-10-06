import { describe, expect, it } from "vitest";
import { DEFAULT_DEPTH } from "../../core/spec/animatable";
import { DEFAULT_DESIGN } from "../../core/design/presets";
import type { SceneElement } from "../../core/spec/scene";
import type { SceneContextValue } from "../engine/context";
import { motionFor, motionStyle } from "../engine/animation";

/**
 * The 3D tilt: rotateX / rotateY turn a flat element in perspective, seen from `depth` away.
 * The tilt is part of the element (not an entrance), so it holds, keyframes and composes with
 * the 2D rotation and the scale.
 */

/** The few context fields motionFor reads, at a frame size (u scales design units to it). */
function ctx(width = 1080, height = 1920): SceneContextValue {
  return {
    fps: 30,
    width,
    height,
    u: (n: number) => (n * Math.min(width, height)) / 1080,
    design: DEFAULT_DESIGN,
    intensity: 1,
    designIntensity: 1,
    motionScale: { distance: 1, duration: 1, stagger: 1 },
    frames: (seconds: number) => Math.round(seconds * 30),
    frameAt: () => 0,
  } as unknown as SceneContextValue;
}

const card = (extra: Partial<SceneElement>): SceneElement => ({ id: "c", type: "rect", x: 50, y: 50, width: 60, height: 40, ...extra }) as SceneElement;

const transform = (el: SceneElement, frame = 60, c = ctx()) => String(motionStyle(motionFor(el, frame, c)).transform ?? "");

describe("3D tilt", () => {
  it("renders a tilt in perspective, seen from the default depth", () => {
    expect(transform(card({ rotateX: 18 }))).toBe(`perspective(${DEFAULT_DEPTH}px) rotateX(18deg)`);
    expect(transform(card({ rotateY: -24 }))).toBe(`perspective(${DEFAULT_DEPTH}px) rotateY(-24deg)`);
  });

  it("leaves a flat element flat — no perspective, nothing to compose", () => {
    expect(transform(card({}))).toBe("");
    // Depth on its own is not a transform: only a tilt reads it.
    expect(transform(card({ depth: 600 }))).toBe("");
  });

  it("takes the viewer's distance from depth, in design units", () => {
    expect(transform(card({ rotateX: 12, depth: 600 }))).toBe("perspective(600px) rotateX(12deg)");
    // Design units: the same depth is the same look on a larger frame.
    expect(transform(card({ rotateX: 12, depth: 600 }), 60, ctx(2560, 1440))).toBe("perspective(800px) rotateX(12deg)");
  });

  it("puts the perspective before the tilts, and the flat rotation and scale after them", () => {
    const style = transform(card({ rotateX: 10, rotateY: 20, rotation: 5, scale: 1.2 }));
    expect(style).toBe("perspective(1200px) rotateX(10deg) rotateY(20deg) rotate(5deg) scale(1.2)");
  });

  it("turns around the element's pivot, like the flat rotation", () => {
    expect(motionStyle(motionFor(card({ rotateY: 30, pivot: [0, 50] }), 60, ctx())).transformOrigin).toBe("0% 50%");
  });

  it("lets a flip entrance settle onto the element's own tilt", () => {
    const flipping = card({ rotateX: 12, enter: { type: "flip", duration: 1 } as SceneElement["enter"] });
    // Mid-entrance it is tilted further than it rests.
    expect(motionFor(flipping, 8, ctx()).rotateX).toBeGreaterThan(12);
    // Once the entrance is over, only its own tilt is left.
    expect(motionFor(flipping, 60, ctx()).rotateX).toBeCloseTo(12, 5);
  });
});
