import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { enqueueThumbnail, ThumbnailRequestSchema } from "@/server/services/renders";

export const dynamic = "force-dynamic";

/** Queues a YouTube thumbnail: a frame of the video with a title and a tag (1280×720 JPEG). */
export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const body = await readJson(req, ThumbnailRequestSchema);
  return { job: await enqueueThumbnail(id, body) };
});
