import { describe, expect, it } from "vitest";
import { measureLoudness, normalizationGain } from "../audio/loudness";
import type { TimedWord } from "../spec/timing";
import { findPausesAndFillers } from "../timeline/voice-cleanup";

function sine(amplitude: number, seconds: number, sampleRate = 48000, frequency = 1000): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return out;
}

describe("loudness", () => {
  it("measures a 1 kHz tone like BS.1770 (one channel)", () => {
    // A full-scale 1 kHz sine in one channel is −3.01 LUFS, so amplitude 0.1 is −23.01.
    const m = measureLoudness(sine(0.1, 3), 48000, 1);
    expect(m.integratedLufs).toBeCloseTo(-23.01, 0);
    expect(m.samplePeak).toBeCloseTo(0.1, 3);
    expect(measureLoudness(sine(0.1, 3), 48000, 2).integratedLufs).toBeCloseTo(-20, 0);
    expect(measureLoudness(new Float32Array(48000 * 2), 48000).integratedLufs).toBeNull();
  });

  it("reaches the target without pushing the peak over the ceiling", () => {
    expect(normalizationGain({ integratedLufs: -20, samplePeak: 0.1 }, -14)).toEqual({ gain: 1.995, gainDb: 6, limitedByPeak: false });
    const limited = normalizationGain({ integratedLufs: -20, samplePeak: 0.8 }, -14);
    expect(limited.limitedByPeak).toBe(true);
    expect(limited.gainDb).toBeCloseTo(-1 - 20 * Math.log10(0.8), 2);
  });
});

describe("pauses and filler words", () => {
  const w = (i: number, text: string, start: number, end: number) => ({ i, text, start, end }) as TimedWord;
  const words = [w(0, "So", 0, 0.3), w(1, "um,", 0.5, 0.8), w(2, "Handy", 0.9, 1.3), w(3, "works.", 1.35, 1.8), w(4, "Really", 3.2, 3.6)];

  it("finds filler words and long pauses, and skips what is already muted", () => {
    const found = findPausesAndFillers(words);
    expect(found.map((s) => [s.kind, s.startSec, s.endSec])).toEqual([
      ["filler", 0.47, 0.83],
      ["pause", 1.92, 3.08],
    ]);
    expect(findPausesAndFillers(words, { cuts: [{ startSec: 0.4, endSec: 0.9 }] }).map((s) => s.kind)).toEqual(["pause"]);
  });
});
