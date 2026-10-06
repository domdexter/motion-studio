import { z } from "zod";
import { SceneCreativeSchema } from "../creative/schema";
import { AssetRequirementSchema, VisualTypeSchema } from "./enums";

/**
 * Schemas for the editable files in projects/<id>/.project/ that Claude Code may change
 * directly. Timing, lock and approval fields are READ-ONLY in files: they are ignored on
 * import (with a warning) — use the CLI for explicit timing changes.
 */

export const SCENE_KEY_RE = /^scene_\d{2,3}$/;

export const StoryboardFileSceneSchema = z.looseObject({
  uid: z.string().optional(),
  sceneId: z.string().regex(SCENE_KEY_RE, 'sceneId must look like "scene_01"'),
  name: z.string().min(1).max(120).optional(),
  visualConcept: z.string().max(4000).optional(),
  visualType: VisualTypeSchema.optional(),
  animation: z.array(z.string().max(500)).max(30).optional(),
  onScreenText: z.string().max(600).optional(),
  assetsRequired: z.array(AssetRequirementSchema).max(20).optional(),
  notes: z.string().max(8000).optional(),
  /** Scene creative intent (see CREATIVE_SYSTEM.md). null clears it. */
  creative: SceneCreativeSchema.nullable().optional(),
});
export type StoryboardFileScene = z.infer<typeof StoryboardFileSceneSchema>;

export const StoryboardFileSchema = z.looseObject({
  scenes: z.array(StoryboardFileSceneSchema),
});

/** Keys in a scenes.json entry that are metadata rather than part of the SceneSpec. */
export const SCENE_META_KEYS = ["uid", "id", "name", "start", "end", "duration", "locked", "status", "timingMode", "voiceText"] as const;

export const ScenesFileEntrySchema = z.looseObject({
  uid: z.string().optional(),
  id: z.string().regex(SCENE_KEY_RE, 'id must look like "scene_01"'),
});

export const ScenesFileSchema = z.looseObject({
  scenes: z.array(ScenesFileEntrySchema),
});

/** Splits a flat scenes.json entry into its SceneSpec part (validated separately). */
export function specPartOfScenesEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const spec: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!(SCENE_META_KEYS as readonly string[]).includes(key)) spec[key] = value;
  }
  return spec;
}
