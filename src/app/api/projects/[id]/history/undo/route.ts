import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { getEditHistory, undoEdit } from "@/server/services/edit-history";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (_req, { id }) => {
  const result = await undoEdit(assertProjectId(id), "user");
  return { result, history: await getEditHistory(id, "user") };
});
