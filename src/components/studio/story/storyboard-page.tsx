"use client";

import { Thumbnail } from "@remotion/player";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCheck, ChevronDown, Clapperboard, Eye, Layers, Loader2, Lock, LockOpen, MoreHorizontal, Pencil, RefreshCcw, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DENSITY_INFO, NARRATIVE_BEAT_LABELS } from "@/core/creative/grammar";
import type { SceneMetrics } from "@/core/creative/metrics";
import { VISUAL_TYPE_LABELS, VISUAL_TYPES, type VisualType } from "@/core/spec/enums";
import { durationToTotalFrames, formatClock, secondsToFrames } from "@/core/timing/frames";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StudioVideo } from "@/remotion/StudioVideo";
import type { CompositionBuild } from "@/server/services/composition";
import type { SceneDto } from "@/server/services/scenes";
import type { TaskDto } from "@/server/services/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, Panel } from "../common";
import { ArcStrip, FamilySwatch, IntensityDots, familyLabel, treatmentLabel, useCreativeMetrics, useCreativePlan } from "../creative/shared";
import { AskClaudeDialog, type TaskType } from "../workspace/ask-claude-dialog";
import { useWorkspace } from "../workspace/workspace-shell";

interface Revision {
  id: string;
  version: number;
  source: string;
  note: string;
  scenes: number;
  createdAt: string;
}

const TASK_STATUS: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  running: "bg-info/15 text-info",
  completed: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

/** Renders the real composition frame for a scene — the storyboard shows what will render. */
function SceneThumb({ build, scene }: { build: CompositionBuild | undefined; scene: SceneDto }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const props = build?.props;
  const portrait = !!props && props.height > props.width;
  const total = props ? Math.max(1, durationToTotalFrames(props.durationSec, props.fps)) : 1;
  const frame = props ? Math.max(0, Math.min(total - 1, secondsToFrames(scene.startSec + (scene.endSec - scene.startSec) * 0.7, props.fps))) : 0;
  return (
    <div className="flex justify-center bg-black">
      <div ref={ref} className={cn("relative w-full overflow-hidden", portrait && "w-[46%]")} style={{ aspectRatio: props ? `${props.width} / ${props.height}` : "16 / 9" }}>
        {visible && props ? (
          <Thumbnail
            component={StudioVideo}
            inputProps={props}
            compositionWidth={props.width}
            compositionHeight={props.height}
            durationInFrames={total}
            fps={props.fps}
            frameToDisplay={frame}
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <Skeleton className="absolute inset-0 rounded-none" />
        )}
      </div>
    </div>
  );
}

function SceneCard({
  projectId,
  scene,
  build,
  selected,
  onToggleSelect,
  onAsk,
  metrics,
}: {
  projectId: string;
  scene: SceneDto;
  build: CompositionBuild | undefined;
  metrics: SceneMetrics | undefined;
  selected: boolean;
  onToggleSelect: () => void;
  onAsk: (type: TaskType) => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const initial = () => ({ name: scene.name, visualType: scene.visualType as VisualType, visualConcept: scene.visualConcept, onScreenText: scene.onScreenText, notes: scene.notes });
  const [draft, setDraft] = useState(initial);
  useEffect(() => {
    if (!editing) setDraft(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.updatedAt, editing]);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

  const save = useMutation({
    mutationFn: () => http.patch(`/api/projects/${projectId}/scenes/${scene.id}`, draft),
    onSuccess: () => {
      setEditing(false);
      toast.success(`${scene.key} saved`);
      invalidate();
    },
    onError: fail,
  });
  const approve = useMutation({ mutationFn: (approved: boolean) => http.post(`/api/projects/${projectId}/scenes/${scene.id}/approve`, { approved }), onSuccess: invalidate, onError: fail });
  const lock = useMutation({ mutationFn: (locked: boolean) => http.post(`/api/projects/${projectId}/scenes/${scene.id}/lock`, { locked }), onSuccess: invalidate, onError: fail });
  const regenerate = useMutation({
    mutationFn: () => http.post(`/api/projects/${projectId}/storyboard/generate`, { mode: "rules", sceneIds: [scene.id] }),
    onSuccess: () => {
      toast.success(`${scene.key} regenerated`, { description: "Timing and voice-over were kept." });
      invalidate();
    },
    onError: fail,
  });

  const approved = scene.status === "approved";
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border bg-card transition-colors", selected ? "border-primary/60" : "border-border")}>
      <div className="relative">
        <SceneThumb build={build} scene={scene} />
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} className="border-white/40 bg-black/50" aria-label={`Select ${scene.key}`} />
          <span className="rounded bg-black/65 px-1.5 py-0.5 font-mono text-[10px] text-white">{scene.key}</span>
        </div>
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {scene.locked ? (
            <span className="flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
              <Lock className="size-3" /> Locked
            </span>
          ) : null}
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", scene.needsReview ? "bg-warning/90 text-black" : approved ? "bg-success/90 text-black" : "bg-black/65 text-white")}>
            {scene.needsReview ? "Changed after approval" : approved ? "Approved" : "Draft"}
          </span>
        </div>
        <div className="absolute bottom-2 left-2 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[10px] text-white">
          {formatClock(scene.startSec, 2)}–{formatClock(scene.endSec, 2)} · {scene.durationSec.toFixed(1)}s · {scene.timingMode === "audio_locked" ? "audio-locked" : "user-adjusted"}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3.5">
        {editing ? (
          <div className="space-y-2.5">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Visual type</Label>
              <Select value={draft.visualType} onValueChange={(v) => setDraft((d) => ({ ...d, visualType: v as VisualType }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISUAL_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {VISUAL_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Visual concept</Label>
              <Textarea rows={3} value={draft.visualConcept} onChange={(e) => setDraft((d) => ({ ...d, visualConcept: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">On-screen text</Label>
              <Input value={draft.onScreenText} onChange={(e) => setDraft((d) => ({ ...d, onScreenText: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
            </div>
            <p className="text-[11px] text-muted-foreground">Creative notes don&apos;t change the rendered spec — edit visuals in the scene editor or ask Claude. Saving resets approval.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !draft.name.trim()}>
                {save.isPending ? <Loader2 className="animate-spin" /> : null} Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <h3 className="leading-snug font-medium">{scene.name}</h3>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {VISUAL_TYPE_LABELS[scene.visualType as VisualType] ?? scene.visualType}
              </Badge>
            </div>
            {scene.creative || metrics ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                {scene.creative?.narrativeBeat ? <span className="rounded bg-muted px-1.5 py-0.5 font-medium tracking-wide text-muted-foreground uppercase">{NARRATIVE_BEAT_LABELS[scene.creative.narrativeBeat]}</span> : null}
                {scene.creative?.treatment ? (
                  <span className="rounded border border-border px-1.5 py-0.5">{treatmentLabel(scene.creative.treatment)}</span>
                ) : metrics?.detected.family ? (
                  <span className="flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-muted-foreground" title="Detected from the spec — no planned treatment">
                    <FamilySwatch family={metrics.detected.family} className="size-2" />
                    {familyLabel(metrics.detected.family)}
                  </span>
                ) : null}
                {metrics ? (
                  <span className="rounded border border-border px-1.5 py-0.5" title="Motion density: planned → measured">
                    {scene.creative?.motion?.density ? `${DENSITY_INFO[scene.creative.motion.density].label} → ` : ""}
                    {DENSITY_INFO[metrics.motion.measuredDensity].label}
                  </span>
                ) : null}
                {metrics?.motion.shots.length ? <span className="rounded border border-border px-1.5 py-0.5">{metrics.motion.shots.length} shots</span> : null}
                <IntensityDots
                  className="ml-auto"
                  value={scene.creative?.intensity ?? metrics?.intensity.measured}
                  title={scene.creative?.intensity ? `Planned intensity ${scene.creative.intensity}/5${metrics ? ` · measured ${metrics.intensity.measured}` : ""}` : metrics ? `Measured intensity ${metrics.intensity.measured}/5` : undefined}
                />
              </div>
            ) : null}
            <blockquote className="border-l-2 border-track-voice/60 pl-2.5 text-sm text-foreground/85">“{scene.voiceText}”</blockquote>
            <div className="space-y-1.5 text-xs">
              {scene.creative?.purpose ? (
                <p>
                  <span className="text-muted-foreground">Purpose · </span>
                  {scene.creative.purpose}
                </p>
              ) : null}
              {scene.creative?.visualMetaphor ? (
                <p>
                  <span className="text-muted-foreground">Metaphor · </span>
                  {scene.creative.visualMetaphor}
                </p>
              ) : null}
              <p>
                <span className="text-muted-foreground">Visual · </span>
                {scene.visualConcept || "—"}
              </p>
              {scene.onScreenText ? (
                <p>
                  <span className="text-muted-foreground">On screen · </span>
                  {scene.onScreenText}
                </p>
              ) : null}
              {scene.animationNotes.length ? <p className="text-muted-foreground">{scene.animationNotes.join(" · ")}</p> : null}
              {scene.notes ? <p className="text-muted-foreground italic">{scene.notes}</p> : null}
            </div>
            {metrics && metrics.findings.some((f) => f.severity === "high" || f.severity === "medium") ? (
              <Link href={`/projects/${projectId}/review`} className="flex min-w-0 items-center gap-1.5 text-xs text-warning hover:underline" title={metrics.findings.filter((f) => f.severity === "high" || f.severity === "medium").map((f) => f.message).join("\n")}>
                <AlertTriangle className="size-3.5 shrink-0" />
                <span className="truncate">{metrics.findings.find((f) => f.severity === "high" || f.severity === "medium")?.message}</span>
              </Link>
            ) : null}
            {!scene.valid || scene.missingAssetIds.length || scene.staleTiming ? (
              <div className="space-y-1 text-xs">
                {!scene.valid ? (
                  <p className="flex items-center gap-1.5 text-destructive">
                    <AlertTriangle className="size-3.5" /> Invalid spec: {scene.issues[0]?.path} {scene.issues[0]?.message}
                  </p>
                ) : null}
                {scene.missingAssetIds.map((id) => (
                  <p key={id} className="flex items-center gap-1.5 text-warning">
                    <AlertTriangle className="size-3.5" /> Scene requires asset {id}.
                  </p>
                ))}
                {scene.staleTiming ? (
                  <p className="flex items-center gap-1.5 text-stale">
                    <AlertTriangle className="size-3.5" /> Timing may no longer match the voice-over.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        {!editing ? (
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
            <Button size="sm" variant={approved && !scene.needsReview ? "outline" : "default"} onClick={() => approve.mutate(scene.needsReview || !approved)} disabled={approve.isPending || scene.locked}>
              <CheckCheck /> {scene.needsReview ? "Re-approve" : approved ? "Unapprove" : "Approve"}
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => lock.mutate(!scene.locked)} disabled={lock.isPending} aria-label={scene.locked ? "Unlock scene" : "Lock scene"} title={scene.locked ? "Unlock" : "Lock (protects from regeneration and edits)"}>
              {scene.locked ? <Lock /> : <LockOpen />}
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setEditing(true)} disabled={scene.locked} aria-label="Edit creative notes" title="Edit creative notes">
              <Pencil />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAsk("edit_scene")} disabled={scene.locked}>
              <Sparkles className="text-primary" /> Ask Claude
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/projects/${projectId}/scenes?scene=${scene.key}`}>
                    <Layers /> Open in scene editor
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/projects/${projectId}/preview?scene=${scene.key}`}>
                    <Eye /> Preview scene
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={scene.locked || regenerate.isPending} onClick={() => regenerate.mutate()}>
                  <Wand2 /> Quick regenerate (rules)
                </DropdownMenuItem>
                <DropdownMenuItem disabled={scene.locked} onClick={() => onAsk("regenerate_scenes")}>
                  <RefreshCcw /> Regenerate with Claude…
                </DropdownMenuItem>
                <DropdownMenuItem disabled={scene.locked} onClick={() => onAsk("scene_alternatives")}>
                  <Sparkles /> Alternatives with Claude…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StoryboardPage({ projectId }: { projectId: string }) {
  const { project } = useWorkspace();
  const queryClient = useQueryClient();
  const scenesQ = useQuery({ queryKey: ["project", projectId, "scenes"], queryFn: async () => (await http.get<{ scenes: SceneDto[] }>(`/api/projects/${projectId}/scenes`)).scenes });
  const compQ = useQuery({ queryKey: ["project", projectId, "composition"], queryFn: () => http.get<CompositionBuild>(`/api/projects/${projectId}/composition`), placeholderData: keepPreviousData });
  const revisionsQ = useQuery({ queryKey: ["project", projectId, "storyboard-revisions"], queryFn: async () => (await http.get<{ revisions: Revision[] }>(`/api/projects/${projectId}/storyboard/revisions`)).revisions });
  const tasksQ = useQuery({ queryKey: ["project", projectId, "tasks"], queryFn: async () => (await http.get<{ tasks: TaskDto[] }>(`/api/projects/${projectId}/tasks`)).tasks, refetchInterval: 5000 });
  const metricsQ = useCreativeMetrics(projectId);
  const planQ = useCreativePlan(projectId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pace, setPace] = useState<"fast" | "medium" | "slow">("medium");
  const [ask, setAsk] = useState<{ scenes: SceneDto[]; type: TaskType } | null>(null);
  const [confirmRestructure, setConfirmRestructure] = useState(false);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

  const generate = useMutation({
    mutationFn: (body: { mode: "rules"; restructure?: boolean; sceneIds?: string[]; pace?: string }) => http.post<{ result: Record<string, unknown> }>(`/api/projects/${projectId}/storyboard/generate`, body),
    onSuccess: (data, body) => {
      const r = data.result as { scenes?: number; storyboardVersion?: number };
      toast.success(body.sceneIds?.length ? `Regenerated ${body.sceneIds.length} scene${body.sceneIds.length === 1 ? "" : "s"}` : `Storyboard v${r.storyboardVersion ?? "—"} · ${r.scenes ?? "?"} scenes`, {
        description: "Voice-over and timing were not changed.",
      });
      setConfirmRestructure(false);
      setSelected(new Set());
      invalidate();
    },
    onError: fail,
  });
  const approveAll = useMutation({
    mutationFn: () => http.post<{ approved?: string[]; skipped?: { key: string; reason: string }[]; result?: { approved: string[]; skipped: { key: string; reason: string }[] } }>(`/api/projects/${projectId}/scenes/approve-all`),
    onSuccess: (d) => {
      const r = d.result ?? { approved: d.approved ?? [], skipped: d.skipped ?? [] };
      if (r.skipped.length) toast.warning(`Approved ${r.approved.length}; ${r.skipped.length} need attention`, { description: r.skipped.map((s) => `${s.key}: ${s.reason}`).join("\n") });
      else toast.success(`Approved ${r.approved.length} scene${r.approved.length === 1 ? "" : "s"}`);
      invalidate();
    },
    onError: fail,
  });
  const bulk = useMutation({
    mutationFn: async (action: "approve" | "lock" | "unlock") => {
      for (const id of selected) {
        if (action === "approve") await http.post(`/api/projects/${projectId}/scenes/${id}/approve`, { approved: true });
        else await http.post(`/api/projects/${projectId}/scenes/${id}/lock`, { locked: action === "lock" });
      }
    },
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
    onError: (e) => {
      fail(e);
      invalidate();
    },
  });

  const scenes = scenesQ.data ?? [];
  const selectedScenes = scenes.filter((s) => selected.has(s.id));
  const hasTimeline = !!project?.timeline;
  const approvedCount = scenes.filter((s) => s.status === "approved").length;
  const lockedCount = scenes.filter((s) => s.locked).length;
  const activeTasks = (tasksQ.data ?? []).filter((t) => t.status === "pending" || t.status === "running");
  const recentTasks = (tasksQ.data ?? []).slice(0, 6);

  if (scenesQ.error) {
    return (
      <div className="p-6">
        <ErrorState error={scenesQ.error} onRetry={() => void scenesQ.refetch()} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Storyboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {scenes.length
              ? `${scenes.length} scenes · ${approvedCount} approved · ${lockedCount} locked · every scene is anchored to the words of the voice-over`
              : "Scenes are planned from the audio timeline so visuals land exactly on the narration."}
          </p>
        </div>
        {hasTimeline ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={pace} onValueChange={(v) => setPace(v as typeof pace)}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast pace</SelectItem>
                <SelectItem value="medium">Medium pace</SelectItem>
                <SelectItem value="slow">Slow pace</SelectItem>
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary" disabled={generate.isPending}>
                  {generate.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} {scenes.length ? "Regenerate" : "Generate"} <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Instant (rule-based)</DropdownMenuLabel>
                {scenes.length ? (
                  <>
                    <DropdownMenuItem onClick={() => generate.mutate({ mode: "rules", sceneIds: scenes.filter((s) => !s.locked).map((s) => s.id) })}>
                      <Wand2 /> Refresh visuals of unlocked scenes
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setConfirmRestructure(true)} disabled={lockedCount > 0}>
                      <RefreshCcw /> Re-plan scenes from the timeline…
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onClick={() => generate.mutate({ mode: "rules", pace })}>
                    <Wand2 /> Quick draft from the timeline
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Claude Code</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setAsk({ scenes: [], type: "generate_storyboard" })}>
                  <Sparkles /> Generate the storyboard with Claude…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {scenes.length ? (
              <Button size="sm" onClick={() => approveAll.mutate()} disabled={approveAll.isPending || (approvedCount === scenes.length && !scenes.some((s) => s.needsReview))}>
                {approveAll.isPending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Approve all
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {activeTasks.length ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-2.5 text-sm">
          <Loader2 className="size-4 animate-spin text-info" />
          <span>
            {activeTasks.length} Claude task{activeTasks.length === 1 ? "" : "s"} {activeTasks.some((t) => t.status === "running") ? "in progress" : "waiting for Claude Code"}: {activeTasks.map((t) => t.title).join(" · ")}
          </span>
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => window.dispatchEvent(new CustomEvent("studio:command-bar", { detail: { view: "tasks" } }))}>
            View tasks
          </Button>
        </div>
      ) : null}

      {scenes.length && metricsQ.data?.scenes.length ? (
        <Panel
          title="Story arc & rhythm"
          description={planQ.data?.plan.storyArc ? "Acts from the creative plan, the measured treatment of every scene, and intensity — measured (solid) against planned (dashed)." : "Measured treatment and intensity of every scene. Plan a story arc on the Direction page to see acts and planned intensity."}
          actions={
            <div className="flex gap-1.5">
              <Button size="xs" variant="outline" asChild>
                <Link href={`/projects/${projectId}/direction`}>Direction</Link>
              </Button>
              <Button size="xs" variant="outline" asChild>
                <Link href={`/projects/${projectId}/review`}>Creative QA</Link>
              </Button>
            </div>
          }
        >
          <ArcStrip projectId={projectId} metrics={metricsQ.data} plan={planQ.data?.plan ?? null} />
        </Panel>
      ) : null}

      {!scenesQ.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-80 rounded-xl" />
          ))}
        </div>
      ) : !hasTimeline && !scenes.length ? (
        <EmptyState
          icon={<AlertTriangle />}
          title="Generate or import a voice-over before generating an audio-locked storyboard."
          description="Scenes are anchored to spoken words, so precise timing must come from real audio first. You can still analyze the script into beats (estimated timing)."
          action={
            <div className="flex gap-2">
              <Button size="sm" asChild>
                <Link href={`/projects/${projectId}/voice`}>Open Voice</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/projects/${projectId}/beats`}>View beats</Link>
              </Button>
            </div>
          }
        />
      ) : !scenes.length ? (
        <EmptyState
          icon={<Clapperboard />}
          title="No storyboard yet"
          description="Draft one instantly from the timeline, or ask Claude Code for a considered creative storyboard."
          action={
            <div className="flex gap-2">
              <Button size="sm" onClick={() => generate.mutate({ mode: "rules", pace })} disabled={generate.isPending}>
                {generate.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} Quick draft
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAsk({ scenes: [], type: "generate_storyboard" })}>
                <Sparkles /> Ask Claude
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              projectId={projectId}
              scene={scene}
              build={compQ.data}
              metrics={metricsQ.data?.scenes.find((m) => m.key === scene.key)}
              selected={selected.has(scene.id)}
              onToggleSelect={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(scene.id)) next.delete(scene.id);
                  else next.add(scene.id);
                  return next;
                })
              }
              onAsk={(type) => setAsk({ scenes: [scene], type })}
            />
          ))}
        </div>
      )}

      {scenes.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Storyboard versions" description="A snapshot is saved every time scenes are generated, applied or restored.">
            {revisionsQ.data?.length ? (
              <ul className="divide-y divide-border text-sm">
                {revisionsQ.data.slice(0, 8).map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <span className="font-mono text-xs text-muted-foreground">v{r.version}</span>
                    <span className="capitalize">{r.source}</span>
                    <span className="truncate text-muted-foreground">{r.note}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {r.scenes} scenes · {relativeTime(r.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No versions yet.</p>
            )}
          </Panel>
          <Panel title="Claude tasks" description="Explicit requests handed to Claude Code for this project.">
            {recentTasks.length ? (
              <ul className="divide-y divide-border text-sm">
                {recentTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", TASK_STATUS[t.status])}>{t.status}</span>
                    <span className="truncate">{t.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relativeTime(t.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No tasks yet. Use “Ask Claude” on a scene or press Ctrl K.</p>
            )}
          </Panel>
        </div>
      ) : null}

      {selected.size ? (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-popover px-3 py-2 shadow-2xl">
          <span className="px-1 text-sm">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate("approve")} disabled={bulk.isPending}>
            <CheckCheck /> Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate("lock")} disabled={bulk.isPending}>
            <Lock /> Lock
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate("unlock")} disabled={bulk.isPending}>
            <LockOpen /> Unlock
          </Button>
          <Button size="sm" variant="outline" onClick={() => generate.mutate({ mode: "rules", sceneIds: selectedScenes.filter((s) => !s.locked).map((s) => s.id) })} disabled={generate.isPending || selectedScenes.every((s) => s.locked)}>
            <Wand2 /> Quick regenerate
          </Button>
          <Button size="sm" onClick={() => setAsk({ scenes: selectedScenes.filter((s) => !s.locked), type: "regenerate_scenes" })} disabled={selectedScenes.every((s) => s.locked)}>
            <Sparkles /> Ask Claude
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      <Dialog open={confirmRestructure} onOpenChange={setConfirmRestructure}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-plan the storyboard?</DialogTitle>
            <DialogDescription>
              Scenes are re-planned from the timeline at {pace} pace. The current scenes are saved in a project snapshot first, and the voice-over is not touched. Locked scenes block this — unlock them or refresh unlocked scenes instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRestructure(false)}>
              Cancel
            </Button>
            <Button onClick={() => generate.mutate({ mode: "rules", restructure: true, pace })} disabled={generate.isPending}>
              {generate.isPending ? <Loader2 className="animate-spin" /> : <RefreshCcw />} Re-plan scenes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AskClaudeDialog projectId={projectId} open={!!ask} onOpenChange={(open) => !open && setAsk(null)} scenes={ask?.scenes ?? []} defaultType={ask?.type} />
    </div>
  );
}
