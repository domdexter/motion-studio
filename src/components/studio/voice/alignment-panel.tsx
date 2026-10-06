"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Captions, Cpu, FileDiff, Loader2, Pencil, ScanText, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { TimedWord } from "@/core/spec/timing";
import { formatClock } from "@/core/timing/frames";
import type { PublicJob } from "@/server/jobs/queue";
import type { ProjectDetail } from "@/server/services/projects";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage, http, uploadForm } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Dropzone, ErrorState } from "../common";

interface TranscriptDetail {
  id: string;
  version: number;
  source: string;
  sourceLabel: string;
  text: string;
  durationSec: number;
  words: TimedWord[];
  quality: { loss?: number; matchedRatio?: number; interpolatedWords?: number } | null;
  warnings: string[];
  cues: number;
  spokenText: string | null;
  voiceTakeId: string;
  voiceTakeVersion: number;
  createdAt: string;
}

interface TranscriptSummary {
  id: string;
  version: number;
  sourceLabel: string;
  wordCount: number;
  voiceTakeVersion: number;
  active: boolean;
  createdAt: string;
}

function MethodButton({ icon, label, description, disabled, reason, onClick, pending }: { icon: React.ReactNode; label: string; description: string; disabled?: boolean; reason?: string; onClick: () => void; pending?: boolean }) {
  const button = (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{pending ? <Loader2 className="animate-spin" /> : icon}</span>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
  if (!disabled || !reason) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block">{button}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function EditTimingDialog({ projectId, transcript, open, onOpenChange }: { projectId: string; transcript: TranscriptDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(() => transcript.words.map((w) => ({ text: w.text, start: String(w.start), end: String(w.end) })));
  const [page, setPage] = useState(0);
  const pageSize = 150;
  const save = useMutation({
    mutationFn: () =>
      http.post(`/api/projects/${projectId}/transcripts`, {
        baseTranscriptId: transcript.id,
        words: rows.map((r) => ({ text: r.text, start: Number(r.start), end: Number(r.end) })),
      }),
    onSuccess: () => {
      toast.success("Saved as a new transcript version");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => toast.error("Could not save timing", { description: errorMessage(e) }),
  });
  const pages = Math.ceil(rows.length / pageSize);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit transcript v{transcript.version}</DialogTitle>
          <DialogDescription>Fix words or nudge timings. Saving creates a new transcript version; the original is kept.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-popover text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left">#</th>
                <th className="px-2 py-1.5 text-left">Word</th>
                <th className="px-2 py-1.5 text-left">Start (s)</th>
                <th className="px-2 py-1.5 text-left">End (s)</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(page * pageSize, (page + 1) * pageSize).map((r, k) => {
                const i = page * pageSize + k;
                return (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-2 py-1 font-mono text-xs text-muted-foreground">{i}</td>
                    <td className="px-2 py-1">
                      <Input value={r.text} className="h-7" onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                    </td>
                    <td className="px-2 py-1">
                      <Input value={r.start} className="h-7 font-mono text-xs" inputMode="decimal" onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                    </td>
                    <td className="px-2 py-1">
                      <Input value={r.end} className="h-7 font-mono text-xs" inputMode="decimal" onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div className="flex items-center justify-center gap-2 text-xs">
            <Button size="xs" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {page + 1} / {pages}
            </span>
            <Button size="xs" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save as new version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AlignmentPanel({
  projectId,
  project,
  onJob,
  alignBusy,
  currentTime,
  onSeek,
  scriptAvailable,
}: {
  projectId: string;
  project: ProjectDetail;
  onJob: (job: PublicJob) => void;
  alignBusy: boolean;
  currentTime: number;
  onSeek: (t: number) => void;
  scriptAvailable: boolean;
}) {
  const queryClient = useQueryClient();
  const [useScript, setUseScript] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [importError, setImportError] = useState<unknown>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const stage = project.state.pipeline.stages.alignment;
  const transcriptId = project.transcript?.id ?? null;
  const voice = project.voice;

  const detail = useQuery({
    queryKey: ["project", projectId, "transcript", transcriptId],
    queryFn: async () => (await http.get<{ transcript: TranscriptDetail }>(`/api/projects/${projectId}/transcripts/${transcriptId}`)).transcript,
    enabled: !!transcriptId,
  });
  const history = useQuery({
    queryKey: ["project", projectId, "transcripts"],
    queryFn: async () => (await http.get<{ transcripts: TranscriptSummary[] }>(`/api/projects/${projectId}/transcripts`)).transcripts,
  });
  const whisper = useQuery({
    queryKey: ["whisper"],
    queryFn: () => http.get<{ status: { installed: boolean; models: string[] } }>("/api/tools/whisper"),
    staleTime: 60_000,
  });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => http.get<{ settings: { alignment: { whisperModel: string } }; secrets: { elevenlabsApiKey: { configured: boolean } } }>("/api/settings") });
  const comparison = useQuery({
    queryKey: ["project", projectId, "script-compare", transcriptId],
    queryFn: async () =>
      (await http.get<{ comparison: { identical: boolean; matchedRatio: number; differences: { type: string; scriptText: string; transcriptText: string; at: number | null }[]; scriptVersion: number; transcriptVersion: number } }>(`/api/projects/${projectId}/script/compare`)).comparison,
    enabled: compareOpen && !!transcriptId && scriptAvailable,
  });

  const align = useMutation({
    mutationFn: (method: string) => http.post<{ job: PublicJob }>(`/api/projects/${projectId}/alignment`, { method, useScript }),
    onSuccess: ({ job }) => onJob(job),
    onError: (e) => toast.error("Alignment could not start", { description: errorMessage(e) }),
  });
  const activate = useMutation({
    mutationFn: (id: string) => http.post(`/api/projects/${projectId}/transcripts/${id}/activate`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const importTiming = async (file: File) => {
    setImportError(null);
    setImportProgress(0);
    const form = new FormData();
    form.append("file", file);
    try {
      const { result } = await uploadForm<{ result: { words: number; cues: number; warnings: string[]; timelineCreated: boolean } }>(`/api/projects/${projectId}/alignment/import`, form, setImportProgress);
      toast.success(`Imported ${result.words} words${result.cues ? ` in ${result.cues} cues` : ""}`, { description: result.warnings.join(" ") || undefined });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    } catch (err) {
      setImportError(err);
    } finally {
      setImportProgress(null);
    }
  };

  const keyConfigured = !!settings.data?.secrets.elevenlabsApiKey.configured;
  const whisperModel = settings.data?.settings.alignment.whisperModel ?? "base.en";
  const whisperReady = !!whisper.data?.status.installed && !!whisper.data.status.models.includes(whisperModel);
  const activeWordIndex = useMemo(() => {
    const words = detail.data?.words ?? [];
    let lo = 0;
    let hi = words.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (words[mid].start <= currentTime) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found >= 0 && currentTime <= words[found].end + 0.25 ? found : -1;
  }, [detail.data, currentTime]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {stage.state === "ready" ? (
          <CheckCircle2 className="size-5 text-success" />
        ) : stage.state === "stale" ? (
          <AlertTriangle className="size-5 text-stale" />
        ) : (
          <ScanText className="size-5 text-muted-foreground" />
        )}
        <div>
          <p className="text-sm font-medium">{stage.label}</p>
          <p className="text-xs text-muted-foreground">
            {stage.reason ??
              (project.transcript
                ? `Transcript v${project.transcript.version} · ${project.transcript.wordCount} words · ${detail.data?.sourceLabel ?? project.transcript.source}`
                : voice
                  ? "Word timing is required for the audio-locked timeline."
                  : "Add a voice-over first.")}
          </p>
        </div>
        {detail.data ? (
          <div className="ml-auto flex gap-2">
            <Button size="xs" variant="outline" onClick={() => setCompareOpen((o) => !o)} disabled={!scriptAvailable}>
              <FileDiff /> {compareOpen ? "Hide" : "Compare with script"}
            </Button>
            <Button size="xs" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit timing
            </Button>
          </div>
        ) : null}
      </div>

      {voice ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MethodButton
            icon={<Sparkles />}
            label="Forced alignment"
            description="ElevenLabs aligns your script to the audio (best for script + audio)."
            disabled={!keyConfigured || !scriptAvailable || alignBusy}
            reason={!keyConfigured ? "Add an ElevenLabs API key in Settings" : !scriptAvailable ? "Needs a script" : "An alignment is running"}
            pending={align.isPending && align.variables === "elevenlabs_forced_alignment"}
            onClick={() => align.mutate("elevenlabs_forced_alignment")}
          />
          <MethodButton
            icon={<ScanText />}
            label="Speech-to-text"
            description="ElevenLabs transcribes what was actually said, with word timing."
            disabled={!keyConfigured || alignBusy}
            reason={!keyConfigured ? "Add an ElevenLabs API key in Settings" : "An alignment is running"}
            pending={align.isPending && align.variables === "elevenlabs_stt"}
            onClick={() => align.mutate("elevenlabs_stt")}
          />
          <div className="space-y-1.5">
            <MethodButton
              icon={<Cpu />}
              label="Local whisper.cpp"
              description={whisperReady ? `Offline transcription (${whisperModel}).` : "Install in Settings → Alignment to use offline."}
              disabled={!whisperReady || alignBusy}
              reason={!whisperReady ? "whisper.cpp or its model is not installed" : "An alignment is running"}
              pending={align.isPending && align.variables === "whisper_cpp"}
              onClick={() => align.mutate("whisper_cpp")}
            />
            {scriptAvailable ? (
              <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Checkbox checked={useScript} onCheckedChange={(v) => setUseScript(!!v)} /> Keep script wording (local forced alignment)
              </label>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Dropzone accept=".srt,.vtt,.json" onFiles={(f) => f[0] && void importTiming(f[0])} label={<span className="flex items-center gap-1.5"><Captions className="size-4" /> Import timestamps</span>} hint="SRT, WebVTT or JSON" className="py-4" disabled={importProgress !== null} />
            {importProgress !== null ? <Progress value={importProgress * 100} className="h-1" /> : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Generate or import a voice-over above, then align it here.</p>
      )}
      {importError ? <ErrorState error={importError} title="Timestamp import failed" /> : null}
      {detail.data?.warnings.length ? (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
          {detail.data.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}

      {compareOpen ? (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          {comparison.isLoading ? (
            <Skeleton className="h-16" />
          ) : comparison.error ? (
            <p className="text-sm text-destructive">{errorMessage(comparison.error)}</p>
          ) : comparison.data ? (
            comparison.data.identical ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" /> The voice-over matches script v{comparison.data.scriptVersion} word for word.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm">
                  {comparison.data.differences.length} difference{comparison.data.differences.length === 1 ? "" : "s"} · {Math.round(comparison.data.matchedRatio * 100)}% matched.{" "}
                  <span className="text-muted-foreground">Your script is never changed automatically.</span>
                </p>
                <ul className="max-h-60 space-y-1 overflow-auto text-sm">
                  {comparison.data.differences.map((d, i) => (
                    <li key={i} className="flex items-center gap-2 rounded bg-background/50 px-2 py-1">
                      <span className="w-14 font-mono text-[11px] text-muted-foreground">{d.at !== null ? formatClock(d.at, 1) : "—"}</span>
                      <span className="w-16 text-[11px] uppercase text-muted-foreground">{d.type}</span>
                      {d.scriptText ? <span className="text-destructive line-through">{d.scriptText}</span> : null}
                      {d.transcriptText ? <span className="text-success">{d.transcriptText}</span> : null}
                      {d.at !== null ? (
                        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onSeek(d.at!)}>
                          Play
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      {detail.isLoading ? <Skeleton className="h-32" /> : null}
      {detail.data ? (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Word timing · click a word to play from there</span>
            {typeof detail.data.quality?.matchedRatio === "number" ? <span>· {Math.round(detail.data.quality.matchedRatio * 100)}% script match</span> : null}
            {detail.data.quality?.interpolatedWords ? <span className="text-warning">· {detail.data.quality.interpolatedWords} interpolated</span> : null}
          </div>
          <div className="max-h-72 overflow-auto rounded-lg border border-border bg-background/40 p-3 text-[15px] leading-8">
            {detail.data.words.map((w, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSeek(w.start)}
                title={`${w.start.toFixed(2)}s – ${w.end.toFixed(2)}s${w.interpolated ? " (interpolated)" : ""}`}
                className={cn(
                  "mr-1 rounded px-0.5 transition-colors hover:bg-primary/15",
                  i === activeWordIndex && "bg-primary/25 text-foreground",
                  w.interpolated && "underline decoration-warning/60 decoration-dotted underline-offset-4",
                )}
              >
                {w.text}
              </button>
            )).flatMap((node, i) => (i === 0 ? [node] : [" ", node]))}
          </div>
        </div>
      ) : null}

      {history.data && history.data.length > 1 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">Transcript history ({history.data.length})</summary>
          <ul className="mt-2 space-y-1">
            {history.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded px-2 py-1 hover:bg-muted/40">
                <span className="font-mono text-xs">v{t.version}</span>
                <span className="text-xs">{t.sourceLabel}</span>
                <span className="text-xs text-muted-foreground">voice v{t.voiceTakeVersion} · {t.wordCount} words · {relativeTime(t.createdAt)}</span>
                {t.active ? (
                  <span className="ml-auto text-xs text-success">active</span>
                ) : (
                  <Button size="xs" variant="ghost" className="ml-auto" onClick={() => activate.mutate(t.id)}>
                    Use this
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {detail.data ? <EditTimingDialog key={detail.data.id} projectId={projectId} transcript={detail.data} open={editOpen} onOpenChange={setEditOpen} /> : null}
      {!voice ? null : project.state.pipeline.stages.timeline.state === "ready" ? (
        <p className="text-xs text-muted-foreground">
          Timeline ready ·{" "}
          <Link href={`/projects/${projectId}/timeline`} className="text-primary hover:underline">
            open the timeline
          </Link>
        </p>
      ) : null}
    </div>
  );
}
