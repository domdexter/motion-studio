import { describe, expect, it } from "vitest";
import {
  audioClipLengthSec,
  dragAudioClip,
  dragVoiceCut,
  isMutedAt,
  normalizeVoiceCuts,
  parseVoiceMix,
  setVoiceTrim,
  voiceGainAtFrame,
  voiceTrimPoints,
  type AudioClipTiming,
} from "../timeline/audio-clips";

const music: AudioClipTiming = { startSec: 2, trimStartSec: 1, durationSec: null, loop: false, sourceDurationSec: 30 };

describe("audio clips", () => {
  it("measures how long a clip plays, capped at the end of the video", () => {
    expect(audioClipLengthSec(music, 60)).toBe(29);
    expect(audioClipLengthSec(music, 20)).toBe(18);
    expect(audioClipLengthSec({ ...music, loop: true }, 60)).toBe(58);
    expect(audioClipLengthSec({ ...music, durationSec: 5 }, 60)).toBe(5);
  });

  it("moves a clip without changing its trim and keeps it inside the video", () => {
    expect(dragAudioClip(music, "move", 3, 60)).toEqual({ startSec: 5, trimStartSec: 1, durationSec: null });
    expect(dragAudioClip(music, "move", -10, 60).startSec).toBe(0);
  });

  it("trims the in-point with the left edge and never before the source start", () => {
    expect(dragAudioClip(music, "start", 2, 60)).toEqual({ startSec: 4, trimStartSec: 3, durationSec: null });
    expect(dragAudioClip({ ...music, durationSec: 10 }, "start", 2, 60)).toEqual({ startSec: 4, trimStartSec: 3, durationSec: 8 });
    const wide = dragAudioClip(music, "start", -5, 60);
    expect(wide).toEqual({ startSec: 1, trimStartSec: 0, durationSec: null });
  });

  it("sets the length with the right edge, clamped to the source and the video", () => {
    expect(dragAudioClip(music, "end", -9, 60)).toEqual({ startSec: 2, trimStartSec: 1, durationSec: 20 });
    expect(dragAudioClip({ ...music, durationSec: 20 }, "end", 30, 60).durationSec).toBeNull();
    expect(dragAudioClip(music, "end", 50, 20).durationSec).toBeNull();
    expect(dragAudioClip({ ...music, loop: true, durationSec: 10 }, "end", 100, 60).durationSec).toBeNull();
    expect(dragAudioClip(music, "end", -100, 60).durationSec).toBeCloseTo(0.1);
  });
});

describe("voice-over cuts", () => {
  it("normalizes muted sections: sorted, merged, clamped and without slivers", () => {
    expect(normalizeVoiceCuts([{ startSec: 5, endSec: 3 }, { startSec: 1, endSec: 2 }, { startSec: 1.5, endSec: 2.5 }, { startSec: 9, endSec: 9.01 }, { startSec: 40, endSec: 50 }], 42)).toEqual([
      { startSec: 1, endSec: 2.5 },
      { startSec: 3, endSec: 5 },
      { startSec: 40, endSec: 42 },
    ]);
    expect(parseVoiceMix({ volume: 0.8 })).toEqual({ volume: 0.8, muted: false, cuts: [] });
    expect(parseVoiceMix(null)).toEqual({ volume: 1, muted: false, cuts: [] });
  });

  it("drags a section without crossing its neighbours", () => {
    const cuts = [
      { startSec: 1, endSec: 2 },
      { startSec: 4, endSec: 5 },
    ];
    expect(dragVoiceCut(cuts, 0, "move", 5, 42)[0]).toEqual({ startSec: 3, endSec: 4 });
    expect(dragVoiceCut(cuts, 1, "start", -10, 42)[1]).toEqual({ startSec: 2, endSec: 5 });
    expect(dragVoiceCut(cuts, 1, "end", 100, 42)[1]).toEqual({ startSec: 4, endSec: 42 });
  });

  it("trims the start and end of the voice-over as leading and trailing cuts", () => {
    const out = setVoiceTrim([], "out", 39.535, 42.042);
    expect(out).toEqual([{ startSec: 39.535, endSec: 42.042 }]);
    expect(voiceTrimPoints(out, 42.042)).toEqual({ inSec: 0, outSec: 39.535 });
    const both = setVoiceTrim(out, "in", 0.1, 42.042);
    expect(voiceTrimPoints(both, 42.042)).toEqual({ inSec: 0.1, outSec: 39.535 });
    expect(setVoiceTrim(both, "out", 50, 42.042)).toEqual([{ startSec: 0, endSec: 0.1 }]);
  });

  it("silences every frame a cut touches and nothing else", () => {
    const cuts = [{ startSec: 39.535, endSec: 42.042 }];
    // Frame 1186 spans 39.533–39.567 s: it contains the cut start, so it is silent.
    expect(voiceGainAtFrame(1185, 30, cuts)).toBe(1);
    expect(voiceGainAtFrame(1186, 30, cuts)).toBe(0);
    expect(voiceGainAtFrame(1260, 30, cuts)).toBe(0);
    // A cut that starts exactly on a frame boundary leaves the frame before it untouched.
    expect(voiceGainAtFrame(29, 30, [{ startSec: 1, endSec: 2 }])).toBe(1);
    expect(voiceGainAtFrame(60, 30, [{ startSec: 1, endSec: 2 }])).toBe(1);
    expect(isMutedAt(40, cuts)).toBe(true);
    expect(isMutedAt(39, cuts)).toBe(false);
  });
});
