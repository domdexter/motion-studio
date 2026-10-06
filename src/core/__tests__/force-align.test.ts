import { describe, expect, it } from "vitest";
import { alignTextToTimedWords } from "../transcript/force-align";
import type { TimedWord } from "../spec/timing";

const spoken = (text: string, start = 0, step = 0.5): TimedWord[] =>
  text.split(" ").map((t, i) => ({ i, text: t, start: start + i * step, end: start + i * step + step * 0.8 }));

describe("alignTextToTimedWords", () => {
  it("keeps script wording and takes spoken timing for matches", () => {
    const res = alignTextToTimedWords("Running a business shouldn't feel this complicated.", spoken("running a business shouldnt feel this complicated"), 4);
    expect(res.words.map((w) => w.text)).toEqual(["Running", "a", "business", "shouldn't", "feel", "this", "complicated."]);
    expect(res.words[2].start).toBe(1);
    expect(res.matchedRatio).toBe(1);
    expect(res.interpolatedWords).toBe(0);
  });

  it("interpolates script words the narrator skipped", () => {
    const res = alignTextToTimedWords("We built one simple platform", spoken("we built one platform"), 3);
    const simple = res.words.find((w) => w.text === "simple")!;
    const one = res.words.find((w) => w.text === "one")!;
    const platform = res.words.find((w) => w.text === "platform")!;
    expect(simple.interpolated).toBe(true);
    expect(simple.start).toBeGreaterThanOrEqual(one.end);
    expect(simple.end).toBeLessThanOrEqual(platform.start);
  });

  it("distributes replaced spans across the spoken span", () => {
    const res = alignTextToTimedWords("Save 12 hours", spoken("save twelve hours"), 2);
    expect(res.words[1].start).toBe(0.5);
    expect(res.words.map((w) => w.start)).toEqual([0, 0.5, 1]);
  });

  it("spreads evenly when there is nothing spoken to anchor to", () => {
    const res = alignTextToTimedWords("one two three four", [], 4);
    expect(res.words.map((w) => w.start)).toEqual([0, 1, 2, 3]);
    expect(res.interpolatedWords).toBe(4);
  });
});
