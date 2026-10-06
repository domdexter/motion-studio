import { describe, expect, it } from "vitest";
import { buildCaptionCues, toSrt, toVtt, wrapCaption } from "../publish/captions";
import { buildChapters, chaptersText, formatChapterTime } from "../publish/chapters";
import type { TimedWord } from "../spec/timing";

const w = (i: number, text: string, start: number, end: number) => ({ i, text, start, end }) as TimedWord;

describe("captions", () => {
  const words = [w(0, "Hello", 0, 0.4), w(1, "there.", 0.45, 0.9), w(2, "This", 1, 1.2), w(3, "is", 1.25, 1.35), w(4, "Handy.", 1.4, 1.9), w(5, "Um", 3, 3.2), w(6, "try", 4, 4.3), w(7, "it", 4.35, 4.5)];

  it("breaks at sentence ends and pauses, skips muted words and never overlaps", () => {
    const cues = buildCaptionCues(words, { cuts: [{ startSec: 2.9, endSec: 3.3 }] });
    expect(cues.map((c) => c.text)).toEqual(["Hello there.", "This is Handy.", "try it"]);
    const short = buildCaptionCues([w(0, "One", 0, 0.2), w(1, "two", 0.25, 0.4), w(2, "three", 0.45, 0.7), w(3, "four", 0.75, 0.9)], { maxChars: 10 });
    expect(short.map((c) => c.text)).toEqual(["One two", "three four"]);
    for (let i = 1; i < cues.length; i++) expect(cues[i].startSec).toBeGreaterThan(cues[i - 1].endSec);
  });

  it("formats SRT and WebVTT", () => {
    const cues = [{ startSec: 1.5, endSec: 3.25, text: "Hello there" }];
    expect(toSrt(cues)).toBe("1\n00:00:01,500 --> 00:00:03,250\nHello there\n");
    expect(toVtt(cues)).toBe("WEBVTT\n\n00:00:01.500 --> 00:00:03.250\nHello there\n");
    expect(wrapCaption("This dictation app types everything I say")).toBe("This dictation app\ntypes everything I say");
  });
});

describe("chapters", () => {
  it("starts at 0:00 and merges scenes shorter than 10 s into the chapter before", () => {
    const chapters = buildChapters([
      { name: "Intro", startSec: 0.5, endSec: 12.4 },
      { name: "Ranked", startSec: 12.4, endSec: 16 },
      { name: "The hunt", startSec: 16, endSec: 31 },
      { name: "Handy", startSec: 31, endSec: 44 },
      { name: "Outro", startSec: 44, endSec: 48 },
    ]);
    expect(chapters).toEqual([
      { startSec: 0, title: "Intro" },
      { startSec: 16, title: "The hunt" },
      { startSec: 31, title: "Handy" },
    ]);
    expect(chaptersText(chapters)).toBe("0:00 Intro\n0:16 The hunt\n0:31 Handy");
    expect(formatChapterTime(3725)).toBe("1:02:05");
  });
});
