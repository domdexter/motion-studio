"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mic, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AudioTrackDto } from "@/server/services/audio-tracks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { EmptyState, PageHeader, Panel } from "../common";
import { useWorkspace } from "../workspace/workspace-shell";
import { AssetLibrary, useAssets } from "./asset-library";
import { AudioGeneratePanel } from "./audio-generate-panel";

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

function NumField({ label, value, placeholder, onCommit }: { label: string; value: number | null; placeholder?: string; onCommit: (text: string) => void }) {
  const shown = value === null ? "" : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        className="h-8 font-mono text-xs"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== shown && onCommit(text)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

export function TrackRow({ projectId, track, durationSec }: { projectId: string; track: AudioTrackDto; durationSec: number }) {
  const queryClient = useQueryClient();
  const [volume, setVolume] = useState(track.volume);
  useEffect(() => setVolume(track.volume), [track.volume]);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => http.patch(`/api/projects/${projectId}/audio-tracks/${track.id}`, body), onSuccess: invalidate, onError: fail });
  const remove = useMutation({
    mutationFn: () => http.delete(`/api/projects/${projectId}/audio-tracks/${track.id}`),
    onSuccess: () => {
      toast.success(`Removed “${track.name}”`);
      invalidate();
    },
    onError: fail,
  });
  const commitNumber = (key: string, text: string, nullable = false) => {
    if (nullable && text.trim() === "") return patch.mutate({ [key]: null });
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Enter a positive number of seconds.");
      return;
    }
    patch.mutate({ [key]: n });
  };
  const clip = track.durationSec ?? (track.loop ? Math.max(0, durationSec - track.startSec) : Math.max(0, (track.sourceDurationSec ?? 0) - track.trimStartSec));
  const left = durationSec ? Math.min(100, (track.startSec / durationSec) * 100) : 0;
  const width = durationSec ? Math.max(0.5, Math.min(100 - left, (clip / durationSec) * 100)) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{track.kind === "music" ? "Music" : track.kind === "voice" ? "Voice line" : "SFX"}</Badge>
        <span className="font-medium">{track.name}</span>
        <span className="text-xs text-muted-foreground">
          {track.assetName} · source {formatDuration(track.sourceDurationSec)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <audio src={track.url} controls preload="none" className="h-8 w-56" />
          <Button size="icon-sm" variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending} aria-label="Remove track">
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="relative mt-2 h-2.5 overflow-hidden rounded bg-muted" title="Placement on the video timeline">
        <div className={cn("absolute inset-y-0 rounded", track.kind === "music" ? "bg-emerald-500/60" : track.kind === "voice" ? "bg-sky-500/70" : "bg-amber-500/70", track.muted && "opacity-30")} style={{ left: `${left}%`, width: `${width}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <NumField label="Start (s)" value={track.startSec} onCommit={(t) => commitNumber("startSec", t)} />
        <NumField label="Trim start (s)" value={track.trimStartSec} onCommit={(t) => commitNumber("trimStartSec", t)} />
        <NumField label="Length (s)" value={track.durationSec} placeholder="full" onCommit={(t) => commitNumber("durationSec", t, true)} />
        <NumField label="Fade in (s)" value={track.fadeInSec} onCommit={(t) => commitNumber("fadeInSec", t)} />
        <NumField label="Fade out (s)" value={track.fadeOutSec} onCommit={(t) => commitNumber("fadeOutSec", t)} />
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Volume {Math.round(volume * 100)}%</Label>
          <Slider className="py-2.5" min={0} max={1} step={0.01} value={[volume]} onValueChange={([v]) => setVolume(v)} onValueCommit={([v]) => patch.mutate({ volume: v })} aria-label="Track volume" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-5 text-sm">
        <label className="flex items-center gap-2">
          <Switch checked={track.muted} onCheckedChange={(v) => patch.mutate({ muted: v })} /> Mute
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={track.loop} onCheckedChange={(v) => patch.mutate({ loop: v })} /> Loop
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={track.duckUnderVoice} onCheckedChange={(v) => patch.mutate({ duckUnderVoice: v })} /> Duck under the voice
        </label>
        <Select value={track.kind} onValueChange={(v) => patch.mutate({ kind: v })}>
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="music">Music</SelectItem>
            <SelectItem value="sfx">Sound effect</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function AudioPage({ projectId }: { projectId: string }) {
  const { project } = useWorkspace();
  const queryClient = useQueryClient();
  const tracks = useQuery({ queryKey: ["project", projectId, "audio-tracks"], queryFn: async () => (await http.get<{ tracks: AudioTrackDto[] }>(`/api/projects/${projectId}/audio-tracks`)).tracks });
  const audioAssets = useAssets(projectId, ["music", "sfx", "audio"]);
  const [mix, setMix] = useState({ volume: 1, muted: false });
  useEffect(() => {
    if (project?.mix) setMix({ volume: project.mix.volume ?? 1, muted: !!project.mix.muted });
  }, [project?.mix?.volume, project?.mix?.muted]); // eslint-disable-line react-hooks/exhaustive-deps
  const [addAssetId, setAddAssetId] = useState("");
  const [addStart, setAddStart] = useState("0");
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  const saveMix = useMutation({ mutationFn: (body: { volume?: number; muted?: boolean }) => http.patch(`/api/projects/${projectId}/voice/mix`, body), onSuccess: invalidate, onError: fail });
  const add = useMutation({
    mutationFn: () => http.post(`/api/projects/${projectId}/audio-tracks`, { assetId: addAssetId, startSec: Math.max(0, Number(addStart) || 0) }),
    onSuccess: () => {
      toast.success("Track added to the timeline");
      setAddAssetId("");
      invalidate();
    },
    onError: fail,
  });
  const durationSec = project?.state.durationSec ?? 0;

  return (
    <div className="mx-auto max-w-[1300px] space-y-6 p-6">
      <PageHeader title="Audio" description="The voice-over is the master track. Music and sound effects are mixed under it — with trims, fades and automatic ducking while the narrator speaks." />

      <Panel title="Voice-over" description="Timing source of truth. Its level applies to preview and render.">
        {project?.voice ? (
          <div className="flex flex-wrap items-center gap-5">
            <audio src={project.voice.url} controls preload="none" className="h-9" />
            <div className="text-sm">
              v{project.voice.version} · {project.voice.voiceName ?? project.voice.source} · {formatDuration(project.voice.durationSec)}
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Volume</span>
              <Slider className="w-44" min={0} max={2} step={0.05} value={[mix.volume]} onValueChange={([v]) => setMix((m) => ({ ...m, volume: v }))} onValueCommit={([v]) => saveMix.mutate({ volume: v })} aria-label="Voice volume" />
              <span className="w-10 font-mono text-xs">{Math.round(mix.volume * 100)}%</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={mix.muted}
                onCheckedChange={(v) => {
                  setMix((m) => ({ ...m, muted: v }));
                  saveMix.mutate({ muted: v });
                }}
              />
              Mute voice
            </label>
          </div>
        ) : (
          <EmptyState
            icon={<Mic />}
            title="No voice-over yet"
            description="Generate one with ElevenLabs or the system voice, or import your own recording."
            action={
              <Button size="sm" asChild>
                <Link href={`/projects/${projectId}/voice`}>Open Voice</Link>
              </Button>
            }
          />
        )}
      </Panel>

      <AudioGeneratePanel projectId={projectId} durationSec={durationSec} />

      <Panel title="Music & sound effects" description={durationSec ? `Placed on the ${formatDuration(durationSec)} timeline.` : "Placed on the video timeline."}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Audio asset</Label>
            <Select value={addAssetId} onValueChange={setAddAssetId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={audioAssets.data?.length ? "Choose music or a sound effect" : "Upload audio below first"} />
              </SelectTrigger>
              <SelectContent>
                {(audioAssets.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.kind === "sfx" ? "SFX" : "music"} · {formatDuration(a.durationSec)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-28 space-y-1">
            <Label className="text-xs text-muted-foreground">Start (s)</Label>
            <Input value={addStart} onChange={(e) => setAddStart(e.target.value)} inputMode="decimal" className="font-mono" />
          </div>
          <Button onClick={() => add.mutate()} disabled={!addAssetId || add.isPending}>
            {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add to timeline
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {!tracks.data ? (
            <Skeleton className="h-28" />
          ) : tracks.data.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No tracks yet. Music beds default to 35% volume with fades and ducking under the voice.</p>
          ) : (
            tracks.data.map((t) => <TrackRow key={t.id} projectId={projectId} track={t} durationSec={durationSec} />)
          )}
        </div>
      </Panel>

      <AssetLibrary projectId={projectId} title="Audio library" kinds={["music", "sfx", "audio"]} uploadKinds={["music", "sfx"]} emptyHint="Upload music beds and sound effects (MP3, WAV, M4A, AAC, OGG, FLAC)." />
    </div>
  );
}
