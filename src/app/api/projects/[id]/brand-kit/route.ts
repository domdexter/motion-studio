import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { applyBrandKitToProject, detachBrandKit } from "@/server/services/brand-kits";

/** Follow a brand kit: its identity, design system and files replace this project's brand. */
export const POST = api<{ id: string }>(async (req, { id }) => {
  const { kitId } = await readJson(req, z.object({ kitId: z.string().min(1) }));
  return { result: await applyBrandKitToProject(assertProjectId(id), kitId, "user") };
});

/** Stop following the kit — the current brand stays and becomes editable for this project only. */
export const DELETE = api<{ id: string }>(async (_req, { id }) => {
  await detachBrandKit(assertProjectId(id), "user");
  return { ok: true };
});
