import { SceneLookPatchSchema } from "@/core/timeline/spec-patch";
import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { updateSceneLook } from "@/server/services/scene-look";

/** The scene's transition in, camera move and motion density. */
export const PATCH = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const body = await readJson(req, SceneLookPatchSchema);
  return { scene: await updateSceneLook(assertProjectId(id), assertId(sceneId, "scene id"), body, "user") };
});
