"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { PublicJob } from "@/server/jobs/queue";
import { http } from "@/lib/api-client";
import { useWorkspace } from "./workspace-shell";

export const TERMINAL_JOB_STATUSES = ["succeeded", "failed", "cancelled"];

/**
 * Tracks one background job: live progress from the project SSE stream, authoritative final
 * status (and error details) from /api/jobs/:id. Calls onFinished once when it ends.
 */
export function useJob(jobId: string | null, onFinished?: (job: PublicJob) => void) {
  const { live, projectId } = useWorkspace();
  const queryClient = useQueryClient();
  const liveJob = jobId ? live.jobs.find((j) => j.id === jobId) : undefined;
  const query = useQuery({
    queryKey: ["job", jobId],
    queryFn: async () => (await http.get<{ job: PublicJob }>(`/api/jobs/${jobId}`)).job,
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && !TERMINAL_JOB_STATUSES.includes(q.state.data.status) ? 1500 : false),
  });
  const base = query.data ?? null;
  const job = base
    ? {
        ...base,
        progress: liveJob && !Number.isNaN(liveJob.progress) ? liveJob.progress : base.progress,
        stage: liveJob?.stage ?? base.stage,
        status: TERMINAL_JOB_STATUSES.includes(base.status) ? base.status : ((liveJob?.status as PublicJob["status"]) ?? base.status),
      }
    : null;

  const finishedRef = useRef<string | null>(null);
  const callback = useRef(onFinished);
  callback.current = onFinished;
  useEffect(() => {
    if (base && TERMINAL_JOB_STATUSES.includes(base.status) && finishedRef.current !== base.id) {
      finishedRef.current = base.id;
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      callback.current?.(base);
    }
  }, [base, projectId, queryClient]);

  // refetch is stable; the query result object itself is a new proxy on every render.
  const { refetch } = query;
  // When the live stream says the job left the active list, refresh the final state promptly.
  const wasLive = useRef(false);
  useEffect(() => {
    if (liveJob) wasLive.current = true;
    else if (wasLive.current && jobId) {
      wasLive.current = false;
      void refetch();
    }
  }, [liveJob, jobId, refetch]);

  return { job, active: !!job && !TERMINAL_JOB_STATUSES.includes(job.status), loading: query.isLoading };
}
