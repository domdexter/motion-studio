import type { TimedWord } from "../spec/timing";
import { isMutedAt, type VoiceCut } from "../timeline/audio-clips";

/**
 * Ducking: music, sound effects and clip audio dip while the narrator speaks. Pure helpers shared by
 * the composition's audio tracks, overlay clips and videos inside scenes.
 */

/** How far ducked audio drops (0.65 = to 35% of its volume). */
export const DUCK_DEPTH = 0.65;

/** Merged spans where the narrator is speaking. Muted words don't duck. */
export function speechIntervals(words: readonly TimedWord[], cuts: readonly VoiceCut[], mergeGap = 0.45): [number, number][] {
  const out: [number, number][] = [];
  for (const w of words) {
    if (cuts.length && isMutedAt((w.start + w.end) / 2, cuts)) continue;
    const last = out[out.length - 1];
    if (last && w.start - last[1] <= mergeGap) last[1] = Math.max(last[1], w.end);
    else out.push([w.start, w.end]);
  }
  return out;
}

/** 0 = clear, 1 = fully ducked at video second `t`, with short attack/release ramps. */
export function duckFactor(t: number, intervals: readonly [number, number][], ramp = 0.25): number {
  let best = 0;
  for (const [s, e] of intervals) {
    if (s - ramp > t) break;
    if (t <= e + ramp) {
      const f = t < s ? 1 - (s - t) / ramp : t > e ? 1 - (t - e) / ramp : 1;
      best = Math.max(best, f);
      if (best >= 1) break;
    }
  }
  return best;
}

/** Volume multiplier for ducked audio at video second `t`. */
export const duckGain = (t: number, intervals: readonly [number, number][]) => 1 - DUCK_DEPTH * duckFactor(t, intervals);
