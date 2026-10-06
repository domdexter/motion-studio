import { ENTER_ANIMATIONS, ElementSchema, type ElementType, type SceneElement } from "./scene";

/**
 * What the editor can change on each element type, taken from what the Remotion renderer actually
 * reads: element families (how the inspector groups its controls), the `style` keys each renderer
 * honours, the entrances that do something for a type, and the fields that make up an element's look
 * or its typography (so resets and "paste appearance" touch only those). An unset field falls back to
 * the renderer's default, so resetting a field means removing it.
 */

export type ElementFamily = "text" | "shape" | "data" | "card" | "device" | "ui" | "media" | "brand" | "group";

export const ELEMENT_FAMILY: Record<ElementType, ElementFamily> = {
  text: "text",
  kinetic: "text",
  captions: "text",
  badge: "text",
  line: "shape",
  circle: "shape",
  rect: "shape",
  grid: "shape",
  progress: "shape",
  chart: "data",
  counter: "data",
  diagram: "data",
  list: "data",
  card: "card",
  cards: "card",
  browser: "device",
  phone: "device",
  desktop: "device",
  dashboard: "device",
  button: "ui",
  notification: "ui",
  cursor: "ui",
  image: "media",
  video: "media",
  logo: "brand",
  icon: "brand",
  group: "group",
};

export const ELEMENT_TYPE_LABELS: Record<ElementType, string> = {
  text: "Text",
  kinetic: "Kinetic text",
  captions: "Captions",
  badge: "Badge",
  card: "Card",
  cards: "Cards",
  browser: "Browser",
  phone: "Phone",
  desktop: "Desktop",
  dashboard: "Dashboard",
  button: "Button",
  notification: "Notification",
  cursor: "Cursor",
  line: "Line",
  circle: "Circle",
  rect: "Rectangle",
  grid: "Grid",
  progress: "Progress",
  chart: "Chart",
  counter: "Counter",
  diagram: "Diagram",
  icon: "Icon",
  list: "List",
  image: "Image",
  video: "Video",
  logo: "Logo",
  group: "Group",
};

export const STYLE_KEYS = ["color", "background", "borderColor", "borderWidth", "radius", "shadow", "blur", "padding", "glass"] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];
export const SHADOW_KINDS = ["none", "soft", "medium", "deep", "glow"] as const;

const SURFACE: readonly StyleKey[] = ["background", "borderColor", "borderWidth", "radius", "shadow", "glass", "blur", "padding"];
const NONE: readonly StyleKey[] = [];

/**
 * `style` keys each renderer reads. Cards use the shared surface style; a filled rectangle uses its
 * border, shadow and glass (its own `color` and `radius` win); images and videos draw a border only
 * with a border color; buttons, notifications and dashboards read `style.color` as their accent.
 */
export const STYLE_SUPPORT: Record<ElementType, readonly StyleKey[]> = {
  card: SURFACE,
  cards: SURFACE,
  rect: ["borderColor", "borderWidth", "shadow", "glass", "blur"],
  image: ["background", "borderColor", "borderWidth", "shadow"],
  video: ["background", "borderColor", "borderWidth", "shadow"],
  button: ["background", "color", "radius"],
  notification: ["color"],
  dashboard: ["color"],
  text: NONE,
  kinetic: NONE,
  captions: NONE,
  badge: NONE,
  browser: NONE,
  phone: NONE,
  desktop: NONE,
  cursor: NONE,
  line: NONE,
  circle: NONE,
  grid: NONE,
  progress: NONE,
  chart: NONE,
  counter: NONE,
  diagram: NONE,
  icon: NONE,
  list: NONE,
  logo: NONE,
  // A group is a layer, not a surface: its look comes from its children.
  group: NONE,
};

/** What a `style` key means on a type, where it isn't the obvious name. */
export function styleLabel(type: ElementType, key: StyleKey): string {
  if (type === "button" && key === "background") return "Button color";
  if (type === "button" && key === "color") return "Label color";
  if (key === "color") return "Accent";
  return { background: "Fill", borderColor: "Border", borderWidth: "Border width", radius: "Radius", shadow: "Shadow", blur: "Glass blur", padding: "Padding", glass: "Glass" }[key] ?? key;
}

type EnterType = (typeof ENTER_ANIMATIONS)[number];
const TEXT_REVEALS = new Set<string>(["wordReveal", "charReveal", "typewriter", "mask"]);
const DRAWN = new Set<ElementType>(["line", "circle", "rect"]);

/** Entrances that animate this type: text reveals only render on text, "draw" only on lines, circles and rectangles. */
export function entrancesFor(type: ElementType): EnterType[] {
  return ENTER_ANIMATIONS.filter((t) => t !== "none" && (TEXT_REVEALS.has(t) ? type === "text" : t === "draw" ? DRAWN.has(type) : true));
}

/** Entrances and exits whose travel distance can be set. */
export const TRAVEL_ENTRANCES = new Set<string>(["rise", "slideUp", "slideDown", "slideLeft", "slideRight"]);
export const TRAVEL_EXITS = new Set<string>(["slideUp", "slideDown", "slideLeft", "slideRight"]);

/** True when the entrance staggers parts of the element (words, characters, items, bars). */
export function usesStagger(el: SceneElement): boolean {
  const type = el.enter?.type;
  if (el.type === "text") return type === "wordReveal" || type === "charReveal" || type === "mask";
  return el.type === "cards" || el.type === "list" || el.type === "diagram" || (el.type === "chart" && el.kind === "bar");
}

/**
 * How an element's size is set, from what its renderer reads: a full box (width and height), a width
 * only, a max width it wraps at, one drawn size in design units, or nothing (it sizes to its content).
 * The editor's size fields and the animatable property registry both follow this.
 */
export type SizeMode = "box" | "width" | "maxWidth" | "size" | "none";

const SIZE_MODES: Partial<Record<ElementType, SizeMode>> = {
  // Text wraps at its max width; the box follows the text.
  text: "maxWidth",
  kinetic: "maxWidth",
  // Only the width is read.
  desktop: "width",
  notification: "width",
  list: "width",
  // Drawn at a size in pixels.
  circle: "size",
  icon: "size",
  // Sized by their content (font size, button size).
  counter: "none",
  badge: "none",
  button: "none",
  logo: "none",
  captions: "none",
  cursor: "none",
  line: "none",
  // A group is a layer the size of the frame: its children keep their own sizes.
  group: "none",
};

export function sizeModeOf(el: SceneElement): SizeMode {
  if (el.type === "progress") return el.variant === "ring" ? "size" : "width";
  return SIZE_MODES[el.type] ?? "box";
}

/** The same by type alone — a progress bar reads a width, a progress ring a size, so it counts as both. */
export function sizeModesOfType(type: ElementType): readonly SizeMode[] {
  if (type === "progress") return ["width", "size"];
  return [SIZE_MODES[type] ?? "box"];
}

/** Fields (besides opacity and `style`) that make up a type's look. None of them is required. */
export const APPEARANCE_PROPS: Partial<Record<ElementType, readonly string[]>> = {
  rect: ["color", "fill", "strokeWidth", "radius"],
  circle: ["color", "fill", "strokeWidth"],
  line: ["color", "strokeWidth", "dashed", "arrow"],
  grid: ["color", "variant", "spacing", "perspective"],
  progress: ["color", "variant"],
  icon: ["color", "container", "strokeWidth"],
  image: ["radius", "mask"],
  video: ["radius"],
  card: ["variant", "accent"],
  cards: ["variant", "accent"],
  badge: ["variant"],
  button: ["variant", "size"],
  notification: ["variant"],
  chart: ["color"],
  diagram: ["color"],
  browser: ["theme"],
  phone: ["theme"],
  desktop: ["theme", "device"],
  dashboard: ["theme"],
  logo: ["variant", "color"],
  captions: ["variant", "position"],
  cursor: ["variant"],
};

/** Typography fields of the types that set type. None of them is required. */
export const TYPOGRAPHY_PROPS: Partial<Record<ElementType, readonly string[]>> = {
  text: ["role", "font", "size", "weight", "color", "align", "lineHeight", "letterSpacing", "transform", "maxWidth", "gradient"],
  kinetic: ["font", "size", "weight", "color", "activeColor", "align", "transform", "maxWidth"],
  badge: ["size", "color"],
  counter: ["size", "color"],
  list: ["size", "color", "gap"],
  captions: ["size"],
  logo: ["size"],
};

/** Fields that are layout, motion or common to every element — edited through their own patch fields, not as type properties. */
const COMMON_KEYS = new Set(["type", "id", "blend", "effects", "clip", "x", "y", "width", "height", "anchor", "rotation", "scale", "scaleX", "scaleY", "pivot", "rotateX", "rotateY", "depth", "opacity", "z", "enter", "exit", "emphasis", "keyframes", "motionPath", "pathProgress", "idle", "motionRole", "motionIntent", "style", "notes"]);
/** Image and video settings owned by the scene media service (trim, speed, audio, darkening, zooms, picture edits). */
const MEDIA_SERVICE_KEYS = new Set(["assetId", "fit", "startFrom", "endAt", "playbackRate", "volume", "duckUnderVoice", "loop", "overlay", "zooms", "crop", "speedSegments", "annotations"]);

const SCHEMA_KEYS = new Map<string, string[]>(ElementSchema.options.map((o) => [o.shape.type.value, Object.keys(o.shape)]));

/** The type-specific fields of an element type that can be set as properties (validated by the scene spec schema). */
export function elementPropertyKeys(type: ElementType): string[] {
  const media = type === "image" || type === "video";
  return (SCHEMA_KEYS.get(type) ?? []).filter((key) => !COMMON_KEYS.has(key) && !(media && MEDIA_SERVICE_KEYS.has(key)));
}
