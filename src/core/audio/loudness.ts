/**
 * Loudness measurement (ITU-R BS.1770-4 integrated loudness with K-weighting and gating) and the gain
 * that brings a mix to a publishing target without pushing peaks over a ceiling. Pure math on PCM.
 */

export const LOUDNESS_TARGETS = {
  youtube: { label: "YouTube (−14 LUFS)", lufs: -14 },
  podcast: { label: "Podcasts and Reels (−16 LUFS)", lufs: -16 },
  broadcast: { label: "Broadcast (−23 LUFS)", lufs: -23 },
} as const;
export type LoudnessTarget = keyof typeof LOUDNESS_TARGETS;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The two K-weighting stages (high shelf, then high pass) for any sample rate. */
function kWeighting(sampleRate: number): [Biquad, Biquad] {
  const shelfGain = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  const shelfF = 1681.974450955533;
  const A = 10 ** (shelfGain / 40);
  let w0 = (2 * Math.PI * shelfF) / sampleRate;
  let alpha = Math.sin(w0) / (2 * shelfQ);
  let cos = Math.cos(w0);
  const sqrtA = Math.sqrt(A);
  const a0s = A + 1 - (A - 1) * cos + 2 * sqrtA * alpha;
  const shelf: Biquad = {
    b0: (A * (A + 1 + (A - 1) * cos + 2 * sqrtA * alpha)) / a0s,
    b1: (-2 * A * (A - 1 + (A + 1) * cos)) / a0s,
    b2: (A * (A + 1 + (A - 1) * cos - 2 * sqrtA * alpha)) / a0s,
    a1: (2 * (A - 1 - (A + 1) * cos)) / a0s,
    a2: (A + 1 - (A - 1) * cos - 2 * sqrtA * alpha) / a0s,
  };
  const passQ = 0.5003270373238773;
  const passF = 38.13547087602444;
  w0 = (2 * Math.PI * passF) / sampleRate;
  alpha = Math.sin(w0) / (2 * passQ);
  cos = Math.cos(w0);
  const a0p = 1 + alpha;
  const pass: Biquad = { b0: (1 + cos) / 2 / a0p, b1: -(1 + cos) / a0p, b2: (1 + cos) / 2 / a0p, a1: (-2 * cos) / a0p, a2: (1 - alpha) / a0p };
  return [shelf, pass];
}

function filter(samples: Float32Array, f: Biquad): Float32Array {
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

export interface LoudnessMeasurement {
  /** Integrated loudness in LUFS (null for silence). */
  integratedLufs: number | null;
  /** Highest absolute sample value, 0..1. */
  samplePeak: number;
}

/**
 * Integrated loudness of mono PCM. `outputChannels` is how many channels play the same signal (a mono
 * voice-over rendered to stereo sounds 3 dB louder than one channel).
 */
export function measureLoudness(samples: Float32Array, sampleRate: number, outputChannels = 2): LoudnessMeasurement {
  let samplePeak = 0;
  for (let i = 0; i < samples.length; i++) samplePeak = Math.max(samplePeak, Math.abs(samples[i]));
  const [shelf, pass] = kWeighting(sampleRate);
  const weighted = filter(filter(samples, shelf), pass);
  const block = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  const powers: number[] = [];
  for (let start = 0; start + block <= weighted.length; start += step) {
    let sum = 0;
    for (let i = start; i < start + block; i++) sum += weighted[i] * weighted[i];
    powers.push((sum / block) * outputChannels);
  }
  const loudness = (z: number) => -0.691 + 10 * Math.log10(z);
  const absolute = powers.filter((z) => z > 0 && loudness(z) > -70);
  if (!absolute.length) return { integratedLufs: null, samplePeak };
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
  const relativeGate = loudness(mean(absolute)) - 10;
  const gated = absolute.filter((z) => loudness(z) > relativeGate);
  return { integratedLufs: Math.round(loudness(mean(gated.length ? gated : absolute)) * 100) / 100, samplePeak };
}

/** Linear gain that reaches `targetLufs`, lowered so the peak stays under `ceilingDb` dBFS. */
export function normalizationGain(measurement: LoudnessMeasurement, targetLufs: number, ceilingDb = -1): { gain: number; gainDb: number; limitedByPeak: boolean } {
  if (measurement.integratedLufs === null) return { gain: 1, gainDb: 0, limitedByPeak: false };
  let gainDb = targetLufs - measurement.integratedLufs;
  let limitedByPeak = false;
  if (measurement.samplePeak > 0) {
    const headroom = ceilingDb - 20 * Math.log10(measurement.samplePeak);
    if (gainDb > headroom) {
      gainDb = headroom;
      limitedByPeak = true;
    }
  }
  gainDb = Math.max(-20, Math.min(18, gainDb));
  return { gain: Math.round(10 ** (gainDb / 20) * 1000) / 1000, gainDb: Math.round(gainDb * 100) / 100, limitedByPeak };
}
