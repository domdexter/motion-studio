import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Prisma, type Transcript } from "@/generated/prisma/client";
import { TimingParseError, parseTimingFile, wordsFromParsedTiming } from "@/core/import/timing-files";
import { TRANSCRIPT_SOURCE_LABELS, type TimedChar, type TimedWord, type TranscriptSource } from "@/core/spec/timing";
import { formatDurationShort } from "@/core/timing/frames";
import { sanitizeWords } from "@/core/transcript/normalize";
import { db, json, type Tx } from "../db";
import { AppError, notFound } from "../errors";
import { projectFile, writeFileAtomic } from "../storage/paths";
import { validateFileContent } from "../storage/upload";
import { mutateProject, type Actor } from "./mutation";
import { onTranscriptActivated } from "./timeline";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface CreateTranscriptInput {
  voiceTakeId: string;
  source: TranscriptSource;
  words: TimedWord[];
  text?: string;
  language?: string | null;
  durationSec: number;
  charactersPath?: string | null;
  rawPath?: string | null;
  quality?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  parentId?: string | null;
  note?: string;
}

export async function createTranscriptRow(tx: Tx, projectId: string, input: CreateTranscriptInput): Promise<Transcript> {
  const last = await tx.transcript.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { version: true } });
  return tx.transcript.create({
    data: {
      projectId,
      voiceTakeId: input.voiceTakeId,
      version: (last?.version ?? 0) + 1,
      source: input.source,
      text: input.text ?? input.words.map((w) => w.text).join(" "),
      language: input.language ?? null,
      wordCount: input.words.length,
      durationSec: input.durationSec,
      words: json(input.words),
      charactersPath: input.charactersPath ?? null,
      rawPath: input.rawPath ?? null,
      quality: input.quality ? json(input.quality) : Prisma.DbNull,
      meta: input.meta ? json(input.meta) : Prisma.DbNull,
      parentId: input.parentId ?? null,
      note: input.note ?? "",
    },
  });
}

/** Writes character timings next to the audio timing files; returns the relative path. */
export async function writeCharacters(projectId: string, stem: string, characters: TimedChar[] | null): Promise<string | null> {
  if (!characters?.length) return null;
  const rel = `timing/${stem}.characters.json`;
  await writeFileAtomic(projectFile(projectId, rel), JSON.stringify({ timebase: "seconds", characters }));
  return rel;
}

export async function writeRaw(projectId: string, stem: string, raw: unknown): Promise<string | null> {
  if (raw === undefined || raw === null) return null;
  const rel = `timing/${stem}.raw.json`;
  await writeFileAtomic(projectFile(projectId, rel), JSON.stringify(raw));
  return rel;
}

export async function listTranscripts(projectId: string) {
  const [rows, project] = await Promise.all([
    db.transcript.findMany({
      where: { projectId },
      orderBy: { version: "desc" },
      select: { id: true, version: true, source: true, wordCount: true, durationSec: true, voiceTakeId: true, quality: true, note: true, createdAt: true, parentId: true, voiceTake: { select: { version: true } } },
    }),
    db.project.findUnique({ where: { id: projectId }, select: { activeTranscriptId: true } }),
  ]);
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    source: r.source,
    sourceLabel: TRANSCRIPT_SOURCE_LABELS[r.source as TranscriptSource] ?? r.source,
    wordCount: r.wordCount,
    durationSec: r.durationSec,
    voiceTakeId: r.voiceTakeId,
    voiceTakeVersion: r.voiceTake.version,
    quality: r.quality,
    note: r.note,
    parentId: r.parentId,
    active: r.id === project?.activeTranscriptId,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getTranscriptDetail(projectId: string, transcriptId: string) {
  const t = await db.transcript.findFirst({ where: { id: transcriptId, projectId }, include: { voiceTake: { select: { version: true, durationSec: true } } } });
  if (!t) throw notFound("Transcript");
  const meta = (t.meta ?? null) as { cues?: unknown[]; warnings?: string[]; spoken?: { text: string } } | null;
  return {
    id: t.id,
    version: t.version,
    source: t.source,
    sourceLabel: TRANSCRIPT_SOURCE_LABELS[t.source as TranscriptSource] ?? t.source,
    text: t.text,
    language: t.language,
    durationSec: t.durationSec,
    words: t.words as TimedWord[],
    quality: t.quality,
    warnings: meta?.warnings ?? [],
    cues: meta?.cues?.length ?? 0,
    spokenText: meta?.spoken?.text ?? null,
    voiceTakeId: t.voiceTakeId,
    voiceTakeVersion: t.voiceTake.version,
    createdAt: t.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------
// Imported timing (SRT / VTT / JSON)
// ---------------------------------------------------------------------------------------

const SOURCE_BY_FORMAT = { srt: "import_srt", vtt: "import_vtt", json: "import_json" } as const;

export async function importTimingFile(projectId: string, upload: { tmpPath: string; originalName: string }, actor: Actor) {
  await validateFileContent(upload.tmpPath, upload.originalName, "timing");
  const project = await db.project.findUnique({ where: { id: projectId }, include: { activeVoiceTake: true } });
  if (!project) throw notFound("Project");
  const take = project.activeVoiceTake;
  if (!take) {
    throw new AppError("PRECONDITION", "Import or generate the voice-over first — timestamps are applied to the active voice-over.", {
      action: { label: "Open Voice", href: `/projects/${projectId}/voice` },
    });
  }
  const content = await fs.readFile(upload.tmpPath, "utf8");
  let parsed;
  try {
    parsed = parseTimingFile(upload.originalName, content);
  } catch (err) {
    if (err instanceof TimingParseError) throw new AppError("VALIDATION", err.message, { hint: "Supported: SRT, WebVTT, or JSON with segments/words (see PROJECT_SCHEMA.md)." });
    throw err;
  }
  const imported = wordsFromParsedTiming(parsed);
  if (!imported.words.length) throw new AppError("VALIDATION", "The timing file contains no words.");
  const warnings = [...parsed.warnings];
  const lastEnd = imported.words[imported.words.length - 1].end;
  if (lastEnd > take.durationSec + 0.5) warnings.push(`Timing runs to ${lastEnd.toFixed(2)}s but the voice-over is ${take.durationSec.toFixed(2)}s long — later words were clamped.`);
  if (parsed.duration && Math.abs(parsed.duration - take.durationSec) > 0.5) warnings.push(`File duration ${parsed.duration.toFixed(2)}s differs from the voice-over (${take.durationSec.toFixed(2)}s).`);
  if (imported.interpolatedWords) warnings.push(`${imported.interpolatedWords} word timings were interpolated inside cues (segment timing is exact).`);
  const words = sanitizeWords(imported.words, take.durationSec);
  const source = SOURCE_BY_FORMAT[parsed.format];
  const stamp = Date.now();
  const ext = path.extname(upload.originalName).toLowerCase() || `.${parsed.format}`;
  const originalRel = `timing/import-${stamp}${ext}`;
  await fs.mkdir(path.dirname(projectFile(projectId, originalRel)), { recursive: true });
  await fs.copyFile(upload.tmpPath, projectFile(projectId, originalRel));

  return mutateProject(projectId, actor, async (tx) => {
    const transcript = await createTranscriptRow(tx, projectId, {
      voiceTakeId: take.id,
      source,
      words,
      durationSec: take.durationSec,
      rawPath: originalRel,
      quality: { interpolatedWords: imported.interpolatedWords },
      meta: { cues: imported.cues, originalFile: upload.originalName, warnings },
    });
    await tx.project.update({ where: { id: projectId }, data: { activeTranscriptId: transcript.id } });
    const timeline = await onTranscriptActivated(tx, projectId, transcript);
    return {
      result: { transcriptId: transcript.id, version: transcript.version, words: words.length, cues: imported.cues.length, warnings, timelineCreated: timeline.autoActivated },
      activity: {
        type: "timing.imported",
        message: `Imported ${parsed.format.toUpperCase()} timing “${upload.originalName}”: ${words.length} words, ${imported.cues.length} cues${timeline.autoActivated ? " → timeline built" : ""}`,
      },
    };
  });
}

// ---------------------------------------------------------------------------------------
// Manual transcript edits (always a new transcript version)
// ---------------------------------------------------------------------------------------

export const ManualTranscriptSchema = z.object({
  baseTranscriptId: z.string().min(1),
  words: z
    .array(z.object({ text: z.string().trim().min(1).max(120), start: z.number().min(0), end: z.number().min(0) }))
    .min(1)
    .max(50_000),
  note: z.string().max(300).optional(),
});

export async function saveManualTranscript(projectId: string, input: z.input<typeof ManualTranscriptSchema>, actor: Actor) {
  const data = ManualTranscriptSchema.parse(input);
  const base = await db.transcript.findFirst({ where: { id: data.baseTranscriptId, projectId }, include: { voiceTake: true } });
  if (!base) throw notFound("Transcript");
  const duration = base.voiceTake.durationSec;
  data.words.forEach((w, i) => {
    if (w.end < w.start) throw new AppError("VALIDATION", `Word ${i + 1} “${w.text}” ends before it starts.`);
    if (i > 0 && w.start < data.words[i - 1].start - 1e-6) throw new AppError("VALIDATION", `Word ${i + 1} “${w.text}” starts before the previous word.`);
    if (w.end > duration + 0.05) throw new AppError("VALIDATION", `Word ${i + 1} “${w.text}” ends after the voice-over (${duration.toFixed(2)}s).`);
  });
  const words: TimedWord[] = data.words.map((w, i) => ({ i, text: w.text, start: r3(w.start), end: r3(w.end) }));
  return mutateProject(projectId, actor, async (tx) => {
    const transcript = await createTranscriptRow(tx, projectId, {
      voiceTakeId: base.voiceTakeId,
      source: "manual",
      words,
      durationSec: duration,
      language: base.language,
      parentId: base.id,
      note: data.note ?? `Edited from v${base.version}`,
    });
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { activeVoiceTakeId: true } });
    let timelineCreated = false;
    if (project?.activeVoiceTakeId === base.voiceTakeId) {
      await tx.project.update({ where: { id: projectId }, data: { activeTranscriptId: transcript.id } });
      timelineCreated = (await onTranscriptActivated(tx, projectId, transcript)).autoActivated;
    }
    return {
      result: { transcriptId: transcript.id, version: transcript.version, timelineCreated },
      activity: { type: "transcript.edited", message: `Saved transcript v${transcript.version} (manual edit of v${base.version}, ${words.length} words, ${formatDurationShort(duration)})` },
    };
  });
}

export async function activateTranscript(projectId: string, transcriptId: string, actor: Actor) {
  const t = await db.transcript.findFirst({ where: { id: transcriptId, projectId } });
  if (!t) throw notFound("Transcript");
  return mutateProject(projectId, actor, async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { activeTranscriptId: t.id, activeVoiceTakeId: t.voiceTakeId } });
    const timeline = await onTranscriptActivated(tx, projectId, t);
    return { result: { timelineCreated: timeline.autoActivated }, activity: { type: "transcript.activated", message: `Activated transcript v${t.version}` } };
  });
}
