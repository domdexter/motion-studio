import { enqueueJob, publicJob } from "../jobs/queue";
import type { JobHandlerContext } from "../jobs/types";
import { exportProjectPackage } from "./package";
import { fileUrl } from "./projects";
import { recordActivity } from "./mutation";
import { formatBytesServer } from "./format-server";

export async function enqueuePackageExport(projectId: string, includeRenders: boolean) {
  return publicJob(await enqueueJob({ projectId, type: "export.package", payload: { includeRenders } }));
}

export async function runPackageExport(ctx: JobHandlerContext) {
  const projectId = ctx.job.projectId!;
  const { includeRenders } = ctx.job.payload as { includeRenders?: boolean };
  await ctx.progress(0.02, "Collecting project files");
  const out = await exportProjectPackage(projectId, {
    includeRenders: !!includeRenders,
    signal: ctx.signal,
    onProgress: (f) => void ctx.progress(0.05 + f * 0.93, "Packaging files"),
  });
  await recordActivity(projectId, "worker", { type: "export.package", message: `Exported project package (${formatBytesServer(out.sizeBytes)})`, data: out });
  return { ...out, url: fileUrl(projectId, out.relPath) };
}
