import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { approveAllScenes } from "@/server/services/scenes";

export const POST = api<{ id: string }>(async (_req, { id }) => ({ result: await approveAllScenes(assertProjectId(id), "user") }));
