import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { buildComposition } from "@/server/services/composition";

export const dynamic = "force-dynamic";

/** The exact Remotion input (StudioVideoProps) the preview player and renderer consume. */
export const GET = api<{ id: string }>(async (_req, { id }) => {
  assertProjectId(id);
  return buildComposition(id);
});
