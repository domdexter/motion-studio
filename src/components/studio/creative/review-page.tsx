"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCheck, ChevronDown, ClipboardCheck, Loader2, RotateCcw, Sparkles, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { SCORE_KEYS } from "@/core/creative/schema";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CreativeReviewDto } from "@/server/services/creative-reviews";
import type { TaskDto } from "@/server/services/tasks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, PageHeader, Panel } from "../common";
import { ArcStrip, DistributionBars, FamilySwatch, FindingItem, REVIEW_PRESETS, SeverityBadge, familyLabel, treatmentLabel, useCreativeMetrics, useCreativePlan, useCreativeReviews } from "./shared";

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

const STATUS_CLASS: Record<string, string> = {
  open: "bg-muted text-muted-foreground",
  accepted: "bg-info/15 text-info",
  dismissed: "bg-muted text-muted-foreground line-through",
  resolved: "bg-success/15 text-success",
};

/** The newest refinement task that covers this issue (Apply fix or a bulk refinement). */
function fixTaskFor(tasks: TaskDto[], reviewId: string, issueId: string): TaskDto | null {
  return tasks.filter((t) => t.type === "refine_creative" && t.scope.reviewId === reviewId && t.scope.issueIds?.includes(issueId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

function ReviewPanel({ projectId, review, tasks }: { projectId: string; review: CreativeReviewDto; tasks: TaskDto[] }) {
  const queryClient = useQueryClient();
  const applyFix = useMutation({
    mutationFn: (issueId: string) => http.post<{ task: TaskDto }>(`/api/projects/${projectId}/creative/reviews/${review.id}/refine`, { issueIds: [issueId], executor: "headless" }),
    onSuccess: () => {
      toast.success("Claude is fixing it in the background", { description: "Only the affected scene changes, inside its timing. The issue is marked resolved when the fix is done." });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: fail,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refineOpen, setRefineOpen] = useState(false);
  const [note, setNote] = useState("");
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  const setStatus = useMutation({
    mutationFn: (body: { issueIds: string[]; status: "open" | "accepted" | "dismissed" | "resolved" }) => http.patch(`/api/projects/${projectId}/creative/reviews/${review.id}/issues`, body),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
    onError: fail,
  });
  const refine = useMutation({
    mutationFn: () => http.post<{ task: TaskDto }>(`/api/projects/${projectId}/creative/reviews/${review.id}/refine`, { issueIds: [...selected], instruction: note.trim() || undefined }),
    onSuccess: ({ task }) => {
      toast.success("Refinement sent to Claude Code", { description: `“${task.title}” — ${task.executor === "headless" ? "running in the background" : "waiting for Claude Code (npm run studio -- tasks)"}. Timing and voice are kept; locked scenes are never touched.` });
      setRefineOpen(false);
      setNote("");
      setSelected(new Set());
      invalidate();
    },
    onError: fail,
  });
  const actionable = review.issues.filter((i) => i.status === "open" || i.status === "accepted");
  const scores = SCORE_KEYS.filter((k) => review.scores[k] !== undefined);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          {review.title || review.request || "Creative review"}
          <span className="font-mono text-xs font-normal text-muted-foreground">v{review.version}</span>
          {review.stale ? <span className="rounded bg-stale/15 px-1.5 py-0.5 text-[10px] font-normal text-stale">video changed since this review</span> : null}
        </span>
      }
      description={`${review.source === "claude" ? "Written by Claude Code" : "Written by you"} · ${relativeTime(review.createdAt)}${review.request && review.title ? ` · asked: “${review.request}”` : ""}`}
    >
      <div className="grid gap-5 md:grid-cols-[1fr_220px]">
        <div className="min-w-0 space-y-4">
          <p className="text-sm leading-relaxed whitespace-pre-line">{review.summary}</p>
          {review.strengths.length ? (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground">Strengths</h4>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                {review.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {review.weakestScenes.length ? (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">Weakest scenes</span>
              {review.weakestScenes.map((k) => (
                <Link key={k} href={`/projects/${projectId}/scenes?scene=${k}`} className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-mono text-xs text-warning hover:underline">
                  {k}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        {review.overallScore !== null || scores.length ? (
          <div className="rounded-lg border border-border p-3">
            {review.overallScore !== null ? (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">{review.overallScore}</span>
                <span className="text-xs text-muted-foreground">advisory score</span>
              </div>
            ) : null}
            <div className="mt-2 space-y-1.5">
              {scores.map((k) => (
                <div key={k} className="grid grid-cols-[84px_1fr_24px] items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground capitalize">{k}</span>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${review.scores[k]}%` }} />
                  </div>
                  <span className="text-right tabular-nums">{review.scores[k]}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">Scores summarize the written critique — the issues below are what matters.</p>
          </div>
        ) : null}
      </div>

      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Issues ({actionable.length} open of {review.issues.length})</h4>
          {selected.size ? (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              <Button size="xs" onClick={() => setRefineOpen(true)}>
                <Wand2 /> Apply refinement
              </Button>
              <Button size="xs" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ issueIds: [...selected], status: "dismissed" })}>
                <X /> Dismiss
              </Button>
              <Button size="xs" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ issueIds: [...selected], status: "resolved" })}>
                <CheckCheck /> Resolved
              </Button>
            </div>
          ) : actionable.length ? (
            <span className="ml-auto text-[11px] text-muted-foreground">Select issues to send an explicit refinement task to Claude.</span>
          ) : null}
        </div>
        {review.issues.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {review.issues.map((issue) => {
              const closed = issue.status === "dismissed" || issue.status === "resolved";
              const fix = closed ? null : fixTaskFor(tasks, review.id, issue.id);
              const fixing = !!fix && (fix.status === "pending" || fix.status === "running");
              const lastStep = fixing ? fix.log[fix.log.length - 1]?.text.split("\n").pop() : undefined;
              return (
                <li key={issue.id} className={cn("flex gap-3 px-3 py-2.5", closed && "opacity-60")}>
                  <Checkbox className="mt-0.5" checked={selected.has(issue.id)} disabled={closed} onCheckedChange={() => toggle(issue.id)} aria-label={`Select issue ${issue.id}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SeverityBadge severity={issue.severity} />
                      <span className="text-[11px] text-muted-foreground capitalize">{issue.category}</span>
                      {issue.scene ? (
                        <Link href={`/projects/${projectId}/scenes?scene=${issue.scene}`} className="font-mono text-xs text-primary hover:underline">
                          {issue.scene}
                          {issue.shot ? `/${issue.shot}` : ""}
                        </Link>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">whole video</span>
                      )}
                      <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[10px] capitalize", STATUS_CLASS[issue.status])}>{issue.status}</span>
                    </div>
                    <p className="mt-1 text-sm">{issue.issue}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">→ {issue.recommendation}</p>
                    {issue.evidence ? <p className="mt-0.5 text-xs text-muted-foreground italic">Evidence: {issue.evidence}</p> : null}
                    {fixing ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-info">
                        <Loader2 className="size-3.5 shrink-0 animate-spin" />
                        <span className="truncate">{fix.status === "pending" ? (fix.executor === "headless" ? "Queued, fixes run one at a time…" : "Waiting for Claude Code…") : `Fixing… ${lastStep ?? ""}`}</span>
                      </p>
                    ) : fix?.status === "failed" ? (
                      <p className="mt-1.5 text-xs text-destructive" title={fix.error ?? undefined}>
                        The fix failed: {(fix.error ?? "Claude could not finish.").slice(0, 160)}
                      </p>
                    ) : fix?.status === "completed" ? (
                      <p className="mt-1.5 text-xs text-muted-foreground" title={fix.resultSummary ?? undefined}>
                        Claude finished a fix{fix.resultSummary ? `: ${fix.resultSummary.slice(0, 160)}` : ""}. Check the scene, then mark it resolved or apply the fix again.
                      </p>
                    ) : null}
                  </div>
                  {closed ? (
                    <Button size="icon-xs" variant="ghost" title="Reopen" aria-label="Reopen issue" onClick={() => setStatus.mutate({ issueIds: [issue.id], status: "open" })}>
                      <RotateCcw />
                    </Button>
                  ) : fixing ? null : (
                    <Button
                      size="xs"
                      variant={fix?.status === "failed" ? "outline" : "secondary"}
                      className="shrink-0 self-start"
                      disabled={applyFix.isPending && applyFix.variables === issue.id}
                      onClick={() => applyFix.mutate(issue.id)}
                      title="Send this issue to Claude and fix it in the background"
                    >
                      {applyFix.isPending && applyFix.variables === issue.id ? <Loader2 className="animate-spin" /> : <Wand2 />}
                      {fix?.status === "failed" ? "Try again" : "Apply fix"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No issues recorded.</p>
        )}
      </div>

      <Dialog open={refineOpen} onOpenChange={setRefineOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply refinement</DialogTitle>
            <DialogDescription>
              Creates an explicit task for Claude Code with the {selected.size} selected issue{selected.size === 1 ? "" : "s"} and their recommendations. Only the affected scenes change, inside their existing timing; locked scenes are never modified. Every change is versioned.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional direction, e.g. keep the product screens exactly as they are." />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRefineOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => refine.mutate()} disabled={refine.isPending}>
              {refine.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Send to Claude
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

export function ReviewPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const metricsQ = useCreativeMetrics(projectId);
  const reviewsQ = useCreativeReviews(projectId);
  const planQ = useCreativePlan(projectId);
  const tasksQ = useQuery({ queryKey: ["project", projectId, "tasks"], queryFn: async () => (await http.get<{ tasks: TaskDto[] }>(`/api/projects/${projectId}/tasks`)).tasks, refetchInterval: 5000 });
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [showInfo, setShowInfo] = useState(false);

  const request = useMutation({
    mutationFn: (text: string) => http.post<{ task: TaskDto }>(`/api/projects/${projectId}/creative/reviews`, { request: text }),
    onSuccess: ({ task }) => {
      toast.success("Review requested", { description: `“${task.title}” — ${task.executor === "headless" ? "Claude is reviewing in the background" : "waiting for Claude Code (npm run studio -- tasks)"}. Nothing in the video changes.` });
      setCustomOpen(false);
      setQuestion("");
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: fail,
  });

  if (metricsQ.error) return <div className="p-6"><ErrorState error={metricsQ.error} onRetry={() => void metricsQ.refetch()} /></div>;
  const metrics = metricsQ.data;
  const reviews = reviewsQ.data ?? [];
  const review = reviews.find((r) => r.id === reviewId) ?? reviews[0] ?? null;
  const activeTasks = (tasksQ.data ?? []).filter((t) => ["creative_review", "refine_creative", "plan_creative"].includes(t.type) && (t.status === "pending" || t.status === "running"));
  const findings = (metrics?.findings ?? []).filter((f) => showInfo || f.severity !== "info");

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-6">
      <PageHeader
        title="Creative QA"
        description="Measured signals computed from the scenes, and written reviews from Claude Code. Nothing here changes the video until you send a refinement."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={request.isPending || !metrics?.scenes.length}>
                {request.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Request a review <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Claude reviews without changing anything</DropdownMenuLabel>
              {REVIEW_PRESETS.map((p) => (
                <DropdownMenuItem key={p} onClick={() => request.mutate(p)}>
                  {p}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCustomOpen(true)}>Ask your own question…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {activeTasks.length ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-2.5 text-sm">
          <Loader2 className="size-4 animate-spin text-info" />
          <span>
            {activeTasks.map((t) => t.title).join(" · ")} —{" "}
            {activeTasks.some((t) => t.status === "running")
              ? "in progress"
              : activeTasks.every((t) => t.executor === "headless")
                ? "queued, starting in the background"
                : "waiting for Claude Code"}
          </span>
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => window.dispatchEvent(new CustomEvent("studio:command-bar", { detail: { view: "tasks" } }))}>
            View tasks
          </Button>
        </div>
      ) : null}

      {!metrics ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : !metrics.scenes.length ? (
        <EmptyState icon={<ClipboardCheck />} title="Nothing to review yet" description="Generate the storyboard first — Creative QA measures and reviews the scenes." action={<Button size="sm" asChild><Link href={`/projects/${projectId}/storyboard`}>Open Storyboard</Link></Button>} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-5">
            {review ? (
              <ReviewPanel key={review.id} projectId={projectId} review={review} tasks={tasksQ.data ?? []} />
            ) : (
              <EmptyState
                icon={<Sparkles />}
                title="No written review yet"
                description="A review is a senior-motion-designer critique written by Claude Code from real frames and the measured signals: issues, recommendations and an advisory score. Request one above."
              />
            )}

            <Panel title="Story arc & rhythm" description="Acts from the plan, measured treatment per scene, and intensity — measured (solid) against planned (dashed).">
              <ArcStrip projectId={projectId} metrics={metrics} plan={planQ.data?.plan ?? null} />
            </Panel>

            <Panel title="Scenes — planned vs measured" bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-panel text-left text-[11px] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-normal">Scene</th>
                      <th className="px-3 py-2 font-normal">Treatment</th>
                      <th className="px-3 py-2 font-normal">Density</th>
                      <th className="px-3 py-2 font-normal">Intensity</th>
                      <th className="px-3 py-2 font-normal">Burst</th>
                      <th className="px-3 py-2 font-normal">Words</th>
                      <th className="px-3 py-2 font-normal">Shots</th>
                      <th className="px-3 py-2 font-normal">Layout</th>
                      <th className="px-3 py-2 font-normal">Findings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.scenes.map((s) => {
                      const serious = s.findings.filter((f) => f.severity === "high" || f.severity === "medium").length;
                      return (
                        <tr key={s.key} className="border-t border-border align-top">
                          <td className="px-3 py-2">
                            <Link href={`/projects/${projectId}/scenes?scene=${s.key}`} className="font-mono text-xs text-primary hover:underline">
                              {s.key}
                            </Link>
                            <div className="max-w-44 truncate text-xs text-muted-foreground">{s.name}</div>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <div className="flex items-center gap-1.5">
                              <FamilySwatch family={s.detected.family} /> {familyLabel(s.detected.family)}
                            </div>
                            <div className="text-muted-foreground">planned: {treatmentLabel(s.intent.treatment)}</div>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {s.intent.density ?? "—"} → <span className={cn(s.intent.density && s.intent.density !== s.motion.measuredDensity && "text-warning")}>{s.motion.measuredDensity}</span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {s.intensity.planned ?? "·"} → {s.intensity.measured}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{s.motion.maxBurst}</td>
                          <td className="px-3 py-2 font-mono text-xs">{s.typography.maxWordsOnScreen}</td>
                          <td className="px-3 py-2 font-mono text-xs">{s.motion.shots.length || "—"}</td>
                          <td className="px-3 py-2 text-[11px] text-muted-foreground">
                            focal {s.layout.focal ?? "—"}
                            <br />
                            text {s.layout.text ?? "—"} · {Math.round(s.layout.negativeSpace * 100)}% space
                          </td>
                          <td className="px-3 py-2 text-xs">{serious ? <span className="flex items-center gap-1 text-warning"><AlertTriangle className="size-3.5" />{serious}</span> : <span className="text-muted-foreground">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel
              title={`Measured findings (${metrics.counts.high} high · ${metrics.counts.medium} medium · ${metrics.counts.low} low)`}
              description="Deterministic checks with conservative thresholds — verify them against the rendered video."
              actions={
                <Button size="xs" variant="ghost" onClick={() => setShowInfo((v) => !v)}>
                  {showInfo ? "Hide" : "Show"} {metrics.counts.info} info
                </Button>
              }
            >
              {findings.length ? (
                <ul className="divide-y divide-border">
                  {findings.map((f) => (
                    <FindingItem key={f.id} finding={f} projectId={projectId} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No findings.</p>
              )}
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="Visual distribution">
              <DistributionBars distribution={metrics.distribution} />
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3 text-[11px]">
                <span className="text-muted-foreground">Transitions</span>
                {Object.entries(metrics.transitions).map(([t, c]) => (
                  <span key={t} className="rounded bg-muted px-1.5 py-0.5">
                    {t} ×{c}
                  </span>
                ))}
              </div>
            </Panel>
            <Panel title="Coverage">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Scenes with creative intent</dt>
                  <dd>
                    {metrics.coverage.scenesWithIntent}/{metrics.coverage.scenes}
                  </dd>
                </div>
                {Object.entries(metrics.coverage.plan).map(([section, present]) => (
                  <div key={section} className="flex justify-between">
                    <dt className="text-muted-foreground">{section}</dt>
                    <dd className={present ? "text-success" : "text-muted-foreground"}>{present ? "planned" : "—"}</dd>
                  </div>
                ))}
              </dl>
              <Button size="xs" variant="outline" className="mt-3" asChild>
                <Link href={`/projects/${projectId}/direction`}>Open creative direction</Link>
              </Button>
            </Panel>
            <Panel title="Review history">
              {reviews.length ? (
                <ul className="divide-y divide-border text-sm">
                  {reviews.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setReviewId(r.id)} className={cn("flex w-full items-center gap-2 rounded px-1 py-2 text-left hover:bg-muted/40", review?.id === r.id && "bg-muted/50")}>
                        <span className="font-mono text-xs">v{r.version}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{r.title || r.request || "Creative review"}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {r.issues.filter((i) => i.status === "open" || i.status === "accepted").length}/{r.issues.length} open · {relativeTime(r.createdAt)}
                            {r.stale ? " · stale" : ""}
                          </span>
                        </span>
                        {r.overallScore !== null ? <span className="font-mono text-xs tabular-nums">{r.overallScore}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No reviews yet.</p>
              )}
            </Panel>
          </div>
        </div>
      )}

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask for a creative review</DialogTitle>
            <DialogDescription>Claude answers with a written review saved here — it doesn&apos;t change the video.</DialogDescription>
          </DialogHeader>
          <Textarea autoFocus rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Does the problem section feel different enough from the solution?" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCustomOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => request.mutate(question.trim())} disabled={request.isPending || question.trim().length < 3}>
              {request.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Request review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
