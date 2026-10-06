import type { TimedChar, TimedWord } from "../spec/timing";
import { hasWordChars, tokenize } from "../util/text";

/**
 * Provider output → normalized TimedWord[]. Nothing outside this module (and the provider
 * adapters) should know what an ElevenLabs/whisper/SAPI response looks like.
 */

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Sort, clamp, de-negative and re-index words. Optionally clamp to the audio duration. */
export function sanitizeWords(words: TimedWord[], durationSec?: number): TimedWord[] {
  const cleaned = words
    .filter((w) => w.text.trim().length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ ...w, text: w.text.trim(), start: Math.max(0, w.start), end: Math.max(0, w.end) }))
    .sort((a, b) => a.start - b.start);
  return cleaned.map((w, i) => {
    let start = w.start;
    let end = Math.max(w.end, start);
    if (durationSec !== undefined && Number.isFinite(durationSec)) {
      start = Math.min(start, durationSec);
      end = Math.min(end, durationSec);
    }
    return { ...w, i, start: round3(start), end: round3(end) };
  });
}

/** Attaches punctuation-only entries to neighbouring words while building a word list. */
class WordBuilder {
  readonly words: TimedWord[] = [];
  private prefix = "";

  push(text: string, start: number, end: number, extra: Partial<TimedWord> = {}): void {
    const t = text.trim();
    if (!t) return;
    if (!hasWordChars(t)) {
      if (this.words.length > 0) this.words[this.words.length - 1].text += t;
      else this.prefix += t;
      return;
    }
    this.words.push({ i: this.words.length, text: this.prefix + t, start, end, ...extra });
    this.prefix = "";
  }
}

// ---------------------------------------------------------------------------------------
// ElevenLabs text-to-speech `with-timestamps` (character alignment)
// ---------------------------------------------------------------------------------------

export interface ElevenLabsCharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export function timedCharsFromElevenLabs(alignment: ElevenLabsCharacterAlignment, offsetSec = 0): TimedChar[] {
  const n = Math.min(
    alignment.characters.length,
    alignment.character_start_times_seconds.length,
    alignment.character_end_times_seconds.length,
  );
  const out: TimedChar[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      char: alignment.characters[i],
      start: round3(alignment.character_start_times_seconds[i] + offsetSec),
      end: round3(alignment.character_end_times_seconds[i] + offsetSec),
    });
  }
  return out;
}

/** Groups non-whitespace character runs into words; word timing = first char start → last char end. */
export function wordsFromTimedChars(chars: TimedChar[], durationSec?: number): TimedWord[] {
  const builder = new WordBuilder();
  let text = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    if (text) builder.push(text, start, end);
    text = "";
  };
  for (const c of chars) {
    if (!c.char || /\s/.test(c.char)) {
      flush();
      continue;
    }
    if (!text) {
      start = c.start;
      end = c.end;
    } else {
      end = Math.max(end, c.end);
    }
    text += c.char;
  }
  flush();
  return sanitizeWords(builder.words, durationSec);
}

// ---------------------------------------------------------------------------------------
// ElevenLabs forced alignment
// ---------------------------------------------------------------------------------------

export interface ElevenLabsForcedAlignmentResponse {
  characters?: { text: string; start: number; end: number }[];
  words?: { text: string; start: number; end: number; loss?: number }[];
  loss?: number;
}

export function wordsFromForcedAlignment(res: ElevenLabsForcedAlignmentResponse, durationSec?: number): TimedWord[] {
  const builder = new WordBuilder();
  for (const w of res.words ?? []) {
    const extra = typeof w.loss === "number" ? { confidence: round3(clamp01(Math.exp(-w.loss))) } : {};
    builder.push(w.text ?? "", w.start, w.end, extra);
  }
  return sanitizeWords(builder.words, durationSec);
}

export function charsFromForcedAlignment(res: ElevenLabsForcedAlignmentResponse): TimedChar[] {
  return (res.characters ?? []).map((c) => ({ char: c.text, start: round3(c.start), end: round3(c.end) }));
}

// ---------------------------------------------------------------------------------------
// ElevenLabs speech-to-text (Scribe)
// ---------------------------------------------------------------------------------------

export interface ElevenLabsSttWord {
  text: string;
  type?: string;
  start?: number | null;
  end?: number | null;
  logprob?: number | null;
  speaker_id?: string | null;
}

export function wordsFromSpeechToText(res: { words?: ElevenLabsSttWord[] }, durationSec?: number): TimedWord[] {
  const builder = new WordBuilder();
  for (const w of res.words ?? []) {
    if (w.type && w.type !== "word") continue;
    if (typeof w.start !== "number" || typeof w.end !== "number") continue;
    const extra = typeof w.logprob === "number" ? { confidence: round3(clamp01(Math.exp(w.logprob))) } : {};
    builder.push(w.text, w.start, w.end, extra);
  }
  return sanitizeWords(builder.words, durationSec);
}

// ---------------------------------------------------------------------------------------
// Caption-style word lists (whisper.cpp via @remotion/install-whisper-cpp toCaptions)
// ---------------------------------------------------------------------------------------

export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number | null;
}

export function wordsFromCaptions(captions: CaptionWord[], durationSec?: number): TimedWord[] {
  const builder = new WordBuilder();
  for (const c of captions) {
    const extra = typeof c.confidence === "number" ? { confidence: round3(clamp01(c.confidence)) } : {};
    builder.push(c.text, c.startMs / 1000, c.endMs / 1000, extra);
  }
  return sanitizeWords(builder.words, durationSec);
}

// ---------------------------------------------------------------------------------------
// System speech engines that report word *start* positions (Windows SAPI SpeakProgress)
// ---------------------------------------------------------------------------------------

export interface SpeechMark {
  audioMs: number;
  charPos: number;
  charCount: number;
  text: string;
}

/**
 * Word starts come from the engine; ends are provisional (next word start) and should be
 * refined with `refineWordEnds` using the decoded audio envelope.
 */
export function wordsFromSpeechMarks(marks: SpeechMark[], inputText: string, durationSec: number): TimedWord[] {
  const sorted = marks
    .filter((m) => m.charCount > 0 && hasWordChars(m.text))
    .sort((a, b) => a.charPos - b.charPos);
  const words: TimedWord[] = [];
  for (let k = 0; k < sorted.length; k++) {
    const m = sorted[k];
    const nextCharPos = k + 1 < sorted.length ? sorted[k + 1].charPos : inputText.length;
    const tail = inputText.slice(m.charPos + m.charCount, nextCharPos);
    const trailing = tail.match(/^[^\s\p{L}\p{N}]*/u)?.[0] ?? "";
    const text = inputText.slice(m.charPos, m.charPos + m.charCount) + trailing;
    const start = m.audioMs / 1000;
    const nextStart = k + 1 < sorted.length ? sorted[k + 1].audioMs / 1000 : durationSec;
    words.push({ i: k, text, start, end: Math.max(start, nextStart) });
  }
  return sanitizeWords(words, durationSec);
}

export interface AudioEnvelope {
  /** Seconds per envelope value. */
  hopSec: number;
  /** RMS (or peak) amplitude per hop, any positive scale. */
  values: ArrayLike<number>;
}

/**
 * Pulls each word's end back from the next word's start to the last audible hop before it,
 * so pauses between words/sentences are not counted as speech.
 */
export function refineWordEnds(words: TimedWord[], env: AudioEnvelope, durationSec: number): TimedWord[] {
  let peak = 0;
  for (let i = 0; i < env.values.length; i++) peak = Math.max(peak, env.values[i]);
  if (peak <= 0) return words;
  const threshold = Math.max(peak * 0.08, 1e-5);
  return words.map((w, k) => {
    const limit = k + 1 < words.length ? words[k + 1].start : durationSec;
    const i0 = Math.max(0, Math.floor(w.start / env.hopSec));
    const i1 = Math.min(env.values.length - 1, Math.ceil(limit / env.hopSec) - 1);
    let lastLoud = -1;
    for (let i = i1; i >= i0; i--) {
      if (env.values[i] > threshold) {
        lastLoud = i;
        break;
      }
    }
    const rawEnd = lastLoud < 0 ? Math.min(limit, w.start + 0.12) : Math.min(limit, (lastLoud + 1) * env.hopSec);
    return { ...w, end: round3(Math.min(limit, Math.max(w.start + 0.03, rawEnd))) };
  });
}

// ---------------------------------------------------------------------------------------
// Interpolation (segment-level timing without word-level data)
// ---------------------------------------------------------------------------------------

/** Distributes a text span's words across [start, end) proportionally to word length. */
export function interpolateWords(text: string, start: number, end: number, firstIndex = 0): TimedWord[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  const span = Math.max(0, end - start);
  const weights = tokens.map((t) => Math.max(2, t.norm.length) + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = start;
  return tokens.map((t, k) => {
    const dur = (span * weights[k]) / total;
    const word: TimedWord = {
      i: firstIndex + k,
      text: t.text,
      start: round3(cursor),
      end: round3(cursor + dur * 0.92),
      interpolated: true,
    };
    cursor += dur;
    return word;
  });
}

export function transcriptText(words: TimedWord[]): string {
  return words.map((w) => w.text).join(" ");
}
