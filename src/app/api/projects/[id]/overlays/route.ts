import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { AddOverlaySchema, addOverlayClip, listOverlayClips } from "@/server/services/overlay-clips";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => ({ overlays: await listOverlayClips(assertProjectId(id)) }));

export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const body = await readJson(req, AddOverlaySchema);
  return { overlay: await addOverlayClip(id, body, "user") };
});
