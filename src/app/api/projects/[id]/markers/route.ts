import { z } from "zod";
import { MarkersSchema } from "@/core/spec/markers";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { setMarkers } from "@/server/services/markers";

export const dynamic = "force-dynamic";

export const PUT = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const { markers } = await readJson(req, z.object({ markers: MarkersSchema }));
  return { markers: await setMarkers(id, markers, "user") };
});
