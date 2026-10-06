"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2, Trash2, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatClock } from "@/core/timing/frames";
import type { PublicJob } from "@/server/jobs/queue";
import type { getVoiceOverview } from "@/server/services/voice";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage, http, uploadForm } from "@/lib/api-client";
import { formatBytes, relativeTime } from "@/lib/format";
import { useProject } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { WaveformPlayer, type WaveformHandle } from "../audio/waveform-player";
import { Dropzone, ErrorState, Panel } from "../common";
import { useJob } from "../workspace/use-job";
import { AlignmentPanel } from "./alignment-panel";
import { GeneratePanel } from "./generate-panel";
import { JobStatus } from "./job-status";

type VoiceOverview = Awaited<ReturnType<typeof getVoiceOverview>>;

const SOURCE_LABEL: Record<string, string> = { elevenlabs: "ElevenLabs", system_tts: "System voice", import: "Imported" };

export function VoicePage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const project = useProject(projectId);
  const overview = useQuery({
    queryKey: ["project", projectId, "voice"],
    queryFn: async () => (await http.get<{ voice: VoiceOverview }>(`/api/projects/${projectId}/voice`)).voice,
  });
  const player = useRef<WaveformHandle>(null);
  const [time, setTime] = useState(0);
  const [generateJobId, setGenerateJobId] = useState<string | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [alignJobId, setAlignJobId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);

  // Resume tracking jobs that were already running (page reload, or started by Claude Code).
  useEffect(() => {
    const jobs = overview.data?.jobs ?? [];
    const active = (types: string[]) => jobs.find((j) => types.includes(j.type) && (j.status === "queued" || j.status === "running"));
    if (!generateJobId) {
      const g = active(["voice.generate"]);
      if (g) setGenerateJobId(g.id);
    }
    if (!alignJobId) {
      const a = active(["alignment.forced", "alignment.stt", "alignment.whisper"]);
      if (a) setAlignJobId(a.id);
    }
  }, [overview.data, generateJobId, alignJobId]);

  const generateJob = useJob(generateJobId, (job) => {
    if (job.status === "succeeded") {
      const r = job.result as { version: number; words: number; timelineCreated: boolean };
      toast.success(`Voice-over v${r.version} ready`, { description: `${r.words} words aligned${r.timelineCreated ? " · timeline built" : ""}` });
    }
  });
  const previewJob = useJob(previewJobId);
  const alignJob = useJob(alignJobId, (job) => {
    if (job.status === "succeeded") {
      const r = job.result as { words: number; timelineCreated: boolean };
      toast.success("Alignment complete", { description: `${r.words} words${r.timelineCreated ? " · timeline built" : ""}` });
    }
  });

  const activate = useMutation({
    mutationFn: (takeId: string) => http.post(`/api/projects/${projectId}/voice/${takeId}/activate`),
    onSuccess: () => {
      toast.success("Voice-over switched");
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => toast.error("Could not switch voice-over", { description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (takeId: string) => http.delete(`/api/projects/${projectId}/voice/${takeId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
    onError: (e) => toast.error("Could not delete take", { description: errorMessage(e) }),
  });
  const mix = useMutation({
    mutationFn: (body: { volume?: number; muted?: boolean }) => http.patch(`/api/projects/${projectId}/voice/mix`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  const importAudio = async (file: File) => {
    setUploadError(null);
    setUploadProgress(0);
    const form = new FormData();
    form.append("file", file);
    try {
      await uploadForm(`/api/projects/${projectId}/voice/import`, form, setUploadProgress);
      toast.success("Voice-over imported", { description: "Align it below to get word timing." });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    } catch (err) {
      setUploadError(err);
    } finally {
      setUploadProgress(null);
    }
  };

  if (overview.error || project.error) return <div className="p-6"><ErrorState error={overview.error ?? project.error} onRetry={() => void overview.refetch()} /></div>;
  if (!overview.data || !project.data) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const data = overview.data;
  const detail = project.data;
  const active = data.takes.find((t) => t.active) ?? null;
  const voiceStage = detail.state.pipeline.stages.voice;
  const scriptAvailable = !!data.script && data.script.words > 0;

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Voice-over</h1>
          <p className="mt-1 text-sm text-muted-foreground">The actual audio is the source of truth for all timing. Generate it, or bring your own — ElevenLabs is optional.</p>
        </div>
      </div>

      <Panel
        title={active ? `Active voice-over · v${active.version}` : "No voice-over yet"}
        description={
          active
            ? `${SOURCE_LABEL[active.source] ?? active.source}${active.voiceName ? ` · ${active.voiceName}` : active.label ? ` · ${active.label}` : ""}${active.modelId ? ` · ${active.modelId}` : ""} · ${formatClock(active.durationSec)} · ${relativeTime(active.createdAt)}`
            : "Generate one from the script or import an existing recording."
        }
        actions={
          active ? (
            <div className="flex items-center gap-2">
              <Button size="icon-xs" variant="ghost" aria-label={data.mix.muted ? "Unmute voice-over" : "Mute voice-over"} onClick={() => mix.mutate({ muted: !data.mix.muted })}>
                {data.mix.muted ? <VolumeX className="text-warning" /> : <Volume2 />}
              </Button>
              <Slider className="w-28" min={0} max={1.5} step={0.05} value={[data.mix.volume]} onValueCommit={([v]) => mix.mutate({ volume: v })} aria-label="Voice-over volume" />
              <span className="w-10 font-mono text-[11px] text-muted-foreground">{Math.round(data.mix.volume * 100)}%</span>
            </div>
          ) : null
        }
      >
        {active ? (
          <div className="space-y-3">
            <WaveformPlayer ref={player} url={active.url} peaksUrl={active.peaksUrl} durationSec={active.durationSec} onTime={setTime} height={64} />
            {voiceStage.state === "stale" ? (
              <p className="flex items-center gap-2 text-sm text-stale">
                <AlertTriangle className="size-4" /> {voiceStage.reason} Regenerate below, or keep this take.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Once a voice-over exists you can play it, align it, and build the audio-locked timeline.</p>
        )}
      </Panel>

      <Panel title="Create a voice-over">
        <Tabs defaultValue={data.providers.elevenlabs.configured || !data.takes.length ? "generate" : "import"}>
          <TabsList>
            <TabsTrigger value="generate">Generate</TabsTrigger>
            <TabsTrigger value="import">Import existing audio</TabsTrigger>
          </TabsList>
          <TabsContent value="generate" className="mt-4 space-y-4">
            <GeneratePanel
              projectId={projectId}
              overview={data}
              busy={generateJob.active}
              previewJob={previewJob.job}
              onJob={(kind, job) => (kind === "generate" ? setGenerateJobId(job.id) : setPreviewJobId(job.id))}
            />
            <JobStatus job={generateJob.job} label="Generating voice-over" failedTitle="Voice generation failed." onRetry={() => setGenerateJobId(null)} onDismiss={() => setGenerateJobId(null)} />
            {previewJob.active ? <JobStatus job={previewJob.job} label="Generating preview" /> : null}
            {previewJob.job?.status === "failed" ? <JobStatus job={previewJob.job} label="Preview" onDismiss={() => setPreviewJobId(null)} /> : null}
          </TabsContent>
          <TabsContent value="import" className="mt-4 space-y-3">
            <Dropzone
              accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
              onFiles={(files) => files[0] && void importAudio(files[0])}
              label="Drop a voice-over, or click to browse"
              hint="MP3, WAV, M4A, AAC, OGG, FLAC — human, client-provided or any AI provider"
              disabled={uploadProgress !== null}
            />
            {uploadProgress !== null ? (
              <div className="space-y-1">
                <Progress value={uploadProgress * 100} className="h-1" />
                <p className="text-xs text-muted-foreground">{uploadProgress < 1 ? `Uploading ${Math.round(uploadProgress * 100)}%` : "Analyzing audio…"}</p>
              </div>
            ) : null}
            {uploadError ? <ErrorState error={uploadError} title="Import failed" /> : null}
          </TabsContent>
        </Tabs>
      </Panel>

      <section id="alignment" className="scroll-mt-4">
        <Panel title="Alignment & transcript" description="Word-level timing derived from the audio. Every alignment is saved as a transcript version.">
          <div className="space-y-4">
            <JobStatus job={alignJob.job} label="Aligning" failedTitle="Alignment failed." onRetry={() => setAlignJobId(null)} onDismiss={() => setAlignJobId(null)} />
            <AlignmentPanel
              projectId={projectId}
              project={detail}
              scriptAvailable={scriptAvailable}
              alignBusy={alignJob.active}
              onJob={(job) => setAlignJobId(job.id)}
              currentTime={time}
              onSeek={(t) => {
                player.current?.seek(t);
                player.current?.play();
              }}
            />
          </div>
        </Panel>
      </section>

      <Panel title="All voice takes" description="Every generated or imported voice-over is kept. Switching takes never deletes storyboard work.">
        {data.takes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No takes yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-normal">Take</th>
                <th className="py-2 pr-3 font-normal">Source</th>
                <th className="py-2 pr-3 font-normal">Voice</th>
                <th className="py-2 pr-3 font-normal">Duration</th>
                <th className="py-2 pr-3 font-normal">Size</th>
                <th className="py-2 pr-3 font-normal">Aligned</th>
                <th className="py-2 pr-3 font-normal">Created</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {data.takes.map((t) => (
                <tr key={t.id} className={cn("border-b border-border/60", t.active && "bg-primary/[0.04]")}>
                  <td className="py-2 pr-3 font-mono text-xs">
                    v{t.version} {t.active ? <span className="ml-1 font-sans text-[11px] text-success">active</span> : null}
                  </td>
                  <td className="py-2 pr-3">{SOURCE_LABEL[t.source] ?? t.source}</td>
                  <td className="max-w-48 truncate py-2 pr-3 text-muted-foreground" title={t.label}>
                    {t.voiceName ?? t.label ?? "—"}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{formatClock(t.durationSec)}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{formatBytes(t.sizeBytes)}</td>
                  <td className="py-2 pr-3 text-xs">{t.transcriptCount ? `${t.transcriptCount} transcript${t.transcriptCount === 1 ? "" : "s"}` : <span className="text-muted-foreground">not aligned</span>}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{relativeTime(t.createdAt)}</td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {!t.active ? (
                        <Button size="xs" variant="outline" onClick={() => activate.mutate(t.id)} disabled={activate.isPending}>
                          {activate.isPending && activate.variables === t.id ? <Loader2 className="animate-spin" /> : null} Use this take
                        </Button>
                      ) : null}
                      <Button size="icon-xs" variant="ghost" asChild aria-label="Download">
                        <a href={`${t.url}${t.url.includes("?") ? "&" : "?"}download=1`}>
                          <Download />
                        </a>
                      </Button>
                      {!t.active ? (
                        <Button size="icon-xs" variant="ghost" aria-label="Delete take" onClick={() => confirm(`Delete voice take v${t.version}? Its transcripts are deleted too.`) && remove.mutate(t.id)}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {detail.state.pipeline.stages.timeline.state === "stale" ? (
        <div className="rounded-lg border border-stale/30 bg-stale/10 p-3 text-sm">
          Voice-over changed. Existing scene timing may no longer match.{" "}
          <Link href={`/projects/${projectId}/timeline`} className="text-primary hover:underline">
            Review the timeline
          </Link>
        </div>
      ) : null}
    </div>
  );
}
