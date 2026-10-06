import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { setSceneLock } from "@/server/services/scenes";

export const POST = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const { locked } = await readJson(req, z.object({ locked: z.boolean() }));
  await setSceneLock(assertProjectId(id), assertId(sceneId, "scene id"), locked, "user");
  return { ok: true };
});
