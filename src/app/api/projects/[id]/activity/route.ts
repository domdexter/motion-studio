import { db } from "@/server/db";
import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50)));
  const activities = await db.activity.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: limit });
  return {
    activities: activities.map((a) => ({ id: a.id, actor: a.actor, type: a.type, message: a.message, data: a.data, createdAt: a.createdAt.toISOString() })),
  };
});
