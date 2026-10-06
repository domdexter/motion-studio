import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { SaveScriptSchema, getScriptOverview, saveScript } from "@/server/services/script";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => ({ script: await getScriptOverview(assertProjectId(id)) }));

export const POST = api<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, SaveScriptSchema);
  return { result: await saveScript(assertProjectId(id), body, "user") };
});
