import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { BoundarySchema, moveSceneBoundary } from "@/server/services/scenes";

/** Moves the boundary between this scene and the next. snap=true keeps both scenes audio-locked. */
export const POST = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const body = await readJson(req, BoundarySchema);
  return { result: await moveSceneBoundary(assertProjectId(id), assertId(sceneId, "scene id"), body, "user") };
});
