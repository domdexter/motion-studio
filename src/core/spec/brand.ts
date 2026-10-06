import { z } from "zod";

/**
 * Brand profile: identity and style direction. Colors and fonts live in the design system
 * (single source of truth for rendering); the brand form edits both.
 */
export const BrandProfileSchema = z.object({
  brandName: z.string().max(120).default(""),
  tagline: z.string().max(240).default(""),
  website: z.string().max(240).default(""),
  logoAssetId: z.string().nullable().default(null),
  typographyNotes: z.string().max(4000).default(""),
  visualStyle: z.string().max(4000).default(""),
  imageStyle: z.string().max(4000).default(""),
  animationStyle: z.string().max(4000).default(""),
  guidelines: z.string().max(20000).default(""),
  referenceAssetIds: z.array(z.string()).default([]),
  brandGuideAssetIds: z.array(z.string()).default([]),
  /** Uploaded brand fonts: family name → font asset. */
  customFonts: z.array(z.object({ family: z.string().min(1), assetId: z.string().min(1) })).default([]),
});
export type BrandProfile = z.infer<typeof BrandProfileSchema>;

export const EMPTY_BRAND: BrandProfile = BrandProfileSchema.parse({});
