import { z } from "zod";
import { ISSUE_STATUSES } from "@/core/creative/schema";
import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { setReviewIssueStatus } from "@/server/services/creative-reviews";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({ issueIds: z.array(z.string().max(40)).min(1).max(80), status: z.enum(ISSUE_STATUSES) });

export const PATCH = api<{ id: string; reviewId: string }>(async (req, { id, reviewId }) => {
  const body = await readJson(req, PatchSchema);
  return { review: await setReviewIssueStatus(assertProjectId(id), assertId(reviewId, "review id"), body.issueIds, body.status, "user") };
});
