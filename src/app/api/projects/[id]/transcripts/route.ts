import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { ManualTranscriptSchema, listTranscripts, saveManualTranscript } from "@/server/services/transcripts";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => ({ transcripts: await listTranscripts(assertProjectId(id)) }));

/** Manual transcript edit → saved as a new transcript version (never overwrites). */
export const POST = api<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, ManualTranscriptSchema);
  return { result: await saveManualTranscript(assertProjectId(id), body, "user") };
});
