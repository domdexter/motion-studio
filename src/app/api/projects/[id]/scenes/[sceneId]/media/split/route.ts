import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { SplitSceneMediaSchema, splitSceneMedia } from "@/server/services/scene-media";

/** Split an image or video in a scene at a video second, or cut out a section of it. */
export const POST = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const body = await readJson(req, SplitSceneMediaSchema);
  return await splitSceneMedia(assertProjectId(id), assertId(sceneId, "scene id"), body, "user");
});
