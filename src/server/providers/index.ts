import { AppError } from "../errors";
import { ElevenLabsForcedAlignmentProvider, ElevenLabsSpeechToTextProvider, ElevenLabsVoiceProvider } from "./elevenlabs";
import { SystemVoiceProvider } from "./system-voice";
import type { AlignmentProvider, VoiceProvider } from "./types";

export type VoiceProviderId = "elevenlabs" | "system";
export type AlignmentMethod = "elevenlabs_forced_alignment" | "elevenlabs_stt" | "whisper_cpp";

const voiceProviders: Record<VoiceProviderId, VoiceProvider> = {
  elevenlabs: new ElevenLabsVoiceProvider(),
  system: new SystemVoiceProvider(),
};

export function getVoiceProvider(id: string): VoiceProvider {
  const provider = voiceProviders[id as VoiceProviderId];
  if (!provider) throw new AppError("VALIDATION", `Unknown voice provider “${id}”.`);
  return provider;
}

export async function getAlignmentProvider(method: string): Promise<AlignmentProvider> {
  switch (method) {
    case "elevenlabs_forced_alignment":
      return new ElevenLabsForcedAlignmentProvider();
    case "elevenlabs_stt":
      return new ElevenLabsSpeechToTextProvider();
    case "whisper_cpp": {
      const { WhisperAlignmentProvider } = await import("./whisper");
      return new WhisperAlignmentProvider();
    }
    default:
      throw new AppError("VALIDATION", `Unknown alignment method “${method}”.`);
  }
}

export const ALIGNMENT_LABELS: Record<AlignmentMethod, string> = {
  elevenlabs_forced_alignment: "ElevenLabs forced alignment",
  elevenlabs_stt: "ElevenLabs speech-to-text",
  whisper_cpp: "Local whisper.cpp",
};
