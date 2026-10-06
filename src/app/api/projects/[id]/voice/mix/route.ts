import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { getVoiceMix, updateVoiceMix, VoiceMixSchema } from "@/server/services/voice";

export const dynamic = "force-dynamic";

/** Voice-over level, mute and muted sections (plus the active take's length for the timeline). */
export const GET = api<{ id: string }>(async (_req, { id }) => getVoiceMix(assertProjectId(id)));

export const PATCH = api<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, VoiceMixSchema);
  return { mix: await updateVoiceMix(assertProjectId(id), body, "user") };
});
