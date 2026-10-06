import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { listSnapshots, saveSnapshot } from "@/server/services/snapshots";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => ({ snapshots: await listSnapshots(assertProjectId(id)) }));

export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const { label } = await readJson(req, z.object({ label: z.string().max(120).default("") }));
  return { snapshot: await saveSnapshot(id, label, "user") };
});
