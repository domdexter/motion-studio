import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { updateBrand } from "@/server/services/brand";

export const PATCH = api<{ id: string }>(async (req, { id }) => {
  const body = await readJson(req, z.record(z.string(), z.unknown()));
  return { brand: await updateBrand(assertProjectId(id), body as never, "user") };
});
