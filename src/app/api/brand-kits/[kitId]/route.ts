import { api, readJson } from "@/server/http/api";
import { UpdateBrandKitSchema, deleteBrandKit, getBrandKit, listBrandKitProjects, updateBrandKitInfo } from "@/server/services/brand-kits";

export const dynamic = "force-dynamic";

export const GET = api<{ kitId: string }>(async (_req, { kitId }) => {
  const [brandKit, projects] = await Promise.all([getBrandKit(kitId), listBrandKitProjects(kitId)]);
  return { brandKit, projects };
});

export const PATCH = api<{ kitId: string }>(async (req, { kitId }) => {
  const body = await readJson(req, UpdateBrandKitSchema);
  return { brandKit: await updateBrandKitInfo(kitId, body) };
});

/** Deletes the kit. Projects that followed it keep their brand as a custom brand. */
export const DELETE = api<{ kitId: string }>(async (_req, { kitId }) => {
  await deleteBrandKit(kitId, "user");
  return { ok: true };
});
