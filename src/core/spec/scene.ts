import { z } from "zod";
import { AnnotationSchema, CropSchema, MAX_ANNOTATIONS, MAX_SPEED_SEGMENTS, SpeedSegmentSchema } from "../timeline/clip-edits";
import { MAX_ZOOMS_PER_CLIP, OverlayZoomSchema } from "../timeline/overlay-zoom";
import { KEYFRAME_PROPERTIES, propertySupportIssue, propertyValueIssue, type KeyframeProperty } from "./animatable";

/**
 * SceneSpec — the structured contract between the storyboard (creative intent) and the
 * Remotion engine (final visuals). Claude Code authors these; the engine interprets them.
 *
 * Units
 *   x, y             percent of frame width / height (anchor point, default center 50/50)
 *   width            percent of frame width;  height: percent of frame height
 *   size (text etc.) "u" — pixels at a 1080-px short edge (1u = min(W,H)/1080 px)
 *   times            seconds
 * Colors accept hex/rgb(a)/hsl(a) or design tokens: primary secondary accent background
 * surface text muted success danger white black transparent.
 */

// ---------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------

export const COLOR_TOKENS = [
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
  "text",
  "muted",
  "success",
  "danger",
  "white",
  "black",
  "transparent",
] as const;

export const ColorSchema = z
  .string()
  .regex(
    new RegExp(`^(#[0-9a-fA-F]{3,8}|rgba?\\([^)]+\\)|hsla?\\([^)]+\\)|${COLOR_TOKENS.join("|")})$`),
    "Expected a hex/rgb/hsl color or a design token (primary, secondary, accent, background, surface, text, muted, success, danger, white, black, transparent)",
  );

export const EASINGS = [
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "expoOut",
  "expoInOut",
  "backOut",
  "circOut",
  "spring",
  "snappy",
  "smooth",
] as const;
export const EasingSchema = z.enum(EASINGS);
export type Easing = z.infer<typeof EasingSchema>;

export const AnchorSchema = z.enum(["center", "top-left", "top", "top-right", "left", "right", "bottom-left", "bottom", "bottom-right"]);
/** A point in % of the frame (x, y) — element positions, line ends, motion path points. */
export const PointSchema = z.tuple([z.number(), z.number()]);
export type Point = z.infer<typeof PointSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;

// ---------------------------------------------------------------------------------------
// Triggers — when something happens. Word triggers make visuals sync to the narrator.
// ---------------------------------------------------------------------------------------

const EdgeSchema = z.enum(["start", "end"]);
const ScopeSchema = z.enum(["scene", "global"]);

export const TriggerSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("sceneStart"), offset: z.number().optional() }),
  z.strictObject({ type: z.literal("sceneEnd"), offset: z.number().optional() }),
  /** Absolute seconds on the master timeline. */
  z.strictObject({ type: z.literal("time"), seconds: z.number().nonnegative(), offset: z.number().optional() }),
  /** Seconds relative to the scene start. */
  z.strictObject({ type: z.literal("sceneTime"), seconds: z.number(), offset: z.number().optional() }),
  /** When the narrator says a word (case/punctuation-insensitive). occurrence is 1-based. */
  z.strictObject({
    type: z.literal("word"),
    value: z.string().min(1),
    occurrence: z.number().int().positive().optional(),
    edge: EdgeSchema.optional(),
    offset: z.number().optional(),
    scope: ScopeSchema.optional(),
  }),
  /** Start / end of the shot the element belongs to (outside shots: the scene start / end). */
  z.strictObject({ type: z.literal("shotStart"), offset: z.number().optional() }),
  z.strictObject({ type: z.literal("shotEnd"), offset: z.number().optional() }),
  /** Seconds relative to the start of the element's shot (outside shots: the scene start). */
  z.strictObject({ type: z.literal("shotTime"), seconds: z.number(), offset: z.number().optional() }),
  /** Transcript word index (see timeline.json words[].i). */
  z.strictObject({
    type: z.literal("wordIndex"),
    index: z.number().int().nonnegative(),
    edge: EdgeSchema.optional(),
    offset: z.number().optional(),
  }),
  /** When the narrator says a multi-word phrase. */
  z.strictObject({
    type: z.literal("phrase"),
    value: z.string().min(1),
    occurrence: z.number().int().positive().optional(),
    edge: EdgeSchema.optional(),
    offset: z.number().optional(),
    scope: ScopeSchema.optional(),
  }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

// ---------------------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------------------

export const ENTER_ANIMATIONS = [
  "none",
  "fade",
  "rise",
  "slideUp",
  "slideDown",
  "slideLeft",
  "slideRight",
  "scale",
  "pop",
  "blur",
  "wipe",
  "mask",
  "wordReveal",
  "charReveal",
  "typewriter",
  "draw",
  "flip",
  "zoom",
] as const;
export const EXIT_ANIMATIONS = ["none", "fade", "slideUp", "slideDown", "slideLeft", "slideRight", "scale", "blur", "wipe", "zoom", "collapse", "converge"] as const;

export const EnterAnimationSchema = z.strictObject({
  type: z.enum(ENTER_ANIMATIONS),
  at: TriggerSchema.optional(),
  delay: z.number().min(-5).max(30).optional(),
  duration: z.number().positive().max(10).optional(),
  easing: EasingSchema.optional(),
  /** Seconds between parts (words, characters, list items, cards). */
  stagger: z.number().min(0).max(2).optional(),
  /** Travel distance in u for slide/rise animations. */
  distance: z.number().min(0).max(2000).optional(),
});
export type EnterAnimation = z.infer<typeof EnterAnimationSchema>;

export const ExitAnimationSchema = z.strictObject({
  type: z.enum(EXIT_ANIMATIONS),
  /** Defaults to (sceneEnd − duration). Scenes usually rely on the next scene's transition instead. */
  at: TriggerSchema.optional(),
  duration: z.number().positive().max(10).optional(),
  easing: EasingSchema.optional(),
  distance: z.number().min(0).max(2000).optional(),
  /**
   * `converge`: the point (x, y in % of the frame) the element's anchor travels to while it shrinks,
   * straightens and fades — separate elements become one point. Defaults to the frame center.
   */
  to: z.tuple([z.number().min(-100).max(200), z.number().min(-100).max(200)]).optional(),
});
export type ExitAnimation = z.infer<typeof ExitAnimationSchema>;

export const EmphasisSchema = z.strictObject({
  type: z.enum(["pulse", "pop", "shake", "glow", "highlight", "underline", "colorShift", "bounce"]),
  at: TriggerSchema,
  duration: z.number().positive().max(5).optional(),
  color: ColorSchema.optional(),
  intensity: z.number().min(0).max(3).optional(),
});
export type Emphasis = z.infer<typeof EmphasisSchema>;

export const IdleSchema = z.enum(["none", "float", "breathe", "drift", "spin", "pulse"]);

// ---------------------------------------------------------------------------------------
// Keyframes — explicit property values over time
// ---------------------------------------------------------------------------------------

/**
 * Keyframes set the value of a property at moments after the element appears; entrance, exit, emphasis
 * and idle motion still play on top of that value. What can be animated, with what values, on which
 * element types, is the animatable property registry (./animatable.ts) — the schema validates against it.
 */
/** How a value travels to the next keyframe: an easing curve, or `hold` (it stays, then jumps). */
export const KEYFRAME_EASINGS = [...EASINGS, "hold"] as const;
export type KeyframeEasing = (typeof KEYFRAME_EASINGS)[number];
/**
 * A custom curve: the two control points of a cubic Bézier on the 0..1 timeline, like CSS
 * `cubic-bezier(x1, y1, x2, y2)`. x stays inside 0..1 (time can't run backwards); y may overshoot.
 */
export const CustomEasingSchema = z.strictObject({
  bezier: z.tuple([z.number().min(0).max(1), z.number().min(-10).max(10), z.number().min(0).max(1), z.number().min(-10).max(10)]),
});
export type CustomEasing = z.infer<typeof CustomEasingSchema>;
/** A named curve or a custom one. Older specs only ever hold a name, so they keep loading unchanged. */
export const KeyframeEasingSchema = z.union([z.enum(KEYFRAME_EASINGS), CustomEasingSchema]);
export type KeyframeEasingValue = z.infer<typeof KeyframeEasingSchema>;
export const KEYFRAME_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_KEYFRAMES = 240;
/** Two keyframes of a property closer than this are the same moment. */
export const KEYFRAME_TIME_EPS = 0.0005;

/**
 * What a keyframe may hold — the value types the registry knows: a number, a color (literal, not a
 * design token) or a point in % of the frame. The registry says which one a property takes.
 */
export const KeyframeValueSchema = z.union([z.number().min(-10000).max(10000), ColorSchema, PointSchema]);
export type KeyframeValue = z.infer<typeof KeyframeValueSchema>;

export const KeyframeSchema = z.strictObject({
  /** Stable id (selection, undo, copies). Unique within its element. */
  id: z.string().regex(KEYFRAME_ID_RE, "Keyframe ids use 1–40 letters, digits, _ or -"),
  property: z.enum(KEYFRAME_PROPERTIES),
  /** Seconds after the element appears (its entrance cue plus delay, else the start of its scene or shot). */
  time: z.number().min(0).max(3600),
  value: KeyframeValueSchema,
  /** How the value travels from this keyframe to the next one of the same property (default linear). */
  easing: KeyframeEasingSchema.optional(),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

/**
 * A curve an element travels along instead of sitting at x/y: `pathProgress` (0 → 1, usually keyframed)
 * picks the point. Points are % of the frame, like x/y, and the curve is measured by length, so an even
 * progress moves at an even speed. `orient` turns the element along the curve's direction — that angle
 * is added to its own rotation, so rotation keyframes still work as an offset.
 */
export const MOTION_PATH_TYPES = ["linear", "quadratic", "cubic"] as const;
export const MotionPathSchema = z.strictObject({
  type: z.enum(MOTION_PATH_TYPES),
  from: PointSchema,
  to: PointSchema,
  /** Control points: `quadratic` uses c1, `cubic` uses both. */
  c1: PointSchema.optional(),
  c2: PointSchema.optional(),
  orient: z.boolean().optional(),
});
export type MotionPath = z.infer<typeof MotionPathSchema>;
export type MotionPathType = (typeof MOTION_PATH_TYPES)[number];

/** Motion hierarchy: how much attention an element's motion may claim (primary > secondary > tertiary). */
export const MOTION_ROLES = ["primary", "secondary", "tertiary"] as const;
/**
 * Motion grammar: WHY an element moves. An element with an intent and no explicit `enter` gets the
 * grammar's entrance (src/core/creative/grammar.ts), so motion follows meaning instead of taste.
 */
export const MOTION_INTENTS = ["emphasize", "support", "transform", "sequence", "statement", "interact", "progress", "group", "reveal", "rest"] as const;
/** Scene motion density. Scales default durations, travel, emphasis and idle motion to create peaks and valleys. */
export const MOTION_DENSITIES = ["minimal", "low", "medium", "high", "peak"] as const;

export const StyleSchema = z.strictObject({
  color: ColorSchema.optional(),
  background: ColorSchema.optional(),
  borderColor: ColorSchema.optional(),
  borderWidth: z.number().min(0).max(40).optional(),
  radius: z.number().min(0).max(2000).optional(),
  shadow: z.enum(["none", "soft", "medium", "deep", "glow"]).optional(),
  blur: z.number().min(0).max(200).optional(),
  padding: z.number().min(0).max(400).optional(),
  glass: z.boolean().optional(),
});

// ---------------------------------------------------------------------------------------
// Compositing — how an element is drawn onto what is already there
// ---------------------------------------------------------------------------------------

/**
 * How an element's pixels mix with the layer below (CSS `mix-blend-mode`). Only the modes Chrome —
 * the browser both the editor preview and Remotion's renderer draw in — composites identically are
 * listed, so what you see in the canvas is what the export contains.
 */
export const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "colorDodge", "softLight", "difference"] as const;
export const BlendSchema = z.enum(BLEND_MODES);
export type BlendMode = (typeof BLEND_MODES)[number];

/**
 * Structured effects applied to the element as a whole (never raw CSS). Each key is a plain number or
 * colour, so any of them can be keyframed through the ordinary animatable property registry — the
 * renderer composes them into one filter in a fixed order (see `effectFilter` in engine/compositing.ts).
 * Lengths are design units (u), the same unit sizes and radii use.
 */
export const EffectsSchema = z.strictObject({
  /** Gaussian blur of the element itself (the glass blur in `style.blur` blurs what is *behind* it). */
  blur: z.number().min(0).max(100).optional(),
  /** Glow radius around the element's shape. */
  glow: z.number().min(0).max(100).optional(),
  glowColor: ColorSchema.optional(),
  /** Drop shadow of the element's shape (`style.shadow` is the surface elevation preset instead). */
  shadowBlur: z.number().min(0).max(100).optional(),
  shadowX: z.number().min(-100).max(100).optional(),
  shadowY: z.number().min(-100).max(100).optional(),
  shadowColor: ColorSchema.optional(),
  /** 1 leaves the element alone. */
  brightness: z.number().min(0).max(4).optional(),
  contrast: z.number().min(0).max(4).optional(),
  saturate: z.number().min(0).max(4).optional(),
});
export type Effects = z.infer<typeof EffectsSchema>;

export const CLIP_SHAPES = ["rect", "circle", "ellipse"] as const;
export const CLIP_REVEALS = ["none", "left", "right", "up", "down"] as const;
/**
 * A shape the element is seen through, in % of the element's own box — a clip, not a second element.
 * `progress` (0–1, keyframeable) with a `reveal` direction wipes the clip open, which is how a clipped
 * reveal is animated. It renders as a `clip-path`, identical in the preview and in the export.
 */
export const ClipSchema = z.strictObject({
  type: z.enum(CLIP_SHAPES),
  /** Inset from each edge in % of the element's box: top, right, bottom, left. */
  inset: z.tuple([z.number().min(-100).max(100), z.number().min(-100).max(100), z.number().min(-100).max(100), z.number().min(-100).max(100)]).optional(),
  /** Corner radius in % of the shorter side (rect only). */
  radius: z.number().min(0).max(50).optional(),
  /** How far the mask is open (1 = fully). Needs a `reveal` direction to mean anything. */
  progress: z.number().min(0).max(1).optional(),
  reveal: z.enum(CLIP_REVEALS).optional(),
});
export type Clip = z.infer<typeof ClipSchema>;
export type ClipShape = (typeof CLIP_SHAPES)[number];

// ---------------------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------------------

const BASE = {
  id: z.string().min(1).max(64).optional(),
  x: z.number().min(-100).max(200).optional(),
  y: z.number().min(-100).max(200).optional(),
  width: z.number().positive().max(400).optional(),
  height: z.number().positive().max(400).optional(),
  anchor: AnchorSchema.optional(),
  rotation: z.number().min(-3600).max(3600).optional(),
  scale: z.number().positive().max(20).optional(),
  /** Extra scale on one axis only (1 = none). Multiplies `scale`, so a squash is scale 1 with scaleY 0.8. */
  scaleX: z.number().min(0).max(20).optional(),
  scaleY: z.number().min(0).max(20).optional(),
  /** What rotation and scale turn around, in % of the element's own box (default its centre, 50/50). */
  pivot: PointSchema.optional(),
  /** Tilt in 3D, in degrees: positive leans the top away from the viewer. The element stays flat; only its perspective changes. */
  rotateX: z.number().min(-3600).max(3600).optional(),
  /** Tilt in 3D, in degrees: positive swings the right edge away from the viewer. */
  rotateY: z.number().min(-3600).max(3600).optional(),
  /** How far the viewer is from a tilted element, in u (default 1200, DEFAULT_DEPTH in animatable.ts): smaller is a stronger perspective. */
  depth: z.number().min(100).max(20000).optional(),
  opacity: z.number().min(0).max(1).optional(),
  z: z.number().int().min(-100).max(100).optional(),
  enter: EnterAnimationSchema.optional(),
  exit: ExitAnimationSchema.optional(),
  emphasis: z.array(EmphasisSchema).max(24).optional(),
  /** Property keyframes (see KeyframeSchema): explicit values over time for the properties the registry lists. */
  keyframes: z.array(KeyframeSchema).max(MAX_KEYFRAMES).optional(),
  /** A curve the element travels along; `pathProgress` (0–1, usually keyframed) picks the point on it. */
  motionPath: MotionPathSchema.optional(),
  pathProgress: z.number().min(0).max(1).optional(),
  idle: IdleSchema.optional(),
  motionRole: z.enum(MOTION_ROLES).optional(),
  motionIntent: z.enum(MOTION_INTENTS).optional(),
  style: StyleSchema.optional(),
  /** How it mixes with what is underneath (default `normal`). */
  blend: BlendSchema.optional(),
  /** Blur, glow, shadow and colour effects on the element as a whole. */
  effects: EffectsSchema.optional(),
  /** A shape it is seen through, in % of its own box. */
  clip: ClipSchema.optional(),
  notes: z.string().max(2000).optional(),
};

const Text = z.string().min(1).max(600);
const ShortText = z.string().max(200);
const FontRefSchema = z.string().min(1).max(80); // "heading" | "body" | "mono" | font family name
const SizeSchema = z.number().positive().max(1200);
const IconNameSchema = z.string().min(1).max(60); // lucide icon name, e.g. "calendar-check"
const AssetIdSchema = z.string().min(1).max(80);

export const TEXT_ROLES = ["display", "headline", "title", "subtitle", "body", "caption", "label", "eyebrow", "quote"] as const;

const ChartDatumSchema = z.strictObject({ label: ShortText, value: z.number(), color: ColorSchema.optional() });

export const ScreenSchema = z.strictObject({
  kind: z.enum(["dashboard", "analytics", "list", "chat", "landing", "form", "image", "video", "blank"]),
  assetId: AssetIdSchema.optional(),
  title: ShortText.optional(),
  items: z.array(ShortText).max(12).optional(),
  accent: ColorSchema.optional(),
  /** Brand shown inside the mock screen (e.g. a customer's site). Defaults to the project brand. */
  brand: ShortText.optional(),
});
export type Screen = z.infer<typeof ScreenSchema>;

const CardItemSchema = z.strictObject({
  title: ShortText.optional(),
  body: z.string().max(300).optional(),
  icon: IconNameSchema.optional(),
  value: ShortText.optional(),
  label: ShortText.optional(),
  image: AssetIdSchema.optional(),
  color: ColorSchema.optional(),
});
export type CardItem = z.infer<typeof CardItemSchema>;

const CARD_VARIANTS = ["default", "glass", "solid", "outline", "app", "stat", "feature", "testimonial"] as const;
const THEME = z.enum(["light", "dark"]);

export const TextElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("text"),
  text: Text,
  role: z.enum(TEXT_ROLES).optional(),
  size: SizeSchema.optional(),
  weight: z.number().int().min(100).max(900).optional(),
  font: FontRefSchema.optional(),
  color: ColorSchema.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  /** Percent of frame width. */
  maxWidth: z.number().positive().max(100).optional(),
  lineHeight: z.number().positive().max(3).optional(),
  /** em units, e.g. -0.02 */
  letterSpacing: z.number().min(-0.2).max(1).optional(),
  transform: z.enum(["none", "uppercase", "lowercase"]).optional(),
  gradient: z.boolean().optional(),
  highlight: z
    .strictObject({
      words: z.array(z.string().min(1)).min(1).max(20),
      style: z.enum(["color", "marker", "underline", "box"]).optional(),
      color: ColorSchema.optional(),
      /** "enter": highlighted from the start · "spoken": highlight lands when the narrator says the word */
      at: z.enum(["enter", "spoken"]).optional(),
    })
    .optional(),
  /** With wordReveal: each word appears exactly when the narrator speaks it. */
  syncToVoice: z.boolean().optional(),
});

export const KineticElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("kinetic"),
  /** "voice": words and timing from the narration inside this scene. */
  source: z.enum(["voice", "text"]).optional(),
  text: Text.optional(),
  mode: z.enum(["phrase", "word", "stack", "karaoke"]).optional(),
  size: SizeSchema.optional(),
  font: FontRefSchema.optional(),
  weight: z.number().int().min(100).max(900).optional(),
  color: ColorSchema.optional(),
  activeColor: ColorSchema.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  maxWidth: z.number().positive().max(100).optional(),
  emphasisWords: z.array(z.string()).max(30).optional(),
  transform: z.enum(["none", "uppercase", "lowercase"]).optional(),
});

export const CaptionsElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("captions"),
  variant: z.enum(["minimal", "boxed", "bold", "karaoke"]).optional(),
  position: z.enum(["bottom", "top", "center"]).optional(),
  size: SizeSchema.optional(),
  maxWords: z.number().int().min(1).max(20).optional(),
});

export const BadgeElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("badge"),
  text: ShortText.min(1),
  icon: IconNameSchema.optional(),
  variant: z.enum(["solid", "soft", "outline", "glass"]).optional(),
  color: ColorSchema.optional(),
  size: SizeSchema.optional(),
});

export const CardElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("card"),
  ...CardItemSchema.shape,
  variant: z.enum(CARD_VARIANTS).optional(),
  accent: ColorSchema.optional(),
});

const CardsItemSchema = CardItemSchema.extend({
  /** This card enters when the trigger fires (e.g. the moment the narrator names it). */
  at: TriggerSchema.optional(),
});

/** Seconds a `cards` collapse takes. */
export const CARDS_COLLAPSE_SECONDS = 0.8;

export const CardsElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("cards"),
  items: z.array(CardsItemSchema).min(1).max(12),
  layout: z.enum(["row", "column", "grid", "scatter", "stack", "orbit", "cascade"]).optional(),
  variant: z.enum(CARD_VARIANTS).optional(),
  accent: ColorSchema.optional(),
  /** Gap in u. */
  gap: z.number().min(0).max(400).optional(),
  /** Card size in u. */
  itemWidth: z.number().positive().max(2000).optional(),
  itemHeight: z.number().positive().max(2000).optional(),
  /** Cards converge to the element's anchor and fade out ("many tools → one platform"). */
  collapseAt: TriggerSchema.optional(),
});

export const BrowserElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("browser"),
  url: ShortText.optional(),
  title: ShortText.optional(),
  screen: ScreenSchema.optional(),
  theme: THEME.optional(),
});

export const PhoneElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("phone"),
  screen: ScreenSchema.optional(),
  theme: THEME.optional(),
});

export const DesktopElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("desktop"),
  device: z.enum(["laptop", "monitor"]).optional(),
  screen: ScreenSchema.optional(),
  theme: THEME.optional(),
});

export const DashboardElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("dashboard"),
  title: ShortText.optional(),
  sidebar: z.array(ShortText).max(10).optional(),
  kpis: z
    .array(z.strictObject({ label: ShortText, value: ShortText, delta: ShortText.optional() }))
    .max(6)
    .optional(),
  chart: z.array(ChartDatumSchema).max(24).optional(),
  rows: z
    .array(z.strictObject({ label: ShortText, value: ShortText.optional(), status: z.enum(["ok", "warn", "error", "info"]).optional() }))
    .max(8)
    .optional(),
  theme: THEME.optional(),
});

export const ButtonElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("button"),
  label: ShortText.min(1),
  variant: z.enum(["primary", "secondary", "outline", "ghost"]).optional(),
  icon: IconNameSchema.optional(),
  size: z.enum(["sm", "md", "lg"]).optional(),
  pressAt: TriggerSchema.optional(),
});

export const NotificationElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("notification"),
  title: ShortText.min(1),
  body: z.string().max(300).optional(),
  icon: IconNameSchema.optional(),
  app: ShortText.optional(),
  time: ShortText.optional(),
  variant: z.enum(["toast", "ios", "banner"]).optional(),
});

export const CursorElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("cursor"),
  path: z.array(z.strictObject({ x: z.number(), y: z.number(), at: TriggerSchema })).min(1).max(30),
  clicks: z.array(TriggerSchema).max(20).optional(),
  variant: z.enum(["arrow", "hand"]).optional(),
});

export const LineElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("line"),
  /** Start and end points in percent of frame. */
  from: PointSchema,
  to: PointSchema,
  color: ColorSchema.optional(),
  strokeWidth: z.number().positive().max(100).optional(),
  dashed: z.boolean().optional(),
  arrow: z.boolean().optional(),
  curve: z.number().min(-1).max(1).optional(),
});

export const CircleElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("circle"),
  size: SizeSchema.optional(),
  color: ColorSchema.optional(),
  fill: z.boolean().optional(),
  strokeWidth: z.number().positive().max(100).optional(),
});

export const RectElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("rect"),
  color: ColorSchema.optional(),
  fill: z.boolean().optional(),
  strokeWidth: z.number().positive().max(100).optional(),
  radius: z.number().min(0).max(2000).optional(),
});

export const GridElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("grid"),
  variant: z.enum(["lines", "dots"]).optional(),
  spacing: z.number().positive().max(1000).optional(),
  color: ColorSchema.optional(),
  perspective: z.boolean().optional(),
});

export const ProgressElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("progress"),
  value: z.number().min(0).max(100),
  from: z.number().min(0).max(100).optional(),
  variant: z.enum(["bar", "ring"]).optional(),
  label: ShortText.optional(),
  showValue: z.boolean().optional(),
  color: ColorSchema.optional(),
  size: SizeSchema.optional(),
  animateAt: TriggerSchema.optional(),
});

export const ChartElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("chart"),
  kind: z.enum(["bar", "line", "area", "donut"]),
  data: z.array(ChartDatumSchema).min(1).max(24),
  unit: ShortText.optional(),
  showValues: z.boolean().optional(),
  showLabels: z.boolean().optional(),
  highlight: z.number().int().nonnegative().optional(),
  color: ColorSchema.optional(),
  animateAt: TriggerSchema.optional(),
});

export const CounterElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("counter"),
  from: z.number().optional(),
  to: z.number(),
  decimals: z.number().int().min(0).max(4).optional(),
  prefix: ShortText.optional(),
  suffix: ShortText.optional(),
  label: ShortText.optional(),
  size: SizeSchema.optional(),
  color: ColorSchema.optional(),
  animateAt: TriggerSchema.optional(),
  /** Count-up duration in seconds. */
  countDuration: z.number().positive().max(20).optional(),
});

export const DiagramElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("diagram"),
  layout: z.enum(["hub", "flow", "cycle", "grid"]).optional(),
  center: z.strictObject({ label: ShortText, icon: IconNameSchema.optional() }).optional(),
  nodes: z
    .array(z.strictObject({ label: ShortText, icon: IconNameSchema.optional(), color: ColorSchema.optional() }))
    .min(1)
    .max(12),
  /** Node index pairs; hub layout connects every node to the center automatically. */
  edges: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])).max(40).optional(),
  color: ColorSchema.optional(),
  connectAt: TriggerSchema.optional(),
});

export const IconElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("icon"),
  name: IconNameSchema,
  size: SizeSchema.optional(),
  color: ColorSchema.optional(),
  container: z.enum(["none", "circle", "square", "glass"]).optional(),
  strokeWidth: z.number().positive().max(10).optional(),
});

export const ListElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("list"),
  items: z
    .array(z.strictObject({ text: ShortText.min(1), icon: IconNameSchema.optional(), at: TriggerSchema.optional() }))
    .min(1)
    .max(8),
  variant: z.enum(["bullets", "checks", "numbers", "icons"]).optional(),
  size: SizeSchema.optional(),
  gap: z.number().min(0).max(400).optional(),
  color: ColorSchema.optional(),
});

const OverlaySchema = z.strictObject({ color: ColorSchema, opacity: z.number().min(0).max(1) });
/** Recolors media toward a hue while keeping its light and shadow (CSS "color" blend). `amount` 0..1, default 1. */
const TintSchema = z.strictObject({ color: ColorSchema, amount: z.number().min(0).max(1).optional() });

export const ImageElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("image"),
  assetId: AssetIdSchema,
  fit: z.enum(["cover", "contain"]).optional(),
  radius: z.number().min(0).max(2000).optional(),
  mask: z.enum(["none", "circle", "rounded"]).optional(),
  kenBurns: z
    .strictObject({
      from: z.number().positive().max(4).optional(),
      to: z.number().positive().max(4).optional(),
      panX: z.number().min(-50).max(50).optional(),
      panY: z.number().min(-50).max(50).optional(),
    })
    .optional(),
  overlay: OverlaySchema.optional(),
  /** Zoom regions (seconds from when the image appears; areas in fractions of its frame), as on overlay clips. */
  zooms: z.array(OverlayZoomSchema).max(MAX_ZOOMS_PER_CLIP).optional(),
  /** Cut from the edges (fractions of the image). */
  crop: CropSchema.optional(),
  /** Blur, boxes, arrows, labels, spotlights and click ripples (seconds from when it appears). */
  annotations: z.array(AnnotationSchema).max(MAX_ANNOTATIONS).optional(),
});

export const VideoElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("video"),
  assetId: AssetIdSchema,
  fit: z.enum(["cover", "contain"]).optional(),
  radius: z.number().min(0).max(2000).optional(),
  /** Seconds into the source clip where playback starts. */
  startFrom: z.number().min(0).optional(),
  /** Seconds into the source clip where playback ends (default: the end of the clip). */
  endAt: z.number().min(0).optional(),
  playbackRate: z.number().min(0.1).max(4).optional(),
  /** Clip audio volume (0 = muted, the default — the voice-over is primary). */
  volume: z.number().min(0).max(1).optional(),
  /** Clip audio dips while the narrator speaks. */
  duckUnderVoice: z.boolean().optional(),
  /** Loop the trimmed part; otherwise it holds its last frame. */
  loop: z.boolean().optional(),
  overlay: OverlaySchema.optional(),
  /** Zoom regions (seconds from when the video appears; areas in fractions of its frame), as on overlay clips. */
  zooms: z.array(OverlayZoomSchema).max(MAX_ZOOMS_PER_CLIP).optional(),
  /** Cut from the edges (fractions of the video). */
  crop: CropSchema.optional(),
  /** Speed ramps and freeze frames (seconds from when it appears; rate 0 freezes the picture). Clip audio is muted while any are set. */
  speedSegments: z.array(SpeedSegmentSchema).max(MAX_SPEED_SEGMENTS).optional(),
  /** Blur, boxes, arrows, labels, spotlights and click ripples (seconds from when it appears). */
  annotations: z.array(AnnotationSchema).max(MAX_ANNOTATIONS).optional(),
});

export const LogoElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("logo"),
  /** Defaults to the brand logo; falls back to a wordmark of the brand name. */
  assetId: AssetIdSchema.optional(),
  text: ShortText.optional(),
  size: SizeSchema.optional(),
  variant: z.enum(["mark", "wordmark", "lockup"]).optional(),
  color: ColorSchema.optional(),
});

/** Every element that can be drawn on its own — the members of a group, and of a scene. */
const LEAF_SCHEMAS = [
  TextElementSchema,
  KineticElementSchema,
  CaptionsElementSchema,
  BadgeElementSchema,
  CardElementSchema,
  CardsElementSchema,
  BrowserElementSchema,
  PhoneElementSchema,
  DesktopElementSchema,
  DashboardElementSchema,
  ButtonElementSchema,
  NotificationElementSchema,
  CursorElementSchema,
  LineElementSchema,
  CircleElementSchema,
  RectElementSchema,
  GridElementSchema,
  ProgressElementSchema,
  ChartElementSchema,
  CounterElementSchema,
  DiagramElementSchema,
  IconElementSchema,
  ListElementSchema,
  ImageElementSchema,
  VideoElementSchema,
  LogoElementSchema,
] as const;

/** An element inside a group: anything but another group — groups don't nest. */
export const GroupChildSchema = z.discriminatedUnion("type", [...LEAF_SCHEMAS]);
export type GroupChild = z.infer<typeof GroupChildSchema>;

export const MAX_GROUP_CHILDREN = 24;

/**
 * Several elements treated as one. A group is a layer the size of the frame: its children keep their
 * own frame coordinates (grouping never moves anything), and the group's own transform, opacity,
 * timing, animation, keyframes, effects, mask and blend apply to all of them together. `x`/`y` shift
 * the whole layer — 50/50 leaves it where it is — and scale and rotation turn around `pivot`, in % of
 * the frame. Groups do not nest.
 */
export const GroupElementSchema = z.strictObject({
  ...BASE,
  type: z.literal("group"),
  name: ShortText.optional(),
  children: z.array(GroupChildSchema).min(1).max(MAX_GROUP_CHILDREN),
});

export const ElementSchema = z.discriminatedUnion("type", [
  TextElementSchema,
  KineticElementSchema,
  CaptionsElementSchema,
  BadgeElementSchema,
  CardElementSchema,
  CardsElementSchema,
  BrowserElementSchema,
  PhoneElementSchema,
  DesktopElementSchema,
  DashboardElementSchema,
  ButtonElementSchema,
  NotificationElementSchema,
  CursorElementSchema,
  LineElementSchema,
  CircleElementSchema,
  RectElementSchema,
  GridElementSchema,
  ProgressElementSchema,
  ChartElementSchema,
  CounterElementSchema,
  DiagramElementSchema,
  IconElementSchema,
  ListElementSchema,
  ImageElementSchema,
  VideoElementSchema,
  LogoElementSchema,
  GroupElementSchema,
]);
export type SceneElement = z.infer<typeof ElementSchema>;
export type ElementType = SceneElement["type"];
export type ElementOf<T extends ElementType> = Extract<SceneElement, { type: T }>;

export const ELEMENT_TYPES = ElementSchema.options.map((o) => o.shape.type.value) as ElementType[];

export const isGroup = (element: SceneElement): element is ElementOf<"group"> => element.type === "group";

// ---------------------------------------------------------------------------------------
// Backgrounds, transitions, camera
// ---------------------------------------------------------------------------------------

const BG_COMMON = {
  /** Film grain overlay strength 0..1 (keep ≤ 0.08). */
  grain: z.number().min(0).max(1).optional(),
  /** Edge darkening 0..1. */
  vignette: z.number().min(0).max(1).optional(),
};

export const BackgroundSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...BG_COMMON, type: z.literal("solid"), color: ColorSchema.optional() }),
  z.strictObject({
    ...BG_COMMON,
    type: z.literal("gradient"),
    colors: z.array(ColorSchema).min(2).max(5).optional(),
    angle: z.number().optional(),
    radial: z.boolean().optional(),
    animate: z.boolean().optional(),
  }),
  z.strictObject({
    ...BG_COMMON,
    type: z.literal("mesh"),
    base: ColorSchema.optional(),
    colors: z.array(ColorSchema).min(1).max(4).optional(),
    intensity: z.number().min(0).max(1).optional(),
  }),
  z.strictObject({
    ...BG_COMMON,
    type: z.literal("grid"),
    base: ColorSchema.optional(),
    color: ColorSchema.optional(),
    variant: z.enum(["lines", "dots"]).optional(),
    spacing: z.number().positive().max(1000).optional(),
    fade: z.boolean().optional(),
    drift: z.boolean().optional(),
  }),
  z.strictObject({ ...BG_COMMON, type: z.literal("noise"), base: ColorSchema.optional(), color: ColorSchema.optional(), intensity: z.number().min(0).max(1).optional() }),
  z.strictObject({
    ...BG_COMMON,
    type: z.literal("particles"),
    base: ColorSchema.optional(),
    color: ColorSchema.optional(),
    count: z.number().int().min(1).max(300).optional(),
    speed: z.number().min(0).max(5).optional(),
  }),
  z.strictObject({
    ...BG_COMMON,
    type: z.literal("image"),
    assetId: AssetIdSchema,
    overlay: OverlaySchema.optional(),
    tint: TintSchema.optional(),
    blur: z.number().min(0).max(100).optional(),
    kenBurns: z.boolean().optional(),
  }),
  z.strictObject({
    ...BG_COMMON,
    type: z.literal("video"),
    assetId: AssetIdSchema,
    overlay: OverlaySchema.optional(),
    tint: TintSchema.optional(),
    blur: z.number().min(0).max(100).optional(),
    startFrom: z.number().min(0).optional(),
  }),
]);
export type Background = z.infer<typeof BackgroundSchema>;

export const TRANSITIONS = ["none", "cut", "fade", "slide", "wipe", "zoom", "blur", "scale", "morph"] as const;
export const TransitionSchema = z.strictObject({
  type: z.enum(TRANSITIONS),
  duration: z.number().min(0).max(2).optional(),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const CameraSchema = z.strictObject({
  type: z.enum(["static", "pushIn", "pullOut", "panLeft", "panRight", "panUp", "panDown", "drift"]),
  /** Scale/translation amount, 0..0.5 (0.04 is a tasteful push-in). */
  amount: z.number().min(0).max(0.5).optional(),
});
export type Camera = z.infer<typeof CameraSchema>;

export const SHOT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * A shot inside a scene. Shots run in order within the scene's audio-locked timing: each starts at
 * its `at` trigger (the first defaults to the scene start) and ends where the next one starts.
 * Default enter/exit timing of shot elements is relative to the shot.
 */
export const ShotSpecSchema = z.strictObject({
  id: z.string().regex(SHOT_ID_RE, "Shot ids use 1–40 letters, digits, _ or -"),
  at: TriggerSchema.optional(),
  /** Covers the scene background while the shot is on screen. */
  background: BackgroundSchema.optional(),
  camera: CameraSchema.optional(),
  /** How the shot enters over the previous shot (the first shot uses the scene transition). */
  transitionIn: TransitionSchema.optional(),
  elements: z.array(ElementSchema).max(40),
  notes: z.string().max(2000).optional(),
});
export type ShotSpec = z.infer<typeof ShotSpecSchema>;

export const SceneSpecSchema = z
  .strictObject({
    version: z.literal(1).optional(),
    background: BackgroundSchema.optional(),
    /** How this scene enters over the previous one. The previous scene keeps playing underneath. */
    transitionIn: TransitionSchema.optional(),
    camera: CameraSchema.optional(),
    /** Motion density of the scene (scales default motion; see REMOTION.md → Motion grammar). */
    motion: z.strictObject({ density: z.enum(MOTION_DENSITIES).optional() }).optional(),
    /** Scene-level elements. With shots they persist across all shots: z < 0 below the shots, z ≥ 0 above. */
    elements: z.array(ElementSchema).max(60),
    shots: z.array(ShotSpecSchema).max(12).optional(),
    notes: z.string().max(4000).optional(),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    spec.shots?.forEach((shot, i) => {
      if (seen.has(shot.id)) ctx.addIssue({ code: "custom", path: ["shots", i, "id"], message: `Duplicate shot id "${shot.id}"` });
      seen.add(shot.id);
    });
    // Keyframes (the registry decides both): properties the type's renderer applies, values in range, unique ids, one keyframe per property per moment.
    const checkKeyframes = (elements: readonly SceneElement[], path: (string | number)[]): void =>
      elements.forEach((el, i) => {
        if (isGroup(el)) checkKeyframes(el.children, [...path, i, "children"]);
        if (!el.keyframes?.length) return;
        const ids = new Set<string>();
        const times = new Map<KeyframeProperty, number[]>();
        el.keyframes.forEach((k, j) => {
          const at = [...path, i, "keyframes", j];
          const unsupported = propertySupportIssue(el.type, k.property);
          if (unsupported) ctx.addIssue({ code: "custom", path: [...at, "property"], message: unsupported });
          const outOfRange = propertyValueIssue(k.property, k.value);
          if (outOfRange) ctx.addIssue({ code: "custom", path: [...at, "value"], message: outOfRange });
          if (ids.has(k.id)) ctx.addIssue({ code: "custom", path: [...at, "id"], message: `Duplicate keyframe id "${k.id}"` });
          ids.add(k.id);
          const list = times.get(k.property) ?? [];
          if (list.some((t) => Math.abs(t - k.time) <= KEYFRAME_TIME_EPS)) ctx.addIssue({ code: "custom", path: [...at, "time"], message: `Two ${k.property} keyframes at ${k.time}s` });
          list.push(k.time);
          times.set(k.property, list);
        });
      });
    checkKeyframes(spec.elements, ["elements"]);
    spec.shots?.forEach((shot, s) => checkKeyframes(shot.elements, ["shots", s, "elements"]));
  });
export type SceneSpec = z.infer<typeof SceneSpecSchema>;
export type MotionDensity = (typeof MOTION_DENSITIES)[number];
export type MotionRole = (typeof MOTION_ROLES)[number];
export type MotionIntent = (typeof MOTION_INTENTS)[number];

/** An element and its children (a group), or just the element. */
export function withGroupChildren(element: SceneElement): SceneElement[] {
  return isGroup(element) ? [element, ...element.children] : [element];
}

/**
 * Every element of a scene: scene-level, inside its shots, and inside its groups. `index` is the
 * element's place in the list it lives in and `child` its place inside its group, so the pair is the
 * element's `ElementRef` (core/timeline/element-layout.ts).
 */
export function allSpecElements(spec: SceneSpec): { element: SceneElement; shotId: string | null; index: number; child: number | null }[] {
  const out: { element: SceneElement; shotId: string | null; index: number; child: number | null }[] = [];
  const walk = (elements: readonly SceneElement[], shotId: string | null) =>
    elements.forEach((element, index) => {
      out.push({ element, shotId, index, child: null });
      if (isGroup(element)) element.children.forEach((c, child) => out.push({ element: c, shotId, index, child }));
    });
  walk(spec.elements, null);
  (spec.shots ?? []).forEach((shot) => walk(shot.elements, shot.id));
  return out;
}

export const EMPTY_SCENE_SPEC: SceneSpec = { version: 1, elements: [] };

export interface SpecIssue {
  path: string;
  message: string;
}

export function validateSceneSpec(input: unknown): { ok: true; spec: SceneSpec } | { ok: false; issues: SpecIssue[] } {
  const result = SceneSpecSchema.safeParse(input);
  if (result.success) return { ok: true, spec: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
  };
}

/** Asset ids referenced anywhere in a scene spec. */
export function assetIdsInSpec(spec: SceneSpec): string[] {
  const ids = new Set<string>();
  for (const bg of [spec.background, ...(spec.shots ?? []).map((s) => s.background)]) {
    if (bg && (bg.type === "image" || bg.type === "video")) ids.add(bg.assetId);
  }
  for (const { element: el } of allSpecElements(spec)) {
    if (el.type === "image" || el.type === "video") ids.add(el.assetId);
    if (el.type === "logo" && el.assetId) ids.add(el.assetId);
    if (el.type === "card" && el.image) ids.add(el.image);
    if (el.type === "cards") el.items.forEach((it) => it.image && ids.add(it.image));
    if ((el.type === "browser" || el.type === "phone" || el.type === "desktop") && el.screen?.assetId) ids.add(el.screen.assetId);
  }
  return [...ids];
}
