import { z } from "zod";
import { AppError } from "@/server/errors";
import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { cancelAiTask, getAiTask, retryAiTask, taskDto } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string; taskId: string }>(async (_req, { id, taskId }) => {
  const task = await getAiTask(assertId(taskId, "task id"));
  if (task.projectId !== assertProjectId(id)) throw new AppError("NOT_FOUND", "Task not found.");
  return { task: taskDto(task) };
});

export const PATCH = api<{ id: string; taskId: string }>(async (req, { id, taskId }) => {
  const { action } = await readJson(req, z.object({ action: z.enum(["cancel", "retry"]) }));
  const task = await getAiTask(assertId(taskId, "task id"));
  if (task.projectId !== assertProjectId(id)) throw new AppError("NOT_FOUND", "Task not found.");
  return { task: action === "cancel" ? await cancelAiTask(task.id, "user") : await retryAiTask(task.id, "user") };
});
