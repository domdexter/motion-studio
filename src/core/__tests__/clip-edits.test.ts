import { describe, expect, it } from "vitest";
import { annotationVisibility, clipSecForSource, cropBox, croppedAspect, normalizeAnnotations, normalizeCrop, normalizeSpeedSegments, sourceSecAt, splitClipTimes, type Annotation } from "../timeline/clip-edits";

describe("crop", () => {
  it("clamps, drops an empty crop and fills the frame with the visible part", () => {
    expect(normalizeCrop({ left: 0, top: 0, right: 0, bottom: 0 })).toBeNull();
    expect(normalizeCrop({ left: 0.9, right: 0.1 })).toEqual({ left: 0.45, top: 0, right: 0.1, bottom: 0 });
    const crop = { left: 0.1, top: 0.2, right: 0.1, bottom: 0 };
    expect(croppedAspect(16 / 9, crop)).toBeCloseTo(((16 / 9) * 0.8) / 0.8);
    expect(cropBox(crop)).toEqual({ left: "-12.5%", top: "-25%", width: "125%", height: "125%" });
    expect(cropBox(null)).toBeNull();
  });
});

describe("speed ramps and freeze frames", () => {
  const clip = {
    trimStartSec: 10,
    playbackRate: 1,
    speedSegments: normalizeSpeedSegments([
      { id: "fast", startSec: 2, endSec: 4, rate: 4 },
      { id: "freeze", startSec: 6, endSec: 7, rate: 0 },
    ]),
  };

  it("maps clip time to source time through fast sections and freezes", () => {
    expect(sourceSecAt(clip, 1)).toBe(11);
    expect(sourceSecAt(clip, 3)).toBe(16); // 2 s at 1× + 1 s at 4×
    expect(sourceSecAt(clip, 5)).toBe(21); // + 2 s at 4× (8) + 1 s
    expect(sourceSecAt(clip, 6.5)).toBe(22); // frozen on the picture at 6 s
    expect(sourceSecAt(clip, 8)).toBe(23);
  });

  it("finds when a source second is reached (skipping freezes)", () => {
    expect(clipSecForSource(clip, 16)).toBe(3);
    expect(clipSecForSource(clip, 22)).toBe(6);
    expect(clipSecForSource(clip, 23)).toBe(8);
  });

  it("sorts segments, removes overlaps and tiny ones", () => {
    const out = normalizeSpeedSegments([
      { id: "b", startSec: 3, endSec: 5, rate: 2 },
      { id: "a", startSec: 1, endSec: 4, rate: 20 },
      { id: "c", startSec: 5, endSec: 5.05, rate: 2 },
    ]);
    expect(out.map((s) => [s.id, s.startSec, s.endSec, s.rate])).toEqual([
      ["a", 1, 4, 16],
      ["b", 4, 5, 2],
    ]);
  });
});

describe("splitting a clip", () => {
  it("clips timed items to each side and re-times the second part", () => {
    const items = [
      { id: "a", startSec: 1, endSec: 3 },
      { id: "b", startSec: 4, endSec: 8 },
      { id: "c", startSec: 9, endSec: 10 },
    ];
    expect(splitClipTimes(items, 5)).toEqual({
      before: [
        { id: "a", startSec: 1, endSec: 3 },
        { id: "b", startSec: 4, endSec: 5 },
      ],
      after: [
        { id: "b", startSec: 0, endSec: 3 },
        { id: "c", startSec: 4, endSec: 5 },
      ],
    });
    // Cutting out 5–9: the second part resumes at 9.
    expect(splitClipTimes(items, 5, 9).after).toEqual([{ id: "c", startSec: 0, endSec: 1 }]);
  });
});

describe("annotations", () => {
  const base: Annotation = { id: "a1", type: "box", startSec: 1, endSec: 3, x: 0.5, y: 0.5, w: -0.2, h: 0.8 };

  it("keeps areas positive and inside the frame; arrows keep their direction", () => {
    const [box] = normalizeAnnotations([base]);
    expect([box.x, box.y, box.w, box.h]).toEqual([0.3, 0.5, 0.2, 0.5]);
    const [arrow] = normalizeAnnotations([{ ...base, type: "arrow", x: 0.8, y: 0.2, w: -0.5, h: 0.9 }]);
    expect([arrow.x, arrow.y, arrow.w, arrow.h]).toEqual([0.8, 0.2, -0.5, 0.8]);
    const [click] = normalizeAnnotations([{ ...base, type: "click", endSec: 1 }]);
    expect(click.endSec).toBe(1.7);
  });

  it("fades in and out", () => {
    expect(annotationVisibility(base, 0.5)).toBe(0);
    expect(annotationVisibility(base, 1.1)).toBeCloseTo(0.5);
    expect(annotationVisibility(base, 2)).toBe(1);
  });
});
