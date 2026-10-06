import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { recalculateTimeline } from "@/server/services/timeline";

/** Builds a new timeline from the active transcript and re-times audio-locked scenes (snapshot first). */
export const POST = api<{ id: string }>(async (_req, { id }) => ({ result: await recalculateTimeline(assertProjectId(id), "user") }));
