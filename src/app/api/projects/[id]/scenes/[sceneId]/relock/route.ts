import { api } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { relockSceneTiming } from "@/server/services/scenes";

export const POST = api<{ id: string; sceneId: string }>(async (_req, { id, sceneId }) => ({
  result: await relockSceneTiming(assertProjectId(id), assertId(sceneId, "scene id"), "user"),
}));
