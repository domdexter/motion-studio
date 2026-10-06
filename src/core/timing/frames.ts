/**
 * Frame/time conversion.
 *
 * The internal timeline is in seconds; Remotion works in integer frames.
 *
 * Rule: always convert ABSOLUTE times on the master timeline, never accumulate rounded
 * durations. A span occupies [round(start·fps), round(end·fps)), so two adjacent scenes
 * share the exact same boundary frame and no drift builds up across a long video.
 */

const EPSILON = 1e-6;

function assertFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`Invalid fps: ${fps}`);
  }
}

/** Round-half-up conversion guarded against binary float error (0.05 × 30 = 1.4999…). */
export function secondsToFrames(seconds: number, fps: number): number {
  assertFps(fps);
  if (!Number.isFinite(seconds)) {
    throw new RangeError(`secondsToFrames: invalid seconds ${seconds}`);
  }
  return Math.floor(seconds * fps + 0.5 + EPSILON);
}

export function framesToSeconds(frames: number, fps: number): number {
  assertFps(fps);
  return frames / fps;
}

export interface FrameSpan {
  /** First frame (inclusive) on the master timeline. */
  from: number;
  /** End frame (exclusive) on the master timeline. */
  to: number;
  durationInFrames: number;
}

/** Frame span for an absolute [start, end) time range. Always at least one frame long. */
export function spanToFrames(startSec: number, endSec: number, fps: number): FrameSpan {
  const from = secondsToFrames(startSec, fps);
  const to = Math.max(from + 1, secondsToFrames(endSec, fps));
  return { from, to, durationInFrames: to - from };
}

/**
 * Total composition length. Uses ceil so the final partial frame of audio is never cut off.
 */
export function durationToTotalFrames(durationSec: number, fps: number): number {
  assertFps(fps);
  return Math.max(1, Math.ceil(durationSec * fps - EPSILON));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundTime(seconds: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(seconds * f) / f;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** SMPTE-like timecode: MM:SS:FF (HH:MM:SS:FF past one hour). */
export function formatTimecode(seconds: number, fps: number): string {
  const totalFrames = Math.max(0, secondsToFrames(seconds, fps));
  const ff = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const base = `${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`;
  return hh > 0 ? `${pad2(hh)}:${base}` : base;
}

/** Clock with fractional seconds: 0:03.74 / 1:02.50 */
export function formatClock(seconds: number, decimals = 2): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  const [whole, frac] = rest.toFixed(decimals).split(".");
  const wholeNum = Number(whole);
  // toFixed can round 59.999 up to 60.00
  if (wholeNum >= 60) return formatClock(Math.ceil(safe), decimals);
  return decimals > 0 ? `${minutes}:${pad2(wholeNum)}.${frac}` : `${minutes}:${pad2(wholeNum)}`;
}

/** "42.73s" */
export function formatSeconds(seconds: number, decimals = 2): string {
  return `${seconds.toFixed(decimals)}s`;
}

/** "42s", "1m 05s" */
export function formatDurationShort(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${pad2(s % 60)}s`;
}
