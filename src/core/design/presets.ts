import type { DesignSystem } from "../spec/design";

export interface DesignPreset {
  id: string;
  label: string;
  description: string;
  design: DesignSystem;
}

const premiumSaas: DesignSystem = {
  preset: "premium_saas",
  colors: {
    primary: "#7C6CFF",
    secondary: "#3DD6F5",
    accent: "#FFB547",
    background: "#07080D",
    surface: "#11131C",
    text: "#F3F4F8",
    muted: "#8C90A3",
    success: "#3DDC97",
    danger: "#FF5C73",
  },
  typography: {
    headingFont: "Inter",
    bodyFont: "Inter",
    monoFont: "JetBrains Mono",
    headingWeight: 700,
    bodyWeight: 400,
    scale: "standard",
    headingLetterSpacing: -0.035,
    headingTransform: "none",
    lineHeight: 1.08,
  },
  motion: { easing: "expoOut", defaultDuration: 0.7, transitionDuration: 0.5, stagger: 0.06, intensity: "subtle" },
  shape: { radius: 22, borderWidth: 1, shadow: "deep" },
  background: { type: "mesh", intensity: 0.32, grain: 0.035, vignette: 0.35 },
  transition: { type: "fade", duration: 0.45 },
  layout: { safeMargin: 7 },
};

const cleanCorporate: DesignSystem = {
  preset: "clean_corporate",
  colors: {
    primary: "#2F6BFF",
    secondary: "#12B5CB",
    accent: "#FF8A3D",
    background: "#F6F7FB",
    surface: "#FFFFFF",
    text: "#0E1525",
    muted: "#5B6478",
    success: "#16A34A",
    danger: "#E5484D",
  },
  typography: {
    headingFont: "Plus Jakarta Sans",
    bodyFont: "Inter",
    monoFont: "JetBrains Mono",
    headingWeight: 700,
    bodyWeight: 400,
    scale: "standard",
    headingLetterSpacing: -0.025,
    headingTransform: "none",
    lineHeight: 1.12,
  },
  motion: { easing: "easeOut", defaultDuration: 0.55, transitionDuration: 0.4, stagger: 0.05, intensity: "standard" },
  shape: { radius: 16, borderWidth: 1, shadow: "soft" },
  background: { type: "grid", variant: "dots", spacing: 44, fade: true, vignette: 0.1 },
  transition: { type: "slide", duration: 0.45, direction: "left" },
  layout: { safeMargin: 7 },
};

const playful: DesignSystem = {
  preset: "playful",
  colors: {
    primary: "#FF5B5B",
    secondary: "#6C5CE7",
    accent: "#FFC93C",
    background: "#FFF6EC",
    surface: "#FFFFFF",
    text: "#1F1A2E",
    muted: "#6B6480",
    success: "#2EC4B6",
    danger: "#E63946",
  },
  typography: {
    headingFont: "Poppins",
    bodyFont: "Nunito",
    monoFont: "JetBrains Mono",
    headingWeight: 700,
    bodyWeight: 500,
    scale: "large",
    headingLetterSpacing: -0.02,
    headingTransform: "none",
    lineHeight: 1.12,
  },
  motion: { easing: "backOut", defaultDuration: 0.6, transitionDuration: 0.45, stagger: 0.08, intensity: "energetic" },
  shape: { radius: 28, borderWidth: 0, shadow: "medium" },
  background: { type: "gradient", colors: ["#FFF6EC", "#FFE1D2"], angle: 135 },
  transition: { type: "scale", duration: 0.45 },
  layout: { safeMargin: 6 },
};

const boldEditorial: DesignSystem = {
  preset: "bold_editorial",
  colors: {
    primary: "#FF4F2E",
    secondary: "#F2EFE9",
    accent: "#D8FF3C",
    background: "#0D0D0D",
    surface: "#1A1A1A",
    text: "#F2EFE9",
    muted: "#8F8A84",
    success: "#7BD389",
    danger: "#FF4F2E",
  },
  typography: {
    headingFont: "Instrument Serif",
    bodyFont: "Inter",
    monoFont: "JetBrains Mono",
    headingWeight: 400,
    bodyWeight: 400,
    scale: "large",
    headingLetterSpacing: -0.02,
    headingTransform: "none",
    lineHeight: 1.0,
  },
  motion: { easing: "expoInOut", defaultDuration: 0.8, transitionDuration: 0.6, stagger: 0.05, intensity: "subtle" },
  shape: { radius: 2, borderWidth: 1, shadow: "none" },
  background: { type: "solid", grain: 0.07, vignette: 0.25 },
  transition: { type: "wipe", duration: 0.6, direction: "left" },
  layout: { safeMargin: 8 },
};

const minimalMono: DesignSystem = {
  preset: "minimal_mono",
  colors: {
    primary: "#111111",
    secondary: "#6E6E73",
    accent: "#FF3B30",
    background: "#FAFAFA",
    surface: "#FFFFFF",
    text: "#111111",
    muted: "#6E6E73",
    success: "#1F9D55",
    danger: "#FF3B30",
  },
  typography: {
    headingFont: "Geist",
    bodyFont: "Geist",
    monoFont: "JetBrains Mono",
    headingWeight: 600,
    bodyWeight: 400,
    scale: "standard",
    headingLetterSpacing: -0.04,
    headingTransform: "none",
    lineHeight: 1.08,
  },
  motion: { easing: "easeInOut", defaultDuration: 0.6, transitionDuration: 0.5, stagger: 0.05, intensity: "subtle" },
  shape: { radius: 12, borderWidth: 1, shadow: "soft" },
  background: { type: "solid" },
  transition: { type: "fade", duration: 0.5 },
  layout: { safeMargin: 8 },
};

const techNeon: DesignSystem = {
  preset: "tech_neon",
  colors: {
    primary: "#22D3EE",
    secondary: "#A78BFA",
    accent: "#34D399",
    background: "#04060D",
    surface: "#0B1020",
    text: "#E6F1FF",
    muted: "#7D8BA6",
    success: "#34D399",
    danger: "#FB7185",
  },
  typography: {
    headingFont: "Space Grotesk",
    bodyFont: "Inter",
    monoFont: "JetBrains Mono",
    headingWeight: 700,
    bodyWeight: 400,
    scale: "standard",
    headingLetterSpacing: -0.03,
    headingTransform: "none",
    lineHeight: 1.08,
  },
  motion: { easing: "expoOut", defaultDuration: 0.6, transitionDuration: 0.45, stagger: 0.05, intensity: "standard" },
  shape: { radius: 14, borderWidth: 1, shadow: "glow" },
  background: { type: "grid", variant: "lines", spacing: 72, fade: true, drift: true, vignette: 0.45 },
  transition: { type: "blur", duration: 0.45 },
  layout: { safeMargin: 7 },
};

export const DESIGN_PRESETS: DesignPreset[] = [
  { id: "premium_saas", label: "Premium SaaS", description: "Dark, restrained, crisp type and soft light.", design: premiumSaas },
  { id: "clean_corporate", label: "Clean Corporate", description: "Light, trustworthy, structured layouts.", design: cleanCorporate },
  { id: "playful", label: "Playful", description: "Warm colors, rounded shapes, bouncy motion.", design: playful },
  { id: "bold_editorial", label: "Bold Editorial", description: "Serif headlines, high contrast, cinematic wipes.", design: boldEditorial },
  { id: "minimal_mono", label: "Minimal Mono", description: "Black and white with one sharp accent.", design: minimalMono },
  { id: "tech_neon", label: "Tech Neon", description: "Deep navy, cyan glow, technical grids.", design: techNeon },
];

export const DEFAULT_DESIGN: DesignSystem = premiumSaas;

export function getDesignPreset(id: string): DesignPreset | undefined {
  return DESIGN_PRESETS.find((p) => p.id === id);
}

/** Applies brand colors/fonts on top of a preset without losing the preset's motion character. */
export function applyBrandToDesign(
  design: DesignSystem,
  brand: { primaryColor?: string; secondaryColor?: string; accentColor?: string; backgroundColor?: string; textColor?: string; headingFont?: string; bodyFont?: string },
): DesignSystem {
  const hex = (v: string | undefined) => (v && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : undefined);
  return {
    ...design,
    colors: {
      ...design.colors,
      ...(hex(brand.primaryColor) ? { primary: hex(brand.primaryColor)! } : {}),
      ...(hex(brand.secondaryColor) ? { secondary: hex(brand.secondaryColor)! } : {}),
      ...(hex(brand.accentColor) ? { accent: hex(brand.accentColor)! } : {}),
      ...(hex(brand.backgroundColor) ? { background: hex(brand.backgroundColor)! } : {}),
      ...(hex(brand.textColor) ? { text: hex(brand.textColor)! } : {}),
    },
    typography: {
      ...design.typography,
      ...(brand.headingFont ? { headingFont: brand.headingFont } : {}),
      ...(brand.bodyFont ? { bodyFont: brand.bodyFont } : {}),
    },
  };
}
