import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { GenerateVoiceSchema, enqueueVoiceGeneration } from "@/server/services/voice";

export const POST = api<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, GenerateVoiceSchema);
  return { job: await enqueueVoiceGeneration(assertProjectId(id), body, { preview: true }) };
});
