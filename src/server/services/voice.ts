import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { VoiceTake } from "@/generated/prisma/client";
import { chunkSpokenText } from "@/core/script/chunk";
import { parseScript } from "@/core/script/script";
import type { TimedChar, TimedWord } from "@/core/spec/timing";
import { normalizeVoiceCuts, parseVoiceMix, type VoiceMix } from "@/core/timeline/audio-clips";
import { formatDurationShort } from "@/core/timing/frames";
import { sanitizeWords } from "@/core/transcript/normalize";
import { splitSentences } from "@/core/util/text";
import { db, json } from "../db";
import { TMP_DIR } from "../env";
import { AppError, notFound } from "../errors";
import { randomId } from "../ids";
import { enqueueJob, listJobs, publicJob } from "../jobs/queue";
import type { JobHandlerContext } from "../jobs/types";
import { computePeaks, decodeAudioMono, encodeWav, probeMedia } from "../media/ffmpeg";
import { getVoiceProvider } from "../providers";
import { listElevenLabsVoices } from "../providers/elevenlabs";
import type { GeneratedVoice } from "../providers/types";
import { projectFile, sha256File, writeFileAtomic } from "../storage/paths";
import { validateFileContent } from "../storage/upload";
import { mutateProject, type Actor } from "./mutation";
import { fileUrl } from "./projects";
import { ELEVENLABS_OUTPUT_FORMATS, getSecret, getSettings } from "./settings";
import { onTranscriptActivated } from "./timeline";
import { createTranscriptRow, writeCharacters, writeRaw } from "./transcripts";

export const VoiceSettingsSchema = z.object({
  stability: z.number().min(0).max(1),
  similarityBoost: z.number().min(0).max(1),
  style: z.number().min(0).max(1),
  speed: z.number().min(0.7).max(1.2),
  useSpeakerBoost: z.boolean(),
});

export const GenerateVoiceSchema = z.object({
  provider: z.enum(["elevenlabs", "system"]).optional(),
  voiceId: z.string().max(200).nullable().optional(),
  voiceName: z.string().max(200).nullable().optional(),
  modelId: z.string().max(100).nullable().optional(),
  settings: VoiceSettingsSchema.optional(),
  outputFormat: z.enum(ELEVENLABS_OUTPUT_FORMATS).optional(),
  languageCode: z.string().max(10).nullable().optional(),
  rate: z.number().int().min(-10).max(10).optional(),
});

type GeneratePayload = z.infer<typeof GenerateVoiceSchema> & { provider: "elevenlabs" | "system"; scriptRevisionId: string };

export function voiceTakeDto(take: VoiceTake, activeId: string | null, transcriptCount = 0) {
  const v = take.contentHash.slice(0, 12);
  return {
    id: take.id,
    version: take.version,
    source: take.source,
    label: take.label,
    durationSec: take.durationSec,
    mimeType: take.mimeType,
    sizeBytes: take.sizeBytes,
    sampleRate: take.sampleRate,
    voiceId: take.voiceId,
    voiceName: take.voiceName,
    modelId: take.modelId,
    settings: take.settings,
    scriptRevisionId: take.scriptRevisionId,
    scriptHash: take.scriptHash,
    active: take.id === activeId,
    transcriptCount,
    url: fileUrl(take.projectId, take.filePath, v),
    peaksUrl: take.peaksPath ? fileUrl(take.projectId, take.peaksPath, v) : null,
    createdAt: take.createdAt.toISOString(),
  };
}

export async function getVoiceOverview(projectId: string) {
  const [project, takes, jobs, script] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { activeVoiceTakeId: true, mix: true } }),
    db.voiceTake.findMany({ where: { projectId }, orderBy: { version: "desc" }, include: { _count: { select: { transcripts: true } } } }),
    listJobs(projectId, { types: ["voice.generate", "voice.preview", "alignment.forced", "alignment.stt", "alignment.whisper"], limit: 15 }),
    db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { version: true, content: true, contentHash: true } }),
  ]);
  if (!project) throw notFound("Project");
  const settings = getSettings();
  const parsed = script ? parseScript(script.content) : null;
  return {
    activeVoiceTakeId: project.activeVoiceTakeId,
    mix: parseVoiceMix(project.mix),
    takes: takes.map((t) => voiceTakeDto(t, project.activeVoiceTakeId, t._count.transcripts)),
    jobs,
    script: script ? { version: script.version, contentHash: script.contentHash, characters: parsed!.spokenText.length, words: parsed!.wordCount } : null,
    defaults: {
      provider: settings.voice.defaultProvider,
      elevenlabs: {
        voiceId: settings.elevenlabs.defaultVoiceId,
        voiceName: settings.elevenlabs.defaultVoiceName,
        modelId: settings.elevenlabs.defaultModelId,
        outputFormat: settings.elevenlabs.outputFormat,
        voiceSettings: settings.elevenlabs.voiceSettings,
      },
      system: { voiceName: settings.voice.systemVoiceName, rate: settings.voice.systemRate },
      alignmentMethod: settings.alignment.defaultMethod,
    },
    providers: {
      elevenlabs: { configured: !!getSecret("elevenlabsApiKey") },
      system: { available: process.platform === "win32" },
    },
  };
}

async function nextVoiceVersion(projectId: string): Promise<number> {
  const last = await db.voiceTake.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { version: true } });
  return (last?.version ?? 0) + 1;
}

async function writePeaks(projectId: string, audioRel: string, version: number): Promise<string | null> {
  try {
    const peaks = await computePeaks(projectFile(projectId, audioRel), 100);
    const rel = `audio/voice/v${version}.peaks.json`;
    await writeFileAtomic(projectFile(projectId, rel), JSON.stringify(peaks));
    return rel;
  } catch (err) {
    console.error("[voice] could not compute waveform peaks:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------

export async function importVoiceFile(projectId: string, upload: { tmpPath: string; originalName: string }, actor: Actor) {
  const mimeType = await validateFileContent(upload.tmpPath, upload.originalName, "audio");
  const probe = await probeMedia(upload.tmpPath);
  if (!probe.hasAudio || !probe.durationSec) throw new AppError("UNSUPPORTED_MEDIA", `“${upload.originalName}” has no readable audio track.`);
  if (probe.durationSec < 0.3) throw new AppError("VALIDATION", "The audio is shorter than 0.3 seconds.");
  const version = await nextVoiceVersion(projectId);
  const ext = path.extname(upload.originalName).toLowerCase() || ".audio";
  const rel = `audio/voice/v${version}${ext}`;
  const abs = projectFile(projectId, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.rename(upload.tmpPath, abs).catch(async () => {
    await fs.copyFile(upload.tmpPath, abs);
    await fs.rm(upload.tmpPath, { force: true });
  });
  const [stat, contentHash, peaksPath] = await Promise.all([fs.stat(abs), sha256File(abs), writePeaks(projectId, rel, version)]);
  return mutateProject(projectId, actor, async (tx) => {
    const take = await tx.voiceTake.create({
      data: {
        projectId,
        version,
        source: "import",
        label: upload.originalName,
        filePath: rel,
        mimeType,
        sizeBytes: stat.size,
        contentHash,
        durationSec: probe.durationSec!,
        sampleRate: probe.sampleRate,
        channels: probe.channels,
        peaksPath,
        providerMeta: json({ originalName: upload.originalName, codec: probe.audioCodec, container: probe.formatName }),
      },
    });
    await tx.project.update({ where: { id: projectId }, data: { activeVoiceTakeId: take.id } });
    return {
      result: voiceTakeDto(take, take.id),
      activity: { type: "voice.imported", message: `Imported voice-over v${version} “${upload.originalName}” (${formatDurationShort(probe.durationSec)}) — align it to get word timing` },
    };
  });
}

// ---------------------------------------------------------------------------------------
// Takes
// ---------------------------------------------------------------------------------------

export async function activateVoiceTake(projectId: string, takeId: string, actor: Actor) {
  const take = await db.voiceTake.findFirst({ where: { id: takeId, projectId } });
  if (!take) throw notFound("Voice take");
  const latestTranscript = await db.transcript.findFirst({ where: { voiceTakeId: take.id }, orderBy: { version: "desc" } });
  return mutateProject(projectId, actor, async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { activeVoiceTakeId: take.id, ...(latestTranscript ? { activeTranscriptId: latestTranscript.id } : {}) } });
    const timeline = latestTranscript ? await onTranscriptActivated(tx, projectId, latestTranscript) : { autoActivated: false };
    return {
      result: { timelineCreated: timeline.autoActivated, hasTranscript: !!latestTranscript },
      activity: { type: "voice.activated", message: `Switched to voice-over v${take.version}${latestTranscript ? "" : " (not aligned yet)"}` },
    };
  });
}

export async function deleteVoiceTake(projectId: string, takeId: string, actor: Actor) {
  const [take, project] = await Promise.all([
    db.voiceTake.findFirst({ where: { id: takeId, projectId } }),
    db.project.findUnique({ where: { id: projectId }, select: { activeVoiceTakeId: true } }),
  ]);
  if (!take) throw notFound("Voice take");
  if (project?.activeVoiceTakeId === take.id) throw new AppError("CONFLICT", "This is the active voice-over. Activate another take before deleting it.");
  const files = [take.filePath, take.peaksPath].filter((f): f is string => !!f);
  await mutateProject(projectId, actor, async (tx) => {
    await tx.voiceTake.delete({ where: { id: take.id } });
    return { result: null, activity: { type: "voice.deleted", message: `Deleted voice-over v${take.version}` } };
  });
  await Promise.all(files.map((f) => fs.rm(projectFile(projectId, f), { force: true }).catch(() => undefined)));
}

export const VoiceMixSchema = z.object({
  volume: z.number().min(0).max(2).optional(),
  muted: z.boolean().optional(),
  /** Muted sections of the voice-over in video seconds; replaces the whole list. Timing never changes. */
  cuts: z
    .array(z.object({ startSec: z.number().min(0).max(24 * 3600), endSec: z.number().min(0).max(24 * 3600) }))
    .max(500)
    .optional(),
});

export async function getVoiceMix(projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { mix: true, activeVoiceTake: { select: { durationSec: true } } } });
  if (!project) throw notFound("Project");
  return { mix: parseVoiceMix(project.mix), voiceDurationSec: project.activeVoiceTake?.durationSec ?? null };
}

const cutList = (cuts: VoiceMix["cuts"]) => cuts.map((c) => `${c.startSec.toFixed(2)}–${c.endSec.toFixed(2)}s`).join(", ");

export async function updateVoiceMix(projectId: string, input: z.input<typeof VoiceMixSchema>, actor: Actor): Promise<VoiceMix> {
  const data = VoiceMixSchema.parse(input);
  const { mix: current, voiceDurationSec } = await getVoiceMix(projectId);
  const next: VoiceMix = {
    volume: data.volume ?? current.volume,
    muted: data.muted ?? current.muted,
    cuts: data.cuts ? normalizeVoiceCuts(data.cuts, voiceDurationSec) : current.cuts,
  };
  const message = data.cuts
    ? next.cuts.length
      ? `Voice-over muted sections: ${cutList(next.cuts)}`
      : "Voice-over: removed all muted sections"
    : data.muted !== undefined
      ? `Voice-over ${data.muted ? "muted" : "unmuted"}`
      : `Voice-over volume ${Math.round(next.volume * 100)}%`;
  const label = data.cuts ? "voice-over cuts" : data.muted !== undefined ? (data.muted ? "mute voice-over" : "unmute voice-over") : "voice-over volume";
  await mutateProject(
    projectId,
    actor,
    async (tx) => {
      await tx.project.update({ where: { id: projectId }, data: { mix: json(next) } });
      return { result: null, activity: { type: "voice.mix", message } };
    },
    { history: { label, scope: ["mix"], coalesceKey: data.cuts === undefined && data.muted === undefined ? "mix:volume" : undefined } },
  );
  return next;
}

// ---------------------------------------------------------------------------------------
// Generation (worker jobs)
// ---------------------------------------------------------------------------------------

export async function enqueueVoiceGeneration(projectId: string, input: z.input<typeof GenerateVoiceSchema>, options: { preview: boolean }) {
  const data = GenerateVoiceSchema.parse(input);
  const settings = getSettings();
  const provider = data.provider ?? settings.voice.defaultProvider;
  const script = await db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" } });
  if (!script || !parseScript(script.content).wordCount) {
    throw new AppError("PRECONDITION", "Write or import a script before generating a voice-over.", { action: { label: "Open Script", href: `/projects/${projectId}/script` } });
  }
  const impl = getVoiceProvider(provider);
  const availability = await impl.isAvailable();
  if (!availability.ok) {
    throw new AppError("NOT_CONFIGURED", availability.reason ?? "Voice provider unavailable.", {
      hint: provider === "elevenlabs" ? "Add your ElevenLabs API key, or import an existing voice-over." : undefined,
      action: { label: "Open settings", href: provider === "elevenlabs" ? "/settings#elevenlabs" : "/settings#voice" },
    });
  }
  if (provider === "elevenlabs" && !(data.voiceId ?? settings.elevenlabs.defaultVoiceId)) {
    throw new AppError("VALIDATION", "Choose an ElevenLabs voice first.", { action: { label: "Set a default voice", href: "/settings#elevenlabs" } });
  }
  if (!options.preview) {
    const running = await db.job.count({ where: { projectId, type: "voice.generate", status: { in: ["queued", "running"] } } });
    if (running) throw new AppError("CONFLICT", "A voice-over is already being generated for this project.");
  }
  const payload: GeneratePayload = { ...data, provider, scriptRevisionId: script.id };
  return publicJob(await enqueueJob({ projectId, type: options.preview ? "voice.preview" : "voice.generate", payload }));
}

async function resolveVoiceName(payload: GeneratePayload): Promise<string | null> {
  if (payload.voiceName) return payload.voiceName;
  if (payload.provider === "system") return payload.voiceId ?? getSettings().voice.systemVoiceName;
  const id = payload.voiceId ?? getSettings().elevenlabs.defaultVoiceId;
  try {
    return (await listElevenLabsVoices()).find((v) => v.id === id)?.name ?? getSettings().elevenlabs.defaultVoiceName ?? null;
  } catch {
    return getSettings().elevenlabs.defaultVoiceName ?? null;
  }
}

async function stitchParts(parts: GeneratedVoice[], signal: AbortSignal): Promise<{ audio: Buffer; words: TimedWord[]; characters: TimedChar[] | null; offsets: number[] }> {
  const sampleRate = 44100;
  const decoded: Float32Array[] = [];
  const offsets: number[] = [];
  let total = 0;
  await fs.mkdir(TMP_DIR, { recursive: true });
  for (const part of parts) {
    const tmp = path.join(TMP_DIR, `voice-part-${randomId(8)}.${part.extension}`);
    await fs.writeFile(tmp, part.audio);
    try {
      const pcm = await decodeAudioMono(tmp, sampleRate, signal);
      offsets.push(total / sampleRate);
      decoded.push(pcm);
      total += pcm.length;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  const merged = new Float32Array(total);
  let cursor = 0;
  for (const d of decoded) {
    merged.set(d, cursor);
    cursor += d.length;
  }
  const words = sanitizeWords(parts.flatMap((p, k) => p.words.map((w) => ({ ...w, start: w.start + offsets[k], end: w.end + offsets[k] }))));
  const characters = parts.every((p) => p.characters) ? parts.flatMap((p, k) => p.characters!.map((c) => ({ ...c, start: c.start + offsets[k], end: c.end + offsets[k] }))) : null;
  return { audio: encodeWav(merged, sampleRate), words, characters, offsets };
}

async function scriptForPayload(payload: GeneratePayload) {
  const script = await db.scriptRevision.findUnique({ where: { id: payload.scriptRevisionId } });
  if (!script) throw new AppError("NOT_FOUND", "The script revision used for this job no longer exists.");
  return script;
}

export async function runVoiceGeneration(ctx: JobHandlerContext) {
  const projectId = ctx.job.projectId!;
  const payload = ctx.job.payload as unknown as GeneratePayload;
  const script = await scriptForPayload(payload);
  const settings = getSettings();
  const modelId = payload.provider === "elevenlabs" ? payload.modelId ?? settings.elevenlabs.defaultModelId : null;
  const parsed = parseScript(script.content, { keepAudioTags: !!modelId?.startsWith("eleven_v3") });
  const provider = getVoiceProvider(payload.provider);
  const maxChars = await provider.maxCharacters(modelId);
  const chunks = maxChars && parsed.spokenText.length > maxChars ? chunkSpokenText(parsed.spokenParagraphs, maxChars) : [parsed.spokenText];

  await ctx.progress(0.03, chunks.length > 1 ? `Generating voice-over in ${chunks.length} parts` : "Generating voice-over");
  const parts: GeneratedVoice[] = [];
  const requestIds: string[] = [];
  for (let k = 0; k < chunks.length; k++) {
    if (ctx.cancelled) throw new AppError("BAD_REQUEST", "Cancelled.");
    const part = await provider.generateVoice({
      text: chunks[k],
      voiceId: payload.voiceId ?? null,
      modelId,
      settings: payload.settings,
      outputFormat: payload.outputFormat,
      languageCode: payload.languageCode ?? null,
      rate: payload.rate,
      previousText: k > 0 ? chunks[k - 1].slice(-600) : undefined,
      nextText: k + 1 < chunks.length ? chunks[k + 1].slice(0, 600) : undefined,
      previousRequestIds: requestIds.slice(-3),
      signal: ctx.signal,
    });
    parts.push(part);
    if (typeof part.meta.requestId === "string") requestIds.push(part.meta.requestId);
    await ctx.progress(0.05 + (0.7 * (k + 1)) / chunks.length, chunks.length > 1 ? `Generated part ${k + 1} of ${chunks.length}` : "Processing audio");
  }

  let audio: Buffer;
  let extension: "mp3" | "wav";
  let words: TimedWord[];
  let characters: TimedChar[] | null;
  let offsets = [0];
  if (parts.length === 1) {
    audio = parts[0].audio;
    extension = parts[0].extension;
    words = parts[0].words;
    characters = parts[0].characters;
  } else {
    await ctx.progress(0.78, "Stitching parts");
    const stitched = await stitchParts(parts, ctx.signal);
    audio = stitched.audio;
    extension = "wav";
    words = stitched.words;
    characters = stitched.characters;
    offsets = stitched.offsets;
  }

  const version = await nextVoiceVersion(projectId);
  const rel = `audio/voice/v${version}.${extension}`;
  const abs = projectFile(projectId, rel);
  await writeFileAtomic(abs, audio);
  const probe = await probeMedia(abs);
  const durationSec = probe.durationSec ?? (words.length ? words[words.length - 1].end : 0);
  words = sanitizeWords(words, durationSec);
  if (!words.length) throw new AppError("PROVIDER_ERROR", "The voice provider returned audio without word timing.");
  await ctx.progress(0.88, "Saving audio and alignment");
  const [contentHash, peaksPath, charactersPath, rawPath] = await Promise.all([
    sha256File(abs),
    writePeaks(projectId, rel, version),
    writeCharacters(projectId, `voice-v${version}`, characters),
    writeRaw(projectId, `voice-v${version}.alignment`, { provider: payload.provider, parts: parts.map((p, k) => ({ offsetSec: offsets[k], raw: p.raw, meta: p.meta })) }),
  ]);
  // Mirror the alignment next to the audio as well (audio/voice/vN.alignment.json).
  await writeFileAtomic(projectFile(projectId, `audio/voice/v${version}.alignment.json`), JSON.stringify({ timebase: "seconds", durationSec, words, characters }));
  const voiceName = await resolveVoiceName(payload);
  const stat = await fs.stat(abs);

  const result = await mutateProject(projectId, "worker", async (tx) => {
    const take = await tx.voiceTake.create({
      data: {
        projectId,
        version,
        source: payload.provider === "elevenlabs" ? "elevenlabs" : "system_tts",
        label: voiceName ? `${voiceName}${modelId ? ` · ${modelId}` : ""}` : "",
        filePath: rel,
        mimeType: extension === "wav" ? "audio/wav" : "audio/mpeg",
        sizeBytes: stat.size,
        contentHash,
        durationSec,
        sampleRate: probe.sampleRate,
        channels: probe.channels,
        peaksPath,
        scriptRevisionId: script.id,
        scriptHash: script.contentHash,
        inputText: parsed.spokenText,
        voiceId: payload.voiceId ?? (payload.provider === "elevenlabs" ? settings.elevenlabs.defaultVoiceId : settings.voice.systemVoiceName),
        voiceName,
        modelId,
        settings: json({ voiceSettings: payload.settings ?? (payload.provider === "elevenlabs" ? settings.elevenlabs.voiceSettings : null), outputFormat: payload.outputFormat ?? settings.elevenlabs.outputFormat, rate: payload.rate ?? null }),
        providerMeta: json({ parts: parts.length, requestIds, meta: parts.map((p) => p.meta) }),
      },
    });
    const transcript = await createTranscriptRow(tx, projectId, {
      voiceTakeId: take.id,
      source: parts[0].transcriptSource,
      words,
      text: parsed.spokenText,
      durationSec,
      charactersPath,
      rawPath,
    });
    await tx.project.update({ where: { id: projectId }, data: { activeVoiceTakeId: take.id, activeTranscriptId: transcript.id } });
    const timeline = await onTranscriptActivated(tx, projectId, transcript);
    return {
      result: { voiceTakeId: take.id, version, durationSec, words: words.length, parts: parts.length, timelineCreated: timeline.autoActivated },
      activity: {
        type: "voice.generated",
        message: `Generated voice-over v${version}${voiceName ? ` with ${voiceName}` : ""} from script v${script.version} (${formatDurationShort(durationSec)}, ${words.length} words)${timeline.autoActivated ? " → timeline built" : ""}`,
      },
    };
  });
  return result;
}

export async function runVoicePreview(ctx: JobHandlerContext) {
  const projectId = ctx.job.projectId!;
  const payload = ctx.job.payload as unknown as GeneratePayload;
  const script = await scriptForPayload(payload);
  const parsed = parseScript(script.content);
  let text = "";
  for (const sentence of splitSentences(parsed.spokenParagraphs[0] ?? parsed.spokenText)) {
    if (text && text.length + sentence.length > 240) break;
    text = text ? `${text} ${sentence}` : sentence;
  }
  if (!text) throw new AppError("PRECONDITION", "The script has no spoken text to preview.");
  await ctx.progress(0.1, "Generating preview");
  const provider = getVoiceProvider(payload.provider);
  const settings = getSettings();
  const part = await provider.generateVoice({
    text,
    voiceId: payload.voiceId ?? null,
    modelId: payload.provider === "elevenlabs" ? payload.modelId ?? settings.elevenlabs.defaultModelId : null,
    settings: payload.settings,
    outputFormat: payload.outputFormat,
    rate: payload.rate,
    signal: ctx.signal,
  });
  const rel = `audio/previews/preview-${Date.now()}.${part.extension}`;
  await writeFileAtomic(projectFile(projectId, rel), part.audio);
  const probe = await probeMedia(projectFile(projectId, rel));
  return { url: fileUrl(projectId, rel), text, durationSec: probe.durationSec, voiceName: await resolveVoiceName(payload), provider: payload.provider };
}
