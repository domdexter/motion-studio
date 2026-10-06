import { AppError } from "@/server/errors";
import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { restoreCreativeRevision } from "@/server/services/creative";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string; version: string }>(async (_req, { id, version }) => {
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) throw new AppError("BAD_REQUEST", "Invalid version.");
  return restoreCreativeRevision(assertProjectId(id), v, "user");
});
