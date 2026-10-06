import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { api, readJson } from "@/server/http/api";
import { SettingsSchema, getSettings, secretStatus, updateSettings } from "@/server/services/settings";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  return { settings: getSettings(), secrets: { elevenlabsApiKey: secretStatus("elevenlabsApiKey") } };
});

export const PATCH = api(async (req) => {
  const patch = await readJson(req, z.record(z.string(), z.unknown()));
  // Validate directories before persisting them.
  const storage = patch.storage as { projectsDir?: string | null } | undefined;
  if (storage?.projectsDir) {
    const dir = path.resolve(storage.projectsDir);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new AppError("VALIDATION", `Projects directory does not exist: ${dir}`);
    storage.projectsDir = dir;
  }
  const render = patch.render as { outputDir?: string | null } | undefined;
  if (render?.outputDir) {
    const dir = path.resolve(render.outputDir);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new AppError("VALIDATION", `Output directory does not exist: ${dir}`);
    render.outputDir = dir;
  }
  const merged = SettingsSchema.partial().safeParse(patch);
  if (!merged.success) throw new AppError("VALIDATION", "Invalid settings.", { details: merged.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  return { settings: updateSettings(patch as never), secrets: { elevenlabsApiKey: secretStatus("elevenlabsApiKey") } };
});
