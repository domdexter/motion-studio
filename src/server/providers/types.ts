import type { TimedChar, TimedWord, TranscriptSource } from "@/core/spec/timing";

/**
 * Provider adapters. The rest of the application depends only on these interfaces and the
 * normalized timing types — never on ElevenLabs/SAPI/whisper response structures.
 */

export interface ProviderAvailability {
  ok: boolean;
  reason?: string;
}

export interface VoiceInfo {
  id: string;
  name: string;
  provider: "elevenlabs" | "system";
  category?: string | null;
  description?: string | null;
  labels?: Record<string, string>;
  previewUrl?: string | null;
  language?: string | null;
}

export interface VoiceModelInfo {
  id: string;
  name: string;
  description?: string | null;
  maxCharacters: number | null;
  languages: string[];
}

export interface VoiceSettingsInput {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  useSpeakerBoost: boolean;
}

export interface GenerateVoiceInput {
  text: string;
  voiceId: string | null;
  modelId?: string | null;
  settings?: VoiceSettingsInput;
  outputFormat?: string;
  languageCode?: string | null;
  seed?: number | null;
  /** Continuity hints when a long script is generated in chunks. */
  previousText?: string;
  nextText?: string;
  previousRequestIds?: string[];
  rate?: number;
  signal?: AbortSignal;
}

export interface GeneratedVoice {
  audio: Buffer;
  extension: "mp3" | "wav";
  mimeType: string;
  /** Word timings relative to the start of this audio. */
  words: TimedWord[];
  characters: TimedChar[] | null;
  transcriptSource: TranscriptSource;
  /** Provider response without the audio payload (stored for audit). */
  raw: unknown;
  meta: Record<string, unknown>;
}

export interface VoiceProvider {
  readonly id: "elevenlabs" | "system";
  readonly label: string;
  isAvailable(): Promise<ProviderAvailability>;
  listVoices(): Promise<VoiceInfo[]>;
  generateVoice(input: GenerateVoiceInput): Promise<GeneratedVoice>;
  /** Max characters per request for a model (null = unlimited/unknown). */
  maxCharacters(modelId?: string | null): Promise<number | null>;
}

export interface AlignmentInput {
  audioPath: string;
  durationSec: number;
  /** Script text to align (forced alignment). */
  text?: string;
  languageCode?: string | null;
  signal?: AbortSignal;
  onProgress?: (fraction: number, stage: string) => void;
}

export interface AlignmentResult {
  words: TimedWord[];
  characters: TimedChar[] | null;
  text: string;
  language: string | null;
  source: TranscriptSource;
  raw: unknown;
  quality: { loss?: number; matchedRatio?: number; interpolatedWords?: number };
}

export interface AlignmentProvider {
  readonly id: "elevenlabs_forced_alignment" | "elevenlabs_stt" | "whisper_cpp";
  readonly label: string;
  /** Forced alignment needs the script text. */
  readonly requiresText: boolean;
  isAvailable(): Promise<ProviderAvailability>;
  getAlignment(input: AlignmentInput): Promise<AlignmentResult>;
}
