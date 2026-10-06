import { z } from "zod";
import { slugify } from "../util/text";

export const FORMAT_PRESET_IDS = ["landscape_16_9", "vertical_9_16", "square_1_1", "portrait_4_5", "custom"] as const;
export const FormatPresetIdSchema = z.enum(FORMAT_PRESET_IDS);
export type FormatPresetId = z.infer<typeof FormatPresetIdSchema>;

export interface FormatPreset {
  id: Exclude<FormatPresetId, "custom">;
  label: string;
  aspect: string;
  width: number;
  height: number;
  hint: string;
}

export const FORMAT_PRESETS: FormatPreset[] = [
  { id: "landscape_16_9", label: "Landscape", aspect: "16:9", width: 1920, height: 1080, hint: "YouTube · web · presentations" },
  { id: "vertical_9_16", label: "Vertical", aspect: "9:16", width: 1080, height: 1920, hint: "TikTok · Reels · Shorts" },
  { id: "square_1_1", label: "Square", aspect: "1:1", width: 1080, height: 1080, hint: "Feed posts" },
  { id: "portrait_4_5", label: "Portrait", aspect: "4:5", width: 1080, height: 1350, hint: "Instagram feed" },
];

export const FPS_OPTIONS = [24, 25, 30, 60] as const;
export const FpsSchema = z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]);

export interface RenderPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const RENDER_PRESETS: RenderPreset[] = [
  { id: "youtube", label: "YouTube", width: 1920, height: 1080 },
  { id: "tiktok", label: "TikTok / Reels / Shorts", width: 1080, height: 1920 },
  { id: "instagram_feed", label: "Instagram Feed", width: 1080, height: 1350 },
  { id: "square", label: "Square", width: 1080, height: 1080 },
];

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const KNOWN_RATIOS: [number, string][] = [
  [16 / 9, "16:9"],
  [9 / 16, "9:16"],
  [1, "1:1"],
  [4 / 5, "4:5"],
  [5 / 4, "5:4"],
  [4 / 3, "4:3"],
  [3 / 4, "3:4"],
  [21 / 9, "21:9"],
  [2 / 3, "2:3"],
  [3 / 2, "3:2"],
];

/**
 * Render file name without extension, named after the project so files on disk and downloads are
 * recognisable: "incep-platform-launch-film-v7-final", "…-v8-scene-03", "…-v9-range-15.4s-30.4s",
 * plus "-1080x1920" when the size differs from the project format. Only [a-z0-9.-] characters.
 */
export function renderFileStem(input: {
  projectName: string;
  version: number;
  kind: "final" | "preview" | "scene" | "range";
  sceneKey?: string | null;
  startSec?: number;
  endSec?: number;
  size?: { width: number; height: number } | null;
}): string {
  const sec = (s: number | undefined) => `${Number(Math.max(0, s ?? 0).toFixed(1))}s`;
  const kind = input.kind === "scene" ? slugify(input.sceneKey ?? "scene") : input.kind === "range" ? `range-${sec(input.startSec)}-${sec(input.endSec)}` : input.kind;
  const parts = [slugify(input.projectName, 60), `v${Math.max(1, Math.floor(input.version))}`, kind];
  if (input.size) parts.push(`${Math.round(input.size.width)}x${Math.round(input.size.height)}`);
  return parts.join("-");
}

export function aspectRatioLabel(width: number, height: number): string {
  if (!width || !height) return "—";
  const ratio = width / height;
  for (const [r, label] of KNOWN_RATIOS) {
    if (Math.abs(ratio - r) < 0.01) return label;
  }
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

export function presetForDimensions(width: number, height: number): FormatPresetId {
  return FORMAT_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? "custom";
}

export function isPortrait(width: number, height: number): boolean {
  return height > width;
}

/** H.264 + yuv420p requires even dimensions. Returns an error message or null. */
export function validateDimensions(width: number, height: number): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return "Width and height must be whole numbers.";
  if (width < 144 || height < 144) return "Minimum size is 144 px.";
  if (width > 4320 || height > 4320) return "Maximum size is 4320 px.";
  if (width % 2 !== 0 || height % 2 !== 0) return "Width and height must be even numbers (required by H.264).";
  return null;
}

/** Scales a render size to the project's aspect ratio when the preset's ratio differs. */
export function sameAspect(aw: number, ah: number, bw: number, bh: number): boolean {
  return Math.abs(aw / ah - bw / bh) < 0.01;
}
