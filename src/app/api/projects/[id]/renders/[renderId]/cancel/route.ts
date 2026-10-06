import { api } from "@/server/http/api";
import { cancelRender } from "@/server/services/renders";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string; renderId: string }>(async (_req, { id, renderId }) => ({ render: await cancelRender(id, renderId, "user") }));
