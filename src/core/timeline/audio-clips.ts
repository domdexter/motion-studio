/**
 * Audio on the master timeline: music/SFX/voice-line clips (placed, trimmed, looped) and muted
 * sections of the voice-over. Pure helpers shared by the Remotion engine, the server and the
 * timeline editor, so a drag in the GUI means exactly what renders.
 *
 * The voice-over itself never moves: every scene is anchored to its words. Trimming it means
 * muting sections (a cut at the start, the end or anywhere in between), which keeps all timing.
 */

/** Shortest audio clip the timeline allows, in seconds. */
export const MIN_AUDIO_CLIP_SEC = 0.1;

/** Shortest muted voice-over section, in seconds. */
export const MIN_VOICE_CUT_SEC = 0.02;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface AudioClipTiming {
  startSec: number;
  trimStartSec: number;
  /** null = play the rest of the source (to the end of the video when looping). */
  durationSec: number | null;
  loop: boolean;
  sourceDurationSec: number | null;
}

export type AudioDragEdge = "move" | "start" | "end";
export type AudioClipPatch = Pick<AudioClipTiming, "startSec" | "trimStartSec" | "durationSec">;

/** Seconds the clip plays on the timeline, capped at the end of the video (matches the renderer). */
export function audioClipLengthSec(c: AudioClipTiming, videoEndSec: number): number {
  const room = Math.max(0, videoEndSec - c.startSec);
  const natural = c.durationSec ?? (!c.loop && c.sourceDurationSec !== null ? Math.max(0, c.sourceDurationSec - c.trimStartSec) : room);
  return Math.min(room, natural);
}

/**
 * Applies a timeline drag. Moving keeps the trim. The left edge trims the in-point: the sound stays
 * anchored in time, so the trim start moves with the edge. The right edge sets the length; a clip
 * that doesn't loop can't run past the end of its source, and dragging back to the natural end
 * clears the fixed length again.
 */
export function dragAudioClip(c: AudioClipTiming, edge: AudioDragEdge, deltaSec: number, videoEndSec: number): AudioClipPatch {
  const base: AudioClipPatch = { startSec: c.startSec, trimStartSec: c.trimStartSec, durationSec: c.durationSec };
  const length = audioClipLengthSec(c, videoEndSec);
  if (edge === "move") {
    return { ...base, startSec: r3(clamp(c.startSec + deltaSec, 0, Math.max(0, videoEndSec - MIN_AUDIO_CLIP_SEC))) };
  }
  if (edge === "start") {
    const d = Math.min(Math.max(deltaSec, -c.startSec, -c.trimStartSec), length - MIN_AUDIO_CLIP_SEC);
    return {
      startSec: r3(c.startSec + d),
      trimStartSec: r3(c.trimStartSec + d),
      durationSec: c.durationSec === null ? null : r3(Math.max(MIN_AUDIO_CLIP_SEC, c.durationSec - d)),
    };
  }
  const room = Math.max(MIN_AUDIO_CLIP_SEC, videoEndSec - c.startSec);
  const sourceLeft = c.sourceDurationSec === null ? null : Math.max(MIN_AUDIO_CLIP_SEC, c.sourceDurationSec - c.trimStartSec);
  let next = clamp(length + deltaSec, MIN_AUDIO_CLIP_SEC, room);
  if (!c.loop && sourceLeft !== null) next = Math.min(next, sourceLeft);
  const naturalEnd = c.loop ? room : sourceLeft;
  return { ...base, durationSec: naturalEnd !== null && Math.abs(next - Math.min(naturalEnd, room)) < 0.02 ? null : r3(next) };
}

// ---------------------------------------------------------------------------------------
// Voice-over mix and muted sections
// ---------------------------------------------------------------------------------------

export interface VoiceCut {
  startSec: number;
  endSec: number;
}

export interface VoiceMix {
  volume: number;
  muted: boolean;
  /** Muted sections in video seconds, sorted and non-overlapping. */
  cuts: VoiceCut[];
}

/** Sorted, merged and clamped to [0, durationSec]; slivers shorter than MIN_VOICE_CUT_SEC are dropped. */
export function normalizeVoiceCuts(cuts: readonly VoiceCut[], durationSec: number | null): VoiceCut[] {
  const max = durationSec ?? Infinity;
  const sorted = cuts
    .filter((c) => Number.isFinite(c.startSec) && Number.isFinite(c.endSec))
    .map((c) => ({ startSec: Math.max(0, Math.min(c.startSec, c.endSec)), endSec: Math.min(max, Math.max(c.startSec, c.endSec)) }))
    .filter((c) => c.endSec - c.startSec >= MIN_VOICE_CUT_SEC)
    .sort((a, b) => a.startSec - b.startSec);
  const out: VoiceCut[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.startSec <= last.endSec + 1e-6) last.endSec = Math.max(last.endSec, c.endSec);
    else out.push({ ...c });
  }
  return out.map((c) => ({ startSec: r3(c.startSec), endSec: r3(c.endSec) }));
}

/** Reads Project.mix (older projects have no cuts). */
export function parseVoiceMix(value: unknown): VoiceMix {
  const m = (value && typeof value === "object" ? value : {}) as Partial<VoiceMix>;
  return {
    volume: typeof m.volume === "number" ? m.volume : 1,
    muted: !!m.muted,
    cuts: Array.isArray(m.cuts) ? normalizeVoiceCuts(m.cuts, null) : [],
  };
}

export type VoiceCutEdge = "move" | "start" | "end";

/** Drags one muted section; it stays inside [0, durationSec] and never crosses its neighbours. */
export function dragVoiceCut(cuts: readonly VoiceCut[], index: number, edge: VoiceCutEdge, deltaSec: number, durationSec: number): VoiceCut[] {
  const c = cuts[index];
  if (!c) return [...cuts];
  const lo = index > 0 ? cuts[index - 1].endSec : 0;
  const hi = index < cuts.length - 1 ? cuts[index + 1].startSec : durationSec;
  let next: VoiceCut;
  if (edge === "move") {
    const len = c.endSec - c.startSec;
    const start = clamp(c.startSec + deltaSec, lo, Math.max(lo, hi - len));
    next = { startSec: start, endSec: Math.min(hi, start + len) };
  } else if (edge === "start") {
    next = { startSec: clamp(c.startSec + deltaSec, lo, c.endSec - MIN_VOICE_CUT_SEC), endSec: c.endSec };
  } else {
    next = { startSec: c.startSec, endSec: clamp(c.endSec + deltaSec, c.startSec + MIN_VOICE_CUT_SEC, hi) };
  }
  return cuts.map((x, i) => (i === index ? { startSec: r3(next.startSec), endSec: r3(next.endSec) } : x));
}

const EDGE_EPS = 0.0005;

/** Where the audible voice-over starts and ends once leading/trailing muted sections are applied. */
export function voiceTrimPoints(cuts: readonly VoiceCut[], durationSec: number): { inSec: number; outSec: number } {
  const lead = cuts.find((c) => c.startSec <= EDGE_EPS);
  const tail = [...cuts].reverse().find((c) => c.endSec >= durationSec - EDGE_EPS);
  return { inSec: lead?.endSec ?? 0, outSec: tail?.startSec ?? durationSec };
}

/** Trims the start ("in") or end ("out") of the voice-over by muting everything before/after `timeSec`. */
export function setVoiceTrim(cuts: readonly VoiceCut[], edge: "in" | "out", timeSec: number, durationSec: number): VoiceCut[] {
  const { inSec, outSec } = voiceTrimPoints(cuts, durationSec);
  const rest = cuts.filter((c) => (edge === "in" ? c.startSec > EDGE_EPS : c.endSec < durationSec - EDGE_EPS));
  const t = edge === "in" ? clamp(timeSec, 0, outSec - MIN_VOICE_CUT_SEC) : clamp(timeSec, inSec + MIN_VOICE_CUT_SEC, durationSec);
  const added = edge === "in" ? { startSec: 0, endSec: t } : { startSec: t, endSec: durationSec };
  return normalizeVoiceCuts([...rest, added], durationSec);
}

/**
 * Voice-over gain for a video frame: 0 when any part of the frame falls inside a muted section,
 * else 1. Audio volume changes land on whole frames, so a cut silences the frames it touches and
 * never lets a sliver of the muted sound through.
 */
export function voiceGainAtFrame(frame: number, fps: number, cuts: readonly VoiceCut[]): number {
  const t0 = frame / fps;
  const t1 = (frame + 1) / fps - 1e-6;
  for (const c of cuts) {
    if (c.startSec >= t1) break;
    if (c.endSec > t0 + 1e-6) return 0;
  }
  return 1;
}

/** True when a moment of the voice-over is muted (used to skip ducking for words that are cut). */
export function isMutedAt(timeSec: number, cuts: readonly VoiceCut[]): boolean {
  return cuts.some((c) => timeSec >= c.startSec && timeSec < c.endSec);
}
