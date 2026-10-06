import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { deleteProject, getProjectDetail, updateProject } from "@/server/services/projects";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => {
  return { project: await getProjectDetail(assertProjectId(id)) };
});

export const PATCH = api<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, z.record(z.string(), z.unknown()));
  return { project: await updateProject(assertProjectId(id), body as never, "user") };
});

export const DELETE = api<{ id: string }>(async (_req, { id }) => {
  await deleteProject(assertProjectId(id));
  return { ok: true };
});
