import { z } from "zod";
import { api, parseWith, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { restoreSceneVersion } from "@/server/services/scenes";

export const POST = api<{ id: string; sceneId: string; version: string }>(async (req, { id, sceneId, version }) => {
  const { keepTiming } = await readJson(req, z.object({ keepTiming: z.boolean().default(true) }));
  const v = parseWith(z.coerce.number().int().positive(), version, "Invalid version.");
  return { scene: await restoreSceneVersion(assertProjectId(id), assertId(sceneId, "scene id"), v, "user", { keepTiming }) };
});
