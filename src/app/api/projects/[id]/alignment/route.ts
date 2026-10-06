import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { AlignSchema, enqueueAlignment } from "@/server/services/alignment";

export const POST = api<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, AlignSchema);
  return { job: await enqueueAlignment(assertProjectId(id), body) };
});
