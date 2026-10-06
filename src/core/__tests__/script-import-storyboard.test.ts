import { describe, expect, it } from "vitest";
import { parseScript, scriptSpokenHash, estimateTiming } from "../script/script";
import { analyzeScriptRules } from "../script/analyze";
import { parseSrt, parseTimingFile, parseTimingJson, parseVtt, wordsFromParsedTiming, TimingParseError } from "../import/timing-files";
import { extractListItems, extractNumbers, keyPhrase, chooseArchetype, wordTrigger } from "../storyboard/heuristics";
import { resolveTrigger, collectSceneEvents } from "../spec/triggers";
import { planScenes, recomputeSceneTimes, remapAnchors, boundariesFromAnchors, compareTimelines } from "../timeline/scenes";
import { buildTimelineData } from "../transcript/segment";
import { draftStoryboard } from "../storyboard/draft";
import { SceneSpecSchema, validateSceneSpec, assetIdsInSpec } from "../spec/scene";
import { derivePipeline, type PipelineInput } from "../status/pipeline";
import { interpolateWords } from "../transcript/normalize";
import type { TimedWord } from "../spec/timing";

const SCRIPT = `# Launch video

Running a business shouldn't feel this **complicated**.

[Music swells]

Most teams juggle email, chat, spreadsheets, and invoices. That's why we built Incep Platform — one place for everything.

Teams save 12 hours every week. Get started today.`;

function wordsForText(text: string, secPerWord = 0.4, pause = 0.5): TimedWord[] {
  const out: TimedWord[] = [];
  let t = 0;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    out.push({ i: out.length, text: token, start: Math.round(t * 1000) / 1000, end: Math.round((t + secPerWord * 0.9) * 1000) / 1000 });
    t += secPerWord;
    if (/[.!?]$/.test(token)) t += pause;
  }
  return out;
}

describe("script parsing", () => {
  it("separates spoken text from headings and directions and records emphasis", () => {
    const parsed = parseScript(SCRIPT);
    expect(parsed.spokenParagraphs).toHaveLength(3);
    expect(parsed.spokenParagraphs[0]).toBe("Running a business shouldn't feel this complicated.");
    expect(parsed.blocks.filter((b) => b.kind !== "spoken").map((b) => b.kind)).toEqual(["heading", "direction"]);
    expect(parsed.emphasis).toContain("complicated");
  });

  it("hash ignores formatting-only edits but not wording changes", () => {
    const a = scriptSpokenHash("Hello **world**.\n\n# Note");
    const b = scriptSpokenHash("Hello world.");
    const c = scriptSpokenHash("Hello there world.");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("estimates timing and labels it as estimated", () => {
    const est = estimateTiming(parseScript(SCRIPT).spokenParagraphs, 150);
    expect(est.estimated).toBe(true);
    expect(est.duration).toBeGreaterThan(8);
    expect(est.sentences[0].start).toBe(0);
  });

  it("rule-based analysis yields beats with estimated timing and visual suggestions", () => {
    const analysis = analyzeScriptRules(SCRIPT, { brandName: "Incep Platform" });
    expect(analysis.source).toBe("rules");
    expect(analysis.beats.length).toBeGreaterThanOrEqual(3);
    expect(analysis.beats[0].kind).toBe("hook");
    expect(analysis.beats.at(-1)?.kind).toBe("cta");
    expect(analysis.sceneBoundaries.length).toBeGreaterThan(0);
  });
});

describe("timing file import", () => {
  it("parses SRT", () => {
    const parsed = parseSrt("1\n00:00:00,000 --> 00:00:03,740\nRunning a business <i>shouldn't</i>\nfeel this complicated.\n\n2\n00:00:04,000 --> 00:00:06,500\nOne platform.\n");
    expect(parsed.cues).toEqual([
      { text: "Running a business shouldn't feel this complicated.", start: 0, end: 3.74 },
      { text: "One platform.", start: 4, end: 6.5 },
    ]);
    const { words, cues, interpolatedWords } = wordsFromParsedTiming(parsed);
    expect(words).toHaveLength(9);
    expect(interpolatedWords).toBe(9);
    expect(cues[1]).toMatchObject({ wordStart: 7, wordEnd: 9, start: 4, end: 6.5 });
  });

  it("parses WebVTT with inline word timestamps", () => {
    const parsed = parseVtt("WEBVTT\n\n00:01.000 --> 00:03.000\nOne <00:01.500>platform <00:02.200>today.\n");
    expect(parsed.words?.map((w) => [w.text, w.start])).toEqual([
      ["One", 1],
      ["platform", 1.5],
      ["today.", 2.2],
    ]);
  });

  it("parses our JSON timeline format, word lists and ElevenLabs alignment", () => {
    const seg = parseTimingJson(JSON.stringify({ duration: 42.73, segments: [{ text: "Running a business...", start: 0, end: 3.74 }] }));
    expect(seg.duration).toBe(42.73);
    expect(seg.cues[0].end).toBe(3.74);

    const words = parseTimingJson(JSON.stringify({ words: [{ word: "platform", start: 12.42, end: 12.91 }] }));
    expect(words.words?.[0]).toMatchObject({ text: "platform", start: 12.42, end: 12.91 });

    const chars = [..."Hi team"];
    const el = parseTimingJson(
      JSON.stringify({
        audio_base64: "",
        alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i / 10), character_end_times_seconds: chars.map((_, i) => (i + 1) / 10) },
      }),
    );
    expect(el.words?.map((w) => w.text)).toEqual(["Hi", "team"]);
  });

  it("rejects garbage with a helpful error", () => {
    expect(() => parseTimingFile("x.json", "{\"foo\": 1}")).toThrow(TimingParseError);
    expect(() => parseTimingFile("x.txt", "hello")).toThrow(/Unsupported/);
  });
});

describe("heuristics", () => {
  it("extracts key phrases, list items and numbers", () => {
    expect(keyPhrase("Most businesses are juggling five different tools.")).toBe("Juggling five different tools");
    expect(keyPhrase("That's why we built one platform.")).toBe("That's why we built one platform");
    expect(extractListItems("Most teams juggle email, chat, spreadsheets, and invoices.")).toEqual(["email", "chat", "spreadsheets", "invoices"]);
    const n = extractNumbers("Teams save 12 hours and grow revenue by 35%.");
    expect(n.map((x) => [x.value, x.suffix])).toEqual([
      [12, " hours"],
      [35, "%"],
    ]);
  });

  it("chooses archetypes from meaning", () => {
    // A generic pain statement is a typographic hero; tool-juggling pain becomes scattered cards.
    expect(chooseArchetype("Running a business shouldn't feel this complicated.", { index: 0, total: 4, hasBrand: true })).toBe("hero_statement");
    expect(chooseArchetype("Most teams juggle five different tools just to get through the week.", { index: 1, total: 4, hasBrand: true })).toBe("problem_scatter");
    expect(chooseArchetype("Customers grow revenue by 35%.", { index: 1, total: 4, hasBrand: true })).toBe("stat_callout");
    expect(chooseArchetype("Get started today.", { index: 3, total: 4, hasBrand: true })).toBe("logo_cta");
  });

  it("never repeats the previous scene's archetype", () => {
    expect(chooseArchetype("That's why we built one place to run everything.", { index: 2, total: 5, hasBrand: false, previous: "problem_scatter" })).toBe("solution_collapse");
    expect(chooseArchetype("One place to run everything.", { index: 3, total: 5, hasBrand: false, previous: "solution_collapse" })).toBe("hub_diagram");
    expect(chooseArchetype("It just works.", { index: 2, total: 5, hasBrand: false, previous: "kinetic_voice" })).not.toBe("kinetic_voice");
  });

  it("builds word triggers from the spoken form", () => {
    const words = wordsForText("That's why we built one platform.");
    expect(wordTrigger(words, ["platform"])).toEqual({ type: "word", value: "platform" });
  });
});

describe("triggers", () => {
  const words = wordsForText("Running a business shouldn't feel this complicated. One platform, one place, one login.");
  const ctx = { words, sceneStart: 0, sceneEnd: 20 };

  it("resolves words, occurrences, phrases and offsets", () => {
    const platform = words.find((w) => w.text.startsWith("platform"))!;
    expect(resolveTrigger({ type: "word", value: "Platform" }, ctx)).toMatchObject({ ok: true, time: platform.start });
    const ones = words.filter((w) => w.text.toLowerCase() === "one");
    expect(resolveTrigger({ type: "word", value: "one", occurrence: 3 }, ctx).time).toBe(ones[2].start);
    expect(resolveTrigger({ type: "phrase", value: "one place", edge: "end" }, ctx).time).toBe(words.find((w) => w.text === "place,")!.end);
    expect(resolveTrigger({ type: "sceneTime", seconds: 1, offset: 0.5 }, ctx).time).toBe(1.5);
  });

  it("reports unspoken words and clamps out-of-scene times", () => {
    const miss = resolveTrigger({ type: "word", value: "dashboard" }, ctx);
    expect(miss.ok).toBe(false);
    expect(miss.reason).toMatch(/not spoken/);
    const out = resolveTrigger({ type: "time", seconds: 50 }, { ...ctx, sceneEnd: 10 });
    expect(out).toMatchObject({ ok: false, time: 10 });
  });

  it("collects scene events for timeline markers", () => {
    const spec = SceneSpecSchema.parse({
      elements: [{ id: "logo", type: "logo", enter: { type: "pop", at: { type: "word", value: "platform" } } }],
    });
    const events = collectSceneEvents(spec, ctx);
    expect(events[0]).toMatchObject({ elementId: "logo", kind: "enter", voiceSynced: true, ok: true });
  });
});

describe("scene planning & timing", () => {
  const text =
    "Running a business shouldn't feel this complicated. Yet here we are. Most teams juggle email, chat, spreadsheets, invoices, calendars, payroll, contracts and a dozen other tools every single day of the week. That's why we built one platform.";
  const words = wordsForText(text);
  const last = words[words.length - 1];
  const timeline = buildTimelineData(words, last.end + 0.3);

  it("plans contiguous scenes that respect pace limits", () => {
    const plans = planScenes(timeline, words, "medium");
    expect(plans[0].start).toBe(0);
    expect(plans.at(-1)!.end).toBe(timeline.duration);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i].start).toBe(plans[i - 1].end);
      expect(plans[i].wordStart).toBe(plans[i - 1].wordEnd);
    }
    // "Yet here we are." (short) is merged; the long list sentence is split.
    expect(plans.some((p) => p.voiceText.includes("Yet here we are.") && p.voiceText.includes("complicated."))).toBe(true);
    expect(plans.every((p) => p.end - p.start <= 7 + 0.7)).toBe(true);
  });

  it("recomputes audio-locked times while keeping user-adjusted edges", () => {
    const plans = planScenes(timeline, words, "medium");
    const scenes = plans.map((p) => ({ timingMode: "audio_locked" as const, wordStart: p.wordStart, wordEnd: p.wordEnd, start: p.start, end: p.end }));
    scenes[1] = { ...scenes[1], timingMode: "user_adjusted" as never, start: plans[1].start + 0.3 };
    const times = recomputeSceneTimes(scenes, words, timeline.duration);
    expect(times[1].start).toBeCloseTo(plans[1].start + 0.3, 3);
    expect(times[0].end).toBeCloseTo(times[1].start, 3);
    expect(times[2].start).toBe(boundariesFromAnchors(words, plans, timeline.duration)[2].start);
  });

  it("remaps anchors onto a new take with an inserted word", () => {
    const plans = planScenes(timeline, words, "medium");
    const newWords = wordsForText(text.replace("That's why", "And that's why"));
    const anchors = remapAnchors(words, newWords, plans);
    expect(anchors[0].wordStart).toBe(0);
    expect(anchors.at(-1)!.wordEnd).toBe(newWords.length);
    for (let i = 1; i < anchors.length; i++) expect(anchors[i].wordStart).toBe(anchors[i - 1].wordEnd);
    const cmp = compareTimelines(timeline, words, buildTimelineData(newWords, newWords.at(-1)!.end), newWords);
    expect(cmp.rows.at(-1)?.status).toBe("changed");
  });
});

describe("storyboard draft", () => {
  it("produces schema-valid specs for every scene", () => {
    const parsed = parseScript(SCRIPT);
    const words = wordsForText(parsed.spokenText);
    const timeline = buildTimelineData(words, words.at(-1)!.end + 0.5);
    const plans = planScenes(timeline, words, "medium");
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
    ]) {
      const scenes = draftStoryboard({ plans, words, width, height, brand: { brandName: "Incep Platform", tagline: "", website: "incep.io", logoAssetId: null } });
      expect(scenes.length).toBe(plans.length);
      for (const s of scenes) {
        expect(validateSceneSpec(s.spec).ok).toBe(true);
        expect(s.onScreenText.split(/\s+/).length).toBeLessThanOrEqual(8);
        expect(assetIdsInSpec(s.spec)).toEqual([]);
      }
      expect(scenes.at(-1)!.archetype).toBe("logo_cta");
    }
  });

  it("interpolated words still produce a storyboard", () => {
    const words = interpolateWords("Our platform connects sales, finance, and support in one place.", 0, 5);
    const timeline = buildTimelineData(words, 5);
    const scenes = draftStoryboard({ plans: planScenes(timeline, words), words, width: 1080, height: 1080, brand: { brandName: "", tagline: "", website: "", logoAssetId: null } });
    expect(scenes).toHaveLength(1);
    expect(SceneSpecSchema.safeParse(scenes[0].spec).success).toBe(true);
  });
});

describe("pipeline status", () => {
  const base: PipelineInput = {
    script: { hash: "s1", wordCount: 40 },
    voice: { id: "v1", source: "elevenlabs", scriptHash: "s1" },
    voiceJobRunning: false,
    alignmentJobRunning: false,
    transcript: { id: "t1", voiceTakeId: "v1" },
    timeline: { id: "tl1", transcriptId: "t1" },
    timelineDecision: null,
    scenes: { total: 4, approved: 4, staleTiming: 0, needsReview: 0, invalid: 0 },
    assets: { missing: 0, openRequests: 0, awaitingApproval: 0 },
    render: { running: false, latestComplete: { compositionHash: "c1" }, latestFailed: false },
    compositionHash: "c1",
  };

  it("is COMPLETE when everything is up to date", () => {
    expect(derivePipeline(base).status).toBe("COMPLETE");
  });

  it("marks only downstream stages stale when the script changes", () => {
    const r = derivePipeline({ ...base, script: { hash: "s2", wordCount: 41 } });
    expect(r.stages.voice.state).toBe("stale");
    expect(r.stages.assets.state).toBe("ready");
    expect(r.status).toBe("DRAFT");
    expect(r.next?.stage).toBe("voice");
  });

  it("flags timeline invalidation after a voice change, and respects keep", () => {
    const changed = { ...base, voice: { id: "v2", source: "import", scriptHash: null }, transcript: { id: "t2", voiceTakeId: "v2" } };
    expect(derivePipeline(changed).stages.timeline.state).toBe("stale");
    const kept = derivePipeline({ ...changed, timelineDecision: { voiceTakeId: "v2", decision: "keep" } });
    expect(kept.stages.timeline.state).toBe("attention");
  });

  it("only invalidates scenes and render when an asset changes", () => {
    const r = derivePipeline({ ...base, scenes: { ...base.scenes, needsReview: 1 }, compositionHash: "c2" });
    expect(r.stages.voice.state).toBe("ready");
    expect(r.stages.timeline.state).toBe("ready");
    expect(r.stages.scenes.state).toBe("stale");
    expect(r.stages.render.state).toBe("stale");
  });
});
