import type { Segment, TimedWord, TimelineData } from "../spec/timing";
import { mapWordIndices } from "../transcript/align";

/**
 * Scene timing from the audio-derived timeline.
 *
 * An AUDIO-LOCKED scene is defined by a word anchor [wordStart, wordEnd); its seconds are
 * always recomputed from the words, so a new voice-over re-times it deterministically.
 * A USER-ADJUSTED scene keeps the absolute seconds the user chose.
 */

export type Pace = "fast" | "medium" | "slow";

export const PACE_SETTINGS: Record<Pace, { target: number; min: number; max: number }> = {
  fast: { target: 2.6, min: 1.2, max: 5 },
  medium: { target: 3.8, min: 1.6, max: 7 },
  slow: { target: 5.5, min: 2.4, max: 9.5 },
};

/** Visual cuts land slightly before the first word of a scene (anticipation). */
export const LEAD_IN_SEC = 0.12;

export interface WordAnchor {
  wordStart: number;
  /** exclusive */
  wordEnd: number;
}

export interface ScenePlan extends WordAnchor {
  start: number;
  end: number;
  voiceText: string;
  paragraph?: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function anchorDuration(words: TimedWord[], a: WordAnchor): number {
  return words[a.wordEnd - 1].end - words[a.wordStart].start;
}

function splitLong(unit: WordAnchor, words: TimedWord[], phrases: Segment[], maxDur: number, depth = 0): WordAnchor[] {
  if (depth > 6 || unit.wordEnd - unit.wordStart < 4 || anchorDuration(words, unit) <= maxDur) return [unit];
  const dur = anchorDuration(words, unit);
  const mid = words[unit.wordStart].start + dur / 2;
  const candidates = phrases
    .filter((p) => p.wordStart >= unit.wordStart + 2 && p.wordStart <= unit.wordEnd - 2)
    .map((p) => p.wordStart);
  let cut: number;
  if (candidates.length > 0) {
    cut = candidates.reduce((best, c) => (Math.abs(words[c].start - mid) < Math.abs(words[best].start - mid) ? c : best));
  } else {
    cut = Math.floor((unit.wordStart + unit.wordEnd) / 2);
    let bestScore = -Infinity;
    for (let i = unit.wordStart + 2; i <= unit.wordEnd - 2; i++) {
      const gap = words[i].start - words[i - 1].end;
      const score = gap - (Math.abs(words[i].start - mid) / dur) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        cut = i;
      }
    }
  }
  return [
    ...splitLong({ wordStart: unit.wordStart, wordEnd: cut }, words, phrases, maxDur, depth + 1),
    ...splitLong({ wordStart: cut, wordEnd: unit.wordEnd }, words, phrases, maxDur, depth + 1),
  ];
}

/** Continuous boundaries covering [0, duration]. */
export function boundariesFromAnchors(words: TimedWord[], anchors: WordAnchor[], duration: number): { start: number; end: number }[] {
  const cuts: number[] = [0];
  for (let k = 1; k < anchors.length; k++) {
    const first = words[anchors[k].wordStart];
    const prevLast = words[anchors[k - 1].wordEnd - 1];
    if (!first || !prevLast) {
      cuts.push(cuts[cuts.length - 1]);
      continue;
    }
    const gap = Math.max(0, first.start - prevLast.end);
    cuts.push(round3(Math.max(cuts[cuts.length - 1], first.start - Math.min(LEAD_IN_SEC, gap / 2))));
  }
  const end = round3(Math.max(duration, words.length ? words[words.length - 1].end : 0));
  return anchors.map((_, k) => ({ start: cuts[k], end: k + 1 < anchors.length ? cuts[k + 1] : end }));
}

export function planScenes(timeline: TimelineData, words: TimedWord[], pace: Pace = "medium"): ScenePlan[] {
  if (words.length === 0) return [];
  const p = PACE_SETTINGS[pace];
  let units: (WordAnchor & { paragraph?: number })[] = timeline.sentences.length
    ? timeline.sentences.map((s) => ({ wordStart: s.wordStart, wordEnd: s.wordEnd, paragraph: s.paragraph }))
    : [{ wordStart: 0, wordEnd: words.length }];

  units = units.flatMap((u) => splitLong(u, words, timeline.phrases, p.max).map((x) => ({ ...x, paragraph: u.paragraph })));

  let merged = true;
  while (merged && units.length > 1) {
    merged = false;
    for (let i = 0; i < units.length; i++) {
      if (anchorDuration(words, units[i]) >= p.min) continue;
      const options: { j: number; score: number }[] = [];
      const prev = units[i - 1];
      const next = units[i + 1];
      if (prev && anchorDuration(words, { wordStart: prev.wordStart, wordEnd: units[i].wordEnd }) <= p.max) {
        options.push({ j: i - 1, score: (prev.paragraph === units[i].paragraph ? 0 : 1) + anchorDuration(words, prev) / p.max });
      }
      if (next && anchorDuration(words, { wordStart: units[i].wordStart, wordEnd: next.wordEnd }) <= p.max) {
        options.push({ j: i + 1, score: (next.paragraph === units[i].paragraph ? 0 : 1) + anchorDuration(words, next) / p.max });
      }
      if (options.length === 0) continue;
      options.sort((a, b) => a.score - b.score);
      const a = Math.min(i, options[0].j);
      const b = Math.max(i, options[0].j);
      units.splice(a, 2, { wordStart: units[a].wordStart, wordEnd: units[b].wordEnd, paragraph: units[a].paragraph });
      merged = true;
      break;
    }
  }

  const bounds = boundariesFromAnchors(words, units, timeline.duration);
  return units.map((u, k) => ({
    ...u,
    start: bounds[k].start,
    end: bounds[k].end,
    voiceText: words
      .slice(u.wordStart, u.wordEnd)
      .map((w) => w.text)
      .join(" "),
  }));
}

export interface SceneTimingInput {
  timingMode: "audio_locked" | "user_adjusted";
  wordStart: number | null;
  wordEnd: number | null;
  start: number;
  end: number;
}

const hasAnchor = (s: SceneTimingInput) => s.timingMode === "audio_locked" && s.wordStart !== null && s.wordEnd !== null && s.wordEnd > s.wordStart;

/**
 * Recomputes seconds for audio-locked scenes from their anchors, keeping user-adjusted
 * edges untouched. Boundaries between two audio-locked scenes use the word cut rule.
 */
export function recomputeSceneTimes(scenes: SceneTimingInput[], words: TimedWord[], duration: number): { start: number; end: number }[] {
  const n = scenes.length;
  if (n === 0) return [];
  const totalEnd = round3(Math.max(duration, words.length ? words[words.length - 1].end : 0));
  const cuts: number[] = new Array(n + 1);
  cuts[0] = hasAnchor(scenes[0]) ? 0 : scenes[0].start;
  cuts[n] = hasAnchor(scenes[n - 1]) ? totalEnd : scenes[n - 1].end;
  for (let k = 1; k < n; k++) {
    const prev = scenes[k - 1];
    const cur = scenes[k];
    if (hasAnchor(prev) && hasAnchor(cur) && words[cur.wordStart!] && words[prev.wordEnd! - 1]) {
      const first = words[cur.wordStart!];
      const prevLast = words[prev.wordEnd! - 1];
      const gap = Math.max(0, first.start - prevLast.end);
      cuts[k] = round3(first.start - Math.min(LEAD_IN_SEC, gap / 2));
    } else if (!hasAnchor(cur)) {
      cuts[k] = cur.start;
    } else {
      cuts[k] = prev.end;
    }
  }
  for (let k = 1; k <= n; k++) cuts[k] = Math.max(cuts[k], cuts[k - 1] + 0.04);
  return scenes.map((_, k) => ({ start: round3(cuts[k]), end: round3(cuts[k + 1]) }));
}

/** Re-anchors scenes onto a new transcript (voice-over replaced) while preserving order and contiguity. */
export function remapAnchors(oldWords: TimedWord[], newWords: TimedWord[], anchors: WordAnchor[]): WordAnchor[] {
  if (anchors.length === 0 || newWords.length === 0) return anchors.map(() => ({ wordStart: 0, wordEnd: 0 }));
  const map = mapWordIndices(oldWords, newWords);
  const result: WordAnchor[] = anchors.map((a) => {
    const ws = map[Math.min(a.wordStart, map.length - 1)] ?? 0;
    const we = (map[Math.min(Math.max(a.wordEnd - 1, 0), map.length - 1)] ?? ws) + 1;
    return { wordStart: ws, wordEnd: Math.max(we, ws + 1) };
  });
  for (let k = 0; k < result.length; k++) {
    if (k === 0 && anchors[0].wordStart === 0) result[0].wordStart = 0;
    if (k > 0 && anchors[k].wordStart === anchors[k - 1].wordEnd) result[k].wordStart = result[k - 1].wordEnd;
    result[k].wordStart = Math.min(result[k].wordStart, newWords.length - 1);
    result[k].wordEnd = Math.min(Math.max(result[k].wordEnd, result[k].wordStart + 1), newWords.length);
  }
  if (anchors[anchors.length - 1].wordEnd === oldWords.length) result[result.length - 1].wordEnd = newWords.length;
  return result;
}

export interface TimelineComparisonRow {
  text: string;
  newText: string | null;
  oldStart: number;
  oldEnd: number;
  newStart: number | null;
  newEnd: number | null;
  deltaStart: number | null;
  status: "same" | "shifted" | "changed" | "removed";
}

/** Sentence-by-sentence comparison of two timelines (for "Compare timelines"). */
export function compareTimelines(
  oldTimeline: TimelineData,
  oldWords: TimedWord[],
  newTimeline: TimelineData,
  newWords: TimedWord[],
): { rows: TimelineComparisonRow[]; durationDelta: number } {
  const map = oldWords.length && newWords.length ? mapWordIndices(oldWords, newWords) : [];
  const rows = oldTimeline.sentences.map((s): TimelineComparisonRow => {
    if (!newWords.length || !map.length) {
      return { text: s.text, newText: null, oldStart: s.start, oldEnd: s.end, newStart: null, newEnd: null, deltaStart: null, status: "removed" };
    }
    const ws = map[s.wordStart];
    const we = map[s.wordEnd - 1] + 1;
    // Compare against the full new sentence(s) the old sentence landed in, so words added
    // just before/after the mapped range still register as a change.
    const overlapping = newTimeline.sentences.filter((ns) => ns.wordStart < we && ns.wordEnd > ws);
    const newText = overlapping.length
      ? overlapping.map((ns) => ns.text).join(" ")
      : newWords
          .slice(ws, we)
          .map((w) => w.text)
          .join(" ");
    const newStart = overlapping[0]?.start ?? newWords[ws]?.start ?? null;
    const newEnd = overlapping[overlapping.length - 1]?.end ?? newWords[Math.max(ws, we - 1)]?.end ?? null;
    const deltaStart = newStart === null ? null : round3(newStart - s.start);
    const sameText = newText.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") === s.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const status: TimelineComparisonRow["status"] = !sameText ? "changed" : deltaStart !== null && Math.abs(deltaStart) > 0.05 ? "shifted" : "same";
    return { text: s.text, newText, oldStart: s.start, oldEnd: s.end, newStart, newEnd, deltaStart, status };
  });
  return { rows, durationDelta: round3(newTimeline.duration - oldTimeline.duration) };
}
