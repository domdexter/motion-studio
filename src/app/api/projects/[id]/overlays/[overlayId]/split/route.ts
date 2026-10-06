import { api, readJson } from "@/server/http/api";
import { SplitOverlaySchema, splitOverlayClip } from "@/server/services/overlay-clips";

/** Split an overlay clip at a video second, or cut out a section of it (the rest moves up to close the gap). */
export const POST = api<{ id: string; overlayId: string }>(async (req, { id, overlayId }) => ({ overlays: await splitOverlayClip(id, overlayId, await readJson(req, SplitOverlaySchema), "user") }));
