import { describe, expect, it } from "vitest";
import { validateSceneSpec } from "../spec/scene";
import { clampPlaybackRate, dragSceneMedia, findSceneMedia, fitPlaybackRate, listSceneMedia, replaceSceneMedia, sceneMediaAspect, sceneMediaName, sceneVideoTiming } from "../timeline/media-clip";

function spec() {
  const v = validateSceneSpec({
    version: 1,
    elements: [
      { id: "title", type: "text", text: "Hello" },
      {
        id: "video_1",
        type: "video",
        assetId: "ast_video00001",
        startFrom: 2,
        endAt: 8,
        playbackRate: 2,
        zooms: [{ id: "z1", startSec: 1, endSec: 2, rect: { x: 0.2, y: 0.2, size: 0.5 } }],
        enter: { type: "fade", at: { type: "sceneTime", seconds: 1.5 } },
        exit: { type: "fade", duration: 0.4, at: { type: "sceneTime", seconds: 5 } },
      },
    ],
    shots: [
      { id: "a", elements: [{ type: "text", text: "First" }] },
      { id: "b", at: { type: "sceneTime", seconds: 6 }, elements: [{ type: "image", assetId: "ast_image00001", width: 50, height: 50 }] },
    ],
  });
  if (!v.ok) throw new Error(JSON.stringify(v.issues));
  return v.spec;
}

describe("video speed", () => {
  it("clamps speeds and fits a trimmed part into its time on screen", () => {
    expect(clampPlaybackRate(0)).toBe(1);
    expect(clampPlaybackRate(9)).toBe(4);
    expect(clampPlaybackRate(0.01)).toBe(0.1);
    expect(fitPlaybackRate(6, 4)).toBe(1.5);
    expect(fitPlaybackRate(100, 1)).toBe(4);
    expect(fitPlaybackRate(0, 3)).toBe(1);
  });
});

describe("scene media", () => {
  it("lists scene and shot media with the seconds they appear and are gone", () => {
    const items = listSceneMedia(spec(), { words: [], sceneStart: 10, sceneEnd: 20 });
    expect(items.map((i) => [i.ref.shotId, i.ref.index, i.appearSec, i.goneSec])).toEqual([
      [null, 1, 11.5, 15.4],
      ["b", 0, 16, 20],
    ]);
    expect(items.map(sceneMediaName)).toEqual(["video_1", "b/#1"]);
  });

  it("reads a scene video's trim and speed in overlay terms", () => {
    const video = findSceneMedia(spec(), { shotId: null, index: 1 })!;
    expect(sceneVideoTiming(video, 30)).toEqual({ trimStartSec: 2, trimEndSec: 8, playbackRate: 2, endBehavior: "hold", trimmedLengthSec: 3 });
    expect(sceneVideoTiming({ ...video, endAt: 1 } as typeof video, 30).trimEndSec).toBeNull();
    expect(findSceneMedia(spec(), { shotId: null, index: 0 })).toBeNull();
  });

  it("replaces media without touching the rest of the spec", () => {
    const original = spec();
    const ref = { shotId: "b", index: 0 };
    const image = findSceneMedia(original, ref)!;
    const next = replaceSceneMedia(original, ref, { ...image, fit: "contain" });
    expect(findSceneMedia(next, ref)?.fit).toBe("contain");
    expect(findSceneMedia(original, ref)?.fit).toBeUndefined();
    expect(next.elements).toBe(original.elements);
    expect(validateSceneSpec(next).ok).toBe(true);
  });

  it("moves and trims media inside its scene or shot", () => {
    const [video, image] = listSceneMedia(spec(), { words: [], sceneStart: 10, sceneEnd: 20 });
    expect([video.segmentStartSec, video.segmentEndSec, image.segmentStartSec, image.segmentEndSec]).toEqual([10, 20, 16, 20]);
    const v = { trimStartSec: 2, playbackRate: 2 };
    // Move keeps the length and stops at the scene edges.
    expect(dragSceneMedia(video, v, "move", 1)).toEqual({ appearSec: 12.5, goneSec: 16.4, trimStartSec: 2 });
    expect(dragSceneMedia(video, v, "move", -5)).toEqual({ appearSec: 10, goneSec: 13.9, trimStartSec: 2 });
    // The left edge moves the in-point with it (at 2× speed); it can't reach before the clip's first frame.
    expect(dragSceneMedia(video, v, "start", 0.5)).toEqual({ appearSec: 12, goneSec: 15.4, trimStartSec: 3 });
    expect(dragSceneMedia(video, v, "start", -3)).toEqual({ appearSec: 10.5, goneSec: 15.4, trimStartSec: 0 });
    // The right edge stops at the shot's end and keeps a minimum length.
    expect(dragSceneMedia(image, null, "end", 10).goneSec).toBe(20);
    expect(dragSceneMedia(image, null, "end", -10).goneSec).toBe(16.2);
  });

  it("sizes the media box like the engine", () => {
    const image = findSceneMedia(spec(), { shotId: "b", index: 0 })!;
    expect(sceneMediaAspect(image, { width: 1920, height: 1080 }, 1)).toBeCloseTo(16 / 9);
    expect(sceneMediaAspect({ ...image, height: undefined }, { width: 1920, height: 1080 }, 2)).toBeCloseTo(2);
  });
});
