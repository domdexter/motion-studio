import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { listJobs } from "@/server/jobs/queue";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, { id }) => {
  const types = req.nextUrl.searchParams.get("types")?.split(",").filter(Boolean);
  const limit = Math.min(100, Number(req.nextUrl.searchParams.get("limit") ?? 30));
  return { jobs: await listJobs(assertProjectId(id), { types, limit }) };
});
