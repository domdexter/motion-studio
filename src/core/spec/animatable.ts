import { VALUE_TYPES, valueOps } from "../motion/values";
import type { DesignSystem } from "./design";
import type { ElementType, KeyframeEasing, KeyframeValue } from "./scene";

/**
 * The animatable property registry — the one description of what Motion Studio can keyframe.
 *
 * Each definition says what a property is (name, category, value type, unit, range, default), which
 * element types it animates, how its values travel between keyframes, how the editor shows and edits
 * it, and whether it is enabled at all. Everything else reads this: the scene schema validates against
 * it, `core/motion/keyframes.ts` resolves with it, the inspector and timeline label and format with it,
 * the CLI validates with it, and the renderer writes the resolved value into the element `field` it
 * names (`elementAtTime`). Nothing here knows about React or the DOM — the UI decides how to draw the
 * control this metadata describes.
 *
 * Adding a property: add a definition below, make sure the renderer reads its `field` on the elements
 * that support it, and set `status: "enabled"`. Nothing else has a list to update. Properties that are
 * described but not ready stay `status: "planned"`: the schema, editor, timeline, CLI and renderer all
 * ignore them, so they can't be saved or shown (see REMOTION.md → "Keyframes").
 *
 * Value types (number, color, point) and their interpolation strategies live in core/motion/values.ts;
 * a property names one of each, so nothing branches on what kind of value it holds.
 */

export type PropertyCategory = "transform" | "appearance" | "typography" | "path" | "compositing";
/** The kind of value a property holds — see core/motion/values.ts for what each one can do. */
export type PropertyValueType = "number" | "color" | "point";
/** What the stored value means. The renderer keeps these units; `display` says how the editor shows them. */
export type PropertyUnit = "percentOfFrame" | "percentOfBox" | "degrees" | "multiplier" | "fraction" | "designUnits" | "em" | "color";
/** How values travel between two keyframes — the strategies in core/motion/values.ts. */
export type InterpolationId = "number" | "oklab" | "point";
/** The control the inspector uses for a property. */
export type PropertyEditorKind = "scrub" | "slider" | "color" | "point";
/** "planned": described here, but not animatable — the schema, editor, timeline, CLI and renderer ignore it. */
export type PropertyStatus = "enabled" | "planned";
/** Element types whose renderer applies the property. */
export type ElementSupport = "all" | { readonly except: readonly ElementType[] } | { readonly only: readonly ElementType[] };

/** The viewer's distance from a tilted element that sets no `depth` of its own, in u. */
export const DEFAULT_DEPTH = 1200;

export interface PropertyDisplay {
  /** The stored value × factor is what the editor shows and takes (opacity is stored 0..1 and edited as a percentage). */
  readonly factor: number;
  /** Written after the shown value. */
  readonly suffix: string;
  /** Decimals shown (a stored value keeps `precision`). */
  readonly decimals: number;
}

export interface PropertyEditing {
  readonly kind: PropertyEditorKind;
  /** Step of that control, in stored units. */
  readonly step: number;
  /** What the element's own field takes, when that is narrower than `range` (a saved scale of 0 would hide it). */
  readonly staticRange?: readonly [number, number];
  /** The smallest value the element's own field keeps when its animation is removed. */
  readonly staticMin?: number;
}

export interface AnimatableProperty {
  /** What a keyframe's `property` holds. */
  readonly id: string;
  readonly label: string;
  /** Short label for narrow controls (the inspector's transform grid). */
  readonly short: string;
  readonly category: PropertyCategory;
  readonly value: PropertyValueType;
  readonly unit: PropertyUnit;
  /** What it does — the inspector's tooltip and the CLI's help. */
  readonly description: string;
  /**
   * The element field holding the value while the property isn't animated, as a path ("style.radius"
   * nests). The renderer reads that field, so resolving a keyframe means writing the value into it
   * (`elementAtTime`); how the field then moves, colors or sizes the element stays with the element's
   * own renderer.
   */
  readonly field: string;
  /**
   * Where an edit of this property goes in an element patch: a field of the element itself, one of its
   * type's own properties (`props`), a key of its `style`, of its `effects`, or of its `clip`. The patch
   * keeps those apart, so the registry says which one a property belongs to rather than every caller
   * guessing from the field path.
   */
  readonly patchIn: "element" | "props" | "style" | "effects" | "clip";
  /** What the renderer uses when the field isn't set (null: it comes from the design system or the element's own size). */
  readonly defaultValue: KeyframeValue | null;
  /** Where that default comes from in the design system, when it does. */
  readonly designDefault?: keyof DesignSystem["shape"];
  /** Numbers and points: stored values stay inside this range, kept to `precision` decimals. */
  readonly range?: readonly [number, number];
  readonly precision: number;
  /** A resolved value is clamped to this before it renders: eased curves overshoot, but opacity stays 0..1 and scale never flips. */
  readonly renderRange?: readonly [number, number];
  readonly interpolation: InterpolationId;
  /** The easing a keyframe uses when it doesn't set one. */
  readonly defaultEasing: KeyframeEasing;
  readonly elements: ElementSupport;
  /** Only meaningful when the element has this — `motionPath` for path progress, `clip` for the clip reveal. */
  readonly requires?: "motionPath" | "clip";
  /**
   * That the value is a position in the frame, along which axis: a copied or re-anchored element moves
   * its animated positions with it, and nothing else. A point property marked "both" moves in both.
   */
  readonly axis?: "x" | "y" | "both";
  readonly display: PropertyDisplay;
  /** How the inspector edits it (null: not editable there). */
  readonly editing: PropertyEditing | null;
  /** Whether the timeline can show it as a keyframe row. */
  readonly timeline: boolean;
  readonly status: PropertyStatus;
  /** Why a planned property isn't enabled yet. */
  readonly blocked?: string;
}

/**
 * The enabled property ids, as the type the scene schema's keyframe enum uses. It is written out here
 * rather than derived from the definitions below because those name element types, and the element
 * schema contains keyframes — deriving the enum from them would make the two schemas circular. A test
 * (`animatable.test.ts`) keeps this list and the enabled definitions in step.
 */
const ENABLED_IDS = [
  "x",
  "y",
  "scale",
  "scaleX",
  "scaleY",
  "rotation",
  "pivot",
  "rotateX",
  "rotateY",
  "depth",
  "width",
  "height",
  "pathProgress",
  "opacity",
  "color",
  "background",
  "radius",
  "borderWidth",
  "strokeWidth",
  "blur",
  "size",
  "letterSpacing",
  "from",
  "to",
  "effectBlur",
  "glow",
  "glowColor",
  "shadowX",
  "shadowY",
  "shadowBlur",
  "shadowColor",
  "brightness",
  "contrast",
  "saturate",
  "clipProgress",
] as const;
/** What a keyframe animates. Planned properties are not part of the type, so nothing can store them. */
export type KeyframeProperty = (typeof ENABLED_IDS)[number];
/** The animatable properties, in the editor's order — the scene schema's keyframe `property` enum. */
export const KEYFRAME_PROPERTIES = ENABLED_IDS;

// Element support, written out so the registry stays free of runtime imports. Tests check each list
// against the renderer's own rules (size modes, style support, which renderers read the field).

/** Lines and cursors are placed by their own points and a grid fills the frame, so x and y don't move them. */
const POSITIONED: ElementSupport = { except: ["line", "cursor", "grid"] };
/** Types whose renderer reads `width` (size mode "box" or "width" — see sizeModeOf). */
const SIZED_WIDTH: ElementSupport = { only: ["rect", "grid", "chart", "diagram", "card", "cards", "browser", "phone", "dashboard", "image", "video", "desktop", "notification", "list", "progress"] };
/** Types whose renderer reads `height` (size mode "box"). Text sizes itself from its content, so it is not here. */
const SIZED_HEIGHT: ElementSupport = { only: ["rect", "grid", "chart", "diagram", "card", "cards", "browser", "phone", "dashboard", "image", "video"] };
/** Types whose renderer reads `element.color` (see APPEARANCE_PROPS / TYPOGRAPHY_PROPS). */
const COLORED: ElementSupport = { only: ["text", "kinetic", "badge", "counter", "list", "icon", "chart", "diagram", "progress", "line", "circle", "rect", "grid", "logo"] };
/** Types whose renderer reads a numeric `size` in design units (buttons size by keyword, text by role, so they are not here). */
const SIZED_PX: ElementSupport = { only: ["badge", "counter", "logo", "captions", "circle", "icon", "progress"] };

/**
 * The properties, in the order the editor and the CLI list them: transform, then path, appearance and
 * typography.
 */
const DEFINITIONS = [
  {
    id: "x",
    label: "X",
    short: "X",
    category: "transform",
    value: "number",
    unit: "percentOfFrame",
    description: "Horizontal position of its anchor, % of the frame width",
    axis: "x",
    field: "x",
    patchIn: "element",
    defaultValue: 50,
    range: [-100, 200],
    precision: 2,
    interpolation: "number",
    defaultEasing: "linear",
    elements: POSITIONED,
    display: { factor: 1, suffix: "%", decimals: 2 },
    editing: { kind: "scrub", step: 0.1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "y",
    label: "Y",
    short: "Y",
    category: "transform",
    value: "number",
    unit: "percentOfFrame",
    description: "Vertical position of its anchor, % of the frame height",
    axis: "y",
    field: "y",
    patchIn: "element",
    defaultValue: 50,
    range: [-100, 200],
    precision: 2,
    interpolation: "number",
    defaultEasing: "linear",
    elements: POSITIONED,
    display: { factor: 1, suffix: "%", decimals: 2 },
    editing: { kind: "scrub", step: 0.1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "scale",
    label: "Scale",
    short: "Scale",
    category: "transform",
    value: "number",
    unit: "multiplier",
    description: "Scale (1 = its size), around its pivot",
    field: "scale",
    patchIn: "element",
    defaultValue: 1,
    range: [0, 20],
    precision: 3,
    renderRange: [0, Number.POSITIVE_INFINITY],
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "×", decimals: 2 },
    // A keyframe may scale from nothing; the element's own scale may not (it would be invisible with no way back).
    editing: { kind: "scrub", step: 0.01, staticRange: [0.05, 20], staticMin: 0.01 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "scaleX",
    label: "Scale X",
    short: "Sc X",
    category: "transform",
    value: "number",
    unit: "multiplier",
    description: "Extra width-only scale, on top of Scale (a squash or stretch)",
    field: "scaleX",
    patchIn: "element",
    defaultValue: 1,
    range: [0, 20],
    precision: 3,
    renderRange: [0, Number.POSITIVE_INFINITY],
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "×", decimals: 2 },
    editing: { kind: "scrub", step: 0.01, staticRange: [0.05, 20], staticMin: 0.01 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "scaleY",
    label: "Scale Y",
    short: "Sc Y",
    category: "transform",
    value: "number",
    unit: "multiplier",
    description: "Extra height-only scale, on top of Scale (a squash or stretch)",
    field: "scaleY",
    patchIn: "element",
    defaultValue: 1,
    range: [0, 20],
    precision: 3,
    renderRange: [0, Number.POSITIVE_INFINITY],
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "×", decimals: 2 },
    editing: { kind: "scrub", step: 0.01, staticRange: [0.05, 20], staticMin: 0.01 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "rotation",
    label: "Rotation",
    short: "Rot",
    category: "transform",
    value: "number",
    unit: "degrees",
    description: "Rotation in degrees, around its pivot",
    field: "rotation",
    patchIn: "element",
    defaultValue: 0,
    range: [-3600, 3600],
    precision: 2,
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "°", decimals: 2 },
    editing: { kind: "scrub", step: 1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "pivot",
    label: "Pivot",
    short: "Pivot",
    category: "transform",
    value: "point",
    unit: "percentOfBox",
    description: "The point rotation and scale turn around, in % of the element's own box (50, 50 is its centre)",
    field: "pivot",
    patchIn: "element",
    defaultValue: [50, 50],
    range: [-100, 200],
    precision: 1,
    interpolation: "point",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "%", decimals: 1 },
    editing: { kind: "point", step: 1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "rotateX",
    label: "Tilt X",
    short: "Tilt X",
    category: "transform",
    value: "number",
    unit: "degrees",
    description: "Tilt in 3D around the horizontal axis: positive leans the top away from the viewer",
    field: "rotateX",
    patchIn: "element",
    defaultValue: 0,
    range: [-3600, 3600],
    precision: 2,
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "°", decimals: 2 },
    editing: { kind: "scrub", step: 1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "rotateY",
    label: "Tilt Y",
    short: "Tilt Y",
    category: "transform",
    value: "number",
    unit: "degrees",
    description: "Tilt in 3D around the vertical axis: positive swings the right edge away from the viewer",
    field: "rotateY",
    patchIn: "element",
    defaultValue: 0,
    range: [-3600, 3600],
    precision: 2,
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "°", decimals: 2 },
    editing: { kind: "scrub", step: 1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "depth",
    label: "Depth",
    short: "Depth",
    category: "transform",
    value: "number",
    unit: "designUnits",
    // Only a tilted element reads it: it is the viewer's distance from the plane the tilt turns in.
    description: "How far the viewer is from a tilted element, in pixels at 1080p (smaller is a stronger perspective; 1200 by default)",
    field: "depth",
    patchIn: "element",
    defaultValue: DEFAULT_DEPTH,
    range: [100, 20000],
    precision: 0,
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "px", decimals: 0 },
    editing: { kind: "scrub", step: 20 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "width",
    label: "Width",
    short: "W",
    category: "transform",
    value: "number",
    unit: "percentOfFrame",
    description: "Width, % of the frame width",
    field: "width",
    patchIn: "element",
    // Unset means "from its content": the editor keys the size it renders at, so a width keyframe always has a value.
    defaultValue: null,
    range: [0.5, 400],
    precision: 2,
    interpolation: "number",
    defaultEasing: "linear",
    elements: SIZED_WIDTH,
    display: { factor: 1, suffix: "%", decimals: 2 },
    editing: { kind: "scrub", step: 0.1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "height",
    label: "Height",
    short: "H",
    category: "transform",
    value: "number",
    unit: "percentOfFrame",
    description: "Height, % of the frame height",
    field: "height",
    patchIn: "element",
    defaultValue: null,
    range: [0.5, 400],
    precision: 2,
    interpolation: "number",
    defaultEasing: "linear",
    elements: SIZED_HEIGHT,
    display: { factor: 1, suffix: "%", decimals: 2 },
    editing: { kind: "scrub", step: 0.1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "pathProgress",
    label: "Path progress",
    short: "Path",
    category: "path",
    value: "number",
    unit: "fraction",
    description: "How far along its motion path it has travelled (0 = the start, 1 = the end)",
    field: "pathProgress",
    patchIn: "element",
    defaultValue: 0,
    range: [0, 1],
    precision: 4,
    renderRange: [0, 1],
    interpolation: "number",
    defaultEasing: "linear",
    elements: POSITIONED,
    requires: "motionPath",
    display: { factor: 100, suffix: "%", decimals: 1 },
    editing: { kind: "slider", step: 0.005 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "opacity",
    label: "Opacity",
    short: "Opacity",
    category: "appearance",
    value: "number",
    unit: "fraction",
    description: "Opacity (0 = invisible, 1 = solid)",
    field: "opacity",
    patchIn: "element",
    defaultValue: 1,
    range: [0, 1],
    precision: 3,
    renderRange: [0, 1],
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 100, suffix: "%", decimals: 0 },
    editing: { kind: "slider", step: 0.01 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "color",
    label: "Color",
    short: "Color",
    category: "appearance",
    value: "color",
    unit: "color",
    description: "Its own color — the text, stroke or fill its renderer draws with",
    field: "color",
    patchIn: "props",
    // Unset means the design system's color for that role; the editor keys the color it renders as.
    defaultValue: null,
    precision: 0,
    interpolation: "oklab",
    defaultEasing: "linear",
    elements: COLORED,
    display: { factor: 1, suffix: "", decimals: 0 },
    editing: { kind: "color", step: 1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "background",
    label: "Fill",
    short: "Fill",
    category: "appearance",
    value: "color",
    unit: "color",
    description: "The surface color behind it",
    field: "style.background",
    patchIn: "style",
    defaultValue: null,
    precision: 0,
    interpolation: "oklab",
    defaultEasing: "linear",
    elements: { only: ["card", "cards", "image", "video", "button"] },
    display: { factor: 1, suffix: "", decimals: 0 },
    editing: { kind: "color", step: 1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "radius",
    label: "Radius",
    short: "Rad",
    category: "appearance",
    value: "number",
    unit: "designUnits",
    description: "Corner radius in design units",
    field: "radius",
    patchIn: "props",
    defaultValue: null,
    designDefault: "radius",
    range: [0, 2000],
    precision: 1,
    interpolation: "number",
    defaultEasing: "linear",
    elements: { only: ["rect", "image", "video"] },
    display: { factor: 1, suffix: "px", decimals: 0 },
    editing: { kind: "scrub", step: 1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "borderWidth",
    label: "Border width",
    short: "Border",
    category: "appearance",
    value: "number",
    unit: "designUnits",
    description: "Border thickness in design units",
    field: "style.borderWidth",
    patchIn: "style",
    defaultValue: null,
    designDefault: "borderWidth",
    range: [0, 40],
    precision: 2,
    interpolation: "number",
    defaultEasing: "linear",
    elements: { only: ["card", "cards", "rect", "image", "video"] },
    display: { factor: 1, suffix: "px", decimals: 1 },
    editing: { kind: "scrub", step: 0.5 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "strokeWidth",
    label: "Stroke",
    short: "Stroke",
    category: "appearance",
    value: "number",
    unit: "designUnits",
    description: "Stroke thickness in design units",
    field: "strokeWidth",
    patchIn: "props",
    defaultValue: null,
    range: [0.5, 100],
    precision: 2,
    interpolation: "number",
    defaultEasing: "linear",
    elements: { only: ["line", "circle", "rect"] },
    display: { factor: 1, suffix: "px", decimals: 1 },
    editing: { kind: "scrub", step: 0.5 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "blur",
    label: "Glass blur",
    short: "Blur",
    category: "appearance",
    value: "number",
    unit: "designUnits",
    description: "How far the glass behind it blurs (glass surfaces only)",
    field: "style.blur",
    patchIn: "style",
    defaultValue: 24,
    range: [0, 200],
    precision: 1,
    interpolation: "number",
    defaultEasing: "linear",
    elements: { only: ["card", "cards", "rect"] },
    display: { factor: 1, suffix: "px", decimals: 0 },
    editing: { kind: "scrub", step: 1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "size",
    label: "Size",
    short: "Size",
    category: "typography",
    value: "number",
    unit: "designUnits",
    description: "Its drawn size in design units",
    field: "size",
    patchIn: "props",
    defaultValue: null,
    range: [1, 1200],
    precision: 1,
    interpolation: "number",
    defaultEasing: "linear",
    // Only types whose size doesn't re-wrap text: a badge, counter, caption or logo sets its own type
    // size, and circles, icons and progress are drawn at that size.
    elements: SIZED_PX,
    display: { factor: 1, suffix: "px", decimals: 0 },
    editing: { kind: "scrub", step: 1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "letterSpacing",
    label: "Letter spacing",
    short: "Track",
    category: "typography",
    value: "number",
    unit: "em",
    // Spacing changes the width of a line, so a long headline can re-wrap while it animates — the
    // preview shows it happening, and a short line or a wide max width avoids it.
    description: "Space between letters, in em (wide spacing can re-wrap a long line)",
    field: "letterSpacing",
    patchIn: "props",
    defaultValue: null,
    range: [-0.2, 1],
    precision: 3,
    interpolation: "number",
    defaultEasing: "linear",
    elements: { only: ["text"] },
    display: { factor: 1, suffix: "em", decimals: 3 },
    editing: { kind: "scrub", step: 0.01 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "from",
    label: "Start point",
    short: "From",
    category: "transform",
    value: "point",
    unit: "percentOfFrame",
    description: "Where the line starts, in % of the frame",
    axis: "both",
    field: "from",
    patchIn: "props",
    defaultValue: null,
    range: [-100, 200],
    precision: 2,
    interpolation: "point",
    defaultEasing: "linear",
    elements: { only: ["line"] },
    display: { factor: 1, suffix: "%", decimals: 1 },
    editing: { kind: "point", step: 0.5 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "to",
    label: "End point",
    short: "To",
    category: "transform",
    value: "point",
    unit: "percentOfFrame",
    description: "Where the line ends, in % of the frame",
    axis: "both",
    field: "to",
    patchIn: "props",
    defaultValue: null,
    range: [-100, 200],
    precision: 2,
    interpolation: "point",
    defaultEasing: "linear",
    elements: { only: ["line"] },
    display: { factor: 1, suffix: "%", decimals: 1 },
    editing: { kind: "point", step: 0.5 },
    timeline: true,
    status: "enabled",
  },
  // Compositing (src/remotion/engine/compositing.ts): effects and the clip shape, on every element.
  {
    id: "effectBlur",
    label: "Blur",
    short: "Blur",
    category: "compositing",
    value: "number",
    unit: "designUnits",
    description: "How much the element itself is blurred (Glass blur blurs what is behind it instead)",
    field: "effects.blur",
    patchIn: "effects",
    defaultValue: 0,
    range: [0, 100],
    precision: 2,
    renderRange: [0, 100],
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "px", decimals: 1 },
    editing: { kind: "scrub", step: 0.5 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "glow",
    label: "Glow",
    short: "Glow",
    category: "compositing",
    value: "number",
    unit: "designUnits",
    description: "Radius of the glow around its shape",
    field: "effects.glow",
    patchIn: "effects",
    defaultValue: 0,
    range: [0, 100],
    precision: 2,
    renderRange: [0, 100],
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "px", decimals: 1 },
    editing: { kind: "scrub", step: 0.5 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "glowColor",
    label: "Glow color",
    short: "Glow c",
    category: "compositing",
    value: "color",
    unit: "color",
    description: "Colour of the glow (unset: the design system's primary)",
    field: "effects.glowColor",
    patchIn: "effects",
    defaultValue: null,
    precision: 0,
    interpolation: "oklab",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "", decimals: 0 },
    editing: { kind: "color", step: 1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "shadowX",
    label: "Shadow X",
    short: "Sh X",
    category: "compositing",
    value: "number",
    unit: "designUnits",
    description: "How far the drop shadow sits to the right of its shape",
    field: "effects.shadowX",
    patchIn: "effects",
    defaultValue: 0,
    range: [-100, 100],
    precision: 2,
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "px", decimals: 1 },
    editing: { kind: "scrub", step: 0.5 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "shadowY",
    label: "Shadow Y",
    short: "Sh Y",
    category: "compositing",
    value: "number",
    unit: "designUnits",
    description: "How far the drop shadow sits below its shape",
    field: "effects.shadowY",
    patchIn: "effects",
    defaultValue: 0,
    range: [-100, 100],
    precision: 2,
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "px", decimals: 1 },
    editing: { kind: "scrub", step: 0.5 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "shadowBlur",
    label: "Shadow blur",
    short: "Sh blur",
    category: "compositing",
    value: "number",
    unit: "designUnits",
    description: "How soft the drop shadow is",
    field: "effects.shadowBlur",
    patchIn: "effects",
    defaultValue: 0,
    range: [0, 100],
    precision: 2,
    renderRange: [0, 100],
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "px", decimals: 1 },
    editing: { kind: "scrub", step: 0.5 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "shadowColor",
    label: "Shadow color",
    short: "Sh c",
    category: "compositing",
    value: "color",
    unit: "color",
    description: "Colour of the drop shadow",
    field: "effects.shadowColor",
    patchIn: "effects",
    defaultValue: "#000000",
    precision: 0,
    interpolation: "oklab",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 1, suffix: "", decimals: 0 },
    editing: { kind: "color", step: 1 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "brightness",
    label: "Brightness",
    short: "Bright",
    category: "compositing",
    value: "number",
    unit: "multiplier",
    description: "Brightness (1 leaves it alone)",
    field: "effects.brightness",
    patchIn: "effects",
    defaultValue: 1,
    range: [0, 4],
    precision: 3,
    renderRange: [0, 4],
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 100, suffix: "%", decimals: 0 },
    editing: { kind: "slider", step: 0.01 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "contrast",
    label: "Contrast",
    short: "Contr",
    category: "compositing",
    value: "number",
    unit: "multiplier",
    description: "Contrast (1 leaves it alone)",
    field: "effects.contrast",
    patchIn: "effects",
    defaultValue: 1,
    range: [0, 4],
    precision: 3,
    renderRange: [0, 4],
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 100, suffix: "%", decimals: 0 },
    editing: { kind: "slider", step: 0.01 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "saturate",
    label: "Saturation",
    short: "Sat",
    category: "compositing",
    value: "number",
    unit: "multiplier",
    description: "Colour saturation (1 leaves it alone, 0 is greyscale)",
    field: "effects.saturate",
    patchIn: "effects",
    defaultValue: 1,
    range: [0, 4],
    precision: 3,
    renderRange: [0, 4],
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    display: { factor: 100, suffix: "%", decimals: 0 },
    editing: { kind: "slider", step: 0.01 },
    timeline: true,
    status: "enabled",
  },
  {
    id: "clipProgress",
    label: "Clip reveal",
    short: "Reveal",
    category: "compositing",
    value: "number",
    unit: "fraction",
    description: "How far the clip is open (0 hidden, 1 fully revealed) — needs a clip with a reveal direction",
    field: "clip.progress",
    patchIn: "clip",
    defaultValue: 1,
    range: [0, 1],
    precision: 3,
    renderRange: [0, 1],
    interpolation: "number",
    defaultEasing: "linear",
    elements: "all",
    requires: "clip",
    display: { factor: 100, suffix: "%", decimals: 0 },
    editing: { kind: "slider", step: 0.01 },
    timeline: true,
    status: "enabled",
  },
  // Described, not animatable.
  {
    id: "weight",
    label: "Font weight",
    short: "Weight",
    category: "typography",
    value: "number",
    unit: "designUnits",
    description: "How heavy the type is",
    field: "weight",
    patchIn: "props",
    defaultValue: null,
    range: [100, 900],
    precision: 0,
    interpolation: "number",
    defaultEasing: "linear",
    elements: { only: ["text", "kinetic"] },
    display: { factor: 1, suffix: "", decimals: 0 },
    editing: { kind: "scrub", step: 100 },
    timeline: true,
    status: "planned",
    blocked: "Only the weights a font actually loads can render, so an animated weight steps between them instead of sliding. It needs variable-font loading in engine/fonts.ts first.",
  },
] as const satisfies readonly AnimatableProperty[];

/** The id of every property described here, enabled or planned. */
export type AnimatablePropertyId = (typeof DEFINITIONS)[number]["id"];

/** The definitions, in the editor's order — enabled and planned. */
export const ANIMATABLE_PROPERTIES: readonly AnimatableProperty[] = DEFINITIONS;

const ENABLED: readonly AnimatableProperty[] = ANIMATABLE_PROPERTIES.filter((p) => p.status === "enabled");

const BY_ID = new Map<string, AnimatableProperty>(ANIMATABLE_PROPERTIES.map((p) => [p.id, p]));

/** The definition of an animatable property. */
export function animatableProperty(id: KeyframeProperty): AnimatableProperty {
  return BY_ID.get(id)!;
}

/** The definition of an animatable property named at runtime (a CLI argument, a stored keyframe), or null when it isn't one. */
export function findKeyframeProperty(id: string): AnimatableProperty | null {
  const property = BY_ID.get(id);
  return property && property.status === "enabled" ? property : null;
}

function supports(property: AnimatableProperty, type: ElementType): boolean {
  if (property.elements === "all") return true;
  return "only" in property.elements ? property.elements.only.includes(type) : !property.elements.except.includes(type);
}

const forType = new Map<ElementType, readonly KeyframeProperty[]>();

/**
 * The properties an element type's renderer applies keyframes to, in the editor's order — what a
 * keyframe's `property` may be on it. Everything that offers, validates or resolves keyframes asks this.
 * Properties that need something the element may not have (a motion path) are included: `requires` says
 * so, and the editor hides them until it does.
 */
export function keyframePropertiesFor(type: ElementType): readonly KeyframeProperty[] {
  let list = forType.get(type);
  if (!list) {
    list = ENABLED.filter((p) => supports(p, type)).map((p) => p.id) as readonly KeyframeProperty[];
    forType.set(type, list);
  }
  return list;
}

/** The same list without properties the element isn't set up for yet (path progress without a path). */
export function availableProperties(element: { type: ElementType; motionPath?: unknown; clip?: unknown }): readonly KeyframeProperty[] {
  const all = keyframePropertiesFor(element.type);
  return all.filter((id) => {
    const requires = animatableProperty(id).requires;
    return !requires || (requires === "motionPath" ? !!element.motionPath : !!element.clip);
  });
}

const BY_PATCH = new Map<string, AnimatableProperty>(
  ENABLED.map((p) => [`${p.patchIn}:${p.field.includes(".") ? p.field.slice(p.field.indexOf(".") + 1) : p.field}`, p]),
);

/**
 * The property an inspector control edits, from where its patch writes: `propBinding("radius")` is
 * ("props", "radius"), a style control is ("style", "blur"). Lets every existing control show its
 * animated value and save a keyframe without knowing the registry itself.
 */
export function propertyForPatch(patchIn: AnimatableProperty["patchIn"], key: string): AnimatableProperty | null {
  return BY_PATCH.get(`${patchIn}:${key}`) ?? null;
}

export function supportsKeyframeProperty(type: ElementType, id: string): id is KeyframeProperty {
  return (keyframePropertiesFor(type) as readonly string[]).includes(id);
}

/** Why an element type can't animate a property, or null when it can. */
export function propertySupportIssue(type: ElementType, id: string): string | null {
  if (supportsKeyframeProperty(type, id)) return null;
  const supported = keyframePropertiesFor(type);
  return `${type} elements can't keyframe ${id} — they animate ${supported.join(", ")}`;
}

/** Why a value can't be stored for a property, or null when it can. Its value type decides. */
export function propertyValueIssue(id: KeyframeProperty, value: unknown): string | null {
  const property = animatableProperty(id);
  return valueOps(property).issue(value, property);
}

/** A value as it is stored: inside the property's range, kept to its precision. */
export function clampPropertyValue(id: KeyframeProperty, value: KeyframeValue): KeyframeValue {
  const property = animatableProperty(id);
  return valueOps(property).clamp(value as never, property);
}

/** A resolved value as the renderer takes it: eased curves may overshoot, `renderRange` says how far. */
export function renderPropertyValue(id: KeyframeProperty, value: KeyframeValue): KeyframeValue {
  const property = animatableProperty(id);
  return valueOps(property).render(value as never, property);
}

/**
 * The value the renderer uses when the property is neither animated nor set on the element. Some
 * defaults live in the design system (`designDefault`) or in the element's own size, so pass the design
 * system where one is known; without it a property that has no fixed default falls back to a blank value.
 */
export function propertyDefault(id: KeyframeProperty, design?: DesignSystem): KeyframeValue {
  const property = animatableProperty(id);
  if (property.defaultValue !== null) return property.defaultValue;
  if (property.designDefault && design) {
    const value = design.shape[property.designDefault];
    if (typeof value === "number") return value;
  }
  return VALUE_TYPES[property.value].blank(property);
}

/** True when the property has no value of its own until the editor or the CLI gives it one. */
export const propertyNeedsValue = (id: KeyframeProperty): boolean => animatableProperty(id).defaultValue === null;

/**
 * A value as the editor, the timeline and the CLI write it: in the property's display units with its
 * suffix (opacity as a percentage). `exact` keeps every stored decimal instead of the shown ones.
 */
export function formatPropertyValue(id: KeyframeProperty, value: KeyframeValue, exact = false): string {
  const property = animatableProperty(id);
  return valueOps(property).format(value as never, property, exact);
}
