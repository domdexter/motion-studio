import type { EnterAnimation, MotionDensity, MotionIntent, MotionRole, SceneElement } from "../spec/scene";
import { ENTER_ANIMATIONS } from "../spec/scene";
import type { AssetSource, NarrativeBeat, Treatment, TreatmentFamily } from "./schema";

/**
 * Motion grammar, density, treatment vocabulary and professional principles. Pure data shared by
 * the Remotion engine (density/role scaling, intent entrances), the deterministic metrics, the
 * task briefs Claude reads and the GUI labels.
 */

// ---------------------------------------------------------------------------------------
// Treatments
// ---------------------------------------------------------------------------------------

export const TREATMENT_INFO: Record<Treatment, { label: string; family: TreatmentFamily; description: string }> = {
  kinetic_typography: { label: "Kinetic typography", family: "kineticTypography", description: "The words are the visual — statements, emphasis, rhythm." },
  product_ui: { label: "Product UI", family: "productUI", description: "Real or native UI shown doing something meaningful." },
  dashboard_ui: { label: "Dashboard UI", family: "productUI", description: "Overview surfaces: metrics, lists, status at a glance." },
  browser_mockup: { label: "Browser mockup", family: "productUI", description: "A website or web app framed in a browser." },
  phone_mockup: { label: "Phone mockup", family: "productUI", description: "Mobile experience framed in a device." },
  desktop_mockup: { label: "Desktop mockup", family: "productUI", description: "Laptop or monitor framing." },
  screenshot: { label: "Screenshot", family: "productUI", description: "Captured product screen shown at readable size." },
  diagram: { label: "Diagram", family: "diagrams", description: "Relationships and flows: hubs, steps, cycles." },
  data_visualization: { label: "Data visualization", family: "diagrams", description: "Numbers with movement: charts, counters, progress." },
  abstract_graphics: { label: "Abstract graphics", family: "abstractGraphics", description: "Non-literal forms that carry mood or energy." },
  geometric_composition: { label: "Geometric composition", family: "abstractGraphics", description: "Shapes, lines and grids as structure." },
  iconographic_sequence: { label: "Iconographic sequence", family: "abstractGraphics", description: "Icons or tiles appearing in rhythm." },
  object_choreography: { label: "Object choreography", family: "abstractGraphics", description: "Objects moving together with intent: grouping, orbit, alignment." },
  generated_imagery: { label: "Generated imagery", family: "imagery", description: "AI imagery for people, places, textures code can't draw." },
  generated_video: { label: "Generated video", family: "imagery", description: "AI video for cinematic movement." },
  full_bleed_imagery: { label: "Full-bleed imagery", family: "imagery", description: "An image or video that owns the whole frame." },
  split_composition: { label: "Split composition", family: "transformation", description: "Two halves in dialogue — contrast, comparison." },
  before_after: { label: "Before / after", family: "transformation", description: "The same subject in two states." },
  transformation: { label: "Transformation", family: "transformation", description: "One state visibly becomes another (many → one, chaos → order)." },
  visual_metaphor: { label: "Visual metaphor", family: "transformation", description: "An image that stands for the idea rather than depicting the words." },
  brand_moment: { label: "Brand moment", family: "brandMoments", description: "Logo, name, tagline — the brand owns the frame." },
};

export const FAMILY_INFO: Record<TreatmentFamily, { label: string; color: string }> = {
  kineticTypography: { label: "Kinetic typography", color: "#8B5CF6" },
  productUI: { label: "Product UI", color: "#3B82F6" },
  abstractGraphics: { label: "Abstract graphics", color: "#14B8A6" },
  imagery: { label: "Imagery", color: "#F59E0B" },
  diagrams: { label: "Diagrams & data", color: "#22C55E" },
  transformation: { label: "Transformation", color: "#EC4899" },
  brandMoments: { label: "Brand moments", color: "#F97316" },
};

export const NARRATIVE_BEAT_LABELS: Record<NarrativeBeat, string> = {
  hook: "Hook",
  problem: "Problem",
  tension: "Tension",
  turn: "Turn",
  solution: "Solution",
  feature: "Feature",
  benefit: "Benefit",
  proof: "Proof",
  resolution: "Resolution",
  cta: "Call to action",
  brand: "Brand",
  statement: "Statement",
};

// ---------------------------------------------------------------------------------------
// Motion density & hierarchy
// ---------------------------------------------------------------------------------------

export interface MotionScale {
  /** Multiplies default (not explicit) enter durations. */
  duration: number;
  /** Multiplies travel distances and overshoot. */
  distance: number;
  /** Multiplies emphasis intensity. */
  emphasis: number;
  /** Multiplies idle motion amplitude. */
  idle: number;
}

export const DENSITY_INFO: Record<MotionDensity, { label: string; level: 1 | 2 | 3 | 4 | 5; use: string; scale: MotionScale }> = {
  minimal: { label: "Minimal", level: 1, use: "Premium or emotional moments, visual silence before a peak", scale: { duration: 1.4, distance: 0.5, emphasis: 0.5, idle: 0.3 } },
  low: { label: "Low", level: 2, use: "Complex information the viewer must read", scale: { duration: 1.2, distance: 0.75, emphasis: 0.75, idle: 0.6 } },
  medium: { label: "Medium", level: 3, use: "Explanation and product walkthroughs", scale: { duration: 1, distance: 1, emphasis: 1, idle: 1 } },
  high: { label: "High", level: 4, use: "Hooks, important statements, tension", scale: { duration: 0.9, distance: 1.15, emphasis: 1.15, idle: 1 } },
  peak: { label: "Peak", level: 5, use: "The final reveal or the single biggest moment", scale: { duration: 0.8, distance: 1.3, emphasis: 1.3, idle: 1 } },
};

export const DENSITY_BY_LEVEL: MotionDensity[] = ["minimal", "low", "medium", "high", "peak"];

export const ROLE_SCALE: Record<MotionRole, MotionScale> = {
  primary: { duration: 1, distance: 1, emphasis: 1, idle: 1 },
  secondary: { duration: 1, distance: 0.75, emphasis: 0.7, idle: 0.6 },
  tertiary: { duration: 0.85, distance: 0.45, emphasis: 0.45, idle: 0 },
};

const NEUTRAL: MotionScale = { duration: 1, distance: 1, emphasis: 1, idle: 1 };

export function densityScale(density: MotionDensity | undefined): MotionScale {
  return density ? DENSITY_INFO[density].scale : NEUTRAL;
}

export function roleScale(role: MotionRole | undefined): MotionScale {
  return role ? ROLE_SCALE[role] : NEUTRAL;
}

// ---------------------------------------------------------------------------------------
// Motion grammar — why things move
// ---------------------------------------------------------------------------------------

type EnterType = (typeof ENTER_ANIMATIONS)[number];

/** How much attention an entrance claims. */
export const ENTER_ENERGY: Record<EnterType, "none" | "quiet" | "supportive" | "emphasis" | "attention" | "textual" | "reveal"> = {
  none: "none",
  fade: "quiet",
  blur: "quiet",
  rise: "supportive",
  slideUp: "supportive",
  slideDown: "supportive",
  slideLeft: "supportive",
  slideRight: "supportive",
  scale: "emphasis",
  pop: "attention",
  zoom: "attention",
  flip: "attention",
  wipe: "reveal",
  mask: "reveal",
  draw: "reveal",
  wordReveal: "textual",
  charReveal: "textual",
  typewriter: "textual",
};

export const MOTION_GRAMMAR: Record<MotionIntent, { label: string; meaning: string; motion: string }> = {
  emphasize: { label: "Emphasize", meaning: "Important information", motion: "scale + opacity" },
  support: { label: "Support", meaning: "Supporting information", motion: "subtle fade + short slide" },
  transform: { label: "Transform", meaning: "A system or state changes", motion: "morph / resolve from blur; collapse the old state" },
  sequence: { label: "Sequence", meaning: "Ordered or listed information", motion: "stagger" },
  statement: { label: "Statement", meaning: "A strong claim", motion: "kinetic typography (word reveal)" },
  interact: { label: "Interact", meaning: "UI interaction", motion: "responsive micro-motion: cursor, press, quick fades" },
  progress: { label: "Progress", meaning: "Data progression", motion: "animated values, chart growth" },
  group: { label: "Group", meaning: "Objects that belong together", motion: "coordinated movement in one direction" },
  reveal: { label: "Reveal", meaning: "Brand or answer revealed", motion: "mask / wipe reveal" },
  rest: { label: "Rest", meaning: "Visual silence", motion: "no entrance — already present, still" },
};

/** The grammar's entrance for an element that declares an intent but no explicit `enter`. */
export function grammarEnter(intent: MotionIntent, type: SceneElement["type"]): EnterAnimation | undefined {
  const text = type === "text";
  switch (intent) {
    case "emphasize":
      return { type: "scale" };
    case "support":
      return { type: "rise", distance: 26 };
    case "sequence":
      return { type: "rise", distance: 34, stagger: 0.12 };
    case "statement":
      return text ? { type: "wordReveal", stagger: 0.06 } : type === "kinetic" ? undefined : { type: "scale" };
    case "transform":
      return { type: "blur" };
    case "interact":
      return { type: "fade", duration: 0.3 };
    case "progress":
      return { type: "fade" };
    case "group":
      return { type: "rise", distance: 40 };
    case "reveal":
      return text ? { type: "mask" } : { type: "wipe" };
    case "rest":
      return undefined;
  }
}

// ---------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------

export const ASSET_SOURCE_INFO: Record<AssetSource, { rank: number; label: string; when: string }> = {
  existing_asset: { rank: 1, label: "Existing project asset", when: "Always check the library first" },
  screenshot: { rank: 2, label: "Real screenshot / product capture", when: "Product interfaces and proof" },
  remotion_graphic: { rank: 3, label: "Remotion-generated graphic", when: "Typography, charts, diagrams, UI, shapes" },
  component: { rank: 4, label: "Reusable component", when: "Cards, devices, dashboards, buttons, cursors" },
  ai_image: { rank: 5, label: "AI-generated image", when: "People, places, environments, textures code can't draw" },
  ai_video: { rank: 6, label: "AI-generated video", when: "Cinematic live-action style movement" },
};

// ---------------------------------------------------------------------------------------
// Principles
// ---------------------------------------------------------------------------------------

export const CREATIVE_PRINCIPLES = {
  prioritize: [
    "hierarchy",
    "composition",
    "rhythm and pacing",
    "contrast",
    "whitespace",
    "visual storytelling",
    "meaningful movement",
    "typography",
    "visual consistency",
    "intentional transitions",
    "controlled complexity",
    "brand consistency",
  ],
  avoid: [
    "excessive zooms",
    "random particles",
    "unnecessary camera movement",
    "generic AI imagery",
    "excessive gradients",
    "excessive glow",
    "constant motion",
    "random transitions",
    "too much text",
    "literal visualization of every sentence",
    "visual clutter",
    "repetitive scene structures",
    "every element entering simultaneously",
    "every element having its own animation",
    "template-like layouts",
  ],
  questions: [
    "What is the strongest visual representation of this idea — not which objects the sentence mentions?",
    "What changes on screen, and what does that change mean?",
    "What is the single focal point, and what is allowed to move?",
    "Where does this scene sit on the intensity curve — and what comes before and after it?",
  ],
} as const;
