import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import {
  approveAssetRequest,
  cancelAssetRequest,
  getAssetRequest,
  markAssetRequestGenerating,
  regenerateAssetRequest,
  rejectAssetRequest,
} from "@/server/services/asset-requests";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), assetId: z.string().min(1).max(80) }),
  z.object({ action: z.literal("reject"), feedback: z.string().max(2000).default("") }),
  z.object({ action: z.literal("regenerate"), feedback: z.string().max(2000).default("") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("generating") }),
]);

export const GET = api<{ id: string; requestId: string }>(async (_req, { id, requestId }) => ({ request: await getAssetRequest(assertProjectId(id), requestId) }));

/** Human-in-the-loop decisions on a request: approve a candidate, reject, ask for another attempt, cancel. */
export const PATCH = api<{ id: string; requestId: string }>(async (req, { id, requestId }) => {
  assertProjectId(id);
  const body = await readJson(req, Body);
  switch (body.action) {
    case "approve":
      return { request: await approveAssetRequest(id, requestId, body.assetId, "user") };
    case "reject":
      return { request: await rejectAssetRequest(id, requestId, body.feedback, "user") };
    case "regenerate":
      return { request: await regenerateAssetRequest(id, requestId, body.feedback, "user") };
    case "cancel":
      return { request: await cancelAssetRequest(id, requestId, "user") };
    case "generating":
      return { request: await markAssetRequestGenerating(id, requestId, "user") };
  }
});
