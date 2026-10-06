import type { BrandProfile } from "../spec/brand";
import type { CompositionAsset, CompositionFont, StudioVideoProps } from "../spec/composition";
import type { DesignSystem } from "../spec/design";
import type { SceneSpec } from "../spec/scene";

/**
 * A short, voice-free sample video (statement → features → logo + CTA) used to preview a design
 * system and brand where no project exists — e.g. brand kits in Settings.
 */
export function sampleBrandVideoProps(input: {
  design: DesignSystem;
  brand: Pick<BrandProfile, "brandName" | "tagline" | "logoAssetId">;
  assets?: Record<string, CompositionAsset>;
  fonts?: CompositionFont[];
  width?: number;
  height?: number;
  fps?: number;
}): StudioVideoProps {
  const name = input.brand.brandName.trim() || "Your brand";
  const tagline = input.brand.tagline.trim() || "Every scene, perfectly on brand";
  const lastWord = (tagline.split(/\s+/).pop() ?? "").replace(/[^\p{L}\p{N}'-]/gu, "");
  const highlight = lastWord ? { highlight: { words: [lastWord], style: "color" as const, color: "primary", at: "enter" as const } } : {};

  const scenes: { key: string; name: string; spec: SceneSpec }[] = [
    {
      key: "sample_01",
      name: "Statement",
      spec: {
        version: 1,
        elements: [
          { id: "eyebrow", type: "badge", text: name, icon: "sparkles", variant: "soft", color: "primary", x: 50, y: 34, enter: { type: "fade" } },
          { id: "headline", type: "text", role: "headline", text: tagline, x: 50, y: 52, align: "center", maxWidth: 76, enter: { type: "wordReveal", stagger: 0.08 }, ...highlight },
        ],
      },
    },
    {
      key: "sample_02",
      name: "Features",
      spec: {
        version: 1,
        elements: [
          { id: "title", type: "text", role: "title", text: "Built for how you work", x: 50, y: 24, align: "center", enter: { type: "rise" } },
          {
            id: "cards",
            type: "cards",
            layout: "row",
            variant: "feature",
            x: 50,
            y: 58,
            itemWidth: 320,
            itemHeight: 230,
            gap: 40,
            enter: { type: "rise", stagger: 0.1 },
            items: [
              { title: "Fast", body: "Launch in minutes", icon: "zap" },
              { title: "Reliable", body: "Always on", icon: "shield-check" },
              { title: "Beautiful", body: "On brand by default", icon: "palette" },
            ],
          },
        ],
      },
    },
    {
      key: "sample_03",
      name: "Call to action",
      spec: {
        version: 1,
        elements: [
          { id: "logo", type: "logo", variant: "lockup", text: name, size: 140, x: 50, y: 40, enter: { type: "scale", duration: 0.8 } },
          { id: "cta", type: "button", label: "Get started", icon: "arrow-right", size: "lg", variant: "primary", x: 50, y: 66, enter: { type: "pop", delay: 0.5 } },
        ],
      },
    },
  ];

  const sceneLength = 3;
  return {
    projectId: "brand-kit-preview",
    width: input.width ?? 1920,
    height: input.height ?? 1080,
    fps: input.fps ?? 30,
    durationSec: sceneLength * scenes.length,
    design: input.design,
    brand: { brandName: name, logoAssetId: input.brand.logoAssetId },
    scenes: scenes.map((s, i) => ({ id: s.key, key: s.key, name: s.name, start: i * sceneLength, end: (i + 1) * sceneLength, spec: s.spec, valid: true })),
    words: [],
    voice: null,
    tracks: [],
    assets: input.assets ?? {},
    fonts: input.fonts ?? [],
  };
}
