import { describe, expect, it } from "vitest";
import { durationToTotalFrames, formatClock, formatTimecode, secondsToFrames, spanToFrames } from "../timing/frames";
import {
  refineWordEnds,
  sanitizeWords,
  timedCharsFromElevenLabs,
  wordsFromForcedAlignment,
  wordsFromSpeechMarks,
  wordsFromSpeechToText,
  wordsFromTimedChars,
  interpolateWords,
} from "../transcript/normalize";
import { buildTimelineData } from "../transcript/segment";
import { compareScriptToTranscript, mapWordIndices, paragraphIndexForWords } from "../transcript/align";
import type { TimedWord } from "../spec/timing";

function charsFor(text: string, secPerChar = 0.05) {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * secPerChar),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * secPerChar),
  };
}

const W = (text: string, start: number, end: number, i = 0): TimedWord => ({ i, text, start, end });

describe("frames", () => {
  it("converts seconds to frames with consistent rounding", () => {
    expect(secondsToFrames(3.74, 30)).toBe(112);
    expect(secondsToFrames(0.05, 30)).toBe(2); // 1.5 → 2 despite float error
    expect(secondsToFrames(0, 30)).toBe(0);
  });

  it("never accumulates drift across adjacent spans", () => {
    const boundaries = [0, 1.013, 2.377, 3.74, 5.211, 7.9, 9.82, 12.41];
    let total = 0;
    for (let i = 0; i + 1 < boundaries.length; i++) {
      const span = spanToFrames(boundaries[i], boundaries[i + 1], 30);
      if (i > 0) expect(span.from).toBe(spanToFrames(boundaries[i - 1], boundaries[i], 30).to);
      total += span.durationInFrames;
    }
    expect(total).toBe(secondsToFrames(12.41, 30));
  });

  it("uses ceil for the total so the audio tail is kept", () => {
    expect(durationToTotalFrames(42.73, 30)).toBe(1282);
    expect(durationToTotalFrames(2, 30)).toBe(60);
  });

  it("formats timecodes", () => {
    expect(formatTimecode(62.5, 30)).toBe("01:02:15");
    expect(formatClock(3.74)).toBe("0:03.74");
  });
});

describe("ElevenLabs character alignment → words", () => {
  it("groups characters into words with first/last character timing", () => {
    const text = "Running a business shouldn't feel this complicated.";
    const words = wordsFromTimedChars(timedCharsFromElevenLabs(charsFor(text)));
    expect(words.map((w) => w.text)).toEqual(["Running", "a", "business", "shouldn't", "feel", "this", "complicated."]);
    expect(words[0]).toMatchObject({ i: 0, start: 0, end: 0.35 });
    expect(words[1]).toMatchObject({ start: 0.4, end: 0.45 });
    expect(words[6].end).toBeCloseTo(text.length * 0.05, 5);
  });

  it("attaches free-standing punctuation to the previous word", () => {
    const words = wordsFromTimedChars(timedCharsFromElevenLabs(charsFor("Tools — everywhere")));
    expect(words.map((w) => w.text)).toEqual(["Tools—", "everywhere"]);
  });

  it("applies a chunk offset", () => {
    const chars = timedCharsFromElevenLabs(charsFor("Hi there"), 10);
    expect(wordsFromTimedChars(chars)[0].start).toBe(10);
  });
});

describe("other providers → words", () => {
  it("forced alignment keeps order and maps loss to confidence", () => {
    const words = wordsFromForcedAlignment({ words: [W("Hello", 0.1, 0.4) as never, { text: " ", start: 0.4, end: 0.45 }, { text: "world.", start: 0.5, end: 0.9, loss: 0 }] });
    expect(words.map((w) => w.text)).toEqual(["Hello", "world."]);
    expect(words[1].confidence).toBe(1);
  });

  it("speech-to-text skips spacing and audio events", () => {
    const words = wordsFromSpeechToText({
      words: [
        { text: "Hi", type: "word", start: 0, end: 0.2, logprob: 0 },
        { text: " ", type: "spacing", start: 0.2, end: 0.25 },
        { text: "(laughs)", type: "audio_event", start: 0.25, end: 0.8 },
        { text: "team.", type: "word", start: 0.8, end: 1.1 },
      ],
    });
    expect(words.map((w) => w.text)).toEqual(["Hi", "team."]);
  });

  it("system voice marks keep trailing punctuation and refine ends from the envelope", () => {
    const text = "Running a business. That's why.";
    const marks = [
      { audioMs: 100, charPos: 0, charCount: 7, text: "Running" },
      { audioMs: 600, charPos: 8, charCount: 1, text: "a" },
      { audioMs: 700, charPos: 10, charCount: 8, text: "business" },
      { audioMs: 2000, charPos: 20, charCount: 6, text: "That's" },
      { audioMs: 2400, charPos: 27, charCount: 3, text: "why" },
    ];
    const words = wordsFromSpeechMarks(marks, text, 3);
    expect(words.map((w) => w.text)).toEqual(["Running", "a", "business.", "That's", "why."]);
    expect(words[2].end).toBe(2); // provisional: next start
    // envelope: loud from 0.1–1.3s and 2.0–2.8s
    const hop = 0.01;
    const values = Array.from({ length: 300 }, (_, i) => {
      const t = i * hop;
      return (t >= 0.1 && t < 1.3) || (t >= 2 && t < 2.8) ? 1 : 0;
    });
    const refined = refineWordEnds(words, { hopSec: hop, values }, 3);
    expect(refined[2].end).toBeCloseTo(1.3, 2);
    expect(refined[4].end).toBeCloseTo(2.8, 2);
  });

  it("sanitize sorts and reindexes", () => {
    const out = sanitizeWords([W("b", 1, 0.5, 5), W("a", 0, 0.4, 9)]);
    expect(out.map((w) => [w.i, w.text, w.end])).toEqual([
      [0, "a", 0.4],
      [1, "b", 1],
    ]);
  });

  it("interpolates words across a span proportionally and flags them", () => {
    const words = interpolateWords("One platform.", 2, 3);
    expect(words).toHaveLength(2);
    expect(words[0].start).toBe(2);
    expect(words.every((w) => w.interpolated)).toBe(true);
    expect(words[1].end).toBeLessThanOrEqual(3);
  });
});

describe("segmentation", () => {
  const words = [
    W("Running", 0, 0.3), W("a", 0.31, 0.4), W("business", 0.42, 0.9), W("shouldn't", 0.91, 1.3), W("feel", 1.32, 1.5),
    W("this", 1.52, 1.7), W("complicated.", 1.72, 2.4), W("Most", 3.2, 3.4), W("teams", 3.42, 3.7), W("juggle", 3.72, 4.0),
    W("email,", 4.02, 4.4), W("chat,", 4.8, 5.1), W("and", 5.12, 5.2), W("spreadsheets.", 5.22, 6.0),
    W("That's", 7.5, 7.8), W("why", 7.82, 8.0), W("we", 8.02, 8.1), W("built", 8.12, 8.4), W("one", 8.42, 8.6), W("platform.", 8.62, 9.2),
  ].map((w, i) => ({ ...w, i }));

  it("builds sentences, phrases and pause-based paragraphs", () => {
    const tl = buildTimelineData(words, 9.5);
    expect(tl.sentences.map((s) => s.id)).toEqual(["segment_01", "segment_02", "segment_03"]);
    expect(tl.sentences[0]).toMatchObject({ text: "Running a business shouldn't feel this complicated.", start: 0, end: 2.4, wordStart: 0, wordEnd: 7 });
    // 0.8s pause after sentence 1 (same paragraph), 1.5s pause after sentence 2 (new paragraph)
    expect(tl.paragraphs.map((p) => [p.wordStart, p.wordEnd])).toEqual([
      [0, 14],
      [14, 20],
    ]);
    expect(tl.phrases.some((p) => p.text === "Most teams juggle email,")).toBe(true);
    expect(tl.duration).toBe(9.5);
  });

  it("uses script paragraph mapping when provided", () => {
    const paragraphOfWord = words.map((_, i) => (i < 14 ? 0 : 1));
    const tl = buildTimelineData(words, 9.5, { paragraphOfWord });
    expect(tl.paragraphs.map((p) => [p.wordStart, p.wordEnd])).toEqual([
      [0, 14],
      [14, 20],
    ]);
    expect(tl.sentences[2].paragraph).toBe(1);
  });
});

describe("script ↔ transcript alignment", () => {
  const spoken = (s: string) => s.split(" ").map((t, i) => W(t, i, i + 0.5, i));

  it("detects an identical read", () => {
    const res = compareScriptToTranscript("Running a business shouldn't feel this complicated.", spoken("Running a business shouldn't feel this complicated."));
    expect(res.identical).toBe(true);
    expect(res.matchedRatio).toBe(1);
  });

  it("reports insertions, deletions and replacements without touching the script", () => {
    const res = compareScriptToTranscript("We built one simple platform for teams.", spoken("So we built one platform for all teams."));
    const types = res.differences.map((d) => d.type).sort();
    expect(types).toEqual(["delete", "insert", "insert"]);
    expect(res.differences.find((d) => d.type === "delete")?.scriptText).toBe("simple");
  });

  it("treats digits and number words as equal", () => {
    const res = compareScriptToTranscript("Juggling 5 tools", spoken("Juggling five tools"));
    expect(res.identical).toBe(true);
  });

  it("maps transcript words to script paragraphs", () => {
    const map = paragraphIndexForWords(["Running a business is hard.", "That's why we built this."], spoken("Running a business is hard. Um that's why we built this."));
    expect(map.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(map[5]).toBeNull(); // "Um" is off-script
    expect(map.slice(6)).toEqual([1, 1, 1, 1, 1]);
  });

  it("maps word indices between two takes", () => {
    const oldWords = spoken("one two three four five");
    const newWords = spoken("one two extra three four five");
    expect(mapWordIndices(oldWords, newWords)).toEqual([0, 1, 3, 4, 5]);
  });
});
