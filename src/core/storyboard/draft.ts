import type { BrandProfile } from "../spec/brand";
import type { AssetRequirement, VisualType } from "../spec/enums";
import { SceneSpecSchema, type SceneSpec } from "../spec/scene";
import type { TimedWord } from "../spec/timing";
import type { ScenePlan } from "../timeline/scenes";
import { ARCHETYPE_VISUALS } from "../script/analyze";
import { splitSentences, stripTrailingPunctuation, tokenize } from "../util/text";
import { chooseArchetype, emphasisWords, keyPhrase, profileText, titleCase, type KeywordProfile, type SceneArchetype } from "./heuristics";
import { TEMPLATES, type TemplateContext } from "./templates";

/**
 * Rule-based storyboard draft. Deterministic: same timeline + brand → same storyboard.
 * Claude Code's generate_storyboard task replaces or refines this with real creative
 * judgment; locked scenes are never touched by either.
 */

export interface DraftInput {
  plans: ScenePlan[];
  words: TimedWord[];
  width: number;
  height: number;
  brand: Pick<BrandProfile, "brandName" | "tagline" | "website" | "logoAssetId">;
  markdownEmphasis?: string[];
}

export interface DraftScene {
  name: string;
  archetype: SceneArchetype;
  wordStart: number;
  wordEnd: number;
  start: number;
  end: number;
  voiceText: string;
  visualConcept: string;
  visualType: VisualType;
  animationNotes: string[];
  onScreenText: string;
  assetsRequired: AssetRequirement[];
  notes: string;
  spec: SceneSpec;
}

/** "That's why we built Incep Platform." → "Incep Platform" */
export function inferProductName(texts: string[]): string {
  // Verb in any case, name capitalized: "we built Incep Platform", "Meet Acme Flow".
  const re = /\b(?:[Bb]uilt|[Ii]ntroduc(?:ing|e)|[Mm]eet|[Cc]alled|[Nn]amed|[Pp]resenting)\s+((?:[A-Z][\w'’-]*)(?:\s+[A-Z][\w'’-]*){0,2})/;
  for (const t of texts) {
    const m = t.match(re);
    if (m) return stripTrailingPunctuation(m[1]).trim();
  }
  return "";
}

/** First list of ≥3 items named anywhere in the script (e.g. the tools a team juggles). */
export function inferStoryItems(texts: string[]): string[] {
  for (const t of texts) {
    const items = profileText(t).listItems;
    if (items.length >= 3) return items;
  }
  return [];
}

function sceneName(archetype: SceneArchetype, voiceText: string, onScreenText: string, profile: KeywordProfile, productName: string): string {
  const clean = (s: string) => titleCase(stripTrailingPunctuation(s.trim()).replace(/[?.!:;,]+$/, ""));
  const firstSentence = splitSentences(voiceText)[0] ?? voiceText;
  switch (archetype) {
    case "logo_cta":
      return "Call to Action";
    case "stat_callout": {
      const n = profile.numbers[0];
      return n ? clean(`${n.raw} ${keyPhrase(voiceText.replace(n.raw, " "), 3)}`) : clean(onScreenText);
    }
    case "feature_list":
      return profile.listItems.length >= 3 ? clean(profile.listItems.slice(0, 3).join(", ")) : clean(onScreenText);
    case "solution_collapse":
      return productName ? `Introducing ${productName}` : clean(onScreenText);
    case "problem_scatter": {
      // Start at the pain verb: "Most teams juggle five different tools…" → "Juggle Five Different Tools"
      const tokens = tokenize(firstSentence);
      const idx = tokens.findIndex((t) => profile.problem.some((term) => t.norm.startsWith(term.trim().split(" ")[0])));
      if (idx >= 0 && tokens.length - idx >= 3) return clean(tokens.slice(idx, idx + 4).map((t) => t.text).join(" "));
      return clean(keyPhrase(firstSentence, 5));
    }
    default:
      return clean(keyPhrase(firstSentence, 5));
  }
}

export function draftScene(input: DraftInput, index: number, previous?: SceneArchetype, story?: { items: string[]; productName: string }): DraftScene {
  const plan = input.plans[index];
  const voiceText = plan.voiceText;
  const texts = input.plans.map((p) => p.voiceText);
  const storyItems = story?.items ?? inferStoryItems(texts);
  const productName = input.brand.brandName ? "" : (story?.productName ?? inferProductName(texts));
  const profile = profileText(voiceText);
  const hasBrand = !!input.brand.brandName || !!input.brand.logoAssetId;
  const archetype = chooseArchetype(voiceText, { index, total: input.plans.length, hasBrand, previous, profile });
  const emphasis = emphasisWords(voiceText, { brandName: input.brand.brandName || productName, max: 3, markdownEmphasis: input.markdownEmphasis });
  const sentences = splitSentences(voiceText);
  const focusSentence = sentences[sentences.length - 1] ?? voiceText;
  const onScreenText = keyPhrase(focusSentence, archetype === "question" ? 8 : 6);
  const ctx: TemplateContext = {
    width: input.width,
    height: input.height,
    portrait: input.height > input.width,
    index,
    total: input.plans.length,
    start: plan.start,
    end: plan.end,
    duration: Math.max(0.1, plan.end - plan.start),
    sceneWords: input.words.slice(plan.wordStart, plan.wordEnd),
    voiceText,
    onScreenText,
    emphasis,
    profile,
    brandName: input.brand.brandName ?? "",
    tagline: input.brand.tagline ?? "",
    website: input.brand.website ?? "",
    hasLogo: !!input.brand.logoAssetId,
    storyItems,
    productName,
  };
  // JSON round-trip drops undefined keys so the spec is clean and schema-valid.
  const spec = SceneSpecSchema.parse(JSON.parse(JSON.stringify(TEMPLATES[archetype](ctx))));
  const visual = ARCHETYPE_VISUALS[archetype];

  const assetsRequired: AssetRequirement[] = [];
  const notes: string[] = [];
  if (archetype === "logo_cta" && !input.brand.logoAssetId) {
    notes.push("Upload a brand logo (Assets → Brand) to replace the wordmark.");
  }
  if (profile.people.length || profile.places.length) {
    notes.push(`Optional: an AI image of ${profile.people[0] ?? `a ${profile.places[0]}`} could support this beat.`);
  }

  return {
    name: sceneName(archetype, voiceText, onScreenText, profile, productName),
    archetype,
    wordStart: plan.wordStart,
    wordEnd: plan.wordEnd,
    start: plan.start,
    end: plan.end,
    voiceText,
    visualConcept: visual.concept(onScreenText, emphasis),
    visualType: visual.visualType,
    animationNotes: visual.animation,
    onScreenText,
    assetsRequired,
    notes: notes.join(" "),
    spec,
  };
}

export function draftStoryboard(input: DraftInput): DraftScene[] {
  const texts = input.plans.map((p) => p.voiceText);
  const story = { items: inferStoryItems(texts), productName: input.brand.brandName ? "" : inferProductName(texts) };
  const out: DraftScene[] = [];
  let previous: SceneArchetype | undefined;
  for (let i = 0; i < input.plans.length; i++) {
    const scene = draftScene(input, i, previous, story);
    previous = scene.archetype;
    out.push(scene);
  }
  return out;
}
