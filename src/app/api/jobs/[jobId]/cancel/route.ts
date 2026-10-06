import { api } from "@/server/http/api";
import { assertId } from "@/server/ids";
import { requestCancel } from "@/server/jobs/queue";

export const POST = api<{ jobId: string }>(async (_req, { jobId }) => {
  await requestCancel(assertId(jobId, "job id"));
  return { ok: true };
});
