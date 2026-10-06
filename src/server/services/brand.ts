import { z } from "zod";
import { DESIGN_PRESETS, applyBrandToDesign, getDesignPreset } from "@/core/design/presets";
import { BrandProfileSchema, type BrandProfile } from "@/core/spec/brand";
import { DesignSystemSchema, type DesignSystem } from "@/core/spec/design";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { mutateProject, type Actor } from "./mutation";

export const BrandPatchSchema = z
  .object({
    brandName: z.string().max(120),
    tagline: z.string().max(240),
    website: z.string().max(240),
    logoAssetId: z.string().nullable(),
    typographyNotes: z.string().max(4000),
    visualStyle: z.string().max(4000),
    imageStyle: z.string().max(4000),
    animationStyle: z.string().max(4000),
    guidelines: z.string().max(20000),
    referenceAssetIds: z.array(z.string()).max(100),
    brandGuideAssetIds: z.array(z.string()).max(50),
    customFonts: z.array(z.object({ family: z.string().min(1).max(80), assetId: z.string() })).max(20),
  })
  .partial()
  .strict();

async function assertAssetsExist(projectId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const found = await db.asset.findMany({ where: { projectId, id: { in: ids } }, select: { id: true } });
  const missing = ids.filter((id) => !found.some((f) => f.id === id));
  if (missing.length) throw new AppError("VALIDATION", `Unknown asset id(s): ${missing.join(", ")}`);
}

export async function updateBrand(projectId: string, patch: z.input<typeof BrandPatchSchema>, actor: Actor): Promise<BrandProfile> {
  const data = BrandPatchSchema.parse(patch);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { brand: true, brandKit: { select: { name: true } } } });
  if (!project) throw notFound("Project");
  await assertAssetsExist(projectId, [
    ...(data.logoAssetId ? [data.logoAssetId] : []),
    ...(data.referenceAssetIds ?? []),
    ...(data.brandGuideAssetIds ?? []),
    ...(data.customFonts ?? []).map((f) => f.assetId),
  ]);
  const next = BrandProfileSchema.parse({ ...BrandProfileSchema.parse(project.brand ?? {}), ...data });
  await mutateProject(projectId, actor, async (tx) => {
    // A direct edit overrides the brand kit: the project stops following it (a later kit change must not overwrite this edit).
    await tx.project.update({ where: { id: projectId }, data: { brand: json(next), ...(project.brandKit ? { brandKitId: null, brandKitVersion: null } : {}) } });
    const detached = project.brandKit ? ` — now a custom brand (stopped following “${project.brandKit.name}”)` : "";
    return { result: null, activity: { type: "brand.updated", message: `Updated brand (${Object.keys(data).join(", ")})${detached}` } };
  });
  return next;
}

export async function updateDesign(projectId: string, design: unknown, actor: Actor, message = "Updated design system"): Promise<DesignSystem> {
  const parsed = DesignSystemSchema.safeParse(design);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "Invalid design system.", { details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  const project = await db.project.findUnique({ where: { id: projectId }, select: { brandKit: { select: { name: true } } } });
  if (!project) throw notFound("Project");
  await mutateProject(projectId, actor, async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { design: json(parsed.data), ...(project.brandKit ? { brandKitId: null, brandKitVersion: null } : {}) } });
    const detached = project.brandKit ? ` — now a custom brand (stopped following “${project.brandKit.name}”)` : "";
    return { result: null, activity: { type: "design.updated", message: `${message}${detached}` } };
  });
  return parsed.data;
}

/** Switches the design preset (motion, shape, background, transitions), optionally keeping brand colors/fonts. */
export async function applyDesignPreset(projectId: string, presetId: string, options: { keepColors: boolean; keepFonts: boolean }, actor: Actor): Promise<DesignSystem> {
  const preset = getDesignPreset(presetId);
  if (!preset) throw new AppError("VALIDATION", `Unknown design preset “${presetId}”. Available: ${DESIGN_PRESETS.map((p) => p.id).join(", ")}`);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { design: true } });
  if (!project) throw notFound("Project");
  const current = project.design as DesignSystem;
  let next: DesignSystem = { ...preset.design };
  if (options.keepColors || options.keepFonts) {
    next = applyBrandToDesign(next, {
      ...(options.keepColors
        ? { primaryColor: current.colors.primary, secondaryColor: current.colors.secondary, accentColor: current.colors.accent }
        : {}),
      ...(options.keepFonts ? { headingFont: current.typography.headingFont, bodyFont: current.typography.bodyFont } : {}),
    });
  }
  return updateDesign(projectId, next, actor, `Applied design preset “${preset.label}”${options.keepColors ? " (kept brand colors)" : ""}`);
}
