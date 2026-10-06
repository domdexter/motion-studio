/**
 * Text utilities shared by the transcript, script and storyboard engines.
 * Isomorphic: no Node APIs.
 */

const FANCY_APOSTROPHES = /[‘’ʼ`´]/g;
const FANCY_QUOTES = /[“”„«»]/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;

export function hasWordChars(text: string): boolean {
  return WORD_CHAR.test(text);
}

/**
 * Comparison form of a single word: lowercase, straight apostrophes, no surrounding
 * punctuation, thousands separators removed ("1,000" → "1000"), decimals kept ("3.5").
 */
export function normalizeWord(raw: string): string {
  let s = raw.normalize("NFKC").replace(FANCY_APOSTROPHES, "'").replace(FANCY_QUOTES, '"').toLowerCase();
  s = s.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}%]+$/u, "");
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  s = s.replace(/[^\p{L}\p{N}'.%-]/gu, "");
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, "");
  return s;
}

export interface TextToken {
  /** Original text including attached punctuation, e.g. "business," */
  text: string;
  /** normalizeWord(text) */
  norm: string;
  /** Character offsets into the source string [start, end). */
  start: number;
  end: number;
}

/**
 * Whitespace tokenizer that keeps punctuation attached to words. Punctuation-only chunks
 * (a free-standing "—") are merged into the previous token (or the next, at the start).
 */
export function tokenize(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  const re = /\S+/g;
  let pendingPrefixStart: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const chunk = m[0];
    const start = m.index;
    const end = start + chunk.length;
    if (!hasWordChars(chunk)) {
      if (tokens.length > 0) {
        const last = tokens[tokens.length - 1];
        last.text = text.slice(last.start, end);
        last.end = end;
      } else if (pendingPrefixStart === null) {
        pendingPrefixStart = start;
      }
      continue;
    }
    const tokenStart = pendingPrefixStart ?? start;
    tokens.push({ text: text.slice(tokenStart, end), norm: normalizeWord(chunk), start: tokenStart, end });
    pendingPrefixStart = null;
  }
  return tokens;
}

const SENTENCE_END = /[.!?…]+["'”’»)\]]*$/;
const CLAUSE_END = /[,;:—–]["'”’»)\]]*$|\s[-–—]+$/;
const ABBREVIATIONS = new Set([
  "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.", "vs.", "e.g.", "i.e.",
  "inc.", "ltd.", "co.", "u.s.", "u.k.", "a.m.", "p.m.", "no.", "approx.", "dept.",
]);

export function endsSentence(wordText: string): boolean {
  const t = wordText.trim();
  if (!SENTENCE_END.test(t)) return false;
  const bare = t.toLowerCase().replace(/["'”’»)\]]+$/, "");
  return !ABBREVIATIONS.has(bare);
}

export function endsClause(wordText: string): boolean {
  return CLAUSE_END.test(wordText.trim());
}

export function isQuestion(text: string): boolean {
  return /\?["'”’»)\]]*\s*$/.test(text.trim());
}

const STOP_WORDS = new Set(
  (
    "a an the and or but if then so of to in on at by for with from as is are was were be been being am " +
    "it its it's this that these those there here we you they i he she him her them our ours your yours " +
    "their theirs my me us do does did doing done have has had having not no nor can could will would " +
    "should shall may might must just very really more most much many some any all every each what which " +
    "who whom whose why how when where than too also into onto about over under up down out off again " +
    "only own same such both few other s t don't doesn't didn't isn't aren't wasn't weren't won't can't " +
    "shouldn't wouldn't couldn't that's there's it's we're you're they're i'm we've you've they've i've " +
    "let's get got gets make makes made one's yet still even ever while because since until"
  ).split(/\s+/),
);

export function isStopWord(norm: string): boolean {
  return STOP_WORDS.has(norm);
}

export function capitalizeFirst(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export function stripTrailingPunctuation(s: string): string {
  return s.replace(/[\s.,;:!?…—–-]+$/u, "");
}

export function countWords(text: string): number {
  return tokenize(text).length;
}

/** Splits prose into sentences, preserving original spacing inside each sentence. */
export function splitSentences(text: string): string[] {
  const tokens = tokenize(text);
  const out: string[] = [];
  let startTok = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (endsSentence(tokens[i].text) || i === tokens.length - 1) {
      out.push(text.slice(tokens[startTok].start, tokens[i].end).trim());
      startTok = i + 1;
    }
  }
  return out.filter(Boolean);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function slugify(input: string, maxLength = 40): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "project";
}
