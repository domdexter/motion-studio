import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { getVoiceOverview } from "@/server/services/voice";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => ({ voice: await getVoiceOverview(assertProjectId(id)) }));
