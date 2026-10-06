import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { applyDesignPreset, updateDesign } from "@/server/services/brand";

const Body = z.union([
  z.object({ preset: z.string().min(1), keepColors: z.boolean().default(false), keepFonts: z.boolean().default(false) }),
  z.object({ design: z.record(z.string(), z.unknown()) }),
]);

/** Either apply a named preset or replace the whole design system (validated). */
export const PATCH = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const body = await readJson(req, Body);
  if ("preset" in body) return { design: await applyDesignPreset(id, body.preset, { keepColors: body.keepColors, keepFonts: body.keepFonts }, "user") };
  return { design: await updateDesign(id, body.design, "user") };
});
