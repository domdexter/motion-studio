import { describe, expect, it } from "vitest";
import { parseMarkers } from "../spec/markers";
import { validateSceneSpec } from "../spec/scene";
import { inferProductName, inferStoryItems } from "../storyboard/draft";
import { TEMPLATES, type TemplateContext } from "../storyboard/templates";
import { profileText } from "../storyboard/heuristics";
import type { TimedWord } from "../spec/timing";

function words(text: string, start = 0, step = 0.4): TimedWord[] {
  return text.split(/\s+/).map((t, i) => ({ i, text: t, start: start + i * step, end: start + i * step + step * 0.8 }));
}

function ctx(voiceText: string, overrides: Partial<TemplateContext> = {}): TemplateContext {
  const sceneWords = words(voiceText);
  return {
    width: 1920,
    height: 1080,
    portrait: false,
    index: 1,
    total: 4,
    start: 0,
    end: sceneWords[sceneWords.length - 1].end,
    duration: sceneWords[sceneWords.length - 1].end,
    sceneWords,
    voiceText,
    onScreenText: voiceText,
    emphasis: [],
    profile: profileText(voiceText),
    brandName: "",
    tagline: "",
    website: "",
    hasLogo: false,
    storyItems: [],
    productName: "",
    ...overrides,
  };
}

describe("storyboard inference", () => {
  it("finds the product name introduced in the script", () => {
    expect(inferProductName(["Running a business shouldn't feel this complicated.", "That's why we built Incep Platform."])).toBe("Incep Platform");
    expect(inferProductName(["Meet Acme Flow, the calm way to plan."])).toBe("Acme Flow");
    expect(inferProductName(["We made it simple."])).toBe("");
  });

  it("reuses the first list named anywhere in the script", () => {
    expect(inferStoryItems(["Most teams juggle five tools:", "invoices, customers, projects, payments, and reports."])).toEqual(["invoices", "customers", "projects", "payments", "reports"]);
    expect(inferStoryItems(["No lists here."])).toEqual([]);
  });
});

describe("scene templates", () => {
  it("syncs each named item to the moment it is spoken", () => {
    const spec = TEMPLATES.feature_list(ctx("invoices, customers, projects, payments, and reports."));
    expect(validateSceneSpec(JSON.parse(JSON.stringify(spec))).ok).toBe(true);
    const cards = spec.elements.find((e) => e.type === "cards");
    expect(cards?.type).toBe("cards");
    if (cards?.type === "cards") {
      expect(cards.items).toHaveLength(5);
      expect(cards.items.every((item) => item.at?.type === "word")).toBe(true);
    }
  });

  it("hands a stat off to the call to action", () => {
    const text = "Teams save 12 hours every week. Get started today.";
    const spec = TEMPLATES.logo_cta(ctx(text, { index: 3, productName: "Incep Platform" }));
    expect(validateSceneSpec(JSON.parse(JSON.stringify(spec))).ok).toBe(true);
    const stat = spec.elements.find((e) => e.id === "stat");
    expect(stat?.type).toBe("counter");
    expect(stat?.exit?.at).toMatchObject({ type: "word", value: "Get" });
    expect(spec.elements.find((e) => e.type === "logo")).toMatchObject({ text: "Incep Platform" });
  });
});

describe("markers", () => {
  it("parses leniently and sorts by time", () => {
    expect(parseMarkers([{ id: "b", time: 4, label: "Drop" }, { id: "a", time: 1 }]).map((m) => m.id)).toEqual(["a", "b"]);
    expect(parseMarkers("not markers")).toEqual([]);
  });
});
