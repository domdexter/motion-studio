import type { CreativeRevision } from "@/generated/prisma/client";
import { analyzeCreative, type CreativeMetrics, type MetricsAsset } from "@/core/creative/metrics";
import {
  CREATIVE_PLAN_SECTIONS,
  mergeCreativePlan,
  parseCreativePlan,
  parseSceneCreative,
  planPartOfCreativeFile,
  type CreativePlan,
  type CreativePlanSection,
} from "@/core/creative/schema";
import type { DesignSystem } from "@/core/spec/design";
import { validateSceneSpec } from "@/core/spec/scene";
import type { TimedWord } from "@/core/spec/timing";
import { stableStringify } from "@/core/util/hash";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { assertProjectId } from "../ids";
import { mutateProject, type Actor } from "./mutation";

/**
 * Project creative plan (versioned) and the measured creative metrics. The plan is authored by
 * Claude Code or the user and validated here; every change is a new revision. Metrics are pure
 * measurements computed from the current scenes — memoized per project revision.
 */

export interface CreativePlanDto {
  version: number;
  source: string;
  note: string;
  createdAt: string;
  plan: CreativePlan;
  sections: CreativePlanSection[];
}

function presentSections(plan: CreativePlan): CreativePlanSection[] {
  return CREATIVE_PLAN_SECTIONS.filter((k) => plan[k] !== undefined && !(Array.isArray(plan[k]) && (plan[k] as unknown[]).length === 0));
}

function planDto(row: CreativeRevision): CreativePlanDto {
  const parsed = parseCreativePlan(row.data);
  const plan = parsed.ok ? parsed.value : (row.data as CreativePlan);
  return { version: row.version, source: row.source, note: row.note, createdAt: row.createdAt.toISOString(), plan, sections: presentSections(plan) };
}

export async function getCreativePlan(projectId: string): Promise<CreativePlanDto | null> {
  const row = await db.creativeRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" } });
  return row ? planDto(row) : null;
}

async function planWarnings(projectId: string, plan: CreativePlan): Promise<string[]> {
  const warnings: string[] = [];
  const keys = new Set((await db.scene.findMany({ where: { projectId }, select: { key: true } })).map((s) => s.key));
  const acts = plan.storyArc?.acts ?? [];
  const ids = acts.map((a) => a.id);
  if (new Set(ids).size !== ids.length) warnings.push("Story arc act ids should be unique.");
  const seen = new Map<string, string>();
  for (const act of acts) {
    const unknown = act.scenes.filter((k) => !keys.has(k));
    if (unknown.length && keys.size) warnings.push(`Act “${act.name}” lists scenes that don't exist: ${unknown.join(", ")}.`);
    for (const k of act.scenes) {
      if (seen.has(k)) warnings.push(`${k} is in both “${seen.get(k)}” and “${act.name}”.`);
      seen.set(k, act.name);
    }
  }
  if (plan.visualDistribution) {
    const sum = Object.values(plan.visualDistribution).reduce((n, v) => n + (v ?? 0), 0);
    if (Math.abs(sum - 1) > 0.05) warnings.push(`Visual distribution shares add up to ${sum.toFixed(2)} — they are normalized when compared.`);
  }
  return warnings;
}

export interface ApplyCreativeResult {
  plan: CreativePlanDto | null;
  changed: boolean;
  changedSections: CreativePlanSection[];
  warnings: string[];
}

/**
 * Saves a creative plan. `merge` (default) replaces only the sections present in the input
 * (a `null` section removes it); `replace` stores exactly the input.
 */
export async function applyCreativePlan(projectId: string, input: unknown, actor: Actor, options: { mode?: "merge" | "replace"; note?: string; source?: string } = {}): Promise<ApplyCreativeResult> {
  assertProjectId(projectId);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("VALIDATION", "A creative plan must be a JSON object.");
  const exists = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!exists) throw notFound("Project");
  const current = await getCreativePlan(projectId);
  const body = planPartOfCreativeFile(input as Record<string, unknown>);
  const candidate = (options.mode ?? "merge") === "merge" ? mergeCreativePlan(current?.plan ?? null, body) : body;
  const parsed = parseCreativePlan(candidate);
  if (!parsed.ok) throw new AppError("VALIDATION", "The creative plan is invalid.", { details: parsed.issues, hint: "See CREATIVE_SYSTEM.md for the plan format." });
  const plan = parsed.value;
  if (!current && !presentSections(plan).length) throw new AppError("VALIDATION", "The creative plan is empty.", { hint: "Add at least a direction, story arc or visual language." });
  const warnings = await planWarnings(projectId, plan);
  const changedSections = CREATIVE_PLAN_SECTIONS.filter((k) => stableStringify(plan[k] ?? null) !== stableStringify(current?.plan[k] ?? null));
  if (current && !changedSections.length) return { plan: current, changed: false, changedSections, warnings };
  const source = options.source ?? (actor === "claude" ? "claude" : actor === "file" ? "file" : "user");
  const version = (current?.version ?? 0) + 1;
  const note = (options.note ?? "").slice(0, 500);
  await mutateProject(projectId, actor, async (tx) => {
    await tx.creativeRevision.create({ data: { projectId, version, source, note, data: json(plan) } });
    return {
      result: null,
      activity: {
        type: "creative.updated",
        message: `Creative plan v${version}: ${current ? `updated ${changedSections.join(", ")}` : `created (${presentSections(plan).join(", ")})`}${note ? ` — ${note}` : ""}`,
        data: { version, sections: changedSections },
      },
    };
  });
  return { plan: await getCreativePlan(projectId), changed: true, changedSections, warnings };
}

export async function listCreativeRevisions(projectId: string) {
  assertProjectId(projectId);
  const rows = await db.creativeRevision.findMany({ where: { projectId }, orderBy: { version: "desc" }, take: 50 });
  return rows.map((r) => {
    const dto = planDto(r);
    return { version: dto.version, source: dto.source, note: dto.note, createdAt: dto.createdAt, sections: dto.sections };
  });
}

export async function restoreCreativeRevision(projectId: string, version: number, actor: Actor): Promise<ApplyCreativeResult> {
  assertProjectId(projectId);
  const row = await db.creativeRevision.findUnique({ where: { projectId_version: { projectId, version } } });
  if (!row) throw notFound(`Creative plan v${version}`);
  return applyCreativePlan(projectId, row.data, actor, { mode: "replace", note: `Restored v${version}`, source: "restore" });
}

// ---------------------------------------------------------------------------------------
// Measured metrics
// ---------------------------------------------------------------------------------------

const metricsMemo = new Map<string, { revision: number; metrics: CreativeMetrics }>();

export async function getCreativeMetrics(projectId: string): Promise<CreativeMetrics> {
  assertProjectId(projectId);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { revision: true, width: true, height: true, design: true, activeTranscriptId: true } });
  if (!project) throw notFound("Project");
  const cached = metricsMemo.get(projectId);
  if (cached && cached.revision === project.revision) return cached.metrics;
  const [transcript, scenes, assets, plan] = await Promise.all([
    project.activeTranscriptId ? db.transcript.findUnique({ where: { id: project.activeTranscriptId }, select: { words: true } }) : null,
    db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" }, select: { key: true, name: true, startSec: true, endSec: true, spec: true, creative: true } }),
    db.asset.findMany({ where: { projectId }, select: { id: true, kind: true, source: true, width: true, height: true, requestId: true } }),
    getCreativePlan(projectId),
  ]);
  const metrics = analyzeCreative({
    width: project.width,
    height: project.height,
    design: project.design as DesignSystem,
    words: (transcript?.words ?? []) as TimedWord[],
    plan: plan?.plan ?? null,
    assets: Object.fromEntries(assets.map((a) => [a.id, { kind: a.kind, source: a.source, width: a.width, height: a.height, requestId: a.requestId } satisfies MetricsAsset])),
    scenes: scenes.map((s) => {
      const spec = validateSceneSpec(s.spec);
      const creative = s.creative ? parseSceneCreative(s.creative) : null;
      return { key: s.key, name: s.name, start: s.startSec, end: s.endSec, spec: spec.ok ? spec.spec : null, creative: creative?.ok ? creative.value : null };
    }),
  });
  metricsMemo.set(projectId, { revision: project.revision, metrics });
  return metrics;
}
