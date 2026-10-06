import { api } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { duplicateScene } from "@/server/services/scenes";

/** Duplicates the scene's design as a new scene after the last one. */
export const POST = api<{ id: string; sceneId: string }>(async (_req, { id, sceneId }) => ({
  result: await duplicateScene(assertProjectId(id), assertId(sceneId, "scene id"), "user"),
}));
