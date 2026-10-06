import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { compareTimelineCandidate } from "@/server/services/timeline";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => ({ comparison: await compareTimelineCandidate(assertProjectId(id)) }));
