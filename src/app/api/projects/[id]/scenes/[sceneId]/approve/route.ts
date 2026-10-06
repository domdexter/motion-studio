import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { setSceneApproval } from "@/server/services/scenes";

export const POST = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const { approved } = await readJson(req, z.object({ approved: z.boolean() }));
  await setSceneApproval(assertProjectId(id), assertId(sceneId, "scene id"), approved, "user");
  return { ok: true };
});
