import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { AudioTrackPatchSchema, removeAudioTrack, updateAudioTrack } from "@/server/services/audio-tracks";

export const dynamic = "force-dynamic";

export const PATCH = api<{ id: string; trackId: string }>(async (req, { id, trackId }) => {
  assertProjectId(id);
  const body = await readJson(req, AudioTrackPatchSchema);
  return { track: await updateAudioTrack(id, trackId, body, "user") };
});

export const DELETE = api<{ id: string; trackId: string }>(async (_req, { id, trackId }) => {
  await removeAudioTrack(assertProjectId(id), trackId, "user");
  return { ok: true };
});
