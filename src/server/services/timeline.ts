import { Prisma, type Timeline, type Transcript } from "@/generated/prisma/client";
import { parseScript } from "@/core/script/script";
import type { Segment, TimedWord, TimelineData } from "@/core/spec/timing";
import { compareTimelines, recomputeSceneTimes, remapAnchors, type WordAnchor } from "@/core/timeline/scenes";
import { paragraphIndexForWords } from "@/core/transcript/align";
import { buildTimelineData } from "@/core/transcript/segment";
import { db, json, type DbOrTx, type Tx } from "../db";
import { AppError, notFound } from "../errors";
import { mutateProject, type Actor } from "./mutation";
import { fileUrl } from "./projects";
import { recordSceneVersion, recordStoryboardRevision } from "./scene-history";
import { createSnapshot } from "./snapshots";

/**
 * The master timeline is always derived from word timings (or imported cues). Timeline-editor
 * operations never touch it; scenes reference it through word anchors.
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export async function deriveTimelineData(client: DbOrTx, projectId: string, words: TimedWord[], durationSec: number, cues?: Segment[]): Promise<TimelineData> {
  const script = await client.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { content: true } });
  const paragraphs = script ? parseScript(script.content).spokenParagraphs : [];
  let paragraphOfWord: (number | null)[] | null = null;
  if (paragraphs.length > 1 && words.length) {
    const mapping = paragraphIndexForWords(paragraphs, words);
    const matched = mapping.filter((p) => p !== null).length / words.length;
    if (matched >= 0.6) paragraphOfWord = mapping;
  }
  return buildTimelineData(words, durationSec, { paragraphOfWord, cues });
}

export function transcriptCues(transcript: Pick<Transcript, "meta">): Segment[] | undefined {
  const meta = (transcript.meta ?? null) as { cues?: Segment[] } | null;
  return meta?.cues?.length ? meta.cues : undefined;
}

export async function createTimeline(
  tx: Tx,
  projectId: string,
  input: { transcriptId: string; source: "derived" | "imported"; words: TimedWord[]; durationSec: number; cues?: Segment[]; note?: string },
): Promise<Timeline> {
  const last = await tx.timeline.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { version: true } });
  const data = await deriveTimelineData(tx, projectId, input.words, input.durationSec, input.cues);
  return tx.timeline.create({
    data: { projectId, version: (last?.version ?? 0) + 1, transcriptId: input.transcriptId, source: input.source, durationSec: data.duration, data: json(data), note: input.note ?? "" },
  });
}

/**
 * Runs whenever a transcript becomes active. Without storyboard work the timeline is rebuilt
 * immediately; with scenes present nothing is destroyed — the GUI offers Recalculate / Keep / Compare.
 */
export async function onTranscriptActivated(tx: Tx, projectId: string, transcript: Pick<Transcript, "id" | "words" | "durationSec" | "source" | "meta">): Promise<{ timelineId: string | null; autoActivated: boolean }> {
  const sceneCount = await tx.scene.count({ where: { projectId } });
  if (sceneCount > 0) return { timelineId: null, autoActivated: false };
  const timeline = await createTimeline(tx, projectId, {
    transcriptId: transcript.id,
    source: transcript.source.startsWith("import_") ? "imported" : "derived",
    words: transcript.words as TimedWord[],
    durationSec: transcript.durationSec,
    cues: transcriptCues(transcript),
  });
  await tx.project.update({ where: { id: projectId }, data: { activeTimelineId: timeline.id, timelineDecision: Prisma.DbNull } });
  return { timelineId: timeline.id, autoActivated: true };
}

export async function getTimelineView(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { activeTimeline: true, activeTranscript: true, activeVoiceTake: true },
  });
  if (!project) throw notFound("Project");
  const timeline = project.activeTimeline;
  const timelineTranscript = timeline?.transcriptId
    ? timeline.transcriptId === project.activeTranscript?.id
      ? project.activeTranscript
      : await db.transcript.findUnique({ where: { id: timeline.transcriptId } })
    : null;
  const scenes = await db.scene.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { id: true, key: true, name: true, order: true, startSec: true, endSec: true, timingMode: true, wordStart: true, wordEnd: true, timelineId: true, locked: true, status: true, spec: true },
  });
  const voice = project.activeVoiceTake;
  const candidate =
    project.activeTranscript && timeline && timeline.transcriptId !== project.activeTranscript.id
      ? { transcriptId: project.activeTranscript.id, version: project.activeTranscript.version, source: project.activeTranscript.source, createdAt: project.activeTranscript.createdAt.toISOString() }
      : project.activeTranscript && !timeline
        ? { transcriptId: project.activeTranscript.id, version: project.activeTranscript.version, source: project.activeTranscript.source, createdAt: project.activeTranscript.createdAt.toISOString() }
        : null;
  return {
    fps: project.fps,
    timeline: timeline
      ? {
          id: timeline.id,
          version: timeline.version,
          source: timeline.source,
          durationSec: timeline.durationSec,
          createdAt: timeline.createdAt.toISOString(),
          transcriptId: timeline.transcriptId,
          transcriptVersion: timelineTranscript?.version ?? null,
          data: timeline.data as TimelineData,
        }
      : null,
    /** Words the active timeline was derived from. */
    words: (timelineTranscript?.words ?? []) as TimedWord[],
    /** Words of the active transcript (the audio truth used for word triggers). */
    activeWords: (project.activeTranscript?.words ?? []) as TimedWord[],
    voice: voice
      ? {
          id: voice.id,
          version: voice.version,
          source: voice.source,
          durationSec: voice.durationSec,
          url: fileUrl(projectId, voice.filePath, voice.contentHash.slice(0, 12)),
          peaksUrl: voice.peaksPath ? fileUrl(projectId, voice.peaksPath, voice.contentHash.slice(0, 12)) : null,
        }
      : null,
    voiceMatchesTimeline: !!voice && !!timelineTranscript && timelineTranscript.voiceTakeId === voice.id,
    candidate,
    decision: project.timelineDecision as { voiceTakeId: string; decision: "keep" | "recalculate"; at: string } | null,
    scenes: scenes.map((s) => ({ ...s, stale: s.timingMode === "audio_locked" && !!timeline && s.timelineId !== timeline.id })),
  };
}

interface ScenePlanRow {
  id: string;
  timingMode: string;
  wordStart: number | null;
  wordEnd: number | null;
  startSec: number;
  endSec: number;
}

/** New timing for every scene when moving from oldWords to newWords. */
export function remapSceneTiming(scenes: ScenePlanRow[], oldWords: TimedWord[], newWords: TimedWord[], newDuration: number) {
  const anchored = scenes.map((s) => (s.wordStart !== null && s.wordEnd !== null ? { wordStart: s.wordStart, wordEnd: s.wordEnd } : null));
  const withAnchors = anchored.filter((a): a is WordAnchor => !!a);
  const remapped = oldWords.length && newWords.length ? remapAnchors(oldWords, newWords, withAnchors) : withAnchors;
  let k = 0;
  const inputs = scenes.map((s, i) => {
    const a = anchored[i] ? remapped[k++] : null;
    return {
      timingMode: s.timingMode as "audio_locked" | "user_adjusted",
      wordStart: a?.wordStart ?? null,
      wordEnd: a?.wordEnd ?? null,
      start: s.startSec,
      end: s.endSec,
    };
  });
  const times = recomputeSceneTimes(inputs, newWords, newDuration);
  return scenes.map((s, i) => ({ id: s.id, wordStart: inputs[i].wordStart, wordEnd: inputs[i].wordEnd, startSec: times[i].start, endSec: times[i].end }));
}

export async function recalculateTimeline(projectId: string, actor: Actor) {
  const project = await db.project.findUnique({ where: { id: projectId }, include: { activeTranscript: true, activeTimeline: true } });
  if (!project) throw notFound("Project");
  const transcript = project.activeTranscript;
  if (!transcript) throw new AppError("PRECONDITION", "Align the voice-over before building the timeline.", { action: { label: "Open Voice", href: `/projects/${projectId}/voice#alignment` } });
  const oldTimeline = project.activeTimeline;
  const oldTranscript = oldTimeline?.transcriptId ? await db.transcript.findUnique({ where: { id: oldTimeline.transcriptId } }) : null;

  return mutateProject(projectId, actor, async (tx) => {
    const sceneCount = await tx.scene.count({ where: { projectId } });
    const snapshot = sceneCount ? await createSnapshot(tx, projectId, "Before recalculating timeline", "before_recalculate") : null;
    const newWords = transcript.words as TimedWord[];
    const timeline = await createTimeline(tx, projectId, {
      transcriptId: transcript.id,
      source: transcript.source.startsWith("import_") ? "imported" : "derived",
      words: newWords,
      durationSec: transcript.durationSec,
      cues: transcriptCues(transcript),
      note: oldTimeline ? `Recalculated from transcript v${transcript.version}` : "",
    });
    let remappedScenes = 0;
    if (sceneCount) {
      const scenes = await tx.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
      const plan = remapSceneTiming(scenes, (oldTranscript?.words ?? []) as TimedWord[], newWords, timeline.durationSec);
      for (let i = 0; i < scenes.length; i++) {
        const s = scenes[i];
        const p = plan[i];
        const locked = s.timingMode === "audio_locked";
        const voiceText = p.wordStart !== null && p.wordEnd !== null ? newWords.slice(p.wordStart, p.wordEnd).map((w) => w.text).join(" ") : s.voiceText;
        const updated = await tx.scene.update({
          where: { id: s.id },
          data: {
            ...(locked ? { startSec: p.startSec, endSec: p.endSec, timelineId: timeline.id } : {}),
            wordStart: p.wordStart,
            wordEnd: p.wordEnd,
            voiceText,
            version: { increment: 1 },
          },
        });
        await recordSceneVersion(tx, updated, "system", `Timing recalculated from voice-over (timeline v${timeline.version})`);
        remappedScenes++;
      }
      await recordStoryboardRevision(tx, projectId, "system", `Timing recalculated (timeline v${timeline.version})`);
    }
    await tx.project.update({ where: { id: projectId }, data: { activeTimelineId: timeline.id, timelineDecision: Prisma.DbNull } });
    return {
      result: { timelineId: timeline.id, version: timeline.version, remappedScenes, snapshotVersion: snapshot?.version ?? null },
      activity: {
        type: "timeline.recalculated",
        message: `Built timeline v${timeline.version} (${r3(timeline.durationSec)}s)${remappedScenes ? ` and re-timed ${remappedScenes} scene${remappedScenes === 1 ? "" : "s"}` : ""}${snapshot ? ` · snapshot v${snapshot.version} saved` : ""}`,
      },
    };
  });
}

export async function keepExistingTimeline(projectId: string, actor: Actor): Promise<void> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { activeVoiceTakeId: true, activeTimelineId: true } });
  if (!project) throw notFound("Project");
  if (!project.activeVoiceTakeId || !project.activeTimelineId) throw new AppError("PRECONDITION", "There is no existing timeline to keep.");
  await mutateProject(projectId, actor, async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: { timelineDecision: json({ voiceTakeId: project.activeVoiceTakeId, decision: "keep", at: new Date().toISOString() }) },
    });
    return { result: null, activity: { type: "timeline.kept", message: "Kept the existing timeline after the voice-over changed" } };
  });
}

export async function compareTimelineCandidate(projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, include: { activeTranscript: true, activeTimeline: true } });
  if (!project) throw notFound("Project");
  if (!project.activeTranscript) throw new AppError("PRECONDITION", "Align the new voice-over first to compare timelines.");
  if (!project.activeTimeline) throw new AppError("PRECONDITION", "There is no existing timeline to compare against.");
  const oldTranscript = project.activeTimeline.transcriptId ? await db.transcript.findUnique({ where: { id: project.activeTimeline.transcriptId } }) : null;
  const oldWords = (oldTranscript?.words ?? []) as TimedWord[];
  const newWords = project.activeTranscript.words as TimedWord[];
  const newData = await deriveTimelineData(db, projectId, newWords, project.activeTranscript.durationSec, transcriptCues(project.activeTranscript));
  const oldData = project.activeTimeline.data as TimelineData;
  const comparison = compareTimelines(oldData, oldWords, newData, newWords);
  const scenes = await db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const plan = remapSceneTiming(scenes, oldWords, newWords, newData.duration);
  return {
    old: { version: project.activeTimeline.version, durationSec: oldData.duration, sentences: oldData.sentences.length },
    new: { transcriptVersion: project.activeTranscript.version, durationSec: newData.duration, sentences: newData.sentences.length },
    durationDelta: comparison.durationDelta,
    rows: comparison.rows,
    scenes: scenes.map((s, i) => ({
      key: s.key,
      name: s.name,
      timingMode: s.timingMode,
      oldStart: s.startSec,
      oldEnd: s.endSec,
      newStart: s.timingMode === "audio_locked" ? plan[i].startSec : s.startSec,
      newEnd: s.timingMode === "audio_locked" ? plan[i].endSec : s.endSec,
    })),
  };
}
