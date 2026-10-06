import { db } from "@/server/db";
import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { UpdateSceneSchema, findScene, sceneDto, updateScene } from "@/server/services/scenes";
import { getProjectState } from "@/server/services/state";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string; sceneId: string }>(async (_req, { id, sceneId }) => {
  assertProjectId(id);
  const scene = await findScene(db, id, assertId(sceneId, "scene id"));
  const state = await getProjectState(id);
  return { scene: sceneDto(scene, state.scenes[scene.id]) };
});

/** Creative/spec edits. Timing is never changed here. Editing an approved scene resets approval. */
export const PATCH = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const body = await readJson(req, UpdateSceneSchema);
  return { scene: await updateScene(assertProjectId(id), assertId(sceneId, "scene id"), body, "user") };
});
