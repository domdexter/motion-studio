import { api } from "@/server/http/api";
import { assertId } from "@/server/ids";
import { deleteBrandKitFile } from "@/server/services/brand-kits";

export const DELETE = api<{ kitId: string; fileId: string }>(async (_req, { kitId, fileId }) => {
  await deleteBrandKitFile(kitId, assertId(fileId, "file id"), "user");
  return { ok: true };
});
