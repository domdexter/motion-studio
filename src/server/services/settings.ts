import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONFIG_DIR } from "../env";

/**
 * Local settings live in files (human-readable, machine-local):
 *   storage/config/settings.json  — non-secret preferences (Claude Code may read this)
 *   storage/config/secrets.json   — API keys; never sent to the browser
 * Environment variables (ELEVENLABS_API_KEY) take precedence over saved secrets.
 */

export const ELEVENLABS_OUTPUT_FORMATS = ["mp3_44100_128", "mp3_44100_192", "pcm_44100", "pcm_24000"] as const;

export const SettingsSchema = z.object({
  elevenlabs: z
    .object({
      defaultVoiceId: z.string().nullable().default(null),
      defaultVoiceName: z.string().nullable().default(null),
      defaultModelId: z.string().default("eleven_multilingual_v2"),
      outputFormat: z.enum(ELEVENLABS_OUTPUT_FORMATS).default("mp3_44100_128"),
      sttModelId: z.string().default("scribe_v2"),
      voiceSettings: z
        .object({
          stability: z.number().min(0).max(1).default(0.5),
          similarityBoost: z.number().min(0).max(1).default(0.75),
          style: z.number().min(0).max(1).default(0),
          speed: z.number().min(0.7).max(1.2).default(1),
          useSpeakerBoost: z.boolean().default(true),
        })
        .default({ stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1, useSpeakerBoost: true }),
      apiBaseUrl: z.string().url().default("https://api.elevenlabs.io"),
    })
    .prefault({}),
  voice: z
    .object({
      defaultProvider: z.enum(["elevenlabs", "system"]).default("elevenlabs"),
      systemVoiceName: z.string().nullable().default(null),
      systemRate: z.number().int().min(-10).max(10).default(0),
    })
    .prefault({}),
  alignment: z
    .object({
      defaultMethod: z.enum(["elevenlabs_forced_alignment", "elevenlabs_stt", "whisper_cpp"]).default("elevenlabs_forced_alignment"),
      whisperModel: z.enum(["tiny.en", "base.en", "small.en", "medium.en", "tiny", "base", "small", "medium"]).default("base.en"),
    })
    .prefault({}),
  render: z
    .object({
      defaultFps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(30),
      codec: z.literal("h264").default("h264"),
      crf: z.number().int().min(1).max(51).default(18),
      /** When set, finished final renders are also copied here. */
      outputDir: z.string().nullable().default(null),
      concurrency: z.number().int().min(1).max(32).nullable().default(null),
    })
    .prefault({}),
  ai: z
    .object({
      /** manual: tasks wait for the interactive Claude Code session · headless: the worker runs `claude -p` */
      executor: z.enum(["manual", "headless"]).default("manual"),
      claudeCliPath: z.string().nullable().default(null),
      headlessAllowedTools: z.string().default("Read Glob Grep Edit Write Bash(npm run studio *)"),
      headlessModel: z.string().nullable().default(null),
      headlessMaxBudgetUsd: z.number().positive().nullable().default(null),
      preferNativeGraphics: z.boolean().default(true),
      imageStyle: z.string().default(""),
      alternativesCount: z.number().int().min(1).max(5).default(3),
      storyboardPace: z.enum(["fast", "medium", "slow"]).default("medium"),
    })
    .prefault({}),
  storage: z
    .object({
      /** Overrides STUDIO_PROJECTS_DIR. Applies to all projects; move folders manually when changing. */
      projectsDir: z.string().nullable().default(null),
    })
    .prefault({}),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsInput = z.input<typeof SettingsSchema>;

const SETTINGS_FILE = path.join(CONFIG_DIR, "settings.json");
const SECRETS_FILE = path.join(CONFIG_DIR, "secrets.json");

let cache: { mtimeMs: number; value: Settings } | null = null;

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function getSettings(): Settings {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(SETTINGS_FILE).mtimeMs;
  } catch {
    // no settings file yet → defaults
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache.value;
  const parsed = SettingsSchema.safeParse(mtimeMs < 0 ? {} : readJsonFile(SETTINGS_FILE));
  const value = parsed.success ? parsed.data : SettingsSchema.parse({});
  cache = { mtimeMs, value };
  return value;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (typeof base !== "object" || base === null || Array.isArray(base)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = typeof cur === "object" && cur !== null && !Array.isArray(cur) && typeof v === "object" && v !== null && !Array.isArray(v) ? deepMerge(cur, v as never) : v;
  }
  return out as T;
}

export function updateSettings(patch: DeepPartial<Settings>): Settings {
  const merged = SettingsSchema.parse(deepMerge(getSettings(), patch));
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2) + "\n", "utf8");
  cache = null;
  return getSettings();
}

// ---------------------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------------------

export const SECRET_NAMES = ["elevenlabsApiKey"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

const ENV_FOR_SECRET: Record<SecretName, string> = { elevenlabsApiKey: "ELEVENLABS_API_KEY" };

export function getSecret(name: SecretName): string | null {
  const fromEnv = process.env[ENV_FOR_SECRET[name]]?.trim();
  if (fromEnv) return fromEnv;
  const secrets = readJsonFile(SECRETS_FILE) as Record<string, unknown>;
  const value = secrets[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function setSecret(name: SecretName, value: string | null): void {
  const secrets = readJsonFile(SECRETS_FILE) as Record<string, unknown>;
  if (value && value.trim()) secrets[name] = value.trim();
  else delete secrets[name];
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

export interface SecretStatus {
  configured: boolean;
  source: "env" | "file" | null;
  /** Last 4 characters only — the key itself never leaves the server. */
  last4: string | null;
}

export function secretStatus(name: SecretName): SecretStatus {
  const fromEnv = process.env[ENV_FOR_SECRET[name]]?.trim();
  if (fromEnv) return { configured: true, source: "env", last4: fromEnv.slice(-4) };
  const saved = getSecret(name);
  return saved ? { configured: true, source: "file", last4: saved.slice(-4) } : { configured: false, source: null, last4: null };
}
