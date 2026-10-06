import { api } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { deleteVoiceTake } from "@/server/services/voice";

export const DELETE = api<{ id: string; takeId: string }>(async (_req, { id, takeId }) => {
  await deleteVoiceTake(assertProjectId(id), assertId(takeId, "voice take id"), "user");
  return { ok: true };
});
