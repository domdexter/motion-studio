import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { enqueueStill, StillRequestSchema } from "@/server/services/renders";

export const dynamic = "force-dynamic";

/** Queues a still-frame export (project thumbnail or arbitrary still). */
export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const body = await readJson(req, StillRequestSchema);
  return { job: await enqueueStill(id, body) };
});
