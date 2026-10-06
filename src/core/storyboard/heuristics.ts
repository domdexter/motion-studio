import type { TimedWord } from "../spec/timing";
import type { Trigger } from "../spec/scene";
import {
  capitalizeFirst,
  escapeRegExp,
  isQuestion,
  isStopWord,
  normalizeWord,
  stripTrailingPunctuation,
  tokenize,
} from "../util/text";

/**
 * Deterministic language heuristics for the rule-based analyzer and storyboard drafter.
 * They are intentionally conservative: they produce a sensible, restrained first draft
 * that Claude Code (or the user) refines.
 */

export const SCENE_ARCHETYPES = [
  "hero_statement",
  "kinetic_voice",
  "question",
  "problem_scatter",
  "solution_collapse",
  "ui_showcase",
  "stat_callout",
  "feature_list",
  "hub_diagram",
  "logo_cta",
  "image_hero",
] as const;
export type SceneArchetype = (typeof SCENE_ARCHETYPES)[number];

const TERMS = {
  problem: [
    "complicated", "complex", "struggl", "juggl", "too many", "hard to", "difficult", "frustrat", "wast",
    "manual", "chaos", "chaotic", "stuck", "pain", "messy", "slow", "costly", "expensive", "confus",
    "scattered", "disconnected", "overwhelm", "switching", "fragmented", "headache", "problem", "tedious",
    "error-prone", "busywork",
  ],
  solution: [
    "that's why", "that is why", "introducing", "meet ", "we built", "we created", "now you can", "finally",
    "one platform", "all-in-one", "all in one", "one place", "single", "unified", "simplif", "effortless",
    "the answer", "the solution",
  ],
  ui: [
    "dashboard", "app", "platform", "software", "interface", "screen", "track", "manage", "monitor", "report",
    "analytics", "workflow", "automat", "integrat", "sync", "crm", "inbox", "invoice", "payments", "portal",
  ],
  proof: ["percent", "customers", "companies", "businesses", "trusted", "rated", "saved", "grew", "growth", "faster", "increase", "results", "revenue", "roi"],
  cta: [
    "get started", "sign up", "signup", "try it", "try ", "visit", "book a", "download", "join", "learn more",
    "start your", "start now", "contact us", "schedule", "free trial", "request a demo", "today",
  ],
  people: [
    "team", "customer", "people", "person", "founder", "employee", "owner", "staff", "client", "doctor",
    "nurse", "student", "manager", "family", "parents", "workers", "designer", "developer",
  ],
  places: ["office", "city", "store", "shop", "warehouse", "kitchen", "restaurant", "factory", "clinic", "hospital", "street", "classroom", "studio"],
  connect: ["connect", "integrat", "together", "everything", "all your", "central", "hub", "in one place", "ecosystem"],
} as const;

export type TermGroup = keyof typeof TERMS;

function findTerms(lower: string, terms: readonly string[]): string[] {
  return terms.filter((t) => new RegExp(`(^|[^\\p{L}])${escapeRegExp(t)}`, "u").test(lower));
}

export interface ExtractedNumber {
  raw: string;
  value: number;
  prefix: string;
  suffix: string;
  decimals: number;
  fromWord: boolean;
}

const SMALL_NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
  twenty: 20, thirty: 30, fifty: 50, hundred: 100, thousand: 1000,
};

export function extractNumbers(text: string): ExtractedNumber[] {
  const out: ExtractedNumber[] = [];
  const re = /([$€£])?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?(%|x\b|k\b|m\b|b\b|\+|\s?percent\b|\s?hours?\b|\s?minutes?\b|\s?days?\b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const whole = m[2].replace(/,/g, "");
    const decimals = m[3] ? m[3].length : 0;
    const value = Number(decimals ? `${whole}.${m[3]}` : whole);
    if (!Number.isFinite(value)) continue;
    let suffix = (m[4] ?? "").trim().toLowerCase();
    if (suffix === "percent") suffix = "%";
    else if (/^(hours?|minutes?|days?)$/.test(suffix)) suffix = ` ${suffix}`;
    else if (suffix === "k" || suffix === "m" || suffix === "b") suffix = suffix.toUpperCase();
    out.push({ raw: m[0].trim(), value, prefix: m[1] ?? "", suffix, decimals, fromWord: false });
  }
  if (out.length === 0) {
    for (const t of tokenize(text)) {
      const v = SMALL_NUMBER_WORDS[t.norm];
      if (v !== undefined) out.push({ raw: t.text, value: v, prefix: "", suffix: "", decimals: 0, fromWord: true });
    }
  }
  return out;
}

/** "email, calendar, invoices, and payroll" → ["email", "calendar", "invoices", "payroll"] */
export function extractListItems(sentence: string): string[] {
  const clean = stripTrailingPunctuation(sentence);
  const m = clean.match(/((?:[^,;:]+,\s*){2,}(?:(?:and|or|&)\s+)?[^,;:]+)/i);
  if (!m) return [];
  const parts = m[1]
    .split(/,\s*/)
    .map((p) => p.replace(/^(?:and|or|&)\s+/i, "").trim())
    .filter(Boolean);
  if (parts.length < 3) return [];
  const wordCounts = parts.map((p) => p.split(/\s+/).length);
  const othersMax = Math.max(...wordCounts.slice(1));
  if (wordCounts[0] > othersMax + 1) {
    parts[0] = parts[0].split(/\s+/).slice(-othersMax).join(" ");
  }
  if (parts.some((p) => p.split(/\s+/).length > 5)) return [];
  return parts.slice(0, 6);
}

export interface KeywordProfile {
  problem: string[];
  solution: string[];
  ui: string[];
  proof: string[];
  cta: string[];
  people: string[];
  places: string[];
  connect: string[];
  numbers: ExtractedNumber[];
  question: boolean;
  listItems: string[];
}

export function profileText(text: string): KeywordProfile {
  const lower = text.toLowerCase().replace(/[’‘]/g, "'");
  return {
    problem: findTerms(lower, TERMS.problem),
    solution: findTerms(lower, TERMS.solution),
    ui: findTerms(lower, TERMS.ui),
    proof: findTerms(lower, TERMS.proof),
    cta: findTerms(lower, TERMS.cta),
    people: findTerms(lower, TERMS.people),
    places: findTerms(lower, TERMS.places),
    connect: findTerms(lower, TERMS.connect),
    numbers: extractNumbers(text),
    question: isQuestion(text),
    listItems: extractListItems(text),
  };
}

const LEADING_TRIM = new Set(["and", "but", "so", "or", "because", "that", "which", "who", "are", "is", "the", "a", "an", "to", "of", "it's", "its", "we", "you", "they"]);
const AUXILIARIES = new Set(["are", "is", "was", "were", "am", "be"]);

/** Short on-screen phrase for a sentence (≤ maxWords), preferring its most meaningful clause. */
export function keyPhrase(sentence: string, maxWords = 6): string {
  const question = isQuestion(sentence);
  const clean = stripTrailingPunctuation(sentence.trim());
  const tokens = tokenize(clean);
  const finish = (s: string) => capitalizeFirst(stripTrailingPunctuation(s.trim())) + (question ? "?" : "");
  if (tokens.length <= maxWords) return finish(clean);

  const clauses = clean
    .split(/[,;:—–]\s*|\s-\s/)
    .map((c) => c.trim())
    .filter((c) => tokenize(c).length >= 2);
  const fitting = clauses.filter((c) => tokenize(c).length <= maxWords && tokenize(c).some((t) => !isStopWord(t.norm)));
  if (fitting.length > 0) return finish(fitting[fitting.length - 1]);

  let tail = tokens.slice(-maxWords);
  // "businesses are juggling five tools" → start at the verb phrase
  const aux = tail.findIndex((t, i) => i <= 2 && AUXILIARIES.has(t.norm));
  if (aux >= 0 && tail.length - (aux + 1) >= 3) tail = tail.slice(aux + 1);
  while (tail.length > 2 && LEADING_TRIM.has(tail[0].norm)) tail = tail.slice(1);
  return finish(tail.map((t) => t.text).join(" "));
}

/** Words worth emphasizing visually, most important first. */
export function emphasisWords(text: string, options: { brandName?: string; max?: number; markdownEmphasis?: string[] } = {}): string[] {
  const max = options.max ?? 3;
  const scores = new Map<string, { display: string; score: number; order: number }>();
  const add = (display: string, score: number, order: number) => {
    const key = normalizeWord(display);
    if (!key || isStopWord(key)) return;
    const cur = scores.get(key);
    if (!cur) scores.set(key, { display, score, order });
    else cur.score += score;
  };
  const tokens = tokenize(text);
  const brandTokens = new Set((options.brandName ?? "").split(/\s+/).map(normalizeWord).filter(Boolean));
  const lower = text.toLowerCase();
  const problemOrSolution = [...findTerms(lower, TERMS.problem), ...findTerms(lower, TERMS.solution)];

  options.markdownEmphasis?.forEach((e, k) => add(e, 10, k));
  tokens.forEach((t, k) => {
    const display = stripTrailingPunctuation(t.text).replace(/^[^\p{L}\p{N}$€£]+/u, "");
    if (!display) return;
    if (brandTokens.has(t.norm)) add(display, 6, k);
    if (/\d/.test(t.norm)) add(display, 5, k);
    const sentenceStart = k === 0 || /[.!?]$/.test(tokens[k - 1].text);
    if (!sentenceStart && /^\p{Lu}/u.test(display) && t.norm.length > 1) add(display, 3, k);
    if (problemOrSolution.some((term) => t.norm.startsWith(term.trim().split(" ")[0]))) add(display, 2.5, k);
    if (t.norm.length >= 8) add(display, 1.5, k);
  });
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, max)
    .map((s) => s.display);
}

/** Pain that is about too many tools/apps (worth visualizing as scattered cards). */
const MULTI_TOOL_PAIN = ["juggl", "switching", "too many", "scattered", "disconnected", "fragmented", "tools", "apps", "tabs", "spreadsheets"];

export function chooseArchetype(
  text: string,
  ctx: { index: number; total: number; hasBrand: boolean; previous?: SceneArchetype; profile?: KeywordProfile },
): SceneArchetype {
  const p = ctx.profile ?? profileText(text);
  const lower = text.toLowerCase().replace(/[’‘]/g, "'");
  const isLast = ctx.index === ctx.total - 1;
  const hasRealNumber = p.numbers.some((n) => !n.fromWord);
  const multiToolPain =
    p.problem.length > 0 && (p.listItems.length >= 3 || p.numbers.some((n) => n.value >= 3 && n.value <= 12) || findTerms(lower, MULTI_TOOL_PAIN).length > 0);

  // Ranked candidates, most specific first.
  const ranked: SceneArchetype[] = [];
  const consider = (archetype: SceneArchetype, when: boolean) => {
    if (when && !ranked.includes(archetype)) ranked.push(archetype);
  };
  consider("logo_cta", isLast && (p.cta.length > 0 || ctx.hasBrand));
  consider("stat_callout", hasRealNumber && (p.proof.length > 0 || p.numbers.some((n) => n.suffix !== "" || n.prefix !== "")));
  consider("question", p.question);
  consider("solution_collapse", p.solution.length > 0 && (ctx.previous === "problem_scatter" || ctx.previous === "feature_list"));
  consider("problem_scatter", multiToolPain);
  consider("feature_list", p.listItems.length >= 3);
  consider("hub_diagram", p.connect.length > 0);
  consider("solution_collapse", p.solution.length > 0);
  consider("ui_showcase", p.ui.length > 0);
  consider("hero_statement", ctx.index === 0 || p.problem.length > 0);
  consider("kinetic_voice", true);
  consider("hero_statement", true);

  // Never repeat the previous scene's archetype: identical consecutive visuals read as a glitch.
  return ranked.find((a) => a !== ctx.previous) ?? ranked[0];
}

const ICON_RULES: [RegExp, string][] = [
  [/e-?mail|inbox|newsletter/, "mail"],
  [/chat|message|slack|conversation/, "message-square"],
  [/calendar|schedul|meeting|booking|appointment/, "calendar"],
  [/spreadsheet|sheet|excel|table|data/, "table"],
  [/invoice|receipt|billing|bill/, "receipt"],
  [/payment|card|checkout|pay/, "credit-card"],
  [/team|people|customer|client|user|staff|employee/, "users"],
  [/analytic|report|insight|metric|chart|kpi/, "chart-column"],
  [/secur|safe|protect|privacy|compliance/, "shield-check"],
  [/fast|speed|instant|quick|automat/, "zap"],
  [/time|hour|minute|deadline/, "clock"],
  [/grow|growth|revenue|sales|increase/, "trending-up"],
  [/money|cost|price|budget|save/, "wallet"],
  [/cloud|online|anywhere/, "cloud"],
  [/\bai\b|smart|intelligen|magic/, "sparkles"],
  [/setting|config|custom/, "settings"],
  [/search|find|discover/, "search"],
  [/document|file|contract|paper/, "file-text"],
  [/mobile|phone|app/, "smartphone"],
  [/task|todo|project|checklist/, "list-checks"],
  [/support|help|service/, "life-buoy"],
  [/notification|alert|remind/, "bell"],
  [/integrat|connect|sync|api/, "plug"],
  [/dashboard|overview|platform/, "layout-dashboard"],
  [/market|campaign|social|post/, "megaphone"],
  [/inventory|stock|product|order|shipping|deliver/, "package"],
  [/hire|recruit|hr|payroll/, "briefcase"],
  [/goal|target|focus/, "target"],
  [/launch|start|begin/, "rocket"],
];

export function iconFor(text: string, fallback = "circle-check"): string {
  const lower = text.toLowerCase();
  for (const [re, icon] of ICON_RULES) if (re.test(lower)) return icon;
  return fallback;
}

/** First candidate word actually spoken in the scene → a word trigger (exact spoken form). */
export function wordTrigger(sceneWords: TimedWord[], candidates: string[], offset?: number): Trigger | undefined {
  for (const c of candidates) {
    for (const piece of c.split(/\s+/)) {
      const n = normalizeWord(piece);
      if (!n || isStopWord(n)) continue;
      const w = sceneWords.find((sw) => normalizeWord(sw.text) === n);
      if (w) {
        const value = stripTrailingPunctuation(w.text).replace(/^[^\p{L}\p{N}$€£]+/u, "");
        return offset ? { type: "word", value, offset } : { type: "word", value };
      }
    }
  }
  return undefined;
}

export function titleCase(s: string): string {
  const small = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by"]);
  return s
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : capitalizeFirst(w)))
    .join(" ");
}
