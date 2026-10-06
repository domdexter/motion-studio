import { api, readJson } from "@/server/http/api";
import { CreateBrandKitSchema, createBrandKit, listBrandKits } from "@/server/services/brand-kits";

export const dynamic = "force-dynamic";

export const GET = api(async () => ({ brandKits: await listBrandKits() }));

/** Create a brand kit — blank from a design preset, or saved from a project's brand (`fromProjectId`). */
export const POST = api(async (req) => {
  const body = await readJson(req, CreateBrandKitSchema);
  return { brandKit: await createBrandKit(body, "user") };
});
