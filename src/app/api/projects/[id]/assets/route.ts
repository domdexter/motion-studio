import { AssetKindSchema } from "@/core/spec/enums";
import { AppError } from "@/server/errors";
import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { UPLOAD_CATEGORY_BY_KIND, importAsset, listAssets } from "@/server/services/assets";
import { assertProjectExists } from "@/server/services/projects";
import { receiveUpload } from "@/server/storage/upload";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const kinds = req.nextUrl.searchParams.get("kind")?.split(",").filter(Boolean);
  return { assets: await listAssets(id, kinds) };
});

/** Upload one or more files as assets. Fields: kind (required), name, sceneId, tags (comma separated). */
export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  await assertProjectExists(id);
  const kindParam = req.nextUrl.searchParams.get("kind");
  const kindFromQuery = kindParam ? AssetKindSchema.safeParse(kindParam) : null;
  if (kindParam && !kindFromQuery?.success) throw new AppError("VALIDATION", `Unknown asset kind “${kindParam}”.`);
  const categories = kindFromQuery?.success ? [UPLOAD_CATEGORY_BY_KIND[kindFromQuery.data]] : (["image", "video", "audio", "font", "document"] as const).slice();
  const upload = await receiveUpload(req, { categories: [...categories], maxFiles: 20 });
  try {
    const kind = AssetKindSchema.safeParse(upload.fields.kind ?? kindParam);
    if (!kind.success) throw new AppError("VALIDATION", "Missing or unknown asset kind.");
    if (upload.files.length === 0) throw new AppError("BAD_REQUEST", "No files were uploaded.");
    const assets = [];
    for (const file of upload.files) {
      assets.push(
        await importAsset(
          id,
          {
            sourcePath: file.tmpPath,
            originalName: file.originalName,
            kind: kind.data,
            source: "upload",
            name: upload.files.length === 1 ? upload.fields.name : undefined,
            sceneId: upload.fields.sceneId || null,
            tags: upload.fields.tags ? upload.fields.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
            move: true,
          },
          "user",
        ),
      );
    }
    return { assets };
  } finally {
    await upload.cleanup();
  }
});
