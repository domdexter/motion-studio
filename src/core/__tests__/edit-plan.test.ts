import { describe, expect, it } from "vitest";
import { EditPlanError, applyEditPlan, explainChanges, resolveTarget, type EditPlan } from "../ai/edit-plan";
import { isGroup, validateSceneSpec, type SceneElement, type SceneSpec } from "../spec/scene";
import { groupElements } from "../timeline/element-ops";

/**
 * Phase 10 — the AI edit plan. Claude is a client of the scene model: every operation here compiles to
 * the same patches the editor uses, is refused with a sentence a person can act on, and reports what
 * it did. These tests pin that contract, including that a plan either applies whole or not at all.
 */

const text = (id: string, extra: Partial<SceneElement> = {}): SceneElement => ({ id, type: "text", text: "Hi", ...extra }) as SceneElement;

const scene = (): SceneSpec => ({
  version: 1,
  elements: [text("title", { x: 20, y: 30 }), text("body", { x: 60, y: 70 })],
  shots: [{ id: "shot_b", elements: [text("inShot", { x: 10, y: 10 })] }],
});

const plan = (...edits: EditPlan["edits"]): EditPlan => ({ edits });

describe("targets", () => {
  it("finds an element by id, by place, inside a shot and inside a group", () => {
    const spec = scene();
    expect(resolveTarget(spec, "title").element.id).toBe("title");
    expect(resolveTarget(spec, "#2").element.id).toBe("body");
    expect(resolveTarget(spec, "shot_b/#1").element.id).toBe("inShot");
    const grouped = groupElements(spec, [{ shotId: null, index: 0 }, { shotId: null, index: 1 }], { id: "g" }).spec;
    expect(resolveTarget(grouped, "#1.2").element.id).toBe("body");
    expect(resolveTarget(grouped, "body").ref).toEqual({ shotId: null, index: 0, child: 1 });
  });

  it("says what the scene holds when the target isn't there", () => {
    expect(() => resolveTarget(scene(), "nope")).toThrow(/No element “nope”/);
    // Elements are listed by the name they are known by — their id when they have one.
    expect(() => resolveTarget(scene(), "nope")).toThrow(/title, body, inShot/);
  });
});

describe("operations", () => {
  it("sets properties through the element patch, and says what changed", () => {
    const { spec, changes } = applyEditPlan(scene(), plan({ op: "set", target: "title", patch: { x: 40, y: 60, opacity: 0.5 } }));
    expect(spec.elements[0]).toMatchObject({ x: 40, y: 60, opacity: 0.5 });
    expect(changes[0].summary).toBe("moved it to 40%, 60%, set its opacity to 50%");
  });

  it("adds an element with an id that isn't taken", () => {
    const { spec, changes } = applyEditPlan(scene(), plan({ op: "add", element: { id: "title", type: "text", text: "New", x: 50, y: 50 } as SceneElement }));
    expect(spec.elements.map((e) => e.id)).toEqual(["title", "body", "title_2"]);
    expect(changes[0].summary).toContain("added a text");
    expect(validateSceneSpec(spec).ok).toBe(true);
  });

  it("keyframes a property, re-curves it and removes it", () => {
    const added = applyEditPlan(
      scene(),
      plan(
        { op: "keyframe", target: "title", keyframe: { property: "x", at: 0, value: 20 } },
        { op: "keyframe", target: "title", keyframe: { property: "x", at: 1.5, value: 70, easing: "easeInOut" } },
      ),
    );
    expect(added.spec.elements[0].keyframes).toHaveLength(2);
    expect(added.changes[1].summary).toBe("keyed its x to 70% at 1.5s with easeInOut");
    // Re-curving an existing keyframe keeps its value.
    const curved = applyEditPlan(added.spec, plan({ op: "keyframe", target: "title", keyframe: { property: "x", at: 0, easing: { bezier: [0.16, 1, 0.3, 1] } } }));
    expect(curved.spec.elements[0].keyframes?.[0]).toMatchObject({ value: 20, easing: { bezier: [0.16, 1, 0.3, 1] } });
    const removed = applyEditPlan(curved.spec, plan({ op: "keyframe", target: "title", keyframe: { property: "x", at: 1.5, remove: true } }));
    expect(removed.spec.elements[0].keyframes).toHaveLength(1);
    const cleared = applyEditPlan(removed.spec, plan({ op: "clearKeyframes", target: "title", property: "x" }));
    expect(cleared.spec.elements[0].keyframes).toBeUndefined();
  });

  it("gives an element a path and takes it away", () => {
    const withPath = applyEditPlan(scene(), plan({ op: "path", target: "title", path: { type: "quadratic", from: [10, 80], to: [90, 20], c1: [50, 10] } }));
    expect(withPath.spec.elements[0].motionPath?.type).toBe("quadratic");
    expect(withPath.changes[0].summary).toContain("quadratic path from 10,80 to 90,20");
    expect(applyEditPlan(withPath.spec, plan({ op: "path", target: "title", path: null })).spec.elements[0].motionPath).toBeUndefined();
  });

  it("cues motion to the voice, and adds an emphasis moment", () => {
    const { spec, changes } = applyEditPlan(
      scene(),
      plan(
        { op: "cue", target: "title", cue: "enter", at: { type: "word", value: "platform" } },
        { op: "cue", target: "body", cue: "emphasis+pop", at: { type: "phrase", value: "our new platform" } },
      ),
    );
    expect(spec.elements[0].enter?.at).toEqual({ type: "word", value: "platform" });
    expect(spec.elements[1].emphasis).toEqual([{ type: "pop", at: { type: "phrase", value: "our new platform" } }]);
    expect(changes[1].summary).toContain("pop emphasis");
    // Voice cues stay cues: nothing became a keyframe.
    expect(spec.elements[1].keyframes).toBeUndefined();
  });

  it("groups and ungroups", () => {
    const grouped = applyEditPlan(scene(), plan({ op: "group", targets: ["title", "body"], name: "Block" }));
    const group = grouped.spec.elements[0];
    expect(isGroup(group)).toBe(true);
    expect(grouped.changes[0].summary).toBe("grouped title, body");
    const flat = applyEditPlan(grouped.spec, plan({ op: "ungroup", target: group.id! }));
    expect(flat.spec.elements.map((e) => e.id)).toEqual(["title", "body"]);
  });

  it("changes the scene's own look", () => {
    const { spec, changes } = applyEditPlan(scene(), plan({ op: "scene", patch: { transitionIn: { type: "fade", duration: 0.5 }, density: "high" } }));
    expect(spec.transitionIn).toEqual({ type: "fade", duration: 0.5 });
    expect(spec.motion?.density).toBe("high");
    expect(changes[0].summary).toContain("set the transition in to fade");
  });

  it("removes, duplicates and re-layers", () => {
    const duplicated = applyEditPlan(scene(), plan({ op: "duplicate", target: "title" }));
    expect(duplicated.spec.elements.map((e) => e.id)).toEqual(["title", "title_2", "body"]);
    const front = applyEditPlan(duplicated.spec, plan({ op: "arrange", target: "title", action: "front" }));
    expect(front.spec.elements.find((e) => e.id === "title")?.z).toBeGreaterThan(0);
    expect(front.changes[0].summary).toBe("bring to front");
    const removed = applyEditPlan(front.spec, plan({ op: "remove", target: "title_2" }));
    expect(removed.spec.elements.map((e) => e.id)).toEqual(["title", "body"]);
  });
});

describe("safety", () => {
  it("refuses an unknown target, an unknown property and an unsupported one", () => {
    expect(() => applyEditPlan(scene(), plan({ op: "set", target: "ghost", patch: { x: 1 } }))).toThrow(EditPlanError);
    expect(() => applyEditPlan(scene(), plan({ op: "keyframe", target: "title", keyframe: { property: "wobble", at: 0, value: 1 } }))).toThrow(/isn't a property Motion Studio animates/);
    expect(() => applyEditPlan(scene(), plan({ op: "set", target: "title", patch: { props: { nope: 1 } } }))).toThrow(/isn't a property of text elements/);
  });

  it("refuses a value the schema doesn't allow", () => {
    expect(() => applyEditPlan(scene(), plan({ op: "set", target: "title", patch: { opacity: 4 } }))).toThrow();
  });

  it("names the edit that failed and changes nothing", () => {
    const spec = scene();
    try {
      applyEditPlan(spec, plan({ op: "set", target: "title", patch: { x: 10 } }, { op: "set", target: "ghost", patch: { x: 10 } }));
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EditPlanError);
      expect((e as EditPlanError).index).toBe(1);
    }
    // The spec it was given is untouched: the caller keeps the scene it had.
    expect(spec.elements[0].x).toBe(20);
  });

  it("keeps a keyframe inside the property's range", () => {
    expect(() => applyEditPlan(scene(), plan({ op: "keyframe", target: "title", keyframe: { property: "opacity", at: 0, value: 3 } }))).toThrow();
  });

  it("refuses to duplicate an element inside a group", () => {
    const grouped = groupElements(scene(), [{ shotId: null, index: 0 }, { shotId: null, index: 1 }], { id: "g" }).spec;
    expect(() => applyEditPlan(grouped, plan({ op: "duplicate", target: "body" }))).toThrow(/Take the group apart/);
  });
});

describe("explanation", () => {
  it("groups the changes by element, in the editor's words", () => {
    const { changes } = applyEditPlan(
      scene(),
      plan(
        { op: "set", target: "title", patch: { x: 38, y: 50 } },
        { op: "set", target: "title", patch: { enter: { type: "slideLeft", duration: 0.4, easing: "easeOut" } } },
        { op: "cue", target: "title", cue: "emphasis+pulse", at: { type: "sceneTime", seconds: 2.1 } },
      ),
    );
    expect(explainChanges(changes)).toEqual(["title: moved it to 38%, 50%; set its entrance to slideLeft over 0.4s (easeOut); added a pulse emphasis 2.10s into the scene"]);
  });
});
