import { z } from "zod";

/**
 * Creative timeline markers (beats, notes, music/SFX cues). They live on the project, sit on
 * the master timeline for orientation, and never alter the voice-over timing.
 */

export const MARKER_KINDS = ["beat", "note", "music", "sfx", "emphasis"] as const;

export const MarkerSchema = z.object({
  id: z.string().min(1).max(40),
  time: z.number().min(0),
  label: z.string().trim().max(120).default(""),
  kind: z.enum(MARKER_KINDS).default("beat"),
});
export type Marker = z.infer<typeof MarkerSchema>;

export const MarkersSchema = z.array(MarkerSchema).max(500);

/** Lenient read of stored markers (invalid data yields an empty list), sorted by time. */
export function parseMarkers(raw: unknown): Marker[] {
  const result = MarkersSchema.safeParse(raw ?? []);
  return result.success ? [...result.data].sort((a, b) => a.time - b.time) : [];
}
