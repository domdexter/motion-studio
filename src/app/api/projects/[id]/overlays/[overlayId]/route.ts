import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { OverlayPatchSchema, removeOverlayClip, updateOverlayClip } from "@/server/services/overlay-clips";

export const dynamic = "force-dynamic";

export const PATCH = api<{ id: string; overlayId: string }>(async (req, { id, overlayId }) => {
  assertProjectId(id);
  const body = await readJson(req, OverlayPatchSchema);
  return { overlay: await updateOverlayClip(id, overlayId, body, "user") };
});

export const DELETE = api<{ id: string; overlayId: string }>(async (_req, { id, overlayId }) => {
  await removeOverlayClip(assertProjectId(id), overlayId, "user");
  return { ok: true };
});
