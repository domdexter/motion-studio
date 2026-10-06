import { api } from "@/server/http/api";
import { assertId } from "@/server/ids";
import { getJob, publicJob } from "@/server/jobs/queue";

export const dynamic = "force-dynamic";

export const GET = api<{ jobId: string }>(async (_req, { jobId }) => ({ job: publicJob(await getJob(assertId(jobId, "job id"))) }));
