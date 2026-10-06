import { api } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { activateVoiceTake } from "@/server/services/voice";

export const POST = api<{ id: string; takeId: string }>(async (_req, { id, takeId }) => ({
  result: await activateVoiceTake(assertProjectId(id), assertId(takeId, "voice take id"), "user"),
}));
