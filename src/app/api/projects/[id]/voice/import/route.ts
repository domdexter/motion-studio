import { AppError } from "@/server/errors";
import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { assertProjectExists } from "@/server/services/projects";
import { importVoiceFile } from "@/server/services/voice";
import { receiveUpload } from "@/server/storage/upload";

export const dynamic = "force-dynamic";

/** Import an existing voice-over (human, client-provided or another AI provider). */
export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  await assertProjectExists(id);
  const upload = await receiveUpload(req, { categories: ["audio"], maxFiles: 1 });
  try {
    const file = upload.files[0];
    if (!file) throw new AppError("BAD_REQUEST", "Choose an audio file to import.");
    return { take: await importVoiceFile(id, { tmpPath: file.tmpPath, originalName: file.originalName }, "user") };
  } finally {
    await upload.cleanup();
  }
});
