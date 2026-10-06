import type { Segment, TimedWord } from "../spec/timing";
import {
  interpolateWords,
  sanitizeWords,
  timedCharsFromElevenLabs,
  wordsFromTimedChars,
  type ElevenLabsCharacterAlignment,
} from "../transcript/normalize";
import { hasWordChars } from "../util/text";

/**
 * Imports existing timing data: SRT, WebVTT and JSON (our timeline export, generic
 * segment/word lists, ElevenLabs alignment/STT responses, whisper.cpp JSON).
 * Segment timings from the file are authoritative; word timings are only interpolated
 * when the file has none (and are flagged `interpolated`).
 */

export type TimingFileFormat = "srt" | "vtt" | "json";

export interface TimingCue {
  text: string;
  start: number;
  end: number;
  words?: TimedWord[];
}

export interface ParsedTimingFile {
  format: TimingFileFormat;
  duration: number | null;
  cues: TimingCue[];
  /** File-provided word-level timing (never interpolated). */
  words: TimedWord[] | null;
  warnings: string[];
}

export class TimingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimingParseError";
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** "hh:mm:ss,mmm" · "hh:mm:ss.mmm" · "mm:ss.mmm" · "ss.mmm" */
export function parseClock(value: string): number {
  const m = value.trim().match(/^(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) throw new TimingParseError(`Invalid timestamp "${value}"`);
  const [, a, b, s, ms] = m;
  let hours = 0;
  let minutes = 0;
  if (a !== undefined && b !== undefined) {
    hours = Number(a);
    minutes = Number(b);
  } else if (a !== undefined) {
    minutes = Number(a);
  }
  const millis = ms ? Number(ms.padEnd(3, "0")) : 0;
  return round3(hours * 3600 + minutes * 60 + Number(s) + millis / 1000);
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\{\\[^}]*\}/g, "");

export function parseSrt(content: string): ParsedTimingFile {
  const text = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const cues: TimingCue[] = [];
  const warnings: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    const timingIdx = lines.findIndex((l) => l.includes("-->"));
    if (timingIdx < 0) continue;
    const [left, right] = lines[timingIdx].split("-->");
    try {
      const start = parseClock(left.trim());
      const end = parseClock(right.trim().split(/\s+/)[0]);
      const body = stripTags(lines.slice(timingIdx + 1).join(" ")).replace(/\s+/g, " ").trim();
      if (body) cues.push({ text: body, start, end: Math.max(end, start) });
    } catch (e) {
      warnings.push((e as Error).message);
    }
  }
  if (cues.length === 0) throw new TimingParseError("No subtitle cues found in SRT file.");
  return { format: "srt", duration: null, cues, words: null, warnings };
}

export function parseVtt(content: string): ParsedTimingFile {
  const text = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!/^WEBVTT/.test(text.trimStart())) throw new TimingParseError('Not a WebVTT file (missing "WEBVTT" header).');
  const cues: TimingCue[] = [];
  const warnings: string[] = [];
  const timing = /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;
  let hasInlineWordTiming = false;
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const idx = lines.findIndex((l) => timing.test(l));
    if (idx < 0) continue;
    const m = lines[idx].match(timing)!;
    const start = parseClock(m[1]);
    const end = parseClock(m[2]);
    const rawBody = lines.slice(idx + 1).join(" ");
    // Inline word timestamps: "<00:00:01.200>word <00:00:01.500>next"
    const inline = [...rawBody.matchAll(/<((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})>/g)];
    const body = stripTags(rawBody).replace(/\s+/g, " ").trim();
    if (!body) continue;
    const cue: TimingCue = { text: body, start, end: Math.max(end, start) };
    if (inline.length > 0) {
      hasInlineWordTiming = true;
      const parts = rawBody.split(/<(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}>/);
      const stamps = [start, ...inline.map((x) => parseClock(x[1]))];
      const words: TimedWord[] = [];
      parts.forEach((part, k) => {
        const tokens = stripTags(part).split(/\s+/).filter((t) => t && hasWordChars(t));
        const segStart = stamps[k] ?? start;
        const segEnd = stamps[k + 1] ?? end;
        tokens.forEach((t, n) => {
          const d = (segEnd - segStart) / tokens.length;
          words.push({ i: 0, text: t, start: round3(segStart + d * n), end: round3(segStart + d * (n + 1)) });
        });
      });
      cue.words = words;
    }
    cues.push(cue);
  }
  if (cues.length === 0) throw new TimingParseError("No cues found in WebVTT file.");
  const words = hasInlineWordTiming ? sanitizeWords(cues.flatMap((c) => c.words ?? [])) : null;
  if (hasInlineWordTiming && cues.some((c) => !c.words)) warnings.push("Some cues have no inline word timestamps; their words will be interpolated.");
  return { format: "vtt", duration: null, cues, words: words && cues.every((c) => c.words) ? words : null, warnings };
}

type AnyRecord = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

function readTimed(o: AnyRecord): { text: string; start: number; end: number } | null {
  if (typeof o !== "object" || o === null) return null;
  const text = o.text ?? o.word ?? o.token ?? o.value;
  if (typeof text !== "string") return null;
  if (typeof o.type === "string" && o.type !== "word" && o.type !== "segment") return null;
  let start = num(o.start ?? o.start_time ?? o.startTime ?? o.begin);
  let end = num(o.end ?? o.end_time ?? o.endTime);
  if (start === null || end === null) {
    const offsets = (o.offsets ?? {}) as AnyRecord;
    const sMs = num(o.startMs ?? o.start_ms ?? offsets.from);
    const eMs = num(o.endMs ?? o.end_ms ?? offsets.to);
    if (sMs !== null && eMs !== null) {
      start = sMs / 1000;
      end = eMs / 1000;
    }
  }
  if (start === null || end === null) return null;
  return { text, start, end };
}

function wordsFromList(list: unknown[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const item of list) {
    const t = readTimed(item as AnyRecord);
    if (t && t.text.trim()) out.push({ i: out.length, text: t.text.trim(), start: t.start, end: t.end });
  }
  return sanitizeWords(out.filter((w) => hasWordChars(w.text)));
}

export function parseTimingJson(content: string): ParsedTimingFile {
  let data: unknown;
  try {
    data = JSON.parse(content.replace(/^﻿/, ""));
  } catch (e) {
    throw new TimingParseError(`Invalid JSON: ${(e as Error).message}`);
  }
  const warnings: string[] = [];
  const root = (Array.isArray(data) ? { segments: data } : data) as AnyRecord;
  const duration = num(root.duration ?? root.audio_duration_secs ?? root.durationSec ?? root.duration_seconds);

  // ElevenLabs text-to-speech with-timestamps response (or its alignment object)
  const alignment = (root.alignment ?? (Array.isArray(root.characters) && root.character_start_times_seconds ? root : null)) as
    | ElevenLabsCharacterAlignment
    | null;
  if (alignment && Array.isArray(alignment.characters) && Array.isArray(alignment.character_start_times_seconds)) {
    const words = wordsFromTimedChars(timedCharsFromElevenLabs(alignment));
    if (!words.length) throw new TimingParseError("Alignment JSON contains no words.");
    return { format: "json", duration, cues: [], words, warnings };
  }

  const segList = (root.segments ?? root.cues ?? root.captions ?? root.subtitles) as unknown[] | undefined;
  const topWords = Array.isArray(root.words) ? wordsFromList(root.words) : null;

  if (Array.isArray(segList) && segList.length > 0) {
    const cues: TimingCue[] = [];
    for (const item of segList) {
      const t = readTimed(item as AnyRecord);
      if (!t || !t.text.trim()) continue;
      const nested = (item as AnyRecord).words;
      const cue: TimingCue = { text: t.text.replace(/\s+/g, " ").trim(), start: t.start, end: Math.max(t.end, t.start) };
      if (Array.isArray(nested) && nested.length) cue.words = wordsFromList(nested);
      cues.push(cue);
    }
    if (cues.length === 0) throw new TimingParseError("JSON segments need text, start and end fields.");
    // A flat list of single-word "segments" is really a word list.
    const avgWords = cues.reduce((s, c) => s + c.text.split(/\s+/).length, 0) / cues.length;
    if (!topWords && Array.isArray(data) && avgWords <= 1.2) {
      return { format: "json", duration, cues: [], words: wordsFromList(segList), warnings };
    }
    const nestedWords = cues.every((c) => c.words && c.words.length) ? sanitizeWords(cues.flatMap((c) => c.words!)) : null;
    return { format: "json", duration, cues, words: topWords && topWords.length ? topWords : nestedWords, warnings };
  }

  if (topWords && topWords.length > 0) {
    return { format: "json", duration, cues: [], words: topWords, warnings };
  }

  // whisper.cpp JSON output
  if (Array.isArray(root.transcription)) {
    const cues: TimingCue[] = [];
    for (const item of root.transcription as AnyRecord[]) {
      const t = readTimed(item);
      if (t && t.text.trim()) cues.push({ text: t.text.trim(), start: t.start, end: t.end });
    }
    if (cues.length) return { format: "json", duration, cues, words: null, warnings };
  }

  throw new TimingParseError(
    'Unrecognized timing JSON. Expected {"duration", "segments": [{"text","start","end"}]} or {"words": [{"text","start","end"}]}.',
  );
}

export function parseTimingFile(fileName: string, content: string): ParsedTimingFile {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".srt")) return parseSrt(content);
  if (lower.endsWith(".vtt")) return parseVtt(content);
  if (lower.endsWith(".json")) return parseTimingJson(content);
  const trimmed = content.trimStart();
  if (trimmed.startsWith("WEBVTT")) return parseVtt(content);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseTimingJson(content);
  if (/-->/.test(content)) return parseSrt(content);
  throw new TimingParseError("Unsupported timing file. Use .srt, .vtt or .json.");
}

export interface ImportedWords {
  words: TimedWord[];
  /** Cues as segments (kind "cue") with word ranges — preserved verbatim in the timeline. */
  cues: Segment[];
  interpolatedWords: number;
}

export function wordsFromParsedTiming(parsed: ParsedTimingFile): ImportedWords {
  let words: TimedWord[];
  let interpolatedWords = 0;
  if (parsed.words && parsed.words.length) {
    words = sanitizeWords(parsed.words);
  } else {
    const collected: TimedWord[] = [];
    for (const cue of parsed.cues) {
      if (cue.words && cue.words.length) {
        collected.push(...cue.words);
      } else {
        const w = interpolateWords(cue.text, cue.start, cue.end, collected.length);
        interpolatedWords += w.length;
        collected.push(...w);
      }
    }
    words = sanitizeWords(collected);
  }
  const cues: Segment[] = [];
  parsed.cues.forEach((cue, k) => {
    let first = -1;
    let last = -1;
    for (let i = 0; i < words.length; i++) {
      if (words[i].start >= cue.start - 0.05 && words[i].start < cue.end) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) return;
    cues.push({
      id: `cue_${String(k + 1).padStart(3, "0")}`,
      kind: "cue",
      text: cue.text,
      start: cue.start,
      end: cue.end,
      wordStart: first,
      wordEnd: last + 1,
    });
  });
  return { words, cues, interpolatedWords };
}
