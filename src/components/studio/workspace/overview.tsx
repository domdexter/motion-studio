"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bot, Check, ClipboardCheck, Compass, Copy, FileCode2, Pencil, User, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WORKFLOW_INFO, type Workflow } from "@/core/spec/enums";
import { STAGE_KEYS } from "@/core/status/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, http } from "@/lib/api-client";
import { formatDuration, relativeTime } from "@/lib/format";
import { useProject } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { ErrorState, Panel } from "../common";
import { IntensityDots, useCreativeMetrics, useCreativePlan, useCreativeReviews } from "../creative/shared";
import { StageIcon, StatusPill } from "../status";
import { STAGE_LABELS, STAGE_ROUTES } from "./nav";

interface ActivityItem {
  id: string;
  actor: string;
  type: string;
  message: string;
  createdAt: string;
}

const ACTOR_STYLES: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  user: { label: "You", className: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300", icon: <User className="size-3" /> },
  claude: { label: "Claude", className: "bg-primary/15 text-primary", icon: <Bot className="size-3" /> },
  file: { label: "File edit", className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300", icon: <FileCode2 className="size-3" /> },
  worker: { label: "Worker", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: <WorkflowIcon className="size-3" /> },
  system: { label: "System", className: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400", icon: <WorkflowIcon className="size-3" /> },
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}

export function ActivityFeed({ projectId, limit = 25 }: { projectId: string; limit?: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["project", projectId, "activity", limit],
    queryFn: () => http.get<{ activities: ActivityItem[] }>(`/api/projects/${projectId}/activity?limit=${limit}`),
  });
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  if (isLoading) return <Skeleton className="h-40" />;
  if (!data?.activities.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="space-y-3">
      {data.activities.map((a) => {
        const actor = ACTOR_STYLES[a.actor] ?? ACTOR_STYLES.system;
        return (
          <li key={a.id} className="flex gap-3 text-sm">
            <span className={cn("mt-0.5 inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium", actor.className)}>
              {actor.icon}
              {actor.label}
            </span>
            <div className="min-w-0">
              <p className="leading-snug">{a.message}</p>
              <p className="text-xs text-muted-foreground" title={new Date(a.createdAt).toLocaleString()}>
                {relativeTime(a.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function Overview({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: project, error, refetch } = useProject(projectId);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState<string | null>(null);

  useEffect(() => {
    if (project && brief === null) setBrief(project.brief);
  }, [project, brief]);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => http.patch(`/api/projects/${projectId}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
    onError: (e) => toast.error("Could not save", { description: errorMessage(e) }),
  });
  const planQ = useCreativePlan(projectId);
  const metricsQ = useCreativeMetrics(projectId);
  const reviewsQ = useCreativeReviews(projectId);

  if (error) return <div className="p-6"><ErrorState error={error} onRetry={() => void refetch()} /></div>;
  if (!project) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const pipeline = project.state.pipeline;
  const cliContext = `npm run studio -- context ${project.id}`;

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {editingName ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && name.trim() !== project.name) patch.mutate({ name: name.trim() }, { onSuccess: () => toast.success("Renamed") });
                setEditingName(false);
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="h-9 w-[28rem] text-lg font-semibold" onBlur={() => setEditingName(false)} maxLength={120} />
            </form>
          ) : (
            <button
              type="button"
              className="group flex items-center gap-2 text-left"
              onClick={() => {
                setName(project.name);
                setEditingName(true);
              }}
            >
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <Pencil className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusPill status={pipeline.status} />
            <span>
              {project.width}×{project.height} · {project.aspect}
            </span>
            <span>·</span>
            <span>{project.fps} fps</span>
            <span>·</span>
            <span>{project.state.durationSec ? formatDuration(project.state.durationSec) : "Duration set by voice-over"}</span>
            <span>·</span>
            <span>Updated {relativeTime(project.updatedAt)}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] to-transparent p-5">
            <p className="text-xs font-medium tracking-wider text-primary uppercase">Next step</p>
            {pipeline.next ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{pipeline.next.label}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{pipeline.stages[pipeline.next.stage].reason ?? `${STAGE_LABELS[pipeline.next.stage]}: ${pipeline.stages[pipeline.next.stage].label}`}</p>
                </div>
                <Button asChild>
                  <Link href={`/projects/${projectId}${STAGE_ROUTES[pipeline.next.stage]}`}>
                    Go to {STAGE_LABELS[pipeline.next.stage]} <ArrowRight />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="mt-2">
                <h2 className="text-lg font-semibold">{pipeline.status === "COMPLETE" ? "Final render is up to date" : "Work in progress"}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{pipeline.status === "COMPLETE" ? "Download it from Render, or keep iterating — staleness is tracked automatically." : "A background job is running."}</p>
              </div>
            )}
          </section>

          <Panel title="Production pipeline" description="Derived from the actual project state. Stale stages are downstream of a change.">
            <ol className="divide-y divide-border">
              {STAGE_KEYS.map((key) => {
                const stage = pipeline.stages[key];
                return (
                  <li key={key}>
                    <Link href={`/projects/${projectId}${STAGE_ROUTES[key]}`} className="flex items-center gap-3 rounded-md px-1 py-2.5 hover:bg-muted/40">
                      <StageIcon stage={stage} />
                      <span className="w-24 text-sm font-medium">{STAGE_LABELS[key]}</span>
                      <span className="flex-1 truncate text-sm text-muted-foreground">
                        {stage.label}
                        {stage.reason ? <span className="text-muted-foreground/70"> — {stage.reason}</span> : null}
                      </span>
                      <ArrowRight className="size-3.5 text-muted-foreground/50" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </Panel>

          <Panel
            title="Creative direction"
            description="The global intent every scene inherits, and how the video measures against it."
            actions={
              <div className="flex gap-1.5">
                <Button size="xs" variant="outline" asChild>
                  <Link href={`/projects/${projectId}/direction`}>
                    <Compass /> Direction
                  </Link>
                </Button>
                <Button size="xs" variant="outline" asChild>
                  <Link href={`/projects/${projectId}/review`}>
                    <ClipboardCheck /> Creative QA
                  </Link>
                </Button>
              </div>
            }
          >
            {planQ.data?.plan.direction ? (
              <div className="space-y-3">
                <div>
                  <p className="text-lg font-semibold tracking-tight text-balance">{planQ.data.plan.direction.concept}</p>
                  {planQ.data.plan.direction.coreMessage ? <p className="mt-1 text-sm text-muted-foreground">{planQ.data.plan.direction.coreMessage}</p> : null}
                </div>
                {planQ.data.plan.storyArc ? (
                  <div className="flex flex-wrap gap-1.5">
                    {planQ.data.plan.storyArc.acts.map((a) => (
                      <span key={a.id} className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
                        {a.name}
                        <IntensityDots value={a.intensity} />
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No creative direction yet — plan the concept, story arc and visual language before designing scenes.</p>
            )}
            {metricsQ.data?.scenes.length ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                <span>
                  {metricsQ.data.coverage.scenesWithIntent}/{metricsQ.data.coverage.scenes} scenes with creative intent
                </span>
                <span>{metricsQ.data.counts.high + metricsQ.data.counts.medium} measured findings to check</span>
                {reviewsQ.data?.[0] ? (
                  <span>
                    Latest review v{reviewsQ.data[0].version}: {reviewsQ.data[0].issues.filter((i) => i.status === "open" || i.status === "accepted").length} open issue(s)
                    {reviewsQ.data[0].stale ? " · video changed since" : ""}
                  </span>
                ) : (
                  <span>No written review yet</span>
                )}
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Creative brief"
            description="Goals, audience, tone and must-haves. Claude reads this before generating anything."
            actions={
              brief !== null && brief !== project.brief ? (
                <Button size="xs" onClick={() => patch.mutate({ brief }, { onSuccess: () => toast.success("Brief saved") })} disabled={patch.isPending}>
                  Save brief
                </Button>
              ) : null
            }
          >
            <Textarea
              value={brief ?? ""}
              onChange={(e) => setBrief(e.target.value)}
              rows={6}
              placeholder={"Audience: small business owners\nGoal: announce the Incep Platform launch and drive sign-ups\nTone: confident, calm, premium\nMust include: logo end card, website URL"}
            />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Details">
            <dl className="space-y-2 text-sm">
              {[
                ["Started from", WORKFLOW_INFO[project.workflow as Workflow]?.label ?? project.workflow],
                ["Scenes", `${project.state.counts.approvedScenes}/${project.state.counts.scenes} approved`],
                ["Assets", String(project.state.counts.assets)],
                ["Voice-over", project.voice ? `v${project.voice.version} · ${project.voice.source}` : "—"],
                ["Renders", String(project.state.counts.renders)],
                ["Created", new Date(project.createdAt).toLocaleDateString()],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Claude Code context" description="Claude Code reads and edits this project through files and the studio CLI.">
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Project folder</p>
                <div className="mt-1 flex items-center gap-1 rounded-md bg-muted/50 px-2 py-1">
                  <code className="flex-1 truncate font-mono text-[11px]" title={project.folder}>
                    {project.folder}
                  </code>
                  <CopyButton value={project.folder} label="Copy folder path" />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Print context in Claude Code</p>
                <div className="mt-1 flex items-center gap-1 rounded-md bg-muted/50 px-2 py-1">
                  <code className="flex-1 truncate font-mono text-[11px]">{cliContext}</code>
                  <CopyButton value={cliContext} label="Copy command" />
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Recent activity">
            <ActivityFeed projectId={projectId} limit={15} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
