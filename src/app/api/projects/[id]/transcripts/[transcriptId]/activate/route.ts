import { api } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { activateTranscript } from "@/server/services/transcripts";

export const POST = api<{ id: string; transcriptId: string }>(async (_req, { id, transcriptId }) => ({
  result: await activateTranscript(assertProjectId(id), assertId(transcriptId, "transcript id"), "user"),
}));
