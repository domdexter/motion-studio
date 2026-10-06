import { z } from "zod";
import { MAX_GROUP_CHILDREN, validateSceneSpec, type SceneElement, type SceneSpec } from "@/core/spec/scene";
import { SCENE_MEDIA_PLACEMENT_NAMES, findElementAt, replaceElementAt, type ElementRef } from "@/core/timeline/element-layout";
import { ARRANGE_ACTIONS, ARRANGE_LABELS, GroupError, MAX_SCENE_ELEMENTS, MAX_SHOT_ELEMENTS, applyLayers, arrangeLayers, duplicateElements, groupElements, refKey, removeElements, ungroupElements } from "@/core/timeline/element-ops";
import { segmentOfElement } from "@/core/timeline/scene-restructure";
import { ElementPatchSchema, SpecPatchError, applyElementPatch, elementPatchKeys, type ElementPatch, type ElementPatchContext } from "@/core/timeline/spec-patch";
import { db } from "../db";
import { AppError, notFound } from "../errors";
import { assertProjectId } from "../ids";
import type { Actor } from "./mutation";
import { findScene, loadWords, sceneDto, updateScene, type SceneDto } from "./scenes";

/**
 * Properties of any element in a scene: position, size, anchor, rotation, scale, opacity, layer,
 * style, its type's own properties (text, typography, data, items…), entrance, exit and timing, plus
 * placement presets for images and videos. The scene editor's canvas and inspector save through here;
 * the patch is applied by core/timeline/spec-patch.ts, the same function the editor previews with.
 * Every change is a normal scene edit: new version, approval reset, undoable.
 */

export const SceneElementPatchSchema = ElementPatchSchema;
export type SceneElementPatch = ElementPatch;

export const UpdateSceneElementSchema = z
  .object({
    /** Where the element is: scene-level (shotId null) or inside a shot, by index. */
    ref: z.object({ shotId: z.string().min(1).max(64).nullable(), index: z.number().int().min(0).max(1000) }).strict(),
    /** The element type expected at `ref`, so an edit never lands on an element that changed underneath. */
    type: z.string().min(1).max(40).optional(),
    /** The asset an image or video is expected to show. */
    assetId: z.string().min(1).max(80).optional(),
    patch: SceneElementPatchSchema,
  })
  .strict();

const r2 = (n: number) => Math.round(n * 100) / 100;

type Verb = "move" | "resize" | "place" | "motion" | "retime" | "emphasize" | "animate" | "restyle" | "edit";
const VERB_LABELS: Record<Verb, string> = {
  move: "move",
  resize: "resize",
  place: "change placement of",
  motion: "change animation of",
  retime: "retime",
  emphasize: "change emphasis of",
  animate: "animate",
  restyle: "restyle",
  edit: "edit",
};
const only = (keys: string[], allowed: string[]) => keys.every((k) => allowed.includes(k));

/** What a patch does, from the fields it sets and the cues it touches — for undo labels and version messages. */
function verbOf(keys: string[], cueIds: string[] = []): Verb {
  if (keys.includes("placement")) return "place";
  // Keyframes set along with layout (moving or resizing an animated element on the canvas) read as that move or resize.
  const layout = keys.filter((k) => k !== "keyframes");
  if (!layout.length) return "animate";
  if (only(layout, ["x", "y"])) return "move";
  if (only(layout, ["x", "y", "width", "height"])) return "resize";
  if (only(keys, ["enter", "exit", "idle"])) return "motion";
  // Emphasis moments added, edited, retimed or removed.
  if (only(keys, ["emphasis", "cues"]) && cueIds.every((id) => id.startsWith("emphasis:"))) return "emphasize";
  // When it appears and leaves, and the moments its motion is cued to (timeline drags, cue edits).
  if (only(keys, ["appearAt", "disappearAt", "cues"])) return "retime";
  if (only(keys, ["emphasis", "cues"])) return "emphasize";
  if (only(keys, ["style", "opacity"])) return "restyle";
  return "edit";
}

/** True when an edit took keyframes away from the element. */
const keyframesRemoved = (before: SceneElement, after: SceneElement | null) => (before.keyframes ?? []).some((k) => !after?.keyframes?.some((n) => n.id === k.id));

/** "radius, text" from ["style.radius", "props.text"]. */
const fieldNames = (fields: string[]) => fields.map((f) => f.replace(/^(style|props|cues)\./, "")).join(", ");

function patched(element: SceneElement, patch: ElementPatch, context: ElementPatchContext): SceneElement {
  try {
    return applyElementPatch(element, patch, context);
  } catch (e) {
    if (e instanceof SpecPatchError) throw new AppError("VALIDATION", e.message);
    throw e;
  }
}

export async function updateSceneElement(
  projectId: string,
  sceneIdOrKey: string,
  input: z.input<typeof UpdateSceneElementSchema>,
  actor: Actor,
): Promise<{ scene: SceneDto; element: SceneElement | null }> {
  assertProjectId(projectId);
  const { ref, type, assetId, patch } = UpdateSceneElementSchema.parse(input);
  const scene = await findScene(db, projectId, sceneIdOrKey);
  if (scene.locked) throw new AppError("LOCKED", `${scene.key.replace("scene_", "Scene ")} is locked. Unlock it before editing it.`);
  const current = validateSceneSpec(scene.spec);
  if (!current.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it before editing its elements.`, { details: current.issues });
  const element = findElementAt(current.spec, ref);
  const media = element && (element.type === "image" || element.type === "video") ? element : null;
  if (!element || (type && element.type !== type) || (assetId && media?.assetId !== assetId)) {
    throw new AppError("PRECONDITION", `That element is no longer at this place in ${scene.key} — the scene changed.`, { hint: "Reload the scene and pick the element again." });
  }
  const keys = Object.keys(patch);
  if (!keys.length) return { scene: sceneDto(scene), element };

  const [project, asset] = await Promise.all([
    patch.placement ? db.project.findUnique({ where: { id: projectId }, select: { width: true, height: true } }) : null,
    media ? db.asset.findFirst({ where: { id: media.assetId, projectId }, select: { name: true, width: true, height: true } }) : null,
  ]);
  if (patch.placement && media && !project) throw notFound("Project");
  const next = patched(element, patch, {
    frame: project ?? undefined,
    assetAspect: asset?.width && asset.height ? asset.width / asset.height : null,
    sceneDurationSec: Math.max(0, scene.endSec - scene.startSec),
    // Retiming an element with keyframes keeps them in place, which needs its timing in the scene.
    segment: element.keyframes?.length ? segmentOfElement(current.spec, { start: scene.startSec, end: scene.endSec }, ref.shotId, await loadWords(db, projectId)) : undefined,
  });
  // Nothing changes (a reset of fields that were already unset): no new version, no undo step.
  if (JSON.stringify(next) === JSON.stringify(element)) return { scene: sceneDto(scene), element };

  const validated = validateSceneSpec(replaceElementAt(current.spec, ref, next));
  if (!validated.ok) throw new AppError("VALIDATION", "Could not apply that change to the element.", { details: validated.issues });

  // Removing keyframes (which may also set the values they leave behind) reads as a keyframe edit.
  const verb = keyframesRemoved(element, next) ? "animate" : verbOf(keys, Object.keys(patch.cues ?? {}));
  const fields = elementPatchKeys(patch);
  const label = `${element.type} ${asset ? `“${asset.name}”` : (element.id ?? `${ref.shotId ? `${ref.shotId}/` : ""}#${ref.index + 1}`)}`;
  const saved = validated.spec;
  const after = findElementAt(saved, ref);
  const message = {
    move: patch.keyframes ? `Moved ${label} (keyframed)` : `Moved ${label} to ${after?.x ?? 50}%, ${after?.y ?? 50}%`,
    resize: `Resized ${label}`,
    place: `Placed ${label} ${patch.placement ? SCENE_MEDIA_PLACEMENT_NAMES[patch.placement].toLowerCase() : ""}`.trim(),
    motion: `Changed the animation of ${label}`,
    retime: `Retimed ${label}`,
    emphasize: `Changed the emphasis of ${label}`,
    animate: `Changed the keyframes of ${label}`,
    restyle: `Changed ${fieldNames(fields)} of ${label}`,
    edit: `Edited ${fieldNames(fields)} of ${label}`,
  }[verb];
  const updated = await updateScene(projectId, scene.id, { spec: saved }, actor, {
    message,
    historyLabel: `${VERB_LABELS[verb]} ${label} in ${scene.key}`,
    // Repeated tweaks of the same fields (a slider, a colour, a value typed again) merge into one undo step; each move, resize or retime is its own.
    coalesceKey: verb === "edit" || verb === "restyle" ? `scene-element:${scene.id}:${ref.shotId ?? ""}:${ref.index}:${[...fields].sort().join(",")}` : undefined,
  });
  const spec = validateSceneSpec(updated.spec);
  return { scene: updated, element: spec.ok ? findElementAt(spec.spec, ref) : null };
}

const RefSchema = z.object({ shotId: z.string().min(1).max(64).nullable(), index: z.number().int().min(0).max(1000), child: z.number().int().min(0).max(100).optional() }).strict();
/** An element, with the type (and asset) expected there, so an edit never lands on an element that changed underneath. */
const TargetFields = { ref: RefSchema, type: z.string().min(1).max(40).optional(), assetId: z.string().min(1).max(80).optional() };
const Targets = (max: number) => z.array(z.object(TargetFields).strict()).min(1).max(max);

export const SceneElementsOperationSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("move"),
      /** New positions (percent of the frame at each element's anchor). */
      items: z.array(z.object({ ...TargetFields, x: z.number().min(-100).max(200), y: z.number().min(-100).max(200) }).strict()).min(1).max(100),
      /** "nudge": arrow-key moves of the same elements merge into one undo step. */
      gesture: z.enum(["drag", "nudge", "align", "distribute"]).optional(),
    })
    .strict(),
  z.object({ op: z.literal("remove"), items: Targets(100) }).strict(),
  /** Copies sit right above their originals, offset by `offsetPx` video pixels (default 24). */
  z.object({ op: z.literal("duplicate"), items: Targets(60), offsetPx: z.number().min(0).max(400).optional() }).strict(),
  z.object({ op: z.literal("arrange"), items: Targets(100), action: z.enum(ARRANGE_ACTIONS) }).strict(),
  /** Puts the elements into one group (they keep their coordinates), or takes a group apart. */
  z.object({ op: z.literal("group"), items: Targets(MAX_GROUP_CHILDREN), name: z.string().min(1).max(60).optional() }).strict(),
  z.object({ op: z.literal("ungroup"), items: Targets(1) }).strict(),
  /**
   * Property edits of several elements as one step, each with its own patch (group edits, pasted properties).
   * `gesture`: moves of animated elements saved as keyframes — "nudge" merges repeated arrow-key moves into one undo step.
   */
  z
    .object({ op: z.literal("patch"), items: z.array(z.object({ ...TargetFields, patch: ElementPatchSchema }).strict()).min(1).max(100), gesture: z.enum(["drag", "nudge", "align", "distribute"]).optional() })
    .strict(),
]);
export type SceneElementsOperation = z.input<typeof SceneElementsOperationSchema>;

const GESTURE_VERBS = { drag: ["move", "Moved"], nudge: ["nudge", "Nudged"], align: ["align", "Aligned"], distribute: ["distribute", "Distributed"] } as const;

/**
 * Edits several elements of a scene in one step — one scene version and one undo step: move them
 * together (a drag, arrow-key nudges, align or distribute), delete, duplicate, or change their layer
 * order. Returns where the elements are afterwards (the copies, for a duplicate).
 */
export async function applySceneElementsOperation(projectId: string, sceneIdOrKey: string, input: SceneElementsOperation, actor: Actor): Promise<{ scene: SceneDto; refs: ElementRef[] }> {
  assertProjectId(projectId);
  const op = SceneElementsOperationSchema.parse(input);
  const scene = await findScene(db, projectId, sceneIdOrKey);
  if (scene.locked) throw new AppError("LOCKED", `${scene.key.replace("scene_", "Scene ")} is locked. Unlock it before editing it.`);
  const current = validateSceneSpec(scene.spec);
  if (!current.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it before editing its elements.`, { details: current.issues });
  const seen = new Set<string>();
  const targets = op.items.map((item) => {
    const key = refKey(item.ref);
    if (seen.has(key)) throw new AppError("VALIDATION", "The same element is listed twice.");
    seen.add(key);
    const element = findElementAt(current.spec, item.ref);
    const assetId = element && (element.type === "image" || element.type === "video") ? element.assetId : undefined;
    if (!element || (item.type && element.type !== item.type) || (item.assetId && assetId !== item.assetId)) {
      throw new AppError("PRECONDITION", `An element is no longer at its place in ${scene.key} — the scene changed.`, { hint: "Reload the scene and select the elements again." });
    }
    return { ref: item.ref, element };
  });
  const refs = targets.map((t) => t.ref);
  const what = targets.length === 1 ? (targets[0].element.id ?? `${targets[0].element.type} ${targets[0].ref.shotId ? `${targets[0].ref.shotId}/` : ""}#${targets[0].ref.index + 1}`) : `${targets.length} elements`;

  let spec: SceneSpec = current.spec;
  let after = refs;
  let message = "";
  let historyLabel = "";
  let coalesceKey: string | undefined;
  switch (op.op) {
    case "move": {
      op.items.forEach((item, i) => {
        spec = replaceElementAt(spec, item.ref, { ...targets[i].element, x: r2(item.x), y: r2(item.y) } as SceneElement);
      });
      const [verb, past] = GESTURE_VERBS[op.gesture ?? "drag"];
      message = `${past} ${what}`;
      historyLabel = `${verb} ${what} in ${scene.key}`;
      // Repeated arrow-key nudges of the same elements merge into one undo step.
      if (op.gesture === "nudge") coalesceKey = `scene-elements-nudge:${scene.id}:${[...seen].sort().join("|")}`;
      break;
    }
    case "remove":
      spec = removeElements(spec, refs);
      after = [];
      message = `Removed ${what}`;
      historyLabel = `delete ${what} from ${scene.key}`;
      break;
    case "duplicate": {
      const project = await db.project.findUnique({ where: { id: projectId }, select: { width: true, height: true } });
      if (!project) throw notFound("Project");
      const px = op.offsetPx ?? 24;
      const result = duplicateElements(spec, refs, { x: r2((px / project.width) * 100), y: r2((px / project.height) * 100) });
      if (result.spec.elements.length > MAX_SCENE_ELEMENTS) throw new AppError("VALIDATION", `A scene holds at most ${MAX_SCENE_ELEMENTS} elements.`);
      const crowded = result.spec.shots?.find((s) => s.elements.length > MAX_SHOT_ELEMENTS);
      if (crowded) throw new AppError("VALIDATION", `Shot “${crowded.id}” would hold more than ${MAX_SHOT_ELEMENTS} elements.`);
      spec = result.spec;
      after = result.copies;
      message = `Duplicated ${what}`;
      historyLabel = `duplicate ${what} in ${scene.key}`;
      break;
    }
    case "arrange": {
      const changes = arrangeLayers(spec, refs, op.action);
      if (!changes.size) return { scene: sceneDto(scene), refs };
      spec = applyLayers(spec, changes);
      message = `${ARRANGE_LABELS[op.action]}: ${what}`;
      historyLabel = `${ARRANGE_LABELS[op.action].toLowerCase()} ${what} in ${scene.key}`;
      break;
    }
    case "group": {
      try {
        const result = groupElements(spec, refs, { name: op.name });
        spec = result.spec;
        after = [result.ref];
      } catch (e) {
        throw new AppError("VALIDATION", e instanceof GroupError ? e.message : String(e));
      }
      message = `Grouped ${what}`;
      historyLabel = `group ${what} in ${scene.key}`;
      break;
    }
    case "ungroup": {
      try {
        const result = ungroupElements(spec, refs[0]);
        spec = result.spec;
        after = result.refs;
        message = result.dropped.length ? `Ungrouped ${what} — its ${result.dropped.join(", ")} could not follow` : `Ungrouped ${what}`;
      } catch (e) {
        throw new AppError("VALIDATION", e instanceof GroupError ? e.message : String(e));
      }
      historyLabel = `ungroup ${what} in ${scene.key}`;
      break;
    }
    case "patch": {
      if (op.items.some((item) => item.patch.placement)) throw new AppError("VALIDATION", "Placement presets apply to one image or video at a time.");
      const sceneDurationSec = Math.max(0, scene.endSec - scene.startSec);
      const words = targets.some((t) => t.element.keyframes?.length) ? await loadWords(db, projectId) : [];
      op.items.forEach((item, i) => {
        const element = targets[i].element;
        const segment = element.keyframes?.length ? segmentOfElement(current.spec, { start: scene.startSec, end: scene.endSec }, item.ref.shotId, words) : undefined;
        spec = replaceElementAt(spec, item.ref, patched(element, item.patch, { sceneDurationSec, segment }));
      });
      if (JSON.stringify(spec) === JSON.stringify(current.spec)) return { scene: sceneDto(scene), refs };
      const fields = [...new Set(op.items.flatMap((item) => elementPatchKeys(item.patch)))].sort();
      const removed = op.items.some((item, i) => keyframesRemoved(targets[i].element, findElementAt(spec, item.ref)));
      const verb = removed
        ? "animate"
        : verbOf(
            [...new Set(op.items.flatMap((item) => Object.keys(item.patch)))],
            op.items.flatMap((item) => Object.keys(item.patch.cues ?? {})),
          );
      const gesture = op.gesture && (verb === "move" || verb === "animate") ? GESTURE_VERBS[op.gesture] : null;
      message = gesture ? `${gesture[1]} ${what}` : verb === "retime" ? `Retimed ${what}` : verb === "emphasize" ? `Changed the emphasis of ${what}` : verb === "animate" ? `Changed the keyframes of ${what}` : `Edited ${fieldNames(fields)} of ${what}`;
      historyLabel = gesture ? `${gesture[0]} ${what} in ${scene.key}` : `${verb === "retime" || verb === "emphasize" || verb === "animate" ? VERB_LABELS[verb] : "edit"} ${what} in ${scene.key}`;
      // Repeated tweaks of the same fields of the same elements merge into one undo step, like arrow-key nudges; each timeline move, keyframe edit or drag is its own.
      coalesceKey =
        op.gesture === "nudge"
          ? `scene-elements-nudge:${scene.id}:${[...seen].sort().join("|")}`
          : verb === "retime" || verb === "animate" || gesture
            ? undefined
            : `scene-elements-patch:${scene.id}:${[...seen].sort().join("|")}:${fields.join(",")}`;
      break;
    }
  }

  const validated = validateSceneSpec(spec);
  if (!validated.ok) throw new AppError("VALIDATION", "Could not apply that change to the elements.", { details: validated.issues });
  const updated = await updateScene(projectId, scene.id, { spec: validated.spec }, actor, { message, historyLabel, coalesceKey });
  return { scene: updated, refs: after };
}
