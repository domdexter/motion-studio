import { api } from "@/server/http/api";
import { listElevenLabsVoices } from "@/server/providers/elevenlabs";

export const dynamic = "force-dynamic";

export const GET = api(async (req) => {
  const voices = await listElevenLabsVoices(req.nextUrl.searchParams.get("refresh") === "1");
  return {
    voices: voices.map((v) => ({ voiceId: v.id, name: v.name, category: v.category ?? null, description: v.description ?? null, labels: v.labels ?? {}, previewUrl: v.previewUrl ?? null })),
  };
});
