import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { applyBrandKitPreset, updateBrandKitDesign } from "@/server/services/brand-kits";

const Body = z.union([
  z.object({ preset: z.string().min(1), keepColors: z.boolean().default(false), keepFonts: z.boolean().default(false) }),
  z.object({ design: z.record(z.string(), z.unknown()) }),
]);

/** Apply a named preset or replace the kit's design system. Projects following the kit are re-synced. */
export const PATCH = api<{ kitId: string }>(async (req, { kitId }) => {
  const body = await readJson(req, Body);
  if ("preset" in body) return { brandKit: await applyBrandKitPreset(kitId, body.preset, { keepColors: body.keepColors, keepFonts: body.keepFonts }, "user") };
  return { brandKit: await updateBrandKitDesign(kitId, body.design, "user") };
});
