"use client";

import { ArrowLeft, ArrowRight, Check, FileAudio, FileText, Loader2, Palette, Timer, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DESIGN_PRESETS } from "@/core/design/presets";
import { CURATED_FONTS } from "@/core/spec/design";
import { WORKFLOW_INFO, type Workflow } from "@/core/spec/enums";
import { FORMAT_PRESETS, FPS_OPTIONS, aspectRatioLabel, validateDimensions, type FormatPresetId } from "@/core/spec/format";
import { estimateTiming, parseScript } from "@/core/script/script";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorMessage, http, uploadForm } from "@/lib/api-client";
import { formatBytes, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AppHeader } from "../app-header";
import { KitSwatch, useBrandKits } from "../brand/brand-editor";
import { Dropzone, ErrorState } from "../common";
import { START_OPTIONS, WorkflowChooser } from "../workflow-chooser";

type Step = "start" | "details" | "brand" | "materials" | "review";
const STEP_LABELS: Record<Step, string> = { start: "Starting point", details: "Details", brand: "Look & brand", materials: "Materials", review: "Review & create" };

type ColorKey = "primaryColor" | "secondaryColor" | "accentColor" | "backgroundColor" | "textColor";
const COLOR_FIELDS: { key: ColorKey; label: string; token: "primary" | "secondary" | "accent" | "background" | "text" }[] = [
  { key: "primaryColor", label: "Primary", token: "primary" },
  { key: "secondaryColor", label: "Secondary", token: "secondary" },
  { key: "accentColor", label: "Accent", token: "accent" },
  { key: "backgroundColor", label: "Background", token: "background" },
  { key: "textColor", label: "Text", token: "text" },
];

interface Operation {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  progress?: number;
  error?: unknown;
}

const AUDIO_ACCEPT = ".mp3,.wav,.m4a,.aac,.ogg,.flac,.webm";
const TIMING_ACCEPT = ".srt,.vtt,.json";

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2 py-1.5">
      <input type="color" aria-label={`${label} color`} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="size-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
      <span className="w-20 text-xs text-muted-foreground">{label}</span>
      <Input
        value={value}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v.toUpperCase());
        }}
        className="h-7 font-mono text-xs"
        maxLength={7}
      />
    </div>
  );
}

function FileChip({ file, icon, onRemove }: { file: File; icon: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{file.name}</p>
        <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
      </div>
      <Button variant="ghost" size="icon-xs" onClick={onRemove} aria-label={`Remove ${file.name}`}>
        <X />
      </Button>
    </div>
  );
}

export function NewProjectWizard({ initialWorkflow, skipStart }: { initialWorkflow: Workflow; skipStart: boolean }) {
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
  const steps: Step[] = workflow === "blank" ? ["start", "details", "brand", "review"] : ["start", "details", "brand", "materials", "review"];
  const [stepIndex, setStepIndex] = useState(skipStart ? 1 : 0);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  // Details
  const [name, setName] = useState("");
  const [formatPreset, setFormatPreset] = useState<FormatPresetId>("landscape_16_9");
  const [custom, setCustom] = useState({ width: 1920, height: 1080 });
  const [fps, setFps] = useState<number>(30);

  // Look & brand
  const brandKits = useBrandKits();
  const [brandKitId, setBrandKitId] = useState<string | null>(null);
  const chosenKit = brandKits.data?.find((k) => k.id === brandKitId) ?? null;
  const [designPreset, setDesignPreset] = useState("premium_saas");
  const preset = DESIGN_PRESETS.find((p) => p.id === designPreset) ?? DESIGN_PRESETS[0];
  const [colorOverrides, setColorOverrides] = useState<Partial<Record<ColorKey, string>>>({});
  const [headingFont, setHeadingFont] = useState<string | null>(null);
  const [bodyFont, setBodyFont] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("");
  const [tagline, setTagline] = useState("");
  const [website, setWebsite] = useState("");
  const [visualStyle, setVisualStyle] = useState("");
  const [imageStyle, setImageStyle] = useState("");
  const [animationStyle, setAnimationStyle] = useState("");
  const [typographyNotes, setTypographyNotes] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [references, setReferences] = useState<File[]>([]);

  // Materials
  const [script, setScript] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [timing, setTiming] = useState<File | null>(null);
  const scriptInput = useRef<HTMLInputElement>(null);
  const [scriptError, setScriptError] = useState<string | null>(null);

  // Create
  const [ops, setOps] = useState<Operation[] | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const width = formatPreset === "custom" ? custom.width : FORMAT_PRESETS.find((p) => p.id === formatPreset)!.width;
  const height = formatPreset === "custom" ? custom.height : FORMAT_PRESETS.find((p) => p.id === formatPreset)!.height;
  const dimensionError = formatPreset === "custom" ? validateDimensions(custom.width, custom.height) : null;

  const needs = {
    script: workflow === "script_only" || workflow === "script_audio" || workflow === "script_audio_timeline",
    audio: workflow === "audio_only" || workflow === "script_audio" || workflow === "script_audio_timeline",
    timing: workflow === "script_audio_timeline",
  };

  const estimate = useMemo(() => {
    if (!script.trim()) return null;
    const parsed = parseScript(script);
    return { words: parsed.wordCount, ...estimateTiming(parsed.spokenParagraphs) };
  }, [script]);

  const colorValue = (f: (typeof COLOR_FIELDS)[number]) => colorOverrides[f.key] ?? preset.design.colors[f.token];

  const canContinue = (() => {
    if (step === "details") return !!name.trim() && !dimensionError;
    return true;
  })();

  const materialsMissing = [needs.script && !script.trim() ? "script" : null, needs.audio && !audio ? "voice-over audio" : null, needs.timing && !timing ? "timing file" : null].filter(Boolean) as string[];

  const next = () => setStepIndex((i) => Math.min(steps.length - 1, i + 1));
  const back = () => setStepIndex((i) => Math.max(0, i - 1));

  const importScriptFile = async (file: File) => {
    setScriptError(null);
    if (!/\.(txt|md)$/i.test(file.name)) return setScriptError("Only .txt and .md files can be imported.");
    if (file.size > 2 * 1024 * 1024) return setScriptError("Script files must be smaller than 2 MB.");
    setScript(await file.text());
  };

  const update = (id: string, patch: Partial<Operation>) => setOps((cur) => (cur ? cur.map((o) => (o.id === id ? { ...o, ...patch } : o)) : cur));

  const destination = (id: string) => {
    switch (workflow) {
      case "script_only":
        return `/projects/${id}/script`;
      case "audio_only":
      case "script_audio":
        return `/projects/${id}/voice`;
      case "script_audio_timeline":
        return `/projects/${id}/timeline`;
      default:
        return `/projects/${id}`;
    }
  };

  const create = async () => {
    const plan: Operation[] = [
      { id: "project", label: "Create project", status: "pending" },
      ...(logo && !brandKitId ? [{ id: "logo", label: "Upload logo", status: "pending" as const }] : []),
      ...(references.length && !brandKitId ? [{ id: "refs", label: `Upload ${references.length} brand reference file${references.length === 1 ? "" : "s"}`, status: "pending" as const }] : []),
      ...(needs.audio && audio ? [{ id: "audio", label: "Import voice-over", status: "pending" as const }] : []),
      ...(needs.timing && timing ? [{ id: "timing", label: "Import timeline", status: "pending" as const }] : []),
    ];
    setOps(plan);
    let id = createdId;
    let current = "project";
    try {
      if (!id) {
        update("project", { status: "running" });
        const brand: Record<string, string> = { brandName, tagline, website, visualStyle, imageStyle, animationStyle, typographyNotes, guidelines };
        for (const f of COLOR_FIELDS) if (colorOverrides[f.key]) brand[f.key] = colorOverrides[f.key]!;
        if (headingFont) brand.headingFont = headingFont;
        if (bodyFont) brand.bodyFont = bodyFont;
        const res = await http.post<{ project: { id: string }; warning?: string }>("/api/projects", {
          name: name.trim(),
          workflow,
          formatPreset,
          width,
          height,
          fps,
          // A brand kit replaces the manual look & brand fields entirely.
          ...(brandKitId ? { brandKitId } : { designPreset, brand }),
          ...(needs.script && script.trim() ? { script } : {}),
        });
        if (res.warning) toast.warning(res.warning);
        id = res.project.id;
        setCreatedId(id);
      }
      update("project", { status: "done" });

      if (logo && !brandKitId) {
        current = "logo";
        update("logo", { status: "running", progress: 0 });
        const form = new FormData();
        form.append("kind", "logo");
        form.append("file", logo);
        const { assets } = await uploadForm<{ assets: { id: string }[] }>(`/api/projects/${id}/assets?kind=logo`, form, (p) => update("logo", { progress: p }));
        await http.patch(`/api/projects/${id}/brand`, { logoAssetId: assets[0].id });
        update("logo", { status: "done" });
      }
      if (references.length && !brandKitId) {
        current = "refs";
        update("refs", { status: "running", progress: 0 });
        const form = new FormData();
        form.append("kind", "reference");
        references.forEach((f) => form.append("file", f));
        const { assets } = await uploadForm<{ assets: { id: string; mimeType: string }[] }>(`/api/projects/${id}/assets?kind=reference`, form, (p) => update("refs", { progress: p }));
        await http.patch(`/api/projects/${id}/brand`, {
          referenceAssetIds: assets.filter((a) => a.mimeType !== "application/pdf").map((a) => a.id),
          brandGuideAssetIds: assets.filter((a) => a.mimeType === "application/pdf").map((a) => a.id),
        });
        update("refs", { status: "done" });
      }
      if (needs.audio && audio) {
        current = "audio";
        update("audio", { status: "running", progress: 0 });
        const form = new FormData();
        form.append("file", audio);
        await uploadForm(`/api/projects/${id}/voice/import`, form, (p) => update("audio", { progress: p }));
        update("audio", { status: "done" });
      }
      if (needs.timing && timing) {
        current = "timing";
        update("timing", { status: "running", progress: 0 });
        const form = new FormData();
        form.append("file", timing);
        await uploadForm(`/api/projects/${id}/alignment/import`, form, (p) => update("timing", { progress: p }));
        update("timing", { status: "done" });
      }
      router.push(destination(id!));
    } catch (err) {
      update(current, { status: "error", error: err });
    }
  };

  const failed = ops?.find((o) => o.status === "error");
  const creating = !!ops && !failed && ops.some((o) => o.status !== "done");

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Projects
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">New project</h1>
          <p className="mt-1 text-sm text-muted-foreground">{WORKFLOW_INFO[workflow].label}</p>
          <ol className="mt-6 space-y-1">
            {steps.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={!!ops || i > stepIndex}
                  onClick={() => setStepIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground disabled:cursor-default",
                    i === stepIndex && "bg-muted text-foreground",
                    i < stepIndex && "hover:text-foreground",
                  )}
                >
                  <span className={cn("flex size-5 items-center justify-center rounded-full border border-border text-[11px]", i < stepIndex && "border-primary bg-primary text-primary-foreground", i === stepIndex && "border-primary text-primary")}>
                    {i < stepIndex ? <Check className="size-3" /> : i + 1}
                  </span>
                  {STEP_LABELS[s]}
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <main className="min-w-0">
          {step === "start" ? (
            <section>
              <h2 className="text-xl font-semibold tracking-tight">What do you have?</h2>
              <p className="mt-1 text-sm text-muted-foreground">Pick your starting point. You can add anything else later, and jump between stages at any time.</p>
              <div className="mt-6">
                <WorkflowChooser value={workflow} onChange={setWorkflow} options={START_OPTIONS.filter((o) => o.id !== "imported")} />
              </div>
              <button type="button" onClick={() => setWorkflow("blank")} className={cn("mt-4 text-sm text-muted-foreground hover:text-foreground", workflow === "blank" && "text-primary")}>
                {workflow === "blank" ? "✓ Blank project selected" : "Or start with a blank project"}
              </button>
            </section>
          ) : null}

          {step === "details" ? (
            <section className="space-y-8">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Project details</h2>
                <p className="mt-1 text-sm text-muted-foreground">Duration is set automatically from the voice-over once it exists.</p>
              </div>
              <div className="max-w-xl space-y-2">
                <Label htmlFor="project-name">Project name</Label>
                <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Incep Platform Launch Video" autoFocus maxLength={120} />
              </div>
              <div className="space-y-3">
                <Label>Video format</Label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {[...FORMAT_PRESETS, { id: "custom" as const, label: "Custom", aspect: aspectRatioLabel(custom.width, custom.height), width: custom.width, height: custom.height, hint: "Any even size" }].map((f) => {
                    const selected = formatPreset === f.id;
                    const ratio = f.width / f.height;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFormatPreset(f.id)}
                        className={cn("flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40", selected && "border-primary bg-primary/[0.06] ring-1 ring-primary")}
                      >
                        <div className="flex h-16 items-center justify-center">
                          <div className={cn("rounded-[3px] border-2 border-muted-foreground/50", selected && "border-primary")} style={{ width: ratio >= 1 ? 64 : 64 * ratio, height: ratio >= 1 ? 64 / ratio : 64 }} />
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-medium">{f.label}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {f.width}×{f.height} · {f.aspect}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground/70">{f.hint}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {formatPreset === "custom" ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="custom-width" className="text-xs">
                        Width
                      </Label>
                      <Input id="custom-width" type="number" className="w-28" value={custom.width} min={144} max={4320} step={2} onChange={(e) => setCustom((c) => ({ ...c, width: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="custom-height" className="text-xs">
                        Height
                      </Label>
                      <Input id="custom-height" type="number" className="w-28" value={custom.height} min={144} max={4320} step={2} onChange={(e) => setCustom((c) => ({ ...c, height: Number(e.target.value) }))} />
                    </div>
                    {dimensionError ? <p className="pb-2 text-sm text-destructive">{dimensionError}</p> : <p className="pb-2 text-sm text-muted-foreground">{aspectRatioLabel(custom.width, custom.height)}</p>}
                  </div>
                ) : null}
              </div>
              <div className="space-y-3">
                <Label>Frame rate</Label>
                <ToggleGroup type="single" variant="outline" value={String(fps)} onValueChange={(v) => v && setFps(Number(v))}>
                  {FPS_OPTIONS.map((f) => (
                    <ToggleGroupItem key={f} value={String(f)} className="px-4">
                      {f} fps
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </section>
          ) : null}

          {step === "brand" ? (
            <section className="space-y-8">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Look & brand</h2>
                <p className="mt-1 text-sm text-muted-foreground">Optional. Everything here can be changed later in Assets → Brand; every scene inherits it.</p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Brand kit</Label>
                  <Link href="/settings/brands" target="_blank" className="text-xs text-muted-foreground hover:text-foreground">
                    Manage brand kits ↗
                  </Link>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setBrandKitId(null)}
                    className={cn("flex flex-col rounded-xl border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/40", !brandKitId && "border-primary ring-1 ring-primary")}
                  >
                    <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                      <Palette className="size-6" />
                    </div>
                    <div className="mt-2 px-1">
                      <div className="text-sm font-medium">Set up manually</div>
                      <div className="text-xs text-muted-foreground">A custom brand for this project</div>
                    </div>
                  </button>
                  {(brandKits.data ?? []).map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => setBrandKitId(k.id)}
                      className={cn("flex flex-col rounded-xl border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/40", brandKitId === k.id && "border-primary ring-1 ring-primary")}
                    >
                      <KitSwatch kit={k} className="h-20" />
                      <div className="mt-2 px-1">
                        <div className="truncate text-sm font-medium">{k.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {k.design.typography.headingFont} · {k.projectCount} project{k.projectCount === 1 ? "" : "s"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {brandKits.data && brandKits.data.length === 0 ? <p className="text-xs text-muted-foreground">Tip: save a brand once in Settings → Brand kits and reuse it for every project.</p> : null}
              </div>
              {chosenKit ? (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
                  <p className="font-medium">This project will follow “{chosenKit.name}”.</p>
                  <p className="mt-1 text-muted-foreground">
                    Identity, design system, logo, fonts and references come from the kit and stay in sync when it changes. You can customize the brand for this project later on its Brand page.
                  </p>
                </div>
              ) : (
              <>
              <div className="space-y-3">
                <Label>Motion design preset</Label>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {DESIGN_PRESETS.map((p) => {
                    const selected = p.id === designPreset;
                    const c = p.design.colors;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setDesignPreset(p.id)}
                        className={cn("rounded-xl border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/40", selected && "border-primary ring-1 ring-primary")}
                      >
                        <div className="relative h-20 overflow-hidden rounded-lg" style={{ background: `radial-gradient(80% 90% at 85% 10%, ${c.primary}40, transparent 60%), ${c.background}` }}>
                          <div className="absolute top-3 left-3 text-lg font-semibold tracking-tight" style={{ color: c.text }}>
                            Aa
                          </div>
                          <div className="absolute right-3 bottom-3 h-6 w-16 rounded-md" style={{ background: c.surface, border: `1px solid ${c.muted}40` }} />
                          <div className="absolute bottom-3 left-3 flex gap-1">
                            {[c.primary, c.secondary, c.accent].map((col) => (
                              <span key={col} className="size-3 rounded-full ring-1 ring-black/10" style={{ background: col }} />
                            ))}
                          </div>
                        </div>
                        <div className="mt-2 px-1">
                          <div className="text-sm font-medium">{p.label}</div>
                          <div className="text-xs text-muted-foreground">{p.description}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground/70">
                            {p.design.typography.headingFont} · {p.design.motion.easing}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="brand-name">Brand name</Label>
                  <Input id="brand-name" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Incep" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="brand-tagline">Tagline</Label>
                  <Input id="brand-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Run your business in one place" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="brand-website">Website</Label>
                  <Input id="brand-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="incep.io" />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Colors</Label>
                  {Object.keys(colorOverrides).length ? (
                    <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setColorOverrides({})}>
                      Reset to preset
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {COLOR_FIELDS.map((f) => (
                    <ColorField key={f.key} label={f.label} value={colorValue(f)} onChange={(v) => setColorOverrides((o) => ({ ...o, [f.key]: v }))} />
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Heading font</Label>
                  <Select value={headingFont ?? preset.design.typography.headingFont} onValueChange={setHeadingFont}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURATED_FONTS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Body font</Label>
                  <Select value={bodyFont ?? preset.design.typography.bodyFont} onValueChange={setBodyFont}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURATED_FONTS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Logo</Label>
                  {logo ? (
                    <FileChip file={logo} icon={<FileText />} onRemove={() => setLogo(null)} />
                  ) : (
                    <Dropzone accept=".svg,.png,.jpg,.jpeg,.webp" onFiles={(f) => setLogo(f[0] ?? null)} label="Upload logo" hint="SVG or transparent PNG works best" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Brand guide & reference images</Label>
                  <Dropzone accept=".pdf,.png,.jpg,.jpeg,.webp" multiple onFiles={(f) => setReferences((r) => [...r, ...f].slice(0, 20))} label="Upload references" hint="PDF brand guide, moodboards, screenshots" />
                  {references.map((f, i) => (
                    <FileChip key={`${f.name}-${i}`} file={f} icon={<FileText />} onRemove={() => setReferences((r) => r.filter((_, k) => k !== i))} />
                  ))}
                </div>
              </div>
              <Collapsible>
                <CollapsibleTrigger className="text-sm text-muted-foreground hover:text-foreground">Style direction & guidelines ▾</CollapsibleTrigger>
                <CollapsibleContent className="mt-4 grid gap-4 sm:grid-cols-2">
                  {[
                    { id: "visual", label: "Visual style", value: visualStyle, set: setVisualStyle, placeholder: "Clean, premium SaaS, lots of whitespace, soft light" },
                    { id: "image", label: "Image style", value: imageStyle, set: setImageStyle, placeholder: "Editorial photography, natural light, diverse teams" },
                    { id: "animation", label: "Animation style", value: animationStyle, set: setAnimationStyle, placeholder: "Restrained, confident, no bouncy easing" },
                    { id: "typography", label: "Typography preferences", value: typographyNotes, set: setTypographyNotes, placeholder: "Short headlines, sentence case" },
                  ].map((f) => (
                    <div key={f.id} className="space-y-1.5">
                      <Label htmlFor={`style-${f.id}`}>{f.label}</Label>
                      <Textarea id={`style-${f.id}`} value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.placeholder} rows={3} />
                    </div>
                  ))}
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="style-guidelines">Brand guidelines</Label>
                    <Textarea id="style-guidelines" value={guidelines} onChange={(e) => setGuidelines(e.target.value)} placeholder="Do/don't rules, voice & tone, logo usage…" rows={4} />
                  </div>
                </CollapsibleContent>
              </Collapsible>
              </>
              )}
            </section>
          ) : null}

          {step === "materials" ? (
            <section className="space-y-8">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Materials</h2>
                <p className="mt-1 text-sm text-muted-foreground">{WORKFLOW_INFO[workflow].description}</p>
              </div>
              {needs.script ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="script">Script</Label>
                    <Button variant="outline" size="xs" onClick={() => scriptInput.current?.click()}>
                      <FileText /> Import .txt / .md
                    </Button>
                    <input
                      ref={scriptInput}
                      type="file"
                      accept=".txt,.md"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void importScriptFile(f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  <Textarea
                    id="script"
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    rows={12}
                    placeholder={"Running a business shouldn't feel this complicated.\n\nMost teams juggle five different tools. That's why we built one platform."}
                    className="font-[450] leading-relaxed"
                  />
                  {scriptError ? <p className="text-sm text-destructive">{scriptError}</p> : null}
                  {estimate ? (
                    <p className="text-xs text-muted-foreground">
                      {estimate.words} words · {estimate.paragraphs.length} paragraph{estimate.paragraphs.length === 1 ? "" : "s"} ·{" "}
                      <span className="text-warning">Estimated</span> ≈ {formatDuration(estimate.duration)} at {estimate.wordsPerMinute} wpm — actual timing comes from the voice-over.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {needs.audio ? (
                <div className="space-y-2">
                  <Label>Voice-over audio</Label>
                  {audio ? (
                    <FileChip file={audio} icon={<FileAudio />} onRemove={() => setAudio(null)} />
                  ) : (
                    <Dropzone accept={AUDIO_ACCEPT} onFiles={(f) => setAudio(f[0] ?? null)} label="Drop your voice-over here, or click to browse" hint="MP3, WAV, M4A, AAC, OGG, FLAC — AI voice, human voice or client-provided" />
                  )}
                </div>
              ) : null}
              {needs.timing ? (
                <div className="space-y-2">
                  <Label>Timeline / timestamps</Label>
                  {timing ? (
                    <FileChip file={timing} icon={<Timer />} onRemove={() => setTiming(null)} />
                  ) : (
                    <Dropzone accept={TIMING_ACCEPT} onFiles={(f) => setTiming(f[0] ?? null)} label="Drop SRT, WebVTT or JSON timing" hint={'JSON: {"duration": 42.73, "segments": [{"text", "start", "end"}]} or word lists'} />
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          {step === "review" ? (
            <section className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Review & create</h2>
                <p className="mt-1 text-sm text-muted-foreground">Nothing is generated yet — creating the project only saves your inputs.</p>
              </div>
              <dl className="grid gap-x-8 gap-y-3 rounded-xl border border-border bg-card p-5 text-sm sm:grid-cols-2">
                {[
                  ["Name", name || "—"],
                  ["Starting point", WORKFLOW_INFO[workflow].label],
                  ["Format", `${width}×${height} (${aspectRatioLabel(width, height)})`],
                  ["Frame rate", `${fps} fps`],
                  ...(chosenKit
                    ? [["Brand kit", `${chosenKit.name} (follows the kit)`]]
                    : [
                        ["Design preset", preset.label],
                        ["Brand", brandName || "—"],
                        ["Logo", logo?.name ?? "—"],
                        ["References", references.length ? `${references.length} file(s)` : "—"],
                      ]),
                  ...(needs.script ? [["Script", estimate ? `${estimate.words} words` : "—"]] : []),
                  ...(needs.audio ? [["Voice-over", audio?.name ?? "—"]] : []),
                  ...(needs.timing ? [["Timing", timing?.name ?? "—"]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-border/60 pb-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="truncate text-right">{v}</dd>
                  </div>
                ))}
              </dl>
              {materialsMissing.length ? (
                <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">Missing {materialsMissing.join(", ")} — you can add {materialsMissing.length === 1 ? "it" : "them"} inside the project.</p>
              ) : null}
              {ops ? (
                <div className="space-y-3 rounded-xl border border-border bg-card p-5">
                  {ops.map((o) => (
                    <div key={o.id} className="space-y-2">
                      <div className="flex items-center gap-3 text-sm">
                        {o.status === "done" ? (
                          <Check className="size-4 text-success" />
                        ) : o.status === "running" ? (
                          <Loader2 className="size-4 animate-spin text-info" />
                        ) : o.status === "error" ? (
                          <X className="size-4 text-destructive" />
                        ) : (
                          <span className="size-4 rounded-full border border-border" />
                        )}
                        <span className={cn(o.status === "pending" && "text-muted-foreground")}>{o.label}</span>
                        {o.status === "running" && o.progress !== undefined ? <span className="ml-auto text-xs text-muted-foreground tabular">{Math.round(o.progress * 100)}%</span> : null}
                      </div>
                      {o.status === "running" && o.progress !== undefined ? <Progress value={o.progress * 100} className="h-1" /> : null}
                      {o.status === "error" ? <ErrorState error={o.error} title={`${o.label} failed`} /> : null}
                    </div>
                  ))}
                  {failed ? (
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" onClick={create}>
                        Retry
                      </Button>
                      {createdId ? (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={destination(createdId)}>Open project anyway</Link>
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="mt-10 flex items-center justify-between border-t border-border pt-6">
            <Button variant="ghost" onClick={back} disabled={stepIndex === 0 || !!ops}>
              <ArrowLeft /> Back
            </Button>
            {step === "review" ? (
              <Button onClick={create} disabled={!name.trim() || !!dimensionError || creating || (!!ops && !failed)}>
                {creating ? <Loader2 className="animate-spin" /> : null}
                {creating ? "Creating…" : "Create project"}
              </Button>
            ) : (
              <Button onClick={next} disabled={!canContinue}>
                Continue <ArrowRight />
              </Button>
            )}
          </div>
          {step === "details" && !name.trim() ? <p className="mt-2 text-right text-xs text-muted-foreground">Enter a project name to continue</p> : null}
          {ops && failed ? <p className="sr-only">{errorMessage(failed.error)}</p> : null}
        </main>
      </div>
    </div>
  );
}
