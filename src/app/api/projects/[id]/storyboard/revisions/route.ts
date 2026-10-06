import { db } from "@/server/db";
import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => {
  const rows = await db.storyboardRevision.findMany({ where: { projectId: assertProjectId(id) }, orderBy: { version: "desc" }, take: 100 });
  return {
    revisions: rows.map((r) => ({ id: r.id, version: r.version, source: r.source, note: r.note, scenes: Array.isArray(r.scenes) ? r.scenes.length : 0, createdAt: r.createdAt.toISOString() })),
  };
});
