import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { requestRefinement } from "@/server/services/creative-reviews";

export const dynamic = "force-dynamic";

const RefineSchema = z.object({
  issueIds: z.array(z.string().max(40)).min(1).max(80),
  instruction: z.string().max(4000).optional(),
  /** "headless" = Apply fix: Claude Code starts in the background now, regardless of the AI execution setting. */
  executor: z.enum(["manual", "headless"]).optional(),
});

/** Turns accepted review issues into an explicit refinement task for Claude Code. */
export const POST = api<{ id: string; reviewId: string }>(async (req, { id, reviewId }) => {
  const body = await readJson(req, RefineSchema);
  return { task: await requestRefinement(assertProjectId(id), assertId(reviewId, "review id"), body, "user") };
});
