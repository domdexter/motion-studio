import type { TimedWord } from "../spec/timing";
import { normalizeWord } from "../util/text";
import { isMutedAt, type VoiceCut } from "./audio-clips";

/**
 * Suggestions for cleaning up a voice-over without moving its timing: filler words (um, uh, …) to mute,
 * and long silences whose breaths and room noise can be muted. Nothing is applied until the user picks.
 */

export const FILLER_WORDS = ["um", "umm", "uh", "uhh", "uhm", "erm", "er", "hmm", "mm", "mhm", "ah"] as const;

export interface CleanupSuggestion {
  id: string;
  kind: "filler" | "pause";
  startSec: number;
  endSec: number;
  label: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function findPausesAndFillers(words: readonly TimedWord[], options: { cuts?: readonly VoiceCut[]; minPauseSec?: number; durationSec?: number } = {}): CleanupSuggestion[] {
  const minPause = options.minPauseSec ?? 0.8;
  const cuts = options.cuts ?? [];
  const fillers = new Set<string>(FILLER_WORDS);
  const out: CleanupSuggestion[] = [];
  const muted = (a: number, b: number) => cuts.length > 0 && isMutedAt((a + b) / 2, cuts);
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const next = words[i + 1];
    if (fillers.has(normalizeWord(w.text))) {
      // Mute a touch around the word, but never into the words beside it.
      const startSec = r3(Math.max(prev ? prev.end : 0, w.start - 0.03));
      const endSec = r3(Math.min(next ? next.start : (options.durationSec ?? w.end + 0.03), w.end + 0.03));
      if (endSec > startSec && !muted(startSec, endSec)) out.push({ id: `f${i}`, kind: "filler", startSec, endSec, label: `“${w.text.trim()}”` });
    }
    if (next && next.start - w.end >= minPause) {
      // Keep a short breath of silence at each side so speech doesn't sound clipped.
      const startSec = r3(w.end + 0.12);
      const endSec = r3(next.start - 0.12);
      if (endSec - startSec >= 0.2 && !muted(startSec, endSec)) out.push({ id: `p${i}`, kind: "pause", startSec, endSec, label: `${(next.start - w.end).toFixed(1)} s pause` });
    }
  });
  return out.sort((a, b) => a.startSec - b.startSec);
}
