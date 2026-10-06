import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { setArchived } from "@/server/services/projects";

export const POST = api<{ id: string }>(async (req, { id }) => {
  const { archived } = await readJson(req, z.object({ archived: z.boolean() }));
  await setArchived(assertProjectId(id), archived, "user");
  return { ok: true };
});
