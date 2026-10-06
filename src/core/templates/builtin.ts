import type { SceneElement, SceneSpec } from "../spec/scene";

/**
 * Built-in templates: a title card and a YouTube end screen (whole scenes), and a lower third (a name
 * and title bar added to a scene). Colours and fonts are design tokens, so they follow the project's
 * design system. Pure spec builders shared by the server, the CLI and the editor.
 */

export interface BuiltinTemplate {
  id: string;
  name: string;
  /** scene: replaces a scene's design; elements: added to a scene. */
  kind: "scene" | "elements";
  description: string;
  fields: { key: string; label: string; placeholder: string }[];
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "builtin:title-card",
    name: "Title card",
    kind: "scene",
    description: "A big title with a short kicker above it.",
    fields: [
      { key: "kicker", label: "Kicker", placeholder: "EPISODE 12" },
      { key: "title", label: "Title", placeholder: "Free AI dictation" },
    ],
  },
  {
    id: "builtin:end-screen",
    name: "YouTube end screen",
    kind: "scene",
    description: "A closing line, space for two end-screen videos and a subscribe button, and your link. Add the end-screen elements in YouTube Studio over the empty frames.",
    fields: [
      { key: "title", label: "Closing line", placeholder: "Watch next" },
      { key: "link", label: "Link", placeholder: "clemencekotoku.com" },
    ],
  },
  {
    id: "builtin:lower-third",
    name: "Lower third",
    kind: "elements",
    description: "A name and title bar that slides in and fades out.",
    fields: [
      { key: "name", label: "Name", placeholder: "Clemence Kotoku" },
      { key: "title", label: "Title", placeholder: "Web designer" },
    ],
  },
];

const sceneTime = (seconds: number) => ({ type: "sceneTime" as const, seconds: Math.round(Math.max(0, seconds) * 100) / 100 });

/** A title card scene spec. */
export function titleCardSpec(fields: { title?: string; kicker?: string }): SceneSpec {
  const elements: SceneElement[] = [];
  if (fields.kicker?.trim()) {
    elements.push({ id: "tc_kicker", type: "text", text: fields.kicker.trim().toUpperCase(), x: 50, y: 40, align: "center", size: 30, weight: 700, color: "muted", letterSpacing: 0.18, enter: { type: "fade", at: sceneTime(0.15) } } as SceneElement);
  }
  elements.push({
    id: "tc_title",
    type: "text",
    text: fields.title?.trim() || "Title",
    x: 50,
    y: 52,
    align: "center",
    size: 116,
    weight: 800,
    font: "heading",
    maxWidth: 80,
    lineHeight: 1,
    enter: { type: "wordReveal", at: sceneTime(0.3) },
  } as SceneElement);
  elements.push({ id: "tc_rule", type: "line", from: [44, 64], to: [56, 64], color: "accent", strokeWidth: 5, enter: { type: "draw", at: sceneTime(0.7), duration: 0.6 } } as SceneElement);
  return { version: 1, transitionIn: { type: "fade", duration: 0.4 }, motion: { density: "low" }, elements };
}

/** A YouTube end screen scene spec: two 16:9 frames and a round subscribe spot for YouTube's end-screen elements. */
export function endScreenSpec(fields: { title?: string; link?: string }): SceneSpec {
  const frame = (id: string, x: number): SceneElement[] => [
    { id, type: "rect", x, y: 52, width: 32, height: 32, radius: 20, color: "surface", style: { borderColor: "muted", borderWidth: 2 }, enter: { type: "rise", at: sceneTime(0.4) } } as SceneElement,
    { id: `${id}_label`, type: "text", text: "Next video", x, y: 52, align: "center", size: 26, weight: 600, color: "muted", enter: { type: "fade", at: sceneTime(0.55) } } as SceneElement,
  ];
  return {
    version: 1,
    transitionIn: { type: "fade", duration: 0.4 },
    motion: { density: "low" },
    elements: [
      { id: "es_title", type: "text", text: fields.title?.trim() || "Watch next", x: 50, y: 17, align: "center", size: 72, weight: 800, font: "heading", enter: { type: "rise", at: sceneTime(0.1) } } as SceneElement,
      ...frame("es_video_1", 30),
      ...frame("es_video_2", 70),
      { id: "es_subscribe", type: "circle", x: 50, y: 83, size: 150, fill: true, color: "surface", enter: { type: "pop", at: sceneTime(0.7) } } as SceneElement,
      ...(fields.link?.trim() ? [{ id: "es_link", type: "text", text: fields.link.trim(), x: 50, y: 94, align: "center", size: 28, weight: 600, font: "mono", color: "muted", enter: { type: "fade", at: sceneTime(0.9) } } as SceneElement] : []),
    ],
  };
}

/**
 * Lower third elements: a panel with an accent bar, a name and a title, sliding in at `atSec` (seconds
 * into the scene) and fading out after `durationSec`.
 */
export function lowerThirdElements(fields: { name?: string; title?: string; atSec?: number; durationSec?: number; side?: "left" | "right"; idPrefix?: string }): SceneElement[] {
  const at = fields.atSec ?? 0.5;
  const length = Math.max(1, fields.durationSec ?? 4);
  const side = fields.side ?? "left";
  const id = fields.idPrefix ?? "lt";
  const width = 34;
  const left = side === "left" ? 6 : 94 - width;
  const enter = (delay: number) => ({ type: side === "left" ? ("slideRight" as const) : ("slideLeft" as const), at: sceneTime(at + delay), duration: 0.5 });
  const exit = { type: "fade" as const, duration: 0.35, at: sceneTime(at + length - 0.35) };
  return [
    // Above everything else in the scene (framed videos, cards), so nothing covers the name.
    { id: `${id}_panel`, type: "rect", x: left + width / 2, y: 83, width, height: 12, radius: 14, color: "surface", opacity: 0.96, z: 95, style: { shadow: "soft" }, enter: enter(0), exit } as SceneElement,
    { id: `${id}_bar`, type: "rect", x: left + 0.6, y: 83, width: 0.6, height: 8, radius: 4, color: "accent", z: 96, enter: enter(0.05), exit } as SceneElement,
    { id: `${id}_name`, type: "text", text: fields.name?.trim() || "Name", x: left + 2.4, y: 80.6, anchor: "left", align: "left", size: 40, weight: 700, font: "heading", z: 97, enter: { type: "fade", at: sceneTime(at + 0.2) }, exit } as SceneElement,
    ...(fields.title?.trim() ? [{ id: `${id}_title`, type: "text", text: fields.title.trim(), x: left + 2.4, y: 86.2, anchor: "left", align: "left", size: 26, weight: 500, color: "muted", z: 97, enter: { type: "fade", at: sceneTime(at + 0.3) }, exit } as SceneElement] : []),
  ];
}
