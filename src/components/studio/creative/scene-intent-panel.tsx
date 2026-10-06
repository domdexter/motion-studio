"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DENSITY_INFO, MOTION_GRAMMAR, NARRATIVE_BEAT_LABELS, TREATMENT_INFO } from "@/core/creative/grammar";
import type { SceneMetrics } from "@/core/creative/metrics";
import { COMPOSITION_LAYOUTS, NARRATIVE_BEATS, REGIONS, TREATMENTS, parseSceneCreative, type SceneCreative, type StoryAct } from "@/core/creative/schema";
import { MOTION_DENSITIES } from "@/core/spec/scene";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SceneDto } from "@/server/services/scenes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FamilySwatch, FindingItem, IntensityDots, familyLabel, treatmentLabel } from "./shared";

const NONE = "__none";
const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

function Row({ label, planned, measured, mismatch }: { label: string; planned: React.ReactNode; measured?: React.ReactNode; mismatch?: boolean }) {
  return (
    <div className="grid grid-cols-[92px_1fr_1fr] gap-2 border-t border-border py-1.5 text-xs first:border-t-0">
      <span className="text-muted-foreground">{label}</span>
      <span>{planned ?? <span className="text-muted-foreground">—</span>}</span>
      <span className={cn("text-muted-foreground", mismatch && "text-warning")}>{measured ?? ""}</span>
    </div>
  );
}

function EnumSelect({ value, onChange, options, placeholder }: { value: string | undefined; onChange: (v: string | undefined) => void; options: readonly { value: string; label: string }[]; placeholder: string }) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
      <SelectTrigger size="sm" className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const regionOptions = REGIONS.map((r) => ({ value: r, label: r }));

/** Scene creative intent: what the scene is for, how it is composed and how it moves — planned vs measured. */
export function SceneIntentPanel({ projectId, scene, metrics, acts, onAskClaude }: { projectId: string; scene: SceneDto; metrics: SceneMetrics | undefined; acts: StoryAct[]; onAskClaude: () => void }) {
  const queryClient = useQueryClient();
  const creative = scene.creative;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SceneCreative>({});
  const [json, setJson] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: SceneCreative | null) => http.patch(`/api/projects/${projectId}/scenes/${scene.id}`, { creative: value }),
    onSuccess: () => {
      toast.success(`${scene.key} creative intent saved`);
      setEditing(false);
      setJson(null);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: fail,
  });
  const start = () => {
    setDraft(creative ?? {});
    setEditing(true);
  };
  const set = <K extends keyof SceneCreative>(key: K, value: SceneCreative[K]) => setDraft((d) => ({ ...d, [key]: value === "" ? undefined : value }));
  const setIn = <K extends "composition" | "motion" | "typography">(key: K, patch: Record<string, unknown>) => setDraft((d) => ({ ...d, [key]: { ...(d[key] ?? {}), ...patch } }));
  const clean = (value: SceneCreative): SceneCreative => JSON.parse(JSON.stringify(value, (_k, v) => (v === "" ? undefined : v)));
  const locked = scene.locked;

  if (json !== null) {
    let parsed: ReturnType<typeof parseSceneCreative> | null = null;
    let error: string | null = null;
    try {
      parsed = parseSceneCreative(JSON.parse(json));
    } catch (e) {
      error = (e as Error).message;
    }
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Full creative intent (shots, assets, audio sync, constraints). See CREATIVE_SYSTEM.md.</p>
        <Textarea spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} className="field-sizing-fixed h-[420px] resize-none font-mono text-[11px]" />
        <p className={cn("text-xs", error || (parsed && !parsed.ok) ? "text-destructive" : "text-success")}>
          {error ? `JSON error: ${error}` : parsed && !parsed.ok ? `${parsed.issues[0].path} ${parsed.issues[0].message}` : "Valid"}
        </p>
        <div className="flex gap-2">
          <Button size="sm" disabled={!parsed?.ok || save.isPending || locked} onClick={() => parsed?.ok && save.mutate(parsed.value)}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setJson(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Purpose — what this moment must do</Label>
          <Textarea rows={2} value={draft.purpose ?? ""} onChange={(e) => set("purpose", e.target.value)} placeholder="Make the pain of starting from nothing felt" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <EnumSelect value={draft.narrativeBeat} onChange={(v) => set("narrativeBeat", v as SceneCreative["narrativeBeat"])} options={NARRATIVE_BEATS.map((b) => ({ value: b, label: NARRATIVE_BEAT_LABELS[b] }))} placeholder="Narrative beat" />
          <EnumSelect value={draft.act} onChange={(v) => set("act", v)} options={acts.map((a) => ({ value: a.id, label: a.name }))} placeholder="Act" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Visual metaphor — the strongest representation of the idea</Label>
          <Textarea rows={2} value={draft.visualMetaphor ?? ""} onChange={(e) => set("visualMetaphor", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input className="h-8" value={draft.emotion ?? ""} onChange={(e) => set("emotion", e.target.value)} placeholder="Emotion" />
          <EnumSelect value={draft.interpretation} onChange={(v) => set("interpretation", v as SceneCreative["interpretation"])} options={[{ value: "metaphorical", label: "Metaphorical" }, { value: "transformational", label: "Transformational" }, { value: "literal", label: "Literal" }]} placeholder="Interpretation" />
          <EnumSelect value={draft.treatment} onChange={(v) => set("treatment", v as SceneCreative["treatment"])} options={TREATMENTS.map((t) => ({ value: t, label: TREATMENT_INFO[t].label }))} placeholder="Treatment" />
          <EnumSelect value={draft.intensity ? String(draft.intensity) : undefined} onChange={(v) => set("intensity", v ? Number(v) : undefined)} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `Intensity ${n}` }))} placeholder="Intensity" />
        </div>
        <p className="pt-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Composition</p>
        <div className="grid grid-cols-2 gap-2">
          <EnumSelect value={draft.composition?.layout} onChange={(v) => setIn("composition", { layout: v })} options={COMPOSITION_LAYOUTS.map((l) => ({ value: l, label: l.replace("_", " ") }))} placeholder="Layout" />
          <EnumSelect value={draft.composition?.focalPoint} onChange={(v) => setIn("composition", { focalPoint: v })} options={regionOptions} placeholder="Focal point" />
          <EnumSelect value={draft.composition?.textArea} onChange={(v) => setIn("composition", { textArea: v })} options={regionOptions} placeholder="Text area" />
          <EnumSelect value={draft.composition?.negativeSpace} onChange={(v) => setIn("composition", { negativeSpace: v })} options={regionOptions} placeholder="Negative space" />
        </div>
        <p className="pt-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Motion hierarchy</p>
        <div className="grid grid-cols-2 gap-2">
          <EnumSelect value={draft.motion?.density} onChange={(v) => setIn("motion", { density: v })} options={MOTION_DENSITIES.map((d) => ({ value: d, label: `${DENSITY_INFO[d].label} density` }))} placeholder="Density" />
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={!!draft.motion?.stillness} onCheckedChange={(v) => setIn("motion", { stillness: v || undefined })} /> Intentional stillness
          </label>
        </div>
        <Input className="h-8" value={draft.motion?.primary ?? ""} onChange={(e) => setIn("motion", { primary: e.target.value })} placeholder="Primary motion (the one move that leads)" />
        <Input className="h-8" value={draft.motion?.secondary ?? ""} onChange={(e) => setIn("motion", { secondary: e.target.value })} placeholder="Secondary motion" />
        <Input className="h-8" value={draft.motion?.tertiary ?? ""} onChange={(e) => setIn("motion", { tertiary: e.target.value })} placeholder="Tertiary / micro motion" />
        <Input className="h-8" value={(draft.typography?.emphasisWords ?? []).join(", ")} onChange={(e) => setIn("typography", { emphasisWords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="Emphasis words (comma separated)" />
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" disabled={save.isPending || locked} onClick={() => save.mutate(clean(draft))}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null} Save intent
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setJson(JSON.stringify(clean(draft), null, 2))}>
            JSON
          </Button>
        </div>
      </div>
    );
  }

  const m = metrics;
  const shotPlans = creative?.shots ?? [];
  const shotIds = [...new Set([...(m?.motion.shots.map((s) => s.id) ?? []), ...shotPlans.map((s) => s.id)])];
  return (
    <div className="space-y-4">
      {creative ? (
        <div className="space-y-2">
          {creative.purpose ? <p className="text-sm leading-snug">{creative.purpose}</p> : null}
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            {creative.narrativeBeat ? <span className="rounded bg-muted px-1.5 py-0.5 font-medium tracking-wide text-muted-foreground uppercase">{NARRATIVE_BEAT_LABELS[creative.narrativeBeat]}</span> : null}
            {creative.act ? <span className="rounded border border-border px-1.5 py-0.5">{acts.find((a) => a.id === creative.act)?.name ?? creative.act}</span> : null}
            {creative.emotion ? <span className="rounded border border-border px-1.5 py-0.5">{creative.emotion}</span> : null}
            {creative.interpretation ? <span className="rounded border border-border px-1.5 py-0.5 capitalize">{creative.interpretation}</span> : null}
            {creative.motion?.stillness ? <span className="rounded bg-info/15 px-1.5 py-0.5 text-info">intentional stillness</span> : null}
          </div>
          {creative.visualMetaphor ? (
            <p className="text-xs">
              <span className="text-muted-foreground">Metaphor · </span>
              {creative.visualMetaphor}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          No creative intent recorded. Intent (purpose, beat, metaphor, composition, motion hierarchy) lets the storyboard and reviews judge this scene against the story arc.
        </div>
      )}

      <div>
        <div className="grid grid-cols-[92px_1fr_1fr] gap-2 pb-1 text-[10px] tracking-wider text-muted-foreground uppercase">
          <span />
          <span>Planned</span>
          <span>Measured</span>
        </div>
        <Row label="Treatment" planned={creative?.treatment ? treatmentLabel(creative.treatment) : null} measured={m ? <span className="inline-flex items-center gap-1"><FamilySwatch family={m.detected.family} />{familyLabel(m.detected.family)}</span> : null} />
        <Row label="Density" planned={creative?.motion?.density ? DENSITY_INFO[creative.motion.density].label : null} measured={m ? `${DENSITY_INFO[m.motion.measuredDensity].label} (${m.motion.densityScore})` : null} mismatch={!!m && !!creative?.motion?.density && Math.abs(DENSITY_INFO[creative.motion.density].level - DENSITY_INFO[m.motion.measuredDensity].level) >= 2} />
        <Row label="Intensity" planned={m?.intensity.planned ? <IntensityDots value={m.intensity.planned} /> : null} measured={m ? <IntensityDots value={m.intensity.measured} /> : null} />
        <Row label="Focal point" planned={creative?.composition?.focalPoint} measured={m?.layout.focal} />
        <Row label="Text area" planned={creative?.composition?.textArea} measured={m?.layout.text} />
        <Row label="Negative space" planned={creative?.composition?.negativeSpace} measured={m ? `${Math.round(m.layout.negativeSpace * 100)}% of frame · ${m.layout.weight}` : null} />
        <Row label="Motion" planned={creative?.motion?.primary ? <span>{creative.motion.primary}{creative.motion.secondary ? <span className="text-muted-foreground"> · {creative.motion.secondary}</span> : null}</span> : null} measured={m ? `${m.motion.animated} animated · burst ${m.motion.maxBurst} · ${m.motion.eventsPerSec}/s` : null} />
        <Row label="Words" planned={creative?.typography?.emphasisWords.length ? creative.typography.emphasisWords.join(", ") : null} measured={m ? `${m.typography.maxWordsOnScreen} on screen at most` : null} />
      </div>

      {shotIds.length ? (
        <div>
          <h4 className="mb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Shots</h4>
          <ol className="space-y-1.5">
            {shotIds.map((id) => {
              const plan = shotPlans.find((s) => s.id === id);
              const actual = m?.motion.shots.find((s) => s.id === id);
              return (
                <li key={id} className="rounded-md border border-border px-2.5 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{id}</span>
                    {actual ? <span className="font-mono text-muted-foreground">{actual.start.toFixed(2)}–{actual.end.toFixed(2)}s</span> : <span className="text-warning">planned, not in the spec</span>}
                    {plan?.treatment ? <span className="ml-auto text-muted-foreground">{TREATMENT_INFO[plan.treatment].label}</span> : null}
                  </div>
                  {plan?.purpose ? <p className="mt-0.5">{plan.purpose}</p> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {creative?.motion?.grammar?.length ? (
        <p className="text-xs text-muted-foreground">Motion grammar: {creative.motion.grammar.map((g) => `${MOTION_GRAMMAR[g].label} (${MOTION_GRAMMAR[g].motion})`).join(" · ")}</p>
      ) : null}

      {m?.findings.length ? (
        <div>
          <h4 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Measured findings</h4>
          <ul className="divide-y divide-border">
            {m.findings.map((f) => (
              <FindingItem key={f.id} finding={f} projectId={projectId} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" disabled={locked} onClick={start}>
          <Pencil /> {creative ? "Edit intent" : "Add intent"}
        </Button>
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => setJson(JSON.stringify(creative ?? {}, null, 2))}>
          JSON
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={locked} onClick={onAskClaude}>
          <Sparkles className="text-primary" /> Ask Claude
        </Button>
      </div>
    </div>
  );
}
