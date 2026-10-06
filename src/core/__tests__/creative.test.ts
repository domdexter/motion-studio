import { describe, expect, it } from "vitest";
import { DESIGN_PRESETS } from "../design/presets";
import { densityScale, grammarEnter, roleScale } from "../creative/grammar";
import { analyzeCreative, contrastRatio, regionOf, type MetricsInput, type MetricsScene } from "../creative/metrics";
import { CreativePlanSchema, CreativeReviewInputSchema, RegionSchema, SceneCreativeSchema, mergeCreativePlan, parseCreativePlan } from "../creative/schema";
import { SceneSpecSchema, assetIdsInSpec, type SceneSpec } from "../spec/scene";
import type { TimedWord } from "../spec/timing";
import { collectSceneEvents, resolveShotWindows, resolveTrigger } from "../spec/triggers";

function words(text: string, start = 0, step = 0.4): TimedWord[] {
  return text.split(/\s+/).map((t, i) => ({ i, text: t, start: start + i * step, end: start + i * step + step * 0.8 }));
}

const design = DESIGN_PRESETS[0].design;

describe("shots", () => {
  const w = words("No scattered tools no complicated workflows just one platform");
  const ctx = { words: w, sceneStart: 0, sceneEnd: 4.4 };
  const spec = SceneSpecSchema.parse({
    elements: [{ id: "persistent", type: "text", text: "Incep", z: 5 }],
    shots: [
      { id: "a", elements: [{ id: "tools", type: "cards", items: [{ title: "A" }, { title: "B" }], enter: { type: "pop" } }] },
      { id: "b", at: { type: "word", value: "complicated" }, elements: [{ id: "late", type: "text", text: "Late", enter: { type: "fade", at: { type: "word", value: "tools" } } }] },
      { id: "c", at: { type: "word", value: "one" }, transitionIn: { type: "fade" }, elements: [{ id: "hub", type: "text", text: "One", enter: { type: "scale", at: { type: "shotTime", seconds: 0.2 } } }] },
    ],
  });

  it("resolves shot windows in order inside the scene timing", () => {
    const windows = resolveShotWindows(spec, ctx);
    expect(windows.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(windows[0].start).toBe(0);
    expect(windows[1].start).toBeCloseTo(w[4].start);
    expect(windows[0].end).toBeCloseTo(windows[1].start);
    expect(windows[2].end).toBe(4.4);
    expect(windows.every((x) => x.ok)).toBe(true);
  });

  it("flags shots that start before the previous shot and repairs the order", () => {
    const bad = SceneSpecSchema.parse({ elements: [], shots: [{ id: "a", at: { type: "word", value: "one" }, elements: [] }, { id: "b", at: { type: "word", value: "tools" }, elements: [] }] });
    const windows = resolveShotWindows(bad, ctx);
    expect(windows[1].ok).toBe(false);
    expect(windows[1].start).toBeGreaterThan(windows[0].start);
  });

  it("uses the shot as the default and shot-trigger segment", () => {
    const windows = resolveShotWindows(spec, ctx);
    const shotCtx = { ...ctx, shotStart: windows[2].start, shotEnd: windows[2].end };
    expect(resolveTrigger(undefined, shotCtx, "sceneStart").time).toBeCloseTo(windows[2].start);
    expect(resolveTrigger({ type: "shotTime", seconds: 0.2 }, shotCtx).time).toBeCloseTo(windows[2].start + 0.2);
    expect(resolveTrigger({ type: "shotEnd" }, shotCtx).time).toBeCloseTo(4.4);
    expect(resolveTrigger({ type: "shotStart" }, ctx).time).toBe(0);
  });

  it("reports shot element events that fire while their shot is off screen", () => {
    const events = collectSceneEvents(spec, ctx);
    const late = events.find((e) => e.elementId === "b/late");
    expect(late?.ok).toBe(false);
    expect(late?.reason).toMatch(/outside shot "b"/);
    expect(events.filter((e) => e.kind === "shot")).toHaveLength(3);
    expect(events.find((e) => e.elementId === "c/hub")?.ok).toBe(true);
  });

  it("matches voice-synced text to the words of its own shot", () => {
    const repeated = SceneSpecSchema.parse({
      elements: [],
      shots: [
        { id: "one", elements: [{ id: "first", type: "text", text: "No scattered tools.", enter: { type: "wordReveal" }, syncToVoice: true }] },
        { id: "two", at: { type: "word", value: "no", occurrence: 2 }, elements: [{ id: "second", type: "text", text: "No complicated workflows.", enter: { type: "wordReveal" }, syncToVoice: true }] },
      ],
    });
    const events = collectSceneEvents(repeated, ctx);
    const first = events.find((e) => e.elementId === "one/first");
    const second = events.find((e) => e.elementId === "two/second");
    expect(first?.time).toBeCloseTo(w[0].start);
    expect(second?.time).toBeCloseTo(w[3].start);
    expect(second?.ok).toBe(true);
    expect(second?.voiceSynced).toBe(true);
  });

  it("keeps legacy specs valid and rejects duplicate shot ids", () => {
    expect(SceneSpecSchema.safeParse({ version: 1, elements: [{ type: "text", text: "Hi" }] }).success).toBe(true);
    expect(SceneSpecSchema.safeParse({ elements: [], shots: [{ id: "x", elements: [] }, { id: "x", elements: [] }] }).success).toBe(false);
  });

  it("collects asset ids from shots and shot backgrounds", () => {
    const withAssets = SceneSpecSchema.parse({ elements: [], shots: [{ id: "a", background: { type: "image", assetId: "ast_bg" }, elements: [{ type: "image", assetId: "ast_shot" }] }] });
    expect(assetIdsInSpec(withAssets).sort()).toEqual(["ast_bg", "ast_shot"]);
  });
});

describe("motion grammar", () => {
  it("maps intents to meaningful entrances", () => {
    expect(grammarEnter("emphasize", "card")?.type).toBe("scale");
    expect(grammarEnter("statement", "text")?.type).toBe("wordReveal");
    expect(grammarEnter("sequence", "list")?.stagger).toBeGreaterThan(0);
    expect(grammarEnter("rest", "image")).toBeUndefined();
  });

  it("scales density and hierarchy without touching unspecified motion", () => {
    expect(densityScale(undefined)).toEqual({ duration: 1, distance: 1, emphasis: 1, idle: 1 });
    expect(densityScale("minimal").distance).toBeLessThan(densityScale("peak").distance);
    expect(roleScale("tertiary").idle).toBe(0);
    expect(roleScale(undefined).distance).toBe(1);
  });
});

describe("creative schemas", () => {
  it("accepts a full creative plan and normalizes region aliases", () => {
    const plan = CreativePlanSchema.parse({
      direction: { concept: "From fragmented complexity to one intelligent platform", avoid: ["generic AI aesthetics", "excessive glow"] },
      storyArc: { acts: [{ id: "problem", name: "Problem", visualLanguage: ["fragmentation"], intensity: 3, scenes: ["scene_01", "scene_02"] }] },
      visualLanguage: { transitions: { frequency: "restrained", allowed: ["cut", "fade"] }, color: { glow: "none" } },
      visualDistribution: { kineticTypography: 0.2, productUI: 0.4 },
    });
    expect(plan.storyArc?.acts[0].scenes).toHaveLength(2);
    expect(RegionSchema.parse("left-center")).toBe("center-left");
    expect(SceneCreativeSchema.parse({ composition: { negativeSpace: "Right-Center" } }).composition?.negativeSpace).toBe("center-right");
  });

  it("rejects unknown plan fields and merges by section", () => {
    expect(parseCreativePlan({ direction: { concept: "x", colour: "red" } }).ok).toBe(false);
    const merged = mergeCreativePlan({ direction: { concept: "A", avoid: [] }, notes: "keep" }, { direction: { concept: "B" }, notes: null });
    expect(merged).toEqual({ direction: { concept: "B" } });
  });

  it("requires written critique behind scores", () => {
    expect(CreativeReviewInputSchema.safeParse({ summary: "A detailed enough summary of the review.", overallScore: 86 }).success).toBe(false);
    expect(
      CreativeReviewInputSchema.safeParse({
        summary: "A detailed enough summary of the review.",
        overallScore: 86,
        issues: [{ scene: "scene_04", severity: "medium", category: "motion", issue: "Too much simultaneous movement", recommendation: "Reduce secondary animation" }],
      }).success,
    ).toBe(true);
  });
});

describe("creative metrics", () => {
  const W = words("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty", 0, 0.5);
  const scene = (i: number, spec: object, creative: MetricsScene["creative"] = null): MetricsScene => ({ key: `scene_0${i + 1}`, name: `S${i + 1}`, start: i * 2.5, end: (i + 1) * 2.5, spec: SceneSpecSchema.parse(spec) as SceneSpec, creative });
  const base = (scenes: MetricsScene[], extra: Partial<MetricsInput> = {}): MetricsInput => ({
    width: 1920,
    height: 1080,
    design: { ...design, colors: { ...design.colors, background: "#F5F5F5", text: "#212121", secondary: "#3FE7EF" } },
    words: W,
    scenes,
    plan: null,
    assets: { ast_ui: { kind: "screenshot", source: "claude", width: 1100, height: 728 } },
    ...extra,
  });
  const template = { elements: [{ id: "headline", type: "text", role: "title", text: "A headline here", x: 8, y: 50, anchor: "left", maxWidth: 30 }, { id: "ui", type: "image", assetId: "ast_ui", x: 68, y: 50, width: 57, height: 67 }] };

  it("detects repeated layouts and template-like structure", () => {
    const m = analyzeCreative(base([0, 1, 2, 3, 4, 5].map((i) => scene(i, template))));
    expect(m.scenes[0].detected.family).toBe("productUI");
    expect(m.scenes[0].layout.focal).toBe("center-right");
    expect(m.findings.some((f) => f.code === "repetitive-layout")).toBe(true);
    expect(m.findings.some((f) => f.code === "template-like")).toBe(true);
  });

  it("flags simultaneous entrances, camera moves on UI and low-contrast accent text", () => {
    const busy = {
      camera: { type: "pushIn", amount: 0.04 },
      elements: [
        ...[20, 35, 50, 65, 80].map((x, k) => ({ id: `b${k}`, type: "badge", text: "Tag", x, y: 20, enter: { type: "pop" } })),
        { id: "ui", type: "image", assetId: "ast_ui", x: 50, y: 60, width: 40, height: 40, enter: { type: "rise" } },
        { id: "accent", type: "text", role: "body", text: "Hard to read", color: "secondary", x: 50, y: 90 },
      ],
    };
    const m = analyzeCreative(base([scene(0, busy)]));
    const codes = m.findings.map((f) => f.code);
    expect(codes).toContain("simultaneous-entrances");
    expect(codes).toContain("camera-on-ui");
    expect(codes).toContain("low-contrast");
  });

  it("measures density, compares it with the plan and treats legacy scenes as unplanned", () => {
    const quiet = scene(0, { elements: [{ id: "t", type: "text", role: "headline", text: "Calm", enter: { type: "fade" } }] }, { motion: { density: "peak" }, intensity: 5 });
    const legacy = scene(1, template);
    const m = analyzeCreative(base([quiet, legacy]));
    expect(m.scenes[0].motion.measuredDensity).toBe("minimal");
    expect(m.findings.some((f) => f.code === "density-mismatch" && f.scene === "scene_01")).toBe(true);
    expect(m.findings.some((f) => f.code === "no-creative-intent" && f.scene === "scene_02")).toBe(true);
    const total = Object.values(m.distribution.measured).reduce((n, v) => n + (v ?? 0), 0);
    expect(total).toBeGreaterThan(0.95);
    expect(total).toBeLessThan(1.05);
  });

  it("flags motion that its shot cuts off before it finishes", () => {
    const cut = (collapseWord: string) =>
      scene(0, {
        elements: [],
        shots: [
          {
            id: "converge",
            elements: [
              { id: "fragments", type: "cards", layout: "scatter", items: [{}, {}, {}], collapseAt: { type: "word", value: collapseWord } },
              { id: "piece", type: "rect", x: 20, y: 20, width: 5, height: 5, exit: { type: "converge", at: { type: "word", value: "two" }, duration: 0.4, to: [50, 50] } },
            ],
          },
          { id: "reveal", at: { type: "word", value: "four" }, elements: [{ id: "brand", type: "text", role: "display", text: "Brand" }] },
        ],
      });
    const late = analyzeCreative(base([cut("three")])).findings.filter((f) => f.code === "motion-cut-off");
    expect(late).toHaveLength(1);
    expect(late[0].severity).toBe("medium");
    expect(late[0].shot).toBe("converge");
    const early = analyzeCreative(base([cut("one")]));
    expect(early.findings.some((f) => f.code === "motion-cut-off")).toBe(false);
    expect(early.scenes[0].detected.patterns).toContain("transformation");
  });

  it("computes WCAG contrast and regions", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#3FE7EF", "#F5F5F5")!).toBeLessThan(2);
    expect(regionOf(0.8, 0.5)).toBe("center-right");
    expect(regionOf(0.2, 0.2)).toBe("top-left");
  });
});
