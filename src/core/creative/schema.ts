import { z } from "zod";
import { ColorSchema, MOTION_DENSITIES, MOTION_INTENTS, SHOT_ID_RE, TRANSITIONS, type SpecIssue } from "../spec/scene";

/**
 * The creative layer — structured, inspectable creative decisions between the audio timeline and
 * the Remotion scene specs:
 *
 *   CreativePlan   (project)  direction · story arc · visual language · visual distribution ·
 *                             asset strategy & consistency · reference analyses
 *   SceneCreative  (scene)    purpose · narrative beat · metaphor · treatment · composition ·
 *                             motion hierarchy & density · typography · intensity · shot plan · assets
 *   CreativeReview            a reviewer's written critique: advisory scores backed by issues
 *
 * Claude Code or the user author these documents; this file only validates them. Measured,
 * deterministic signals live in ./metrics.ts and are never presented as creative judgment.
 */

// ---------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------

export const TREATMENTS = [
  "kinetic_typography",
  "product_ui",
  "dashboard_ui",
  "browser_mockup",
  "phone_mockup",
  "desktop_mockup",
  "screenshot",
  "diagram",
  "data_visualization",
  "abstract_graphics",
  "geometric_composition",
  "iconographic_sequence",
  "object_choreography",
  "generated_imagery",
  "generated_video",
  "full_bleed_imagery",
  "split_composition",
  "before_after",
  "transformation",
  "visual_metaphor",
  "brand_moment",
] as const;
export const TreatmentSchema = z.enum(TREATMENTS);
export type Treatment = z.infer<typeof TreatmentSchema>;

/** Treatment families used for the visual distribution balance. */
export const TREATMENT_FAMILIES = ["kineticTypography", "productUI", "abstractGraphics", "imagery", "diagrams", "transformation", "brandMoments"] as const;
export const TreatmentFamilySchema = z.enum(TREATMENT_FAMILIES);
export type TreatmentFamily = z.infer<typeof TreatmentFamilySchema>;

export const NARRATIVE_BEATS = ["hook", "problem", "tension", "turn", "solution", "feature", "benefit", "proof", "resolution", "cta", "brand", "statement"] as const;
export const NarrativeBeatSchema = z.enum(NARRATIVE_BEATS);
export type NarrativeBeat = z.infer<typeof NarrativeBeatSchema>;

export const MotionDensitySchema = z.enum(MOTION_DENSITIES);
export const MotionIntentSchema = z.enum(MOTION_INTENTS);

export const COMPOSITION_LAYOUTS = ["centered", "asymmetric", "split", "thirds", "full_bleed", "layered", "grid", "stack", "radial", "diagonal"] as const;
export const CompositionLayoutSchema = z.enum(COMPOSITION_LAYOUTS);

export const REGIONS = [
  "center",
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center-left",
  "center-right",
  "center-top",
  "center-bottom",
  "full",
  "none",
] as const;
export type Region = (typeof REGIONS)[number];
const REGION_ALIASES: Record<string, Region> = {
  "left-center": "center-left",
  "right-center": "center-right",
  "top-center": "center-top",
  "bottom-center": "center-bottom",
  middle: "center",
  centre: "center",
};
export const RegionSchema = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const key = v.trim().toLowerCase();
  return REGION_ALIASES[key] ?? key;
}, z.enum(REGIONS));

export const VISUAL_WEIGHTS = ["balanced", "centered", "left-heavy", "right-heavy", "top-heavy", "bottom-heavy"] as const;

/** Asset source hierarchy — prefer earlier entries (see grammar.ts ASSET_SOURCE_INFO). */
export const ASSET_SOURCES = ["existing_asset", "screenshot", "remotion_graphic", "component", "ai_image", "ai_video"] as const;
export const AssetSourceSchema = z.enum(ASSET_SOURCES);
export type AssetSource = z.infer<typeof AssetSourceSchema>;

export const REVIEW_CATEGORIES = ["composition", "typography", "motion", "pacing", "storytelling", "consistency", "brand", "quality", "assets"] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];
export const SCORE_KEYS = ["composition", "typography", "motion", "pacing", "storytelling", "consistency", "brand"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
export const ISSUE_SEVERITIES = ["low", "medium", "high"] as const;
export const ISSUE_STATUSES = ["open", "accepted", "dismissed", "resolved"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

const Short = z.string().trim().max(400);
const Long = z.string().trim().max(4000);
const SLUG_RE = /^[A-Za-z0-9_-]{1,40}$/;
/** Same rule as spec/project-files SCENE_KEY_RE (kept local to avoid an import cycle). */
const SCENE_KEY_RE = /^scene_\d{2,3}$/;
const SceneKey = z.string().regex(SCENE_KEY_RE, 'Scene keys look like "scene_01"');
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a 6-digit hex color");
const Intensity = z.number().int().min(1).max(5);

// ---------------------------------------------------------------------------------------
// Project level
// ---------------------------------------------------------------------------------------

export const CreativeDirectionSchema = z.strictObject({
  concept: Short.min(1),
  coreMessage: Short.optional(),
  narrativeStrategy: Long.optional(),
  tone: Short.optional(),
  emotionalDirection: Long.optional(),
  visualStyle: Short.optional(),
  visualLanguage: Long.optional(),
  pacing: Long.optional(),
  motionPhilosophy: Long.optional(),
  compositionPhilosophy: Long.optional(),
  typographyDirection: Long.optional(),
  colorStrategy: Long.optional(),
  imageryDirection: Long.optional(),
  transitionPhilosophy: Long.optional(),
  visualDensity: Short.optional(),
  brandTreatment: Long.optional(),
  avoid: z.array(Short.min(1)).max(40).default([]),
});
export type CreativeDirection = z.infer<typeof CreativeDirectionSchema>;

export const StoryActSchema = z.strictObject({
  id: z.string().regex(SLUG_RE, "Act ids use 1–40 letters, digits, _ or -"),
  name: Short.min(1),
  purpose: Long.optional(),
  beat: NarrativeBeatSchema.optional(),
  emotion: Short.optional(),
  /** Visual vocabulary of the act, e.g. ["fragmentation", "clutter", "tension"]. */
  visualLanguage: z.array(Short.min(1)).max(12).default([]),
  /** Planned visual intensity 1 (quiet) … 5 (peak). */
  intensity: Intensity.optional(),
  scenes: z.array(SceneKey).max(200).default([]),
  notes: Long.optional(),
});
export type StoryAct = z.infer<typeof StoryActSchema>;

export const StoryArcSchema = z.strictObject({
  summary: Long.optional(),
  acts: z.array(StoryActSchema).min(1).max(12),
});
export type StoryArc = z.infer<typeof StoryArcSchema>;

const section = <T extends z.core.$ZodLooseShape>(shape: T) => z.strictObject({ ...shape, notes: Long.optional() }).optional();

export const VisualLanguageSchema = z.strictObject({
  summary: Long.optional(),
  typography: section({
    style: Short.optional(),
    hierarchy: z.enum(["strong", "moderate", "flat"]).optional(),
    case: Short.optional(),
    /** Most words that should be readable on screen at once. */
    maxWordsOnScreen: z.number().int().min(1).max(40).optional(),
  }),
  layout: section({ style: Short.optional(), grid: Short.optional() }),
  composition: section({ style: Short.optional(), negativeSpace: z.enum(["minimal", "moderate", "generous"]).optional(), focalHierarchy: Short.optional() }),
  color: section({
    strategy: Short.optional(),
    dominant: ColorSchema.optional(),
    accent: ColorSchema.optional(),
    neutrals: z.array(ColorSchema).max(8).optional(),
    semantic: Short.optional(),
    gradients: z.enum(["none", "restrained", "expressive"]).optional(),
    glow: z.enum(["none", "restrained", "expressive"]).optional(),
  }),
  imagery: section({ style: Short.optional(), contrast: z.enum(["low", "medium", "high"]).optional(), subjects: Short.optional() }),
  lighting: Short.optional(),
  texture: Short.optional(),
  uiTreatment: Long.optional(),
  shapeLanguage: Short.optional(),
  iconTreatment: Short.optional(),
  motion: section({ style: Short.optional(), energy: z.enum(["calm", "low", "medium", "medium-high", "high"]).optional(), easing: Short.optional() }),
  transitions: section({
    style: Short.optional(),
    frequency: z.enum(["minimal", "restrained", "moderate", "frequent"]).optional(),
    allowed: z.array(z.enum(TRANSITIONS)).max(TRANSITIONS.length).optional(),
  }),
  camera: section({ behavior: z.enum(["static", "restrained", "moderate", "dynamic"]).optional(), allowedOn: Short.optional() }),
  density: z.enum(["sparse", "balanced", "dense"]).optional(),
});
export type VisualLanguage = z.infer<typeof VisualLanguageSchema>;

/** Target share (0–1) of screen time per treatment family — a balancing aid, not a quota. */
export const VisualDistributionSchema = z.partialRecord(TreatmentFamilySchema, z.number().min(0).max(1));
export type VisualDistribution = z.infer<typeof VisualDistributionSchema>;

export const AssetBriefSchema = z.strictObject({
  purpose: Short.min(1),
  narrativeMeaning: Short.optional(),
  subject: Short.min(1),
  composition: Short.optional(),
  focalPoint: RegionSchema.optional(),
  negativeSpace: RegionSchema.optional(),
  palette: z.array(HexColor).max(8).default([]),
  lighting: Short.optional(),
  style: Short.optional(),
  camera: Short.optional(),
  mood: Short.optional(),
  textInImage: z.boolean().default(false),
  avoid: z.array(Short.min(1)).max(30).default([]),
  consistencyNotes: Long.optional(),
});
export type AssetBrief = z.infer<typeof AssetBriefSchema>;

/** Campaign-wide consistency every generated asset inherits. */
export const AssetConsistencySchema = z.strictObject({
  visualStyle: Short.optional(),
  lighting: Short.optional(),
  camera: Short.optional(),
  palette: z.array(HexColor).max(8).default([]),
  contrast: Short.optional(),
  texture: Short.optional(),
  subjectTreatment: Short.optional(),
  environment: Short.optional(),
  composition: Short.optional(),
  avoid: z.array(Short.min(1)).max(30).default([]),
  notes: Long.optional(),
});
export type AssetConsistency = z.infer<typeof AssetConsistencySchema>;

export const AssetStrategySchema = z.strictObject({
  approach: Long.optional(),
  consistency: AssetConsistencySchema.optional(),
});

export const ReferenceAnalysisSchema = z.strictObject({
  id: z.string().regex(SLUG_RE),
  title: Short.min(1),
  assetIds: z.array(z.string().max(80)).max(20).default([]),
  source: Short.optional(),
  typography: Short.optional(),
  composition: Short.optional(),
  motion: Short.optional(),
  color: Short.optional(),
  transitions: Short.optional(),
  imagery: Short.optional(),
  density: Short.optional(),
  overall: Short.optional(),
  /** Principles to carry into original work (never copy the reference itself). */
  principles: z.array(Short.min(1)).max(20).default([]),
});

export const CreativePlanSchema = z.strictObject({
  version: z.literal(1).optional(),
  direction: CreativeDirectionSchema.optional(),
  storyArc: StoryArcSchema.optional(),
  visualLanguage: VisualLanguageSchema.optional(),
  visualDistribution: VisualDistributionSchema.optional(),
  assetStrategy: AssetStrategySchema.optional(),
  references: z.array(ReferenceAnalysisSchema).max(20).optional(),
  notes: Long.optional(),
});
export type CreativePlan = z.infer<typeof CreativePlanSchema>;
export type CreativePlanInput = z.input<typeof CreativePlanSchema>;

export const CREATIVE_PLAN_SECTIONS = ["direction", "storyArc", "visualLanguage", "visualDistribution", "assetStrategy", "references", "notes"] as const;
export type CreativePlanSection = (typeof CREATIVE_PLAN_SECTIONS)[number];

// ---------------------------------------------------------------------------------------
// Scene level
// ---------------------------------------------------------------------------------------

export const ShotPlanSchema = z.strictObject({
  /** Matches the implementation shot id in the scene spec (spec.shots[].id). */
  id: z.string().regex(SHOT_ID_RE),
  purpose: Short.min(1),
  /** Planned seconds from the scene start — the spec's shot triggers are authoritative. */
  from: z.number().min(0).optional(),
  to: z.number().min(0).optional(),
  /** Spoken word the shot lands on. */
  startWord: Short.optional(),
  composition: Short.optional(),
  focalPoint: RegionSchema.optional(),
  treatment: TreatmentSchema.optional(),
  visual: Long.optional(),
  motion: Short.optional(),
  transition: Short.optional(),
  audioSync: Short.optional(),
  assetNeed: Short.optional(),
});
export type ShotPlan = z.infer<typeof ShotPlanSchema>;

export const SceneCompositionSchema = z.strictObject({
  layout: CompositionLayoutSchema.optional(),
  focalPoint: RegionSchema.optional(),
  textArea: RegionSchema.optional(),
  subjectArea: RegionSchema.optional(),
  negativeSpace: RegionSchema.optional(),
  visualWeight: z.enum(VISUAL_WEIGHTS).optional(),
  balance: z.enum(["symmetric", "asymmetric", "radial"]).optional(),
  cameraDirection: Short.optional(),
  notes: Long.optional(),
});
export type SceneComposition = z.infer<typeof SceneCompositionSchema>;

export const SceneMotionPlanSchema = z.strictObject({
  density: MotionDensitySchema.optional(),
  primary: Short.optional(),
  secondary: Short.optional(),
  tertiary: Short.optional(),
  grammar: z.array(MotionIntentSchema).max(10).optional(),
  /** Intentional visual silence: stillness is the design decision. */
  stillness: z.boolean().optional(),
  notes: Long.optional(),
});

export const SceneTypographyPlanSchema = z.strictObject({
  hierarchy: z.enum(["display", "headline", "title", "subtitle", "body", "caption", "none"]).optional(),
  emphasisWords: z.array(Short.min(1)).max(12).default([]),
  maxWords: z.number().int().min(0).max(60).optional(),
  notes: Long.optional(),
});

export const SceneAssetPlanSchema = z.strictObject({
  need: Short.min(1),
  source: AssetSourceSchema,
  assetId: z.string().max(80).optional(),
  requestId: z.string().max(80).optional(),
  rationale: Short.optional(),
  brief: AssetBriefSchema.optional(),
});
export type SceneAssetPlan = z.infer<typeof SceneAssetPlanSchema>;

export const SceneCreativeSchema = z.strictObject({
  version: z.literal(1).optional(),
  purpose: Long.optional(),
  narrativeBeat: NarrativeBeatSchema.optional(),
  /** StoryArc act id. */
  act: z.string().regex(SLUG_RE).optional(),
  emotion: Short.optional(),
  visualMetaphor: Long.optional(),
  /** How the visual relates to the narration. Literal is fine when it is genuinely the strongest choice. */
  interpretation: z.enum(["metaphorical", "transformational", "literal"]).optional(),
  treatment: TreatmentSchema.optional(),
  secondaryTreatments: z.array(TreatmentSchema).max(4).optional(),
  /** Planned visual intensity 1 (quiet) … 5 (peak). */
  intensity: Intensity.optional(),
  composition: SceneCompositionSchema.optional(),
  motion: SceneMotionPlanSchema.optional(),
  typography: SceneTypographyPlanSchema.optional(),
  transition: Short.optional(),
  audioSync: z.array(z.strictObject({ word: Short.min(1), occurrence: z.number().int().positive().optional(), action: Short.min(1) })).max(24).optional(),
  shots: z.array(ShotPlanSchema).max(12).optional(),
  assets: z.array(SceneAssetPlanSchema).max(12).optional(),
  constraints: z.strictObject({ preserveTiming: z.boolean().optional(), preserveVoice: z.boolean().optional(), notes: Long.optional() }).optional(),
  /** Intentional deviations from the project visual language, and why. */
  overrides: Long.optional(),
});
export type SceneCreative = z.infer<typeof SceneCreativeSchema>;

// ---------------------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------------------

export const ReviewIssueSchema = z.strictObject({
  id: z.string().regex(SLUG_RE).optional(),
  scene: SceneKey.optional(),
  shot: z.string().regex(SHOT_ID_RE).optional(),
  severity: z.enum(ISSUE_SEVERITIES),
  category: z.enum(REVIEW_CATEGORIES),
  issue: Long.min(1),
  recommendation: Long.min(1),
  /** What was observed: a frame time, a metric, a comparison. */
  evidence: Long.optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
});
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;

export const CreativeReviewInputSchema = z
  .strictObject({
    title: Short.optional(),
    /** The question the review answers, e.g. "Find the three weakest scenes". */
    request: Long.optional(),
    scope: z.array(SceneKey).max(200).default([]),
    summary: Long.min(20, "A review needs a written critique (summary of at least 20 characters)"),
    overallScore: z.number().int().min(0).max(100).optional(),
    scores: z.partialRecord(z.enum(SCORE_KEYS), z.number().int().min(0).max(100)).default({}),
    strengths: z.array(Long.min(1)).max(20).default([]),
    issues: z.array(ReviewIssueSchema).max(80).default([]),
    weakestScenes: z.array(SceneKey).max(12).default([]),
    /** What the reviewer looked at: a render id and the timestamps (seconds on the master timeline) of the frames inspected. */
    basedOn: z.strictObject({ renderId: z.string().max(80).optional(), frames: z.array(z.number().min(0)).max(200).optional(), notes: Long.optional() }).optional(),
  })
  .superRefine((review, ctx) => {
    const scored = review.overallScore !== undefined || Object.keys(review.scores).length > 0;
    if (scored && review.issues.length + review.strengths.length === 0) {
      ctx.addIssue({ code: "custom", path: ["issues"], message: "Scores are advisory and must be backed by written issues or strengths" });
    }
  });
export type CreativeReviewInput = z.input<typeof CreativeReviewInputSchema>;
export type CreativeReviewData = z.infer<typeof CreativeReviewInputSchema>;

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

type Parsed<T> = { ok: true; value: T } | { ok: false; issues: SpecIssue[] };

function parseWith<T>(schema: z.ZodType<T>, input: unknown): Parsed<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) };
}

export const parseCreativePlan = (input: unknown) => parseWith(CreativePlanSchema, input);
export const parseSceneCreative = (input: unknown) => parseWith(SceneCreativeSchema, input);
export const parseCreativeReview = (input: unknown) => parseWith(CreativeReviewInputSchema, input);

/** Section-wise merge: sections present in the patch replace the base section; `null` removes it. */
export function mergeCreativePlan(base: CreativePlan | null, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Keys of `.project/creative.json` that are metadata rather than part of the plan. */
export const CREATIVE_FILE_META_KEYS = ["$schema", "_readme", "projectId", "revision", "source", "updatedAt"] as const;

export function planPartOfCreativeFile(entry: Record<string, unknown>): Record<string, unknown> {
  const plan: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!(CREATIVE_FILE_META_KEYS as readonly string[]).includes(key)) plan[key] = value;
  }
  return plan;
}

export function isEmptyPlan(plan: CreativePlan | null | undefined): boolean {
  return !plan || CREATIVE_PLAN_SECTIONS.every((k) => plan[k] === undefined || (Array.isArray(plan[k]) && (plan[k] as unknown[]).length === 0));
}
