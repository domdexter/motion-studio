import fs from "node:fs/promises";
import path from "node:path";
import { imageSize } from "image-size";
import { z } from "zod";
import { BrandProfileSchema } from "@/core/spec/brand";
import { AssetKindSchema, type AssetKind } from "@/core/spec/enums";
import { assetIdsInSpec, type SceneSpec } from "@/core/spec/scene";
import type { Asset } from "@/generated/prisma/client";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { newId } from "../ids";
import { probeMedia } from "../media/ffmpeg";
import type { UploadCategory } from "../storage/mime";
import { projectFile, safeFileName, sha256File, uniqueRelPath } from "../storage/paths";
import { validateFileContent } from "../storage/upload";
import { mutateProject, type Actor } from "./mutation";
import { fileUrl } from "./projects";

export const ASSET_DIR_BY_KIND: Record<AssetKind, string> = {
  image: "assets/images",
  video: "assets/videos",
  audio: "assets/audio",
  music: "audio/music",
  sfx: "audio/sfx",
  logo: "assets/logos",
  font: "assets/fonts",
  screenshot: "assets/screenshots",
  icon: "assets/icons",
  brand_guide: "assets/brand",
  reference: "assets/references",
};

export const UPLOAD_CATEGORY_BY_KIND: Record<AssetKind, UploadCategory> = {
  image: "image",
  video: "video",
  audio: "audio",
  music: "audio",
  sfx: "audio",
  logo: "image",
  font: "font",
  screenshot: "image",
  icon: "image",
  brand_guide: "document",
  reference: "document",
};

export function assetDto(a: Asset, sceneKey?: string | null) {
  return {
    id: a.id,
    projectId: a.projectId,
    kind: a.kind as AssetKind,
    source: a.source,
    name: a.name,
    fileName: a.fileName,
    filePath: a.filePath,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    width: a.width,
    height: a.height,
    durationSec: a.durationSec,
    prompt: a.prompt,
    generator: a.generator,
    requestId: a.requestId,
    sceneId: a.sceneId,
    sceneKey: sceneKey ?? null,
    tags: a.tags as string[],
    meta: a.meta,
    status: a.status,
    version: a.version,
    contentHash: a.contentHash,
    url: fileUrl(a.projectId, a.filePath, a.contentHash.slice(0, 12)),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
export type AssetDto = ReturnType<typeof assetDto>;

interface FileMetadata {
  width: number | null;
  height: number | null;
  durationSec: number | null;
  meta: Record<string, unknown>;
}

export async function readMetadata(abs: string, mimeType: string): Promise<FileMetadata> {
  if (mimeType.startsWith("image/")) {
    try {
      const dim = imageSize(await fs.readFile(abs));
      return { width: dim.width ?? null, height: dim.height ?? null, durationSec: null, meta: {} };
    } catch {
      return { width: null, height: null, durationSec: null, meta: {} };
    }
  }
  if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
    const probe = await probeMedia(abs);
    return {
      width: probe.width,
      height: probe.height,
      durationSec: probe.durationSec,
      meta: { hasAudio: probe.hasAudio, hasVideo: probe.hasVideo, fps: probe.fps, sampleRate: probe.sampleRate, channels: probe.channels, audioCodec: probe.audioCodec, videoCodec: probe.videoCodec },
    };
  }
  return { width: null, height: null, durationSec: null, meta: {} };
}

export interface ImportAssetInput {
  /** Absolute path of the incoming file (temp upload or a file Claude generated). */
  sourcePath: string;
  originalName: string;
  kind: AssetKind;
  source: "upload" | "claude" | "elevenlabs" | "render" | "import" | "hyperframes" | "brand_kit";
  name?: string;
  prompt?: string | null;
  generator?: string | null;
  requestId?: string | null;
  sceneId?: string | null;
  tags?: string[];
  status?: "ready" | "approved" | "rejected";
  /** Move (temp uploads) instead of copy (files referenced by Claude). */
  move?: boolean;
}

export async function importAsset(projectId: string, input: ImportAssetInput, actor: Actor): Promise<AssetDto> {
  const kind = AssetKindSchema.parse(input.kind);
  const mimeType = await validateFileContent(input.sourcePath, input.originalName, UPLOAD_CATEGORY_BY_KIND[kind]);
  const relPath = await uniqueRelPath(projectId, ASSET_DIR_BY_KIND[kind], safeFileName(input.originalName, kind));
  const abs = projectFile(projectId, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  if (input.move) {
    await fs.rename(input.sourcePath, abs).catch(async () => {
      await fs.copyFile(input.sourcePath, abs);
      await fs.rm(input.sourcePath, { force: true });
    });
  } else {
    await fs.copyFile(input.sourcePath, abs);
  }
  try {
    const [stat, contentHash, metadata] = await Promise.all([fs.stat(abs), sha256File(abs), readMetadata(abs, mimeType)]);
    const asset = await mutateProject(projectId, actor, async (tx) => {
      const created = await tx.asset.create({
        data: {
          id: newId.asset(),
          projectId,
          kind,
          source: input.source,
          name: input.name?.trim() || path.basename(input.originalName, path.extname(input.originalName)),
          fileName: path.basename(relPath),
          filePath: relPath,
          mimeType,
          sizeBytes: stat.size,
          contentHash,
          width: metadata.width,
          height: metadata.height,
          durationSec: metadata.durationSec,
          prompt: input.prompt ?? null,
          generator: input.generator ?? null,
          requestId: input.requestId ?? null,
          sceneId: input.sceneId ?? null,
          tags: json(input.tags ?? []),
          meta: json(metadata.meta),
          status: input.status ?? "ready",
        },
      });
      return { result: created, activity: { type: "asset.added", message: `Added ${kind} “${created.name}”`, data: { assetId: created.id } } };
    });
    return assetDto(asset);
  } catch (err) {
    await fs.rm(abs, { force: true });
    throw err;
  }
}

export async function listAssets(projectId: string, kinds?: string[]): Promise<AssetDto[]> {
  const [assets, scenes] = await Promise.all([
    db.asset.findMany({ where: { projectId, ...(kinds?.length ? { kind: { in: kinds } } : {}) }, orderBy: { createdAt: "desc" } }),
    db.scene.findMany({ where: { projectId }, select: { id: true, key: true } }),
  ]);
  const keys = new Map(scenes.map((s) => [s.id, s.key]));
  return assets.map((a) => assetDto(a, a.sceneId ? keys.get(a.sceneId) : null));
}

export async function getAsset(projectId: string, assetId: string): Promise<Asset> {
  const asset = await db.asset.findFirst({ where: { id: assetId, projectId } });
  if (!asset) throw notFound("Asset");
  return asset;
}

export const UpdateAssetSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    sceneId: z.string().nullable().optional(),
    tags: z.array(z.string().max(40)).max(30).optional(),
    status: z.enum(["ready", "approved", "rejected"]).optional(),
    kind: AssetKindSchema.optional(),
  })
  .strict();

export async function updateAsset(projectId: string, assetId: string, patch: z.input<typeof UpdateAssetSchema>, actor: Actor): Promise<AssetDto> {
  const data = UpdateAssetSchema.parse(patch);
  const asset = await getAsset(projectId, assetId);
  if (data.sceneId) {
    const scene = await db.scene.findFirst({ where: { id: data.sceneId, projectId }, select: { id: true } });
    if (!scene) throw notFound("Scene");
  }
  const updated = await mutateProject(projectId, actor, async (tx) => {
    const row = await tx.asset.update({
      where: { id: assetId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.sceneId !== undefined ? { sceneId: data.sceneId } : {}),
        ...(data.tags !== undefined ? { tags: json(data.tags) } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
      },
    });
    return { result: row, activity: { type: "asset.updated", message: `Updated asset “${asset.name}”`, data: { assetId, changes: Object.keys(data) } } };
  });
  return assetDto(updated);
}

/** Replaces an asset's file but keeps its id, so every scene referencing it picks up the change. */
export async function replaceAssetFile(projectId: string, assetId: string, sourcePath: string, originalName: string, actor: Actor): Promise<AssetDto> {
  const asset = await getAsset(projectId, assetId);
  const kind = asset.kind as AssetKind;
  const mimeType = await validateFileContent(sourcePath, originalName, UPLOAD_CATEGORY_BY_KIND[kind]);
  const relPath = await uniqueRelPath(projectId, ASSET_DIR_BY_KIND[kind], safeFileName(originalName, kind));
  const abs = projectFile(projectId, relPath);
  await fs.rename(sourcePath, abs).catch(async () => {
    await fs.copyFile(sourcePath, abs);
    await fs.rm(sourcePath, { force: true });
  });
  const [stat, contentHash, metadata] = await Promise.all([fs.stat(abs), sha256File(abs), readMetadata(abs, mimeType)]);
  const updated = await mutateProject(projectId, actor, async (tx) => {
    const row = await tx.asset.update({
      where: { id: assetId },
      data: {
        fileName: path.basename(relPath),
        filePath: relPath,
        mimeType,
        sizeBytes: stat.size,
        contentHash,
        width: metadata.width,
        height: metadata.height,
        durationSec: metadata.durationSec,
        meta: json({ ...(asset.meta as object | null), ...metadata.meta, previousFile: asset.filePath }),
        version: { increment: 1 },
      },
    });
    return { result: row, activity: { type: "asset.replaced", message: `Replaced file of “${asset.name}” (v${row.version})`, data: { assetId } } };
  });
  await fs.rm(projectFile(projectId, asset.filePath), { force: true }).catch(() => undefined);
  return assetDto(updated);
}

export async function assetReferences(projectId: string, assetId: string): Promise<string[]> {
  const [scenes, project, tracks] = await Promise.all([
    db.scene.findMany({ where: { projectId }, select: { key: true, spec: true } }),
    db.project.findUnique({ where: { id: projectId }, select: { brand: true } }),
    db.audioTrack.count({ where: { projectId, assetId } }),
  ]);
  const refs: string[] = [];
  for (const s of scenes) {
    const spec = s.spec as SceneSpec;
    if (Array.isArray(spec?.elements) && assetIdsInSpec(spec).includes(assetId)) refs.push(s.key);
  }
  const brand = BrandProfileSchema.parse(project?.brand ?? {});
  if (brand.logoAssetId === assetId) refs.push("brand logo");
  if (brand.referenceAssetIds.includes(assetId) || brand.brandGuideAssetIds.includes(assetId)) refs.push("brand references");
  if (tracks > 0) refs.push("audio tracks");
  return refs;
}

export async function deleteAsset(projectId: string, assetId: string, actor: Actor, force = false): Promise<void> {
  const asset = await getAsset(projectId, assetId);
  const refs = await assetReferences(projectId, assetId);
  if (refs.length && !force) {
    throw new AppError("CONFLICT", `“${asset.name}” is used by ${refs.join(", ")}.`, { hint: "Remove it from those scenes first, or delete anyway (scenes will show a missing-asset warning)." });
  }
  await mutateProject(projectId, actor, async (tx) => {
    await tx.audioTrack.deleteMany({ where: { projectId, assetId } });
    await tx.asset.delete({ where: { id: assetId } });
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { brand: true } });
    const brand = BrandProfileSchema.parse(project?.brand ?? {});
    if (brand.logoAssetId === assetId || brand.referenceAssetIds.includes(assetId) || brand.brandGuideAssetIds.includes(assetId)) {
      await tx.project.update({
        where: { id: projectId },
        data: {
          brand: json({
            ...brand,
            logoAssetId: brand.logoAssetId === assetId ? null : brand.logoAssetId,
            referenceAssetIds: brand.referenceAssetIds.filter((x) => x !== assetId),
            brandGuideAssetIds: brand.brandGuideAssetIds.filter((x) => x !== assetId),
          }),
        },
      });
    }
    return { result: null, activity: { type: "asset.deleted", message: `Deleted asset “${asset.name}”`, data: { assetId, references: refs } } };
  });
  await fs.rm(projectFile(projectId, asset.filePath), { force: true }).catch(() => undefined);
}
