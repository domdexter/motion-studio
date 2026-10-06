import { z } from "zod";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { api, readJson } from "@/server/http/api";
import { enqueueJob, publicJob } from "@/server/jobs/queue";
import { whisperStatus } from "@/server/providers/whisper";

export const dynamic = "force-dynamic";

async function latestInstallJob() {
  const job = await db.job.findFirst({ where: { type: "tools.whisper-install" }, orderBy: { createdAt: "desc" } });
  return job ? publicJob(job) : null;
}

export const GET = api(async () => {
  const job = await latestInstallJob();
  return { status: { ...whisperStatus(), job: job ? { status: job.status, progress: job.progress, stage: job.stage, error: job.error } : null } };
});

/** User-triggered: installs whisper.cpp and downloads the chosen model (runs in the worker). */
export const POST = api(async (req) => {
  const { model } = await readJson(req, z.object({ model: z.enum(["tiny.en", "base.en", "small.en", "medium.en", "tiny", "base", "small", "medium"]) }));
  const running = await latestInstallJob();
  if (running && (running.status === "queued" || running.status === "running")) throw new AppError("CONFLICT", "An installation is already in progress.");
  const job = await enqueueJob({ projectId: null, type: "tools.whisper-install", payload: { model } });
  return { job: publicJob(job) };
});
