import fs from "node:fs";
import path from "node:path";
import {
  charsFromForcedAlignment,
  timedCharsFromElevenLabs,
  wordsFromForcedAlignment,
  wordsFromSpeechToText,
  wordsFromTimedChars,
  type ElevenLabsCharacterAlignment,
  type ElevenLabsForcedAlignmentResponse,
  type ElevenLabsSttWord,
} from "@/core/transcript/normalize";
import { AppError } from "../errors";
import { pcm16ToWav } from "../media/ffmpeg";
import { getSecret, getSettings } from "../services/settings";
import type {
  AlignmentInput,
  AlignmentProvider,
  AlignmentResult,
  GenerateVoiceInput,
  GeneratedVoice,
  ProviderAvailability,
  VoiceInfo,
  VoiceModelInfo,
  VoiceProvider,
} from "./types";

/**
 * ElevenLabs adapter. All HTTP calls happen server-side with the locally stored key; responses
 * are normalized into the app's timing types before leaving this module.
 */

const SETTINGS_ACTION = { label: "Open ElevenLabs settings", href: "/settings#elevenlabs" };

/** ElevenLabs API-key permission ids → the names shown in the key's permission editor. */
const PERMISSION_LABELS: Record<string, string> = {
  text_to_speech: "Text to Speech",
  speech_to_text: "Speech to Text",
  forced_alignment: "Forced Alignment",
  voices_read: "Voices (read)",
  models_read: "Models (read)",
  user_read: "User (read)",
  music_generation: "Music Generation",
  sound_generation: "Sound Effects",
};

function apiKey(): string {
  const key = getSecret("elevenlabsApiKey");
  if (!key) {
    throw new AppError("NOT_CONFIGURED", "ElevenLabs API key is not configured.", {
      hint: "Add your key in Settings, set ELEVENLABS_API_KEY, or import an existing voice-over instead.",
      action: SETTINGS_ACTION,
    });
  }
  return key;
}

function baseUrl(): string {
  return getSettings().elevenlabs.apiBaseUrl.replace(/\/+$/, "");
}

interface ElevenLabsErrorBody {
  detail?: string | { status?: string; message?: string; code?: string } | { loc?: unknown[]; msg?: string }[];
}

async function toProviderError(res: Response, operation: string): Promise<AppError> {
  let body: ElevenLabsErrorBody | null = null;
  let text = "";
  try {
    text = await res.text();
    body = JSON.parse(text) as ElevenLabsErrorBody;
  } catch {
    body = null;
  }
  const detail = body?.detail;
  let message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).filter(Boolean).join("; ") : detail?.message ?? "";
  const status = !Array.isArray(detail) && typeof detail === "object" ? detail?.status ?? detail?.code : undefined;
  if (!message) message = text.slice(0, 300) || res.statusText;
  const details = { httpStatus: res.status, providerStatus: status ?? null, providerMessage: message, operation };

  if (status === "missing_permissions") {
    const permission = /permission (\w+)/.exec(message)?.[1] ?? null;
    return new AppError("PROVIDER_ERROR", `${operation} failed: your ElevenLabs API key doesn't have the ${permission ? `“${permission}”` : "required"} permission.`, {
      details: { ...details, missingPermission: permission },
      hint: `The key is valid but restricted. In ElevenLabs → Developers → API keys, edit the key and enable ${permission ? PERMISSION_LABELS[permission] ?? permission : "the permissions listed in Settings"} (or create an unrestricted key).`,
      action: SETTINGS_ACTION,
    });
  }
  if (res.status === 401 || status === "invalid_api_key") {
    return new AppError("PROVIDER_ERROR", `${operation} failed: the ElevenLabs API key was rejected.`, { details, hint: "Check the key in Settings.", action: SETTINGS_ACTION });
  }
  if (res.status === 403) {
    return new AppError("PROVIDER_ERROR", `${operation} failed: ${message}`, {
      details,
      hint: "Your ElevenLabs plan may not allow this voice, model or output format (e.g. WAV 44.1 kHz needs Pro). Try another output format in Settings.",
      action: SETTINGS_ACTION,
    });
  }
  if (res.status === 402 || status === "payment_required" || /paid plan|upgrade/i.test(message)) {
    return new AppError("PROVIDER_ERROR", `${operation} failed: ${message || "this feature isn't included in your ElevenLabs plan."}`, {
      details,
      hint: "This is a plan limit, not a temporary error — retrying won't help. Upgrade your ElevenLabs plan, or upload your own audio instead.",
    });
  }
  if (res.status === 429 || status === "quota_exceeded" || status === "too_many_concurrent_requests") {
    return new AppError("PROVIDER_ERROR", `${operation} failed: ${message || "rate limit or quota exceeded"}`, { details, hint: "Wait a moment and retry, or check your remaining ElevenLabs credits." });
  }
  if (res.status === 422 || res.status === 400) {
    return new AppError("PROVIDER_ERROR", `${operation} failed: ${message}`, { details, hint: "The request was rejected by ElevenLabs — check the voice, model and text." });
  }
  return new AppError("PROVIDER_ERROR", `${operation} failed (${res.status}): ${message}`, { details, hint: "ElevenLabs may be temporarily unavailable. Retry in a moment." });
}

async function request(pathName: string, init: RequestInit & { operation: string; timeoutMs?: number }): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), init.timeoutMs ?? 120_000);
  const onAbort = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(`${baseUrl()}${pathName}`, {
      ...init,
      signal: controller.signal,
      headers: { "xi-api-key": apiKey(), Accept: "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) throw await toProviderError(res, init.operation);
    return res;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (init.signal?.aborted) throw new AppError("BAD_REQUEST", `${init.operation} cancelled.`);
    const reason = err instanceof Error ? err.message : String(err);
    throw new AppError("PROVIDER_ERROR", `${init.operation} failed: could not reach ElevenLabs (${reason}).`, { hint: "Check your internet connection and retry." });
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

// ---------------------------------------------------------------------------------------
// Account & catalog
// ---------------------------------------------------------------------------------------

export interface PermissionCheck {
  permission: string;
  label: string;
  usedFor: string;
  ok: boolean;
  message: string | null;
}

export interface ConnectionTestResult {
  keyValid: boolean;
  checks: PermissionCheck[];
  subscription: Awaited<ReturnType<typeof getSubscription>> | null;
  /** Generation permissions can't be verified without spending credits; they are reported when first used. */
  untestedPermissions: string[];
}

/**
 * Checks the key against read-only endpoints, one permission at a time, so a valid but restricted
 * key is reported as such (instead of "rejected").
 */
export async function testElevenLabsConnection(): Promise<ConnectionTestResult> {
  apiKey();
  const probes: { permission: string; usedFor: string; run: () => Promise<unknown> }[] = [
    { permission: "models_read", usedFor: "Model list and per-model character limits", run: () => request("/v1/models", { method: "GET", operation: "Loading ElevenLabs models", timeoutMs: 20_000 }) },
    { permission: "voices_read", usedFor: "Choosing a voice", run: () => request("/v2/voices?page_size=1", { method: "GET", operation: "Loading ElevenLabs voices", timeoutMs: 20_000 }) },
    { permission: "user_read", usedFor: "Plan and character usage (optional)", run: () => getSubscription() },
  ];
  let subscription: ConnectionTestResult["subscription"] = null;
  const checks: PermissionCheck[] = [];
  let rejected: AppError | null = null;
  for (const probe of probes) {
    try {
      const result = await probe.run();
      if (probe.permission === "user_read") subscription = result as NonNullable<ConnectionTestResult["subscription"]>;
      checks.push({ permission: probe.permission, label: PERMISSION_LABELS[probe.permission], usedFor: probe.usedFor, ok: true, message: null });
    } catch (err) {
      const missing = err instanceof AppError && (err.details as { missingPermission?: string } | undefined)?.missingPermission !== undefined;
      if (!missing) {
        rejected ??= err instanceof AppError ? err : new AppError("PROVIDER_ERROR", String(err));
        continue;
      }
      checks.push({ permission: probe.permission, label: PERMISSION_LABELS[probe.permission], usedFor: probe.usedFor, ok: false, message: (err as AppError).message });
    }
  }
  if (rejected && checks.length === 0) throw rejected;
  return {
    keyValid: true,
    checks,
    subscription,
    untestedPermissions: ["text_to_speech", "forced_alignment", "speech_to_text", "music_generation", "sound_generation"].map((p) => PERMISSION_LABELS[p]),
  };
}

export async function getSubscription(): Promise<{ tier: string; characterCount: number; characterLimit: number; resetAt: string | null; status: string | null }> {
  const res = await request("/v1/user/subscription", { method: "GET", operation: "ElevenLabs connection test", timeoutMs: 20_000 });
  const data = (await res.json()) as { tier?: string; character_count?: number; character_limit?: number; next_character_count_reset_unix?: number; status?: string };
  return {
    tier: data.tier ?? "unknown",
    characterCount: data.character_count ?? 0,
    characterLimit: data.character_limit ?? 0,
    resetAt: data.next_character_count_reset_unix ? new Date(data.next_character_count_reset_unix * 1000).toISOString() : null,
    status: data.status ?? null,
  };
}

let voicesCache: { at: number; key: string; voices: VoiceInfo[] } | null = null;
let modelsCache: { at: number; key: string; models: (VoiceModelInfo & { raw: Record<string, unknown> })[] } | null = null;

export async function listElevenLabsVoices(force = false): Promise<VoiceInfo[]> {
  const key = apiKey();
  if (!force && voicesCache && voicesCache.key === key && Date.now() - voicesCache.at < 10 * 60_000) return voicesCache.voices;
  const voices: VoiceInfo[] = [];
  let token: string | null = null;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ page_size: "100", include_total_count: "false" });
    if (token) qs.set("next_page_token", token);
    const res = await request(`/v2/voices?${qs}`, { method: "GET", operation: "Loading ElevenLabs voices", timeoutMs: 30_000 });
    const data = (await res.json()) as {
      voices?: { voice_id: string; name: string; category?: string; description?: string | null; labels?: Record<string, string>; preview_url?: string | null }[];
      has_more?: boolean;
      next_page_token?: string | null;
    };
    for (const v of data.voices ?? []) {
      voices.push({ id: v.voice_id, name: v.name, provider: "elevenlabs", category: v.category ?? null, description: v.description ?? null, labels: v.labels ?? {}, previewUrl: v.preview_url ?? null });
    }
    if (!data.has_more || !data.next_page_token) break;
    token = data.next_page_token;
  }
  voices.sort((a, b) => a.name.localeCompare(b.name));
  voicesCache = { at: Date.now(), key, voices };
  return voices;
}

export async function listElevenLabsModels(): Promise<VoiceModelInfo[]> {
  const key = apiKey();
  if (modelsCache && modelsCache.key === key && Date.now() - modelsCache.at < 30 * 60_000) return modelsCache.models;
  const res = await request("/v1/models", { method: "GET", operation: "Loading ElevenLabs models", timeoutMs: 30_000 });
  const data = (await res.json()) as {
    model_id: string;
    name?: string;
    description?: string;
    can_do_text_to_speech?: boolean;
    max_characters_request_subscribed_user?: number;
    maximum_text_length_per_request?: number;
    languages?: { language_id: string; name: string }[];
  }[];
  const models = data
    .filter((m) => m.can_do_text_to_speech !== false)
    .map((m) => ({
      id: m.model_id,
      name: m.name ?? m.model_id,
      description: m.description ?? null,
      maxCharacters: m.maximum_text_length_per_request ?? m.max_characters_request_subscribed_user ?? null,
      languages: (m.languages ?? []).map((l) => l.language_id),
      raw: m as unknown as Record<string, unknown>,
    }));
  modelsCache = { at: Date.now(), key, models };
  return models;
}

// ---------------------------------------------------------------------------------------
// Text-to-speech with timestamps
// ---------------------------------------------------------------------------------------

const PCM_RATES: Record<string, number> = { pcm_16000: 16000, pcm_22050: 22050, pcm_24000: 24000, pcm_44100: 44100, pcm_48000: 48000 };

export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly id = "elevenlabs" as const;
  readonly label = "ElevenLabs";

  async isAvailable(): Promise<ProviderAvailability> {
    return getSecret("elevenlabsApiKey") ? { ok: true } : { ok: false, reason: "ElevenLabs API key is not configured." };
  }

  listVoices(): Promise<VoiceInfo[]> {
    return listElevenLabsVoices();
  }

  async maxCharacters(modelId?: string | null): Promise<number | null> {
    try {
      const models = await listElevenLabsModels();
      return models.find((m) => m.id === modelId)?.maxCharacters ?? 5000;
    } catch {
      return 5000;
    }
  }

  async generateVoice(input: GenerateVoiceInput): Promise<GeneratedVoice> {
    const settings = getSettings().elevenlabs;
    const voiceId = input.voiceId ?? settings.defaultVoiceId;
    if (!voiceId) {
      throw new AppError("VALIDATION", "Choose an ElevenLabs voice first.", { hint: "Pick a voice in the Voice panel or set a default voice in Settings.", action: SETTINGS_ACTION });
    }
    const modelId = input.modelId ?? settings.defaultModelId;
    const outputFormat = input.outputFormat ?? settings.outputFormat;
    const vs = input.settings ?? settings.voiceSettings;
    const body: Record<string, unknown> = {
      text: input.text,
      model_id: modelId,
      voice_settings: {
        stability: vs.stability,
        similarity_boost: vs.similarityBoost,
        style: vs.style,
        speed: vs.speed,
        use_speaker_boost: vs.useSpeakerBoost,
      },
    };
    if (input.languageCode) body.language_code = input.languageCode;
    if (typeof input.seed === "number") body.seed = input.seed;
    if (input.previousText) body.previous_text = input.previousText;
    if (input.nextText) body.next_text = input.nextText;
    if (input.previousRequestIds?.length) body.previous_request_ids = input.previousRequestIds.slice(-3);

    const res = await request(`/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${encodeURIComponent(outputFormat)}`, {
      method: "POST",
      operation: "Voice generation",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: input.signal,
      timeoutMs: 300_000,
    });
    const data = (await res.json()) as { audio_base64?: string; alignment?: ElevenLabsCharacterAlignment | null; normalized_alignment?: ElevenLabsCharacterAlignment | null };
    if (!data.audio_base64) throw new AppError("PROVIDER_ERROR", "Voice generation failed: ElevenLabs returned no audio.");
    let audio: Buffer = Buffer.from(data.audio_base64, "base64");
    let extension: "mp3" | "wav" = "mp3";
    let mimeType = "audio/mpeg";
    if (outputFormat.startsWith("pcm_")) {
      audio = pcm16ToWav(audio, PCM_RATES[outputFormat] ?? 24000);
      extension = "wav";
      mimeType = "audio/wav";
    }
    const alignment = data.alignment ?? data.normalized_alignment ?? null;
    const characters = alignment ? timedCharsFromElevenLabs(alignment) : null;
    const words = characters ? wordsFromTimedChars(characters) : [];
    return {
      audio,
      extension,
      mimeType,
      words,
      characters,
      transcriptSource: "elevenlabs_tts",
      raw: { alignment: data.alignment ?? null, normalized_alignment: data.normalized_alignment ?? null },
      meta: {
        voiceId,
        modelId,
        outputFormat,
        requestId: res.headers.get("request-id"),
        characterCost: res.headers.get("character-cost") ? Number(res.headers.get("character-cost")) : null,
        voiceSettings: vs,
      },
    };
  }
}

// ---------------------------------------------------------------------------------------
// Music and sound effects
// ---------------------------------------------------------------------------------------

const GENERATED_AUDIO_FORMAT = "mp3_44100_128";
export const MUSIC_LENGTH_SEC = { min: 3, max: 600 } as const;
export const SFX_LENGTH_SEC = { min: 0.5, max: 30 } as const;

export interface GeneratedAudioClip {
  audio: Buffer;
  meta: Record<string, unknown>;
}

async function audioBody(res: Response, operation: string): Promise<Buffer> {
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 256) throw new AppError("PROVIDER_ERROR", `${operation} failed: ElevenLabs returned no audio.`);
  return audio;
}

/** Text-to-music (`POST /v1/music`). */
export async function composeMusic(input: { prompt: string; lengthSec: number; instrumental: boolean; signal?: AbortSignal }): Promise<GeneratedAudioClip> {
  const lengthMs = Math.round(Math.min(MUSIC_LENGTH_SEC.max, Math.max(MUSIC_LENGTH_SEC.min, input.lengthSec)) * 1000);
  const res = await request(`/v1/music?output_format=${GENERATED_AUDIO_FORMAT}`, {
    method: "POST",
    operation: "Music generation",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ prompt: input.prompt, music_length_ms: lengthMs, force_instrumental: input.instrumental }),
    signal: input.signal,
    timeoutMs: 900_000,
  });
  return {
    audio: await audioBody(res, "Music generation"),
    meta: { endpoint: "music", outputFormat: GENERATED_AUDIO_FORMAT, lengthMs, instrumental: input.instrumental, requestId: res.headers.get("request-id"), songId: res.headers.get("song-id") },
  };
}

/** Text-to-sound-effects (`POST /v1/sound-generation`). Leave the duration empty to let the model choose. */
export async function generateSoundEffect(input: { prompt: string; durationSec?: number | null; promptInfluence?: number; loop?: boolean; signal?: AbortSignal }): Promise<GeneratedAudioClip> {
  const body: Record<string, unknown> = { text: input.prompt, model_id: "eleven_text_to_sound_v2", loop: !!input.loop };
  if (typeof input.promptInfluence === "number") body.prompt_influence = input.promptInfluence;
  if (typeof input.durationSec === "number") body.duration_seconds = Math.min(SFX_LENGTH_SEC.max, Math.max(SFX_LENGTH_SEC.min, input.durationSec));
  const res = await request(`/v1/sound-generation?output_format=${GENERATED_AUDIO_FORMAT}`, {
    method: "POST",
    operation: "Sound effect generation",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify(body),
    signal: input.signal,
    timeoutMs: 300_000,
  });
  return {
    audio: await audioBody(res, "Sound effect generation"),
    meta: { endpoint: "sound-generation", outputFormat: GENERATED_AUDIO_FORMAT, durationSec: body.duration_seconds ?? null, loop: !!input.loop, requestId: res.headers.get("request-id") },
  };
}

// ---------------------------------------------------------------------------------------
// Alignment of existing audio
// ---------------------------------------------------------------------------------------

async function audioBlob(audioPath: string): Promise<Blob> {
  return fs.openAsBlob(audioPath);
}

export class ElevenLabsForcedAlignmentProvider implements AlignmentProvider {
  readonly id = "elevenlabs_forced_alignment" as const;
  readonly label = "ElevenLabs forced alignment";
  readonly requiresText = true;

  async isAvailable(): Promise<ProviderAvailability> {
    return getSecret("elevenlabsApiKey") ? { ok: true } : { ok: false, reason: "ElevenLabs API key is not configured." };
  }

  async getAlignment(input: AlignmentInput): Promise<AlignmentResult> {
    if (!input.text?.trim()) throw new AppError("PRECONDITION", "Forced alignment needs the script text.", { hint: "Add the script first, or use speech-to-text." });
    input.onProgress?.(0.1, "Uploading audio to ElevenLabs");
    const form = new FormData();
    form.append("file", await audioBlob(input.audioPath), path.basename(input.audioPath));
    form.append("text", input.text);
    const res = await request("/v1/forced-alignment", { method: "POST", body: form, operation: "Forced alignment", signal: input.signal, timeoutMs: 600_000 });
    input.onProgress?.(0.9, "Normalizing word timing");
    const data = (await res.json()) as ElevenLabsForcedAlignmentResponse;
    const words = wordsFromForcedAlignment(data, input.durationSec);
    if (!words.length) throw new AppError("PROVIDER_ERROR", "Forced alignment returned no words.", { hint: "Check that the audio contains the script being spoken." });
    return {
      words,
      characters: data.characters ? charsFromForcedAlignment(data) : null,
      text: input.text,
      language: null,
      source: "elevenlabs_forced_alignment",
      raw: data,
      quality: typeof data.loss === "number" ? { loss: data.loss } : {},
    };
  }
}

export class ElevenLabsSpeechToTextProvider implements AlignmentProvider {
  readonly id = "elevenlabs_stt" as const;
  readonly label = "ElevenLabs speech-to-text";
  readonly requiresText = false;

  async isAvailable(): Promise<ProviderAvailability> {
    return getSecret("elevenlabsApiKey") ? { ok: true } : { ok: false, reason: "ElevenLabs API key is not configured." };
  }

  async getAlignment(input: AlignmentInput): Promise<AlignmentResult> {
    input.onProgress?.(0.1, "Uploading audio to ElevenLabs");
    const form = new FormData();
    form.append("model_id", getSettings().elevenlabs.sttModelId);
    form.append("file", await audioBlob(input.audioPath), path.basename(input.audioPath));
    form.append("timestamps_granularity", "word");
    form.append("tag_audio_events", "false");
    form.append("diarize", "false");
    if (input.languageCode) form.append("language_code", input.languageCode);
    const res = await request("/v1/speech-to-text", { method: "POST", body: form, operation: "Speech-to-text", signal: input.signal, timeoutMs: 900_000 });
    input.onProgress?.(0.9, "Normalizing word timing");
    const data = (await res.json()) as { text?: string; language_code?: string; words?: ElevenLabsSttWord[] };
    const words = wordsFromSpeechToText(data, input.durationSec);
    if (!words.length) throw new AppError("PROVIDER_ERROR", "Speech-to-text found no speech in this audio.");
    return { words, characters: null, text: data.text ?? words.map((w) => w.text).join(" "), language: data.language_code ?? null, source: "elevenlabs_stt", raw: data, quality: {} };
  }
}
