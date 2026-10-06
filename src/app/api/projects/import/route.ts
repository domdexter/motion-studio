import { AppError } from "@/server/errors";
import { api } from "@/server/http/api";
import { importProjectPackage } from "@/server/services/package";
import { receiveUpload, validateFileContent } from "@/server/storage/upload";

export const dynamic = "force-dynamic";

/** Import a Motion Studio project package (.zip) as a new project. */
export const POST = api(async (req) => {
  const upload = await receiveUpload(req, { categories: ["package"], maxFiles: 1 });
  try {
    const file = upload.files[0];
    if (!file) throw new AppError("BAD_REQUEST", "Choose a project package (.zip) to import.");
    await validateFileContent(file.tmpPath, file.originalName, "package");
    const id = await importProjectPackage(file.tmpPath, "user");
    return { id };
  } finally {
    await upload.cleanup();
  }
});
