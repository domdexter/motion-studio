import type { Job } from "@/generated/prisma/client";

export interface JobHandlerContext {
  job: Job;
  signal: AbortSignal;
  /** Reports progress 0..1 (NaN = heartbeat only) and optionally a human-readable stage. */
  progress: (value: number, stage?: string) => Promise<void>;
  readonly cancelled: boolean;
}

export type JobHandler = (ctx: JobHandlerContext) => Promise<unknown>;
