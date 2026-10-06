import { z } from "zod";
import type { AiTask } from "@/generated/prisma/client";
import { AI_TASK_TYPES, type AiTaskType } from "@/core/spec/enums";
import { parseScript } from "@/core/script/script";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { newId } from "../ids";
import { enqueueJob, requestCancel } from "../jobs/queue";
import { mutateProject, type Actor } from "./mutation";
import { getSettings } from "./settings";
import { detectClaudeCli } from "./system";

/**
 * AI tasks: explicit, reviewable units of work for Claude Code. The GUI creates them; Claude
 * Code (interactive session or headless CLI run) claims, performs and completes them through
 * the studio CLI. Every task keeps its instruction, scope, log and outcome.
 */

export const TaskScopeSchema = z.object({
  sceneIds: z.array(z.string()).max(500).optional(),
  keepTiming: z.boolean().default(true),
  keepVoice: z.boolean().default(true),
  section: z.string().max(80).optional(),
  count: z.number().int().min(1).max(5).optional(),
  /** refine_creative: the review and issues being addressed. */
  reviewId: z.string().max(80).optional(),
  issueIds: z.array(z.string().max(40)).max(80).optional(),
});

export const CreateTaskSchema = z.object({
  type: z.enum(AI_TASK_TYPES),
  instruction: z.string().max(8000).default(""),
  title: z.string().max(160).optional(),
  scope: TaskScopeSchema.default({ keepTiming: true, keepVoice: true }),
  executor: z.enum(["manual", "headless"]).optional(),
});

interface StoredScope {
  sceneIds?: string[];
  sceneKeys?: string[];
  skippedLocked?: string[];
  keepTiming?: boolean;
  keepVoice?: boolean;
  section?: string;
  count?: number;
  reviewId?: string;
  issueIds?: string[];
}

export function taskDto(t: AiTask) {
  const scope = (t.scope ?? {}) as StoredScope;
  return {
    id: t.id,
    projectId: t.projectId,
    type: t.type as AiTaskType,
    status: t.status as "pending" | "running" | "completed" | "failed" | "cancelled",
    title: t.title,
    instruction: t.instruction,
    scope,
    executor: t.executor,
    log: (t.log ?? []) as { at: string; text: string }[],
    resultSummary: t.resultSummary,
    error: t.error,
    createdAt: t.createdAt.toISOString(),
    claimedAt: t.claimedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
  };
}
export type TaskDto = ReturnType<typeof taskDto>;

function defaultTitle(type: AiTaskType, keys: string[], instruction: string, count?: number): string {
  const scenes = keys.map((k) => k.replace("scene_", "Scene ")).join(", ");
  const short = instruction.trim().replace(/\s+/g, " ").slice(0, 70);
  switch (type) {
    case "analyze_script":
      return "Analyze the script";
    case "generate_storyboard":
      return "Generate the storyboard";
    case "regenerate_scenes":
      return `Regenerate ${scenes}`;
    case "edit_scene":
      return `${scenes}: ${short || "edit"}`;
    case "scene_alternatives":
      return `${count ?? 3} alternatives for ${scenes}`;
    case "generate_assets":
      return "Generate requested assets";
    case "plan_creative":
      return "Plan the creative direction";
    case "creative_review":
      return short ? `Creative review: ${short}` : `Creative review${scenes ? ` of ${scenes}` : ""}`;
    case "refine_creative":
      return `Refine ${scenes || "the video"}${short ? `: ${short}` : ""}`;
    default:
      return short || "Claude request";
  }
}

export async function createAiTask(projectId: string, input: z.input<typeof CreateTaskSchema>, actor: Actor): Promise<TaskDto> {
  const data = CreateTaskSchema.parse(input);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { revision: true, activeTimelineId: true } });
  if (!project) throw notFound("Project");
  const scenes = await db.scene.findMany({ where: { projectId }, select: { id: true, key: true, locked: true }, orderBy: { order: "asc" } });
  const requested = data.scope.sceneIds ?? [];
  const resolved = requested.map((r) => scenes.find((s) => s.id === r || s.key === r));
  const unknown = requested.filter((_, i) => !resolved[i]);
  if (unknown.length) throw new AppError("VALIDATION", `Unknown scene${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  const inScope = resolved.filter((s): s is NonNullable<typeof s> => !!s);
  const lockedInScope = inScope.filter((s) => s.locked);
  const unlocked = inScope.filter((s) => !s.locked);

  if (data.type === "edit_scene" || data.type === "regenerate_scenes" || data.type === "scene_alternatives") {
    if (!inScope.length) throw new AppError("VALIDATION", "Choose at least one scene for this task.");
    if (!unlocked.length) throw new AppError("LOCKED", `${lockedInScope.map((s) => s.key).join(", ")} ${lockedInScope.length === 1 ? "is" : "are"} locked. Unlock to let Claude change ${lockedInScope.length === 1 ? "it" : "them"}.`);
  }
  if (data.type === "refine_creative" && inScope.length && !unlocked.length) {
    throw new AppError("LOCKED", `${lockedInScope.map((s) => s.key).join(", ")} ${lockedInScope.length === 1 ? "is" : "are"} locked. Unlock to let Claude refine ${lockedInScope.length === 1 ? "it" : "them"}.`);
  }
  if (data.type === "creative_review" && !scenes.length) {
    throw new AppError("PRECONDITION", "There is nothing to review yet — generate the storyboard first.");
  }
  if (data.type === "generate_storyboard" && !project.activeTimelineId) {
    throw new AppError("PRECONDITION", "Generate or import a voice-over before generating an audio-locked storyboard.", {
      action: { label: "Open Voice", href: `/projects/${projectId}/voice` },
    });
  }
  if (data.type === "analyze_script") {
    const script = await db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { content: true } });
    if (!script || !parseScript(script.content).wordCount) throw new AppError("PRECONDITION", "Write or import a script before asking Claude to analyze it.");
  }
  if (data.type === "command" && !data.instruction.trim()) throw new AppError("VALIDATION", "Tell Claude what to do.");

  const executor = data.executor ?? getSettings().ai.executor;
  if (executor === "headless" && !detectClaudeCli().found) {
    throw new AppError("NOT_CONFIGURED", "Claude Code CLI was not found, so tasks can't run automatically.", {
      hint: "Switch AI execution to “Hand off to my Claude Code session” in Settings, or install Claude Code.",
      action: { label: "Open AI settings", href: "/settings#ai" },
    });
  }
  // A review changes nothing, so locked scenes stay in its scope.
  const reviewOnly = data.type === "creative_review";
  const scoped = reviewOnly ? inScope : unlocked;
  const title = data.title?.trim() || defaultTitle(data.type, scoped.map((s) => s.key), data.instruction, data.scope.count);
  const scope: StoredScope = {
    ...data.scope,
    sceneIds: scoped.map((s) => s.id),
    sceneKeys: scoped.map((s) => s.key),
    skippedLocked: reviewOnly ? [] : lockedInScope.map((s) => s.key),
  };

  const task = await mutateProject(projectId, actor, async (tx) => {
    const row = await tx.aiTask.create({
      data: { id: newId.task(), projectId, type: data.type, title, instruction: data.instruction, scope: json(scope), contextRevision: project.revision, executor },
    });
    return {
      result: row,
      activity: {
        type: "task.created",
        message: `Asked Claude: “${title}”${executor === "headless" ? " (running automatically)" : " (waiting for Claude Code)"}${lockedInScope.length ? ` · locked scenes excluded: ${lockedInScope.map((s) => s.key).join(", ")}` : ""}`,
        data: { taskId: row.id },
      },
    };
  });
  if (executor === "headless") await enqueueJob({ projectId, type: "ai.headless", payload: { taskId: task.id } });
  return taskDto(task);
}

export async function listAiTasks(projectId: string, options: { status?: string[]; limit?: number } = {}): Promise<TaskDto[]> {
  const rows = await db.aiTask.findMany({
    where: { projectId, ...(options.status ? { status: { in: options.status } } : {}) },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 50,
  });
  return rows.map(taskDto);
}

export async function listPendingTasks(projectId?: string): Promise<TaskDto[]> {
  const rows = await db.aiTask.findMany({ where: { status: { in: ["pending", "running"] }, ...(projectId ? { projectId } : {}) }, orderBy: { createdAt: "asc" } });
  return rows.map(taskDto);
}

export async function getAiTask(taskId: string): Promise<AiTask> {
  const task = await db.aiTask.findUnique({ where: { id: taskId } });
  if (!task) throw notFound(`AI task ${taskId}`);
  return task;
}

const MAX_LOG = 400;

export async function appendTaskLog(taskId: string, text: string): Promise<void> {
  const task = await getAiTask(taskId);
  const log = ((task.log ?? []) as { at: string; text: string }[]).concat({ at: new Date().toISOString(), text: text.slice(0, 2000) }).slice(-MAX_LOG);
  await db.aiTask.update({ where: { id: taskId }, data: { log: json(log) } });
  await db.project.update({ where: { id: task.projectId }, data: { revision: { increment: 1 } } });
}

export async function startAiTask(taskId: string, actor: Actor, executor: "manual" | "headless" = "manual"): Promise<TaskDto> {
  const task = await getAiTask(taskId);
  if (task.status === "running") return taskDto(task);
  if (task.status !== "pending") throw new AppError("CONFLICT", `Task ${taskId} is already ${task.status}.`);
  const row = await mutateProject(task.projectId, actor, async (tx) => {
    const updated = await tx.aiTask.update({ where: { id: taskId }, data: { status: "running", claimedAt: new Date(), executor } });
    return { result: updated, activity: { type: "task.started", message: `Claude started “${task.title}”` } };
  });
  return taskDto(row);
}

export async function completeAiTask(taskId: string, summary: string, actor: Actor): Promise<TaskDto> {
  const task = await getAiTask(taskId);
  if (task.status === "completed") return taskDto(task);
  if (task.status === "cancelled") throw new AppError("CONFLICT", `Task ${taskId} was cancelled.`);
  const row = await mutateProject(task.projectId, actor, async (tx) => {
    const updated = await tx.aiTask.update({ where: { id: taskId }, data: { status: "completed", resultSummary: summary.slice(0, 8000), completedAt: new Date() } });
    return { result: updated, activity: { type: "task.completed", message: `Claude completed “${task.title}”: ${summary.slice(0, 240)}` } };
  });
  return taskDto(row);
}

export async function failAiTask(taskId: string, error: string, actor: Actor): Promise<TaskDto> {
  const task = await getAiTask(taskId);
  const row = await mutateProject(task.projectId, actor, async (tx) => {
    const updated = await tx.aiTask.update({ where: { id: taskId }, data: { status: "failed", error: error.slice(0, 8000), completedAt: new Date() } });
    return { result: updated, activity: { type: "task.failed", message: `Task “${task.title}” failed: ${error.slice(0, 240)}` } };
  });
  return taskDto(row);
}

export async function cancelAiTask(taskId: string, actor: Actor): Promise<TaskDto> {
  const task = await getAiTask(taskId);
  if (!["pending", "running"].includes(task.status)) throw new AppError("CONFLICT", `Task is already ${task.status}.`);
  const job = await db.job.findFirst({ where: { type: "ai.headless", status: { in: ["queued", "running"] }, payload: { path: ["taskId"], equals: taskId } } });
  if (job) await requestCancel(job.id).catch(() => undefined);
  const row = await mutateProject(task.projectId, actor, async (tx) => {
    const updated = await tx.aiTask.update({ where: { id: taskId }, data: { status: "cancelled", completedAt: new Date() } });
    return { result: updated, activity: { type: "task.cancelled", message: `Cancelled task “${task.title}”` } };
  });
  return taskDto(row);
}

export async function retryAiTask(taskId: string, actor: Actor): Promise<TaskDto> {
  const task = await getAiTask(taskId);
  const scope = (task.scope ?? {}) as StoredScope;
  return createAiTask(
    task.projectId,
    { type: task.type as AiTaskType, instruction: task.instruction, title: task.title, scope: { sceneIds: scope.sceneIds, keepTiming: scope.keepTiming ?? true, keepVoice: scope.keepVoice ?? true, section: scope.section, count: scope.count, reviewId: scope.reviewId, issueIds: scope.issueIds } },
    actor,
  );
}
