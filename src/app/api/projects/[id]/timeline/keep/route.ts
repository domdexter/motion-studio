import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { keepExistingTimeline } from "@/server/services/timeline";

export const POST = api<{ id: string }>(async (_req, { id }) => {
  await keepExistingTimeline(assertProjectId(id), "user");
  return { ok: true };
});
