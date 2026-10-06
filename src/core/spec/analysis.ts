import { z } from "zod";
import { VisualTypeSchema } from "./enums";

/**
 * Script analysis. Produced by Claude Code (preferred) or the rule-based analyzer.
 * All timing here is ESTIMATED from word counts — it is never used as actual timing.
 */

export const BEAT_KINDS = ["hook", "problem", "solution", "feature", "benefit", "proof", "cta", "statement"] as const;
export const BeatKindSchema = z.enum(BEAT_KINDS);
export type BeatKind = z.infer<typeof BeatKindSchema>;

export const ScriptBeatSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  kind: BeatKindSchema,
  text: z.string().min(1),
  paragraph: z.number().int().nonnegative(),
  keyStatement: z.string().optional(),
  emphasis: z.array(z.string()).default([]),
  visualOpportunity: z.string().default(""),
  suggestedVisualType: VisualTypeSchema.default("motion_graphic"),
  suggestedAnimation: z.array(z.string()).default([]),
  assetNeeds: z.array(z.object({ kind: z.enum(["image", "video"]), description: z.string().min(1) })).default([]),
  /** ESTIMATED seconds (word count based). */
  estimatedStart: z.number().nonnegative(),
  estimatedEnd: z.number().nonnegative(),
});
export type ScriptBeat = z.infer<typeof ScriptBeatSchema>;

export const ScriptAnalysisSchema = z.object({
  version: z.literal(1).default(1),
  source: z.enum(["rules", "claude"]),
  summary: z.string().default(""),
  tone: z.string().optional(),
  audience: z.string().optional(),
  wordsPerMinute: z.number().positive().default(150),
  /** ESTIMATED total duration in seconds. */
  estimatedDuration: z.number().nonnegative(),
  beats: z.array(ScriptBeatSchema),
  emphasisWords: z.array(z.object({ word: z.string().min(1), reason: z.string(), beat: z.string().optional() })).default([]),
  sceneBoundaries: z
    .array(z.object({ afterText: z.string(), reason: z.string(), estimatedTime: z.number().nonnegative() }))
    .default([]),
});
export type ScriptAnalysis = z.infer<typeof ScriptAnalysisSchema>;
