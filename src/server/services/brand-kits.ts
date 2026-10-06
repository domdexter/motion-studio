import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_DESIGN, DESIGN_PRESETS, applyBrandToDesign, getDesignPreset } from "@/core/design/presets";
import { BrandProfileSchema, type BrandProfile } from "@/core/spec/brand";
import { DesignSystemSchema, type DesignSystem } from "@/core/spec/design";
import type { BrandKit, BrandKitFile } from "@/generated/prisma/client";
import { db, json } from "../db";
import { STORAGE_DIR } from "../env";
import { AppError, notFound } from "../errors";
import { assertProjectId, newId, randomId } from "../ids";
import { projectFile, resolveInside, safeFileName, sha256File } from "../storage/paths";
import { validateFileContent, type ReceivedFile } from "../storage/upload";
import { UPLOAD_CATEGORY_BY_KIND, importAsset, readMetadata } from "./assets";
import { BrandPatchSchema } from "./brand";
import { mutateProject, recordActivity, type Actor } from "./mutation";

/**
 * Brand kits: reusable identity + design system + brand files, managed in Settings.
 *
 * A project either follows a kit or has a custom brand. Following a kit copies it into the project
 * (brand files become project assets, deduplicated by content hash) so previews, renders, packages
 * and Claude Code keep working on project-local data. Every change to a kit re-syncs the projects
 * that follow it. Editing a following project's brand directly turns it into a custom brand.
 */

export const BRAND_KIT_FILE_KINDS = ["logo", "font", "brand_guide", "reference"] as const;
export type BrandKitFileKind = (typeof BRAND_KIT_FILE_KINDS)[number];
const KIT_DIR_BY_KIND: Record<BrandKitFileKind, string> = { logo: "logos", font: "fonts", brand_guide: "guides", reference: "references" };

export const BRAND_KITS_DIR = path.join(STORAGE_DIR, "brand-kits");
const KIT_ID_RE = /^kit_[a-z0-9]{10}$/;

export function assertBrandKitId(id: unknown): string {
  if (typeof id !== "string" || !KIT_ID_RE.test(id)) throw new AppError("BAD_REQUEST", "Invalid brand kit id.");
  return id;
}

/** Absolute path of a kit file; the relative path can never escape the kit folder. */
export function brandKitFilePath(kitId: string, relPath: string): string {
  return resolveInside(path.join(BRAND_KITS_DIR, assertBrandKitId(kitId)), relPath);
}

export function brandKitFileUrl(kitId: string, relPath: string, version: string): string {
  return `/api/brand-kits/${kitId}/raw/${relPath.split("/").map(encodeURIComponent).join("/")}?v=${encodeURIComponent(version)}`;
}

const KIT_INCLUDE = { files: { orderBy: { createdAt: "asc" as const } }, _count: { select: { projects: true } } };
type KitRow = BrandKit & { files: BrandKitFile[]; _count: { projects: number } };

export function brandKitFileDto(f: BrandKitFile) {
  return {
    id: f.id,
    kind: f.kind as BrandKitFileKind,
    name: f.name,
    fileName: f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    width: f.width,
    height: f.height,
    contentHash: f.contentHash,
    url: brandKitFileUrl(f.brandKitId, f.filePath, f.contentHash.slice(0, 12)),
    createdAt: f.createdAt.toISOString(),
  };
}
export type BrandKitFileDto = ReturnType<typeof brandKitFileDto>;

export function brandKitDto(kit: KitRow) {
  const brand = BrandProfileSchema.parse(kit.brand ?? {});
  const design = DesignSystemSchema.safeParse(kit.design);
  const files = kit.files.map(brandKitFileDto);
  return {
    id: kit.id,
    name: kit.name,
    description: kit.description,
    version: kit.version,
    brand,
    design: design.success ? design.data : DEFAULT_DESIGN,
    files,
    logoUrl: files.find((f) => f.id === brand.logoAssetId)?.url ?? null,
    projectCount: kit._count.projects,
    createdAt: kit.createdAt.toISOString(),
    updatedAt: kit.updatedAt.toISOString(),
  };
}
export type BrandKitDto = ReturnType<typeof brandKitDto>;

async function getKitRow(kitId: string): Promise<KitRow> {
  const kit = await db.brandKit.findUnique({ where: { id: assertBrandKitId(kitId) }, include: KIT_INCLUDE });
  if (!kit) throw notFound("Brand kit");
  return kit;
}

function remapBrand(brand: BrandProfile, map: (id: string) => string | null): BrandProfile {
  const keep = (ids: string[]) => ids.map(map).filter((x): x is string => !!x);
  return BrandProfileSchema.parse({
    ...brand,
    logoAssetId: brand.logoAssetId ? map(brand.logoAssetId) : null,
    referenceAssetIds: keep(brand.referenceAssetIds),
    brandGuideAssetIds: keep(brand.brandGuideAssetIds),
    customFonts: brand.customFonts.flatMap((f) => {
      const id = map(f.assetId);
      return id ? [{ family: f.family, assetId: id }] : [];
    }),
  });
}

const referencedIds = (brand: BrandProfile) => [
  ...(brand.logoAssetId ? [brand.logoAssetId] : []),
  ...brand.referenceAssetIds,
  ...brand.brandGuideAssetIds,
  ...brand.customFonts.map((f) => f.assetId),
];

// ---------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------

export async function listBrandKits(): Promise<BrandKitDto[]> {
  const kits = await db.brandKit.findMany({ orderBy: { name: "asc" }, include: KIT_INCLUDE });
  return kits.map(brandKitDto);
}

export async function getBrandKit(kitId: string): Promise<BrandKitDto> {
  return brandKitDto(await getKitRow(kitId));
}

export async function listBrandKitProjects(kitId: string) {
  const rows = await db.project.findMany({
    where: { brandKitId: assertBrandKitId(kitId) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, brandKitVersion: true, archivedAt: true },
  });
  return rows.map((p) => ({ id: p.id, name: p.name, syncedVersion: p.brandKitVersion, archived: !!p.archivedAt }));
}

// ---------------------------------------------------------------------------------------
// Kit mutations
// ---------------------------------------------------------------------------------------

export const CreateBrandKitSchema = z
  .object({
    name: z.string().trim().min(1, "Name the brand kit").max(120),
    description: z.string().max(2000).default(""),
    designPreset: z.string().default("premium_saas"),
    /** Start from a project's brand: identity, design system and brand files are copied. */
    fromProjectId: z.string().optional(),
    /** When starting from a project, make that project follow the new kit. */
    linkProject: z.boolean().default(true),
  })
  .strict();

export async function createBrandKit(input: z.input<typeof CreateBrandKitSchema>, actor: Actor): Promise<BrandKitDto> {
  const data = CreateBrandKitSchema.parse(input);
  const id = newId.brandKit();

  if (!data.fromProjectId) {
    const preset = getDesignPreset(data.designPreset) ?? DESIGN_PRESETS[0];
    await db.brandKit.create({
      data: { id, name: data.name, description: data.description, brand: json(BrandProfileSchema.parse({ brandName: data.name })), design: json(preset.design) },
    });
    return getBrandKit(id);
  }

  const projectId = assertProjectId(data.fromProjectId);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true, brand: true, design: true } });
  if (!project) throw notFound("Project");
  const brand = BrandProfileSchema.parse(project.brand ?? {});
  const assets = await db.asset.findMany({ where: { projectId, id: { in: referencedIds(brand) } } });
  const idMap = new Map<string, string>();
  const fileRows: Omit<BrandKitFile, "createdAt">[] = [];
  try {
    for (const a of assets) {
      const kind: BrandKitFileKind =
        a.id === brand.logoAssetId ? "logo" : brand.customFonts.some((f) => f.assetId === a.id) ? "font" : brand.brandGuideAssetIds.includes(a.id) ? "brand_guide" : "reference";
      const rel = `${KIT_DIR_BY_KIND[kind]}/${randomId(6)}-${safeFileName(a.fileName, kind)}`;
      const abs = brandKitFilePath(id, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.copyFile(projectFile(projectId, a.filePath), abs);
      const fileId = newId.brandKitFile();
      idMap.set(a.id, fileId);
      fileRows.push({ id: fileId, brandKitId: id, kind, name: a.name, fileName: path.basename(rel), filePath: rel, mimeType: a.mimeType, sizeBytes: a.sizeBytes, contentHash: a.contentHash, width: a.width, height: a.height });
    }
    const design = DesignSystemSchema.safeParse(project.design);
    await db.$transaction(async (tx) => {
      await tx.brandKit.create({
        data: { id, name: data.name, description: data.description, brand: json(remapBrand(brand, (x) => idMap.get(x) ?? null)), design: json(design.success ? design.data : DEFAULT_DESIGN) },
      });
      if (fileRows.length) await tx.brandKitFile.createMany({ data: fileRows });
    });
  } catch (err) {
    await fs.rm(path.join(BRAND_KITS_DIR, id), { recursive: true, force: true });
    throw err;
  }
  if (data.linkProject) {
    await mutateProject(projectId, actor, async (tx) => {
      await tx.project.update({ where: { id: projectId }, data: { brandKitId: id, brandKitVersion: 1 } });
      return { result: null, activity: { type: "brand.kit_created", message: `Saved this brand as brand kit “${data.name}” — the project now follows it`, data: { brandKitId: id } } };
    });
  }
  return getBrandKit(id);
}

export const UpdateBrandKitSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000) }).partial().strict();

export async function updateBrandKitInfo(kitId: string, patch: z.input<typeof UpdateBrandKitSchema>): Promise<BrandKitDto> {
  const data = UpdateBrandKitSchema.parse(patch);
  const kit = await getKitRow(kitId);
  await db.brandKit.update({ where: { id: kit.id }, data });
  return getBrandKit(kit.id);
}

export async function updateBrandKitBrand(kitId: string, patch: z.input<typeof BrandPatchSchema>, actor: Actor): Promise<BrandKitDto> {
  const data = BrandPatchSchema.parse(patch);
  const kit = await getKitRow(kitId);
  const known = new Set(kit.files.map((f) => f.id));
  const unknown = referencedIds(BrandProfileSchema.parse({ ...data })).filter((id) => !known.has(id));
  if (unknown.length) throw new AppError("VALIDATION", `Unknown brand kit file id(s): ${unknown.join(", ")}`);
  const next = BrandProfileSchema.parse({ ...BrandProfileSchema.parse(kit.brand ?? {}), ...data });
  await db.brandKit.update({ where: { id: kit.id }, data: { brand: json(next), version: { increment: 1 } } });
  await syncLinkedProjects(kit.id, actor);
  return getBrandKit(kit.id);
}

export async function updateBrandKitDesign(kitId: string, design: unknown, actor: Actor): Promise<BrandKitDto> {
  const parsed = DesignSystemSchema.safeParse(design);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "Invalid design system.", { details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  const kit = await getKitRow(kitId);
  await db.brandKit.update({ where: { id: kit.id }, data: { design: json(parsed.data), version: { increment: 1 } } });
  await syncLinkedProjects(kit.id, actor);
  return getBrandKit(kit.id);
}

export async function applyBrandKitPreset(kitId: string, presetId: string, options: { keepColors: boolean; keepFonts: boolean }, actor: Actor): Promise<BrandKitDto> {
  const preset = getDesignPreset(presetId);
  if (!preset) throw new AppError("VALIDATION", `Unknown design preset “${presetId}”. Available: ${DESIGN_PRESETS.map((p) => p.id).join(", ")}`);
  const kit = await getKitRow(kitId);
  const current = DesignSystemSchema.safeParse(kit.design);
  const base = current.success ? current.data : DEFAULT_DESIGN;
  let next: DesignSystem = { ...preset.design };
  if (options.keepColors || options.keepFonts) {
    next = applyBrandToDesign(next, {
      ...(options.keepColors ? { primaryColor: base.colors.primary, secondaryColor: base.colors.secondary, accentColor: base.colors.accent } : {}),
      ...(options.keepFonts ? { headingFont: base.typography.headingFont, bodyFont: base.typography.bodyFont } : {}),
    });
  }
  return updateBrandKitDesign(kit.id, next, actor);
}

export async function uploadBrandKitFiles(kitId: string, kind: string, files: ReceivedFile[], name?: string): Promise<BrandKitFileDto[]> {
  const kit = await getKitRow(kitId);
  if (!(BRAND_KIT_FILE_KINDS as readonly string[]).includes(kind)) throw new AppError("VALIDATION", `Brand kit files must be one of: ${BRAND_KIT_FILE_KINDS.join(", ")}.`);
  const fileKind = kind as BrandKitFileKind;
  const created: BrandKitFile[] = [];
  for (const file of files) {
    const mimeType = await validateFileContent(file.tmpPath, file.originalName, UPLOAD_CATEGORY_BY_KIND[fileKind]);
    const rel = `${KIT_DIR_BY_KIND[fileKind]}/${randomId(6)}-${safeFileName(file.originalName, fileKind)}`;
    const abs = brandKitFilePath(kit.id, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.rename(file.tmpPath, abs).catch(async () => {
      await fs.copyFile(file.tmpPath, abs);
      await fs.rm(file.tmpPath, { force: true });
    });
    const [stat, contentHash, meta] = await Promise.all([fs.stat(abs), sha256File(abs), readMetadata(abs, mimeType)]);
    const displayName = (files.length === 1 && name?.trim()) || path.basename(file.originalName, path.extname(file.originalName));
    created.push(
      await db.brandKitFile.create({
        data: { id: newId.brandKitFile(), brandKitId: kit.id, kind: fileKind, name: displayName.slice(0, 160), fileName: path.basename(rel), filePath: rel, mimeType, sizeBytes: stat.size, contentHash, width: meta.width, height: meta.height },
      }),
    );
  }
  await db.brandKit.update({ where: { id: kit.id }, data: { updatedAt: new Date() } });
  return created.map(brandKitFileDto);
}

export async function deleteBrandKitFile(kitId: string, fileId: string, actor: Actor): Promise<void> {
  const kit = await getKitRow(kitId);
  const file = kit.files.find((f) => f.id === fileId);
  if (!file) throw notFound("Brand kit file");
  const brand = BrandProfileSchema.parse(kit.brand ?? {});
  const next = remapBrand(brand, (id) => (id === file.id ? null : id));
  const changed = JSON.stringify(next) !== JSON.stringify(brand);
  await db.$transaction([
    db.brandKitFile.delete({ where: { id: file.id } }),
    db.brandKit.update({ where: { id: kit.id }, data: changed ? { brand: json(next), version: { increment: 1 } } : { updatedAt: new Date() } }),
  ]);
  await fs.rm(brandKitFilePath(kit.id, file.filePath), { force: true });
  if (changed) await syncLinkedProjects(kit.id, actor);
}

export async function deleteBrandKit(kitId: string, actor: Actor): Promise<void> {
  const kit = await getKitRow(kitId);
  const linked = await db.project.findMany({ where: { brandKitId: kit.id }, select: { id: true } });
  await db.brandKit.delete({ where: { id: kit.id } });
  await fs.rm(path.join(BRAND_KITS_DIR, kit.id), { recursive: true, force: true });
  for (const p of linked) {
    await recordActivity(p.id, actor, { type: "brand.kit_deleted", message: `Brand kit “${kit.name}” was deleted — this project keeps its brand as a custom brand` }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------------------

/** Copies a kit into a project (files → project assets, deduplicated) and makes the project follow it. */
export async function applyBrandKitToProject(projectId: string, kitId: string, actor: Actor): Promise<{ brandKitId: string; version: number }> {
  assertProjectId(projectId);
  const kit = await getKitRow(kitId);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { brandKitId: true, brand: true, _count: { select: { scenes: true } } } });
  if (!project) throw notFound("Project");
  if (!project.brandKitId && (project._count.scenes > 0 || BrandProfileSchema.parse(project.brand ?? {}).brandName)) {
    // Replacing an existing custom brand: keep a restorable project version first.
    const { saveSnapshot } = await import("./snapshots");
    await saveSnapshot(projectId, `Before brand kit “${kit.name}”`, actor);
  }

  const brand = BrandProfileSchema.parse(kit.brand ?? {});
  const wanted = new Set(referencedIds(brand));
  const existing = await db.asset.findMany({ where: { projectId, kind: { in: [...BRAND_KIT_FILE_KINDS] } }, select: { id: true, kind: true, contentHash: true } });
  const idMap = new Map<string, string>();
  for (const f of kit.files.filter((x) => wanted.has(x.id))) {
    const match = existing.find((a) => a.kind === f.kind && a.contentHash === f.contentHash);
    if (match) {
      idMap.set(f.id, match.id);
      continue;
    }
    const asset = await importAsset(
      projectId,
      { sourcePath: brandKitFilePath(kit.id, f.filePath), originalName: f.fileName.replace(/^[a-z0-9]{6}-/, ""), kind: f.kind as BrandKitFileKind, source: "brand_kit", name: f.name, tags: ["brand-kit"], move: false },
      actor,
    );
    existing.push({ id: asset.id, kind: asset.kind, contentHash: asset.contentHash });
    idMap.set(f.id, asset.id);
  }

  const design = DesignSystemSchema.safeParse(kit.design);
  const synced = project.brandKitId === kit.id;
  await mutateProject(projectId, actor, async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: { brand: json(remapBrand(brand, (id) => idMap.get(id) ?? null)), design: json(design.success ? design.data : DEFAULT_DESIGN), brandKitId: kit.id, brandKitVersion: kit.version },
    });
    return {
      result: null,
      activity: { type: synced ? "brand.kit_synced" : "brand.kit_applied", message: `${synced ? "Synced" : "Now following"} brand kit “${kit.name}” (v${kit.version})`, data: { brandKitId: kit.id, version: kit.version } },
    };
  });
  return { brandKitId: kit.id, version: kit.version };
}

/** Stops following the kit; the project keeps its current brand as a custom brand. */
export async function detachBrandKit(projectId: string, actor: Actor): Promise<void> {
  assertProjectId(projectId);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { brandKit: { select: { name: true } } } });
  if (!project) throw notFound("Project");
  if (!project.brandKit) return;
  const kitName = project.brandKit.name;
  await mutateProject(projectId, actor, async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { brandKitId: null, brandKitVersion: null } });
    return { result: null, activity: { type: "brand.kit_detached", message: `Customizing the brand for this project (stopped following “${kitName}”)` } };
  });
}

/** Re-applies a kit to every project that follows it. One failing project never blocks the others. */
export async function syncLinkedProjects(kitId: string, actor: Actor): Promise<{ synced: string[]; failed: { projectId: string; error: string }[] }> {
  const projects = await db.project.findMany({ where: { brandKitId: kitId }, select: { id: true } });
  const synced: string[] = [];
  const failed: { projectId: string; error: string }[] = [];
  for (const p of projects) {
    try {
      await applyBrandKitToProject(p.id, kitId, actor);
      synced.push(p.id);
    } catch (err) {
      failed.push({ projectId: p.id, error: err instanceof Error ? err.message : String(err) });
      console.error(`[brand-kits] could not sync ${p.id} with ${kitId}:`, err);
    }
  }
  return { synced, failed };
}
