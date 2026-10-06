"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2, PlugZap, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Settings } from "@/server/services/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { useHealth, useSettings } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { AppHeader } from "../app-header";
import { ErrorState, Panel } from "../common";
import { BrandKitsSummary } from "./brand-kits";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const SECTIONS = [
  { id: "brands", label: "Brand kits" },
  { id: "elevenlabs", label: "ElevenLabs" },
  { id: "voice", label: "Voice" },
  { id: "alignment", label: "Alignment" },
  { id: "rendering", label: "Rendering" },
  { id: "ai", label: "AI & Claude Code" },
  { id: "storage", label: "Storage" },
  { id: "system", label: "System" },
];

const OUTPUT_FORMATS: { value: Settings["elevenlabs"]["outputFormat"]; label: string; note: string }[] = [
  { value: "mp3_44100_128", label: "MP3 · 44.1 kHz · 128 kbps", note: "All plans" },
  { value: "mp3_44100_192", label: "MP3 · 44.1 kHz · 192 kbps", note: "Creator plan or higher" },
  { value: "pcm_44100", label: "WAV · 44.1 kHz (lossless)", note: "Pro plan or higher" },
  { value: "pcm_24000", label: "WAV · 24 kHz (lossless)", note: "All plans" },
];

function useSection<K extends keyof Settings>(settings: Settings | undefined, key: K) {
  const [draft, setDraft] = useState<Settings[K] | null>(null);
  useEffect(() => {
    if (settings) setDraft(structuredClone(settings[key]));
  }, [settings, key]);
  const dirty = useMemo(() => !!settings && !!draft && JSON.stringify(settings[key]) !== JSON.stringify(draft), [settings, draft, key]);
  return { draft, setDraft, dirty };
}

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">
      <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>
        Discard
      </Button>
      <Button size="sm" onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="animate-spin" /> : null} Save changes
      </Button>
    </div>
  );
}

function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ElevenLabsKey() {
  const queryClient = useQueryClient();
  const { data } = useSettings();
  const status = data?.secrets.elevenlabsApiKey;
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: () => http.put("/api/settings/secrets", { name: "elevenlabsApiKey", value }),
    onSuccess: () => {
      setValue("");
      toast.success("API key saved locally");
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["elevenlabs"] });
    },
    onError: (e) => toast.error("Could not save key", { description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: () => http.delete("/api/settings/secrets", { name: "elevenlabsApiKey" }),
    onSuccess: () => {
      toast.success("API key removed");
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["elevenlabs"] });
    },
  });
  const test = useQuery({
    queryKey: ["elevenlabs", "status"],
    queryFn: () =>
      http.get<{
        status: {
          keyValid: boolean;
          checks: { permission: string; label: string; usedFor: string; ok: boolean; message: string | null }[];
          subscription: { tier: string; characterCount: number; characterLimit: number; resetAt: string | null } | null;
          untestedPermissions: string[];
        };
      }>("/api/providers/elevenlabs/status"),
    enabled: false,
    retry: false,
  });
  const missing = test.data?.status.checks.filter((c) => !c.ok) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <KeyRound className="size-4 text-muted-foreground" />
        {status?.configured ? (
          <span className="text-sm">
            <span className="text-success">Configured</span>
            <span className="text-muted-foreground"> · {status.source === "env" ? "from ELEVENLABS_API_KEY" : "saved in storage/config/secrets.json"} · ••••{status.last4}</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Not configured — ElevenLabs is optional if you import your own audio.</span>
        )}
        {status?.configured ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void test.refetch().then(() => {
                // Permissions may have changed since the voice/model lists were loaded — reload them too.
                void queryClient.invalidateQueries({ queryKey: ["elevenlabs", "voices"] });
                void queryClient.invalidateQueries({ queryKey: ["elevenlabs", "models"] });
              })
            }
            disabled={test.isFetching}
          >
            {test.isFetching ? <Loader2 className="animate-spin" /> : <PlugZap />} Test connection
          </Button>
        ) : null}
        {status?.configured && status.source === "file" ? (
          <Button size="xs" variant="ghost" onClick={() => remove.mutate()}>
            <Trash2 /> Remove
          </Button>
        ) : null}
      </div>
      {test.data ? (
        <div className="max-w-2xl space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
          <p className="flex items-center gap-2 text-success">
            <CheckCircle2 className="size-4" /> Key accepted
            {test.data.status.subscription ? (
              <span className="text-muted-foreground">
                · {test.data.status.subscription.tier} plan · {test.data.status.subscription.characterCount.toLocaleString()} / {test.data.status.subscription.characterLimit.toLocaleString()} characters used
              </span>
            ) : null}
          </p>
          <ul className="space-y-1">
            {test.data.status.checks.map((c) => (
              <li key={c.permission} className="flex items-center gap-2">
                {c.ok ? <CheckCircle2 className="size-3.5 text-success" /> : <XCircle className="size-3.5 text-destructive" />}
                <span className={c.ok ? "" : "text-destructive"}>{c.label}</span>
                <span className="text-xs text-muted-foreground">— {c.usedFor}</span>
              </li>
            ))}
          </ul>
          {missing.length ? (
            <p className="text-xs text-warning">
              This key is restricted. In ElevenLabs → Developers → API keys, edit it and enable {missing.map((c) => c.label).join(", ")} — or create a key without restrictions.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Also make sure the key allows what you plan to use: {test.data.status.untestedPermissions.join(", ")}. These can&apos;t be checked without spending credits, so a missing one is reported by name the first time it&apos;s needed.
          </p>
        </div>
      ) : null}
      {test.error ? (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <XCircle className="size-4" /> {errorMessage(test.error)}
          {test.error instanceof ApiError && test.error.hint ? <span className="text-muted-foreground">— {test.error.hint}</span> : null}
        </p>
      ) : null}
      {status?.source !== "env" ? (
        <form
          className="flex max-w-xl gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim().length >= 8) save.mutate();
          }}
        >
          <Input type="password" autoComplete="off" placeholder={status?.configured ? "Replace API key" : "Paste your ElevenLabs API key"} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button type="submit" disabled={value.trim().length < 8 || save.isPending}>
            Save key
          </Button>
        </form>
      ) : null}
      <p className="text-xs text-muted-foreground">The key is stored only on this machine and used by the local server. It is never sent to the browser.</p>
    </div>
  );
}

function ElevenLabsCatalog({ draft, setDraft }: { draft: Settings["elevenlabs"]; setDraft: (d: Settings["elevenlabs"]) => void }) {
  const { data } = useSettings();
  const configured = !!data?.secrets.elevenlabsApiKey.configured;
  const voices = useQuery({
    queryKey: ["elevenlabs", "voices"],
    queryFn: () => http.get<{ voices: { voiceId: string; name: string; category: string | null; labels: Record<string, string> }[] }>("/api/providers/elevenlabs/voices"),
    enabled: configured,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const models = useQuery({
    queryKey: ["elevenlabs", "models"],
    queryFn: () => http.get<{ models: { modelId: string; name: string; maxCharacters: number | null }[] }>("/api/providers/elevenlabs/models"),
    enabled: configured,
    retry: false,
    staleTime: 5 * 60_000,
  });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Default voice" hint={!configured ? "Add an API key to load your voices." : voices.error ? errorMessage(voices.error) : undefined}>
        <Select
          value={draft.defaultVoiceId ?? ""}
          onValueChange={(v) => setDraft({ ...draft, defaultVoiceId: v, defaultVoiceName: voices.data?.voices.find((x) => x.voiceId === v)?.name ?? null })}
          disabled={!voices.data}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={voices.isLoading ? "Loading voices…" : draft.defaultVoiceName ?? "Choose a voice"} />
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
      </Field>
      <Field label="Default model" hint={models.error ? errorMessage(models.error) : undefined}>
        <Select value={draft.defaultModelId} onValueChange={(v) => setDraft({ ...draft, defaultModelId: v })} disabled={!models.data}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={draft.defaultModelId} />
          </SelectTrigger>
          <SelectContent>
            {(models.data?.models ?? [{ modelId: draft.defaultModelId, name: draft.defaultModelId, maxCharacters: null }]).map((m) => (
              <SelectItem key={m.modelId} value={m.modelId}>
                {m.name}
                {m.maxCharacters ? <span className="ml-2 text-xs text-muted-foreground">{m.maxCharacters.toLocaleString()} chars/request</span> : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function VoiceSettingsSliders({ value, onChange }: { value: Settings["elevenlabs"]["voiceSettings"]; onChange: (v: Settings["elevenlabs"]["voiceSettings"]) => void }) {
  const rows: { key: "stability" | "similarityBoost" | "style" | "speed"; label: string; min: number; max: number; step: number; hint: string }[] = [
    { key: "stability", label: "Stability", min: 0, max: 1, step: 0.01, hint: "Lower = more expressive, higher = more consistent" },
    { key: "similarityBoost", label: "Similarity", min: 0, max: 1, step: 0.01, hint: "Adherence to the original voice" },
    { key: "style", label: "Style exaggeration", min: 0, max: 1, step: 0.01, hint: "Keep low for narration" },
    { key: "speed", label: "Speed", min: 0.7, max: 1.2, step: 0.01, hint: "1.0 = natural pace" },
  ];
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.key} className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <Label>{r.label}</Label>
            <span className="font-mono text-xs text-muted-foreground">{value[r.key].toFixed(2)}</span>
          </div>
          <Slider min={r.min} max={r.max} step={r.step} value={[value[r.key]]} onValueChange={([v]) => onChange({ ...value, [r.key]: v })} />
          <p className="text-xs text-muted-foreground">{r.hint}</p>
        </div>
      ))}
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={value.useSpeakerBoost} onCheckedChange={(v) => onChange({ ...value, useSpeakerBoost: v })} /> Speaker boost
      </label>
    </div>
  );
}

export function SettingsView() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useSettings();
  const health = useHealth();
  const settings = data?.settings;
  const save = useMutation({
    mutationFn: (patch: DeepPartial<Settings>) => http.patch<{ settings: Settings }>("/api/settings", patch),
    onSuccess: (res) => {
      queryClient.setQueryData(["settings"], (old: typeof data) => (old ? { ...old, settings: res.settings } : old));
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      toast.success("Settings saved");
    },
    onError: (e) => toast.error("Could not save settings", { description: errorMessage(e) }),
  });

  const eleven = useSection(settings, "elevenlabs");
  const voice = useSection(settings, "voice");
  const alignment = useSection(settings, "alignment");
  const render = useSection(settings, "render");
  const ai = useSection(settings, "ai");
  const storage = useSection(settings, "storage");

  const systemVoices = useQuery({
    queryKey: ["system-voices"],
    queryFn: () => http.get<{ available: boolean; voices: { name: string; culture: string }[] }>("/api/providers/system-voice/voices"),
    retry: false,
    staleTime: 10 * 60_000,
  });
  const whisper = useQuery({
    queryKey: ["whisper"],
    queryFn: () => http.get<{ status: { installed: boolean; models: string[]; version: string; job: { status: string; progress: number; stage: string | null } | null } }>("/api/tools/whisper"),
    retry: false,
    refetchInterval: (q) => (q.state.data?.status.job && ["queued", "running"].includes(q.state.data.status.job.status) ? 2000 : false),
  });
  const installWhisper = useMutation({
    mutationFn: (model: string) => http.post("/api/tools/whisper", { model }),
    onSuccess: () => void whisper.refetch(),
    onError: (e) => toast.error("Could not start installation", { description: errorMessage(e) }),
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[200px_1fr]">
        <aside className="hidden lg:block">
          <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Local to this machine</p>
          <nav className="sticky top-20 mt-6 space-y-0.5">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                {s.label}
              </a>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 space-y-6">
          {error ? <ErrorState error={error} title="Could not load settings" onRetry={() => void refetch()} /> : null}
          {isLoading || !settings ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          ) : (
            <>
              <section id="brands" className="scroll-mt-20">
                <BrandKitsSummary />
              </section>

              <section id="elevenlabs" className="scroll-mt-20">
                <Panel title="ElevenLabs" description="AI voice generation and alignment. Optional — you can always import your own voice-over.">
                  <ElevenLabsKey />
                  {eleven.draft ? (
                    <div className="mt-6 space-y-6 border-t border-border pt-6">
                      <ElevenLabsCatalog draft={eleven.draft} setDraft={eleven.setDraft} />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Output format" hint={OUTPUT_FORMATS.find((f) => f.value === eleven.draft!.outputFormat)?.note}>
                          <Select value={eleven.draft.outputFormat} onValueChange={(v) => eleven.setDraft({ ...eleven.draft!, outputFormat: v as Settings["elevenlabs"]["outputFormat"] })}>
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
                        </Field>
                        <Field label="Speech-to-text model" hint="Used to transcribe imported audio.">
                          <Select value={eleven.draft.sttModelId} onValueChange={(v) => eleven.setDraft({ ...eleven.draft!, sttModelId: v })}>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="scribe_v2">Scribe v2</SelectItem>
                              <SelectItem value="scribe_v1">Scribe v1</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                      <VoiceSettingsSliders value={eleven.draft.voiceSettings} onChange={(v) => eleven.setDraft({ ...eleven.draft!, voiceSettings: v })} />
                      <SaveBar dirty={eleven.dirty} saving={save.isPending} onSave={() => save.mutate({ elevenlabs: eleven.draft! })} onReset={() => eleven.setDraft(structuredClone(settings.elevenlabs))} />
                    </div>
                  ) : null}
                </Panel>
              </section>

              <section id="voice" className="scroll-mt-20">
                <Panel title="Voice" description="Which provider “Generate voice” uses by default.">
                  {voice.draft ? (
                    <div className="space-y-5">
                      <RadioGroup value={voice.draft.defaultProvider} onValueChange={(v) => voice.setDraft({ ...voice.draft!, defaultProvider: v as "elevenlabs" | "system" })} className="gap-3">
                        <label className="flex items-start gap-3">
                          <RadioGroupItem value="elevenlabs" className="mt-0.5" />
                          <span>
                            <span className="text-sm font-medium">ElevenLabs</span>
                            <span className="block text-xs text-muted-foreground">Production-quality AI voices with character-level alignment.</span>
                          </span>
                        </label>
                        <label className="flex items-start gap-3">
                          <RadioGroupItem value="system" className="mt-0.5" disabled={systemVoices.data && !systemVoices.data.available} />
                          <span>
                            <span className="text-sm font-medium">System voice (scratch)</span>
                            <span className="block text-xs text-muted-foreground">
                              {systemVoices.data?.available === false ? "Not available on this operating system." : "Free, offline draft voice from the operating system — useful to lock timing before paying for final VO."}
                            </span>
                          </span>
                        </label>
                      </RadioGroup>
                      {systemVoices.data?.available ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label="System voice">
                            <Select value={voice.draft.systemVoiceName ?? ""} onValueChange={(v) => voice.setDraft({ ...voice.draft!, systemVoiceName: v })}>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Default system voice" />
                              </SelectTrigger>
                              <SelectContent>
                                {systemVoices.data.voices.map((v) => (
                                  <SelectItem key={v.name} value={v.name}>
                                    {v.name} <span className="ml-1 text-xs text-muted-foreground">{v.culture}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field label={`Speaking rate (${voice.draft.systemRate})`}>
                            <Slider min={-10} max={10} step={1} value={[voice.draft.systemRate]} onValueChange={([v]) => voice.setDraft({ ...voice.draft!, systemRate: v })} className="mt-3" />
                          </Field>
                        </div>
                      ) : null}
                      <SaveBar dirty={voice.dirty} saving={save.isPending} onSave={() => save.mutate({ voice: voice.draft! })} onReset={() => voice.setDraft(structuredClone(settings.voice))} />
                    </div>
                  ) : null}
                </Panel>
              </section>

              <section id="alignment" className="scroll-mt-20">
                <Panel title="Alignment & transcription" description="How word timing is obtained for imported audio.">
                  {alignment.draft ? (
                    <div className="space-y-5">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Default method">
                          <Select value={alignment.draft.defaultMethod} onValueChange={(v) => alignment.setDraft({ ...alignment.draft!, defaultMethod: v as Settings["alignment"]["defaultMethod"] })}>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="elevenlabs_forced_alignment">ElevenLabs forced alignment (needs script)</SelectItem>
                              <SelectItem value="elevenlabs_stt">ElevenLabs speech-to-text</SelectItem>
                              <SelectItem value="whisper_cpp">Local whisper.cpp</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="whisper.cpp model" hint="Larger models are more accurate but slower.">
                          <Select value={alignment.draft.whisperModel} onValueChange={(v) => alignment.setDraft({ ...alignment.draft!, whisperModel: v as Settings["alignment"]["whisperModel"] })}>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["tiny.en", "base.en", "small.en", "medium.en", "tiny", "base", "small", "medium"].map((m) => (
                                <SelectItem key={m} value={m}>
                                  {m}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                        {whisper.error ? (
                          <span className="text-muted-foreground">Local transcription status unavailable: {errorMessage(whisper.error)}</span>
                        ) : whisper.data?.status.job && ["queued", "running"].includes(whisper.data.status.job.status) ? (
                          <span className="flex items-center gap-2 text-info">
                            <Loader2 className="size-4 animate-spin" /> Installing whisper.cpp… {Math.round(whisper.data.status.job.progress * 100)}% {whisper.data.status.job.stage}
                          </span>
                        ) : whisper.data?.status.installed ? (
                          <span className="text-success">
                            whisper.cpp {whisper.data.status.version} installed · models: {whisper.data.status.models.join(", ") || "none"}
                            {!whisper.data.status.models.includes(alignment.draft.whisperModel) ? (
                              <Button size="xs" variant="outline" className="ml-3" onClick={() => installWhisper.mutate(alignment.draft!.whisperModel)}>
                                Download {alignment.draft.whisperModel}
                              </Button>
                            ) : null}
                          </span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-3 text-muted-foreground">
                            Local whisper.cpp is not installed. It downloads a prebuilt binary and the {alignment.draft.whisperModel} model (≈75–1500 MB) from GitHub/Hugging Face.
                            <Button size="xs" variant="outline" onClick={() => installWhisper.mutate(alignment.draft!.whisperModel)} disabled={installWhisper.isPending || !whisper.data}>
                              Install
                            </Button>
                          </span>
                        )}
                      </div>
                      <SaveBar dirty={alignment.dirty} saving={save.isPending} onSave={() => save.mutate({ alignment: alignment.draft! })} onReset={() => alignment.setDraft(structuredClone(settings.alignment))} />
                    </div>
                  ) : null}
                </Panel>
              </section>

              <section id="rendering" className="scroll-mt-20">
                <Panel title="Rendering" description="Defaults for Remotion renders (MP4 · H.264).">
                  {render.draft ? (
                    <div className="space-y-5">
                      <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Default frame rate" hint="Used for new projects.">
                          <ToggleGroup type="single" variant="outline" value={String(render.draft.defaultFps)} onValueChange={(v) => v && render.setDraft({ ...render.draft!, defaultFps: Number(v) as 24 | 25 | 30 | 60 })}>
                            {[24, 25, 30, 60].map((f) => (
                              <ToggleGroupItem key={f} value={String(f)}>
                                {f}
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </Field>
                        <Field label="Output format">
                          <Input value="MP4 · H.264 (yuv420p)" disabled />
                        </Field>
                        <Field label={`Quality (CRF ${render.draft.crf})`} hint="Lower = higher quality and larger files. 18 is visually lossless.">
                          <Slider min={12} max={32} step={1} value={[render.draft.crf]} onValueChange={([v]) => render.setDraft({ ...render.draft!, crf: v })} className="mt-3" />
                        </Field>
                        <Field label="Render concurrency" hint="Frames rendered in parallel by default. Empty = automatic (at most 3 when a video contains clips). A render can choose its own on the Render page.">
                          <Input
                            type="number"
                            min={1}
                            max={32}
                            value={render.draft.concurrency ?? ""}
                            placeholder="Automatic"
                            onChange={(e) => render.setDraft({ ...render.draft!, concurrency: e.target.value ? Number(e.target.value) : null })}
                          />
                        </Field>
                      </div>
                      <Field label="Also copy final renders to" hint="Optional folder (renders always stay inside the project's renders/ folder too).">
                        <Input value={render.draft.outputDir ?? ""} placeholder="C:\\Users\\you\\Videos\\Renders" onChange={(e) => render.setDraft({ ...render.draft!, outputDir: e.target.value || null })} />
                      </Field>
                      <SaveBar dirty={render.dirty} saving={save.isPending} onSave={() => save.mutate({ render: render.draft! })} onReset={() => render.setDraft(structuredClone(settings.render))} />
                    </div>
                  ) : null}
                </Panel>
              </section>

              <section id="ai" className="scroll-mt-20">
                <Panel title="AI & Claude Code" description="Claude Code is the AI operator. Tasks you create in the GUI are handed to it explicitly.">
                  {ai.draft ? (
                    <div className="space-y-6">
                      <RadioGroup value={ai.draft.executor} onValueChange={(v) => ai.setDraft({ ...ai.draft!, executor: v as "manual" | "headless" })} className="gap-3">
                        <label className="flex items-start gap-3">
                          <RadioGroupItem value="manual" className="mt-0.5" />
                          <span>
                            <span className="text-sm font-medium">Hand off to my Claude Code session</span>
                            <span className="block text-xs text-muted-foreground">Tasks wait in .project/tasks/. In Claude Code, ask it to “process the pending studio tasks” (or run /studio-tasks).</span>
                          </span>
                        </label>
                        <label className="flex items-start gap-3">
                          <RadioGroupItem value="headless" className="mt-0.5" disabled={!health.data?.claudeCli.found} />
                          <span>
                            <span className="text-sm font-medium">Run automatically with the Claude Code CLI</span>
                            <span className="block text-xs text-muted-foreground">
                              {health.data?.claudeCli.found
                                ? `The worker runs \`claude -p\` (${health.data.claudeCli.version ?? "found"}) with a restricted tool allow-list and streams progress into the task.`
                                : "Claude Code CLI not found on PATH."}
                            </span>
                          </span>
                        </label>
                      </RadioGroup>
                      {ai.draft.executor === "headless" ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label="Allowed tools" hint="Space-separated Claude Code tool rules." className="sm:col-span-2">
                            <Input value={ai.draft.headlessAllowedTools} onChange={(e) => ai.setDraft({ ...ai.draft!, headlessAllowedTools: e.target.value })} className="font-mono text-xs" />
                          </Field>
                          <Field label="Model" hint="Empty = your Claude Code default.">
                            <Input value={ai.draft.headlessModel ?? ""} placeholder="default" onChange={(e) => ai.setDraft({ ...ai.draft!, headlessModel: e.target.value || null })} />
                          </Field>
                          <Field label="Max budget per task (USD)" hint="Only applies to API-key billing.">
                            <Input type="number" min={0} step={0.5} value={ai.draft.headlessMaxBudgetUsd ?? ""} placeholder="No limit" onChange={(e) => ai.setDraft({ ...ai.draft!, headlessMaxBudgetUsd: e.target.value ? Number(e.target.value) : null })} />
                          </Field>
                        </div>
                      ) : null}
                      <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
                        <label className="flex items-start gap-3 sm:col-span-2">
                          <Switch checked={ai.draft.preferNativeGraphics} onCheckedChange={(v) => ai.setDraft({ ...ai.draft!, preferNativeGraphics: v })} className="mt-0.5" />
                          <span>
                            <span className="text-sm font-medium">Prefer native Remotion graphics</span>
                            <span className="block text-xs text-muted-foreground">Typography, UI, charts, icons and diagrams are built in Remotion; AI imagery is reserved for people, places and editorial scenes.</span>
                          </span>
                        </label>
                        <Field label="Storyboard pace">
                          <ToggleGroup type="single" variant="outline" value={ai.draft.storyboardPace} onValueChange={(v) => v && ai.setDraft({ ...ai.draft!, storyboardPace: v as "fast" | "medium" | "slow" })}>
                            <ToggleGroupItem value="fast">Fast</ToggleGroupItem>
                            <ToggleGroupItem value="medium">Medium</ToggleGroupItem>
                            <ToggleGroupItem value="slow">Slow</ToggleGroupItem>
                          </ToggleGroup>
                        </Field>
                        <Field label="Alternatives per request">
                          <ToggleGroup type="single" variant="outline" value={String(ai.draft.alternativesCount)} onValueChange={(v) => v && ai.setDraft({ ...ai.draft!, alternativesCount: Number(v) })}>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <ToggleGroupItem key={n} value={String(n)}>
                                {n}
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </Field>
                        <Field label="Default image style" className="sm:col-span-2" hint="Appended to AI image requests unless the brand defines one.">
                          <Textarea rows={2} value={ai.draft.imageStyle} onChange={(e) => ai.setDraft({ ...ai.draft!, imageStyle: e.target.value })} placeholder="Editorial photography, soft natural light, muted palette" />
                        </Field>
                      </div>
                      <SaveBar dirty={ai.dirty} saving={save.isPending} onSave={() => save.mutate({ ai: ai.draft! })} onReset={() => ai.setDraft(structuredClone(settings.ai))} />
                    </div>
                  ) : null}
                </Panel>
              </section>

              <section id="storage" className="scroll-mt-20">
                <Panel title="Storage" description="Projects are folders on this machine; the database stores metadata and history.">
                  {storage.draft ? (
                    <div className="space-y-4">
                      <Field label="Projects directory" hint={<>Currently using <code className="font-mono">{health.data?.storage.projectsDir ?? "…"}</code>. Existing project folders are not moved automatically.</>}>
                        <Input value={storage.draft.projectsDir ?? ""} placeholder="Default: <repo>/projects (or STUDIO_PROJECTS_DIR)" onChange={(e) => storage.setDraft({ projectsDir: e.target.value || null })} />
                      </Field>
                      <SaveBar dirty={storage.dirty} saving={save.isPending} onSave={() => save.mutate({ storage: storage.draft! })} onReset={() => storage.setDraft(structuredClone(settings.storage))} />
                    </div>
                  ) : null}
                </Panel>
              </section>

              <section id="system" className="scroll-mt-20">
                <Panel title="System">
                  {health.data ? (
                    <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                      {[
                        ["Database", health.data.database.ok ? "Connected (Postgres in Docker)" : `Unavailable — ${health.data.database.error}`],
                        ["Worker", health.data.worker.online ? "Online" : `Offline${health.data.worker.lastSeen ? ` · last seen ${new Date(health.data.worker.lastSeen).toLocaleTimeString()}` : ""}`],
                        ["FFmpeg", health.data.ffmpeg.ok ? health.data.ffmpeg.path : "Missing"],
                        ["Claude Code CLI", health.data.claudeCli.found ? `${health.data.claudeCli.version ?? ""} · ${health.data.claudeCli.path}` : "Not found"],
                        ["Remotion", health.data.versions.remotion],
                        ["Next.js", health.data.versions.next],
                        ["Prisma", health.data.versions.prisma],
                        ["Node.js", health.data.versions.node],
                        ["Platform", health.data.platform],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-4 border-b border-border/60 py-1.5">
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className="truncate text-right font-mono text-xs" title={String(v)}>
                            {v}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <Skeleton className="h-32" />
                  )}
                </Panel>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
