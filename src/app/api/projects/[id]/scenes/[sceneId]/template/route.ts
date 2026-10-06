import { api, readJson } from "@/server/http/api";
import { assertId, assertProjectId } from "@/server/ids";
import { ApplySceneTemplateSchema, SaveSceneTemplateSchema, applySceneTemplate, saveSceneTemplate } from "@/server/services/scene-templates";

/** Save this scene (or some of its elements) as a template. */
export const POST = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const body = await readJson(req, SaveSceneTemplateSchema);
  return { template: await saveSceneTemplate(assertProjectId(id), assertId(sceneId, "scene id"), body, "user") };
});

/** Apply a template to this scene: replace its design, or add a template's elements. */
export const PUT = api<{ id: string; sceneId: string }>(async (req, { id, sceneId }) => {
  const body = await readJson(req, ApplySceneTemplateSchema);
  return { scene: await applySceneTemplate(assertProjectId(id), assertId(sceneId, "scene id"), body, "user") };
});
