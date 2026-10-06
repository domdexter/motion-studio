import type { Pause, Segment, TimedWord, TimelineData } from "../spec/timing";
import { endsClause, endsSentence } from "../util/text";

/**
 * Derives the master timeline structure (sentences, phrases, paragraphs, pauses) from
 * normalized word timings. Pure and deterministic: the same words always produce the
 * same timeline, which is what makes audio-locked scenes reproducible.
 */

export interface SegmentationOptions {
  /** A pause at least this long ends a phrase. */
  phrasePauseSec?: number;
  /** When the transcript has no punctuation at all, pauses this long end sentences. */
  sentencePauseFallbackSec?: number;
  /** A pause this long ends a sentence even without punctuation. */
  forcedSentencePauseSec?: number;
  /** Without script paragraph mapping, a pause this long between sentences starts a new paragraph. */
  paragraphPauseSec?: number;
  maxSentenceWords?: number;
  maxPhraseWords?: number;
  minPauseSec?: number;
}

const DEFAULTS: Required<SegmentationOptions> = {
  phrasePauseSec: 0.35,
  sentencePauseFallbackSec: 0.65,
  forcedSentencePauseSec: 1.6,
  paragraphPauseSec: 1.0,
  maxSentenceWords: 45,
  maxPhraseWords: 14,
  minPauseSec: 0.2,
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const pad = (n: number, width: number) => String(n).padStart(width, "0");

function makeSegment(
  kind: Segment["kind"],
  id: string,
  words: TimedWord[],
  wordStart: number,
  wordEnd: number,
  paragraph?: number,
): Segment {
  return {
    id,
    kind,
    text: words
      .slice(wordStart, wordEnd)
      .map((w) => w.text)
      .join(" "),
    start: words[wordStart].start,
    end: words[wordEnd - 1].end,
    wordStart,
    wordEnd,
    ...(paragraph !== undefined ? { paragraph } : {}),
  };
}

export function findPauses(words: TimedWord[], minGapSec = DEFAULTS.minPauseSec): Pause[] {
  const pauses: Pause[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap >= minGapSec) pauses.push({ start: words[i].end, end: words[i + 1].start, afterWord: i });
  }
  return pauses;
}

/** Forward-fills nulls, then back-fills leading nulls. Returns null if nothing is mapped. */
export function fillParagraphGaps(map: (number | null)[]): number[] | null {
  const firstKnown = map.find((v) => v !== null);
  if (firstKnown === undefined || firstKnown === null) return null;
  let last: number = firstKnown;
  return map.map((v) => {
    if (v !== null) last = v;
    return last;
  });
}

export function buildSentences(
  words: TimedWord[],
  paragraphOfWord: number[] | null,
  options: SegmentationOptions = {},
): Segment[] {
  const o = { ...DEFAULTS, ...options };
  const hasPunctuation = words.some((w) => /[.!?…]/.test(w.text));
  const out: Segment[] = [];
  let ws = 0;
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    let boundary = !next;
    if (next) {
      const gap = next.start - words[i].end;
      const len = i + 1 - ws;
      if (paragraphOfWord && paragraphOfWord[i] !== paragraphOfWord[i + 1]) {
        boundary = true;
      } else if (hasPunctuation) {
        boundary = endsSentence(words[i].text) || gap >= o.forcedSentencePauseSec;
      } else {
        boundary = gap >= o.sentencePauseFallbackSec;
      }
      if (!boundary && len >= o.maxSentenceWords && (endsClause(words[i].text) || gap >= o.phrasePauseSec)) {
        boundary = true;
      }
      if (!boundary && len >= o.maxSentenceWords * 2) boundary = true;
    }
    if (boundary) {
      out.push(makeSegment("sentence", `segment_${pad(out.length + 1, 2)}`, words, ws, i + 1));
      ws = i + 1;
    }
  }
  return out;
}

export function buildParagraphs(
  words: TimedWord[],
  sentences: Segment[],
  paragraphOfWord: number[] | null,
  options: SegmentationOptions = {},
): Segment[] {
  const o = { ...DEFAULTS, ...options };
  const groups: [number, number][] = [];
  let groupStart = 0;
  for (let k = 0; k < sentences.length; k++) {
    const s = sentences[k];
    const next = sentences[k + 1];
    let boundary = !next;
    if (next) {
      boundary = paragraphOfWord
        ? paragraphOfWord[s.wordEnd - 1] !== paragraphOfWord[next.wordStart]
        : next.start - s.end >= o.paragraphPauseSec;
    }
    if (boundary) {
      groups.push([groupStart, k]);
      groupStart = k + 1;
    }
  }
  return groups.map(([a, b], idx) =>
    makeSegment("paragraph", `paragraph_${pad(idx + 1, 2)}`, words, sentences[a].wordStart, sentences[b].wordEnd, idx),
  );
}

export function buildPhrases(words: TimedWord[], sentences: Segment[], options: SegmentationOptions = {}): Segment[] {
  const o = { ...DEFAULTS, ...options };
  const out: Segment[] = [];
  for (const s of sentences) {
    let ps = s.wordStart;
    for (let i = s.wordStart; i < s.wordEnd; i++) {
      const last = i === s.wordEnd - 1;
      let boundary = last;
      if (!last) {
        const gap = words[i + 1].start - words[i].end;
        const len = i + 1 - ps;
        const remaining = s.wordEnd - (i + 1);
        if ((endsClause(words[i].text) || gap >= o.phrasePauseSec) && len >= 2 && remaining >= 2) boundary = true;
        else if (len >= o.maxPhraseWords && remaining >= 2) boundary = true;
      }
      if (boundary) {
        out.push(makeSegment("phrase", `phrase_${pad(out.length + 1, 3)}`, words, ps, i + 1, s.paragraph));
        ps = i + 1;
      }
    }
  }
  return out;
}

function paragraphIndexAt(paragraphs: Segment[], wordIndex: number): number | undefined {
  const p = paragraphs.find((seg) => wordIndex >= seg.wordStart && wordIndex < seg.wordEnd);
  return p?.paragraph;
}

export interface BuildTimelineOptions extends SegmentationOptions {
  /** Script paragraph index per transcript word (from script↔transcript alignment). */
  paragraphOfWord?: (number | null)[] | null;
  /** Imported subtitle/timing cues to preserve verbatim. */
  cues?: Segment[];
}

export function buildTimelineData(
  words: TimedWord[],
  durationSec: number,
  options: BuildTimelineOptions = {},
): TimelineData {
  const lastEnd = words.length ? words[words.length - 1].end : 0;
  const duration = round3(Math.max(durationSec || 0, lastEnd));
  if (words.length === 0) {
    return { timebase: "seconds", duration, sentences: [], phrases: [], paragraphs: [], pauses: [], ...(options.cues ? { cues: options.cues } : {}) };
  }
  const paragraphOfWord = options.paragraphOfWord ? fillParagraphGaps(options.paragraphOfWord) : null;
  const rawSentences = buildSentences(words, paragraphOfWord, options);
  const paragraphs = buildParagraphs(words, rawSentences, paragraphOfWord, options);
  const sentences = rawSentences.map((s) => {
    const paragraph = paragraphIndexAt(paragraphs, s.wordStart);
    return paragraph === undefined ? s : { ...s, paragraph };
  });
  const phrases = buildPhrases(words, sentences, options);
  return {
    timebase: "seconds",
    duration,
    sentences,
    phrases,
    paragraphs,
    pauses: findPauses(words, options.minPauseSec ?? DEFAULTS.minPauseSec),
    ...(options.cues ? { cues: options.cues } : {}),
  };
}
