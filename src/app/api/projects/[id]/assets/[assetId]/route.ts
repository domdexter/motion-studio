import { z } from "zod";
import { AppError } from "@/server/errors";
import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { assetDto, deleteAsset, getAsset, replaceAssetFile, updateAsset } from "@/server/services/assets";
import { UPLOAD_CATEGORY_BY_KIND } from "@/server/services/assets";
import type { AssetKind } from "@/core/spec/enums";
import { receiveUpload } from "@/server/storage/upload";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string; assetId: string }>(async (_req, { id, assetId }) => {
  return { asset: assetDto(await getAsset(assertProjectId(id), assertId(assetId, "asset id"))) };
});

export const PATCH = api<{ id: string; assetId: string }>(async (req, { id, assetId }) => {
  const body = await readJson(req, z.record(z.string(), z.unknown()));
  return { asset: await updateAsset(assertProjectId(id), assertId(assetId, "asset id"), body as never, "user") };
});

export const DELETE = api<{ id: string; assetId: string }>(async (req, { id, assetId }) => {
  const force = req.nextUrl.searchParams.get("force") === "1";
  await deleteAsset(assertProjectId(id), assertId(assetId, "asset id"), "user", force);
  return { ok: true };
});

/** Replace the asset's file (multipart "file"), keeping its id. */
export const PUT = api<{ id: string; assetId: string }>(async (req, { id, assetId }) => {
  assertProjectId(id);
  const asset = await getAsset(id, assertId(assetId, "asset id"));
  const upload = await receiveUpload(req, { categories: [UPLOAD_CATEGORY_BY_KIND[asset.kind as AssetKind]], maxFiles: 1 });
  try {
    const file = upload.files[0];
    if (!file) throw new AppError("BAD_REQUEST", "Choose a replacement file.");
    return { asset: await replaceAssetFile(id, assetId, file.tmpPath, file.originalName, "user") };
  } finally {
    await upload.cleanup();
  }
});
