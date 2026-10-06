import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { getAudioTrackPeaks } from "@/server/services/audio-tracks";

export const dynamic = "force-dynamic";

/** Waveform peaks of a track's audio (computed once per file, then served from the project folder). */
export const GET = api<{ id: string; trackId: string }>(async (_req, { id, trackId }) => getAudioTrackPeaks(assertProjectId(id), trackId));
