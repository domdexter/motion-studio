import { api } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { listSceneVersions } from "@/server/services/scenes";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string; sceneId: string }>(async (_req, { id, sceneId }) => ({
  versions: await listSceneVersions(assertProjectId(id), assertId(sceneId, "scene id")),
}));
