import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { AssetRequestInputSchema, createAssetRequest, listAssetRequests } from "@/server/services/asset-requests";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const status = req.nextUrl.searchParams.get("status")?.split(",").filter(Boolean);
  return { requests: await listAssetRequests(id, { status }) };
});

export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const body = await readJson(req, AssetRequestInputSchema);
  return { request: await createAssetRequest(id, body, "user") };
});
