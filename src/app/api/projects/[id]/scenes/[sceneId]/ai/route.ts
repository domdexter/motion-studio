import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { AiEditRequestSchema, aiSceneContext, applyAiEditPlan } from "@/server/services/ai-edits";

/**
 * AI editing of one scene. GET returns the focused structured context Claude reasons over; POST
 * applies an edit plan — the same patches, validation, history and undo as a hand edit — or, with
 * `preview: true`, returns what the plan would do without saving it.
 */
export const GET = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const element = req.nextUrl.searchParams.get("element") ?? undefined;
  return { context: await aiSceneContext(assertProjectId(id), assertId(sceneId, "scene id"), { element }) };
});

/**
 * The editor posts a plan the user has accepted, so it is saved as their edit: it lands on their undo
 * stack and Ctrl+Z takes it back. Claude applying a plan itself (the CLI, a task) saves it as its own,
 * which is what keeps the two stacks from fighting while both are editing.
 */
export const POST = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const body = await readJson(req, AiEditRequestSchema);
  return await applyAiEditPlan(assertProjectId(id), assertId(sceneId, "scene id"), body, "user");
});
