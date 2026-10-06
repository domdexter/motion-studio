import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { AddAudioTrackSchema, addAudioTrack, listAudioTracks } from "@/server/services/audio-tracks";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => ({ tracks: await listAudioTracks(assertProjectId(id)) }));

export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const body = await readJson(req, AddAudioTrackSchema);
  return { track: await addAudioTrack(id, body, "user") };
});
