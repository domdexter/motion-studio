import { AppError } from "@/server/errors";
import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { fulfillAssetRequest, getAssetRequest } from "@/server/services/asset-requests";
import { receiveUpload } from "@/server/storage/upload";

export const dynamic = "force-dynamic";

/** Manually attach result file(s) to a request (e.g. an image generated elsewhere). */
export const POST = api<{ id: string; requestId: string }>(async (req, { id, requestId }) => {
  assertProjectId(id);
  const request = await getAssetRequest(id, requestId);
  const upload = await receiveUpload(req, { categories: [request.kind === "video" ? "video" : "image"], maxFiles: 4 });
  try {
    if (!upload.files.length) throw new AppError("BAD_REQUEST", "Choose at least one file.");
    return await fulfillAssetRequest(
      id,
      requestId,
      upload.files.map((f) => ({ path: f.tmpPath, originalName: f.originalName })),
      "user",
      { source: "upload", move: true },
    );
  } finally {
    await upload.cleanup();
  }
});
