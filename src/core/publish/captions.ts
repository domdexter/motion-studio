import type { TimedWord } from "../spec/timing";
import { isMutedAt, type VoiceCut } from "../timeline/audio-clips";

/**
 * Subtitles from the voice-over's word timing: cues of a readable length that break at pauses and
 * sentence ends, skip muted sections, and never overlap. Exported as SRT or WebVTT.
 */

export interface CaptionCue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface CaptionOptions {
  /** Muted sections of the voice-over (their words are left out). */
  cuts?: readonly VoiceCut[];
  /** Most characters in one cue (about two short lines). */
  maxChars?: number;
  /** Longest a cue stays on screen. */
  maxDurationSec?: number;
  /** A pause this long starts a new cue. */
  pauseSec?: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildCaptionCues(words: readonly TimedWord[], options: CaptionOptions = {}): CaptionCue[] {
  const maxChars = options.maxChars ?? 42;
  const maxDuration = options.maxDurationSec ?? 6;
  const pause = options.pauseSec ?? 0.6;
  const cuts = options.cuts ?? [];
  const spoken = words.filter((w) => w.text.trim() && !(cuts.length && isMutedAt((w.start + w.end) / 2, cuts)));
  const cues: CaptionCue[] = [];
  let current: { start: number; end: number; parts: string[] } | null = null;
  const flush = () => {
    if (current?.parts.length) cues.push({ startSec: r3(current.start), endSec: r3(current.end), text: current.parts.join(" ") });
    current = null;
  };
  for (const w of spoken) {
    const text = w.text.trim();
    if (current) {
      const c: { start: number; end: number; parts: string[] } = current;
      const length = c.parts.join(" ").length + 1 + text.length;
      const sentenceEnded = /[.!?]["')\]]?$/.test(c.parts[c.parts.length - 1] ?? "") && c.parts.join(" ").length >= 12;
      if (length > maxChars || w.end - c.start > maxDuration || w.start - c.end > pause || sentenceEnded) flush();
    }
    if (!current) current = { start: w.start, end: w.end, parts: [] };
    const c: { start: number; end: number; parts: string[] } = current;
    c.parts.push(text);
    c.end = w.end;
  }
  flush();
  // Hold each cue a little after its last word, but never into the next one.
  return cues.map((cue, i) => {
    const next = cues[i + 1];
    const end = Math.min(cue.endSec + 0.3, next ? next.startSec - 0.001 : cue.endSec + 0.3);
    return { ...cue, endSec: r3(Math.max(cue.endSec, end)) };
  });
}

/** Breaks a cue into at most two lines near the middle. */
export function wrapCaption(text: string, maxLine = 32): string {
  if (text.length <= maxLine) return text;
  const middle = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

function timestamp(sec: number, separator: "," | "."): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: readonly CaptionCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${timestamp(c.startSec, ",")} --> ${timestamp(c.endSec, ",")}\n${wrapCaption(c.text)}\n`).join("\n");
}

export function toVtt(cues: readonly CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${timestamp(c.startSec, ".")} --> ${timestamp(c.endSec, ".")}\n${wrapCaption(c.text)}\n`).join("\n")}`;
}
