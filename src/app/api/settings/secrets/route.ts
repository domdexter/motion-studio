import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { SECRET_NAMES, secretStatus, setSecret } from "@/server/services/settings";

const SecretBody = z.object({ name: z.enum(SECRET_NAMES), value: z.string().trim().min(8).max(512) });
const SecretName = z.object({ name: z.enum(SECRET_NAMES) });

/** Stores a secret server-side. The response only ever contains its status (never the value). */
export const PUT = api(async (req) => {
  const { name, value } = await readJson(req, SecretBody);
  setSecret(name, value);
  return { status: secretStatus(name) };
});

export const DELETE = api(async (req) => {
  const { name } = await readJson(req, SecretName);
  setSecret(name, null);
  return { status: secretStatus(name) };
});
