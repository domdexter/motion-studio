import { api } from "@/server/http/api";
import { retryRender } from "@/server/services/renders";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string; renderId: string }>(async (_req, { id, renderId }) => retryRender(id, renderId, "user"));
