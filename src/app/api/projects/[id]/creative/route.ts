import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { applyCreativePlan, getCreativePlan } from "@/server/services/creative";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => {
  return { plan: await getCreativePlan(assertProjectId(id)) };
});

const PutSchema = z.object({
  plan: z.record(z.string(), z.unknown()),
  mode: z.enum(["merge", "replace"]).default("merge"),
  note: z.string().max(500).optional(),
});

/** Saves the creative plan as a new revision (merge replaces only the sections sent). */
export const PUT = api<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, PutSchema);
  return applyCreativePlan(assertProjectId(id), body.plan, "user", { mode: body.mode, note: body.note });
});
