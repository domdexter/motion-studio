import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { SceneElementsOperationSchema, UpdateSceneElementSchema, applySceneElementsOperation, updateSceneElement } from "@/server/services/scene-elements";

/** Move, resize, rotate, fade or re-layer an element of the scene, change its entrance/exit, or re-place an image or video. */
export const PATCH = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const body = await readJson(req, UpdateSceneElementSchema);
  return await updateSceneElement(assertProjectId(id), assertId(sceneId, "scene id"), body, "user");
});

/** Several elements at once: move them together (drag, nudge, align, distribute), delete, duplicate or change their layer order. */
export const POST = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const body = await readJson(req, SceneElementsOperationSchema);
  return await applySceneElementsOperation(assertProjectId(id), assertId(sceneId, "scene id"), body, "user");
});
