import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AssetKind } from "@/core/spec/enums";
import { EMPTY_SCENE_SPEC, validateSceneSpec, type SceneElement, type SceneSpec } from "@/core/spec/scene";
import { BUILTIN_TEMPLATES, endScreenSpec, lowerThirdElements, titleCardSpec } from "@/core/templates/builtin";
import type { SceneTemplate } from "@/generated/prisma/client";
import { db, json } from "../db";
import { STORAGE_DIR } from "../env";
import { AppError, notFound } from "../errors";
import { newId } from "../ids";
import { projectFile, resolveInside, safeFileName } from "../storage/paths";
import { importAsset } from "./assets";
import type { Actor } from "./mutation";
import { findScene, updateScene, type SceneDto } from "./scenes";

/**
 * Scene templates: built-in designs (title card, end screen, lower third) and scenes or elements the
 * user saved for reuse. A saved template keeps copies of the images and videos it uses, so it can be
 * applied to any project; applying imports them (reusing identical files) and points the spec at them.
 */

export const SCENE_TEMPLATES_DIR = path.join(STORAGE_DIR, "scene-templates");
const TEMPLATE_ID_RE = /^tpl_[a-z0-9]{10}$/;

interface TemplateFile {
  assetId: string;
  kind: string;
  name: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  contentHash: string;
}

export interface SceneTemplateDto {
  id: string;
  name: string;
  description: string;
  kind: "scene" | "elements";
  builtin: boolean;
  /** Text the template asks for (built-in templates). */
  fields: { key: string; label: string; placeholder: string }[];
  elementCount: number;
  fileCount: number;
  sourceSceneKey: string | null;
  createdAt: string | null;
}

export const SaveSceneTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).optional(),
  /** Save only these top-level elements (e.g. a lower third) instead of the whole scene. */
  elementIds: z.array(z.string().min(1).max(64)).max(100).optional(),
});

export const ApplySceneTemplateSchema = z.object({
  templateId: z.string().min(1).max(80),
  fields: z.record(z.string(), z.string().max(200)).optional(),
  /** Element templates: seconds into the scene they appear (lower third). */
  atSec: z.number().min(0).max(3600).optional(),
  durationSec: z.number().min(1).max(600).optional(),
  side: z.enum(["left", "right"]).optional(),
});

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  return value;
}

function templateDir(id: string): string {
  if (!TEMPLATE_ID_RE.test(id)) throw new AppError("BAD_REQUEST", "Invalid template id.");
  return path.join(SCENE_TEMPLATES_DIR, id);
}

function elementsOf(row: SceneTemplate): unknown[] {
  const spec = row.spec as { elements?: unknown[] } | null;
  return Array.isArray(spec?.elements) ? spec.elements : [];
}

function templateDto(row: SceneTemplate): SceneTemplateDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind === "elements" ? "elements" : "scene",
    builtin: false,
    fields: [],
    elementCount: elementsOf(row).length,
    fileCount: Array.isArray(row.files) ? row.files.length : 0,
    sourceSceneKey: row.sourceSceneKey,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSceneTemplates(): Promise<SceneTemplateDto[]> {
  const rows = await db.sceneTemplate.findMany({ orderBy: { createdAt: "desc" } });
  const builtins: SceneTemplateDto[] = BUILTIN_TEMPLATES.map((t) => ({ ...t, builtin: true, elementCount: 0, fileCount: 0, sourceSceneKey: null, createdAt: null }));
  return [...builtins, ...rows.map(templateDto)];
}

export async function saveSceneTemplate(projectId: string, sceneIdOrKey: string, input: z.input<typeof SaveSceneTemplateSchema>, _actor: Actor): Promise<SceneTemplateDto> {
  const data = SaveSceneTemplateSchema.parse(input);
  const scene = await findScene(db, projectId, sceneIdOrKey);
  const valid = validateSceneSpec(scene.spec ?? EMPTY_SCENE_SPEC);
  if (!valid.ok) throw new AppError("VALIDATION", `The scene spec for ${scene.key} is invalid, so it can't be saved as a template.`, { details: valid.issues });
  let kind: "scene" | "elements" = "scene";
  let stored: unknown = valid.spec;
  if (data.elementIds?.length) {
    const wanted = new Set(data.elementIds);
    const elements = valid.spec.elements.filter((e) => e.id && wanted.has(e.id));
    if (!elements.length) throw new AppError("VALIDATION", `None of those elements are in ${scene.key}.`, { hint: "Pass the ids of top-level elements (scene:show lists them)." });
    kind = "elements";
    stored = { elements };
  }
  if (kind === "scene" && !valid.spec.elements.length && !valid.spec.shots?.length) throw new AppError("VALIDATION", `${scene.key} has no elements to save.`);

  // Images and videos the template uses travel with it.
  const assets = await db.asset.findMany({ where: { projectId }, select: { id: true, kind: true, name: true, fileName: true, filePath: true, mimeType: true, contentHash: true } });
  const byId = new Map(assets.map((a) => [a.id, a]));
  const used = new Set<string>();
  mapStrings(stored, (s) => {
    if (byId.has(s)) used.add(s);
    return s;
  });

  const id = newId.sceneTemplate();
  const dir = templateDir(id);
  const files: TemplateFile[] = [];
  try {
    if (used.size) await fs.mkdir(dir, { recursive: true });
    for (const assetId of used) {
      const a = byId.get(assetId)!;
      const fileName = `${files.length + 1}-${safeFileName(a.fileName)}`;
      await fs.copyFile(projectFile(projectId, a.filePath), path.join(dir, fileName));
      files.push({ assetId, kind: a.kind, name: a.name, fileName: a.fileName, filePath: fileName, mimeType: a.mimeType, contentHash: a.contentHash });
    }
    const row = await db.sceneTemplate.create({
      data: { id, name: data.name, description: data.description ?? "", kind, spec: json(stored), files: json(files), sourceProjectId: projectId, sourceSceneKey: scene.key },
    });
    return templateDto(row);
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}

export async function deleteSceneTemplate(templateId: string): Promise<void> {
  if (templateId.startsWith("builtin:")) throw new AppError("VALIDATION", "Built-in templates can't be deleted.");
  const dir = templateDir(templateId);
  const row = await db.sceneTemplate.findUnique({ where: { id: templateId } });
  if (!row) throw notFound("Template");
  await db.sceneTemplate.delete({ where: { id: templateId } });
  await fs.rm(dir, { recursive: true, force: true });
}

/** Element ids that don't clash with the scene's own. */
function withUniqueIds(elements: SceneElement[], taken: Set<string>): SceneElement[] {
  return elements.map((el) => {
    if (!el.id) return el;
    let id = el.id;
    for (let n = 2; taken.has(id); n++) id = `${el.id}_${n}`.slice(0, 64);
    taken.add(id);
    return { ...el, id };
  });
}

export async function applySceneTemplate(projectId: string, sceneIdOrKey: string, input: z.input<typeof ApplySceneTemplateSchema>, actor: Actor): Promise<SceneDto> {
  const data = ApplySceneTemplateSchema.parse(input);
  const scene = await findScene(db, projectId, sceneIdOrKey);
  if (scene.locked) throw new AppError("LOCKED", `${scene.key} is locked.`, { hint: "Unlock the scene first." });
  const parsed = validateSceneSpec(scene.spec ?? EMPTY_SCENE_SPEC);
  const current = parsed.ok ? parsed.spec : null;
  const fields = data.fields ?? {};
  const taken = new Set((current?.elements ?? []).flatMap((e) => (e.id ? [e.id] : [])));
  const addElements = (elements: SceneElement[]): SceneSpec => {
    if (!current) throw new AppError("VALIDATION", `The scene spec for ${scene.key} is invalid, so elements can't be added to it.`);
    return { ...current, elements: [...current.elements, ...withUniqueIds(elements, taken)] };
  };
  // Whole-scene templates keep the scene's background.
  const keepBackground = (spec: SceneSpec): SceneSpec => (current?.background && !spec.background ? { ...spec, background: current.background } : spec);

  let next: SceneSpec;
  let name: string;
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === data.templateId);
  if (builtin) {
    name = builtin.name;
    if (builtin.id === "builtin:title-card") next = keepBackground(titleCardSpec(fields));
    else if (builtin.id === "builtin:end-screen") next = keepBackground(endScreenSpec(fields));
    else {
      let prefix = "lt";
      for (let n = 2; taken.has(`${prefix}_panel`); n++) prefix = `lt${n}`;
      next = addElements(lowerThirdElements({ name: fields.name, title: fields.title, atSec: data.atSec, durationSec: data.durationSec, side: data.side, idPrefix: prefix }));
    }
  } else {
    const dir = templateDir(data.templateId);
    const row = await db.sceneTemplate.findUnique({ where: { id: data.templateId } });
    if (!row) throw notFound("Template");
    name = row.name;
    const files = (Array.isArray(row.files) ? row.files : []) as unknown as TemplateFile[];
    const existing = await db.asset.findMany({ where: { projectId }, select: { id: true, contentHash: true } });
    const idMap = new Map<string, string>();
    for (const f of files) {
      const match = existing.find((a) => a.contentHash === f.contentHash);
      if (match) {
        idMap.set(f.assetId, match.id);
        continue;
      }
      const asset = await importAsset(
        projectId,
        { sourcePath: resolveInside(dir, f.filePath), originalName: f.fileName, kind: f.kind as AssetKind, source: "import", name: f.name, tags: ["scene-template"], move: false },
        actor,
      );
      existing.push({ id: asset.id, contentHash: asset.contentHash });
      idMap.set(f.assetId, asset.id);
    }
    const stored = mapStrings(row.spec, (s) => idMap.get(s) ?? s);
    if (row.kind === "elements") next = addElements(((stored as { elements?: SceneElement[] }).elements ?? []) as SceneElement[]);
    else next = stored as SceneSpec;
  }
  return updateScene(projectId, scene.id, { spec: next }, actor, { message: `Applied template “${name}”`, historyLabel: `apply ${name} to ${scene.key}` });
}
