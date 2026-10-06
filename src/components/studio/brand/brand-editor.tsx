"use client";

import { Player } from "@remotion/player";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileText, Loader2, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DESIGN_PRESETS } from "@/core/design/presets";
import { sampleBrandVideoProps } from "@/core/design/sample";
import type { BrandProfile } from "@/core/spec/brand";
import type { CompositionAsset, CompositionFont, StudioVideoProps } from "@/core/spec/composition";
import { CURATED_FONTS, DesignSystemSchema, type DesignSystem } from "@/core/spec/design";
import type { AssetKind } from "@/core/spec/enums";
import { EASINGS, TRANSITIONS, type Background } from "@/core/spec/scene";
import { durationToTotalFrames } from "@/core/timing/frames";
import { ApiError, errorMessage, http, uploadForm } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { StudioVideo } from "@/remotion/StudioVideo";
import type { AssetDto } from "@/server/services/assets";
import type { BrandKitDto, BrandKitFileDto } from "@/server/services/brand-kits";
import type { CompositionBuild } from "@/server/services/composition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useUploadAssets } from "../assets/asset-library";
import { Dropzone, Panel } from "../common";

/**
 * The brand editor shared by a project's Brand page and brand kits in Settings: design system
 * (with a live preview), identity, and logo/fonts/references. The target decides where edits go.
 */

export type BrandEditorTarget = { kind: "project"; projectId: string; brand: BrandProfile; design: DesignSystem } | { kind: "kit"; kit: BrandKitDto };

type BrandFile = { id: string; kind: string; name: string; url: string; mimeType: string; width: number | null; height: number | null };

const BRAND_FILE_KINDS = ["logo", "brand_guide", "reference", "font"] as const;

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

export function useBrandKits() {
  return useQuery({ queryKey: ["brand-kits"], queryFn: async () => (await http.get<{ brandKits: BrandKitDto[] }>("/api/brand-kits")).brandKits });
}

/** Compact visual of a kit: background, logo (or initials) and key colors. */
export function KitSwatch({ kit, className }: { kit: BrandKitDto; className?: string }) {
  const c = kit.design.colors;
  return (
    <div className={cn("relative flex items-center justify-center overflow-hidden rounded-lg", className)} style={{ background: `radial-gradient(80% 90% at 85% 10%, ${c.primary}55, transparent 60%), ${c.background}` }}>
      {kit.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={kit.logoUrl} alt="" className="max-h-[55%] max-w-[60%] object-contain" />
      ) : (
        <span className="text-xl font-semibold tracking-tight" style={{ color: c.text }}>
          {(kit.brand.brandName || kit.name).slice(0, 2)}
        </span>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex gap-1">
        {[c.primary, c.secondary, c.accent].map((col, i) => (
          <span key={i} className="size-2.5 rounded-full ring-1 ring-black/20" style={{ background: col }} />
        ))}
      </div>
    </div>
  );
}

function useTarget(target: BrandEditorTarget) {
  const queryClient = useQueryClient();
  const kitId = target.kind === "kit" ? target.kit.id : null;
  const projectId = target.kind === "project" ? target.projectId : null;
  const base = kitId ? `/api/brand-kits/${kitId}` : `/api/projects/${projectId}`;
  const invalidate = () => {
    if (kitId) {
      void queryClient.invalidateQueries({ queryKey: ["brand-kits"] });
      void queryClient.invalidateQueries({ queryKey: ["brand-kit", kitId] });
      // Projects following the kit were re-synced on the server.
      void queryClient.invalidateQueries({ queryKey: ["project"] });
    } else {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    }
  };
  const followers = target.kind === "kit" ? target.kit.projectCount : 0;
  const followersNote = followers ? `${followers} project${followers === 1 ? "" : "s"} following this kit ${followers === 1 ? "was" : "were"} updated.` : undefined;
  return { brandUrl: `${base}/brand`, designUrl: `${base}/design`, invalidate, followersNote };
}

function useBrandFiles(target: BrandEditorTarget, invalidate: () => void) {
  const projectId = target.kind === "project" ? target.projectId : "";
  const assets = useQuery({
    queryKey: ["project", projectId, "assets", BRAND_FILE_KINDS.join(",")],
    queryFn: async () => (await http.get<{ assets: AssetDto[] }>(`/api/projects/${projectId}/assets?kind=${BRAND_FILE_KINDS.join(",")}`)).assets,
    enabled: target.kind === "project",
  });
  const projectUpload = useUploadAssets(projectId);
  const [kitProgress, setKitProgress] = useState<number | null>(null);
  const kit = target.kind === "kit" ? target.kit : null;

  const files: BrandFile[] | null = kit ? kit.files : (assets.data ?? null);
  const upload = async (kind: (typeof BRAND_FILE_KINDS)[number], list: File[], fields: Record<string, string> = {}): Promise<BrandFile[]> => {
    if (!kit) return projectUpload.upload(kind as AssetKind, list, fields);
    if (!list.length) return [];
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    for (const file of list) form.append("file", file, file.name);
    setKitProgress(0);
    try {
      const res = await uploadForm<{ files: BrandKitFileDto[] }>(`/api/brand-kits/${kit.id}/files?kind=${kind}`, form, setKitProgress);
      toast.success(`Uploaded ${res.files.length} file${res.files.length === 1 ? "" : "s"}`);
      invalidate();
      return res.files;
    } catch (e) {
      toast.error("Upload failed", { description: errorMessage(e) });
      return [];
    } finally {
      setKitProgress(null);
    }
  };
  return { files, upload, progress: kit ? kitProgress : projectUpload.progress };
}

function FilePreview({ file, className }: { file: BrandFile; className?: string }) {
  if (file.mimeType.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={file.url} alt={file.name} className={cn("size-full object-contain", className)} />;
  }
  return (
    <div className={cn("flex size-full items-center justify-center text-muted-foreground", className)}>
      <FileText className="size-8" />
    </div>
  );
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3">
      <Label className="text-xs text-muted-foreground" title={hint}>
        {label}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-3">
        <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} aria-label={label} />
        <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground">{format ? format(value) : value}</span>
      </div>
    </Row>
  );
}

function SelectRow<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Row label={label}>
      <Select value={String(value)} onValueChange={(v) => onChange((typeof value === "number" ? Number(v) : v) as T)}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={String(o.value)} value={String(o.value)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

const BACKGROUND_DEFAULTS: Record<string, Background> = {
  mesh: { type: "mesh", intensity: 0.32, grain: 0.035, vignette: 0.35 },
  gradient: { type: "gradient", colors: ["background", "surface"], angle: 135, vignette: 0.3 },
  grid: { type: "grid", variant: "lines", spacing: 72, fade: true, drift: true, vignette: 0.4 },
  particles: { type: "particles", count: 40, speed: 1, vignette: 0.3 },
  noise: { type: "noise", intensity: 0.5, vignette: 0.3 },
  solid: { type: "solid" },
};

function DesignPreview({ target, draft, files }: { target: BrandEditorTarget; draft: DesignSystem; files: BrandFile[] | null }) {
  const projectId = target.kind === "project" ? target.projectId : "";
  const kit = target.kind === "kit" ? target.kit : null;
  const projectBrand = target.kind === "project" ? target.brand : null;
  const comp = useQuery({
    queryKey: ["project", projectId, "composition"],
    queryFn: () => http.get<CompositionBuild>(`/api/projects/${projectId}/composition`),
    placeholderData: keepPreviousData,
    enabled: target.kind === "project",
  });
  const inputProps = useMemo<StudioVideoProps | null>(() => {
    if (!kit) {
      const props = comp.data?.props;
      if (!props) return null;
      if (props.scenes.length) return { ...props, design: draft };
      // No storyboard yet: preview the brand on the sample video at the project's format.
      return sampleBrandVideoProps({
        design: draft,
        brand: { brandName: props.brand.brandName, tagline: projectBrand?.tagline ?? "", logoAssetId: props.brand.logoAssetId },
        assets: props.assets,
        fonts: props.fonts,
        width: props.width,
        height: props.height,
        fps: props.fps,
      });
    }
    const byId = new Map((files ?? []).map((f) => [f.id, f]));
    const logo = kit.brand.logoAssetId ? byId.get(kit.brand.logoAssetId) : undefined;
    const assets: Record<string, CompositionAsset> = logo
      ? { [logo.id]: { id: logo.id, kind: "logo", name: logo.name, src: logo.url, mimeType: logo.mimeType, width: logo.width, height: logo.height, durationSec: null } }
      : {};
    const fonts: CompositionFont[] = kit.brand.customFonts.flatMap((f) => {
      const file = byId.get(f.assetId);
      return file ? [{ family: f.family, src: file.url }] : [];
    });
    return sampleBrandVideoProps({ design: draft, brand: kit.brand, assets, fonts });
  }, [kit, comp.data, draft, files, projectBrand?.tagline]);

  if (!inputProps) return <Skeleton className="aspect-video rounded-xl" />;
  const portrait = inputProps.height > inputProps.width;
  const sample = inputProps.projectId === "brand-kit-preview";
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black">
      <div className={cn(portrait && "mx-auto max-w-[320px]")}>
        <Player
          component={StudioVideo}
          inputProps={inputProps}
          durationInFrames={Math.max(1, durationToTotalFrames(inputProps.durationSec, inputProps.fps))}
          compositionWidth={inputProps.width}
          compositionHeight={inputProps.height}
          fps={inputProps.fps}
          style={{ width: "100%" }}
          controls
          loop
          autoPlay={sample}
          initiallyMuted
          clickToPlay
        />
      </div>
      <p className="border-t border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        {sample ? "Sample video with the current (unsaved) design." : "Live preview with unsaved changes — scenes keep their structure and timing."}
      </p>
    </div>
  );
}

function DesignSystemPanel({ target, design, customFamilies, files, readOnly }: { target: BrandEditorTarget; design: DesignSystem; customFamilies: string[]; files: BrandFile[] | null; readOnly: boolean }) {
  const api = useTarget(target);
  const [draft, setDraft] = useState<DesignSystem>(design);
  const designKey = JSON.stringify(design);
  useEffect(() => setDraft(JSON.parse(designKey) as DesignSystem), [designKey]);
  const dirty = JSON.stringify(draft) !== designKey;
  const validation = DesignSystemSchema.safeParse(draft);
  const [keepColors, setKeepColors] = useState(false);
  const [keepFonts, setKeepFonts] = useState(false);
  const save = useMutation({
    mutationFn: () => http.patch(api.designUrl, { design: draft }),
    onSuccess: () => {
      toast.success("Design system saved", { description: api.followersNote ?? "Every scene is restyled — structure and timing are unchanged." });
      api.invalidate();
    },
    onError: fail,
  });
  const applyPreset = useMutation({
    mutationFn: (preset: string) => http.patch(api.designUrl, { preset, keepColors, keepFonts }),
    onSuccess: () => {
      toast.success("Preset applied", { description: api.followersNote });
      api.invalidate();
    },
    onError: fail,
  });
  const update = (fn: (d: DesignSystem) => DesignSystem) => setDraft((d) => fn(structuredClone(d)));
  const fonts = Array.from(new Set([...customFamilies, ...CURATED_FONTS])).map((f) => ({ value: f, label: customFamilies.includes(f) ? `${f} (brand font)` : f }));
  const bgType = draft.background.type;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <fieldset disabled={readOnly} className={cn("min-w-0 space-y-5", readOnly && "pointer-events-none opacity-70")}>
        <Panel title="Presets" description="Start from a look, then fine-tune. Applying a preset keeps scenes and timing.">
          <div className="grid gap-2 sm:grid-cols-2">
            {DESIGN_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset.mutate(p.id)}
                disabled={applyPreset.isPending}
                className={cn("rounded-lg border p-3 text-left transition-colors hover:border-primary/50", design.preset === p.id ? "border-primary/60 bg-primary/10" : "border-border")}
              >
                <div className="flex items-center gap-1">
                  {(["background", "surface", "primary", "secondary", "accent", "text"] as const).map((k) => (
                    <span key={k} className="size-4 rounded-full border border-foreground/10" style={{ background: p.design.colors[k] }} />
                  ))}
                  {design.preset === p.id ? <Check className="ml-auto size-4 text-primary" /> : null}
                </div>
                <div className="mt-2 text-sm font-medium">{p.label}</div>
                <div className="text-xs text-muted-foreground">{p.description}</div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={keepColors} onCheckedChange={setKeepColors} /> Keep my colors
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={keepFonts} onCheckedChange={setKeepFonts} /> Keep my fonts
            </label>
          </div>
        </Panel>

        <Panel title="Colors">
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(draft.colors) as (keyof DesignSystem["colors"])[]).map((key) => (
              <label key={key} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                <input
                  type="color"
                  value={draft.colors[key]}
                  onChange={(e) => update((d) => ({ ...d, colors: { ...d.colors, [key]: e.target.value.toUpperCase() } }))}
                  className="size-7 cursor-pointer rounded border-0 bg-transparent p-0"
                  aria-label={`${key} color`}
                />
                <div className="min-w-0">
                  <div className="text-xs capitalize">{key}</div>
                  <Input
                    value={draft.colors[key]}
                    onChange={(e) => update((d) => ({ ...d, colors: { ...d.colors, [key]: e.target.value } }))}
                    className="h-6 border-0 bg-transparent px-0 font-mono text-[11px] shadow-none"
                    aria-label={`${key} hex`}
                  />
                </div>
              </label>
            ))}
          </div>
        </Panel>

        <Panel title="Typography">
          <div className="space-y-2.5">
            <SelectRow label="Heading font" value={draft.typography.headingFont} options={fonts} onChange={(v) => update((d) => ({ ...d, typography: { ...d.typography, headingFont: v } }))} />
            <SelectRow label="Body font" value={draft.typography.bodyFont} options={fonts} onChange={(v) => update((d) => ({ ...d, typography: { ...d.typography, bodyFont: v } }))} />
            <SelectRow
              label="Heading weight"
              value={draft.typography.headingWeight}
              options={[400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))}
              onChange={(v) => update((d) => ({ ...d, typography: { ...d.typography, headingWeight: v } }))}
            />
            <SelectRow
              label="Type scale"
              value={draft.typography.scale}
              options={[
                { value: "compact", label: "Compact" },
                { value: "standard", label: "Standard" },
                { value: "large", label: "Large" },
              ]}
              onChange={(v) => update((d) => ({ ...d, typography: { ...d.typography, scale: v } }))}
            />
            <SliderRow label="Letter spacing" value={draft.typography.headingLetterSpacing} min={-0.1} max={0.2} step={0.005} format={(v) => `${v.toFixed(3)}em`} onChange={(v) => update((d) => ({ ...d, typography: { ...d.typography, headingLetterSpacing: v } }))} />
            <SliderRow label="Line height" value={draft.typography.lineHeight} min={0.85} max={1.6} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => update((d) => ({ ...d, typography: { ...d.typography, lineHeight: v } }))} />
            <SelectRow
              label="Headings"
              value={draft.typography.headingTransform}
              options={[
                { value: "none", label: "As written" },
                { value: "uppercase", label: "UPPERCASE" },
              ]}
              onChange={(v) => update((d) => ({ ...d, typography: { ...d.typography, headingTransform: v } }))}
            />
          </div>
        </Panel>

        <Panel title="Motion">
          <div className="space-y-2.5">
            <SelectRow label="Easing" value={draft.motion.easing} options={EASINGS.map((e) => ({ value: e, label: e }))} onChange={(v) => update((d) => ({ ...d, motion: { ...d.motion, easing: v } }))} />
            <SelectRow
              label="Intensity"
              value={draft.motion.intensity}
              options={[
                { value: "subtle", label: "Subtle" },
                { value: "standard", label: "Standard" },
                { value: "energetic", label: "Energetic" },
              ]}
              onChange={(v) => update((d) => ({ ...d, motion: { ...d.motion, intensity: v } }))}
            />
            <SliderRow label="Enter duration" value={draft.motion.defaultDuration} min={0.2} max={1.6} step={0.05} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => update((d) => ({ ...d, motion: { ...d.motion, defaultDuration: v } }))} />
            <SliderRow label="Stagger" value={draft.motion.stagger} min={0} max={0.3} step={0.01} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => update((d) => ({ ...d, motion: { ...d.motion, stagger: v } }))} />
            <SelectRow label="Scene transition" value={draft.transition.type} options={TRANSITIONS.map((t) => ({ value: t, label: t }))} onChange={(v) => update((d) => ({ ...d, transition: { ...d.transition, type: v } }))} />
            <SliderRow
              label="Transition length"
              value={draft.transition.duration ?? draft.motion.transitionDuration}
              min={0}
              max={1.2}
              step={0.05}
              format={(v) => `${v.toFixed(2)}s`}
              onChange={(v) => update((d) => ({ ...d, transition: { ...d.transition, duration: v }, motion: { ...d.motion, transitionDuration: v } }))}
            />
          </div>
        </Panel>

        <Panel title="Shape & background">
          <div className="space-y-2.5">
            <SliderRow label="Corner radius" value={draft.shape.radius} min={0} max={60} step={1} format={(v) => `${v}u`} onChange={(v) => update((d) => ({ ...d, shape: { ...d.shape, radius: v } }))} />
            <SelectRow
              label="Shadows"
              value={draft.shape.shadow}
              options={(["none", "soft", "medium", "deep", "glow"] as const).map((s) => ({ value: s, label: s }))}
              onChange={(v) => update((d) => ({ ...d, shape: { ...d.shape, shadow: v } }))}
            />
            <SelectRow
              label="Background"
              value={bgType === "image" || bgType === "video" ? "mesh" : bgType}
              options={Object.keys(BACKGROUND_DEFAULTS).map((t) => ({ value: t, label: t }))}
              onChange={(v) => update((d) => ({ ...d, background: structuredClone(BACKGROUND_DEFAULTS[v]) }))}
            />
            <SliderRow label="Film grain" value={draft.background.grain ?? 0} min={0} max={0.12} step={0.005} format={(v) => v.toFixed(3)} onChange={(v) => update((d) => ({ ...d, background: { ...d.background, grain: v } as Background }))} />
            <SliderRow label="Vignette" value={draft.background.vignette ?? 0} min={0} max={0.8} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => update((d) => ({ ...d, background: { ...d.background, vignette: v } as Background }))} />
            <SliderRow label="Safe margin" value={draft.layout.safeMargin} min={0} max={15} step={0.5} format={(v) => `${v}%`} onChange={(v) => update((d) => ({ ...d, layout: { ...d.layout, safeMargin: v } }))} />
          </div>
        </Panel>
      </fieldset>

      <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
        <DesignPreview target={target} draft={draft} files={files} />
        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => save.mutate()} disabled={!dirty || !validation.success || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save design system
            </Button>
            <Button variant="ghost" onClick={() => setDraft(JSON.parse(designKey) as DesignSystem)} disabled={!dirty}>
              <RotateCcw /> Discard changes
            </Button>
            {!validation.success ? (
              <span className="text-xs text-destructive">
                {validation.error.issues[0]?.path.join(".")}: {validation.error.issues[0]?.message}
              </span>
            ) : dirty ? (
              <span className="text-xs text-warning">Unsaved changes</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

const PROFILE_KEYS = ["brandName", "tagline", "website", "visualStyle", "imageStyle", "animationStyle", "typographyNotes", "guidelines"] as const;
type ProfileForm = Pick<BrandProfile, (typeof PROFILE_KEYS)[number]>;
const pickProfile = (b: BrandProfile): ProfileForm => Object.fromEntries(PROFILE_KEYS.map((k) => [k, b[k]])) as ProfileForm;

function BrandProfilePanel({ target, brand, readOnly }: { target: BrandEditorTarget; brand: BrandProfile; readOnly: boolean }) {
  const api = useTarget(target);
  const initialKey = JSON.stringify(pickProfile(brand));
  const [form, setForm] = useState<ProfileForm>(pickProfile(brand));
  useEffect(() => setForm(JSON.parse(initialKey) as ProfileForm), [initialKey]);
  const dirty = JSON.stringify(form) !== initialKey;
  const save = useMutation({
    mutationFn: () => http.patch(api.brandUrl, form),
    onSuccess: () => {
      toast.success("Brand saved", { description: api.followersNote ?? "Claude Code reads this through .project/brand.md." });
      api.invalidate();
    },
    onError: fail,
  });
  const text = (key: keyof ProfileForm, label: string, placeholder: string, rows = 3) => (
    <div className="space-y-1.5">
      <Label htmlFor={`brand-${key}`}>{label}</Label>
      <Textarea id={`brand-${key}`} rows={rows} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} />
    </div>
  );
  return (
    <Panel title="Identity & creative direction" description="Used by the storyboard drafter and by Claude Code for every creative decision.">
      <fieldset disabled={readOnly} className={cn("min-w-0", readOnly && "opacity-70")}>
        <div className="grid gap-4 md:grid-cols-3">
          {(["brandName", "tagline", "website"] as const).map((key) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`brand-${key}`}>{key === "brandName" ? "Brand name" : key === "tagline" ? "Tagline" : "Website"}</Label>
              <Input id={`brand-${key}`} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {text("visualStyle", "Visual style", "e.g. premium, minimal, lots of negative space, soft glows")}
          {text("imageStyle", "Image style", "e.g. warm natural light, real people, no stock-photo clichés")}
          {text("animationStyle", "Animation style", "e.g. calm and confident, no bouncy motion")}
          {text("typographyNotes", "Typography notes", "e.g. sentence case headlines, never more than 7 words")}
        </div>
        <div className="mt-4">{text("guidelines", "Brand guidelines", "Paste the parts of your brand guide that matter for video.", 6)}</div>
      </fieldset>
      {readOnly ? null : (
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save brand
          </Button>
          {dirty ? <span className="text-xs text-warning">Unsaved changes</span> : null}
        </div>
      )}
    </Panel>
  );
}

function BrandFilesPanel({ target, brand, files, upload, progress, readOnly }: { target: BrandEditorTarget; brand: BrandProfile; files: BrandFile[] | null; upload: ReturnType<typeof useBrandFiles>["upload"]; progress: number | null; readOnly: boolean }) {
  const api = useTarget(target);
  const [family, setFamily] = useState("");
  const patchBrand = useMutation({ mutationFn: (body: Partial<BrandProfile>) => http.patch(api.brandUrl, body), onSuccess: api.invalidate, onError: fail });
  const all = files ?? [];
  const logos = all.filter((a) => a.kind === "logo");
  const currentLogo = all.find((a) => a.id === brand.logoAssetId);
  const guides = all.filter((a) => brand.brandGuideAssetIds.includes(a.id));
  const references = all.filter((a) => brand.referenceAssetIds.includes(a.id));
  const busy = progress !== null || readOnly;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Logo" description="Used by logo elements and wordmark fallbacks in every scene.">
        <div className="flex gap-4">
          <div className="checkerboard flex h-28 w-44 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border">
            {currentLogo ? <FilePreview file={currentLogo} className="p-2" /> : <span className="text-xs text-muted-foreground">No logo</span>}
          </div>
          <div className="flex-1 space-y-2">
            <Select value={brand.logoAssetId ?? "none"} onValueChange={(v) => patchBrand.mutate({ logoAssetId: v === "none" ? null : v })} disabled={readOnly}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No logo (use a wordmark)</SelectItem>
                {logos.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dropzone
              accept=".svg,.png,.webp,.jpg,.jpeg"
              onFiles={async (list) => {
                const created = await upload("logo", list);
                if (created[0]) patchBrand.mutate({ logoAssetId: created[0].id });
              }}
              label="Upload a logo"
              hint="SVG or transparent PNG"
              disabled={busy}
            />
          </div>
        </div>
      </Panel>

      <Panel title="Brand fonts" description="Upload font files, then pick them as heading or body fonts in the design system.">
        <Input value={family} onChange={(e) => setFamily(e.target.value)} placeholder="Font family name, e.g. Acme Sans" aria-label="Font family name" disabled={readOnly} />
        <Dropzone
          className="mt-2"
          accept=".ttf,.otf,.woff,.woff2"
          onFiles={async (list) => {
            const created = await upload("font", list, { name: family.trim() });
            if (created[0]) {
              patchBrand.mutate({ customFonts: [...brand.customFonts, { family: family.trim(), assetId: created[0].id }] });
              setFamily("");
            }
          }}
          label={family.trim() ? `Upload ${family.trim()}` : "Enter the family name first"}
          hint="TTF, OTF, WOFF or WOFF2"
          disabled={!family.trim() || busy}
        />
        {brand.customFonts.length ? (
          <ul className="mt-3 divide-y divide-border text-sm">
            {brand.customFonts.map((f) => (
              <li key={`${f.family}-${f.assetId}`} className="flex items-center gap-2 py-1.5">
                <span className="font-medium">{f.family}</span>
                <span className="truncate text-xs text-muted-foreground">{all.find((a) => a.id === f.assetId)?.name ?? f.assetId}</span>
                {readOnly ? null : (
                  <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={() => patchBrand.mutate({ customFonts: brand.customFonts.filter((x) => x.assetId !== f.assetId) })} aria-label={`Remove ${f.family}`}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      {(
        [
          { key: "brandGuideAssetIds", kind: "brand_guide", title: "Brand guides", description: "PDFs or images Claude Code reads for creative direction.", items: guides },
          { key: "referenceAssetIds", kind: "reference", title: "Visual references", description: "Mood boards and examples of the look you want.", items: references },
        ] as const
      ).map((section) => (
        <Panel key={section.key} title={section.title} description={section.description}>
          <Dropzone
            accept=".pdf,.png,.jpg,.jpeg,.webp,.md,.txt"
            multiple
            onFiles={async (list) => {
              const created = await upload(section.kind, list);
              if (created.length) patchBrand.mutate({ [section.key]: [...brand[section.key], ...created.map((a) => a.id)] });
            }}
            label={`Upload ${section.title.toLowerCase()}`}
            hint="PDF, images, Markdown or text"
            disabled={busy}
          />
          {section.items.length ? (
            <ul className="mt-3 divide-y divide-border text-sm">
              {section.items.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-1.5">
                  <a href={a.url} target="_blank" rel="noreferrer" className="truncate hover:underline">
                    {a.name}
                  </a>
                  <span className="text-[10px] text-muted-foreground">{a.mimeType}</span>
                  {readOnly ? null : (
                    <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={() => patchBrand.mutate({ [section.key]: brand[section.key].filter((id) => id !== a.id) })} aria-label={`Remove ${a.name}`}>
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ))}
    </div>
  );
}

export function BrandEditor({ target, readOnly = false }: { target: BrandEditorTarget; readOnly?: boolean }) {
  const api = useTarget(target);
  const filesApi = useBrandFiles(target, api.invalidate);
  const brand = target.kind === "kit" ? target.kit.brand : target.brand;
  const design = target.kind === "kit" ? target.kit.design : target.design;
  return (
    <Tabs defaultValue="design" className="gap-5">
      <TabsList>
        <TabsTrigger value="design">Design system</TabsTrigger>
        <TabsTrigger value="identity">Identity</TabsTrigger>
        <TabsTrigger value="files">Logo, fonts &amp; references</TabsTrigger>
      </TabsList>
      <TabsContent value="design">
        <DesignSystemPanel target={target} design={design} customFamilies={brand.customFonts.map((f) => f.family)} files={filesApi.files} readOnly={readOnly} />
      </TabsContent>
      <TabsContent value="identity">
        <BrandProfilePanel target={target} brand={brand} readOnly={readOnly} />
      </TabsContent>
      <TabsContent value="files">
        <BrandFilesPanel target={target} brand={brand} files={filesApi.files} upload={filesApi.upload} progress={filesApi.progress} readOnly={readOnly} />
      </TabsContent>
    </Tabs>
  );
}
