import { z } from "zod";
import { parseScript } from "@/core/script/script";
import type { TimedWord } from "@/core/spec/timing";
import { alignTextToTimedWords } from "@/core/transcript/force-align";
import { db } from "../db";
import { AppError } from "../errors";
import { enqueueJob, publicJob } from "../jobs/queue";
import type { JobHandlerContext } from "../jobs/types";
import { ALIGNMENT_LABELS, getAlignmentProvider, type AlignmentMethod } from "../providers";
import { projectFile } from "../storage/paths";
import { mutateProject } from "./mutation";
import { getSettings } from "./settings";
import { onTranscriptActivated } from "./timeline";
import { createTranscriptRow, writeCharacters, writeRaw } from "./transcripts";

export const AlignSchema = z.object({
  method: z.enum(["elevenlabs_forced_alignment", "elevenlabs_stt", "whisper_cpp"]).optional(),
  /** whisper.cpp only: keep the script's wording and take timing from the transcription. */
  useScript: z.boolean().optional(),
  languageCode: z.string().max(10).nullable().optional(),
});

const JOB_FOR_METHOD = {
  elevenlabs_forced_alignment: "alignment.forced",
  elevenlabs_stt: "alignment.stt",
  whisper_cpp: "alignment.whisper",
} as const;

interface AlignPayload {
  method: AlignmentMethod;
  voiceTakeId: string;
  useScript: boolean;
  languageCode: string | null;
  scriptRevisionId: string | null;
}

export async function enqueueAlignment(projectId: string, input: z.input<typeof AlignSchema>) {
  const data = AlignSchema.parse(input);
  const method = data.method ?? getSettings().alignment.defaultMethod;
  const [project, script] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { activeVoiceTakeId: true } }),
    db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" } }),
  ]);
  if (!project?.activeVoiceTakeId) {
    throw new AppError("PRECONDITION", "Generate or import a voice-over before aligning.", { action: { label: "Open Voice", href: `/projects/${projectId}/voice` } });
  }
  const hasScript = !!script && parseScript(script.content).wordCount > 0;
  if (method === "elevenlabs_forced_alignment" && !hasScript) {
    throw new AppError("PRECONDITION", "Forced alignment needs the script.", {
      hint: "Add the script first, or use speech-to-text / local transcription for audio without a script.",
      action: { label: "Open Script", href: `/projects/${projectId}/script` },
    });
  }
  const provider = await getAlignmentProvider(method);
  const availability = await provider.isAvailable();
  if (!availability.ok) {
    throw new AppError("NOT_CONFIGURED", availability.reason ?? `${ALIGNMENT_LABELS[method]} is unavailable.`, {
      action: { label: "Open settings", href: method === "whisper_cpp" ? "/settings#alignment" : "/settings#elevenlabs" },
    });
  }
  const running = await db.job.count({ where: { projectId, type: { startsWith: "alignment." }, status: { in: ["queued", "running"] } } });
  if (running) throw new AppError("CONFLICT", "An alignment is already running for this project.");
  const payload: AlignPayload = {
    method,
    voiceTakeId: project.activeVoiceTakeId,
    useScript: method === "whisper_cpp" ? !!data.useScript && hasScript : false,
    languageCode: data.languageCode ?? null,
    scriptRevisionId: script?.id ?? null,
  };
  return publicJob(await enqueueJob({ projectId, type: JOB_FOR_METHOD[method], payload }));
}

export async function runAlignment(ctx: JobHandlerContext) {
  const projectId = ctx.job.projectId!;
  const payload = ctx.job.payload as unknown as AlignPayload;
  const take = await db.voiceTake.findUnique({ where: { id: payload.voiceTakeId } });
  if (!take) throw new AppError("NOT_FOUND", "The voice take for this alignment was deleted.");
  const script = payload.scriptRevisionId ? await db.scriptRevision.findUnique({ where: { id: payload.scriptRevisionId } }) : null;
  const scriptText = script ? parseScript(script.content).spokenText : "";
  const provider = await getAlignmentProvider(payload.method);

  await ctx.progress(0.03, `Starting ${ALIGNMENT_LABELS[payload.method]}`);
  const result = await provider.getAlignment({
    audioPath: projectFile(projectId, take.filePath),
    durationSec: take.durationSec,
    text: provider.requiresText ? scriptText : undefined,
    languageCode: payload.languageCode,
    signal: ctx.signal,
    onProgress: (fraction, stage) => void ctx.progress(Math.min(0.9, fraction), stage),
  });

  let words: TimedWord[] = result.words;
  let text = result.text;
  let meta: Record<string, unknown> | null = null;
  let quality: Record<string, unknown> = { ...result.quality };
  if (payload.useScript && scriptText) {
    const aligned = alignTextToTimedWords(scriptText, result.words, take.durationSec);
    quality = { ...quality, matchedRatio: aligned.matchedRatio, interpolatedWords: aligned.interpolatedWords };
    if (aligned.matchedRatio >= 0.5) {
      meta = { spoken: { text: result.text, words: result.words } };
      words = aligned.words;
      text = scriptText;
    } else {
      meta = { warnings: [`Only ${Math.round(aligned.matchedRatio * 100)}% of the script matched the speech — kept the transcription wording.`] };
    }
  }

  await ctx.progress(0.93, "Saving word timing");
  const stem = `alignment-${payload.method}-${Date.now()}`;
  const [charactersPath, rawPath] = await Promise.all([writeCharacters(projectId, stem, result.characters), writeRaw(projectId, stem, result.raw)]);

  return mutateProject(projectId, "worker", async (tx) => {
    const transcript = await createTranscriptRow(tx, projectId, {
      voiceTakeId: take.id,
      source: result.source,
      words,
      text,
      language: result.language,
      durationSec: take.durationSec,
      charactersPath,
      rawPath,
      quality,
      meta,
    });
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { activeVoiceTakeId: true } });
    let timelineCreated = false;
    if (project?.activeVoiceTakeId === take.id) {
      await tx.project.update({ where: { id: projectId }, data: { activeTranscriptId: transcript.id } });
      timelineCreated = (await onTranscriptActivated(tx, projectId, transcript)).autoActivated;
    }
    return {
      result: { transcriptId: transcript.id, version: transcript.version, words: words.length, timelineCreated, quality },
      activity: {
        type: "voice.aligned",
        message: `Aligned voice-over v${take.version} with ${ALIGNMENT_LABELS[payload.method]}: ${words.length} words${typeof quality.matchedRatio === "number" ? ` (${Math.round((quality.matchedRatio as number) * 100)}% script match)` : ""}${timelineCreated ? " → timeline built" : ""}`,
      },
    };
  });
}
