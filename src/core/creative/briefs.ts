import type { AssetBrief, AssetConsistency } from "./schema";

/**
 * Composition-aware generation brief. Deterministically merges an asset request's creative brief
 * with the project's asset consistency context, so every generated image/video serves its
 * composition and belongs to the same campaign. The result is what the generator should follow.
 */
export function composeGenerationBrief(input: {
  kind: "image" | "video";
  prompt: string;
  aspectRatio: string;
  purpose?: string;
  styleNotes?: string;
  negativePrompt?: string | null;
  brief: AssetBrief | null;
  consistency: AssetConsistency | null;
}): string {
  const { brief, consistency } = input;
  const lines: string[] = [];
  const line = (label: string, value: string | undefined | null) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  line("Subject", brief?.subject ?? input.prompt);
  if (brief?.subject && brief.subject !== input.prompt) line("Prompt", input.prompt);
  line("Purpose", brief?.purpose ?? input.purpose);
  line("Narrative meaning", brief?.narrativeMeaning);
  line("Format", `${input.kind}, ${input.aspectRatio}`);
  line("Composition", [brief?.composition, brief?.focalPoint ? `focal point ${brief.focalPoint}` : "", brief?.negativeSpace ? `keep negative space ${brief.negativeSpace} (the scene places content there)` : ""].filter(Boolean).join("; ") || consistency?.composition);
  const palette = brief?.palette.length ? brief.palette : (consistency?.palette ?? []);
  if (palette.length) line("Palette", palette.join(", "));
  line("Lighting", brief?.lighting ?? consistency?.lighting);
  line("Style", [brief?.style, consistency?.visualStyle, input.styleNotes].filter(Boolean).join("; "));
  line("Camera", brief?.camera ?? consistency?.camera);
  line("Mood", brief?.mood);
  line("Contrast", consistency?.contrast);
  line("Texture", consistency?.texture);
  line("Subject treatment", consistency?.subjectTreatment);
  line("Environment", consistency?.environment);
  line("Consistency", [brief?.consistencyNotes, consistency?.notes].filter(Boolean).join(" "));
  const avoid = [...new Set([...(brief?.avoid ?? []), ...(consistency?.avoid ?? []), ...(brief?.textInImage ? [] : ["text, letters or logos inside the image"]), ...(input.negativePrompt ? [input.negativePrompt] : [])])];
  if (avoid.length) line("Avoid", avoid.join("; "));
  return lines.join("\n");
}
