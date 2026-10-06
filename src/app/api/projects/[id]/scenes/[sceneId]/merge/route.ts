import { api } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { mergeWithNext } from "@/server/services/scenes";

/** Merges this scene with the next one. */
export const POST = api<{ id: string; sceneId: string }>(async (_req, { id, sceneId }) => ({
  result: await mergeWithNext(assertProjectId(id), assertId(sceneId, "scene id"), "user"),
}));
