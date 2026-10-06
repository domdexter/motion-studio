import os from "node:os";
import "@/server/env";
import { randomId } from "@/server/ids";
import { claimNextJob, completeJob, failJob, recoverStaleJobs, updateJobProgress, type JobError } from "@/server/jobs/queue";
import { writeWorkerHeartbeat } from "@/server/services/system";
import { AppError, isAppError } from "@/server/errors";
import { HANDLERS, type JobHandlerContext } from "./handlers";
import { startBackgroundServices, stopBackgroundServices } from "./background";

/**
 * Motion Studio worker: executes queued jobs (voice generation, alignment, renders, exports),
 * runs the .project file watcher and the optional headless Claude Code executor.
 * Started alongside Next.js by `npm run dev`.
 */

const WORKER_ID = `${os.hostname()}-${process.pid}-${randomId(4)}`;
const startedAt = new Date().toISOString();
// Headless Claude Code runs get their own lane of one, so two Apply fix clicks never edit a project at the same time.
const MAX_CONCURRENT: Record<string, number> = { render: 1, ai: 1, default: 2 };

const running = new Map<string, { type: string; abort: AbortController }>();
let stopping = false;

function lane(type: string): string {
  if (type === "ai.headless") return "ai";
  return type.startsWith("render.") || type === "export.package" ? "render" : "default";
}

function laneBusy(l: string): boolean {
  let count = 0;
  for (const job of running.values()) if (lane(job.type) === l) count++;
  return count >= (MAX_CONCURRENT[l] ?? 1);
}

async function heartbeat() {
  try {
    await writeWorkerHeartbeat({ workerId: WORKER_ID, pid: process.pid, at: new Date().toISOString(), startedAt, handlers: Object.keys(HANDLERS) });
  } catch (err) {
    console.error("[worker] heartbeat failed:", err instanceof Error ? err.message : err);
  }
}

function toJobError(err: unknown, stage?: string): JobError {
  if (isAppError(err)) {
    const e = err as AppError;
    return { message: e.message, code: e.code, hint: e.hint, details: e.details, action: e.action, stage };
  }
  return { message: err instanceof Error ? err.message : String(err), stage };
}

async function runJob(job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>) {
  const handler = HANDLERS[job.type];
  const abort = new AbortController();
  running.set(job.id, { type: job.type, abort });
  let stage: string | undefined;
  const ctx: JobHandlerContext = {
    job,
    signal: abort.signal,
    progress: async (value, nextStage) => {
      if (nextStage) stage = nextStage;
      const cancel = await updateJobProgress(job.id, value, nextStage);
      if (cancel && !abort.signal.aborted) abort.abort();
    },
    get cancelled() {
      return abort.signal.aborted;
    },
  };
  const beat = setInterval(() => void ctx.progress(NaN).catch(() => undefined), 10_000);
  console.log(`[worker] ▶ ${job.type} ${job.id}`);
  try {
    if (!handler) throw new AppError("INTERNAL", `No handler registered for job type ${job.type}.`);
    const result = await handler(ctx);
    if (abort.signal.aborted) await failJob(job.id, { message: "Cancelled.", stage }, true);
    else await completeJob(job.id, result ?? {});
    console.log(`[worker] ✔ ${job.type} ${job.id}`);
  } catch (err) {
    const cancelled = abort.signal.aborted;
    await failJob(job.id, cancelled ? { message: "Cancelled.", stage } : toJobError(err, stage), cancelled).catch((e) => console.error(e));
    console.error(`[worker] ✖ ${job.type} ${job.id}:`, err instanceof Error ? err.message : err);
  } finally {
    clearInterval(beat);
    running.delete(job.id);
  }
}

async function pollLoop() {
  const types = Object.keys(HANDLERS);
  while (!stopping) {
    try {
      const lanes = ["render", "ai", "default"].filter((l) => !laneBusy(l));
      const allowed = types.filter((t) => lanes.includes(lane(t)));
      const job = allowed.length ? await claimNextJob(WORKER_ID, allowed) : null;
      if (job) {
        void runJob(job);
        continue;
      }
    } catch (err) {
      console.error("[worker] poll failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 750));
  }
}

async function main() {
  console.log(`[worker] starting ${WORKER_ID}`);
  const recovered = await recoverStaleJobs().catch(() => 0);
  if (recovered) console.log(`[worker] marked ${recovered} orphaned job(s) as failed`);
  await heartbeat();
  setInterval(heartbeat, 5_000).unref();
  await startBackgroundServices();
  await pollLoop();
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} — stopping`);
  for (const job of running.values()) job.abort.abort();
  await stopBackgroundServices().catch(() => undefined);
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
