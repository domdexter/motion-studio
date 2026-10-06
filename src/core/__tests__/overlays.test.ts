import { describe, expect, it } from "vitest";
import { dragOverlay, overlayBox, overlayOpacity, trimmedLengthSec, type OverlayTiming } from "../timeline/overlays";

const video: OverlayTiming = { kind: "video", startSec: 10, durationSec: 4, trimStartSec: 2, trimEndSec: 6, playbackRate: 1, endBehavior: "hold", sourceDurationSec: 12 };

describe("overlay clips", () => {
  it("measures the trimmed part of a video at its rate", () => {
    expect(trimmedLengthSec(video)).toBe(4);
    expect(trimmedLengthSec({ ...video, trimEndSec: null })).toBe(10);
    expect(trimmedLengthSec({ ...video, playbackRate: 2 })).toBe(2);
    expect(trimmedLengthSec({ ...video, kind: "image" })).toBeNull();
  });

  it("moves a clip without changing its trim and keeps it inside the video", () => {
    expect(dragOverlay(video, "move", 3)).toEqual({ startSec: 13, durationSec: 4, trimStartSec: 2, trimEndSec: 6 });
    expect(dragOverlay(video, "move", -20).startSec).toBe(0);
    expect(dragOverlay(video, "move", 50, 20).startSec).toBe(16);
  });

  it("trims the in-point with the left edge and never before the source start", () => {
    expect(dragOverlay(video, "start", 1)).toEqual({ startSec: 11, durationSec: 3, trimStartSec: 3, trimEndSec: 6 });
    const wide = dragOverlay(video, "start", -5);
    expect(wide.trimStartSec).toBe(0);
    expect(wide.startSec).toBe(8);
    expect(dragOverlay(video, "start", 10).durationSec).toBeCloseTo(0.2);
  });

  it("trims the out-point with the right edge, clamped to the source unless the clip loops", () => {
    expect(dragOverlay(video, "end", -1)).toEqual({ startSec: 10, durationSec: 3, trimStartSec: 2, trimEndSec: 5 });
    expect(dragOverlay(video, "end", 30)).toEqual({ startSec: 10, durationSec: 10, trimStartSec: 2, trimEndSec: null });
    expect(dragOverlay({ ...video, endBehavior: "loop" }, "end", 30).durationSec).toBe(34);
    expect(dragOverlay({ ...video, kind: "image", sourceDurationSec: null }, "end", 6).durationSec).toBe(10);
  });

  it("lays out placements and fades", () => {
    expect(overlayBox("fullscreen", { width: 1920, height: 1080 }, 1)).toMatchObject({ left: 0, top: 0, width: 1920, height: 1080 });
    const framed = overlayBox("framed", { width: 1920, height: 1080 }, 16 / 9);
    expect(framed.left + framed.width / 2).toBeCloseTo(960);
    const pip = overlayBox("pip", { width: 1920, height: 1080 }, 16 / 9);
    expect(pip.left + pip.width).toBeLessThan(1920);
    expect(overlayOpacity(0, 90, 30, { opacity: 1, fadeInSec: 0.5, fadeOutSec: 0.5 })).toBe(0);
    expect(overlayOpacity(45, 90, 30, { opacity: 0.8, fadeInSec: 0.5, fadeOutSec: 0.5 })).toBeCloseTo(0.8);
  });
});
