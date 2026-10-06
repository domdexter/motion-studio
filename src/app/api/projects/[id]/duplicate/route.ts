import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { duplicateProject } from "@/server/services/bundle";
import { assertProjectExists } from "@/server/services/projects";

export const POST = api<{ id: string }>(async (req, { id }) => {
  const { name } = await readJson(req, z.object({ name: z.string().max(120).optional() }));
  await assertProjectExists(assertProjectId(id));
  const newId = await duplicateProject(id, name, "user");
  return { id: newId };
});
