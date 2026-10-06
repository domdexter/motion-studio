import type { TimedWord } from "../spec/timing";
import { normalizeWord, tokenize, type TextToken } from "../util/text";

/**
 * Sequence alignment between the written script and what was actually spoken.
 *
 * Used to (1) show script ↔ transcript differences without ever overwriting the script,
 * (2) map transcript words to script paragraphs, and (3) remap scene word anchors when a
 * voice-over is replaced.
 */

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
  thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: "100", thousand: "1000", million: "1000000", first: "1st", second: "2nd", third: "3rd",
};

function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** 0 = same word, (0,1) = near match (spelling/number variants), 1 = different word. */
export function tokenCost(x: string, y: string): number {
  if (x === y) return 0;
  if (!x || !y) return 1;
  const nx = NUMBER_WORDS[x] ?? x;
  const ny = NUMBER_WORDS[y] ?? y;
  if (nx === ny) return 0;
  const longest = Math.max(x.length, y.length);
  if (x.length > 3 && y.length > 3 && (x.startsWith(y) || y.startsWith(x))) return 0.3;
  const d = boundedLevenshtein(x, y, 2);
  if (d <= 1 && longest >= 4) return 0.3;
  if (d <= 2 && longest >= 7) return 0.5;
  return 1;
}

const GAP = 1;
export type AlignedPair = [number | null, number | null];

/**
 * Banded Needleman–Wunsch. Memory is O(n · band) so multi-thousand-word scripts are fine;
 * the band always covers the length difference plus 15% slack.
 */
export function alignSequences(a: string[], b: string[], cost: (x: string, y: string) => number = tokenCost): AlignedPair[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((_, j) => [null, j] as AlignedPair);
  if (m === 0) return a.map((_, i) => [i, null] as AlignedPair);

  const band = Math.min(Math.max(n, m), Math.abs(n - m) + Math.max(64, Math.ceil(0.15 * Math.max(n, m))));
  const width = 2 * band + 1;
  const center = (i: number) => Math.round((i * m) / n);
  const DIAG = 0;
  const UP = 1;
  const LEFT = 2;
  const STOP = 3;
  const dir = new Uint8Array((n + 1) * width).fill(255);
  let prev = new Float64Array(width).fill(Infinity);
  let cur = new Float64Array(width).fill(Infinity);

  {
    const c0 = center(0);
    for (let k = 0; k < width; k++) {
      const j = c0 - band + k;
      if (j < 0 || j > m) continue;
      prev[k] = j * GAP;
      dir[k] = j === 0 ? STOP : LEFT;
    }
  }

  for (let i = 1; i <= n; i++) {
    cur.fill(Infinity);
    const ci = center(i);
    const cp = center(i - 1);
    for (let k = 0; k < width; k++) {
      const j = ci - band + k;
      if (j < 0 || j > m) continue;
      let best = Infinity;
      let d = 255;
      if (j > 0) {
        const kd = j - 1 - (cp - band);
        if (kd >= 0 && kd < width && prev[kd] !== Infinity) {
          const c = prev[kd] + cost(a[i - 1], b[j - 1]);
          if (c < best) {
            best = c;
            d = DIAG;
          }
        }
      }
      const ku = j - (cp - band);
      if (ku >= 0 && ku < width && prev[ku] + GAP < best) {
        best = prev[ku] + GAP;
        d = UP;
      }
      if (j > 0 && k > 0 && cur[k - 1] + GAP < best) {
        best = cur[k - 1] + GAP;
        d = LEFT;
      }
      cur[k] = best;
      dir[i * width + k] = d;
    }
    [prev, cur] = [cur, prev];
  }

  const pairs: AlignedPair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const k = j - (center(i) - band);
    const d = k >= 0 && k < width ? dir[i * width + k] : 255;
    if (d === DIAG) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (d === UP || (d === 255 && i > 0)) {
      pairs.push([i - 1, null]);
      i--;
    } else if (d === LEFT || (d === 255 && j > 0)) {
      pairs.push([null, j - 1]);
      j--;
    } else {
      break;
    }
  }
  return pairs.reverse();
}

export type DiffOpType = "equal" | "replace" | "delete" | "insert";

export interface DiffOp {
  type: DiffOpType;
  /** Script token range [start, end). "delete" = in script, not spoken. */
  script: [number, number];
  /** Transcript word range [start, end). "insert" = spoken, not in script. */
  transcript: [number, number];
}

export interface ScriptTranscriptComparison {
  ops: DiffOp[];
  scriptTokens: TextToken[];
  /** Share of script tokens that were spoken as written (0..1). */
  matchedRatio: number;
  identical: boolean;
  differences: {
    type: Exclude<DiffOpType, "equal">;
    scriptText: string;
    transcriptText: string;
    /** Time where the difference occurs in the audio (seconds), when known. */
    at: number | null;
  }[];
}

function pairsToOps(pairs: AlignedPair[], a: string[], b: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  let si = 0;
  let ti = 0;
  const push = (type: DiffOpType, sLen: number, tLen: number) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) {
      last.script[1] += sLen;
      last.transcript[1] += tLen;
    } else if (
      last &&
      ((last.type === "delete" && type === "insert") ||
        (last.type === "insert" && type === "delete") ||
        (last.type === "replace" && type !== "equal") ||
        (type === "replace" && (last.type === "delete" || last.type === "insert")))
    ) {
      last.type = "replace";
      last.script[1] += sLen;
      last.transcript[1] += tLen;
    } else {
      ops.push({ type, script: [si, si + sLen], transcript: [ti, ti + tLen] });
    }
    si += sLen;
    ti += tLen;
  };
  for (const [x, y] of pairs) {
    if (x !== null && y !== null) push(tokenCost(a[x], b[y]) === 0 ? "equal" : "replace", 1, 1);
    else if (x !== null) push("delete", 1, 0);
    else push("insert", 0, 1);
  }
  return ops;
}

export function compareScriptToTranscript(scriptSpokenText: string, words: TimedWord[]): ScriptTranscriptComparison {
  const scriptTokens = tokenize(scriptSpokenText);
  const a = scriptTokens.map((t) => t.norm);
  const b = words.map((w) => normalizeWord(w.text));
  const ops = pairsToOps(alignSequences(a, b), a, b);
  const equalCount = ops.filter((o) => o.type === "equal").reduce((sum, o) => sum + (o.script[1] - o.script[0]), 0);
  const denominator = Math.max(a.length, b.length, 1);
  const differences = ops
    .filter((o): o is DiffOp & { type: Exclude<DiffOpType, "equal"> } => o.type !== "equal")
    .map((o) => ({
      type: o.type,
      scriptText: scriptTokens
        .slice(o.script[0], o.script[1])
        .map((t) => t.text)
        .join(" "),
      transcriptText: words
        .slice(o.transcript[0], o.transcript[1])
        .map((w) => w.text)
        .join(" "),
      at: words[o.transcript[0]]?.start ?? words[Math.max(0, o.transcript[0] - 1)]?.end ?? null,
    }));
  return {
    ops,
    scriptTokens,
    matchedRatio: Math.round((equalCount / denominator) * 1000) / 1000,
    identical: differences.length === 0,
    differences,
  };
}

/** Script paragraph index for each transcript word (null where the speaker went off-script). */
export function paragraphIndexForWords(scriptParagraphs: string[], words: TimedWord[]): (number | null)[] {
  const tokens = scriptParagraphs.flatMap((p, paragraph) => tokenize(p).map((t) => ({ norm: t.norm, paragraph })));
  const result: (number | null)[] = new Array(words.length).fill(null);
  if (tokens.length === 0) return result;
  const pairs = alignSequences(
    tokens.map((t) => t.norm),
    words.map((w) => normalizeWord(w.text)),
  );
  for (const [x, y] of pairs) {
    if (x !== null && y !== null) result[y] = tokens[x].paragraph;
  }
  return result;
}

/**
 * Maps word indices from one transcript to another (e.g. old voice take → new voice take).
 * Unmatched indices are mapped to the nearest preceding matched word.
 */
export function mapWordIndices(fromWords: TimedWord[], toWords: TimedWord[]): number[] {
  const pairs = alignSequences(
    fromWords.map((w) => normalizeWord(w.text)),
    toWords.map((w) => normalizeWord(w.text)),
  );
  const mapping = new Array<number>(fromWords.length).fill(-1);
  let lastTo = -1;
  for (const [x, y] of pairs) {
    if (y !== null) lastTo = y;
    if (x !== null) mapping[x] = y !== null ? y : Math.max(0, lastTo + 1);
  }
  return mapping.map((v) => Math.min(Math.max(0, v), Math.max(0, toWords.length - 1)));
}
