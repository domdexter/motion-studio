import type { SceneElement, SceneSpec, Trigger } from "../spec/scene";
import type { TimedWord } from "../spec/timing";
import { capitalizeFirst, normalizeWord, splitSentences, tokenize } from "../util/text";
import { iconFor, keyPhrase, wordTrigger, type KeywordProfile, type SceneArchetype } from "./heuristics";

/**
 * Scene spec templates used by the rule-based storyboard drafter. They double as reference
 * examples for Claude Code (see REMOTION.md). Principles: one idea per scene, generous
 * whitespace, restrained motion, visuals synced to spoken words where it adds meaning, and
 * visual continuity (the same tools/items carry through the story).
 */

export interface TemplateContext {
  width: number;
  height: number;
  portrait: boolean;
  index: number;
  total: number;
  start: number;
  end: number;
  duration: number;
  sceneWords: TimedWord[];
  voiceText: string;
  onScreenText: string;
  emphasis: string[];
  profile: KeywordProfile;
  brandName: string;
  tagline: string;
  website: string;
  hasLogo: boolean;
  /** First list of ≥3 items named anywhere in the script — reused so visuals stay coherent. */
  storyItems: string[];
  /** Product name inferred from the script ("we built Acme Flow") when the brand has none. */
  productName: string;
}

export type TemplateFn = (ctx: TemplateContext) => SceneSpec;

const withOffset = (t: Trigger, offset: number): Trigger => ({ ...t, offset: (t.offset ?? 0) + offset }) as Trigger;

const DEFAULT_TOOLS = [
  { title: "Email", icon: "mail" },
  { title: "Spreadsheets", icon: "table" },
  { title: "Chat", icon: "message-square" },
  { title: "Calendar", icon: "calendar" },
  { title: "Invoices", icon: "receipt" },
  { title: "Tasks", icon: "list-checks" },
  { title: "Payments", icon: "credit-card" },
  { title: "Files", icon: "file-text" },
];

function namedItems(c: TemplateContext): string[] | null {
  if (c.profile.listItems.length >= 3) return c.profile.listItems;
  if (c.storyItems.length >= 3) return c.storyItems;
  return null;
}

function toolItems(c: TemplateContext, fallbackCount = 5) {
  const count = c.profile.numbers.find((x) => x.value >= 3 && x.value <= 8)?.value;
  const named = namedItems(c);
  if (named) return named.slice(0, count ?? 6).map((t) => ({ title: capitalizeFirst(t), icon: iconFor(t, "app-window") }));
  return DEFAULT_TOOLS.slice(0, count ?? fallbackCount);
}

/** Scene-relative seconds when a word is first spoken in this scene. */
function spokenAt(c: TemplateContext, word: string): number | null {
  const n = normalizeWord(word);
  const w = c.sceneWords.find((sw) => normalizeWord(sw.text) === n);
  return w ? Math.max(0, w.start - c.start) : null;
}

const heroStatement: TemplateFn = (c) => {
  const highlightWord = c.emphasis.find((e) => c.onScreenText.toLowerCase().includes(e.toLowerCase()));
  const elements: SceneElement[] = [];
  if (c.index === 0 && c.brandName) {
    elements.push({ id: "eyebrow", type: "badge", text: c.brandName, variant: "glass", x: 50, y: c.portrait ? 37 : 32, enter: { type: "fade", duration: 0.6 } });
  }
  elements.push({
    id: "headline",
    type: "text",
    role: "headline",
    text: c.onScreenText,
    x: 50,
    y: 50,
    align: "center",
    maxWidth: c.portrait ? 86 : 70,
    enter: { type: "wordReveal", stagger: 0.07 },
    ...(highlightWord ? { highlight: { words: [highlightWord], style: "color" as const, color: "primary", at: "spoken" as const } } : {}),
  });
  return { version: 1, camera: { type: "pushIn", amount: 0.035 }, elements };
};

const kineticVoice: TemplateFn = (c) => ({
  version: 1,
  elements: [
    {
      id: "kinetic",
      type: "kinetic",
      source: "voice",
      mode: "phrase",
      x: 50,
      y: 50,
      align: "center",
      maxWidth: c.portrait ? 88 : 78,
      size: c.portrait ? 104 : 112,
      ...(c.emphasis.length ? { emphasisWords: c.emphasis } : {}),
    },
  ],
});

const question: TemplateFn = (c) => ({
  version: 1,
  camera: { type: "pushIn", amount: 0.025 },
  elements: [
    {
      id: "question",
      type: "text",
      role: "display",
      text: c.onScreenText,
      x: 50,
      y: 50,
      align: "center",
      maxWidth: c.portrait ? 86 : 74,
      size: c.portrait ? 116 : 128,
      enter: { type: "wordReveal", stagger: 0.09 },
    },
  ],
});

const problemScatter: TemplateFn = (c) => {
  const pain = wordTrigger(c.sceneWords, [...c.profile.problem, ...c.emphasis]);
  return {
    version: 1,
    elements: [
      {
        id: "tools",
        type: "cards",
        variant: "app",
        layout: "scatter",
        items: toolItems(c),
        x: 50,
        y: c.portrait ? 57 : 58,
        width: c.portrait ? 92 : 84,
        height: c.portrait ? 60 : 62,
        itemWidth: c.portrait ? 200 : 170,
        enter: { type: "pop", stagger: 0.14 },
        idle: "drift",
        ...(pain ? { emphasis: [{ type: "shake" as const, at: pain, intensity: 0.7 }] } : {}),
      },
      {
        id: "headline",
        type: "text",
        role: "title",
        text: c.onScreenText,
        x: 50,
        y: c.portrait ? 16 : 14,
        align: "center",
        maxWidth: c.portrait ? 88 : 76,
        z: 10,
        enter: { type: "rise", delay: 0.1 },
      },
    ],
  };
};

const solutionCollapse: TemplateFn = (c) => {
  const identity = c.brandName || c.productName;
  const key = wordTrigger(c.sceneWords, [...identity.split(/\s+/).filter(Boolean), "platform", "one", "single", "unified", "together", ...c.emphasis]);
  const collapseAt: Trigger = key ?? { type: "sceneTime", seconds: Math.max(0.6, c.duration * 0.35) };
  const revealAt: Trigger = withOffset(collapseAt, 0.25);
  const headlineAt: Trigger = withOffset(collapseAt, 0.45);
  const platform: SceneElement =
    c.hasLogo || identity
      ? {
          id: "platform",
          type: "logo",
          variant: c.hasLogo ? "mark" : "wordmark",
          ...(!c.hasLogo && identity ? { text: identity } : {}),
          x: 50,
          y: 47,
          size: c.portrait ? 190 : 170,
          enter: { type: "pop", at: revealAt },
        }
      : {
          id: "platform",
          type: "card",
          variant: "glass",
          icon: "layout-dashboard",
          title: "One platform",
          x: 50,
          y: 47,
          width: c.portrait ? 62 : 26,
          height: c.portrait ? 16 : 24,
          enter: { type: "pop", at: revealAt },
        };
  return {
    version: 1,
    elements: [
      {
        id: "tools",
        type: "cards",
        variant: "app",
        layout: "orbit",
        items: toolItems(c),
        x: 50,
        y: 47,
        width: c.portrait ? 86 : 58,
        height: c.portrait ? 42 : 60,
        itemWidth: c.portrait ? 150 : 130,
        enter: { type: "fade", duration: 0.35, stagger: 0.05 },
        collapseAt,
      },
      platform,
      { id: "headline", type: "text", role: "title", text: c.onScreenText, x: 50, y: c.portrait ? 78 : 80, align: "center", maxWidth: 80, enter: { type: "rise", at: headlineAt } },
    ],
  };
};

const uiShowcase: TemplateFn = (c) => {
  const click = wordTrigger(c.sceneWords, [...c.profile.ui, ...c.emphasis]);
  const identity = c.brandName || c.productName;
  const url = c.website ? c.website.replace(/^https?:\/\//, "") : identity ? `app.${identity.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com` : "app.example.com";
  const screen = { kind: "dashboard" as const, title: identity || "Overview" };
  if (c.portrait) {
    return {
      version: 1,
      elements: [
        { id: "headline", type: "text", role: "title", text: c.onScreenText, x: 50, y: 16, align: "center", maxWidth: 86, enter: { type: "rise" } },
        { id: "app", type: "phone", screen, x: 50, y: 62, height: 60, enter: { type: "rise", delay: 0.15, duration: 0.8 }, idle: "float" },
        ...(click
          ? [
              {
                id: "cursor",
                type: "cursor" as const,
                variant: "hand" as const,
                path: [
                  { x: 72, y: 88, at: { type: "sceneStart" as const } },
                  { x: 56, y: 60, at: click },
                ],
                clicks: [withOffset(click, 0.1)],
              },
            ]
          : []),
      ],
    };
  }
  return {
    version: 1,
    camera: { type: "drift", amount: 0.02 },
    elements: [
      { id: "headline", type: "text", role: "title", text: c.onScreenText, x: 8, y: 50, anchor: "left", align: "left", maxWidth: 32, enter: { type: "wordReveal", stagger: 0.06 } },
      { id: "app", type: "browser", url, screen, x: 67, y: 52, width: 56, height: 68, enter: { type: "rise", delay: 0.1, duration: 0.8 }, idle: "float" },
      ...(click
        ? [
            {
              id: "cursor",
              type: "cursor" as const,
              variant: "arrow" as const,
              path: [
                { x: 90, y: 90, at: { type: "sceneStart" as const } },
                { x: 62, y: 46, at: click },
              ],
              clicks: [withOffset(click, 0.12)],
            },
          ]
        : []),
    ],
  };
};

const statCallout: TemplateFn = (c) => {
  const num = c.profile.numbers[0];
  const numberWord = num ? wordTrigger(c.sceneWords, [num.raw]) : undefined;
  const labelSource = num ? c.voiceText.replace(num.raw, " ").replace(/\s+/g, " ") : c.voiceText;
  const label = keyPhrase(labelSource, 6);
  const elements: SceneElement[] = [
    {
      id: "stat",
      type: "counter",
      to: num?.value ?? 100,
      ...(num?.prefix ? { prefix: num.prefix } : {}),
      ...(num?.suffix ? { suffix: num.suffix } : {}),
      ...(num?.decimals ? { decimals: num.decimals } : {}),
      size: c.portrait ? 250 : 230,
      x: 50,
      y: 42,
      color: "primary",
      countDuration: 1.2,
      ...(numberWord ? { animateAt: numberWord } : {}),
      enter: numberWord ? { type: "pop", at: withOffset(numberWord, -0.15) } : { type: "pop" },
    },
    {
      id: "label",
      type: "text",
      role: "subtitle",
      text: label,
      x: 50,
      y: c.portrait ? 60 : 64,
      align: "center",
      maxWidth: 70,
      enter: numberWord ? { type: "rise", at: withOffset(numberWord, 0.2) } : { type: "rise", delay: 0.25 },
    },
  ];
  if (num && num.suffix === "%" && num.value <= 100) {
    elements.push({
      id: "bar",
      type: "progress",
      value: num.value,
      variant: "bar",
      x: 50,
      y: c.portrait ? 70 : 76,
      width: c.portrait ? 70 : 36,
      ...(numberWord ? { animateAt: numberWord } : {}),
      enter: { type: "fade", delay: 0.2 },
    });
  }
  return { version: 1, elements };
};

const featureList: TemplateFn = (c) => {
  const listWordCount = c.profile.listItems.join(" ").split(/\s+/).filter(Boolean).length;
  const listOnly = c.profile.listItems.length >= 3 && tokenize(c.voiceText).length <= listWordCount + 3;
  if (listOnly) {
    // The narrator names the items: each card lands exactly as its word is spoken.
    const items = c.profile.listItems.slice(0, 6).map((t) => {
      const at = wordTrigger(c.sceneWords, [t]);
      return { title: capitalizeFirst(t), icon: iconFor(t, "app-window"), ...(at ? { at: withOffset(at, -0.08) } : {}) };
    });
    return {
      version: 1,
      camera: { type: "pushIn", amount: 0.03 },
      elements: [
        {
          id: "items",
          type: "cards",
          variant: "app",
          layout: c.portrait && items.length > 3 ? "grid" : "row",
          items,
          x: 50,
          y: 50,
          itemWidth: c.portrait ? 230 : items.length > 5 ? 170 : 200,
          gap: c.portrait ? 60 : 56,
          enter: { type: "pop", duration: 0.5 },
          idle: "float",
        },
      ],
    };
  }
  const source = c.profile.listItems.length >= 3 ? c.profile.listItems : c.emphasis.length >= 2 ? c.emphasis : [c.onScreenText];
  const items = source.slice(0, 5).map((t) => {
    const at = wordTrigger(c.sceneWords, [t]);
    return { text: capitalizeFirst(t), icon: iconFor(t), ...(at ? { at } : {}) };
  });
  const lead = keyPhrase(c.voiceText.split(/[:,—]/)[0], 5);
  if (c.portrait) {
    return {
      version: 1,
      elements: [
        { id: "title", type: "text", role: "title", text: lead, x: 50, y: 20, align: "center", maxWidth: 86, enter: { type: "rise" } },
        { id: "features", type: "list", variant: "icons", items, x: 50, y: 58, width: 80, size: 50, enter: { type: "rise", stagger: 0.12 } },
      ],
    };
  }
  return {
    version: 1,
    elements: [
      { id: "title", type: "text", role: "title", text: lead, x: 8, y: 50, anchor: "left", align: "left", maxWidth: 36, enter: { type: "wordReveal", stagger: 0.06 } },
      { id: "features", type: "list", variant: "icons", items, x: 56, y: 50, anchor: "left", width: 36, size: 44, enter: { type: "rise", stagger: 0.12 } },
    ],
  };
};

const hubDiagram: TemplateFn = (c) => {
  const labels = (namedItems(c) ?? ["Sales", "Finance", "Operations", "Support", "Marketing"]).slice(0, 6);
  const connect = wordTrigger(c.sceneWords, [...c.profile.connect, ...c.emphasis]);
  const identity = c.brandName || c.productName;
  return {
    version: 1,
    elements: [
      { id: "headline", type: "text", role: "subtitle", text: c.onScreenText, x: 50, y: c.portrait ? 14 : 11, align: "center", maxWidth: 80, enter: { type: "rise" } },
      {
        id: "hub",
        type: "diagram",
        layout: "hub",
        center: { label: identity || "One place", icon: "layout-dashboard" },
        nodes: labels.map((l) => ({ label: capitalizeFirst(l), icon: iconFor(l) })),
        x: 50,
        y: c.portrait ? 56 : 55,
        width: c.portrait ? 90 : 62,
        height: c.portrait ? 52 : 70,
        enter: { type: "fade", stagger: 0.1 },
        ...(connect ? { connectAt: connect } : {}),
      },
    ],
  };
};

const CTA_RE = /\b(get started|sign up|try [a-z]+(?: [a-z]+)?|book a demo|request a demo|start (?:your )?free trial|learn more|visit [\w.]+|download [a-z]+|join [a-z]+)/i;

const logoCta: TemplateFn = (c) => {
  const ctaMatch = c.voiceText.match(CTA_RE);
  const cta = ctaMatch ? capitalizeFirst(ctaMatch[1]) : "Get started";
  const identity = c.brandName || c.productName;
  const hasIdentity = c.hasLogo || !!identity;
  const p = c.portrait;

  // "Teams save 12 hours every week. Get started today." → the stat lands first, then hands off to the CTA.
  const num = c.profile.numbers.find((n) => !n.fromWord);
  const ctaFirstWord = ctaMatch ? ctaMatch[1].split(/\s+/)[0] : null;
  // Exact lookup: CTA verbs like "get" are stop words, which wordTrigger() deliberately skips.
  const ctaSpoken = ctaFirstWord ? c.sceneWords.find((w) => normalizeWord(w.text) === normalizeWord(ctaFirstWord)) : undefined;
  const ctaWord: Trigger | undefined = ctaSpoken ? { type: "word", value: ctaSpoken.text.replace(/[^\p{L}\p{N}'’-]+/gu, "") || ctaFirstWord! } : undefined;
  const ctaRel = ctaFirstWord ? spokenAt(c, ctaFirstWord) : null;
  const numberWord = num ? wordTrigger(c.sceneWords, [num.raw.split(/\s+/)[0]]) : undefined;
  const sequenced = !!(num && numberWord && ctaWord && ctaRel !== null && ctaRel > 1.6);
  const elements: SceneElement[] = [];

  if (sequenced && num && numberWord && ctaWord) {
    const out = { type: "fade" as const, at: withOffset(ctaWord, -0.3), duration: 0.3 };
    const sentence = splitSentences(c.voiceText).find((s) => s.includes(num.raw)) ?? c.voiceText;
    elements.push(
      {
        id: "stat",
        type: "counter",
        to: num.value,
        ...(num.prefix ? { prefix: num.prefix } : {}),
        ...(num.suffix ? { suffix: num.suffix } : {}),
        ...(num.decimals ? { decimals: num.decimals } : {}),
        size: p ? 240 : 220,
        x: 50,
        y: 42,
        color: "primary",
        countDuration: 1.1,
        animateAt: numberWord,
        enter: { type: "pop", at: withOffset(numberWord, -0.15) },
        exit: out,
      },
      {
        id: "stat-label",
        type: "text",
        role: "subtitle",
        text: keyPhrase(sentence.replace(num.raw, " ").replace(/\s+/g, " "), 6),
        x: 50,
        y: p ? 58 : 62,
        align: "center",
        maxWidth: 72,
        enter: { type: "rise", at: withOffset(numberWord, 0.2) },
        exit: out,
      },
    );
  }

  const timing = (offset: number) => (sequenced && ctaWord ? { at: withOffset(ctaWord, offset) } : offset > 0 ? { delay: offset } : {});
  const taglineText = c.tagline || (ctaMatch && c.onScreenText.toLowerCase().includes(ctaMatch[1].toLowerCase()) ? "" : c.onScreenText);
  if (hasIdentity) {
    elements.push({
      id: "logo",
      type: "logo",
      variant: c.hasLogo ? "lockup" : "wordmark",
      ...(!c.hasLogo && identity ? { text: identity } : {}),
      x: 50,
      y: p ? 38 : 36,
      size: p ? 170 : 150,
      enter: { type: "pop", duration: 0.7, ...timing(0) },
    });
    if (taglineText) {
      elements.push({ id: "tagline", type: "text", role: "subtitle", text: taglineText, x: 50, y: p ? 54 : 56, align: "center", maxWidth: 72, enter: { type: "rise", ...timing(0.35) } });
    }
  } else {
    elements.push({ id: "tagline", type: "text", role: "headline", text: c.onScreenText, x: 50, y: 42, align: "center", maxWidth: 76, enter: { type: "wordReveal", stagger: 0.07, ...timing(0) } });
  }
  const pressSec = Math.max(0.8, Math.min(c.duration - 0.35, Math.max((ctaRel ?? 0) + 1.2, c.duration * 0.7)));
  elements.push({
    id: "cta",
    type: "button",
    label: cta,
    variant: "primary",
    size: "lg",
    icon: "arrow-right",
    x: 50,
    y: p ? 67 : 72,
    enter: { type: "pop", ...timing(0.7) },
    pressAt: { type: "sceneTime", seconds: Math.round(pressSec * 100) / 100 },
  });
  if (c.website) {
    elements.push({ id: "url", type: "text", role: "label", text: c.website.replace(/^https?:\/\//, ""), x: 50, y: p ? 76 : 84, color: "muted", enter: { type: "fade", ...timing(1) } });
  }
  return { version: 1, elements };
};

export const TEMPLATES: Record<SceneArchetype, TemplateFn> = {
  hero_statement: heroStatement,
  kinetic_voice: kineticVoice,
  question,
  problem_scatter: problemScatter,
  solution_collapse: solutionCollapse,
  ui_showcase: uiShowcase,
  stat_callout: statCallout,
  feature_list: featureList,
  hub_diagram: hubDiagram,
  logo_cta: logoCta,
  // Until an approved AI image exists the scene stays renderable as a statement.
  image_hero: heroStatement,
};
