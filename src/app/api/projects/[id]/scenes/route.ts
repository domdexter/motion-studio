import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { listScenes } from "@/server/services/scenes";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => ({ scenes: await listScenes(assertProjectId(id)) }));
