import { validateSceneSpec, type SceneSpec } from "@/core/spec/scene";
import { SceneLookPatchSchema, SpecPatchError, applySceneLookPatch, type SceneLookPatch } from "@/core/timeline/spec-patch";
import { db } from "../db";
import { AppError } from "../errors";
import { assertProjectId } from "../ids";
import type { Actor } from "./mutation";
import { findScene, sceneDto, updateScene, type SceneDto } from "./scenes";

/**
 * A scene's look as a whole: how it enters over the previous scene (transition type, length and
 * direction), its camera move and its motion density. A normal scene edit — new version, approval
 * reset, undoable; repeated tweaks of the same setting merge into one undo step.
 */

const LABELS = { transitionIn: "transition", camera: "camera", density: "motion density" } as const;

function describe(spec: SceneSpec, key: keyof typeof LABELS): string {
  if (key === "transitionIn") {
    const t = spec.transitionIn;
    return t ? `${t.type}${t.duration !== undefined ? ` ${t.duration}s` : ""}${t.direction ? ` ${t.direction}` : ""}` : "the design default";
  }
  if (key === "camera") return spec.camera ? `${spec.camera.type}${spec.camera.amount !== undefined ? ` ${spec.camera.amount}` : ""}` : "static";
  return spec.motion?.density ?? "the default";
}

export async function updateSceneLook(projectId: string, sceneIdOrKey: string, input: SceneLookPatch, actor: Actor): Promise<SceneDto> {
  assertProjectId(projectId);
  const patch = SceneLookPatchSchema.parse(input);
  const scene = await findScene(db, projectId, sceneIdOrKey);
  if (scene.locked) throw new AppError("LOCKED", `${scene.key.replace("scene_", "Scene ")} is locked. Unlock it before editing it.`);
  const current = validateSceneSpec(scene.spec);
  if (!current.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it before changing its look.`, { details: current.issues });
  const keys = (Object.keys(patch) as (keyof typeof LABELS)[]).sort();
  if (!keys.length) return sceneDto(scene);
  let spec: SceneSpec;
  try {
    spec = applySceneLookPatch(current.spec, patch);
  } catch (e) {
    if (e instanceof SpecPatchError) throw new AppError("VALIDATION", e.message);
    throw e;
  }
  if (JSON.stringify(spec) === JSON.stringify(current.spec)) return sceneDto(scene);
  const validated = validateSceneSpec(spec);
  if (!validated.ok) throw new AppError("VALIDATION", `Could not change the look of ${scene.key}.`, { details: validated.issues });
  const what = keys.map((k) => LABELS[k]).join(" and ");
  return updateScene(projectId, scene.id, { spec: validated.spec }, actor, {
    message: `Set the ${keys.map((k) => `${LABELS[k]} to ${describe(validated.spec, k)}`).join(", ")}`,
    historyLabel: `change ${what} of ${scene.key}`,
    coalesceKey: `scene-look:${scene.id}:${keys.join(",")}`,
  });
}
