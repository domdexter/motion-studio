import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { getCreativeMetrics } from "@/server/services/creative";

export const dynamic = "force-dynamic";

/** Measured creative signals (treatments, repetition, density, text, contrast, intensity). */
export const GET = api<{ id: string }>(async (_req, { id }) => {
  return { metrics: await getCreativeMetrics(assertProjectId(id)) };
});
