import type { CreativeReview } from "@/generated/prisma/client";
import { CreativeReviewInputSchema, ISSUE_STATUSES, type IssueStatus, type ReviewIssue, type ScoreKey } from "@/core/creative/schema";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { assertId, assertProjectId, newId } from "../ids";
import { getCreativeMetrics } from "./creative";
import { mutateProject, type Actor } from "./mutation";
import { getProjectState } from "./state";
import { createAiTask, type TaskDto } from "./tasks";

/**
 * Creative QA reviews. A review is a reviewer's written critique (normally Claude Code, working
 * from renders, frames and the measured metrics). Scores are advisory and only accepted together
 * with written issues or strengths. Issues have a status workflow; accepted issues become explicit
 * refinement tasks — nothing is changed automatically.
 */

export type StoredIssue = ReviewIssue & { id: string; status: IssueStatus };

export interface MeasuredSummary {
  counts: Record<"high" | "medium" | "low" | "info", number>;
  findings: { id: string; severity: string; scene?: string; message: string }[];
}

export function reviewDto(r: CreativeReview, currentHash?: string | null) {
  return {
    id: r.id,
    version: r.version,
    source: r.source,
    title: r.title,
    request: r.request,
    summary: r.summary,
    overallScore: r.overallScore,
    scores: (r.scores ?? {}) as Partial<Record<ScoreKey, number>>,
    strengths: (r.strengths ?? []) as string[],
    issues: (r.issues ?? []) as StoredIssue[],
    scope: (r.scope ?? []) as string[],
    weakestScenes: (r.weakestScenes ?? []) as string[],
    basedOn: (r.basedOn ?? null) as { renderId?: string; frames?: number[]; notes?: string } | null,
    measured: (r.measured ?? null) as MeasuredSummary | null,
    compositionHash: r.compositionHash,
    storyboardVersion: r.storyboardVersion,
    /** The video changed after this review was written. */
    stale: !!currentHash && !!r.compositionHash && r.compositionHash !== currentHash,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type CreativeReviewDto = ReturnType<typeof reviewDto>;

export async function listCreativeReviews(projectId: string, limit = 20): Promise<CreativeReviewDto[]> {
  assertProjectId(projectId);
  const [rows, state] = await Promise.all([db.creativeReview.findMany({ where: { projectId }, orderBy: { version: "desc" }, take: limit }), getProjectState(projectId)]);
  return rows.map((r) => reviewDto(r, state.compositionHash));
}

export async function getCreativeReview(projectId: string, reviewId: string): Promise<CreativeReviewDto> {
  assertProjectId(projectId);
  assertId(reviewId, "review id");
  const [row, state] = await Promise.all([db.creativeReview.findFirst({ where: { id: reviewId, projectId } }), getProjectState(projectId)]);
  if (!row) throw notFound(`Creative review “${reviewId}”`);
  return reviewDto(row, state.compositionHash);
}

export async function getLatestCreativeReview(projectId: string): Promise<CreativeReviewDto | null> {
  const [row, state] = await Promise.all([db.creativeReview.findFirst({ where: { projectId }, orderBy: { version: "desc" } }), getProjectState(projectId)]);
  return row ? reviewDto(row, state.compositionHash) : null;
}

export async function saveCreativeReview(projectId: string, input: unknown, actor: Actor): Promise<CreativeReviewDto> {
  assertProjectId(projectId);
  const parsed = CreativeReviewInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "The creative review is invalid.", { details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })), hint: "See CREATIVE_SYSTEM.md → Creative QA." });
  }
  const data = parsed.data;
  const scenes = await db.scene.findMany({ where: { projectId }, select: { key: true } });
  const keys = new Set(scenes.map((s) => s.key));
  const referenced = [...data.scope, ...data.weakestScenes, ...data.issues.map((i) => i.scene).filter((k): k is string => !!k)];
  const unknown = [...new Set(referenced.filter((k) => !keys.has(k)))];
  if (unknown.length) throw new AppError("VALIDATION", `The review references unknown scene${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  const used = new Set<string>();
  const issues: StoredIssue[] = data.issues.map((issue, i) => {
    let id = issue.id ?? `i${i + 1}`;
    while (used.has(id)) id = `${id}_${i + 1}`;
    used.add(id);
    return { ...issue, id, status: issue.status ?? "open" };
  });
  const [state, metrics, storyboard, last] = await Promise.all([
    getProjectState(projectId),
    getCreativeMetrics(projectId),
    db.storyboardRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { version: true } }),
    db.creativeReview.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { version: true } }),
  ]);
  const measured: MeasuredSummary = {
    counts: metrics.counts,
    findings: metrics.findings
      .filter((f) => f.severity !== "info")
      .slice(0, 40)
      .map((f) => ({ id: f.id, severity: f.severity, scene: f.scene, message: f.message })),
  };
  const id = newId.review();
  const version = (last?.version ?? 0) + 1;
  const high = issues.filter((i) => i.severity === "high").length;
  await mutateProject(projectId, actor, async (tx) => {
    await tx.creativeReview.create({
      data: {
        id,
        projectId,
        version,
        source: actor === "claude" ? "claude" : "user",
        title: data.title ?? "",
        request: data.request ?? "",
        summary: data.summary,
        overallScore: data.overallScore ?? null,
        scores: json(data.scores),
        strengths: json(data.strengths),
        issues: json(issues),
        scope: json(data.scope),
        weakestScenes: json(data.weakestScenes),
        ...(data.basedOn ? { basedOn: json(data.basedOn) } : {}),
        measured: json(measured),
        compositionHash: state.compositionHash,
        storyboardVersion: storyboard?.version ?? null,
      },
    });
    return {
      result: null,
      activity: {
        type: "creative.reviewed",
        message: `Creative review v${version}${data.title ? ` “${data.title}”` : ""}: ${issues.length} issue${issues.length === 1 ? "" : "s"}${high ? ` (${high} high)` : ""}${data.overallScore !== undefined ? ` · advisory score ${data.overallScore}` : ""}`,
        data: { reviewId: id, version },
      },
    };
  });
  return getCreativeReview(projectId, id);
}

export async function setReviewIssueStatus(projectId: string, reviewId: string, issueIds: string[], status: IssueStatus, actor: Actor): Promise<CreativeReviewDto> {
  if (!(ISSUE_STATUSES as readonly string[]).includes(status)) throw new AppError("VALIDATION", `Status must be one of ${ISSUE_STATUSES.join(", ")}.`);
  const review = await getCreativeReview(projectId, reviewId);
  const missing = issueIds.filter((id) => !review.issues.some((i) => i.id === id));
  if (missing.length) throw new AppError("VALIDATION", `Unknown issue${missing.length === 1 ? "" : "s"} in review v${review.version}: ${missing.join(", ")}.`);
  const issues = review.issues.map((i) => (issueIds.includes(i.id) ? { ...i, status } : i));
  await mutateProject(projectId, actor, async (tx) => {
    await tx.creativeReview.update({ where: { id: reviewId }, data: { issues: json(issues) } });
    return { result: null, activity: { type: "creative.issue", message: `Review v${review.version}: marked ${issueIds.join(", ")} as ${status}`, data: { reviewId, issueIds, status } } };
  });
  return getCreativeReview(projectId, reviewId);
}

/** Creates an explicit, read-only creative review task for Claude Code. */
export function requestCreativeReview(projectId: string, input: { request: string; sceneIds?: string[]; title?: string }, actor: Actor): Promise<TaskDto> {
  return createAiTask(projectId, { type: "creative_review", instruction: input.request, title: input.title, scope: { sceneIds: input.sceneIds?.length ? input.sceneIds : undefined, keepTiming: true, keepVoice: true } }, actor);
}

/**
 * Turns selected review issues into an explicit refinement task (and marks them accepted).
 * `executor: "headless"` (the per-issue Apply fix) runs Claude Code in the background right away,
 * whatever the global AI execution setting is.
 */
export async function requestRefinement(
  projectId: string,
  reviewId: string,
  input: { issueIds: string[]; instruction?: string; executor?: "manual" | "headless" },
  actor: Actor,
): Promise<TaskDto> {
  const review = await getCreativeReview(projectId, reviewId);
  const issues = review.issues.filter((i) => input.issueIds.includes(i.id));
  if (!issues.length) throw new AppError("VALIDATION", "Choose at least one issue to refine.");
  const closed = issues.filter((i) => i.status === "dismissed" || i.status === "resolved");
  if (closed.length) throw new AppError("CONFLICT", `${closed.map((i) => i.id).join(", ")} ${closed.length === 1 ? "is" : "are"} already ${closed[0].status}.`);
  const projectWide = issues.some((i) => !i.scene);
  const sceneKeys = [...new Set(issues.map((i) => i.scene).filter((k): k is string => !!k))];
  const lines = issues.map((i, n) => `${n + 1}. [${i.id} · ${i.severity} · ${i.category}${i.scene ? ` · ${i.scene}${i.shot ? `/${i.shot}` : ""}` : " · project"}] ${i.issue}\n   → ${i.recommendation}`);
  const instruction = [
    `Apply these approved recommendations from creative review v${review.version}${review.title ? ` “${review.title}”` : ""} (${review.id}):`,
    ...lines,
    input.instruction?.trim() ? `\nAdditional direction from the user: ${input.instruction.trim()}` : "",
    `\nWhen an issue is addressed: npm run studio -- creative:issue ${projectId} ${review.id} <issueId> --status resolved`,
  ]
    .filter(Boolean)
    .join("\n");
  const task = await createAiTask(
    projectId,
    {
      type: "refine_creative",
      instruction,
      title: `Refine ${issues.length} review issue${issues.length === 1 ? "" : "s"}${sceneKeys.length && !projectWide ? ` (${sceneKeys.map((k) => k.replace("scene_", "S")).join(", ")})` : ""}`,
      scope: { sceneIds: projectWide ? undefined : sceneKeys, keepTiming: true, keepVoice: true, reviewId: review.id, issueIds: issues.map((i) => i.id) },
      ...(input.executor ? { executor: input.executor } : {}),
    },
    actor,
  );
  const open = issues.filter((i) => i.status === "open").map((i) => i.id);
  if (open.length) await setReviewIssueStatus(projectId, reviewId, open, "accepted", actor);
  return task;
}
