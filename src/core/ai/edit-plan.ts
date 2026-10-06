import { z } from "zod";
import { setKeyframe, sortKeyframes } from "../motion/keyframes";
import { animatableProperty, findKeyframeProperty, formatPropertyValue, propertySupportIssue, propertyValueIssue, type KeyframeProperty } from "../spec/animatable";
import { ELEMENT_TYPE_LABELS } from "../spec/element-properties";
import { ElementSchema, EmphasisSchema, KeyframeEasingSchema, KeyframeValueSchema, MotionPathSchema, TriggerSchema, allSpecElements, isGroup, type SceneElement, type SceneSpec } from "../spec/scene";
import { describeTrigger } from "../timeline/element-cues";
import { findElementAt, replaceElementAt, type ElementRef, type FrameSize } from "../timeline/element-layout";
import { ARRANGE_ACTIONS, ARRANGE_LABELS, MAX_SCENE_ELEMENTS, MAX_SHOT_ELEMENTS, applyLayers, arrangeLayers, duplicateElements, groupElements, removeElements, ungroupElements, uniqueElementId, GroupError } from "../timeline/element-ops";
import { ElementPatchSchema, SceneLookPatchSchema, SpecPatchError, applyElementPatch, applySceneLookPatch, elementPatchKeys, type ElementPatchContext } from "../timeline/spec-patch";
import type { TriggerContext } from "../spec/triggers";

/**
 * The AI edit plan — how Claude changes a scene.
 *
 * A plan is a list of structured operations against the scene model, not a new mutation system: every
 * operation compiles down to the same element patches and element operations the editor and the CLI
 * use, so an AI edit is validated, previewed, undone and rendered exactly like a human one. Nothing
 * here executes code, touches the DOM or reaches outside the scene it is given.
 *
 *   request → plan (this schema) → validate → apply (core patches) → validated spec → preview → commit
 *
 * Each operation reports what it did in one plain sentence (`changes`), which is what the editor, the
 * CLI and the task log show — the explanation is produced by the code that made the change, so it can
 * never drift from it.
 */

export class EditPlanError extends Error {
  constructor(
    message: string,
    /** Which edit of the plan failed (0-based), when it is one edit's fault. */
    readonly index?: number,
  ) {
    super(message);
  }
}

/**
 * Which element an edit is about: its id (`"title"`), or its place — `"#2"` is the second element of
 * the scene, `"shot_b/#1"` the first of a shot, `"#2.1"` the first child of the second element's group.
 */
export const EditTargetSchema = z.string().min(1).max(80);

const KeyframeEditSchema = z.strictObject({
  property: z.string().min(1).max(40),
  /** Seconds after the element appears. */
  at: z.number().min(0).max(3600),
  /** Left out with `remove`, and to re-curve a keyframe that is already there. */
  value: KeyframeValueSchema.optional(),
  easing: KeyframeEasingSchema.optional(),
  remove: z.boolean().optional(),
});

export const EditOperationSchema = z.discriminatedUnion("op", [
  /** Any property of one element: position, size, rotation, appearance, typography, timing, cues, effects, clip, blend, keyframes. */
  z.strictObject({ op: z.literal("set"), target: EditTargetSchema, patch: ElementPatchSchema }),
  /** A new element. It is appended to the scene (or to a shot), and its id is made unique. */
  z.strictObject({ op: z.literal("add"), element: ElementSchema, shotId: z.string().min(1).max(64).nullable().optional() }),
  z.strictObject({ op: z.literal("remove"), target: EditTargetSchema }),
  z.strictObject({ op: z.literal("duplicate"), target: EditTargetSchema, offset: z.strictObject({ x: z.number().min(-100).max(100), y: z.number().min(-100).max(100) }).optional() }),
  z.strictObject({ op: z.literal("arrange"), target: EditTargetSchema, action: z.enum(ARRANGE_ACTIONS) }),
  /** One keyframe of one property (add, move, re-curve or remove). */
  z.strictObject({ op: z.literal("keyframe"), target: EditTargetSchema, keyframe: KeyframeEditSchema }),
  /** Every keyframe of a property goes; the element keeps the value it had when it appeared. */
  z.strictObject({ op: z.literal("clearKeyframes"), target: EditTargetSchema, property: z.string().min(1).max(40) }),
  /** The curve an element travels (null removes it). */
  z.strictObject({ op: z.literal("path"), target: EditTargetSchema, path: MotionPathSchema.nullable() }),
  /**
   * When a cue fires — a spoken word, a phrase or a time (null clears it). `cue` is an id the element
   * already has (enter, exit, emphasis:0, animateAt, item:2, click:0 …), `emphasis+<type>` to add an
   * emphasis moment, or `click+` to add a cursor click.
   */
  z.strictObject({ op: z.literal("cue"), target: EditTargetSchema, cue: z.string().min(1).max(40), at: TriggerSchema.nullable() }),
  z.strictObject({ op: z.literal("group"), targets: z.array(EditTargetSchema).min(2).max(24), name: z.string().min(1).max(60).optional() }),
  z.strictObject({ op: z.literal("ungroup"), target: EditTargetSchema }),
  /** The scene's own look: transition in, camera move, motion density. */
  z.strictObject({ op: z.literal("scene"), patch: SceneLookPatchSchema }),
]);
export type EditOperation = z.infer<typeof EditOperationSchema>;

export const MAX_EDITS = 40;

export const EditPlanSchema = z.strictObject({
  /** One line on what the plan is for — shown with the change list. */
  note: z.string().max(300).optional(),
  edits: z.array(EditOperationSchema).min(1).max(MAX_EDITS),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

export interface EditChange {
  op: EditOperation["op"];
  /** The element the change is about, as the user knows it. */
  target: string;
  /** One plain sentence: what changed, in the units the editor shows. */
  summary: string;
}

export interface EditPlanContext extends ElementPatchContext {
  frame?: FrameSize;
  /** The scene's timing (and its shots'), for cues and keyframe retiming. */
  segment?: TriggerContext;
  /** Its length in seconds (retiming). */
  sceneDurationSec?: number;
}

export interface EditPlanResult {
  spec: SceneSpec;
  changes: EditChange[];
}

// ---------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------

const PLACE = /^(?:([A-Za-z0-9_-]+)\/)?#(\d+)(?:\.(\d+))?$/;

/** The name an element is known by: its id, else its place. */
export function elementLabel(element: SceneElement, ref: ElementRef): string {
  return element.id ?? `${ref.shotId ? `${ref.shotId}/` : ""}#${ref.index + 1}${ref.child === undefined ? "" : `.${ref.child + 1}`}`;
}

/** Where a target names, with a message that lists the scene's elements when it names nothing. */
export function resolveTarget(spec: SceneSpec, target: string): { ref: ElementRef; element: SceneElement } {
  const all = allSpecElements(spec);
  const byId = all.find((e) => e.element.id === target);
  const place = PLACE.exec(target);
  const byPlace = place
    ? all.find(
        (e) => (e.shotId ?? null) === (place[1] ?? null) && e.index === Number(place[2]) - 1 && (place[3] === undefined ? e.child === null : e.child === Number(place[3]) - 1),
      )
    : undefined;
  const found = byId ?? byPlace;
  if (!found) {
    const names = all.map((e) => elementLabel(e.element, { shotId: e.shotId, index: e.index, child: e.child ?? undefined })).join(", ");
    throw new EditPlanError(`No element “${target}” in this scene. Its elements: ${names || "none"}.`);
  }
  return { ref: { shotId: found.shotId, index: found.index, ...(found.child === null ? {} : { child: found.child }) }, element: found.element };
}

// ---------------------------------------------------------------------------------------
// Applying a plan
// ---------------------------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;

const FIELD_NAMES: Record<string, string> = {
  x: "position",
  y: "position",
  width: "width",
  height: "height",
  rotation: "rotation",
  rotateX: "3D tilt",
  rotateY: "3D tilt",
  depth: "perspective depth",
  scale: "scale",
  opacity: "opacity",
  z: "layer",
  enter: "entrance",
  exit: "exit",
  idle: "idle motion",
  blend: "blend mode",
  effects: "effects",
  clip: "clip",
  keyframes: "keyframes",
  emphasis: "emphasis",
  appearAt: "timing",
  disappearAt: "timing",
  placement: "placement",
};

/** "moved it to 40%, 60%", "changed its entrance and opacity" — what a patch did, in the editor's words. */
function describePatch(before: SceneElement, after: SceneElement, patch: z.input<typeof ElementPatchSchema>): string {
  const parts: string[] = [];
  if (patch.x !== undefined || patch.y !== undefined) parts.push(`moved it to ${r2(after.x ?? 50)}%, ${r2(after.y ?? 50)}%`);
  if (patch.width !== undefined || patch.height !== undefined) parts.push(`resized it to ${after.width === undefined ? "auto" : `${r2(after.width)}%`} × ${after.height === undefined ? "auto" : `${r2(after.height)}%`}`);
  if (patch.rotation !== undefined) parts.push(`turned it to ${r2(after.rotation ?? 0)}°`);
  if (patch.rotateX !== undefined || patch.rotateY !== undefined) parts.push(`tilted it ${r2(after.rotateX ?? 0)}° in X and ${r2(after.rotateY ?? 0)}° in Y`);
  if (patch.scale !== undefined) parts.push(`scaled it to ${after.scale ?? 1}×`);
  if (patch.opacity !== undefined) parts.push(`set its opacity to ${Math.round((after.opacity ?? 1) * 100)}%`);
  if (patch.enter !== undefined) parts.push(`set its entrance to ${after.enter?.type ?? "none"}${after.enter?.duration ? ` over ${after.enter.duration}s` : ""}${after.enter?.easing ? ` (${after.enter.easing})` : ""}`);
  if (patch.exit !== undefined) parts.push(`set its exit to ${after.exit?.type ?? "none"}`);
  if (patch.appearAt !== undefined) parts.push(patch.appearAt === null ? "made it appear with its scene" : `made it appear ${patch.appearAt}s into the scene`);
  if (patch.disappearAt !== undefined) parts.push(patch.disappearAt === null ? "kept it until the scene ends" : `made it leave ${patch.disappearAt}s into the scene`);
  if (patch.blend !== undefined) parts.push(`set its blend mode to ${after.blend ?? "normal"}`);
  if (patch.effects !== undefined) parts.push(patch.effects === null ? "removed its effects" : `changed its ${Object.keys(patch.effects).join(", ")}`);
  if (patch.clip !== undefined) parts.push(patch.clip === null ? "removed its clip" : `set a ${after.clip?.type ?? "rect"} clip`);
  if (patch.cues) parts.push(...Object.entries(patch.cues).map(([id, trigger]) => (trigger ? `cued its ${id} ${describeTrigger(trigger, id === "exit" ? "end" : "start", false, [])}` : `cleared its ${id} cue`)));
  if (!parts.length) {
    const fields = [...new Set(elementPatchKeys(patch).map((key) => FIELD_NAMES[key.split(".")[0]] ?? key.split(".").pop() ?? key))];
    parts.push(`changed its ${fields.join(", ")}`);
  }
  return parts.join(", ");
}

function keyframeSummary(property: KeyframeProperty, edit: z.infer<typeof KeyframeEditSchema>, removed: boolean): string {
  const definition = animatableProperty(property);
  if (removed) return `removed its ${definition.label.toLowerCase()} keyframe at ${edit.at}s`;
  const value = edit.value === undefined ? "the value it had there" : formatPropertyValue(property, edit.value);
  const curve = edit.easing ? ` with ${typeof edit.easing === "string" ? edit.easing : `a custom curve (${edit.easing.bezier.join(", ")})`}` : "";
  return `keyed its ${definition.label.toLowerCase()} to ${value} at ${edit.at}s${curve}`;
}

const elementsOf = (spec: SceneSpec, shotId: string | null): SceneElement[] => (shotId === null ? spec.elements : (spec.shots?.find((s) => s.id === shotId)?.elements ?? []));

/**
 * Applies a plan to a scene spec, in order, returning the new spec and what each edit did. Throws an
 * `EditPlanError` naming the edit that failed — nothing is applied unless every edit is applied.
 * The caller validates the result against the scene schema, exactly as it does for a human edit.
 */
export function applyEditPlan(spec: SceneSpec, input: EditPlan, context: EditPlanContext = {}): EditPlanResult {
  const plan = EditPlanSchema.parse(input);
  let next = spec;
  const changes: EditChange[] = [];
  plan.edits.forEach((edit, index) => {
    try {
      next = applyOne(next, edit, context, changes);
    } catch (e) {
      if (e instanceof EditPlanError) throw new EditPlanError(e.message, e.index ?? index);
      if (e instanceof SpecPatchError || e instanceof GroupError) throw new EditPlanError(e.message, index);
      throw e;
    }
  });
  return { spec: next, changes };
}

function applyOne(spec: SceneSpec, edit: EditOperation, context: EditPlanContext, changes: EditChange[]): SceneSpec {
  const add = (target: string, summary: string) => changes.push({ op: edit.op, target, summary });

  switch (edit.op) {
    case "set": {
      const { ref, element } = resolveTarget(spec, edit.target);
      const after = applyElementPatch(element, edit.patch, context);
      add(elementLabel(element, ref), describePatch(element, after, edit.patch));
      return replaceElementAt(spec, ref, after);
    }

    case "add": {
      const shotId = edit.shotId ?? null;
      const list = elementsOf(spec, shotId);
      const limit = shotId === null ? MAX_SCENE_ELEMENTS : MAX_SHOT_ELEMENTS;
      if (list.length >= limit) throw new EditPlanError(`${shotId === null ? "A scene" : `Shot “${shotId}”`} holds at most ${limit} elements.`);
      const taken = new Set(allSpecElements(spec).flatMap((e) => (e.element.id ? [e.element.id] : [])));
      const id = edit.element.id && !taken.has(edit.element.id) ? edit.element.id : uniqueElementId(edit.element.id ?? edit.element.type, taken);
      const element = { ...edit.element, id } as SceneElement;
      add(id, `added a ${ELEMENT_TYPE_LABELS[element.type].toLowerCase()} at ${r2(element.x ?? 50)}%, ${r2(element.y ?? 50)}%`);
      if (shotId === null) return { ...spec, elements: [...spec.elements, element] };
      return { ...spec, shots: (spec.shots ?? []).map((s) => (s.id === shotId ? { ...s, elements: [...s.elements, element] } : s)) };
    }

    case "remove": {
      const { ref, element } = resolveTarget(spec, edit.target);
      add(elementLabel(element, ref), "removed it from the scene");
      return removeElements(spec, [ref]);
    }

    case "duplicate": {
      const { ref, element } = resolveTarget(spec, edit.target);
      if (ref.child !== undefined) throw new EditPlanError("Take the group apart before duplicating one of its elements.");
      const result = duplicateElements(spec, [ref], edit.offset ?? { x: 2, y: 2 });
      const copy = findElementAt(result.spec, result.copies[0]);
      add(elementLabel(element, ref), `duplicated it${copy?.id ? ` as ${copy.id}` : ""}`);
      return result.spec;
    }

    case "arrange": {
      const { ref, element } = resolveTarget(spec, edit.target);
      const layers = arrangeLayers(spec, [ref], edit.action);
      add(elementLabel(element, ref), `${ARRANGE_LABELS[edit.action].toLowerCase()}`);
      return layers.size ? applyLayers(spec, layers) : spec;
    }

    case "keyframe": {
      const { ref, element } = resolveTarget(spec, edit.target);
      const property = findKeyframeProperty(edit.keyframe.property);
      if (!property) throw new EditPlanError(`“${edit.keyframe.property}” isn't a property Motion Studio animates.`);
      const id = property.id as KeyframeProperty;
      const keys = element.keyframes ?? [];
      if (edit.keyframe.remove) {
        const gone = keys.filter((k) => !(k.property === id && Math.abs(k.time - edit.keyframe.at) <= 0.01));
        if (gone.length === keys.length) throw new EditPlanError(`${elementLabel(element, ref)} has no ${id} keyframe at ${edit.keyframe.at}s.`);
        add(elementLabel(element, ref), keyframeSummary(id, edit.keyframe, true));
        return replaceElementAt(spec, ref, applyElementPatch(element, { keyframes: gone }, context));
      }
      if (edit.keyframe.value === undefined && !keys.some((k) => k.property === id)) {
        throw new EditPlanError(`Give a value for the first ${id} keyframe of ${elementLabel(element, ref)}.`);
      }
      const value = edit.keyframe.value ?? valueOfPropertyAt(element, id, edit.keyframe.at);
      const unsupported = propertySupportIssue(element.type, id);
      if (unsupported) throw new EditPlanError(unsupported);
      const outOfRange = propertyValueIssue(id, value);
      if (outOfRange) throw new EditPlanError(outOfRange);
      const { keyframes } = setKeyframe(keys, { property: id, time: edit.keyframe.at, value, ...(edit.keyframe.easing ? { easing: edit.keyframe.easing } : {}) }, 0.01);
      add(elementLabel(element, ref), keyframeSummary(id, edit.keyframe, false));
      return replaceElementAt(spec, ref, applyElementPatch(element, { keyframes: sortKeyframes(keyframes) }, context));
    }

    case "clearKeyframes": {
      const { ref, element } = resolveTarget(spec, edit.target);
      const property = findKeyframeProperty(edit.property);
      if (!property) throw new EditPlanError(`“${edit.property}” isn't a property Motion Studio animates.`);
      const keep = (element.keyframes ?? []).filter((k) => k.property !== property.id);
      if (keep.length === (element.keyframes ?? []).length) throw new EditPlanError(`${elementLabel(element, ref)} doesn't animate its ${property.label.toLowerCase()}.`);
      add(elementLabel(element, ref), `removed its ${property.label.toLowerCase()} animation`);
      return replaceElementAt(spec, ref, applyElementPatch(element, { keyframes: keep.length ? keep : null }, context));
    }

    case "path": {
      const { ref, element } = resolveTarget(spec, edit.target);
      const after = applyElementPatch(element, { motionPath: edit.path }, context);
      add(elementLabel(element, ref), edit.path ? `gave it a ${edit.path.type} path from ${edit.path.from.join(",")} to ${edit.path.to.join(",")}` : "removed its motion path");
      return replaceElementAt(spec, ref, after);
    }

    case "cue": {
      const { ref, element } = resolveTarget(spec, edit.target);
      let patch: z.input<typeof ElementPatchSchema>;
      if (edit.cue.startsWith("emphasis+")) {
        const name = edit.cue.slice("emphasis+".length);
        const type = EmphasisSchema.shape.type.safeParse(name);
        if (!type.success) throw new EditPlanError(`Unknown emphasis “${name}”. Use ${EmphasisSchema.shape.type.options.join(", ")}.`);
        if (!edit.at) throw new EditPlanError("A new emphasis moment needs a moment — cue it to a word, a phrase or a time.");
        patch = { emphasis: [...(element.emphasis ?? []), { type: type.data, at: edit.at }] };
      } else if (edit.cue === "click+") {
        if (element.type !== "cursor") throw new EditPlanError("Only cursors have clicks.");
        if (!edit.at) throw new EditPlanError("A new click needs a moment.");
        patch = { cues: { [`click:${element.clicks?.length ?? 0}`]: edit.at } };
      } else {
        patch = { cues: { [edit.cue]: edit.at } };
      }
      const after = applyElementPatch(element, patch, context);
      const cueName = edit.cue.startsWith("emphasis+") ? `${edit.cue.slice("emphasis+".length)} emphasis` : edit.cue === "click+" ? "click" : edit.cue;
      add(elementLabel(element, ref), edit.at ? `${edit.cue.endsWith("+") || edit.cue.includes("+") ? "added a" : "cued its"} ${cueName} ${describeTrigger(edit.at, edit.cue === "exit" ? "end" : "start", ref.shotId !== null, [])}` : `cleared its ${cueName} cue`);
      return replaceElementAt(spec, ref, after);
    }

    case "group": {
      const targets = edit.targets.map((t) => resolveTarget(spec, t));
      const result = groupElements(
        spec,
        targets.map((t) => t.ref),
        { name: edit.name },
      );
      const group = findElementAt(result.spec, result.ref);
      add(group?.id ?? "group", `grouped ${targets.map((t) => elementLabel(t.element, t.ref)).join(", ")}`);
      return result.spec;
    }

    case "ungroup": {
      const { ref, element } = resolveTarget(spec, edit.target);
      if (!isGroup(element)) throw new EditPlanError(`${elementLabel(element, ref)} isn't a group.`);
      const result = ungroupElements(spec, ref);
      add(elementLabel(element, ref), `took the group apart${result.dropped.length ? ` (its ${result.dropped.join(", ")} could not follow)` : ""}`);
      return result.spec;
    }

    case "scene": {
      const after = applySceneLookPatch(spec, edit.patch);
      const parts: string[] = [];
      if (edit.patch.transitionIn !== undefined) parts.push(after.transitionIn ? `set the transition in to ${after.transitionIn.type}` : "removed the transition in");
      if (edit.patch.camera !== undefined) parts.push(after.camera ? `set the camera to ${after.camera.type}` : "removed the camera move");
      if (edit.patch.density !== undefined) parts.push(`set the motion density to ${after.motion?.density ?? "medium"}`);
      add("the scene", parts.join(", ") || "changed the scene's look");
      return after;
    }
  }
}

/** The value a property has at a moment, for a keyframe that doesn't name one. */
function valueOfPropertyAt(element: SceneElement, property: KeyframeProperty, at: number): z.infer<typeof KeyframeValueSchema> {
  // Imported lazily through the resolver so this module stays free of renderer concerns.
  const keys = (element.keyframes ?? []).filter((k) => k.property === property);
  if (!keys.length) throw new EditPlanError(`Give a value for the first ${property} keyframe.`);
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  const before = [...sorted].reverse().find((k) => k.time <= at) ?? sorted[0];
  return before.value;
}

// ---------------------------------------------------------------------------------------
// Explaining a plan
// ---------------------------------------------------------------------------------------

/**
 * The change list as the editor and the CLI show it: one heading per element, its changes underneath.
 * Implementation details stay out — these are the same words the inspector uses.
 */
export function explainChanges(changes: readonly EditChange[]): string[] {
  const byTarget = new Map<string, string[]>();
  for (const change of changes) {
    const list = byTarget.get(change.target) ?? [];
    list.push(change.summary);
    byTarget.set(change.target, list);
  }
  return [...byTarget].map(([target, list]) => `${target}: ${list.join("; ")}`);
}
