import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { applyBrandKitToProject } from "@/server/services/brand-kits";
import { countProjects, createProject, getProjectDetail, listProjects } from "@/server/services/projects";

export const dynamic = "force-dynamic";

export const GET = api(async (req) => {
  const sp = req.nextUrl.searchParams;
  const [projects, counts] = await Promise.all([
    listProjects({
      search: sp.get("search") ?? undefined,
      sort: (sp.get("sort") as "updated" | "created" | "name" | null) ?? undefined,
      filter: (sp.get("filter") as "active" | "archived" | "all" | null) ?? undefined,
      status: sp.get("status") ?? undefined,
    }),
    countProjects(),
  ]);
  return { projects, counts };
});

/** Creates a project. With `brandKitId` the project starts from (and follows) that brand kit. */
export const POST = api(async (req) => {
  const body = await readJson(req, z.record(z.string(), z.unknown()));
  const brandKitId = typeof body.brandKitId === "string" && body.brandKitId ? body.brandKitId : null;
  const project = await createProject(body as never, "user");
  if (!brandKitId) return { project };
  try {
    await applyBrandKitToProject(project.id, brandKitId, "user");
    return { project: await getProjectDetail(project.id) };
  } catch (err) {
    // The project exists either way — report the kit problem instead of failing the creation.
    return { project, warning: `The project was created, but the brand kit could not be applied: ${err instanceof Error ? err.message : String(err)}` };
  }
});
