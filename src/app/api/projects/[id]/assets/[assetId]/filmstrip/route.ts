import { api } from "@/server/http/api";
import { getAssetFilmstrip } from "@/server/services/filmstrip";

/** Evenly spaced frames of a video (cached), for filmstrips on the timeline lanes. */
export const GET = api<{ id: string; assetId: string }>(async (_req, { id, assetId }) => ({ filmstrip: await getAssetFilmstrip(id, assetId) }));
