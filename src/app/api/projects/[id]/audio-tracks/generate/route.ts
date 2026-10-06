import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { GenerateAudioSchema, enqueueAudioGeneration } from "@/server/services/audio-generation";

/** Queue ElevenLabs music or sound-effect generation (the API key never leaves the server). */
export const POST = api<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, GenerateAudioSchema);
  return { job: await enqueueAudioGeneration(assertProjectId(id), body, "user") };
});
