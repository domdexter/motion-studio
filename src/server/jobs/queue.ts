import type { Job } from "@/generated/prisma/client";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { newId } from "../ids";
import { bumpRevision } from "../services/mutation";

/**
 * Postgres-backed job queue. Next.js enqueues; the worker claims with FOR UPDATE SKIP LOCKED.
 * Job start/finish bumps the project revision so every open GUI refreshes; progress updates
 * do not (the SSE stream reports progress separately).
 */

export const JOB_TYPES = [
  "voice.generate",
  "voice.preview",
  "alignment.forced",
  "alignment.stt",
  "alignment.whisper",
  "render.video",
  "render.still",
  "render.thumbnail",
  "export.package",
  "tools.whisper-install",
  "ai.headless",
  "audio.generate",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobError {
  message: string;
  code?: string;
  hint?: string;
  details?: unknown;
  action?: { label: string; href: string };
  stage?: string;
}

export async function enqueueJob(input: { projectId?: string | null; type: JobType; payload: unknown }): Promise<Job> {
  const job = await db.job.create({
    data: { id: newId.job(), projectId: input.projectId ?? null, type: input.type, payload: json(input.payload ?? {}) },
  });
  if (input.projectId) await bumpRevision(input.projectId);
  return job;
}

export async function getJob(jobId: string): Promise<Job> {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw notFound("Job");
  return job;
}

export function publicJob(job: Job) {
  return {
    id: job.id,
    projectId: job.projectId,
    type: job.type,
    status: job.status as JobStatus,
    progress: job.progress,
    stage: job.stage,
    result: job.result,
    error: job.error as JobError | null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}
export type PublicJob = ReturnType<typeof publicJob>;

export async function listJobs(projectId: string, options: { types?: string[]; limit?: number } = {}) {
  const jobs = await db.job.findMany({
    where: { projectId, ...(options.types ? { type: { in: options.types } } : {}) },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 30,
  });
  return jobs.map(publicJob);
}

export async function requestCancel(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (job.status === "queued") {
    await db.job.update({ where: { id: jobId }, data: { status: "cancelled", finishedAt: new Date(), cancelRequested: true } });
    if (job.projectId) await bumpRevision(job.projectId);
  } else if (job.status === "running") {
    await db.job.update({ where: { id: jobId }, data: { cancelRequested: true } });
  } else {
    throw new AppError("CONFLICT", `Job is already ${job.status}.`);
  }
}

export async function claimNextJob(workerId: string, types: readonly string[]): Promise<Job | null> {
  const rows = await db.$queryRaw<Job[]>`
    UPDATE "Job"
       SET "status" = 'running', "workerId" = ${workerId}, "startedAt" = now(), "heartbeatAt" = now(), "attempts" = "attempts" + 1
     WHERE "id" = (
       SELECT "id" FROM "Job"
        WHERE "status" = 'queued' AND "type" = ANY(${types as string[]})
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1)
    RETURNING *`;
  const job = rows[0] ?? null;
  if (job?.projectId) await bumpRevision(job.projectId);
  return job;
}

export async function updateJobProgress(jobId: string, progress: number, stage?: string): Promise<boolean> {
  const job = await db.job.update({
    where: { id: jobId },
    // NaN/Infinity = heartbeat only: never overwrite the stored progress with a non-number.
    data: { ...(Number.isFinite(progress) ? { progress: Math.max(0, Math.min(1, progress)) } : {}), ...(stage !== undefined ? { stage } : {}), heartbeatAt: new Date() },
    select: { cancelRequested: true },
  });
  return job.cancelRequested;
}

export async function completeJob(jobId: string, result: unknown): Promise<void> {
  const job = await db.job.update({
    where: { id: jobId },
    data: { status: "succeeded", progress: 1, result: json(result ?? {}), finishedAt: new Date() },
  });
  if (job.projectId) await bumpRevision(job.projectId);
}

export async function failJob(jobId: string, error: JobError, cancelled = false): Promise<void> {
  const job = await db.job.update({
    where: { id: jobId },
    data: { status: cancelled ? "cancelled" : "failed", error: json(error), finishedAt: new Date() },
  });
  if (job.projectId) await bumpRevision(job.projectId);
}

/** Jobs left "running" by a worker that died are failed so the user can retry explicitly. */
export async function recoverStaleJobs(maxSilenceMs = 90_000): Promise<number> {
  const cutoff = new Date(Date.now() - maxSilenceMs);
  const stale = await db.job.findMany({ where: { status: "running", OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null }] } });
  for (const job of stale) {
    await failJob(job.id, { message: "The worker stopped while this job was running.", hint: "Retry the action." });
  }
  return stale.length;
}

export async function latestJob(projectId: string, types: string[]) {
  const job = await db.job.findFirst({ where: { projectId, type: { in: types } }, orderBy: { createdAt: "desc" } });
  return job ? publicJob(job) : null;
}
