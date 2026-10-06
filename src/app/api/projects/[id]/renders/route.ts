import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { createRender, getRenderReadiness, listRenders, RenderRequestSchema } from "@/server/services/renders";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => {
  assertProjectId(id);
  const [renders, readiness] = await Promise.all([listRenders(id), getRenderReadiness(id)]);
  return { renders, readiness };
});

export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const body = await readJson(req, RenderRequestSchema);
  return createRender(id, body, "user");
});
