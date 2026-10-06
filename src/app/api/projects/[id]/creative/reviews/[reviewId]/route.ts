import { api } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { getCreativeReview } from "@/server/services/creative-reviews";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string; reviewId: string }>(async (_req, { id, reviewId }) => {
  return { review: await getCreativeReview(assertProjectId(id), assertId(reviewId, "review id")) };
});
