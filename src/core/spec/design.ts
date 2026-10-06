import { z } from "zod";
import { BackgroundSchema, ColorSchema, EasingSchema, TransitionSchema } from "./scene";

/**
 * Motion design system. Every scene inherits these tokens unless an element overrides them.
 * Changing the design system (e.g. "playful → premium SaaS") restyles the whole video
 * without touching scene structure or timing.
 */

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a 6-digit hex color like #7C6CFF");

export const DesignColorsSchema = z.strictObject({
  primary: HexColor,
  secondary: HexColor,
  accent: HexColor,
  background: HexColor,
  surface: HexColor,
  text: HexColor,
  muted: HexColor,
  success: HexColor,
  danger: HexColor,
});

export const DesignSystemSchema = z.strictObject({
  preset: z.string().min(1),
  colors: DesignColorsSchema,
  typography: z.strictObject({
    headingFont: z.string().min(1),
    bodyFont: z.string().min(1),
    monoFont: z.string().min(1),
    headingWeight: z.number().int().min(100).max(900),
    bodyWeight: z.number().int().min(100).max(900),
    /** Global type scale multiplier preset. */
    scale: z.enum(["compact", "standard", "large"]),
    /** em */
    headingLetterSpacing: z.number().min(-0.2).max(0.5),
    headingTransform: z.enum(["none", "uppercase"]),
    lineHeight: z.number().min(0.8).max(2),
  }),
  motion: z.strictObject({
    easing: EasingSchema,
    /** Default enter animation duration, seconds. */
    defaultDuration: z.number().min(0.05).max(3),
    /** Default scene transition duration, seconds. */
    transitionDuration: z.number().min(0).max(2),
    /** Default stagger between parts, seconds. */
    stagger: z.number().min(0).max(1),
    /** Scales travel distances and overshoot. */
    intensity: z.enum(["subtle", "standard", "energetic"]),
  }),
  shape: z.strictObject({
    /** Corner radius in u. */
    radius: z.number().min(0).max(200),
    borderWidth: z.number().min(0).max(10),
    shadow: z.enum(["none", "soft", "medium", "deep", "glow"]),
  }),
  background: BackgroundSchema,
  transition: TransitionSchema,
  layout: z.strictObject({
    /** Title-safe margin, percent of the short edge. */
    safeMargin: z.number().min(0).max(25),
  }),
  /** Optional accent palette for charts and multi-item layouts. */
  palette: z.array(ColorSchema).max(8).optional(),
});
export type DesignSystem = z.infer<typeof DesignSystemSchema>;

export const TYPE_SCALE_MULTIPLIER: Record<DesignSystem["typography"]["scale"], number> = {
  compact: 0.86,
  standard: 1,
  large: 1.16,
};

/** Base sizes in u for each text role before the scale multiplier. */
export const TEXT_ROLE_SIZES = {
  display: 150,
  headline: 104,
  title: 76,
  subtitle: 46,
  body: 36,
  caption: 28,
  label: 24,
  eyebrow: 22,
  quote: 58,
} as const;

export const CURATED_FONTS = [
  "Inter",
  "Geist",
  "Manrope",
  "Plus Jakarta Sans",
  "DM Sans",
  "Figtree",
  "Onest",
  "Space Grotesk",
  "Sora",
  "Outfit",
  "Urbanist",
  "Lexend",
  "Poppins",
  "Nunito",
  "Montserrat",
  "Raleway",
  "Rubik",
  "Work Sans",
  "Archivo",
  "IBM Plex Sans",
  "Syne",
  "Mulish",
  "Bricolage Grotesque",
  "Playfair Display",
  "Instrument Serif",
  "DM Serif Display",
  "Fraunces",
  "JetBrains Mono",
  "Nothing You Could Do",
] as const;
