import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { compareScriptWithVoice } from "@/server/services/script";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => ({ comparison: await compareScriptWithVoice(assertProjectId(id)) }));
