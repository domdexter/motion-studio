import { describe, expect, it } from "vitest";
import { describeConflicts, diffEditState, findConflicts, isEmptyChanges, mergeChanges, scopesOf, type EditState } from "../history/edit-steps";

const scene = (key: string, extra: Record<string, unknown> = {}) => ({ id: key, key, name: key, startSec: 0, endSec: 2, spec: { elements: [] }, version: 1, source: "user", locked: false, ...extra });

describe("edit steps", () => {
  it("records only the entities an edit changed and ignores version bookkeeping", () => {
    const before: EditState = { scenes: { a: scene("scene_01"), b: scene("scene_02") } };
    const after: EditState = { scenes: { a: scene("scene_01", { version: 2, source: "claude" }), b: scene("scene_02", { endSec: 3, version: 2 }) } };
    const changes = diffEditState(before, after);
    expect(changes.scenes?.map((c) => c.id)).toEqual(["b"]);
    expect(scopesOf(changes)).toEqual(["scenes"]);
    expect(isEmptyChanges(diffEditState(before, { scenes: { a: scene("scene_01", { locked: true }), b: scene("scene_02") } }))).toBe(true);
  });

  it("captures created and deleted entities as null sides", () => {
    const changes = diffEditState({ overlays: { x: { id: "x", name: "Clip" } } }, { overlays: { y: { id: "y", name: "New" } } });
    expect(changes.overlays).toEqual([
      { id: "x", before: { id: "x", name: "Clip" }, after: null },
      { id: "y", before: null, after: { id: "y", name: "New" } },
    ]);
  });

  it("merges consecutive steps and drops entities that ended where they started", () => {
    const one = diffEditState({ overlays: { x: { startSec: 1 } }, markers: [] }, { overlays: { x: { startSec: 2 } }, markers: [{ t: 1 }] });
    const two = diffEditState({ overlays: { x: { startSec: 2 } }, markers: [{ t: 1 }] }, { overlays: { x: { startSec: 1 } }, markers: [{ t: 2 }] });
    const merged = mergeChanges(one, two);
    expect(merged.overlays).toBeUndefined();
    expect(merged.markers).toEqual({ before: [], after: [{ t: 2 }] });
  });

  it("tracks audio tracks by entity and the voice-over mix as one value", () => {
    const before: EditState = { audioTracks: { t: { id: "t", name: "Bed", startSec: 0 } }, mix: { volume: 1, muted: false, cuts: [] } };
    const after: EditState = { audioTracks: { t: { id: "t", name: "Bed", startSec: 2 } }, mix: { volume: 1, muted: false, cuts: [{ startSec: 39.5, endSec: 42 }] } };
    const changes = diffEditState(before, after);
    expect(scopesOf(changes)).toEqual(["audioTracks", "mix"]);
    expect(findConflicts(changes, after, "undo")).toEqual([]);
    const later = { ...after, mix: { volume: 0.5, muted: false, cuts: [] } };
    expect(findConflicts(changes, later, "undo")).toEqual([{ kind: "mix", id: "mix", label: "the voice-over mix" }]);
    const moved = { ...after, audioTracks: { t: { id: "t", name: "Bed", startSec: 3 } } };
    expect(describeConflicts(findConflicts(changes, moved, "undo"))).toBe("audio track “Bed” has changed since");
  });

  it("refuses to undo or redo over later changes", () => {
    const changes = diffEditState({ scenes: { a: scene("scene_01") } }, { scenes: { a: scene("scene_01", { endSec: 5 }) } });
    expect(findConflicts(changes, { scenes: { a: scene("scene_01", { endSec: 5, version: 7, locked: true }) } }, "undo")).toEqual([]);
    const conflicts = findConflicts(changes, { scenes: { a: scene("scene_01", { endSec: 6 }) } }, "undo");
    expect(conflicts).toEqual([{ kind: "scenes", id: "a", label: "scene_01" }]);
    expect(describeConflicts(conflicts)).toBe("scene_01 has changed since");
    expect(findConflicts(changes, { scenes: { a: scene("scene_01") } }, "redo")).toEqual([]);
    expect(findConflicts(changes, { scenes: {} }, "redo")).toHaveLength(1);
  });
});
