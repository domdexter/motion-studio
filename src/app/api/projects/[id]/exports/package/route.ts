import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { enqueuePackageExport } from "@/server/services/package-jobs";
import { assertProjectExists } from "@/server/services/projects";

export const dynamic = "force-dynamic";

const PackageSchema = z.object({ includeRenders: z.boolean().default(false) });

/** Queues a zip of the project folder (script, audio, assets, .project specs, optionally renders). */
export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  await assertProjectExists(id);
  const { includeRenders } = await readJson(req, PackageSchema);
  return { job: await enqueuePackageExport(id, includeRenders) };
});
