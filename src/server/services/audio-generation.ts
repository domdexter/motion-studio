import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db } from "../db";
import { TMP_DIR } from "../env";
import { AppError, notFound } from "../errors";
import { assertProjectId } from "../ids";
import { enqueueJob, publicJob } from "../jobs/queue";
import type { JobHandlerContext } from "../jobs/types";
import type { TimedWord } from "@/core/spec/timing";
import { ElevenLabsVoiceProvider, MUSIC_LENGTH_SEC, SFX_LENGTH_SEC, composeMusic, generateSoundEffect, type GeneratedAudioClip } from "../providers/elevenlabs";
import type { VoiceSettingsInput } from "../providers/types";
import { importAsset } from "./assets";
import { addAudioTrack } from "./audio-tracks";
import type { Actor } from "./mutation";
import { getSecret } from "./settings";
import { getProjectState } from "./state";

/**
 * ElevenLabs music, sound-effect and voice-line generation. Runs as a worker job: the generated audio
 * lands in the project's audio library (source "elevenlabs", prompt kept) and is optionally placed on
 * the timeline. A voice line (`kind: "voice"`, `prompt` = the words) is spoken with the active
 * voice-over's voice, model and settings but stays a separate track, so the main take and its timing
 * are untouched (e.g. a call to action after the narration).
 */

export const GenerateAudioSchema = z
  .object({
    kind: z.enum(["music", "sfx", "voice"]),
    prompt: z.string().trim().min(3, "Describe the music or sound you want, or write the line to speak.").max(4000),
    /** Music: defaults to the video length. SFX: empty lets the model pick. */
    durationSec: z.number().positive().max(MUSIC_LENGTH_SEC.max).nullable().optional(),
    /** Music only — guarantees no vocals. */
    instrumental: z.boolean().default(true),
    /** SFX only — seamless loop. */
    loop: z.boolean().default(false),
    promptInfluence: z.number().min(0).max(1).optional(),
    name: z.string().trim().max(120).optional(),
    addToTimeline: z.boolean().default(true),
    startSec: z.number().min(0).max(24 * 3600).default(0),
  })
  .strict();

interface VoiceLineSource {
  voiceId: string;
  voiceName: string | null;
  modelId: string | null;
  settings?: VoiceSettingsInput;
  outputFormat?: string;
  /** Tail of the main voice-over text, so the line continues its delivery. */
  previousText?: string;
}

type AudioPayload = z.output<typeof GenerateAudioSchema> & { durationSec: number | null; actor: Actor; voice?: VoiceLineSource | null };

const SETTINGS_ACTION = { label: "Open ElevenLabs settings", href: "/settings#elevenlabs" };

export async function enqueueAudioGeneration(projectId: string, input: z.input<typeof GenerateAudioSchema>, actor: Actor) {
  assertProjectId(projectId);
  const data = GenerateAudioSchema.parse(input);
  if (!(await db.project.findUnique({ where: { id: projectId }, select: { id: true } }))) throw notFound("Project");
  if (!getSecret("elevenlabsApiKey")) {
    throw new AppError("NOT_CONFIGURED", "ElevenLabs API key is not configured.", {
      hint: "Add your key in Settings (or set ELEVENLABS_API_KEY) to generate music and sound effects — or upload your own audio.",
      action: SETTINGS_ACTION,
    });
  }
  let durationSec: number | null = data.durationSec ?? null;
  let voice: VoiceLineSource | null = null;
  if (data.kind === "voice") {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { activeVoiceTakeId: true } });
    const take = project?.activeVoiceTakeId ? await db.voiceTake.findUnique({ where: { id: project.activeVoiceTakeId } }) : null;
    if (!take || take.source !== "elevenlabs" || !take.voiceId) {
      throw new AppError("PRECONDITION", "Voice lines are spoken with the active ElevenLabs voice-over's voice.", { hint: "Generate the voice-over with ElevenLabs first." });
    }
    const stored = (take.settings ?? {}) as { voiceSettings?: VoiceSettingsInput | null; outputFormat?: string };
    voice = {
      voiceId: take.voiceId,
      voiceName: take.voiceName,
      modelId: take.modelId,
      settings: stored.voiceSettings ?? undefined,
      outputFormat: stored.outputFormat,
      previousText: take.inputText ? take.inputText.slice(-500) : undefined,
    };
    durationSec = null;
  } else if (data.kind === "music") {
    if (durationSec === null) {
      const state = await getProjectState(projectId);
      durationSec = state.durationSec ? Math.ceil(state.durationSec - data.startSec) : 30;
    }
    if (durationSec < MUSIC_LENGTH_SEC.min || durationSec > MUSIC_LENGTH_SEC.max) {
      throw new AppError("VALIDATION", `Music length must be between ${MUSIC_LENGTH_SEC.min} and ${MUSIC_LENGTH_SEC.max} seconds.`);
    }
  } else if (data.kind === "sfx" && durationSec !== null && (durationSec < SFX_LENGTH_SEC.min || durationSec > SFX_LENGTH_SEC.max)) {
    throw new AppError("VALIDATION", `Sound effects must be between ${SFX_LENGTH_SEC.min} and ${SFX_LENGTH_SEC.max} seconds (or leave the length empty).`);
  }
  const active = await db.job.count({ where: { projectId, type: "audio.generate", status: { in: ["queued", "running"] } } });
  if (active >= 3) throw new AppError("CONFLICT", "Three audio generations are already running for this project — wait for one to finish.");
  const payload: AudioPayload = { ...data, durationSec, actor, voice };
  return publicJob(await enqueueJob({ projectId, type: "audio.generate", payload }));
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function fileStem(kind: "music" | "sfx" | "voice", prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join("-");
  return `${kind}-${words || "generated"}`.slice(0, 60);
}

export async function runAudioGeneration(ctx: JobHandlerContext) {
  const projectId = ctx.job.projectId!;
  const p = ctx.job.payload as unknown as AudioPayload;
  await ctx.progress(0.05, p.kind === "music" ? "Composing music with ElevenLabs" : p.kind === "voice" ? "Speaking the line with ElevenLabs" : "Generating the sound effect with ElevenLabs");
  const heartbeat = setInterval(() => void ctx.progress(Number.NaN).catch(() => undefined), 5000);
  let clip: GeneratedAudioClip;
  let extension = "mp3";
  let words: TimedWord[] | null = null;
  try {
    if (p.kind === "voice") {
      if (!p.voice) throw new AppError("PRECONDITION", "This voice line has no voice to speak with.");
      const spoken = await new ElevenLabsVoiceProvider().generateVoice({
        text: p.prompt,
        voiceId: p.voice.voiceId,
        modelId: p.voice.modelId,
        settings: p.voice.settings,
        outputFormat: p.voice.outputFormat,
        previousText: p.voice.previousText,
        signal: ctx.signal,
      });
      clip = { audio: spoken.audio, meta: { ...spoken.meta, voiceName: p.voice.voiceName } };
      extension = spoken.extension;
      words = spoken.words;
    } else {
      clip =
        p.kind === "music"
          ? await composeMusic({ prompt: p.prompt, lengthSec: p.durationSec ?? 30, instrumental: p.instrumental, signal: ctx.signal })
          : await generateSoundEffect({ prompt: p.prompt, durationSec: p.durationSec, promptInfluence: p.promptInfluence, loop: p.loop, signal: ctx.signal });
    }
  } finally {
    clearInterval(heartbeat);
  }

  await ctx.progress(0.85, "Adding to the audio library");
  await fs.mkdir(TMP_DIR, { recursive: true });
  const tmp = path.join(TMP_DIR, `elevenlabs-${p.kind}-${randomUUID()}.${extension}`);
  await fs.writeFile(tmp, clip.audio);
  const label = p.kind === "music" ? "Music" : p.kind === "voice" ? "Voice line" : "SFX";
  let asset;
  try {
    asset = await importAsset(
      projectId,
      {
        sourcePath: tmp,
        originalName: `${fileStem(p.kind, p.prompt)}.${extension}`,
        kind: p.kind === "voice" ? "audio" : p.kind,
        source: "elevenlabs",
        name: p.name || `${label} · ${p.prompt.length > 48 ? `${p.prompt.slice(0, 47)}…` : p.prompt}`,
        prompt: p.prompt,
        generator: p.kind === "music" ? "elevenlabs-music" : p.kind === "voice" ? "elevenlabs-tts" : "elevenlabs-sfx",
        tags: ["elevenlabs", p.kind === "voice" ? "voice-line" : p.kind],
        move: true,
      },
      p.actor,
    );
  } finally {
    await fs.rm(tmp, { force: true });
  }

  let trackId: string | null = null;
  if (p.addToTimeline) {
    await ctx.progress(0.95, "Placing it on the timeline");
    const track = await addAudioTrack(projectId, { assetId: asset.id, kind: p.kind, startSec: p.startSec }, p.actor);
    trackId = track.id;
  }
  await ctx.progress(1, "Done");
  return {
    assetId: asset.id,
    name: asset.name,
    durationSec: asset.durationSec,
    trackId,
    // Voice lines: word timing relative to the clip start (add the track's start for video time).
    ...(words ? { words: words.map((w) => ({ text: w.text, start: r3(w.start), end: r3(w.end) })) } : {}),
    meta: clip.meta,
  };
}
