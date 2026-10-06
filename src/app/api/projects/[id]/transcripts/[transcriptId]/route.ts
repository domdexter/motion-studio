import { api } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { getTranscriptDetail } from "@/server/services/transcripts";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string; transcriptId: string }>(async (_req, { id, transcriptId }) => ({
  transcript: await getTranscriptDetail(assertProjectId(id), assertId(transcriptId, "transcript id")),
}));
