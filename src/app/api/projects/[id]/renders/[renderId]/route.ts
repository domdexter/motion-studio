import { api } from "@/server/http/api";
import { deleteRender, getRender } from "@/server/services/renders";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string; renderId: string }>(async (_req, { id, renderId }) => ({ render: await getRender(id, renderId) }));

export const DELETE = api<{ id: string; renderId: string }>(async (_req, { id, renderId }) => {
  await deleteRender(id, renderId, "user");
  return { ok: true };
});
