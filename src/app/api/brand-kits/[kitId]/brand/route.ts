import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { updateBrandKitBrand } from "@/server/services/brand-kits";

/** Identity, logo, fonts and references of a kit. Projects following the kit are re-synced. */
export const PATCH = api<{ kitId: string }>(async (req, { kitId }) => {
  const body = await readJson(req, z.record(z.string(), z.unknown()));
  return { brandKit: await updateBrandKitBrand(kitId, body as never, "user") };
});
