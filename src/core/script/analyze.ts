import type { BeatKind, ScriptAnalysis, ScriptBeat } from "../spec/analysis";
import type { VisualType } from "../spec/enums";
import {
  chooseArchetype,
  emphasisWords,
  keyPhrase,
  profileText,
  titleCase,
  type KeywordProfile,
  type SceneArchetype,
} from "../storyboard/heuristics";
import { estimateTiming, parseScript } from "./script";
import { tokenize } from "../util/text";

/**
 * Rule-based script analysis: narrative beats, key statements, emphasis words, visual
 * opportunities and ESTIMATED scene boundaries. Claude Code produces a richer analysis
 * through the analyze_script task; this keeps the pipeline useful offline.
 */

export const ARCHETYPE_VISUALS: Record<
  SceneArchetype,
  { visualType: VisualType; concept: (phrase: string, emphasis: string[]) => string; animation: string[] }
> = {
  hero_statement: {
    visualType: "motion_graphic",
    concept: (p) => `Bold headline on a calm background: “${p}”.`,
    animation: ["headline words reveal in sequence", "gentle camera push-in"],
  },
  kinetic_voice: {
    visualType: "kinetic_type",
    concept: (_p, e) => `The narration becomes kinetic typography${e.length ? `, landing hard on “${e[0]}”` : ""}.`,
    animation: ["words appear exactly as spoken", "emphasis words switch to the primary color"],
  },
  question: {
    visualType: "kinetic_type",
    concept: (p) => `The question fills the frame: “${p}”.`,
    animation: ["words land one at a time", "brief hold before the answer"],
  },
  problem_scatter: {
    visualType: "motion_graphic",
    concept: () => "Tool windows pile up and crowd the frame — the problem made visible.",
    animation: ["app cards pop in one by one", "the cluster shakes on the pain word"],
  },
  solution_collapse: {
    visualType: "motion_graphic",
    concept: () => "Scattered tools collapse into one clean, unified platform.",
    animation: ["cards converge to the center on the key word", "platform mark pops in", "headline rises"],
  },
  ui_showcase: {
    visualType: "ui_demo",
    concept: (p) => `Product UI in a browser frame demonstrates: “${p}”.`,
    animation: ["browser rises into frame", "cursor moves and clicks on the key word"],
  },
  stat_callout: {
    visualType: "data_viz",
    concept: (p) => `A big number counts up — ${p}.`,
    animation: ["counter counts up when the number is spoken", "label fades up beneath"],
  },
  feature_list: {
    visualType: "motion_graphic",
    concept: () => "Key points appear as a clean list as the narrator names each one.",
    animation: ["each item appears on its spoken word", "icons pop in with the items"],
  },
  hub_diagram: {
    visualType: "motion_graphic",
    concept: () => "Everything connects into one central hub.",
    animation: ["nodes appear around the hub", "connections draw into the center"],
  },
  logo_cta: {
    visualType: "logo",
    concept: (p) => `Logo lockup with the call to action: “${p}”.`,
    animation: ["logo pops in", "tagline rises", "CTA button presses"],
  },
  image_hero: {
    visualType: "image",
    concept: (p) => `Full-bleed editorial image with overlaid headline “${p}”.`,
    animation: ["slow Ken Burns drift", "headline reveals over a soft gradient"],
  },
};

function beatKindFor(profile: KeywordProfile, index: number, isLast: boolean): BeatKind {
  if (isLast && profile.cta.length) return "cta";
  if (index === 0 && (profile.question || profile.problem.length)) return "hook";
  if (profile.problem.length) return "problem";
  if (profile.solution.length) return "solution";
  if (profile.numbers.length && profile.proof.length) return "proof";
  if (profile.ui.length || profile.listItems.length) return "feature";
  if (index === 0) return "hook";
  if (isLast) return "cta";
  return "statement";
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function analyzeScriptRules(content: string, options: { brandName?: string; wordsPerMinute?: number } = {}): ScriptAnalysis {
  const parsed = parseScript(content);
  const wpm = options.wordsPerMinute ?? 150;
  const estimate = estimateTiming(parsed.spokenParagraphs, wpm);

  // Chunk paragraphs with many sentences into beats of two sentences.
  const chunks: { paragraph: number; sentences: typeof estimate.sentences }[] = [];
  parsed.spokenParagraphs.forEach((_, paragraph) => {
    const sentences = estimate.sentences.filter((s) => s.paragraph === paragraph);
    if (sentences.length > 3) {
      for (let i = 0; i < sentences.length; i += 2) chunks.push({ paragraph, sentences: sentences.slice(i, i + 2) });
    } else if (sentences.length > 0) {
      chunks.push({ paragraph, sentences });
    }
  });

  const beats: ScriptBeat[] = [];
  let previous: SceneArchetype | undefined;
  chunks.forEach((chunk, index) => {
    const text = chunk.sentences.map((s) => s.text).join(" ");
    const profile = profileText(text);
    const isLast = index === chunks.length - 1;
    const archetype = chooseArchetype(text, { index, total: chunks.length, hasBrand: !!options.brandName, previous, profile });
    previous = archetype;
    const emphasis = emphasisWords(text, { brandName: options.brandName, max: 3, markdownEmphasis: parsed.emphasis.filter((e) => text.includes(e)) });
    const phrase = keyPhrase(chunk.sentences[chunk.sentences.length - 1].text, 6);
    const visual = ARCHETYPE_VISUALS[archetype];
    const keyStatement = [...chunk.sentences].filter((s) => s.words <= 12).sort((a, b) => a.words - b.words)[0]?.text;
    const assetNeeds: ScriptBeat["assetNeeds"] = [];
    if (profile.people.length) assetNeeds.push({ kind: "image", description: `Editorial photo of ${profile.people[0]} in context (optional, supports “${phrase}”)` });
    else if (profile.places.length) assetNeeds.push({ kind: "image", description: `Establishing image of a ${profile.places[0]} (optional)` });

    beats.push({
      id: `beat_${pad2(index + 1)}`,
      title: titleCase(keyPhrase(text, 4).replace(/[?.!]$/, "")),
      kind: beatKindFor(profile, index, isLast),
      text,
      paragraph: chunk.paragraph,
      ...(keyStatement ? { keyStatement } : {}),
      emphasis,
      visualOpportunity: visual.concept(phrase, emphasis),
      suggestedVisualType: visual.visualType,
      suggestedAnimation: visual.animation,
      assetNeeds,
      estimatedStart: chunk.sentences[0].start,
      estimatedEnd: chunk.sentences[chunk.sentences.length - 1].end,
    });
  });

  const sceneBoundaries = estimate.sentences.slice(0, -1).map((s, k) => {
    const next = estimate.sentences[k + 1];
    const tail = tokenize(s.text)
      .slice(-4)
      .map((t) => t.text)
      .join(" ");
    return {
      afterText: tail,
      reason: next.paragraph !== s.paragraph ? "paragraph ends" : "sentence ends",
      estimatedTime: s.end,
    };
  });

  return {
    version: 1,
    source: "rules",
    summary: `${beats.length} beat${beats.length === 1 ? "" : "s"} · ${parsed.wordCount} words · ~${Math.round(estimate.duration)}s estimated at ${wpm} wpm`,
    wordsPerMinute: wpm,
    estimatedDuration: estimate.duration,
    beats,
    emphasisWords: beats.flatMap((b) => b.emphasis.map((word) => ({ word, reason: "rule-based emphasis", beat: b.id }))),
    sceneBoundaries,
  };
}
