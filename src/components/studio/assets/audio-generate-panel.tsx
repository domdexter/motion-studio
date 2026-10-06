"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Music, Sparkles, Volume2, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { PublicJob } from "@/server/jobs/queue";
import type { getVoiceOverview } from "@/server/services/voice";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Panel } from "../common";
import { useJob } from "../workspace/use-job";

type VoiceOverview = Awaited<ReturnType<typeof getVoiceOverview>>;
type Kind = "music" | "sfx";

const PRESETS: Record<Kind, string[]> = {
  music: [
    "Upbeat modern corporate track, light percussion, bright plucked synths, confident and optimistic, 110 BPM",
    "Calm ambient tech bed, soft evolving pads, subtle pulse, minimal and clean",
    "Cinematic build with rising strings and drums, ends on a bold confident hit",
    "Warm lo-fi hip-hop groove, mellow keys, vinyl texture, relaxed",
  ],
  sfx: ["Soft UI click", "Fast airy whoosh transition", "Friendly notification ping", "Cash register cha-ching", "Mechanical keyboard typing, short burst", "Deep cinematic boom impact"],
};

function GenerationRow({ jobId, label, onDismiss }: { jobId: string; label: string; onDismiss: () => void }) {
  const { job } = useJob(jobId, (finished) => {
    const result = finished.result as { name?: string; trackId?: string | null } | null;
    if (finished.status === "succeeded") toast.success(`Generated “${result?.name ?? label}”`, { description: result?.trackId ? "Added to the audio library and placed on the timeline." : "Added to the audio library." });
    else if (finished.status === "failed") toast.error(finished.error?.message ?? "Audio generation failed.", { description: finished.error?.hint ?? undefined });
  });
  if (!job) return null;
  const done = job.status === "succeeded";
  const failed = job.status === "failed" || job.status === "cancelled";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
      {done ? <CheckCircle2 className="size-4 text-success" /> : failed ? <XCircle className="size-4 text-destructive" /> : <Loader2 className="size-4 animate-spin text-primary" />}
      <div className="min-w-0 flex-1">
        <p className="truncate">{label}</p>
        {failed ? (
          <p className="truncate text-xs text-destructive">{job.error?.message ?? "Failed"}</p>
        ) : done ? (
          <p className="text-xs text-muted-foreground">Ready — find it in the audio library below.</p>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <Progress value={Math.round((Number.isFinite(job.progress) ? job.progress : 0) * 100)} className="h-1.5" />
            <span className="shrink-0 text-xs text-muted-foreground">{job.stage ?? "Queued"}</span>
          </div>
        )}
      </div>
      {done || failed ? (
        <Button size="xs" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      ) : null}
    </div>
  );
}

/** Generate music beds and sound effects with ElevenLabs (server-side key) straight into the project. */
export function AudioGeneratePanel({ projectId, durationSec }: { projectId: string; durationSec: number }) {
  const providers = useQuery({
    queryKey: ["project", projectId, "voice-providers"],
    queryFn: async () => (await http.get<{ voice: VoiceOverview }>(`/api/projects/${projectId}/voice`)).voice.providers,
  });
  const configured = !!providers.data?.elevenlabs.configured;
  const [kind, setKind] = useState<Kind>("music");
  const [prompt, setPrompt] = useState("");
  const [length, setLength] = useState("");
  const [instrumental, setInstrumental] = useState(true);
  const [loop, setLoop] = useState(false);
  const [influence, setInfluence] = useState(0.3);
  const [name, setName] = useState("");
  const [place, setPlace] = useState(true);
  const [start, setStart] = useState("0");
  const [jobs, setJobs] = useState<{ id: string; label: string }[]>([]);

  const videoLength = durationSec > 0 ? Math.ceil(durationSec) : null;
  const lengthNumber = length.trim() === "" ? null : Number(length);
  const lengthInvalid = lengthNumber !== null && (!Number.isFinite(lengthNumber) || (kind === "music" ? lengthNumber < 3 || lengthNumber > 600 : lengthNumber < 0.5 || lengthNumber > 30));

  const generate = useMutation({
    mutationFn: () =>
      http.post<{ job: PublicJob }>(`/api/projects/${projectId}/audio-tracks/generate`, {
        kind,
        prompt: prompt.trim(),
        durationSec: lengthNumber,
        instrumental,
        loop,
        promptInfluence: kind === "sfx" ? influence : undefined,
        name: name.trim() || undefined,
        addToTimeline: place,
        startSec: Math.max(0, Number(start) || 0),
      }),
    onSuccess: ({ job }) => {
      setJobs((j) => [{ id: job.id, label: `${kind === "music" ? "Music" : "SFX"} · ${name.trim() || prompt.trim()}` }, ...j]);
      toast.info(kind === "music" ? "Composing music with ElevenLabs…" : "Generating the sound effect…");
    },
    onError: (e) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined }),
  });

  return (
    <Panel
      title="Generate with ElevenLabs"
      description="Describe a music bed or sound effect. The result lands in the audio library and, optionally, on the timeline — with fades and ducking under the voice."
      actions={
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={kind}
          onValueChange={(v) => {
            if (!v) return;
            setKind(v as Kind);
            setLength("");
          }}
        >
          <ToggleGroupItem value="music">
            <Music /> Music
          </ToggleGroupItem>
          <ToggleGroupItem value="sfx">
            <Volume2 /> Sound effect
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {providers.data && !configured ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <span>ElevenLabs isn&apos;t configured. Add your API key to generate music and sound effects — or upload your own audio below.</span>
          <Button size="xs" variant="outline" className="ml-auto" asChild>
            <Link href="/settings#elevenlabs">Open settings</Link>
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={4000}
            placeholder={kind === "music" ? "e.g. Upbeat modern corporate track with light percussion and bright synths, optimistic, 110 BPM" : "e.g. Soft UI click with a subtle digital sparkle"}
            aria-label="Audio prompt"
          />
          <div className="flex flex-wrap gap-1.5">
            {PRESETS[kind].map((p) => (
              <button key={p} type="button" onClick={() => setPrompt(p)} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
                {p.length > 42 ? `${p.slice(0, 40)}…` : p}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Length (s)</Label>
              <Input
                value={length}
                onChange={(e) => setLength(e.target.value)}
                inputMode="decimal"
                className={cn("font-mono", lengthInvalid && "border-destructive")}
                placeholder={kind === "music" ? (videoLength ? `${videoLength} (video)` : "30") : "auto"}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Name (optional)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{kind === "music" ? "3–600 s. Empty matches the video length." : "0.5–30 s. Empty lets ElevenLabs choose."}</p>
          {kind === "music" ? (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={instrumental} onCheckedChange={setInstrumental} /> Instrumental (no vocals)
            </label>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={loop} onCheckedChange={setLoop} /> Seamless loop
              </label>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Prompt influence {Math.round(influence * 100)}%</Label>
                <Slider min={0} max={1} step={0.05} value={[influence]} onValueChange={([v]) => setInfluence(v)} aria-label="Prompt influence" />
              </div>
            </>
          )}
          <div className="flex items-center gap-2 text-sm">
            <Switch checked={place} onCheckedChange={setPlace} id="place-on-timeline" />
            <label htmlFor="place-on-timeline">Place on the timeline at</label>
            <Input value={start} onChange={(e) => setStart(e.target.value)} disabled={!place} inputMode="decimal" className="h-8 w-20 font-mono" aria-label="Start second" />
            <span className="text-muted-foreground">s</span>
          </div>
          <Button className="w-full" onClick={() => generate.mutate()} disabled={!configured || prompt.trim().length < 3 || lengthInvalid || generate.isPending}>
            {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate {kind === "music" ? "music" : "sound effect"}
          </Button>
        </div>
      </div>

      {jobs.length ? (
        <div className="mt-4 space-y-2">
          {jobs.map((j) => (
            <GenerationRow key={j.id} jobId={j.id} label={j.label} onDismiss={() => setJobs((list) => list.filter((x) => x.id !== j.id))} />
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
