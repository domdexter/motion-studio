import { buildCaptionCues, toSrt, toVtt, type CaptionCue } from "@/core/publish/captions";
import { buildChapters, chaptersText, MIN_CHAPTERS, type Chapter } from "@/core/publish/chapters";
import type { TimedWord } from "@/core/spec/timing";
import { parseVoiceMix } from "@/core/timeline/audio-clips";
import { db } from "../db";
import { AppError, notFound } from "../errors";
import { assertProjectId } from "../ids";

/** Publishing exports: captions from the voice-over's word timing, and YouTube chapters from the scenes. */

export async function captionCuesForProject(projectId: string): Promise<CaptionCue[]> {
  assertProjectId(projectId);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { mix: true, activeTranscript: { select: { words: true } } } });
  if (!project) throw notFound("Project");
  const words = (project.activeTranscript?.words ?? []) as TimedWord[];
  if (!words.length) {
    throw new AppError("PRECONDITION", "Captions need a transcript of the voice-over.", { action: { label: "Open Voice", href: `/projects/${projectId}/voice` } });
  }
  return buildCaptionCues(words, { cuts: parseVoiceMix(project.mix).cuts });
}

export async function captionsFile(projectId: string, format: "srt" | "vtt"): Promise<string> {
  const cues = await captionCuesForProject(projectId);
  return format === "srt" ? toSrt(cues) : toVtt(cues);
}

export async function chaptersForProject(projectId: string): Promise<{ chapters: Chapter[]; text: string; valid: boolean }> {
  assertProjectId(projectId);
  const scenes = await db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" }, select: { name: true, startSec: true, endSec: true } });
  if (!scenes.length) throw new AppError("PRECONDITION", "Chapters come from the scenes. Generate a storyboard first.", { action: { label: "Open Storyboard", href: `/projects/${projectId}/storyboard` } });
  const chapters = buildChapters(scenes);
  return { chapters, text: chaptersText(chapters), valid: chapters.length >= MIN_CHAPTERS };
}
