import { fingerprint } from "../util/hash";
import { splitSentences, tokenize } from "../util/text";

/**
 * Script parsing. Scripts are markdown-ish text:
 *   # Headings and [stage directions] on their own line are NOT spoken.
 *   <!-- comments --> are removed.
 *   **bold** / *italic* / _underscored_ words are spoken and recorded as emphasis.
 *   Inline [audio tags] are removed from spoken text unless keepAudioTags is set (eleven_v3).
 *   Blank lines separate paragraphs (beats).
 */

export type ScriptBlockKind = "spoken" | "heading" | "direction";

export interface ScriptBlock {
  kind: ScriptBlockKind;
  raw: string;
  /** Text sent to the voice provider (empty for headings/directions). */
  spoken: string;
  emphasis: string[];
}

export interface ParsedScript {
  blocks: ScriptBlock[];
  spokenParagraphs: string[];
  spokenText: string;
  wordCount: number;
  emphasis: string[];
}

export interface ParseScriptOptions {
  keepAudioTags?: boolean;
}

const HEADING_LINE = /^\s{0,3}#{1,6}\s+/;
const DIRECTION_LINE = /^\s*\[[^\]]*\]\s*$/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

function stripMarkdown(line: string, emphasis: string[], keepAudioTags: boolean): string {
  let s = line.replace(LIST_MARKER, "");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  s = s.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/(\*\*|__)(.+?)\1/g, (_m, _d, inner: string) => {
    emphasis.push(inner.trim());
    return inner;
  });
  s = s.replace(/(^|[^\p{L}\p{N}*_])([*_])(?!\s)(.+?)(?<!\s)\2(?=[^\p{L}\p{N}*_]|$)/gu, (_m, pre: string, _d, inner: string) => {
    emphasis.push(inner.trim());
    return pre + inner;
  });
  if (!keepAudioTags) s = s.replace(/\[[^\]\n]{1,60}\]/g, " ");
  return s;
}

export function parseScript(content: string, options: ParseScriptOptions = {}): ParsedScript {
  const keepAudioTags = options.keepAudioTags ?? false;
  const normalized = content.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const blocks: ScriptBlock[] = [];

  for (const rawBlock of normalized.split(/\n[ \t]*\n/)) {
    if (!rawBlock.trim()) continue;
    let spokenLines: string[] = [];
    let spokenRaw: string[] = [];
    const emphasis: string[] = [];
    const flushSpoken = () => {
      const spoken = spokenLines.join(" ").replace(/\s+/g, " ").trim();
      if (spoken) blocks.push({ kind: "spoken", raw: spokenRaw.join("\n"), spoken, emphasis: [...emphasis] });
      spokenLines = [];
      spokenRaw = [];
      emphasis.length = 0;
    };
    for (const line of rawBlock.split("\n")) {
      if (!line.trim()) continue;
      if (HEADING_LINE.test(line)) {
        flushSpoken();
        blocks.push({ kind: "heading", raw: line, spoken: "", emphasis: [] });
      } else if (DIRECTION_LINE.test(line)) {
        flushSpoken();
        blocks.push({ kind: "direction", raw: line, spoken: "", emphasis: [] });
      } else {
        spokenRaw.push(line);
        spokenLines.push(stripMarkdown(line, emphasis, keepAudioTags));
      }
    }
    flushSpoken();
  }

  const spokenParagraphs = blocks.filter((b) => b.kind === "spoken").map((b) => b.spoken);
  const spokenText = spokenParagraphs.join("\n\n");
  return {
    blocks,
    spokenParagraphs,
    spokenText,
    wordCount: tokenize(spokenText).length,
    emphasis: [...new Set(blocks.flatMap((b) => b.emphasis))],
  };
}

/**
 * Hash of what would actually be spoken. Formatting-only edits (headings, directions,
 * whitespace, emphasis markers) do not change it, so they never make the voice stale.
 */
export function scriptSpokenHash(content: string): string {
  const spoken = parseScript(content).spokenText.toLowerCase().replace(/\s+/g, " ").trim();
  return fingerprint(spoken);
}

export interface EstimatedSentence {
  paragraph: number;
  text: string;
  words: number;
  start: number;
  end: number;
}

export interface EstimatedTiming {
  /** Always true — this timing is derived from word counts, not audio. */
  estimated: true;
  wordsPerMinute: number;
  duration: number;
  paragraphs: { index: number; words: number; start: number; end: number }[];
  sentences: EstimatedSentence[];
}

const SENTENCE_PAUSE = 0.3;
const PARAGRAPH_PAUSE = 0.65;

export function estimateTiming(spokenParagraphs: string[], wordsPerMinute = 150): EstimatedTiming {
  const secPerWord = 60 / Math.max(60, wordsPerMinute);
  let t = 0;
  const paragraphs: EstimatedTiming["paragraphs"] = [];
  const sentences: EstimatedSentence[] = [];
  spokenParagraphs.forEach((p, index) => {
    const pStart = t;
    let pWords = 0;
    const parts = splitSentences(p);
    parts.forEach((text, k) => {
      const words = tokenize(text).length;
      const start = t;
      t += words * secPerWord;
      sentences.push({ paragraph: index, text, words, start: round2(start), end: round2(t) });
      pWords += words;
      if (k < parts.length - 1) t += SENTENCE_PAUSE;
    });
    paragraphs.push({ index, words: pWords, start: round2(pStart), end: round2(t) });
    if (index < spokenParagraphs.length - 1) t += PARAGRAPH_PAUSE;
  });
  return { estimated: true, wordsPerMinute, duration: round2(t), paragraphs, sentences };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
