import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { CreateTaskSchema, createAiTask, listAiTasks } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, { id }) => {
  const status = req.nextUrl.searchParams.get("status")?.split(",").filter(Boolean);
  return { tasks: await listAiTasks(assertProjectId(id), { status, limit: 100 }) };
});

/** Creates an explicit AI task for Claude Code (manual hand-off or headless run per Settings). */
export const POST = api<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, CreateTaskSchema);
  return { task: await createAiTask(assertProjectId(id), body, "user") };
});
