import { api } from "@/server/http/api";
import { deleteSceneTemplate } from "@/server/services/scene-templates";

/** Deletes a saved template. Scenes that used it keep their design. */
export const DELETE = api<{ templateId: string }>(async (_req, { templateId }) => {
  await deleteSceneTemplate(templateId);
  return { ok: true };
});
