"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Captions, CheckCircle2, Clapperboard, Download, FileJson, Film, ImageDown, ListOrdered, Loader2, Package, Play, RotateCcw, Scissors, Sparkles, Trash2, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { RENDER_PRESETS, sameAspect } from "@/core/spec/format";
import { formatClock } from "@/core/timing/frames";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { formatBytes, formatDuration, relativeTime } from "@/lib/format";
import type { LiveRender } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { PublicJob } from "@/server/jobs/queue";
import type { RenderDto, RenderErrorInfo, RenderReadiness } from "@/server/services/renders";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ErrorState, PageHeader, Panel } from "../common";
import { useJob } from "../workspace/use-job";
import { useWorkspace } from "../workspace/workspace-shell";
import { ThumbnailExport } from "./thumbnail-export";

type Kind = "final" | "preview" | "scene" | "range";
type Quality = "high" | "standard" | "draft";

interface FormState {
  kind: Kind;
  preset: string;
  quality: Quality;
  includeAudio: boolean;
  sceneId: string;
  start: string;
  end: string;
  width: string;
  height: string;
  label: string;
  /** "project" or a frame rate. */
  fps: string;
  /** "auto" or a number of parallel frames. */
  concurrency: string;
  /** "off" or a loudness target for the finished mix. */
  loudness: "off" | "youtube" | "podcast" | "broadcast";
  /** Burned-in caption style ("off" = none) and where they sit. */
  captions: "off" | "minimal" | "boxed" | "bold" | "karaoke";
  captionPosition: "bottom" | "top" | "center";
}

const KINDS: { value: Kind; title: string; description: string; icon: typeof Film }[] = [
  { value: "final", title: "Final video", description: "Full length, full quality H.264 MP4", icon: Film },
  { value: "preview", title: "Draft preview", description: "Fast, lower quality full-length check", icon: Sparkles },
  { value: "scene", title: "Single scene", description: "Render one scene to review it", icon: Clapperboard },
  { value: "range", title: "Time range", description: "Render any section of the timeline", icon: Scissors },
];

const FRAME_RATES = [24, 25, 30, 50, 60];

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  bundling: "bg-info/15 text-info",
  rendering: "bg-info/15 text-info",
  encoding: "bg-info/15 text-info",
  complete: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const ACTIVE = ["queued", "bundling", "rendering", "encoding"];

function parseTime(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length > 3 || parts.some((p) => p.trim() === "" || Number.isNaN(Number(p)))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

function FailureDetails({ error, projectId }: { error: RenderErrorInfo; projectId: string }) {
  const [open, setOpen] = useState(false);
  const details = [...(error.logs ?? []), error.stack ?? ""].filter(Boolean).join("\n");
  return (
    <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
      <div className="flex items-start gap-2 text-destructive">
        <XCircle className="mt-0.5 size-3.5 shrink-0" />
        <span className="break-words">{error.message}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        {error.stage ? <span>Stage: {error.stage}</span> : null}
        {error.sceneKey ? (
          <Link className="text-foreground underline underline-offset-2" href={`/projects/${projectId}/scenes?scene=${error.sceneKey}`}>
            Failed in {error.sceneKey}
            {error.sceneName ? ` · ${error.sceneName}` : ""}
          </Link>
        ) : null}
        {error.frame !== null && error.frame !== undefined ? <span>Frame {error.frame}</span> : null}
        {details ? (
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setOpen(!open)}>
            {open ? "Hide logs" : "Show logs"}
          </button>
        ) : null}
      </div>
      {open ? <pre className="scrollbar-thin mt-2 max-h-56 overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{details}</pre> : null}
    </div>
  );
}

function RenderRow({ render, live, projectId, onPlay }: { render: RenderDto; live: LiveRender | undefined; projectId: string; onPlay: (r: RenderDto) => void }) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = live?.status ?? render.status;
  const progress = live?.progress ?? render.progress;
  const stage = live?.stage ?? render.stage;
  const active = ACTIVE.includes(status);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["renders", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  };
  const cancel = useMutation({ mutationFn: () => http.post(`/api/projects/${projectId}/renders/${render.id}/cancel`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const retry = useMutation({
    mutationFn: () => http.post(`/api/projects/${projectId}/renders/${render.id}/retry`),
    onSuccess: () => {
      toast.success("Render queued again");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: () => http.delete(`/api/projects/${projectId}/renders/${render.id}`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const s = render.settings;

  return (
    <div className="flex gap-4 rounded-xl border border-border bg-card p-3">
      <button
        type="button"
        className="group relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-muted"
        onClick={() => render.url && onPlay(render)}
        disabled={!render.url}
        aria-label={render.url ? `Play ${render.label}` : undefined}
      >
        {render.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={render.thumbnailUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">{active ? <Loader2 className="size-5 animate-spin" /> : <Film className="size-5" />}</div>
        )}
        {render.url ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
            <Play className="size-7 text-white" />
          </div>
        ) : null}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{render.label}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium capitalize", STATUS_STYLES[status] ?? STATUS_STYLES.queued)}>{status}</span>
          {render.stale ? (
            <Badge variant="outline" className="border-stale/40 text-stale">
              Stale
            </Badge>
          ) : null}
          {render.fileMissing ? (
            <Badge variant="outline" className="border-destructive/40 text-destructive">
              File missing
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {s ? `${s.width}×${s.height} · ${s.fps} fps · ${s.quality} quality${s.concurrency ? ` · ${s.concurrency} parallel frames` : ""} · ${s.includeAudio ? "with audio" : "no audio"}` : ""} · queued {relativeTime(render.createdAt)}
        </div>
        {active ? (
          <div className="mt-2 max-w-xl space-y-1">
            <Progress value={Math.round(progress * 100)} />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{status === "queued" ? "Waiting for the worker…" : (stage ?? "Working…")}</span>
              <span className="tabular-nums">{Math.round(progress * 100)}%</span>
            </div>
          </div>
        ) : null}
        {status === "complete" ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="size-3.5" /> {formatDuration(render.durationSec)}
            </span>
            <span>{formatBytes(render.sizeBytes)}</span>
            {render.finishedAt ? <span>finished {relativeTime(render.finishedAt)}</span> : null}
            {render.stale ? <span className="text-stale">Project changed since this render.</span> : null}
            {render.fileMissing ? <span className="text-destructive">The video file was deleted from the renders folder.</span> : null}
          </div>
        ) : null}
        {status === "failed" && render.error ? <FailureDetails error={render.error} projectId={projectId} /> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {render.downloadUrl ? (
          <Button size="sm" variant="outline" asChild>
            <a href={render.downloadUrl}>
              <Download /> Download
            </a>
          </Button>
        ) : null}
        {active ? (
          <Button size="sm" variant="ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            <X /> Cancel
          </Button>
        ) : null}
        {!active ? (
          <Button size="sm" variant={status === "failed" ? "default" : "ghost"} onClick={() => retry.mutate()} disabled={retry.isPending}>
            <RotateCcw /> {status === "complete" ? "Render again" : "Retry"}
          </Button>
        ) : null}
        {!active ? (
          <Button size="icon-sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete render">
            <Trash2 />
          </Button>
        ) : null}
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this render?</AlertDialogTitle>
            <AlertDialogDescription>{render.label} and its video file will be removed from the project folder. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()}>Delete render</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ExportTile({ icon: Icon, title, description, children }: { icon: typeof Film; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ExportsPanel({ projectId, canExportStill }: { projectId: string; canExportStill: boolean }) {
  const [thumbJobId, setThumbJobId] = useState<string | null>(null);
  const [packageJobId, setPackageJobId] = useState<string | null>(null);
  const [thumbResult, setThumbResult] = useState<{ url: string; downloadUrl: string } | null>(null);
  const [packageResult, setPackageResult] = useState<{ url: string } | null>(null);
  const thumbJob = useJob(thumbJobId, (job) => {
    if (job.status === "succeeded") {
      setThumbResult(job.result as { url: string; downloadUrl: string });
      toast.success("Thumbnail exported");
    } else if (job.status === "failed") toast.error(job.error?.message ?? "Thumbnail export failed");
  });
  const packageJob = useJob(packageJobId, (job) => {
    if (job.status === "succeeded") {
      setPackageResult(job.result as { url: string });
      toast.success("Project package ready");
    } else if (job.status === "failed") toast.error(job.error?.message ?? "Package export failed");
  });
  const startThumb = useMutation({
    mutationFn: () => http.post<{ job: PublicJob }>(`/api/projects/${projectId}/exports/still`, { purpose: "thumbnail" }),
    onSuccess: (d) => {
      setThumbResult(null);
      setThumbJobId(d.job.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const startPackage = useMutation({
    mutationFn: () => http.post<{ job: PublicJob }>(`/api/projects/${projectId}/exports/package`, { includeRenders: true }),
    onSuccess: (d) => {
      setPackageResult(null);
      setPackageJobId(d.job.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const base = `/api/projects/${projectId}/exports`;
  const jobLabel = (j: ReturnType<typeof useJob>["job"]) => (j ? `${Math.round((Number.isFinite(j.progress) ? j.progress : 0) * 100)}%` : "");

  return (
    <Panel title="Exports" description="Hand off the video, its timing and its storyboard.">
      <div className="grid gap-2">
        <ExportTile icon={ImageDown} title="Thumbnail" description="JPEG still rendered from the composition">
          {thumbResult ? (
            <Button size="sm" variant="outline" asChild>
              <a href={thumbResult.downloadUrl}>
                <Download /> Save
              </a>
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => startThumb.mutate()} disabled={!canExportStill || startThumb.isPending || thumbJob.active}>
              {thumbJob.active ? (
                <>
                  <Loader2 className="animate-spin" /> {jobLabel(thumbJob.job)}
                </>
              ) : (
                "Export"
              )}
            </Button>
          )}
        </ExportTile>
        <ExportTile icon={Captions} title="Captions" description="Subtitles from the voice-over (muted parts left out)">
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" asChild>
              <a href={`${base}/captions.srt`}>
                <Download /> SRT
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`${base}/captions.vtt`}>
                <Download /> VTT
              </a>
            </Button>
          </div>
        </ExportTile>
        <ExportTile icon={ListOrdered} title="YouTube chapters" description="0:00 timestamps from the scene names, for the description">
          <Button size="sm" variant="outline" asChild>
            <a href={`${base}/chapters.txt`}>
              <Download /> Download
            </a>
          </Button>
        </ExportTile>
        <ExportTile icon={FileJson} title="Timeline JSON" description="Words, sentences, pauses with exact timing">
          <Button size="sm" variant="outline" asChild>
            <a href={`${base}/timeline.json`}>
              <Download /> Download
            </a>
          </Button>
        </ExportTile>
        <ExportTile icon={FileJson} title="Storyboard JSON" description="Scenes, voice text, visual concepts, timing">
          <Button size="sm" variant="outline" asChild>
            <a href={`${base}/storyboard.json`}>
              <Download /> Download
            </a>
          </Button>
        </ExportTile>
        <ExportTile icon={FileJson} title="Scene specs JSON" description="Remotion scene specs for every scene">
          <Button size="sm" variant="outline" asChild>
            <a href={`${base}/scenes.json`}>
              <Download /> Download
            </a>
          </Button>
        </ExportTile>
        <ExportTile icon={Package} title="Project package" description="Zip: script, audio, assets, specs, renders">
          {packageResult ? (
            <Button size="sm" variant="outline" asChild>
              <a href={`${packageResult.url}${packageResult.url.includes("?") ? "&" : "?"}download=1`}>
                <Download /> Save zip
              </a>
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => startPackage.mutate()} disabled={startPackage.isPending || packageJob.active}>
              {packageJob.active ? (
                <>
                  <Loader2 className="animate-spin" /> {jobLabel(packageJob.job)}
                </>
              ) : (
                "Export"
              )}
            </Button>
          )}
        </ExportTile>
      </div>
    </Panel>
  );
}

function Readiness({ readiness, projectId }: { readiness: RenderReadiness; projectId: string }) {
  const base = `/projects/${projectId}`;
  const rows: { ok: boolean | "warn"; label: string; href?: string }[] = [
    { ok: readiness.sceneCount > 0, label: readiness.sceneCount ? `${readiness.sceneCount} scenes` : "No storyboard yet", href: `${base}/storyboard` },
    {
      ok: readiness.issues.invalidScenes.length === 0,
      label: readiness.issues.invalidScenes.length ? `Invalid spec: ${readiness.issues.invalidScenes.map((s) => s.key).join(", ")}` : "All scene specs valid",
      href: `${base}/scenes`,
    },
    {
      ok: readiness.issues.missingAssets.length === 0,
      label: readiness.issues.missingAssets.length ? `Scene ${readiness.issues.missingAssets[0].sceneKey} requires asset ${readiness.issues.missingAssets[0].assetId}.` : "All referenced assets present",
      href: `${base}/assets/images`,
    },
    { ok: readiness.approvedCount === readiness.sceneCount && readiness.sceneCount > 0 ? true : "warn", label: `${readiness.approvedCount}/${readiness.sceneCount} scenes approved`, href: `${base}/scenes` },
    { ok: readiness.hasVoice ? true : "warn", label: readiness.hasVoice ? "Voice-over attached" : "No voice-over — the video will be silent", href: `${base}/voice` },
    { ok: readiness.issues.staleTimingScenes.length ? "warn" : true, label: readiness.issues.staleTimingScenes.length ? "Scene timing may no longer match the voice-over" : "Timing matches the voice-over", href: `${base}/timeline` },
  ];
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center gap-2">
          {r.ok === true ? <CheckCircle2 className="size-4 text-success" /> : r.ok === "warn" ? <AlertTriangle className="size-4 text-warning" /> : <XCircle className="size-4 text-destructive" />}
          {r.href && r.ok !== true ? (
            <Link href={r.href} className="hover:underline">
              {r.label}
            </Link>
          ) : (
            <span className={r.ok === true ? "text-muted-foreground" : ""}>{r.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RenderPage({ projectId }: { projectId: string }) {
  const { project, live } = useWorkspace();
  const queryClient = useQueryClient();
  const revision = project?.revision;
  const query = useQuery({
    queryKey: ["renders", projectId, revision],
    queryFn: () => http.get<{ renders: RenderDto[]; readiness: RenderReadiness }>(`/api/projects/${projectId}/renders`),
    enabled: revision !== undefined,
    placeholderData: keepPreviousData,
  });
  const [form, setForm] = useState<FormState>({ kind: "final", preset: "project", quality: "high", includeAudio: true, sceneId: "", start: "", end: "", width: "", height: "", label: "", fps: "project", concurrency: "auto", loudness: "off", captions: "off", captionPosition: "bottom" });
  const [forcePrompt, setForcePrompt] = useState<string | null>(null);
  const [playing, setPlaying] = useState<RenderDto | null>(null);
  /** More sizes (same aspect ratio) queued after the main render. */
  const [extraSizes, setExtraSizes] = useState<string[]>([]);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const readiness = query.data?.readiness;
  const renders = query.data?.renders ?? [];
  const running = renders.some((r) => ACTIVE.includes(live.renders.find((l) => l.id === r.id)?.status ?? r.status));

  const body = (force = false) => ({
    kind: form.kind,
    preset: form.preset,
    quality: form.quality,
    includeAudio: form.includeAudio,
    ...(form.kind === "scene" ? { sceneId: form.sceneId || readiness?.scenes[0]?.id } : {}),
    ...(form.kind === "range" ? { startSec: parseTime(form.start) ?? undefined, endSec: parseTime(form.end) ?? undefined } : {}),
    ...(form.preset === "custom" ? { width: Number(form.width) || undefined, height: Number(form.height) || undefined } : {}),
    ...(form.label.trim() ? { label: form.label.trim() } : {}),
    ...(form.fps !== "project" ? { fps: Number(form.fps) } : {}),
    ...(form.concurrency !== "auto" ? { concurrency: Number(form.concurrency) } : {}),
    loudness: form.loudness,
    captions: form.captions,
    captionPosition: form.captionPosition,
    force,
  });

  const create = useMutation({
    mutationFn: async (force: boolean) => {
      const main = await http.post<{ render: RenderDto; job: PublicJob }>(`/api/projects/${projectId}/renders`, body(force));
      // Extra sizes queue behind it (renders run one at a time).
      for (const preset of extraSizes.filter((p) => p !== form.preset)) {
        await http.post(`/api/projects/${projectId}/renders`, { ...body(force), preset, queue: true, label: undefined });
      }
      return main;
    },
    onSuccess: () => {
      const extra = extraSizes.filter((p) => p !== form.preset).length;
      toast.success(extra ? `Render queued, with ${extra} more size${extra === 1 ? "" : "s"} after it` : "Render queued");
      setForcePrompt(null);
      void queryClient.invalidateQueries({ queryKey: ["renders", projectId] });
    },
    onError: (err) => {
      const details = err instanceof ApiError ? (err.details as { canForce?: boolean } | undefined) : undefined;
      if (details?.canForce) setForcePrompt(err.message);
      else toast.error(errorMessage(err), { description: err instanceof ApiError ? err.hint : undefined });
    },
  });

  if (query.error && !query.data) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <ErrorState error={query.error} title="Could not load renders" onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const projectFps = readiness?.fps ?? project?.fps ?? 30;
  const fps = form.fps !== "project" ? Number(form.fps) : projectFps;
  let outW = readiness?.width ?? 0;
  let outH = readiness?.height ?? 0;
  if (form.preset === "custom") {
    outW = Number(form.width) || 0;
    outH = Number(form.height) || 0;
  } else if (form.preset !== "project") {
    const p = RENDER_PRESETS.find((x) => x.id === form.preset);
    if (p) {
      outW = p.width;
      outH = p.height;
    }
  }
  const selectedScene = readiness?.scenes.find((s) => s.id === form.sceneId) ?? readiness?.scenes[0];
  let spanSec = readiness?.durationSec ?? 0;
  if (form.kind === "scene" && selectedScene) spanSec = selectedScene.end - selectedScene.start;
  if (form.kind === "range") {
    const a = parseTime(form.start);
    const b = parseTime(form.end);
    spanSec = a !== null && b !== null && b > a ? b - a : 0;
  }
  const aspectMismatch = !!readiness && outW > 0 && outH > 0 && !sameAspect(outW, outH, readiness.width, readiness.height);
  const blocked = !readiness || readiness.blocking || running || aspectMismatch || (form.kind === "range" && spanSec <= 0) || (form.preset === "custom" && (!outW || !outH));
  const machine = readiness?.machine;
  const parallel = form.concurrency !== "auto" ? Number(form.concurrency) : (machine?.defaultConcurrency ?? 1);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      <PageHeader
        title="Render"
        description="Render the Remotion composition to MP4 (H.264). Renders run in the local worker; every render is kept as a version."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/projects/${projectId}/preview`}>
              <Play /> Open preview
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Panel title="New render">
          {!readiness ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">Presets</span>
                <Button size="xs" variant="outline" onClick={() => setForm((f) => ({ ...f, kind: "final", preset: "project", quality: "high", includeAudio: true, loudness: "youtube", captions: "off" }))}>
                  YouTube upload
                </Button>
                <Button size="xs" variant="outline" onClick={() => setForm((f) => ({ ...f, kind: "final", quality: "high", includeAudio: true, loudness: "podcast", captions: "bold", captionPosition: "center" }))}>
                  Reels with captions
                </Button>
                <Button size="xs" variant="outline" onClick={() => setForm((f) => ({ ...f, kind: "preview", quality: "draft", loudness: "off", captions: "off" }))}>
                  Quick review
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => set("kind", k.value)}
                    className={cn("flex items-start gap-3 rounded-lg border p-3 text-left transition-colors", form.kind === k.value ? "border-primary/60 bg-primary/10" : "border-border hover:bg-muted/30")}
                  >
                    <k.icon className={cn("mt-0.5 size-4", form.kind === k.value ? "text-primary" : "text-muted-foreground")} />
                    <div>
                      <div className="text-sm font-medium">{k.title}</div>
                      <div className="text-xs text-muted-foreground">{k.description}</div>
                    </div>
                  </button>
                ))}
              </div>

              {form.kind === "scene" ? (
                <div className="space-y-1.5">
                  <Label>Scene</Label>
                  <Select value={form.sceneId || readiness.scenes[0]?.id} onValueChange={(v) => set("sceneId", v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a scene" />
                    </SelectTrigger>
                    <SelectContent>
                      {readiness.scenes.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.key} · {s.name} ({formatClock(s.start, 1)}–{formatClock(s.end, 1)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {form.kind === "range" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="range-start">Start</Label>
                    <Input id="range-start" className="font-mono" placeholder="0:04.5" value={form.start} onChange={(e) => set("start", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="range-end">End</Label>
                    <Input id="range-end" className="font-mono" placeholder="0:12" value={form.end} onChange={(e) => set("end", e.target.value)} />
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Size</Label>
                  <Select value={form.preset} onValueChange={(v) => set("preset", v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project">
                        Project format ({readiness.width}×{readiness.height})
                      </SelectItem>
                      {RENDER_PRESETS.map((p) => (
                        <SelectItem key={p.id} value={p.id} disabled={!sameAspect(p.width, p.height, readiness.width, readiness.height)}>
                          {p.label} ({p.width}×{p.height})
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom size…</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Quality</Label>
                  <Select value={form.kind === "preview" ? "draft" : form.quality} onValueChange={(v) => set("quality", v as Quality)} disabled={form.kind === "preview"}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">High (CRF 18)</SelectItem>
                      <SelectItem value="standard">Standard (CRF 23)</SelectItem>
                      <SelectItem value="draft">Draft (CRF 30)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.preset === "custom" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="custom-w">Width</Label>
                    <Input id="custom-w" inputMode="numeric" value={form.width} onChange={(e) => set("width", e.target.value.replace(/\D/g, ""))} placeholder={String(readiness.width)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="custom-h">Height</Label>
                    <Input id="custom-h" inputMode="numeric" value={form.height} onChange={(e) => set("height", e.target.value.replace(/\D/g, ""))} placeholder={String(readiness.height)} />
                  </div>
                </div>
              ) : null}
              {(() => {
                const others = RENDER_PRESETS.filter((p) => p.id !== form.preset && sameAspect(p.width, p.height, readiness.width, readiness.height));
                return others.length ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Also render</span>
                    {others.map((p) => (
                      <label key={p.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                        <input type="checkbox" className="size-3.5 accent-primary" checked={extraSizes.includes(p.id)} onChange={(e) => setExtraSizes((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                        {p.label} ({p.width}×{p.height})
                      </label>
                    ))}
                    {extraSizes.length ? <span className="text-muted-foreground">They render one after another.</span> : null}
                  </div>
                ) : null;
              })()}
              {aspectMismatch ? <p className="text-xs text-warning">This size doesn&apos;t match the project&apos;s aspect ratio ({readiness.width}×{readiness.height}).</p> : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Frame rate</Label>
                  <Select value={form.fps} onValueChange={(v) => set("fps", v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project">Project ({projectFps} fps)</SelectItem>
                      {FRAME_RATES.filter((r) => r !== projectFps).map((r) => (
                        <SelectItem key={r} value={String(r)}>
                          {r} fps
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Parallel frames</Label>
                  <Select value={form.concurrency} onValueChange={(v) => set("concurrency", v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        {machine?.configured ? `Settings (${machine.configured})` : `Automatic (${machine?.automatic ?? "…"})`}
                      </SelectItem>
                      {Array.from({ length: machine?.max ?? 8 }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} at a time
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Loudness</Label>
                  <Select value={form.includeAudio ? form.loudness : "off"} onValueChange={(v) => set("loudness", v as FormState["loudness"])} disabled={!form.includeAudio}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">As mixed</SelectItem>
                      <SelectItem value="youtube">YouTube (−14 LUFS)</SelectItem>
                      <SelectItem value="podcast">Reels and podcasts (−16 LUFS)</SelectItem>
                      <SelectItem value="broadcast">Broadcast (−23 LUFS)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Burn in captions</Label>
                  <div className="flex gap-2">
                    <Select value={form.captions} onValueChange={(v) => set("captions", v as FormState["captions"])}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">No captions</SelectItem>
                        <SelectItem value="minimal">Minimal</SelectItem>
                        <SelectItem value="boxed">Boxed</SelectItem>
                        <SelectItem value="bold">Bold</SelectItem>
                        <SelectItem value="karaoke">Karaoke (words light up)</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.captions !== "off" ? (
                      <Select value={form.captionPosition} onValueChange={(v) => set("captionPosition", v as FormState["captionPosition"])}>
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bottom">Bottom</SelectItem>
                          <SelectItem value="center">Middle</SelectItem>
                          <SelectItem value="top">Top</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                </div>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">
                {form.loudness !== "off" && form.includeAudio ? "The finished audio is measured and raised or lowered to the target, with peaks kept under −1 dBFS. " : ""}
                {fps > projectFps ? `${fps} fps makes motion smoother and takes about ${(fps / projectFps).toFixed(1)}× as long to render; video clips recorded at a lower frame rate repeat frames. ` : ""}
                {machine ? `This computer: ${machine.cpuCount} CPU threads, ${machine.freeMemoryGb} GB of ${machine.totalMemoryGb} GB memory free. ` : ""}
                More parallel frames render faster but use more memory.
                {machine?.hasVideo && parallel > 3 ? " This video contains clips: above 3, a render can fail with “No frame found” when memory runs low. Lower it and try again if that happens." : ""}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="render-label">Label (optional)</Label>
                  <Input id="render-label" value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="e.g. Client review v2" />
                </div>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 sm:mt-6">
                  <span className="text-sm">Include audio</span>
                  <Switch checked={form.includeAudio} onCheckedChange={(v) => set("includeAudio", v)} />
                </label>
              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                <span className="text-foreground">
                  {outW || "—"}×{outH || "—"}
                </span>{" "}
                · {fps} fps · {formatClock(Math.max(0, spanSec), 2)} · {Math.round(Math.max(0, spanSec) * fps)} frames · {parallel} at a time · MP4 (H.264{form.includeAudio ? " + AAC" : ""})
              </div>

              <Readiness readiness={readiness} projectId={projectId} />

              <div className="flex items-center gap-3">
                <Button onClick={() => create.mutate(false)} disabled={blocked || create.isPending}>
                  {create.isPending ? <Loader2 className="animate-spin" /> : <Film />}
                  {form.kind === "final" ? "Render final video" : form.kind === "preview" ? "Render draft" : form.kind === "scene" ? "Render scene" : "Render range"}
                </Button>
                {running ? <span className="text-xs text-muted-foreground">A render is in progress.</span> : null}
              </div>
            </div>
          )}
        </Panel>
        <div className="space-y-4">
          <ExportsPanel projectId={projectId} canExportStill={!!readiness && readiness.sceneCount > 0 && !readiness.blocking} />
          <ThumbnailExport projectId={projectId} durationSec={readiness?.durationSec ?? 0} disabled={!readiness || readiness.sceneCount === 0 || readiness.blocking} />
        </div>
      </div>

      <Panel title="Render history" description={renders.length ? `${renders.length} render${renders.length === 1 ? "" : "s"}` : undefined}>
        {query.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : renders.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No renders yet. Your first render will appear here with its progress.</p>
        ) : (
          <div className="space-y-2">
            {renders.map((r) => (
              <RenderRow key={r.id} render={r} live={live.renders.find((l) => l.id === r.id)} projectId={projectId} onPlay={setPlaying} />
            ))}
          </div>
        )}
      </Panel>

      <AlertDialog open={!!forcePrompt} onOpenChange={(open) => !open && setForcePrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Some scenes aren&apos;t approved</AlertDialogTitle>
            <AlertDialogDescription>{forcePrompt} You can review them first, or render anyway.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Link href={`/projects/${projectId}/scenes`}>Review scenes</Link>
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => create.mutate(true)}>Render anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!playing} onOpenChange={(open) => !open && setPlaying(null)}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{playing?.label}</DialogTitle>
          </DialogHeader>
          {playing?.url ? <video src={playing.url} poster={playing.thumbnailUrl ?? undefined} controls autoPlay className="max-h-[75vh] w-full rounded-lg bg-black" /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
