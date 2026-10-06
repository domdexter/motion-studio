"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Compass, Loader2, Pencil, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ASSET_SOURCE_INFO, CREATIVE_PRINCIPLES, FAMILY_INFO, NARRATIVE_BEAT_LABELS } from "@/core/creative/grammar";
import { NARRATIVE_BEATS, TREATMENT_FAMILIES, parseCreativePlan, type CreativeDirection, type CreativePlan, type StoryAct } from "@/core/creative/schema";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ApplyCreativeResult } from "@/server/services/creative";
import type { TaskDto } from "@/server/services/tasks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, PageHeader, Panel } from "../common";
import { ArcStrip, DistributionBars, FamilySwatch, IntensityDots, useCreativeMetrics, useCreativePlan } from "./shared";

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });
const NONE = "__none";

const DIRECTION_FIELDS: { key: Exclude<keyof CreativeDirection, "concept" | "avoid">; label: string; long?: boolean }[] = [
  { key: "coreMessage", label: "Core message" },
  { key: "tone", label: "Tone" },
  { key: "narrativeStrategy", label: "Narrative strategy", long: true },
  { key: "emotionalDirection", label: "Emotional direction", long: true },
  { key: "visualStyle", label: "Visual style" },
  { key: "visualLanguage", label: "Visual language", long: true },
  { key: "pacing", label: "Pacing", long: true },
  { key: "motionPhilosophy", label: "Motion philosophy", long: true },
  { key: "compositionPhilosophy", label: "Composition philosophy", long: true },
  { key: "typographyDirection", label: "Typography direction", long: true },
  { key: "colorStrategy", label: "Color strategy", long: true },
  { key: "imageryDirection", label: "Imagery direction", long: true },
  { key: "transitionPhilosophy", label: "Transition philosophy", long: true },
  { key: "visualDensity", label: "Visual density" },
  { key: "brandTreatment", label: "Brand treatment", long: true },
];

const humanize = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "act";

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Swatch({ value }: { value: string }) {
  return /^#[0-9a-f]{3,8}$/i.test(value) ? <span className="mr-1 inline-block size-3 rounded-sm border border-border align-middle" style={{ background: value }} /> : null;
}

function ValueText({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
            <Swatch value={String(v)} />
            {String(v)}
          </span>
        ))}
      </span>
    );
  return (
    <span>
      <Swatch value={String(value)} />
      {String(value)}
    </span>
  );
}

// ---------------------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------------------

function DirectionDialog({ open, onOpenChange, initial, onSave, saving }: { open: boolean; onOpenChange: (o: boolean) => void; initial: CreativeDirection | undefined; onSave: (d: CreativeDirection) => void; saving: boolean }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [key, setKey] = useState(0);
  if (open && key === 0) {
    setForm({ concept: initial?.concept ?? "", avoid: (initial?.avoid ?? []).join("\n"), ...Object.fromEntries(DIRECTION_FIELDS.map((f) => [f.key, initial?.[f.key] ?? ""])) });
    setKey(1);
  }
  if (!open && key !== 0) setKey(0);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const submit = () => {
    const direction: Record<string, unknown> = { concept: form.concept.trim(), avoid: form.avoid.split("\n").map((s) => s.trim()).filter(Boolean) };
    for (const f of DIRECTION_FIELDS) if (form[f.key]?.trim()) direction[f.key] = form[f.key].trim();
    onSave(direction as CreativeDirection);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Creative direction</DialogTitle>
          <DialogDescription>The global creative intent every scene inherits. Claude reads it before designing or reviewing anything.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Concept" className="sm:col-span-2">
            <Input value={form.concept ?? ""} onChange={(e) => set("concept", e.target.value)} placeholder="From fragmented complexity to one intelligent platform" />
          </Field>
          {DIRECTION_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} className={f.long ? "sm:col-span-2" : undefined}>
              {f.long ? <Textarea rows={2} value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} /> : <Input value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />}
            </Field>
          ))}
          <Field label="Avoid (one per line)" className="sm:col-span-2">
            <Textarea rows={4} value={form.avoid ?? ""} onChange={(e) => set("avoid", e.target.value)} placeholder={"generic AI aesthetics\nexcessive glow\nrandom particles"} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !form.concept?.trim()}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save direction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ActDraft = { id: string; name: string; purpose: string; beat: string; emotion: string; intensity: string; visualLanguage: string; scenes: string[] };

function ArcDialog({ open, onOpenChange, plan, sceneKeys, onSave, saving }: { open: boolean; onOpenChange: (o: boolean) => void; plan: CreativePlan | null; sceneKeys: string[]; onSave: (arc: NonNullable<CreativePlan["storyArc"]>) => void; saving: boolean }) {
  const [summary, setSummary] = useState("");
  const [acts, setActs] = useState<ActDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  if (open && !loaded) {
    setSummary(plan?.storyArc?.summary ?? "");
    setActs(
      (plan?.storyArc?.acts ?? []).map((a) => ({ id: a.id, name: a.name, purpose: a.purpose ?? "", beat: a.beat ?? NONE, emotion: a.emotion ?? "", intensity: a.intensity ? String(a.intensity) : NONE, visualLanguage: a.visualLanguage.join(", "), scenes: a.scenes })),
    );
    setLoaded(true);
  }
  if (!open && loaded) setLoaded(false);
  const update = (i: number, patch: Partial<ActDraft>) => setActs((list) => list.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  const move = (i: number, d: number) => setActs((list) => {
    const next = [...list];
    const [item] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, item);
    return next;
  });
  const submit = () => {
    const used = new Set<string>();
    const out: StoryAct[] = acts
      .filter((a) => a.name.trim())
      .map((a) => {
        let id = a.id || slug(a.name);
        while (used.has(id)) id = `${id}_2`;
        used.add(id);
        return {
          id,
          name: a.name.trim(),
          ...(a.purpose.trim() ? { purpose: a.purpose.trim() } : {}),
          ...(a.beat !== NONE ? { beat: a.beat as StoryAct["beat"] } : {}),
          ...(a.emotion.trim() ? { emotion: a.emotion.trim() } : {}),
          ...(a.intensity !== NONE ? { intensity: Number(a.intensity) } : {}),
          visualLanguage: a.visualLanguage.split(",").map((s) => s.trim()).filter(Boolean),
          scenes: a.scenes,
        };
      });
    onSave({ ...(summary.trim() ? { summary: summary.trim() } : {}), acts: out });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Story arc</DialogTitle>
          <DialogDescription>Acts come from this script, not a template. Assign scenes so the storyboard and the review can see the progression.</DialogDescription>
        </DialogHeader>
        <Field label="Arc summary">
          <Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <div className="space-y-3">
          {acts.map((a, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">Act {i + 1}</span>
                <Input className="h-8 flex-1" value={a.name} placeholder="Problem" onChange={(e) => update(i, { name: e.target.value })} />
                <Button size="icon-xs" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  <ArrowUp />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={() => move(i, 1)} disabled={i === acts.length - 1} aria-label="Move down">
                  <ArrowDown />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={() => setActs((l) => l.filter((_, k) => k !== i))} aria-label="Remove act">
                  <Trash2 />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_140px_110px]">
                <Input className="h-8" value={a.purpose} placeholder="Purpose" onChange={(e) => update(i, { purpose: e.target.value })} />
                <Select value={a.beat} onValueChange={(v) => update(i, { beat: v })}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Beat" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No beat</SelectItem>
                    {NARRATIVE_BEATS.map((b) => (
                      <SelectItem key={b} value={b}>
                        {NARRATIVE_BEAT_LABELS[b]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={a.intensity} onValueChange={(v) => update(i, { intensity: v })}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Intensity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Intensity —</SelectItem>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {"★".repeat(n)}
                        {"☆".repeat(5 - n)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input className="h-8" value={a.emotion} placeholder="Emotion (e.g. tension)" onChange={(e) => update(i, { emotion: e.target.value })} />
                <Input className="h-8" value={a.visualLanguage} placeholder="Visual language (comma separated)" onChange={(e) => update(i, { visualLanguage: e.target.value })} />
              </div>
              {sceneKeys.length ? (
                <div className="flex flex-wrap gap-1">
                  {sceneKeys.map((k) => {
                    const on = a.scenes.includes(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => update(i, { scenes: on ? a.scenes.filter((s) => s !== k) : [...a.scenes, k].sort() })}
                        className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", on ? "border-primary/60 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
                      >
                        {k.replace("scene_", "")}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setActs((l) => [...l, { id: "", name: "", purpose: "", beat: NONE, emotion: "", intensity: NONE, visualLanguage: "", scenes: [] }])}>
            <Plus /> Add act
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !acts.some((a) => a.name.trim())}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save story arc
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DistributionDialog({ open, onOpenChange, plan, onSave, saving }: { open: boolean; onOpenChange: (o: boolean) => void; plan: CreativePlan | null; onSave: (d: Record<string, number>) => void; saving: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  if (open && !loaded) {
    setValues(Object.fromEntries(TREATMENT_FAMILIES.map((f) => [f, plan?.visualDistribution?.[f] !== undefined ? String(Math.round((plan.visualDistribution[f] ?? 0) * 100)) : ""])));
    setLoaded(true);
  }
  if (!open && loaded) setLoaded(false);
  const total = Object.values(values).reduce((n, v) => n + (Number(v) || 0), 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Visual distribution</DialogTitle>
          <DialogDescription>A balancing aid against monotony — not a quota. Shares are normalized when compared with what is measured.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {TREATMENT_FAMILIES.map((f) => (
            <div key={f} className="flex items-center gap-2 text-sm">
              <FamilySwatch family={f} />
              <span className="flex-1">{FAMILY_INFO[f].label}</span>
              <Input className="h-8 w-20 text-right" inputMode="numeric" value={values[f] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) }))} placeholder="0" />
              <span className="w-4 text-muted-foreground">%</span>
            </div>
          ))}
          <p className={cn("text-right text-xs", total === 100 ? "text-muted-foreground" : "text-warning")}>Total {total}%</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || total === 0} onClick={() => onSave(Object.fromEntries(Object.entries(values).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Math.min(100, Number(v)) / 100])))}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save distribution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type JsonSection = "visualLanguage" | "assetStrategy" | "references" | "plan";

function JsonDialog({ section, onOpenChange, plan, onSave, saving }: { section: JsonSection | null; onOpenChange: (o: boolean) => void; plan: CreativePlan | null; onSave: (section: JsonSection, value: unknown) => void; saving: boolean }) {
  const [text, setText] = useState("");
  const [loadedFor, setLoadedFor] = useState<JsonSection | null>(null);
  if (section && loadedFor !== section) {
    const value = section === "plan" ? (plan ?? {}) : (plan?.[section] ?? (section === "references" ? [] : {}));
    setText(JSON.stringify(value, null, 2));
    setLoadedFor(section);
  }
  if (!section && loadedFor) setLoadedFor(null);
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [text]);
  const validation = parsed.ok && section ? parseCreativePlan(section === "plan" ? parsed.value : { ...(plan ?? {}), [section]: parsed.value }) : null;
  const titles: Record<JsonSection, string> = { visualLanguage: "Visual language", assetStrategy: "Asset strategy & consistency", references: "Reference analyses", plan: "Whole creative plan" };
  return (
    <Dialog open={!!section} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{section ? titles[section] : ""}</DialogTitle>
          <DialogDescription>Structured fields validated against the creative schema (CREATIVE_SYSTEM.md). Saving creates a new plan revision.</DialogDescription>
        </DialogHeader>
        <Textarea spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} className="field-sizing-fixed h-[52vh] resize-none font-mono text-[11.5px]" />
        <div className="max-h-24 overflow-auto text-xs">
          {!parsed.ok ? <p className="text-destructive">JSON error: {parsed.error}</p> : validation && !validation.ok ? validation.issues.slice(0, 8).map((i, k) => <p key={k} className="text-destructive"><span className="font-mono">{i.path || "(root)"}</span> {i.message}</p>) : <p className="text-success">Valid</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || !parsed.ok || !validation?.ok} onClick={() => section && parsed.ok && onSave(section, parsed.value)}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------

export function DirectionPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const planQ = useCreativePlan(projectId);
  const metricsQ = useCreativeMetrics(projectId);
  const revisionsQ = useQuery({
    queryKey: ["project", projectId, "creative-revisions"],
    queryFn: async () => (await http.get<{ revisions: { version: number; source: string; note: string; createdAt: string; sections: string[] }[] }>(`/api/projects/${projectId}/creative/revisions`)).revisions,
  });
  const [editing, setEditing] = useState<null | "direction" | "arc" | "distribution">(null);
  const [jsonSection, setJsonSection] = useState<JsonSection | null>(null);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });

  const save = useMutation({
    mutationFn: (body: { plan: Record<string, unknown>; mode?: "merge" | "replace"; note?: string }) => http.put<ApplyCreativeResult>(`/api/projects/${projectId}/creative`, body),
    onSuccess: (res) => {
      toast.success(res.changed ? `Creative plan v${res.plan?.version} saved` : "No changes", { description: res.warnings.length ? res.warnings.join(" ") : undefined });
      setEditing(null);
      setJsonSection(null);
      invalidate();
    },
    onError: fail,
  });
  const restore = useMutation({
    mutationFn: (version: number) => http.post<ApplyCreativeResult>(`/api/projects/${projectId}/creative/revisions/${version}/restore`),
    onSuccess: (res) => {
      toast.success(res.changed ? `Restored as v${res.plan?.version}` : "Already the current plan");
      invalidate();
    },
    onError: fail,
  });
  const askPlan = useMutation({
    mutationFn: () => http.post<{ task: TaskDto }>(`/api/projects/${projectId}/tasks`, { type: "plan_creative", instruction: "", scope: { keepTiming: true, keepVoice: true } }),
    onSuccess: ({ task }) => {
      toast.success("Sent to Claude Code", { description: task.executor === "headless" ? `“${task.title}” is running in the background.` : `“${task.title}” is waiting for Claude Code (run: npm run studio -- tasks).` });
      invalidate();
    },
    onError: fail,
  });

  if (planQ.error) return <div className="p-6"><ErrorState error={planQ.error} onRetry={() => void planQ.refetch()} /></div>;
  if (planQ.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const dto = planQ.data ?? null;
  const plan = dto?.plan ?? null;
  const direction = plan?.direction;
  const vl = plan?.visualLanguage;
  const sceneKeys = metricsQ.data?.scenes.map((s) => s.key) ?? [];
  const saving = save.isPending;

  return (
    <div className="mx-auto max-w-[1280px] space-y-5 p-6">
      <PageHeader
        title="Creative direction"
        description={dto ? `Plan v${dto.version} · ${dto.source} · updated ${relativeTime(dto.createdAt)} — every scene, asset and review inherits this.` : "The global creative intent: concept, story arc and visual language. Scenes are designed from it, never in isolation."}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => askPlan.mutate()} disabled={askPlan.isPending}>
              {askPlan.isPending ? <Loader2 className="animate-spin" /> : <Sparkles className="text-primary" />} {dto ? "Ask Claude to revise" : "Ask Claude to plan"}
            </Button>
            {dto ? (
              <Button size="sm" variant="ghost" onClick={() => setJsonSection("plan")}>
                Edit as JSON
              </Button>
            ) : null}
          </>
        }
      />

      {!dto ? (
        <EmptyState
          icon={<Compass />}
          title="No creative direction yet"
          description="Claude can derive the concept, story arc, visual language and asset strategy from the script, audio and brand — or start the direction yourself."
          action={
            <div className="flex gap-2">
              <Button size="sm" onClick={() => askPlan.mutate()} disabled={askPlan.isPending}>
                <Sparkles /> Ask Claude to plan
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing("direction")}>
                <Pencil /> Write the direction
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-5">
            <section className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] to-transparent p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium tracking-wider text-primary uppercase">Concept</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight text-balance">{direction?.concept ?? "No concept yet"}</h2>
                  {direction?.coreMessage ? <p className="mt-2 text-sm text-muted-foreground">{direction.coreMessage}</p> : null}
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditing("direction")}>
                  <Pencil /> Edit
                </Button>
              </div>
              {direction?.avoid.length ? (
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Avoid</span>
                  {direction.avoid.map((a) => (
                    <span key={a} className="rounded-full border border-destructive/25 bg-destructive/5 px-2 py-0.5 text-[11px] text-destructive">
                      {a}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>

            {direction ? (
              <Panel title="Direction">
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {DIRECTION_FIELDS.filter((f) => direction[f.key]).map((f) => (
                    <div key={f.key} className={f.long ? "sm:col-span-2" : undefined}>
                      <dt className="text-xs text-muted-foreground">{f.label}</dt>
                      <dd className="mt-0.5 text-sm">{direction[f.key]}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            ) : null}

            <Panel
              title="Story arc"
              description={plan?.storyArc?.summary ?? "The progression the scenes tell together — with planned intensity for peaks and valleys."}
              actions={
                <Button size="xs" variant="outline" onClick={() => setEditing("arc")}>
                  <Pencil /> {plan?.storyArc ? "Edit" : "Add"}
                </Button>
              }
            >
              {metricsQ.data && metricsQ.data.scenes.length ? <ArcStrip projectId={projectId} metrics={metricsQ.data} plan={plan} /> : null}
              {plan?.storyArc ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {plan.storyArc.acts.map((act, i) => (
                    <div key={act.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                        <span className="font-medium">{act.name}</span>
                        {act.beat ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">{NARRATIVE_BEAT_LABELS[act.beat]}</span> : null}
                        <IntensityDots value={act.intensity} className="ml-auto" />
                      </div>
                      {act.purpose ? <p className="mt-1.5 text-sm text-muted-foreground">{act.purpose}</p> : null}
                      {act.emotion ? <p className="mt-1 text-xs"><span className="text-muted-foreground">Emotion · </span>{act.emotion}</p> : null}
                      {act.visualLanguage.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {act.visualLanguage.map((v) => (
                            <span key={v} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                              {v}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="mt-2 font-mono text-[10px] text-muted-foreground">{act.scenes.length ? act.scenes.join(" · ") : "no scenes assigned"}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No acts yet.</p>
              )}
            </Panel>

            <Panel
              title="Visual language"
              description={vl?.summary ?? "Typography, composition, color, imagery, motion, transitions and camera behavior every scene follows unless it deliberately overrides them."}
              actions={
                <Button size="xs" variant="outline" onClick={() => setJsonSection("visualLanguage")}>
                  <Pencil /> {vl ? "Edit" : "Add"}
                </Button>
              }
            >
              {vl ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(["typography", "layout", "composition", "color", "imagery", "motion", "transitions", "camera"] as const)
                    .filter((k) => vl[k] && Object.keys(vl[k]!).length)
                    .map((k) => (
                      <div key={k} className="rounded-lg border border-border p-3">
                        <h4 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">{humanize(k)}</h4>
                        <dl className="mt-2 space-y-1.5 text-sm">
                          {Object.entries(vl[k] as Record<string, unknown>).map(([field, value]) => (
                            <div key={field}>
                              <dt className="text-[11px] text-muted-foreground">{humanize(field)}</dt>
                              <dd>
                                <ValueText value={value} />
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}
                  {(["lighting", "texture", "uiTreatment", "shapeLanguage", "iconTreatment", "density"] as const).filter((k) => vl[k]).length ? (
                    <div className="rounded-lg border border-border p-3">
                      <h4 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Surface</h4>
                      <dl className="mt-2 space-y-1.5 text-sm">
                        {(["lighting", "texture", "uiTreatment", "shapeLanguage", "iconTreatment", "density"] as const)
                          .filter((k) => vl[k])
                          .map((k) => (
                            <div key={k}>
                              <dt className="text-[11px] text-muted-foreground">{humanize(k)}</dt>
                              <dd>{String(vl[k])}</dd>
                            </div>
                          ))}
                      </dl>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No visual language yet.</p>
              )}
            </Panel>

            <div className="grid gap-5 md:grid-cols-2">
              <Panel
                title="Visual distribution"
                description="Measured screen time per treatment, against the plan's balance."
                actions={
                  <Button size="xs" variant="outline" onClick={() => setEditing("distribution")}>
                    <Pencil /> Target
                  </Button>
                }
              >
                {metricsQ.data ? <DistributionBars distribution={metricsQ.data.distribution} /> : <Skeleton className="h-32" />}
              </Panel>
              <Panel
                title="Asset strategy"
                description="Composition-aware briefs and campaign consistency for generated assets."
                actions={
                  <Button size="xs" variant="outline" onClick={() => setJsonSection("assetStrategy")}>
                    <Pencil /> {plan?.assetStrategy ? "Edit" : "Add"}
                  </Button>
                }
              >
                {plan?.assetStrategy?.approach ? <p className="text-sm">{plan.assetStrategy.approach}</p> : null}
                {plan?.assetStrategy?.consistency ? (
                  <dl className="mt-3 space-y-1.5 text-sm">
                    {Object.entries(plan.assetStrategy.consistency)
                      .filter(([, v]) => (Array.isArray(v) ? v.length : !!v))
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[11px] text-muted-foreground">{humanize(k)}</dt>
                          <dd>
                            <ValueText value={v} />
                          </dd>
                        </div>
                      ))}
                  </dl>
                ) : null}
                <ol className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                  {Object.values(ASSET_SOURCE_INFO).map((s) => (
                    <li key={s.rank}>
                      <span className="font-mono">{s.rank}.</span> <span className="text-foreground">{s.label}</span> — {s.when}
                    </li>
                  ))}
                </ol>
              </Panel>
            </div>

            {plan?.references?.length ? (
              <Panel title="References" description="Visual principles extracted from references — used to inform original work, never copied." actions={<Button size="xs" variant="outline" onClick={() => setJsonSection("references")}><Pencil /> Edit</Button>}>
                <div className="grid gap-3 md:grid-cols-2">
                  {plan.references.map((r) => (
                    <div key={r.id} className="rounded-lg border border-border p-3 text-sm">
                      <p className="font-medium">{r.title}</p>
                      {r.overall ? <p className="mt-1 text-muted-foreground">{r.overall}</p> : null}
                      {r.principles.length ? (
                        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">
                          {r.principles.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </div>

          <div className="space-y-5">
            <Panel title="Plan revisions">
              {revisionsQ.data?.length ? (
                <ul className="divide-y divide-border text-sm">
                  {revisionsQ.data.slice(0, 10).map((r) => (
                    <li key={r.version} className="flex items-center gap-2 py-2">
                      <span className="font-mono text-xs">v{r.version}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate capitalize">{r.source}{r.note ? ` · ${r.note}` : ""}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{r.sections.join(", ")} · {relativeTime(r.createdAt)}</span>
                      </span>
                      {r.version === dto.version ? (
                        <span className="text-[11px] text-primary">Current</span>
                      ) : (
                        <Button size="icon-xs" variant="ghost" title={`Restore v${r.version}`} aria-label={`Restore v${r.version}`} disabled={restore.isPending} onClick={() => restore.mutate(r.version)}>
                          <RotateCcw />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No revisions.</p>
              )}
            </Panel>
            <Panel title="Principles" description="Guidance every creative task receives.">
              <p className="text-xs font-medium text-muted-foreground">Prioritize</p>
              <p className="mt-1 text-sm">{CREATIVE_PRINCIPLES.prioritize.join(" · ")}</p>
              <p className="mt-3 text-xs font-medium text-muted-foreground">Ask</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
                {CREATIVE_PRINCIPLES.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}

      <DirectionDialog open={editing === "direction"} onOpenChange={(o) => !o && setEditing(null)} initial={direction} saving={saving} onSave={(d) => save.mutate({ plan: { direction: d } })} />
      <ArcDialog open={editing === "arc"} onOpenChange={(o) => !o && setEditing(null)} plan={plan} sceneKeys={sceneKeys} saving={saving} onSave={(arc) => save.mutate({ plan: { storyArc: arc } })} />
      <DistributionDialog open={editing === "distribution"} onOpenChange={(o) => !o && setEditing(null)} plan={plan} saving={saving} onSave={(d) => save.mutate({ plan: { visualDistribution: d } })} />
      <JsonDialog section={jsonSection} onOpenChange={(o) => !o && setJsonSection(null)} plan={plan} saving={saving} onSave={(section, value) => save.mutate(section === "plan" ? { plan: value as Record<string, unknown>, mode: "replace" } : { plan: { [section]: value } })} />
    </div>
  );
}
