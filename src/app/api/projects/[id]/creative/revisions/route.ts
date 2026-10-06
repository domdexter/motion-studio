import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { listCreativeRevisions } from "@/server/services/creative";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => {
  return { revisions: await listCreativeRevisions(assertProjectId(id)) };
});
