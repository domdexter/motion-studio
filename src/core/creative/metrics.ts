import { TEXT_ROLE_SIZES, TYPE_SCALE_MULTIPLIER, type DesignSystem } from "../spec/design";
import type { Anchor, Background, MotionDensity, SceneElement, SceneSpec, ShotSpec } from "../spec/scene";
import type { TimedWord } from "../spec/timing";
import { collectSceneEvents, resolveShotWindows, resolveTrigger, wordsInScene, type ShotWindow, type TriggerContext } from "../spec/triggers";
import { isStopWord, normalizeWord, tokenize } from "../util/text";
import { DENSITY_BY_LEVEL, DENSITY_INFO, ENTER_ENERGY, TREATMENT_INFO, grammarEnter } from "./grammar";
import { CREATIVE_PLAN_SECTIONS, TREATMENT_FAMILIES, type CreativePlan, type CreativePlanSection, type Region, type ReviewCategory, type SceneCreative, type Treatment, type TreatmentFamily } from "./schema";

/**
 * Deterministic creative metrics. Everything here is MEASURED from scene specs, timing and assets —
 * treatment detection, layout geometry, motion density, text load, contrast, repetition and the
 * intensity curve. These are signals for a reviewer, not creative judgment: they cannot tell whether
 * a metaphor works. Findings use conservative thresholds and say what was measured.
 */

// ---------------------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------------------

export interface MetricsAsset {
  kind: string;
  source: string;
  width: number | null;
  height: number | null;
  requestId?: string | null;
}

export interface MetricsScene {
  key: string;
  name: string;
  start: number;
  end: number;
  /** Null when the stored spec is invalid. */
  spec: SceneSpec | null;
  creative: SceneCreative | null;
}

export interface MetricsInput {
  width: number;
  height: number;
  design: DesignSystem;
  words: TimedWord[];
  scenes: MetricsScene[];
  plan: CreativePlan | null;
  assets: Record<string, MetricsAsset>;
}

export type FindingSeverity = "info" | "low" | "medium" | "high";

export interface CreativeFinding {
  /** Stable id: `${code}:${scene|project}` (+ `:${detail}` when a scene can have several). */
  id: string;
  code: string;
  severity: FindingSeverity;
  category: ReviewCategory;
  scene?: string;
  shot?: string;
  message: string;
  measured?: string;
  recommendation?: string;
}

export type FamilyShares = Partial<Record<TreatmentFamily, number>>;

export interface SceneMetrics {
  key: string;
  name: string;
  start: number;
  end: number;
  duration: number;
  valid: boolean;
  intent: {
    recorded: boolean;
    purpose?: string;
    beat?: string;
    act?: string;
    treatment?: Treatment;
    interpretation?: string;
    density?: MotionDensity;
    intensity?: number;
    stillness?: boolean;
  };
  detected: { family: TreatmentFamily | null; treatment: Treatment | null; families: FamilyShares; patterns: string[] };
  layout: { signature: string; focal: Region | null; text: Region | null; negativeSpace: number; balance: number; weight: string };
  motion: {
    elements: number;
    animated: number;
    events: number;
    eventsPerSec: number;
    maxBurst: number;
    burstAt: number | null;
    voiceSynced: number;
    continuous: number;
    densityScore: number;
    measuredDensity: MotionDensity;
    longestStill: number;
    cameraMoving: boolean;
    transition: string | null;
    shots: { id: string; start: number; end: number; ok: boolean }[];
  };
  typography: { maxWordsOnScreen: number; textElements: number; minTextSize: number | null; lowContrast: number };
  intensity: { planned: number | null; measured: number };
  findings: CreativeFinding[];
}

export interface CreativeMetrics {
  version: 1;
  durationSec: number;
  scenes: SceneMetrics[];
  coverage: { scenesWithIntent: number; scenes: number; plan: Record<CreativePlanSection, boolean> };
  distribution: { measured: FamilyShares; planned: FamilyShares; target: FamilyShares | null };
  transitions: Record<string, number>;
  intensity: { key: string; start: number; end: number; planned: number | null; measured: number }[];
  findings: CreativeFinding[];
  counts: Record<FindingSeverity, number>;
}

// ---------------------------------------------------------------------------------------
// Geometry & color helpers
// ---------------------------------------------------------------------------------------

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const ANCHOR_OFFSET: Record<Anchor, [number, number]> = {
  center: [-0.5, -0.5],
  "top-left": [0, 0],
  top: [-0.5, 0],
  "top-right": [-1, 0],
  left: [0, -0.5],
  right: [-1, -0.5],
  "bottom-left": [0, -1],
  bottom: [-0.5, -1],
  "bottom-right": [-1, -1],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const intersect = (a: Box, b: Box): number => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

export function regionOf(cx: number, cy: number): Region {
  const col = cx < 0.38 ? "left" : cx > 0.62 ? "right" : "center";
  const row = cy < 0.38 ? "top" : cy > 0.62 ? "bottom" : "center";
  if (col === "center" && row === "center") return "center";
  if (row === "center") return col === "left" ? "center-left" : "center-right";
  if (col === "center") return row === "top" ? "center-top" : "center-bottom";
  return `${row}-${col}` as Region;
}

function regionAxes(region: Region): { col: number; row: number } | null {
  switch (region) {
    case "full":
    case "none":
      return null;
    case "center":
      return { col: 0, row: 0 };
    case "left":
    case "center-left":
      return { col: -1, row: 0 };
    case "right":
    case "center-right":
      return { col: 1, row: 0 };
    case "top":
    case "center-top":
      return { col: 0, row: -1 };
    case "bottom":
    case "center-bottom":
      return { col: 0, row: 1 };
    default: {
      const [row, col] = region.split("-");
      return { col: col === "left" ? -1 : 1, row: row === "top" ? -1 : 1 };
    }
  }
}

function hexRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number | null {
  const ra = hexRgb(a);
  const rb = hexRgb(b);
  if (!ra || !rb) return null;
  const [l1, l2] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function resolveHex(color: string | undefined, design: DesignSystem, fallback: keyof DesignSystem["colors"]): string | null {
  const c = color ?? fallback;
  if (c === "transparent") return null;
  if (c === "white") return "#FFFFFF";
  if (c === "black") return "#000000";
  if (c in design.colors) return design.colors[c as keyof DesignSystem["colors"]];
  return c.startsWith("#") ? c : null;
}

function backgroundBase(bg: Background, design: DesignSystem): string | null {
  switch (bg.type) {
    case "solid":
      return resolveHex(bg.color, design, "background");
    case "gradient":
      return resolveHex(bg.colors?.[0], design, "background");
    case "mesh":
    case "grid":
    case "noise":
    case "particles":
      return resolveHex(bg.base, design, "background");
    default:
      return null; // image / video — unknown luminance
  }
}

// ---------------------------------------------------------------------------------------
// Element classification
// ---------------------------------------------------------------------------------------

const wordCount = (s: string | undefined) => (s ? s.split(/\s+/).filter(Boolean).length : 0);

function textSize(el: Extract<SceneElement, { type: "text" }>, design: DesignSystem): number {
  return el.size ?? TEXT_ROLE_SIZES[el.role ?? "body"] * TYPE_SCALE_MULTIPLIER[design.typography.scale];
}

/** Estimated box (fractions of the frame) — null for elements without a meaningful footprint. */
function estimateBox(el: SceneElement, input: MetricsInput): Box | null {
  const { width: W, height: H, design } = input;
  const unit = Math.min(W, H) / 1080;
  const px = (u: number, axis: "x" | "y") => (u * unit) / (axis === "x" ? W : H);
  let w: number | null = el.width !== undefined ? el.width / 100 : null;
  let h: number | null = el.height !== undefined ? el.height / 100 : null;
  switch (el.type) {
    case "text": {
      const size = textSize(el, design);
      const lineH = size * (el.lineHeight ?? design.typography.lineHeight);
      const maxW = (el.maxWidth ?? 90) / 100;
      const textW = px(el.text.length * size * 0.5, "x");
      const lines = Math.max(1, Math.ceil(textW / maxW) + (el.text.match(/\n/g)?.length ?? 0));
      w ??= Math.min(textW, maxW);
      h ??= px(lines * lineH, "y");
      break;
    }
    case "kinetic": {
      const size = el.size ?? 80;
      w ??= (el.maxWidth ?? 70) / 100;
      h ??= px(size * 2.3, "y");
      break;
    }
    case "badge": {
      const size = el.size ?? 26;
      w ??= px(el.text.length * size * 0.55 + size * 2.4, "x");
      h ??= px(size * 1.9, "y");
      break;
    }
    case "button":
      w ??= px((el.label.length * 16 + 80) * (el.size === "lg" ? 1.3 : el.size === "sm" ? 0.8 : 1), "x");
      h ??= px(el.size === "lg" ? 84 : el.size === "sm" ? 48 : 64, "y");
      break;
    case "logo": {
      const size = el.size ?? 120;
      w ??= px(size * (el.variant === "mark" ? 1 : 3.2), "x");
      h ??= px(size, "y");
      break;
    }
    case "counter": {
      const size = el.size ?? 120;
      w ??= px(size * (String(el.to).length + (el.prefix?.length ?? 0) + (el.suffix?.length ?? 0)) * 0.62, "x");
      h ??= px(size * (el.label ? 1.8 : 1.2), "y");
      break;
    }
    case "card":
      w ??= px(460, "x");
      h ??= px(300, "y");
      break;
    case "cards":
      w ??= 0.8;
      h ??= 0.5;
      break;
    case "notification":
      w ??= 0.3;
      h ??= px(120, "y");
      break;
    case "icon":
      w ??= px(el.size ?? 96, "x");
      h ??= px(el.size ?? 96, "y");
      break;
    case "progress":
      if (el.variant === "ring") {
        w ??= px(el.size ?? 200, "x");
        h ??= px(el.size ?? 200, "y");
      } else {
        w ??= 0.4;
        h ??= px(60, "y");
      }
      break;
    case "chart":
      w ??= 0.5;
      h ??= 0.45;
      break;
    case "diagram":
      w ??= 0.6;
      h ??= 0.6;
      break;
    case "dashboard":
    case "browser":
    case "desktop":
      w ??= 0.6;
      h ??= 0.62;
      break;
    case "phone":
      w ??= 0.22;
      h ??= 0.72;
      break;
    case "list":
      w ??= 0.4;
      h ??= px(el.items.length * (el.size ?? 40) * 1.9, "y");
      break;
    case "circle":
      w ??= px(el.size ?? 200, "x");
      h ??= px(el.size ?? 200, "y");
      break;
    case "rect":
      w ??= 0.2;
      h ??= 0.2;
      break;
    case "image":
    case "video": {
      const asset = input.assets[el.assetId];
      w ??= 0.5;
      if (h === null) h = asset?.width && asset.height ? (w * (asset.height / asset.width) * W) / H : w;
      break;
    }
    default:
      return null; // captions, cursor, line, grid
  }
  const [ax, ay] = ANCHOR_OFFSET[el.anchor ?? "center"];
  const x0 = (el.x ?? 50) / 100 + ax * w;
  const y0 = (el.y ?? 50) / 100 + ay * h;
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/** Detected family/treatment and a weight factor (typography claims more attention per area). */
function classify(el: SceneElement, input: MetricsInput, boxArea: number): { family: TreatmentFamily; treatment: Treatment | null; factor: number } | null {
  if (el.exit?.type === "converge") return { family: "transformation", treatment: "transformation", factor: 1.2 };
  switch (el.type) {
    case "text":
      return { family: "kineticTypography", treatment: "kinetic_typography", factor: ["display", "headline", "title", "quote"].includes(el.role ?? "body") ? 2.2 : 0.6 };
    case "kinetic":
      return { family: "kineticTypography", treatment: "kinetic_typography", factor: 2.5 };
    case "list":
      return el.variant === "icons" ? { family: "abstractGraphics", treatment: "iconographic_sequence", factor: 0.9 } : { family: "kineticTypography", treatment: "kinetic_typography", factor: 0.9 };
    case "badge":
    case "button":
    case "notification":
      return { family: "productUI", treatment: "product_ui", factor: 0.45 };
    case "card":
      return { family: "abstractGraphics", treatment: "iconographic_sequence", factor: 0.8 };
    case "cards":
      return el.collapseAt ? { family: "transformation", treatment: "transformation", factor: 1.2 } : { family: "abstractGraphics", treatment: "iconographic_sequence", factor: 0.9 };
    case "icon":
      return { family: "abstractGraphics", treatment: "iconographic_sequence", factor: 0.8 };
    case "browser":
      return { family: "productUI", treatment: "browser_mockup", factor: 1 };
    case "phone":
      return { family: "productUI", treatment: "phone_mockup", factor: 1 };
    case "desktop":
      return { family: "productUI", treatment: "desktop_mockup", factor: 1 };
    case "dashboard":
      return { family: "productUI", treatment: "dashboard_ui", factor: 1 };
    case "chart":
    case "counter":
    case "progress":
      return { family: "diagrams", treatment: "data_visualization", factor: 1.1 };
    case "diagram":
      return { family: "diagrams", treatment: "diagram", factor: 1.1 };
    case "circle":
    case "rect":
      return { family: "abstractGraphics", treatment: "geometric_composition", factor: 0.35 };
    case "logo":
      return { family: "brandMoments", treatment: "brand_moment", factor: 2 };
    case "image":
    case "video": {
      const asset = input.assets[el.assetId];
      if (asset?.kind === "screenshot") return { family: "productUI", treatment: "screenshot", factor: 1 };
      if (asset?.kind === "logo") return { family: "brandMoments", treatment: "brand_moment", factor: 1.6 };
      const ai = asset?.source === "claude" && (asset.kind === "image" || asset.kind === "video");
      if (ai) return { family: "imagery", treatment: el.type === "video" ? "generated_video" : "generated_imagery", factor: 1 };
      return { family: "imagery", treatment: boxArea >= 0.6 ? "full_bleed_imagery" : null, factor: 1 };
    }
    default:
      return null;
  }
}

function elementWords(el: SceneElement, segmentWords: number): number {
  switch (el.type) {
    case "text":
    case "badge":
      return wordCount(el.text);
    case "button":
      return wordCount(el.label);
    case "notification":
      return wordCount(el.title) + wordCount(el.body);
    case "card":
      return wordCount(el.title) + wordCount(el.body) + wordCount(el.label) + (el.value ? 1 : 0);
    case "cards":
      return el.items.reduce((n, it) => n + wordCount(it.title) + wordCount(it.body) + wordCount(it.label), 0);
    case "list":
      return el.items.reduce((n, it) => n + wordCount(it.text), 0);
    case "kinetic":
      return Math.min(7, (el.source ?? "voice") === "text" ? wordCount(el.text) : segmentWords);
    case "captions":
      return Math.min(el.maxWords ?? 6, segmentWords);
    case "counter":
      return 1 + wordCount(el.label);
    case "logo":
      return el.variant === "mark" ? 0 : wordCount(el.text) || 2;
    case "diagram":
      return (el.center ? wordCount(el.center.label) : 0) + el.nodes.reduce((n, node) => n + wordCount(node.label), 0);
    case "chart":
      return el.showLabels === false ? 0 : el.data.length;
    case "progress":
      return wordCount(el.label);
    default:
      return 0;
  }
}

function colorsUsed(el: SceneElement): string[] {
  const out: string[] = [];
  const add = (c: unknown) => typeof c === "string" && c.startsWith("#") && out.push(c.toUpperCase());
  const rec = el as Record<string, unknown>;
  ["color", "activeColor", "accent"].forEach((k) => add(rec[k]));
  add(el.style?.color);
  add(el.style?.background);
  add(el.style?.borderColor);
  el.emphasis?.forEach((e) => add(e.color));
  if (el.type === "text") add(el.highlight?.color);
  return out;
}

const isAnimated = (el: SceneElement) =>
  (!!el.enter && el.enter.type !== "none") || (!el.enter && !!el.motionIntent && el.motionIntent !== "rest") || !!el.emphasis?.length || (!!el.idle && el.idle !== "none") || (!!el.exit && el.exit.type !== "none");

// ---------------------------------------------------------------------------------------
// Scene analysis
// ---------------------------------------------------------------------------------------

interface Placed {
  el: SceneElement;
  shot: ShotWindow | null;
  index: number;
  box: Box | null;
  from: number;
  to: number;
  words: number;
  cls: ReturnType<typeof classify>;
}

interface Segment {
  id: string | null;
  start: number;
  end: number;
  spec: ShotSpec | null;
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };

function levelFromScore(score: number): number {
  return score < 0.7 ? 1 : score < 1.3 ? 2 : score < 2.1 ? 3 : score < 3 ? 4 : 5;
}

function analyzeScene(scene: MetricsScene, index: number, input: MetricsInput): SceneMetrics {
  const { design, plan } = input;
  const duration = Math.max(0.001, scene.end - scene.start);
  const creative = scene.creative;
  const findings: CreativeFinding[] = [];
  const add = (f: Omit<CreativeFinding, "id" | "scene"> & { detail?: string }) => {
    const { detail, ...rest } = f;
    findings.push({ ...rest, scene: scene.key, id: `${f.code}:${scene.key}${detail ? `:${detail}` : ""}` });
  };
  const act = plan?.storyArc?.acts.find((a) => (creative?.act && a.id === creative.act) || a.scenes.includes(scene.key));
  const plannedIntensity = creative?.intensity ?? (creative?.motion?.density ? DENSITY_INFO[creative.motion.density].level : null) ?? act?.intensity ?? null;
  const intent: SceneMetrics["intent"] = {
    recorded: !!creative && Object.keys(creative).some((k) => k !== "version"),
    purpose: creative?.purpose,
    beat: creative?.narrativeBeat,
    act: creative?.act ?? act?.id,
    treatment: creative?.treatment,
    interpretation: creative?.interpretation,
    density: creative?.motion?.density,
    intensity: plannedIntensity ?? undefined,
    stillness: creative?.motion?.stillness,
  };

  const empty: SceneMetrics = {
    key: scene.key,
    name: scene.name,
    start: scene.start,
    end: scene.end,
    duration,
    valid: false,
    intent,
    detected: { family: null, treatment: null, families: {}, patterns: [] },
    layout: { signature: "invalid", focal: null, text: null, negativeSpace: 1, balance: 0, weight: "balanced" },
    motion: { elements: 0, animated: 0, events: 0, eventsPerSec: 0, maxBurst: 0, burstAt: null, voiceSynced: 0, continuous: 0, densityScore: 0, measuredDensity: "minimal", longestStill: duration, cameraMoving: false, transition: null, shots: [] },
    typography: { maxWordsOnScreen: 0, textElements: 0, minTextSize: null, lowContrast: 0 },
    intensity: { planned: plannedIntensity, measured: 1 },
    findings,
  };
  const spec = scene.spec;
  if (!spec) {
    add({ code: "invalid-spec", severity: "high", category: "quality", message: "The scene spec is invalid, so nothing can be measured or rendered." });
    return empty;
  }

  const baseCtx: TriggerContext = { words: input.words, sceneStart: scene.start, sceneEnd: scene.end };
  const windows = resolveShotWindows(spec, baseCtx);
  const segments: Segment[] = windows.length ? windows.map((w, i) => ({ id: w.id, start: w.start, end: w.end, spec: spec.shots![i] })) : [{ id: null, start: scene.start, end: scene.end, spec: null }];
  const sceneWordsIn = (a: number, b: number) => wordsInScene(input.words, a, b).length;

  // Place every element with its visibility window.
  const placed: Placed[] = [];
  const place = (el: SceneElement, i: number, shot: ShotWindow | null) => {
    const segStart = shot?.start ?? scene.start;
    const segEnd = shot?.end ?? scene.end;
    const ctx: TriggerContext = shot ? { ...baseCtx, shotStart: shot.start, shotEnd: shot.end } : baseCtx;
    const enter = el.enter ?? (el.motionIntent ? grammarEnter(el.motionIntent, el.type) : undefined);
    const from = enter && enter.type !== "none" ? resolveTrigger(enter.at, ctx, "sceneStart").time + (enter.delay ?? 0) : segStart;
    let to = segEnd;
    if (el.exit && el.exit.type !== "none" && el.exit.at) to = resolveTrigger(el.exit.at, ctx, "sceneEnd").time + (el.exit.duration ?? design.motion.transitionDuration);
    const box = estimateBox(el, input);
    const boxArea = box ? intersect(box, { x0: 0, y0: 0, x1: 1, y1: 1 }) : 0;
    placed.push({ el, shot, index: i, box, from: clamp(from, segStart, segEnd), to: clamp(to, segStart, segEnd), words: elementWords(el, sceneWordsIn(segStart, segEnd)), cls: classify(el, input, boxArea) });
  };
  // A group is a layer, not something on screen: its children are what the measurements see.
  const placeAll = (el: SceneElement, i: number, shot: ShotWindow | null) => {
    if (el.type === "group") el.children.forEach((child) => place(child, i, shot));
    else place(el, i, shot);
  };
  spec.elements.forEach((el, i) => placeAll(el, i, null));
  (spec.shots ?? []).forEach((shot, s) => shot.elements.forEach((el, i) => placeAll(el, i, windows[s])));

  // ---- Treatment & layout per segment (at its fullest moment) ----
  const familyScore: Record<string, number> = {};
  const treatmentScore: Record<string, number> = {};
  const patterns = new Set<string>();
  let longest: { seg: Segment; focal: Region | null; text: Region | null; negativeSpace: number; balance: number; family: TreatmentFamily | null } | null = null;
  let dominantSegmentLength = -1;
  for (const seg of segments) {
    const segLen = Math.max(0.001, seg.end - seg.start);
    const members = placed.filter((p) => p.shot === null || p.shot.id === seg.id);
    const times = [...new Set(members.map((p) => clamp(p.from + 0.35, seg.start, seg.end - 0.01)))];
    if (!times.length) times.push(seg.start + segLen / 2);
    let best = { t: times[0], area: -1 };
    for (const t of times) {
      const visibleArea = members.filter((p) => p.box && p.from <= t && p.to > t).reduce((n, p) => n + area(p.box!), 0);
      if (visibleArea > best.area) best = { t, area: visibleArea };
    }
    const visible = members.filter((p) => p.from <= best.t && p.to > best.t);
    const bgs = [spec.background, seg.spec?.background].filter(Boolean) as Background[];
    for (const bg of bgs) {
      if (bg.type === "image" || bg.type === "video") familyScore.imagery = (familyScore.imagery ?? 0) + (0.6 * segLen) / duration;
      if (bg.type === "particles") familyScore.abstractGraphics = (familyScore.abstractGraphics ?? 0) + (0.2 * segLen) / duration;
    }
    // A logo on a brand-color field owns the frame even though the mark itself is small.
    const primaryHex = design.colors.primary.toUpperCase();
    const brandField = bgs.some((bg) => (bg.type === "solid" && (bg.color === "primary" || bg.color?.toUpperCase() === primaryHex)) || (bg.type === "gradient" && (bg.colors ?? []).some((c) => c === "primary" || c.toUpperCase() === primaryHex)));
    if (brandField && visible.some((p) => p.el.type === "logo")) familyScore.brandMoments = (familyScore.brandMoments ?? 0) + (0.5 * segLen) / duration;
    const segFamily: Record<string, number> = {};
    let focalBox: Box | null = null;
    let focalWeight = -1;
    let textBox: Box | null = null;
    let textWeight = -1;
    const massBoxes: Box[] = [];
    for (const p of visible) {
      if (!p.box || !p.cls) continue;
      const clipped = { x0: clamp(p.box.x0, 0, 1), y0: clamp(p.box.y0, 0, 1), x1: clamp(p.box.x1, 0, 1), y1: clamp(p.box.y1, 0, 1) };
      const a = area(clipped);
      if (a <= 0) continue;
      const weight = a * p.cls.factor;
      segFamily[p.cls.family] = (segFamily[p.cls.family] ?? 0) + weight;
      familyScore[p.cls.family] = (familyScore[p.cls.family] ?? 0) + (weight * segLen) / duration;
      if (p.cls.treatment) treatmentScore[p.cls.treatment] = (treatmentScore[p.cls.treatment] ?? 0) + weight * segLen;
      if (a < 0.9) massBoxes.push(clipped);
      if (weight > focalWeight) {
        focalWeight = weight;
        focalBox = clipped;
      }
      if ((p.el.type === "text" || p.el.type === "kinetic") && weight > textWeight) {
        textWeight = weight;
        textBox = clipped;
      }
    }
    const large = massBoxes.filter((b) => area(b) >= 0.12).sort((a, b) => area(b) - area(a));
    if (large.length >= 2 && ((large[0].x1 <= 0.56 && large[1].x0 >= 0.44) || (large[1].x1 <= 0.56 && large[0].x0 >= 0.44))) patterns.add("split");
    // Coverage on a coarse grid → negative space; horizontal mass → balance.
    let covered = 0;
    const cols = 32;
    const rows = 18;
    for (let gx = 0; gx < cols; gx++) {
      for (let gy = 0; gy < rows; gy++) {
        const x = (gx + 0.5) / cols;
        const y = (gy + 0.5) / rows;
        if (massBoxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) covered++;
      }
    }
    const totalMass = massBoxes.reduce((n, b) => n + area(b), 0);
    const balance = totalMass ? massBoxes.reduce((n, b) => n + area(b) * ((b.x0 + b.x1) / 2 - 0.5), 0) / totalMass : 0;
    const segTop = Object.entries(segFamily).sort((a, b) => b[1] - a[1])[0]?.[0] as TreatmentFamily | undefined;
    if (segLen > dominantSegmentLength) {
      dominantSegmentLength = segLen;
      longest = {
        seg,
        focal: focalBox ? regionOf((focalBox.x0 + focalBox.x1) / 2, (focalBox.y0 + focalBox.y1) / 2) : null,
        text: textBox ? regionOf((textBox.x0 + textBox.x1) / 2, (textBox.y0 + textBox.y1) / 2) : null,
        negativeSpace: 1 - covered / (cols * rows),
        balance,
        family: segTop ?? null,
      };
    }

    // Composition checks for this segment.
    const segLabel = seg.id ? { shot: seg.id, detail: seg.id } : {};
    const safeX = ((design.layout.safeMargin / 100) * Math.min(input.width, input.height)) / input.width;
    const safeY = ((design.layout.safeMargin / 100) * Math.min(input.width, input.height)) / input.height;
    const outside = visible.filter((p) => p.box && (p.el.type === "text" || p.el.type === "kinetic" || p.el.type === "badge") && (p.box.x0 < safeX - 0.004 || p.box.x1 > 1 - safeX + 0.004 || p.box.y0 < safeY - 0.004 || p.box.y1 > 1 - safeY + 0.004));
    if (outside.length) {
      add({ code: "text-outside-safe-area", severity: "medium", category: "composition", ...segLabel, message: `Text may sit outside the title-safe area (${outside.map((p) => p.el.id ?? p.el.type).join(", ")}).`, measured: `safe margin ${design.layout.safeMargin}% of the short edge`, recommendation: "Move the text inward or reduce its width." });
    }
    for (const t of visible.filter((p) => p.box && (p.el.type === "text" || p.el.type === "kinetic"))) {
      const coveredBy = visible.find((o) => o !== t && o.box && o.cls && ["productUI", "imagery", "diagrams"].includes(o.cls.family) && ((o.el.z ?? 0) > (t.el.z ?? 0) || ((o.el.z ?? 0) === (t.el.z ?? 0) && o.shot === t.shot && o.index > t.index) || (o.shot && !t.shot && (t.el.z ?? 0) < 0)) && intersect(o.box, t.box!) > 0.3 * area(t.box!));
      if (coveredBy) {
        add({ code: "text-covered", severity: "medium", category: "composition", ...segLabel, detail: `${seg.id ?? "scene"}-${t.el.id ?? t.index}`, message: `“${t.el.id ?? "text"}” is overlapped by “${coveredBy.el.id ?? coveredBy.el.type}”, which draws above it.`, recommendation: "Separate the text and the visual, or raise the text’s z." });
      }
    }
    if (massBoxes.length >= 5 && covered / (cols * rows) > 0.78) {
      add({ code: "cramped", severity: "low", category: "composition", ...segLabel, message: "The frame is crowded: little negative space around the elements.", measured: `${Math.round((covered / (cols * rows)) * 100)}% of the frame covered by ${massBoxes.length} elements`, recommendation: "Remove secondary elements or split the idea across shots." });
    }
  }

  const familyTotal = Object.values(familyScore).reduce((n, v) => n + v, 0) || 1;
  const families: FamilyShares = Object.fromEntries(Object.entries(familyScore).map(([k, v]) => [k, r2(v / familyTotal)]));
  const family = (Object.entries(familyScore).sort((a, b) => b[1] - a[1])[0]?.[0] as TreatmentFamily | undefined) ?? null;
  const treatment = (Object.entries(treatmentScore)
    .filter(([t]) => family && TREATMENT_INFO[t as Treatment].family === family)
    .sort((a, b) => b[1] - a[1])[0]?.[0] as Treatment | undefined) ?? null;
  if ((spec.shots?.length ?? 0) >= 2) patterns.add("shots");
  if (placed.some((p) => p.el.type === "cards" && p.el.collapseAt) || placed.some((p) => p.el.exit?.type === "collapse" || p.el.exit?.type === "converge")) patterns.add("transformation");

  // ---- Motion ----
  const events = collectSceneEvents(spec, baseCtx).filter((e) => e.kind !== "shot" && !(e.elementId === "scene" && e.label.startsWith("transition")));
  const enters = events.filter((e) => e.kind === "enter").map((e) => e.time).sort((a, b) => a - b);
  let maxBurst = 0;
  let burstAt: number | null = null;
  for (let i = 0; i < enters.length; i++) {
    let j = i;
    while (j + 1 < enters.length && enters[j + 1] - enters[i] <= 0.3) j++;
    if (j - i + 1 > maxBurst) {
      maxBurst = j - i + 1;
      burstAt = enters[i];
    }
  }
  const cameraMoving = [spec.camera, ...(spec.shots ?? []).map((s) => s.camera)].some((c) => !!c && c.type !== "static");
  const idle = placed.filter((p) => p.el.idle && p.el.idle !== "none").length;
  const videos = placed.filter((p) => p.el.type === "video").length + [spec.background, ...(spec.shots ?? []).map((s) => s.background)].filter((b) => b?.type === "video").length;
  const kinetic = placed.filter((p) => p.el.type === "kinetic").length;
  const animatedBg = [spec.background, ...(spec.shots ?? []).map((s) => s.background)].filter((b) => b && (b.type === "particles" || (b.type === "gradient" && b.animate) || (b.type === "grid" && b.drift))).length;
  const continuous = (cameraMoving ? 1 : 0) + idle * 0.4 + videos * 0.8 + kinetic * 0.5 + animatedBg * 0.3;
  const eventsPerSec = events.length / duration;
  const shotCuts = Math.max(0, (spec.shots?.length ?? 0) - 1) / duration;
  const specDensity = spec.motion?.density;
  const densityScore = r2((eventsPerSec + shotCuts * 0.8 + Math.max(0, maxBurst - 2) * 0.35 + continuous) * (specDensity ? 0.55 + 0.45 * DENSITY_INFO[specDensity].scale.distance : 1));
  const measuredLevel = levelFromScore(densityScore);
  const measuredDensity = DENSITY_BY_LEVEL[measuredLevel - 1];
  const times = [scene.start, ...events.map((e) => e.time), ...windows.map((w) => w.start), scene.end].sort((a, b) => a - b);
  let longestStill = 0;
  for (let i = 1; i < times.length; i++) longestStill = Math.max(longestStill, times[i] - times[i - 1]);
  const animatedEls = placed.filter((p) => isAnimated(p.el));
  const effectiveTransitionType = index === 0 ? null : (spec.transitionIn ?? design.transition)?.type ?? null;

  if (maxBurst >= 4) {
    add({ code: "simultaneous-entrances", severity: "medium", category: "motion", message: `${maxBurst} elements enter within 0.3 s — nothing leads the eye.`, measured: `burst at ${burstAt?.toFixed(2)}s`, recommendation: "Stagger entrances by importance: primary first, supporting elements after." });
  }
  const roles = animatedEls.filter((p) => p.el.motionRole);
  const attention = animatedEls.filter((p) => {
    const enter = p.el.enter ?? (p.el.motionIntent ? grammarEnter(p.el.motionIntent, p.el.type) : undefined);
    return enter && ["attention", "emphasis"].includes(ENTER_ENERGY[enter.type]);
  });
  if (animatedEls.length >= 5 && roles.length === 0 && attention.length / animatedEls.length >= 0.6) {
    add({ code: "flat-motion-hierarchy", severity: "medium", category: "motion", message: `${animatedEls.length} animated elements, ${attention.length} with attention-grabbing entrances and no motion roles — every element competes.`, recommendation: "Give one element the primary motion; demote the rest to secondary/tertiary (subtle fades)." });
  }
  const primaries = new Map<string, number>();
  for (const p of animatedEls.filter((q) => q.el.motionRole === "primary")) primaries.set(p.shot?.id ?? "scene", (primaries.get(p.shot?.id ?? "scene") ?? 0) + 1);
  for (const [seg, count] of primaries) if (count >= 2) add({ code: "multiple-primary-motions", severity: "low", category: "motion", detail: seg, message: `${count} primary motions in ${seg === "scene" ? "the scene" : `shot ${seg}`}.`, recommendation: "Keep a single primary motion per shot." });
  for (const p of animatedEls) {
    const enter = p.el.enter;
    if (!enter) continue;
    const energy = ENTER_ENERGY[enter.type];
    if (energy === "attention" && (p.el.motionRole === "tertiary" || p.el.motionIntent === "support")) {
      add({ code: "grammar-mismatch", severity: "low", category: "motion", detail: `${p.shot?.id ?? "scene"}-${p.el.id ?? p.index}`, message: `“${p.el.id ?? p.el.type}” is supporting/tertiary but enters with “${enter.type}”, an attention-grabbing move.`, recommendation: "Use fade or a short rise for supporting elements." });
    }
  }
  const emphasisCount = events.filter((e) => e.kind === "emphasis").length;
  if (emphasisCount >= 4) add({ code: "emphasis-heavy", severity: "low", category: "motion", message: `${emphasisCount} emphasis effects in ${duration.toFixed(1)} s.`, recommendation: "Reserve emphasis for the one word that matters." });
  const uiText = family === "productUI" || placed.some((p) => (p.el.type === "image" && input.assets[p.el.assetId]?.kind === "screenshot") || p.el.type === "dashboard");
  if (cameraMoving && uiText) {
    add({ code: "camera-on-ui", severity: "medium", category: "quality", message: "Continuous camera movement on a scene with product UI — fine UI text shimmers when it moves by sub-pixels.", recommendation: "Keep UI scenes static; move the camera only on typography or imagery." });
  }
  const floatingShots = placed.filter((p) => p.el.idle && p.el.idle !== "none" && p.el.type === "image" && input.assets[p.el.assetId]?.kind === "screenshot");
  if (floatingShots.length) add({ code: "idle-on-screenshot", severity: "medium", category: "quality", message: `Idle motion on screenshots (${floatingShots.map((p) => p.el.id ?? "image").join(", ")}) makes small UI text shimmer.`, recommendation: "Remove idle motion from screenshots." });
  if (intent.density) {
    const diff = measuredLevel - DENSITY_INFO[intent.density].level;
    if (Math.abs(diff) >= 2) add({ code: "density-mismatch", severity: "medium", category: "motion", message: `Planned motion density is ${intent.density}, but the scene measures ${measuredDensity}.`, measured: `density score ${densityScore}`, recommendation: diff > 0 ? "Remove or merge events to reach the planned restraint." : "Add purposeful motion (or change the plan)." });
  }
  if (duration > 5.5 && (spec.shots?.length ?? 0) < 2 && measuredLevel <= 2 && !intent.stillness) {
    add({ code: "long-static-scene", severity: "low", category: "pacing", message: `${duration.toFixed(1)} s with little visual progression.`, measured: `longest stretch without a visual event ${longestStill.toFixed(1)} s`, recommendation: "Split the scene into shots that follow the narration, or mark it as intentional stillness." });
  } else if (longestStill > 3 && continuous < 0.5 && !intent.stillness && measuredLevel <= 3) {
    add({ code: "dead-moment", severity: "low", category: "pacing", message: `${longestStill.toFixed(1)} s pass with no visual change.`, recommendation: "Land a small change on a meaningful word, or make the stillness intentional." });
  }
  windows.filter((w) => !w.ok).forEach((w) => add({ code: "shot-timing", severity: "high", category: "pacing", shot: w.id, detail: w.id, message: w.reason ?? `Shot ${w.id} has invalid timing.` }));
  windows.filter((w) => w.ok && w.end - w.start < 0.6).forEach((w) => add({ code: "shot-too-short", severity: "low", category: "pacing", shot: w.id, detail: w.id, message: `Shot “${w.id}” is on screen for ${(w.end - w.start).toFixed(2)} s — too short to read.`, recommendation: "Merge it with a neighbouring shot or move its start trigger." }));
  if (creative?.shots?.length) {
    const specIds = new Set((spec.shots ?? []).map((s) => s.id));
    const missing = creative.shots.filter((s) => !specIds.has(s.id)).map((s) => s.id);
    if (missing.length) add({ code: "shot-plan-unimplemented", severity: "low", category: "storytelling", message: `Planned shots not in the spec: ${missing.join(", ")}.`, recommendation: "Implement the shots in spec.shots (matching ids) or update the shot plan." });
    for (const s of creative.shots) {
      if ((s.from !== undefined && s.from > duration + 0.05) || (s.to !== undefined && s.to > duration + 0.05)) add({ code: "shot-plan-outside-scene", severity: "medium", category: "pacing", detail: s.id, shot: s.id, message: `Planned shot “${s.id}” extends past the scene's audio-locked duration (${duration.toFixed(2)} s).`, recommendation: "Shots must fit inside the scene timing." });
    }
  }
  const failedTriggers = events.filter((e) => !e.ok);
  if (failedTriggers.length) add({ code: "trigger-issues", severity: "medium", category: "pacing", message: `${failedTriggers.length} trigger${failedTriggers.length === 1 ? "" : "s"} can't resolve as written (e.g. ${failedTriggers[0].label}: ${failedTriggers[0].reason}).`, recommendation: "Fix the word/shot triggers so motion lands on the narration." });

  // Motion that starts on screen but can't finish before its shot (or the scene) cuts away.
  const durationScale = specDensity ? DENSITY_INFO[specDensity].scale.duration : 1;
  for (const e of events) {
    if (!e.ok || !e.animation || ["wordReveal", "charReveal", "typewriter"].includes(e.animation)) continue;
    const needs = e.duration ?? (e.kind === "enter" ? design.motion.defaultDuration * durationScale : undefined);
    if (!needs) continue;
    const segEnd = e.shotId ? (windows.find((w) => w.id === e.shotId)?.end ?? scene.end) : scene.end;
    if (e.time >= segEnd - 1e-3 || e.time + needs <= segEnd + 0.05) continue;
    const done = (segEnd - e.time) / needs;
    if (done >= 0.9) continue;
    add({
      code: "motion-cut-off",
      severity: e.kind !== "enter" || done < 0.5 ? "medium" : "low",
      category: "motion",
      shot: e.shotId ?? undefined,
      detail: `${e.elementId}-${e.animation}`,
      message: `“${e.elementId}” ${e.animation} is cut off ${Math.round(done * 100)}% of the way: it needs ${needs.toFixed(2)} s from ${e.time.toFixed(2)}s, but ${e.shotId ? `shot “${e.shotId}”` : "the scene"} ends at ${segEnd.toFixed(2)}s.`,
      recommendation: "Start the motion earlier or shorten it so it finishes on screen — a change the viewer never sees complete doesn't land.",
    });
  }

  // ---- Typography ----
  const texty = placed.filter((p) => p.words > 0);
  const sampleTimes = [...new Set(texty.map((p) => p.from + 0.05))];
  let maxWordsOnScreen = 0;
  for (const t of sampleTimes) {
    const n = texty.filter((p) => p.from <= t && p.to > t).reduce((s, p) => s + p.words, 0);
    maxWordsOnScreen = Math.max(maxWordsOnScreen, n);
  }
  const maxWords = creative?.typography?.maxWords ?? plan?.visualLanguage?.typography?.maxWordsOnScreen ?? 14;
  if (maxWordsOnScreen > maxWords) {
    add({ code: "too-much-text", severity: maxWordsOnScreen > maxWords * 1.6 ? "medium" : "low", category: "typography", message: `Up to ${maxWordsOnScreen} words are readable on screen at once.`, measured: `limit ${maxWords}`, recommendation: "Cut on-screen copy to the key phrase; let the narration carry the rest." });
  }
  const textEls = placed.filter((p) => p.el.type === "text") as (Placed & { el: Extract<SceneElement, { type: "text" }> })[];
  const sizes = textEls.map((p) => textSize(p.el, design));
  const minTextSize = sizes.length ? Math.min(...sizes) : null;
  const tiny = textEls.filter((p) => textSize(p.el, design) < 24);
  if (tiny.length) add({ code: "small-text", severity: "low", category: "typography", message: `Small text (${tiny.map((p) => `${p.el.id ?? "text"} ${Math.round(textSize(p.el, design))}u`).join(", ")}) is hard to read on phones.`, recommendation: "Keep labels at 24u or larger and body copy at 36u or larger (REMOTION.md)." });
  let lowContrast = 0;
  for (const p of placed.filter((q) => (q.el.type === "text" && !q.el.gradient) || q.el.type === "kinetic")) {
    const seg = p.shot ? segments.find((s) => s.id === p.shot!.id) : null;
    const bg = seg?.spec?.background ?? spec.background ?? design.background;
    const base = backgroundBase(bg, design);
    if (!base || !p.box) continue;
    const center = { x: (p.box.x0 + p.box.x1) / 2, y: (p.box.y0 + p.box.y1) / 2 };
    const onSurface = placed.some((o) => o !== p && o.box && o.el.type !== "text" && o.el.type !== "kinetic" && o.el.type !== "badge" && (o.shot === null || o.shot === p.shot) && center.x >= o.box.x0 && center.x <= o.box.x1 && center.y >= o.box.y0 && center.y <= o.box.y1 && area(o.box) > area(p.box!) * 0.8);
    if (onSurface) continue;
    const fg = resolveHex(p.el.type === "text" || p.el.type === "kinetic" ? p.el.color : undefined, design, "text");
    const ratio = fg ? contrastRatio(fg, base) : null;
    const large = p.el.type === "kinetic" || (p.el.type === "text" && textSize(p.el, design) >= 46);
    if (ratio !== null && ratio < (large ? 3 : 4.5)) {
      lowContrast++;
      add({ code: "low-contrast", severity: "medium", category: "typography", detail: `${p.shot?.id ?? "scene"}-${p.el.id ?? p.index}`, message: `“${p.el.id ?? p.el.type}” has low contrast against the background.`, measured: `${ratio.toFixed(2)}:1 (${fg} on ${base})`, recommendation: "Use the text color for copy; keep accent colors for shapes and highlights." });
    }
    if (p.el.type === "kinetic" && p.el.activeColor) {
      const active = resolveHex(p.el.activeColor, design, "primary");
      const r = active ? contrastRatio(active, base) : null;
      if (r !== null && r < 2.2) add({ code: "low-contrast-accent", severity: "low", category: "typography", detail: `${p.el.id ?? p.index}-active`, message: `Highlighted words in “${p.el.id ?? "kinetic"}” nearly disappear against the background.`, measured: `${r.toFixed(2)}:1`, recommendation: "Use a darker highlight color on light backgrounds." });
    }
  }

  // ---- Style / brand / literalness ----
  const glow = placed.filter((p) => p.el.style?.shadow === "glow").length + placed.reduce((n, p) => n + (p.el.emphasis?.filter((e) => e.type === "glow").length ?? 0), 0);
  if (glow && plan?.visualLanguage?.color?.glow === "none") add({ code: "glow-against-language", severity: "medium", category: "consistency", message: `${glow} glow effect${glow === 1 ? "" : "s"}, but the visual language says no glow.`, recommendation: "Remove glow; use contrast and scale for emphasis." });
  const particles = [spec.background, ...(spec.shots ?? []).map((s) => s.background)].some((b) => b?.type === "particles");
  if (particles) add({ code: "particles", severity: plan?.direction?.avoid.some((a) => /particle/i.test(a)) ? "medium" : "low", category: "quality", message: "A particle background — a common generic-AI look.", recommendation: "Prefer a quiet solid/grid background or a meaningful graphic." });
  const palette = new Set([...Object.values(design.colors), ...(design.palette ?? [])].map((c) => c.toUpperCase()));
  const offPalette = [...new Set(placed.flatMap((p) => colorsUsed(p.el)).filter((c) => !palette.has(c)))];
  if (offPalette.length) add({ code: "off-palette", severity: "low", category: "brand", message: `Colors outside the design system: ${offPalette.slice(0, 4).join(", ")}${offPalette.length > 4 ? "…" : ""}.`, recommendation: "Use design tokens (primary, secondary, text…) so the brand stays consistent." });
  const narration = new Set(tokenize(wordsInScene(input.words, scene.start, scene.end).map((w) => w.text).join(" ")).map((t) => t.norm).filter((w) => !isStopWord(w)));
  const itemLabels = placed.flatMap((p) => (p.el.type === "cards" ? p.el.items.map((i) => i.title ?? i.label ?? "") : p.el.type === "list" ? p.el.items.map((i) => i.text) : [])).filter(Boolean);
  if (itemLabels.length >= 3) {
    const echoed = itemLabels.filter((l) => tokenize(l).some((t) => narration.has(t.norm)));
    if (echoed.length / itemLabels.length >= 0.75) add({ code: "possibly-literal", severity: "info", category: "storytelling", message: `On-screen items repeat the nouns the narrator says (${echoed.slice(0, 4).join(", ")}).`, recommendation: "Ask: is showing the named things the strongest visual, or would a transformation or metaphor say more?" });
  }
  for (const p of textEls) {
    const content = tokenize(p.el.text).map((t) => t.norm).filter((w) => !isStopWord(w));
    if (content.length >= 5 && content.filter((w) => narration.has(w)).length / content.length >= 0.9 && !p.el.syncToVoice) {
      add({ code: "text-echoes-narration", severity: "info", category: "typography", detail: `${p.shot?.id ?? "scene"}-${p.el.id ?? p.index}`, message: `“${p.el.id ?? "text"}” repeats the narration almost word for word.`, recommendation: "Show the key phrase only, or make it kinetic typography synced to the voice." });
    }
  }
  const aiImages = placed.filter((p) => (p.el.type === "image" || p.el.type === "video") && input.assets[p.el.assetId]?.source === "claude" && ["image", "video"].includes(input.assets[p.el.assetId]!.kind));
  const nativeTreatments: (Treatment | undefined)[] = ["kinetic_typography", "data_visualization", "diagram", "product_ui", "dashboard_ui"];
  if (aiImages.length && nativeTreatments.includes(creative?.treatment)) add({ code: "ai-imagery-for-native", severity: "low", category: "assets", message: "AI imagery in a scene whose treatment is best built natively (typography, UI, data or diagrams).", recommendation: "Follow the asset hierarchy: existing assets → screenshots → Remotion graphics before AI imagery." });
  if (intent.treatment && family && TREATMENT_INFO[intent.treatment].family !== family && !(spec.shots?.length ?? 0)) {
    add({ code: "treatment-mismatch", severity: "info", category: "consistency", message: `Planned treatment is ${TREATMENT_INFO[intent.treatment].label}, but the frame reads mostly as ${TREATMENT_INFO[treatment ?? intent.treatment].family === family && treatment ? TREATMENT_INFO[treatment].label : family}.`, recommendation: "Check the implementation serves the planned treatment (detection is heuristic)." });
  }
  const layout = longest ?? { focal: null, text: null, negativeSpace: 1, balance: 0 };
  if (creative?.composition?.focalPoint && layout.focal) {
    const a = regionAxes(creative.composition.focalPoint);
    const b = regionAxes(layout.focal);
    if (a && b && (Math.abs(a.col - b.col) >= 1 || Math.abs(a.row - b.row) >= 2)) add({ code: "focal-mismatch", severity: "info", category: "composition", message: `Planned focal point ${creative.composition.focalPoint}; the dominant element sits ${layout.focal}.`, recommendation: "Align the composition with the plan (or update the plan)." });
  }
  if (!intent.recorded) add({ code: "no-creative-intent", severity: "info", category: "storytelling", message: "No creative intent recorded (purpose, beat, treatment, composition, motion).", recommendation: "Record the scene's creative intent so it can be reviewed against the story arc." });

  const weight = Math.abs(layout.balance) < 0.06 ? (layout.focal === "center" ? "centered" : "balanced") : layout.balance < 0 ? "left-heavy" : "right-heavy";
  const signature = `${family ?? "empty"}|${layout.focal ?? "none"}|${layout.text ?? "no-text"}`;

  return {
    ...empty,
    valid: true,
    detected: { family, treatment, families, patterns: [...patterns] },
    layout: { signature, focal: layout.focal, text: layout.text, negativeSpace: r2(layout.negativeSpace), balance: r2(layout.balance), weight },
    motion: {
      elements: placed.length,
      animated: animatedEls.length,
      events: events.length,
      eventsPerSec: r2(eventsPerSec),
      maxBurst,
      burstAt: burstAt === null ? null : r2(burstAt),
      voiceSynced: events.length ? r2(events.filter((e) => e.voiceSynced).length / events.length) : 0,
      continuous: r2(continuous),
      densityScore,
      measuredDensity,
      longestStill: r2(longestStill),
      cameraMoving,
      transition: effectiveTransitionType,
      shots: windows.map((w) => ({ id: w.id, start: r2(w.start - scene.start), end: r2(w.end - scene.start), ok: w.ok })),
    },
    typography: { maxWordsOnScreen, textElements: textEls.length, minTextSize: minTextSize === null ? null : Math.round(minTextSize), lowContrast },
    intensity: { planned: plannedIntensity, measured: measuredLevel },
    findings,
  };
}

// ---------------------------------------------------------------------------------------
// Project analysis
// ---------------------------------------------------------------------------------------

function shares(entries: { family: TreatmentFamily | null; weight: number }[]): FamilyShares {
  const total = entries.reduce((n, e) => n + (e.family ? e.weight : 0), 0);
  if (!total) return {};
  const out: FamilyShares = {};
  for (const e of entries) if (e.family) out[e.family] = r2((out[e.family] ?? 0) + e.weight / total);
  return out;
}

export function analyzeCreative(input: MetricsInput): CreativeMetrics {
  const scenes = input.scenes.map((s, i) => analyzeScene(s, i, input));
  const { plan } = input;
  const findings: CreativeFinding[] = scenes.flatMap((s) => s.findings);
  const add = (f: Omit<CreativeFinding, "id"> & { detail?: string }) => {
    const { detail, ...rest } = f;
    findings.push({ ...rest, id: `${f.code}:${f.scene ?? "project"}${detail ? `:${detail}` : ""}` });
  };
  const durationSec = scenes.length ? Math.max(...scenes.map((s) => s.end)) : 0;
  const valid = scenes.filter((s) => s.valid);

  // Distribution: duration-weighted detected families (per scene family shares).
  const measured: FamilyShares = {};
  const totalDuration = valid.reduce((n, s) => n + s.duration, 0) || 1;
  for (const s of valid) for (const [fam, share] of Object.entries(s.detected.families)) measured[fam as TreatmentFamily] = r2((measured[fam as TreatmentFamily] ?? 0) + ((share ?? 0) * s.duration) / totalDuration);
  const planned = shares(scenes.map((s) => ({ family: s.intent.treatment ? TREATMENT_INFO[s.intent.treatment].family : null, weight: s.duration })));
  const target = plan?.visualDistribution && Object.keys(plan.visualDistribution).length ? plan.visualDistribution : null;
  if (target) {
    const sum = Object.values(target).reduce((n, v) => n + (v ?? 0), 0);
    for (const fam of TREATMENT_FAMILIES) {
      const t = (target[fam] ?? 0) / (sum || 1);
      const m = measured[fam] ?? 0;
      if (Math.abs(t - m) >= 0.15 && (t > 0 || m > 0.2)) add({ code: "distribution-off-target", severity: "low", category: "consistency", detail: fam, message: `${fam}: ${Math.round(m * 100)}% of screen time vs ${Math.round(t * 100)}% planned.`, recommendation: m > t ? "Rebalance: move some beats to other treatments." : "This treatment is under-used compared to the plan." });
    }
  }
  const dominantShare = Math.max(0, ...Object.values(measured).map((v) => v ?? 0));
  if (valid.length >= 6 && dominantShare > 0.6) {
    const fam = Object.entries(measured).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0][0];
    add({ code: "monotone-treatment", severity: "medium", category: "storytelling", message: `${fam} fills ${Math.round(dominantShare * 100)}% of the video.`, recommendation: "Vary visual treatments across the arc — typography, transformation, imagery, brand moments." });
  }

  // Repetition.
  for (let i = 0; i < valid.length; ) {
    let j = i;
    while (j + 1 < valid.length && valid[j + 1].detected.family && valid[j + 1].detected.family === valid[i].detected.family) j++;
    if (j - i + 1 >= 3) {
      const run = valid.slice(i, j + 1);
      const compositions = new Set(run.map((s) => `${s.layout.focal}|${s.layout.text}`)).size;
      const varied = compositions >= Math.ceil(run.length / 2);
      add({
        code: "repetitive-treatment",
        severity: varied ? "low" : "medium",
        category: "storytelling",
        scene: valid[i].key,
        message: `${run.length} scenes in a row read as ${valid[i].detected.family} (${valid[i].key}–${valid[j].key})${varied ? `, with ${compositions} different compositions` : ""}.`,
        recommendation: varied ? "Check that the run reads as progression rather than repetition — a contrasting beat can still help." : "Break the run with a different treatment or a shot that changes the visual idea.",
      });
    }
    i = j + 1;
  }
  for (let i = 0; i < valid.length; ) {
    let j = i;
    while (j + 1 < valid.length && valid[j + 1].layout.signature === valid[i].layout.signature) j++;
    if (j - i + 1 >= 3) add({ code: "repetitive-layout", severity: "medium", category: "composition", scene: valid[i].key, message: `${j - i + 1} consecutive scenes share the same layout (${valid[i].layout.signature.replace(/\|/g, " · ")}).`, recommendation: "Change the composition: move the focal point, use a split, full-bleed or centered statement." });
    i = j + 1;
  }
  const signatures = new Map<string, number>();
  valid.forEach((s) => signatures.set(s.layout.signature, (signatures.get(s.layout.signature) ?? 0) + 1));
  const [topSig, topCount] = [...signatures.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (valid.length >= 6 && topCount / valid.length > 0.45) add({ code: "template-like", severity: "medium", category: "composition", message: `${topCount} of ${valid.length} scenes use the same layout (${topSig.replace(/\|/g, " · ")}).`, recommendation: "Design each beat's composition from its purpose instead of a template." });
  const fams = valid.map((s) => s.detected.family);
  for (let i = 0; i + 4 < fams.length; i++) {
    const [a, b] = [fams[i], fams[i + 1]];
    if (a && b && a !== b && fams[i + 2] === a && fams[i + 3] === b && fams[i + 4] === a) {
      add({ code: "predictable-alternation", severity: "low", category: "storytelling", scene: valid[i].key, message: `Treatments alternate ${a} ↔ ${b} for five scenes (${valid[i].key}–${valid[i + 4].key}).`, recommendation: "Avoid a text → card → text → card rhythm; let the story dictate the next visual." });
      break;
    }
  }

  // Transitions.
  const transitions: Record<string, number> = {};
  for (const s of valid) if (s.motion.transition) transitions[s.motion.transition] = (transitions[s.motion.transition] ?? 0) + 1;
  const decorative = Object.entries(transitions).filter(([t]) => !["cut", "fade", "none"].includes(t)).reduce((n, [, c]) => n + c, 0);
  const transitionCount = Object.values(transitions).reduce((n, c) => n + c, 0);
  const frequency = plan?.visualLanguage?.transitions?.frequency;
  if (Object.keys(transitions).length >= 5) add({ code: "transition-variety", severity: frequency === "minimal" || frequency === "restrained" ? "medium" : "low", category: "motion", message: `${Object.keys(transitions).length} different transition types (${Object.entries(transitions).map(([t, c]) => `${t}×${c}`).join(", ")}).`, recommendation: "Pick one or two transitions with a meaning (cut for rhythm, a shape wipe for the turn) and use them consistently." });
  if ((frequency === "minimal" || frequency === "restrained") && transitionCount >= 4 && decorative / transitionCount > 0.5) add({ code: "decorative-transitions", severity: "medium", category: "motion", message: `${decorative} of ${transitionCount} scene changes use decorative transitions, but the visual language asks for ${frequency} transitions.`, recommendation: "Use cuts and quiet fades; save designed transitions for structural moments." });
  const allowed = plan?.visualLanguage?.transitions?.allowed;
  if (allowed?.length) {
    const offenders = valid.filter((s) => s.motion.transition && !allowed.includes(s.motion.transition as never));
    if (offenders.length) add({ code: "transition-not-allowed", severity: "low", category: "consistency", message: `Transitions outside the visual language in ${offenders.map((s) => `${s.key} (${s.motion.transition})`).join(", ")}.`, recommendation: `Allowed: ${allowed.join(", ")}.` });
  }
  const cameraScenes = valid.filter((s) => s.motion.cameraMoving).length;
  const cameraBehavior = plan?.visualLanguage?.camera?.behavior;
  if (valid.length >= 4 && cameraScenes / valid.length > 0.5) add({ code: "constant-camera", severity: cameraBehavior === "static" || cameraBehavior === "restrained" ? "medium" : "low", category: "motion", message: `The camera moves in ${cameraScenes} of ${valid.length} scenes.`, recommendation: "Keep the camera still by default; move it only when movement means something." });

  // Intensity curve.
  const levels = valid.map((s) => s.intensity.measured);
  if (levels.length >= 6) {
    const mean = levels.reduce((n, v) => n + v, 0) / levels.length;
    const sd = Math.sqrt(levels.reduce((n, v) => n + (v - mean) ** 2, 0) / levels.length);
    if (sd < 0.55) add({ code: "flat-intensity", severity: "medium", category: "pacing", message: "Measured intensity is nearly flat — no peaks and valleys.", measured: `levels ${levels.join(" ")} (σ ${sd.toFixed(2)})`, recommendation: "Plan quiet moments before peaks; reserve the highest density for the hook and the reveal." });
    for (let i = 0; i < valid.length; ) {
      let j = i;
      while (j + 1 < valid.length && valid[j + 1].intensity.measured >= 4 && valid[i].intensity.measured >= 4) j++;
      if (valid[i].intensity.measured >= 4 && j - i + 1 >= 4) add({ code: "sustained-peak", severity: "medium", category: "pacing", scene: valid[i].key, message: `${j - i + 1} consecutive high-intensity scenes (${valid[i].key}–${valid[j].key}).`, recommendation: "Insert a valley: a restrained scene makes the next peak land." });
      i = j + 1;
    }
  }
  for (const s of valid) {
    if (s.intensity.planned !== null && Math.abs(s.intensity.planned - s.intensity.measured) >= 2) {
      add({ code: "intensity-mismatch", severity: "medium", category: "pacing", scene: s.key, message: `Planned intensity ${s.intensity.planned}, measured ${s.intensity.measured}.`, recommendation: s.intensity.measured > s.intensity.planned ? "Calm the scene down to fit its place in the arc." : "The scene is quieter than its role in the arc needs." });
    }
  }

  // Coverage.
  const withIntent = scenes.filter((s) => s.intent.recorded).length;
  const planCoverage = Object.fromEntries(CREATIVE_PLAN_SECTIONS.map((k) => [k, !!plan && plan[k] !== undefined && !(Array.isArray(plan[k]) && (plan[k] as unknown[]).length === 0)])) as Record<CreativePlanSection, boolean>;
  if (!plan?.direction) add({ code: "no-creative-direction", severity: "info", category: "storytelling", message: "No creative direction recorded for the project.", recommendation: "Plan the direction, story arc and visual language before designing scenes." });
  const actScenes = new Set((plan?.storyArc?.acts ?? []).flatMap((a) => a.scenes));
  const keys = new Set(scenes.map((s) => s.key));
  const unknownActScenes = [...actScenes].filter((k) => !keys.has(k));
  if (unknownActScenes.length) add({ code: "arc-unknown-scenes", severity: "low", category: "storytelling", message: `The story arc references scenes that don't exist: ${unknownActScenes.join(", ")}.`, recommendation: "Update the act scene lists after restructuring the storyboard." });

  const sorted = findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const counts: Record<FindingSeverity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  sorted.forEach((f) => counts[f.severity]++);
  return {
    version: 1,
    durationSec,
    scenes,
    coverage: { scenesWithIntent: withIntent, scenes: scenes.length, plan: planCoverage },
    distribution: { measured, planned, target: target ?? null },
    transitions,
    intensity: scenes.map((s) => ({ key: s.key, start: s.start, end: s.end, planned: s.intensity.planned, measured: s.intensity.measured })),
    findings: sorted,
    counts,
  };
}
