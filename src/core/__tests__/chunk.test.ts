import { describe, expect, it } from "vitest";
import { chunkSpokenText } from "../script/chunk";

describe("chunkSpokenText", () => {
  it("keeps short scripts in one chunk", () => {
    expect(chunkSpokenText(["Hello there.", "One platform."], 5000)).toEqual(["Hello there.\n\nOne platform."]);
  });

  it("splits at paragraph boundaries first, then sentences, never exceeding the limit", () => {
    const p1 = "Running a business shouldn't feel this complicated. ".repeat(3).trim();
    const p2 = "That's why we built one platform for everything. ".repeat(3).trim();
    const chunks = chunkSpokenText([p1, p2], 120);
    expect(chunks.every((c) => c.length <= 120)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(`${p1} ${p2}`.replace(/\s+/g, " "));
    expect(chunks.every((c) => /[.!?]$/.test(c))).toBe(true);
  });

  it("falls back to word boundaries for a sentence longer than the limit", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ") + ".";
    const chunks = chunkSpokenText([long], 80);
    expect(chunks.every((c) => c.length <= 80)).toBe(true);
    expect(chunks.join(" ")).toBe(long);
  });
});
