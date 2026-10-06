import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { listCreativeReviews, requestCreativeReview } from "@/server/services/creative-reviews";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => {
  return { reviews: await listCreativeReviews(assertProjectId(id)) };
});

const RequestSchema = z.object({
  request: z.string().trim().min(3).max(4000),
  sceneIds: z.array(z.string().max(80)).max(200).optional(),
  title: z.string().max(160).optional(),
});

/** Asks Claude Code for a read-only creative review (an explicit AI task). */
export const POST = api<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, RequestSchema);
  return { task: await requestCreativeReview(assertProjectId(id), body, "user") };
});
