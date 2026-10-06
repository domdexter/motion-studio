"use client";

import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { JobError, PublicJob } from "@/server/jobs/queue";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { ErrorState } from "../common";

export function jobErrorToApiError(error: JobError | null | undefined): ApiError {
  return new ApiError({ code: error?.code ?? "JOB_FAILED", message: error?.message ?? "The job failed.", details: error?.details, hint: error?.hint, action: error?.action }, 500);
}

/** Inline status for a tracked job: progress while active, full error with retry when failed. */
export function JobStatus({ job, label, failedTitle, onRetry, onDismiss }: { job: PublicJob | null; label: string; failedTitle?: string; onRetry?: () => void; onDismiss?: () => void }) {
  if (!job) return null;
  if (job.status === "queued" || job.status === "running") {
    return (
      <div className="space-y-2 rounded-lg border border-info/30 bg-info/5 p-3">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin text-info" />
          <span>{label}</span>
          <span className="text-muted-foreground">{job.status === "queued" ? "— waiting for the worker" : job.stage ? `— ${job.stage}` : ""}</span>
          <span className="ml-auto font-mono text-xs text-muted-foreground tabular">{Math.round((job.progress || 0) * 100)}%</span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Cancel"
            onClick={() =>
              http
                .post(`/api/jobs/${job.id}/cancel`)
                .then(() => toast.info("Cancelling…"))
                .catch((e) => toast.error(errorMessage(e)))
            }
          >
            <X />
          </Button>
        </div>
        <Progress value={Math.max(3, (job.progress || 0) * 100)} className="h-1" />
      </div>
    );
  }
  if (job.status === "failed") {
    return (
      <div className="relative">
        <ErrorState error={jobErrorToApiError(job.error)} title={failedTitle ?? `${label} failed${job.error?.stage ? ` (${job.error.stage})` : ""}`} onRetry={onRetry} />
        {onDismiss ? (
          <Button size="icon-xs" variant="ghost" className="absolute top-2 right-2" aria-label="Dismiss" onClick={onDismiss}>
            <X />
          </Button>
        ) : null}
      </div>
    );
  }
  return null;
}
