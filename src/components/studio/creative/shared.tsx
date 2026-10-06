"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FAMILY_INFO, TREATMENT_INFO } from "@/core/creative/grammar";
import type { CreativeFinding, CreativeMetrics } from "@/core/creative/metrics";
import { TREATMENT_FAMILIES, type CreativePlan, type Treatment, type TreatmentFamily } from "@/core/creative/schema";
import { http } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { CreativePlanDto } from "@/server/services/creative";
import type { CreativeReviewDto } from "@/server/services/creative-reviews";

// ---------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------

export function useCreativePlan(projectId: string) {
  return useQuery({ queryKey: ["project", projectId, "creative"], queryFn: async () => (await http.get<{ plan: CreativePlanDto | null }>(`/api/projects/${projectId}/creative`)).plan });
}

export function useCreativeMetrics(projectId: string) {
  return useQuery({ queryKey: ["project", projectId, "creative-metrics"], queryFn: async () => (await http.get<{ metrics: CreativeMetrics }>(`/api/projects/${projectId}/creative/metrics`)).metrics });
}

export function useCreativeReviews(projectId: string) {
  return useQuery({ queryKey: ["project", projectId, "creative-reviews"], queryFn: async () => (await http.get<{ reviews: CreativeReviewDto[] }>(`/api/projects/${projectId}/creative/reviews`)).reviews });
}

export const REVIEW_PRESETS = [
  "Review this video like a senior motion designer.",
  "Find the three weakest scenes.",
  "Find repetitive visual patterns.",
  "Find scenes with too much motion.",
  "Find scenes where the visual is too literal.",
  "Find typography that is competing with the visuals.",
  "Find scenes that don't follow the visual language.",
];

export const REFINE_PRESETS = [
  "Make the pacing more premium without changing the voice timing.",
  "Make the entire video feel more cohesive.",
  "Make the opening more impactful.",
  "Create more visual contrast between the problem and solution.",
  "Reduce visual clutter.",
  "Make the animation more restrained.",
];

export const familyLabel = (family: TreatmentFamily | null | undefined) => (family ? FAMILY_INFO[family].label : "—");
export const treatmentLabel = (treatment: Treatment | null | undefined) => (treatment ? TREATMENT_INFO[treatment].label : "—");

// ---------------------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------------------

const SEVERITY_CLASS: Record<string, string> = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-warning/15 text-warning",
  low: "bg-info/15 text-info",
  info: "bg-muted text-muted-foreground",
};

export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[10px] font-medium tracking-wide uppercase", SEVERITY_CLASS[severity] ?? SEVERITY_CLASS.info, className)}>{severity === "medium" ? "med" : severity}</span>;
}

export function FamilySwatch({ family, className }: { family: TreatmentFamily | null | undefined; className?: string }) {
  return <span title={familyLabel(family)} className={cn("inline-block size-2.5 shrink-0 rounded-full", !family && "bg-muted-foreground/30", className)} style={family ? { background: FAMILY_INFO[family].color } : undefined} />;
}

export function IntensityDots({ value, className, title }: { value: number | null | undefined; className?: string; title?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={title ?? (value ? `Intensity ${value}/5` : "No intensity")}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn("size-1.5 rounded-full", value && i <= value ? "bg-primary" : "bg-muted-foreground/25")} />
      ))}
    </span>
  );
}

export function FindingItem({ finding, projectId }: { finding: CreativeFinding; projectId: string }) {
  return (
    <li className="flex gap-2.5 py-2 text-sm">
      <SeverityBadge severity={finding.severity} className="mt-0.5" />
      <div className="min-w-0">
        <p className="leading-snug">
          {finding.scene ? (
            <Link href={`/projects/${projectId}/scenes?scene=${finding.scene}`} className="mr-1.5 font-mono text-xs text-primary hover:underline">
              {finding.scene}
              {finding.shot ? `/${finding.shot}` : ""}
            </Link>
          ) : null}
          {finding.message}
        </p>
        {finding.measured ? <p className="mt-0.5 text-xs text-muted-foreground">Measured: {finding.measured}</p> : null}
        {finding.recommendation ? <p className="mt-0.5 text-xs text-muted-foreground">→ {finding.recommendation}</p> : null}
      </div>
      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground capitalize">{finding.category}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------------------

/** Planned (dashed) vs measured (solid) intensity per scene over the video's time. */
export function IntensityCurve({ metrics, className }: { metrics: CreativeMetrics; className?: string }) {
  const duration = metrics.durationSec || 1;
  const W = 1000;
  const H = 100;
  const pad = 12;
  const x = (t: number) => (t / duration) * W;
  const y = (v: number) => H - pad - ((v - 1) / 4) * (H - pad * 2);
  const measured = metrics.intensity.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.start).toFixed(1)},${y(p.measured).toFixed(1)} L${x(p.end).toFixed(1)},${y(p.measured).toFixed(1)}`).join(" ");
  const planned = metrics.intensity
    .filter((p) => p.planned !== null)
    .map((p) => `M${x(p.start).toFixed(1)},${y(p.planned!).toFixed(1)} L${x(p.end).toFixed(1)},${y(p.planned!).toFixed(1)}`)
    .join(" ");
  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label="Intensity curve">
        {[1, 2, 3, 4, 5].map((v) => (
          <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {metrics.intensity.slice(1).map((p) => (
          <line key={p.key} x1={x(p.start)} x2={x(p.start)} y1={0} y2={H} className="stroke-border" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        ))}
        {planned ? <path d={planned} fill="none" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray="7 5" vectorEffect="non-scaling-stroke" /> : null}
        <path d={measured} fill="none" className="stroke-primary" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="pointer-events-none absolute top-0 left-1 text-[10px] text-muted-foreground">peak</span>
      <span className="pointer-events-none absolute bottom-0 left-1 text-[10px] text-muted-foreground">quiet</span>
    </div>
  );
}

/** Acts over time, the measured treatment family of every scene, and the intensity curve. */
export function ArcStrip({ projectId, metrics, plan, selectedKey }: { projectId: string; metrics: CreativeMetrics; plan: CreativePlan | null; selectedKey?: string }) {
  const duration = metrics.durationSec || 1;
  const pct = (t: number) => `${(t / duration) * 100}%`;
  const acts = (plan?.storyArc?.acts ?? [])
    .map((act) => {
      const members = metrics.scenes.filter((s) => act.scenes.includes(s.key));
      return members.length ? { act, start: Math.min(...members.map((m) => m.start)), end: Math.max(...members.map((m) => m.end)) } : null;
    })
    .filter((a): a is NonNullable<typeof a> => !!a);
  const families = TREATMENT_FAMILIES.filter((f) => metrics.scenes.some((s) => s.detected.family === f));
  return (
    <div className="space-y-1.5">
      {acts.length ? (
        <div className="relative h-7">
          {acts.map(({ act, start, end }) => (
            <div key={act.id} className="absolute top-0 flex h-7 items-center gap-1 overflow-hidden rounded-md border border-border bg-muted/40 px-2 text-[11px]" style={{ left: pct(start), width: `calc(${pct(end - start)} - 3px)` }} title={[act.name, act.purpose, act.visualLanguage.join(", ")].filter(Boolean).join(" — ")}>
              <span className="truncate font-medium">{act.name}</span>
              {act.intensity ? <IntensityDots value={act.intensity} className="ml-auto hidden pl-1 md:inline-flex" /> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex h-6 overflow-hidden rounded-md">
        {metrics.scenes.map((s) => (
          <Link
            key={s.key}
            href={`/projects/${projectId}/scenes?scene=${s.key}`}
            className={cn("flex h-full items-center justify-center border-r border-background/70 font-mono text-[9px] text-white/90 transition-opacity last:border-r-0 hover:opacity-80", selectedKey === s.key && "ring-2 ring-foreground ring-inset")}
            style={{ width: pct(s.duration), background: s.detected.family ? FAMILY_INFO[s.detected.family].color : "var(--muted)" }}
            title={`${s.key} · ${s.name}\nMeasured: ${familyLabel(s.detected.family)}${s.intent.treatment ? ` · planned ${treatmentLabel(s.intent.treatment)}` : ""}\nDensity ${s.motion.measuredDensity} · intensity ${s.intensity.measured}${s.intensity.planned ? ` (planned ${s.intensity.planned})` : ""}`}
          >
            <span className="truncate px-0.5">{s.key.replace("scene_", "")}</span>
          </Link>
        ))}
      </div>
      <IntensityCurve metrics={metrics} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {families.map((f) => (
          <span key={f} className="flex items-center gap-1">
            <FamilySwatch family={f} /> {FAMILY_INFO[f].label}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4 bg-primary" /> measured intensity
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" /> planned
          </span>
        </span>
      </div>
    </div>
  );
}

/** Measured screen-time share per treatment family, with the plan's target as a tick. */
export function DistributionBars({ distribution }: { distribution: CreativeMetrics["distribution"] }) {
  const targetSum = Object.values(distribution.target ?? {}).reduce((n, v) => n + (v ?? 0), 0) || 1;
  const rows = TREATMENT_FAMILIES.filter((f) => (distribution.measured[f] ?? 0) > 0 || (distribution.target?.[f] ?? 0) > 0 || (distribution.planned[f] ?? 0) > 0);
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing measured yet.</p>;
  return (
    <div className="space-y-2">
      {rows.map((f) => {
        const measured = distribution.measured[f] ?? 0;
        const target = distribution.target?.[f] !== undefined ? (distribution.target[f] ?? 0) / targetSum : null;
        return (
          <div key={f} className="grid grid-cols-[132px_1fr_40px] items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5 truncate">
              <FamilySwatch family={f} /> {FAMILY_INFO[f].label}
            </span>
            <div className="relative h-2.5 rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, measured * 100)}%`, background: FAMILY_INFO[f].color }} />
              {target !== null ? <div className="absolute -top-1 h-4.5 w-0.5 rounded bg-foreground" style={{ left: `calc(${Math.min(100, target * 100)}% - 1px)` }} title={`Target ${Math.round(target * 100)}%`} /> : null}
            </div>
            <span className="text-right font-mono tabular-nums">{Math.round(measured * 100)}%</span>
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">Bars: measured share of screen time. {distribution.target ? "Ticks: the plan's target." : "Set a target distribution on the Direction page."}</p>
    </div>
  );
}
