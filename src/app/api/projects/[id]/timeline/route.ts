import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { getTimelineView } from "@/server/services/timeline";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => ({ timeline: await getTimelineView(assertProjectId(id)) }));
