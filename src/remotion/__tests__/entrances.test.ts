import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN } from "../../core/design/presets";
import type { SceneElement } from "../../core/spec/scene";
import type { SceneContextValue } from "../engine/context";
import { motionFor } from "../engine/animation";

const WIDTH = 1080;
const HEIGHT = 1920;

/** The few context fields an entrance reads: units, design, intensity and trigger timing. */
function ctx(): SceneContextValue {
  return {
    fps: 30,
    width: WIDTH,
    height: HEIGHT,
    u: (n: number) => (n * Math.min(WIDTH, HEIGHT)) / 1080,
    design: DEFAULT_DESIGN,
    intensity: 1,
    designIntensity: 1,
    motionScale: { distance: 1, duration: 1, stagger: 1 },
    frames: (seconds: number) => Math.round(seconds * 30),
    frameAt: () => 0,
  } as unknown as SceneContextValue;
}

const video = (enter: SceneElement["enter"]): SceneElement =>
  ({ id: "face", type: "video", assetId: "ast_1", x: 50, y: 50, width: 100, height: 100, enter }) as SceneElement;

describe("entrances on media", () => {
  it("slides a full-frame video by a share of its own box, not a fixed 140u", () => {
    const state = motionFor(video({ type: "slideUp", duration: 1 }), 0, ctx());
    // 140u would move it 140px on a 1920px-tall box, which reads as a plain fade.
    expect(state.translateY).toBeGreaterThan(HEIGHT * 0.4);
  });

  it("keeps an explicit distance", () => {
    const state = motionFor(video({ type: "slideUp", duration: 1, distance: 60 }), 0, ctx());
    expect(state.translateY).toBeCloseTo(60, 0);
  });

  it("still moves text by its preset distance", () => {
    const text = { id: "t", type: "text", text: "Hi", x: 50, y: 50, enter: { type: "slideUp", duration: 1 } } as unknown as SceneElement;
    const state = motionFor(text, 0, ctx());
    expect(state.translateY).toBeCloseTo(140, 0);
  });

  it("plays a text reveal asked for on a video as a wipe instead of nothing", () => {
    const state = motionFor(video({ type: "mask", duration: 1 }), 0, ctx());
    expect(state.clipPath).toBe("inset(0 100% 0 0)");
  });

  it("hides a video before a substituted entrance starts", () => {
    const state = motionFor(video({ type: "wordReveal", duration: 1 }), -5, ctx());
    expect(state.visible).toBe(false);
  });
});
