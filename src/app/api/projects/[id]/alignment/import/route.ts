import { AppError } from "@/server/errors";
import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { assertProjectExists } from "@/server/services/projects";
import { importTimingFile } from "@/server/services/transcripts";
import { receiveUpload } from "@/server/storage/upload";

export const dynamic = "force-dynamic";

/** Import existing timestamps (SRT, WebVTT, JSON) for the active voice-over. */
export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  await assertProjectExists(id);
  const upload = await receiveUpload(req, { categories: ["timing"], maxFiles: 1 });
  try {
    const file = upload.files[0];
    if (!file) throw new AppError("BAD_REQUEST", "Choose an SRT, VTT or JSON timing file.");
    return { result: await importTimingFile(id, { tmpPath: file.tmpPath, originalName: file.originalName }, "user") };
  } finally {
    await upload.cleanup();
  }
});
