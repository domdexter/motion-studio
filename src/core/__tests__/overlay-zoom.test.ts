import { describe, expect, it } from "vitest";
import { FULL_VIEW, clampZoomRect, normalizeZooms, parseZooms, shiftZoomsForTrim, zoomTransform, zoomViewAt, type OverlayZoom } from "../timeline/overlay-zoom";

const zoom = (extra: Partial<OverlayZoom> = {}): OverlayZoom => ({ id: "z1", startSec: 2, endSec: 6, rect: { x: 0.5, y: 0.25, size: 0.5 }, toRect: null, easeSec: 0.5, ...extra });

describe("overlay zoom regions", () => {
  it("keeps areas inside the frame", () => {
    expect(clampZoomRect({ x: 0.9, y: -0.2, size: 0.5 })).toEqual({ x: 0.5, y: 0, size: 0.5 });
    expect(clampZoomRect({ x: 0, y: 0, size: 0.01 }).size).toBe(0.1);
  });

  it("sorts zooms and stops them overlapping", () => {
    const out = normalizeZooms([zoom({ id: "b", startSec: 5, endSec: 8 }), zoom({ id: "a" }), zoom({ id: "c", startSec: 7.9, endSec: 8.1 })]);
    expect(out.map((z) => [z.id, z.startSec, z.endSec])).toEqual([
      ["a", 2, 6],
      ["b", 6, 8],
    ]);
    expect(parseZooms([zoom(), { bad: true }]).length).toBe(1);
    expect(parseZooms(null)).toEqual([]);
  });

  it("eases into the area, holds, and eases back out", () => {
    const zooms = [zoom()];
    expect(zoomViewAt(1, zooms)).toEqual(FULL_VIEW);
    expect(zoomViewAt(4, zooms)).toEqual({ x: 0.5, y: 0.25, size: 0.5 });
    const half = zoomViewAt(2.25, zooms);
    expect(half.size).toBeCloseTo(0.75);
    expect(zoomViewAt(5.9, zooms).size).toBeGreaterThan(0.9);
    expect(zoomViewAt(6, zooms)).toEqual(FULL_VIEW);
  });

  it("pans from the first area to the second while it holds", () => {
    const zooms = [zoom({ toRect: { x: 0, y: 0.25, size: 0.5 } })];
    expect(zoomViewAt(2.5, zooms).x).toBeCloseTo(0.5);
    expect(zoomViewAt(4, zooms).x).toBeCloseTo(0.25);
    expect(zoomViewAt(5.5, zooms).x).toBeCloseTo(0);
  });

  it("builds a CSS transform only when zoomed", () => {
    expect(zoomTransform(FULL_VIEW)).toBeUndefined();
    expect(zoomTransform({ x: 0.5, y: 0.25, size: 0.5 })).toBe("scale(2) translate(-50%, -25%)");
  });

  it("keeps zooms on the same picture when the in-point moves", () => {
    const moved = shiftZoomsForTrim([zoom()], 0, 1, 1);
    expect([moved[0].startSec, moved[0].endSec]).toEqual([1, 5]);
    const fast = shiftZoomsForTrim([zoom()], 0, 2, 2);
    expect([fast[0].startSec, fast[0].endSec]).toEqual([1, 5]);
    expect(shiftZoomsForTrim([zoom()], 0, 20, 1)).toEqual([]);
  });
});
