import { api } from "@/server/http/api";
import { SystemVoiceProvider } from "@/server/providers/system-voice";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const provider = new SystemVoiceProvider();
  const availability = await provider.isAvailable();
  if (!availability.ok) return { available: false, reason: availability.reason, voices: [] };
  const voices = await provider.listVoices();
  return { available: true, voices: voices.map((v) => ({ name: v.name, culture: v.language ?? "", gender: v.category ?? "" })) };
});
