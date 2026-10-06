import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { splitScene } from "@/server/services/scenes";

export const POST = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const { atSec } = await readJson(req, z.object({ atSec: z.number().min(0) }));
  return { result: await splitScene(assertProjectId(id), assertId(sceneId, "scene id"), atSec, "user") };
});
