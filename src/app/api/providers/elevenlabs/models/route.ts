import { api } from "@/server/http/api";
import { listElevenLabsModels } from "@/server/providers/elevenlabs";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const models = await listElevenLabsModels();
  return { models: models.map((m) => ({ modelId: m.id, name: m.name, description: m.description ?? null, maxCharacters: m.maxCharacters, languages: m.languages })) };
});
