import type { TimedWord } from "../spec/timing";
import { normalizeWord, tokenize } from "../util/text";
import { alignSequences, tokenCost } from "./align";

/**
 * Local forced alignment: puts the user's own script wording onto word timings that came
 * from a transcription (whisper.cpp / speech-to-text). Matched tokens take the spoken word's
 * timing; unmatched script tokens are interpolated between their matched neighbours and
 * flagged `interpolated`. The script is never rewritten — only timed.
 */

export interface TextAlignmentResult {
  words: TimedWord[];
  matchedRatio: number;
  interpolatedWords: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function alignTextToTimedWords(text: string, spoken: TimedWord[], durationSec: number): TextAlignmentResult {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { words: [], matchedRatio: 0, interpolatedWords: 0 };
  if (spoken.length === 0) {
    // Nothing to anchor to: spread evenly across the audio.
    const step = durationSec / tokens.length;
    return {
      words: tokens.map((t, i) => ({ i, text: t.text, start: r3(i * step), end: r3((i + 0.9) * step), interpolated: true })),
      matchedRatio: 0,
      interpolatedWords: tokens.length,
    };
  }

  const pairs = alignSequences(
    tokens.map((t) => t.norm),
    spoken.map((w) => normalizeWord(w.text)),
    tokenCost,
  );
  const timing: ({ start: number; end: number; confidence?: number } | null)[] = new Array(tokens.length).fill(null);
  let matched = 0;
  // Group consecutive (script, spoken) pairs so a replaced multi-word span shares the spoken span's timing.
  let i = 0;
  while (i < pairs.length) {
    const [a, b] = pairs[i];
    if (a !== null && b !== null) {
      const cost = tokenCost(tokens[a].norm, normalizeWord(spoken[b].text));
      timing[a] = { start: spoken[b].start, end: spoken[b].end, ...(spoken[b].confidence !== undefined ? { confidence: spoken[b].confidence } : {}) };
      if (cost < 1) matched++;
      i++;
      continue;
    }
    // Collect a run of gaps and distribute script-only tokens over spoken-only words in the run.
    const scriptRun: number[] = [];
    const spokenRun: number[] = [];
    while (i < pairs.length && (pairs[i][0] === null || pairs[i][1] === null)) {
      if (pairs[i][0] !== null) scriptRun.push(pairs[i][0]!);
      if (pairs[i][1] !== null) spokenRun.push(pairs[i][1]!);
      i++;
    }
    if (scriptRun.length && spokenRun.length) {
      const start = spoken[spokenRun[0]].start;
      const end = spoken[spokenRun[spokenRun.length - 1]].end;
      const step = (end - start) / scriptRun.length;
      scriptRun.forEach((idx, k) => {
        timing[idx] = { start: start + k * step, end: start + (k + 0.92) * step };
      });
    }
  }

  // Interpolate tokens that still have no timing between the nearest timed neighbours.
  let interpolatedWords = 0;
  const words: TimedWord[] = tokens.map((t, idx) => {
    const own = timing[idx];
    if (own) return { i: idx, text: t.text, start: r3(own.start), end: r3(own.end), ...(own.confidence !== undefined ? { confidence: own.confidence } : {}) };
    interpolatedWords++;
    let prev = idx - 1;
    while (prev >= 0 && !timing[prev]) prev--;
    let next = idx + 1;
    while (next < tokens.length && !timing[next]) next++;
    const from = prev >= 0 ? timing[prev]!.end : 0;
    const to = next < tokens.length ? timing[next]!.start : durationSec;
    const gapCount = next - prev - 1;
    const slot = Math.max(0, to - from) / Math.max(1, gapCount);
    const k = idx - prev - 1;
    return { i: idx, text: t.text, start: r3(from + k * slot), end: r3(from + (k + 0.9) * slot), interpolated: true };
  });

  // Enforce monotonic starts.
  for (let k = 1; k < words.length; k++) {
    if (words[k].start < words[k - 1].start) words[k].start = words[k - 1].start;
    if (words[k].end < words[k].start) words[k].end = words[k].start;
  }

  return { words, matchedRatio: r3(matched / tokens.length), interpolatedWords };
}
