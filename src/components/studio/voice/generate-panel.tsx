"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Loader2, Mic, Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicJob } from "@/server/jobs/queue";
import type { getVoiceOverview } from "@/server/services/voice";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorMessage, http } from "@/lib/api-client";
import { toast } from "sonner";

type VoiceOverview = Awaited<ReturnType<typeof getVoiceOverview>>;

const OUTPUT_FORMATS = [
  { value: "mp3_44100_128", label: "MP3 · 128 kbps" },
  { value: "mp3_44100_192", label: "MP3 · 192 kbps (Creator+)" },
  { value: "pcm_44100", label: "WAV · 44.1 kHz (Pro+)" },
  { value: "pcm_24000", label: "WAV · 24 kHz" },
];

export function GeneratePanel({
  projectId,
  overview,
  onJob,
  busy,
  previewJob,
}: {
  projectId: string;
  overview: VoiceOverview;
  onJob: (kind: "generate" | "preview", job: PublicJob) => void;
  busy: boolean;
  previewJob: PublicJob | null;
}) {
  const d = overview.defaults;
  const [provider, setProvider] = useState<"elevenlabs" | "system">(overview.providers.elevenlabs.configured || !overview.providers.system.available ? d.provider : "system");
  const [voiceId, setVoiceId] = useState<string | null>(d.elevenlabs.voiceId);
  const [modelId, setModelId] = useState(d.elevenlabs.modelId);
  const [outputFormat, setOutputFormat] = useState(d.elevenlabs.outputFormat);
  const [settings, setSettings] = useState(d.elevenlabs.voiceSettings);
  const [systemVoice, setSystemVoice] = useState<string | null>(d.system.voiceName);
  const [rate, setRate] = useState(d.system.rate);

  const configured = overview.providers.elevenlabs.configured;
  const voices = useQuery({
    queryKey: ["elevenlabs", "voices"],
    queryFn: () => http.get<{ voices: { voiceId: string; name: string; category: string | null; previewUrl: string | null; labels: Record<string, string> }[] }>("/api/providers/elevenlabs/voices"),
    enabled: configured && provider === "elevenlabs",
    retry: false,
    staleTime: 5 * 60_000,
  });
  const models = useQuery({
    queryKey: ["elevenlabs", "models"],
    queryFn: () => http.get<{ models: { modelId: string; name: string; maxCharacters: number | null }[] }>("/api/providers/elevenlabs/models"),
    enabled: configured && provider === "elevenlabs",
    retry: false,
    staleTime: 5 * 60_000,
  });
  const systemVoices = useQuery({
    queryKey: ["system-voices"],
    queryFn: () => http.get<{ available: boolean; voices: { name: string; culture: string }[] }>("/api/providers/system-voice/voices"),
    enabled: provider === "system" && overview.providers.system.available,
    retry: false,
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    if (!voiceId && voices.data?.voices.length) setVoiceId(voices.data.voices[0].voiceId);
  }, [voiceId, voices.data]);

  const body = () =>
    provider === "elevenlabs"
      ? { provider, voiceId, voiceName: voices.data?.voices.find((v) => v.voiceId === voiceId)?.name ?? null, modelId, outputFormat, settings }
      : { provider, voiceId: systemVoice, voiceName: systemVoice, rate };

  const generate = useMutation({
    mutationFn: () => http.post<{ job: PublicJob }>(`/api/projects/${projectId}/voice/generate`, body()),
    onSuccess: ({ job }) => onJob("generate", job),
    onError: (e) => toast.error("Voice generation failed to start", { description: errorMessage(e) }),
  });
  const preview = useMutation({
    mutationFn: () => http.post<{ job: PublicJob }>(`/api/projects/${projectId}/voice/preview`, body()),
    onSuccess: ({ job }) => onJob("preview", job),
    onError: (e) => toast.error("Preview failed to start", { description: errorMessage(e) }),
  });

  const maxChars = models.data?.models.find((m) => m.modelId === modelId)?.maxCharacters ?? null;
  const chars = overview.script?.characters ?? 0;
  const parts = maxChars && chars > maxChars ? Math.ceil(chars / maxChars) : 1;
  const selectedVoice = voices.data?.voices.find((v) => v.voiceId === voiceId);
  const previewResult = previewJob?.status === "succeeded" ? (previewJob.result as { url: string; text: string; voiceName: string | null }) : null;

  if (!overview.script) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Write or import a script first — the voice-over is generated from it.
        <div className="mt-3">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/projects/${projectId}/script`}>Open Script</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ToggleGroup type="single" variant="outline" value={provider} onValueChange={(v) => v && setProvider(v as "elevenlabs" | "system")}>
        <ToggleGroupItem value="elevenlabs" className="px-3">
          <Sparkles /> ElevenLabs
        </ToggleGroupItem>
        <ToggleGroupItem value="system" className="px-3" disabled={!overview.providers.system.available}>
          <Mic /> System voice (scratch)
        </ToggleGroupItem>
      </ToggleGroup>

      {provider === "elevenlabs" && !configured ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
          <KeyRound className="size-4 text-warning" />
          <span>ElevenLabs isn&apos;t configured. Add your API key, use the system scratch voice, or import your own voice-over.</span>
          <Button size="xs" variant="outline" className="ml-auto" asChild>
            <Link href="/settings#elevenlabs">Open settings</Link>
          </Button>
        </div>
      ) : null}

      {provider === "elevenlabs" && configured ? (
        <div className="space-y-4">
          {voices.error ? <p className="text-sm text-destructive">{errorMessage(voices.error)}</p> : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Voice</Label>
              <Select value={voiceId ?? ""} onValueChange={setVoiceId} disabled={!voices.data}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={voices.isLoading ? "Loading voices…" : "Choose a voice"} />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {voices.data?.voices.map((v) => (
                    <SelectItem key={v.voiceId} value={v.voiceId}>
                      {v.name}
                      {v.category ? <span className="ml-2 text-xs text-muted-foreground">{v.category}</span> : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedVoice?.previewUrl ? (
                <audio src={selectedVoice.previewUrl} controls className="mt-1 h-8 w-full" preload="none" />
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Select value={modelId} onValueChange={setModelId} disabled={!models.data}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={modelId} />
                </SelectTrigger>
                <SelectContent>
                  {(models.data?.models ?? [{ modelId, name: modelId, maxCharacters: null }]).map((m) => (
                    <SelectItem key={m.modelId} value={m.modelId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Output</Label>
              <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as typeof outputFormat)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Collapsible>
            <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground">Voice settings ▾</CollapsibleTrigger>
            <CollapsibleContent className="mt-3 grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["stability", "Stability", 0, 1],
                  ["similarityBoost", "Similarity", 0, 1],
                  ["style", "Style exaggeration", 0, 1],
                  ["speed", "Speed", 0.7, 1.2],
                ] as const
              ).map(([key, label, min, max]) => (
                <div key={key} className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>{label}</span>
                    <span className="font-mono text-muted-foreground">{settings[key].toFixed(2)}</span>
                  </div>
                  <Slider min={min} max={max} step={0.01} value={[settings[key]]} onValueChange={([v]) => setSettings((s) => ({ ...s, [key]: v }))} />
                </div>
              ))}
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={settings.useSpeakerBoost} onCheckedChange={(v) => setSettings((s) => ({ ...s, useSpeakerBoost: v }))} /> Speaker boost
              </label>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}

      {provider === "system" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>System voice</Label>
            <Select value={systemVoice ?? ""} onValueChange={setSystemVoice} disabled={!systemVoices.data}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={systemVoices.isLoading ? "Loading…" : "Default voice"} />
              </SelectTrigger>
              <SelectContent>
                {systemVoices.data?.voices.map((v) => (
                  <SelectItem key={v.name} value={v.name}>
                    {v.name} <span className="ml-1 text-xs text-muted-foreground">{v.culture}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <Label>Rate</Label>
              <span className="font-mono text-xs text-muted-foreground">{rate}</span>
            </div>
            <Slider min={-10} max={10} step={1} value={[rate]} onValueChange={([v]) => setRate(v)} />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Draft-quality offline voice from Windows. Use it to lock pacing and build the storyboard, then regenerate with ElevenLabs or import final VO — the timeline recalculates without losing storyboard work.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button onClick={() => generate.mutate()} disabled={busy || generate.isPending || (provider === "elevenlabs" && (!configured || !voiceId))}>
          {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate voice-over
        </Button>
        <Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending || (provider === "elevenlabs" && (!configured || !voiceId))}>
          <Play /> Preview first lines
        </Button>
        <span className="text-xs text-muted-foreground">
          Script v{overview.script.version} · {chars.toLocaleString()} characters · {overview.script.words} words
          {parts > 1 ? ` · generated in ${parts} parts and stitched (model limit ${maxChars!.toLocaleString()})` : ""}
        </span>
      </div>
      {previewResult ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Preview{previewResult.voiceName ? ` · ${previewResult.voiceName}` : ""}: “{previewResult.text}”
          </p>
          <audio src={previewResult.url} controls autoPlay className="h-9 w-full" />
        </div>
      ) : null}
    </div>
  );
}
