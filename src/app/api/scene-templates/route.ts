import { api } from "@/server/http/api";
import { listSceneTemplates } from "@/server/services/scene-templates";

export const dynamic = "force-dynamic";

/** Built-in and saved scene templates. */
export const GET = api(async () => ({ templates: await listSceneTemplates() }));
