import { api } from "@/server/http/api";
import { suggestActivityZooms } from "@/server/services/activity-zooms";

export const dynamic = "force-dynamic";

/** Zoom suggestions where part of a screen recording changes (typing, clicks, menus). Nothing is saved. */
export const GET = api<{ id: string; assetId: string }>(async (req, { id, assetId }) => {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  return { zooms: await suggestActivityZooms(id, assetId, params) };
});
