import { AppError } from "@/server/errors";
import { api } from "@/server/http/api";
import { UPLOAD_CATEGORY_BY_KIND } from "@/server/services/assets";
import { BRAND_KIT_FILE_KINDS, assertBrandKitId, uploadBrandKitFiles, type BrandKitFileKind } from "@/server/services/brand-kits";
import { receiveUpload } from "@/server/storage/upload";

/** Upload logo, font, brand guide or reference files into a kit (`?kind=logo`). */
export const POST = api<{ kitId: string }>(async (req, { kitId }) => {
  assertBrandKitId(kitId);
  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  if (!(BRAND_KIT_FILE_KINDS as readonly string[]).includes(kind)) throw new AppError("VALIDATION", `Choose a file kind: ${BRAND_KIT_FILE_KINDS.join(", ")}.`);
  const upload = await receiveUpload(req, { categories: [UPLOAD_CATEGORY_BY_KIND[kind as BrandKitFileKind]], maxFiles: 20 });
  try {
    if (!upload.files.length) throw new AppError("BAD_REQUEST", "Choose at least one file.");
    return { files: await uploadBrandKitFiles(kitId, kind, upload.files, upload.fields.name) };
  } finally {
    await upload.cleanup();
  }
});
