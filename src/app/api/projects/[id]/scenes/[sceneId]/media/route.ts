import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { InsertMediaSchema, UpdateSceneMediaSchema, insertMediaIntoScene, updateSceneMedia } from "@/server/services/scene-media";

/** Place an image or video asset into the scene (background, full frame, framed or picture-in-picture). */
export const POST = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const body = await readJson(req, InsertMediaSchema);
  return await insertMediaIntoScene(assertProjectId(id), assertId(sceneId, "scene id"), body, "user");
});

/** Trim, speed, loop/hold, fit, darken, clip audio or zoom regions of an image or video already in the scene. */
export const PATCH = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const body = await readJson(req, UpdateSceneMediaSchema);
  return await updateSceneMedia(assertProjectId(id), assertId(sceneId, "scene id"), body, "user");
});
