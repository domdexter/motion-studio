import { z } from "zod";
import { Prisma, type Scene } from "@/generated/prisma/client";
import { SceneCreativeSchema } from "@/core/creative/schema";
import { AssetRequirementSchema, VisualTypeSchema } from "@/core/spec/enums";
import { SCENE_KEY_RE, ScenesFileSchema, StoryboardFileSchema, specPartOfScenesEntry } from "@/core/spec/project-files";
import { SceneSpecSchema, type SceneSpec } from "@/core/spec/scene";
import type { TimedWord, TimelineData } from "@/core/spec/timing";
import { boundariesFromAnchors } from "@/core/timeline/scenes";
import { fingerprint, stableStringify } from "@/core/util/hash";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { mutateProject, type Actor } from "./mutation";
import { recordSceneVersion, recordStoryboardRevision } from "./scene-history";
import { sceneKey } from "./scenes";
import { createSnapshot } from "./snapshots";

/**
 * Applies storyboard / scene-spec documents written by Claude Code (CLI or .project file edits).
 * Guarantees: validation is atomic (nothing is applied if any scene is invalid), locked scenes
 * are never changed, timing fields are ignored unless the document explicitly restructures the
 * storyboard, and every applied change is versioned and attributed.
 */

export interface ApplyReport {
  applied: string[];
  unchanged: string[];
  skippedLocked: string[];
  conflicts: string[];
  warnings: string[];
  errors: { scene: string; path: string; message: string }[];
}

const emptyReport = (): ApplyReport => ({ applied: [], unchanged: [], skippedLocked: [], conflicts: [], warnings: [], errors: [] });

const CREATIVE_FIELDS = ["name", "visualConcept", "visualType", "animationNotes", "onScreenText", "assetsRequired", "notes", "creative"] as const;
type CreativeField = (typeof CREATIVE_FIELDS)[number];

interface ScenePatch {
  scene: Scene;
  data: Partial<Record<CreativeField | "spec", unknown>>;
}

const same = (a: unknown, b: unknown) => stableStringify(a ?? null) === stableStringify(b ?? null);

function matchScene(scenes: Scene[], uid: string | undefined, key: string): Scene | undefined {
  return (uid ? scenes.find((s) => s.id === uid) : undefined) ?? scenes.find((s) => s.key === key);
}

async function commitPatches(projectId: string, patches: ScenePatch[], actor: Actor, note: string, report: ApplyReport): Promise<ApplyReport> {
  if (!patches.length) return report;
  const source = actor === "claude" ? "claude" : actor === "file" ? "file" : "user";
  await mutateProject(projectId, actor, async (tx) => {
    for (const p of patches) {
      const fields = Object.keys(p.data);
      const updated = await tx.scene.update({
        where: { id: p.scene.id },
        data: {
          ...(p.data.name !== undefined ? { name: String(p.data.name) } : {}),
          ...(p.data.visualConcept !== undefined ? { visualConcept: String(p.data.visualConcept) } : {}),
          ...(p.data.visualType !== undefined ? { visualType: String(p.data.visualType) } : {}),
          ...(p.data.animationNotes !== undefined ? { animationNotes: json(p.data.animationNotes) } : {}),
          ...(p.data.onScreenText !== undefined ? { onScreenText: String(p.data.onScreenText) } : {}),
          ...(p.data.assetsRequired !== undefined ? { assetsRequired: json(p.data.assetsRequired) } : {}),
          ...(p.data.notes !== undefined ? { notes: String(p.data.notes) } : {}),
          ...(p.data.creative !== undefined ? { creative: p.data.creative === null ? Prisma.DbNull : json(p.data.creative) } : {}),
          ...(p.data.spec !== undefined ? { spec: json(p.data.spec) } : {}),
          // Intent-only changes don't alter what renders (or the approval fingerprint): approval is kept.
          ...(fields.every((f) => f === "creative") ? {} : { status: "draft", approvedAt: null, approvedFingerprint: null }),
          version: { increment: 1 },
          source,
        },
      });
      await recordSceneVersion(tx, updated, source, `${note} (${fields.join(", ")})`);
      report.applied.push(p.scene.key);
    }
    await recordStoryboardRevision(tx, projectId, source, `${note}: ${patches.map((p) => p.scene.key).join(", ")}`);
    return {
      result: null,
      activity: {
        type: "storyboard.applied",
        message: `${note}: updated ${patches.map((p) => p.scene.key).join(", ")}${report.skippedLocked.length ? ` · locked, not changed: ${report.skippedLocked.join(", ")}` : ""}`,
      },
    };
  });
  return report;
}

// ---------------------------------------------------------------------------------------
// storyboard.json (creative intent)
// ---------------------------------------------------------------------------------------

export async function applyStoryboardFile(projectId: string, input: unknown, actor: Actor, options: { base?: unknown; onlyKeys?: string[] } = {}): Promise<ApplyReport> {
  const report = emptyReport();
  const parsed = StoryboardFileSchema.safeParse(input);
  if (!parsed.success) {
    report.errors = parsed.error.issues.map((i) => ({ scene: "file", path: i.path.join("."), message: i.message }));
    return report;
  }
  const baseParsed = options.base ? StoryboardFileSchema.safeParse(options.base) : null;
  const scenes = await db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const patches: ScenePatch[] = [];
  for (const entry of parsed.data.scenes) {
    if (options.onlyKeys && !options.onlyKeys.includes(entry.sceneId)) continue;
    const scene = matchScene(scenes, entry.uid, entry.sceneId);
    if (!scene) {
      report.warnings.push(`${entry.sceneId}: no such scene — scenes are created by the storyboard, not by editing this file.`);
      continue;
    }
    const baseEntry = baseParsed?.success ? baseParsed.data.scenes.find((b) => (entry.uid && b.uid === entry.uid) || b.sceneId === entry.sceneId) : undefined;
    const candidate: Partial<Record<CreativeField, unknown>> = {
      name: entry.name,
      visualConcept: entry.visualConcept,
      visualType: entry.visualType,
      animationNotes: entry.animation,
      onScreenText: entry.onScreenText,
      assetsRequired: entry.assetsRequired,
      notes: entry.notes,
      creative: entry.creative,
    };
    const fileToBase: Record<CreativeField, string> = { name: "name", visualConcept: "visualConcept", visualType: "visualType", animationNotes: "animation", onScreenText: "onScreenText", assetsRequired: "assetsRequired", notes: "notes", creative: "creative" };
    const data: ScenePatch["data"] = {};
    for (const field of CREATIVE_FIELDS) {
      const value = candidate[field];
      if (value === undefined || same(value, scene[field])) continue;
      if (baseEntry) {
        const baseValue = (baseEntry as Record<string, unknown>)[fileToBase[field]];
        if (same(value, baseValue)) continue; // not edited in the file — DB wins
        if (!same(scene[field], baseValue)) {
          report.conflicts.push(`${scene.key}.${field}: changed in the GUI and in the file — kept the GUI version`);
          continue;
        }
      }
      data[field] = value;
    }
    const e = entry as Record<string, unknown>;
    if ((typeof e.start === "number" && Math.abs(e.start - scene.startSec) > 0.001) || (typeof e.end === "number" && Math.abs(e.end - scene.endSec) > 0.001)) {
      report.warnings.push(`${scene.key}: start/end are read-only in storyboard.json (timing comes from the audio). Use \`npm run studio -- scene:timing\` if a timing change was requested.`);
    }
    if (!Object.keys(data).length) {
      report.unchanged.push(scene.key);
      continue;
    }
    if (scene.locked) {
      report.skippedLocked.push(scene.key);
      continue;
    }
    patches.push({ scene, data });
  }
  return commitPatches(projectId, patches, actor, "Storyboard updated", report);
}

// ---------------------------------------------------------------------------------------
// scenes.json (scene specs)
// ---------------------------------------------------------------------------------------

export async function applyScenesFile(projectId: string, input: unknown, actor: Actor, options: { base?: unknown; onlyKeys?: string[] } = {}): Promise<ApplyReport> {
  const report = emptyReport();
  const parsed = ScenesFileSchema.safeParse(input);
  if (!parsed.success) {
    report.errors = parsed.error.issues.map((i) => ({ scene: "file", path: i.path.join("."), message: i.message }));
    return report;
  }
  const baseParsed = options.base ? ScenesFileSchema.safeParse(options.base) : null;
  const scenes = await db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const patches: ScenePatch[] = [];
  for (const entry of parsed.data.scenes) {
    if (options.onlyKeys && !options.onlyKeys.includes(entry.id)) continue;
    const scene = matchScene(scenes, entry.uid, entry.id);
    if (!scene) {
      report.warnings.push(`${entry.id}: no such scene.`);
      continue;
    }
    const specResult = SceneSpecSchema.safeParse(specPartOfScenesEntry(entry));
    if (!specResult.success) {
      for (const issue of specResult.error.issues) report.errors.push({ scene: scene.key, path: issue.path.join("."), message: issue.message });
      continue;
    }
    const spec = specResult.data;
    if (same(spec, scene.spec)) {
      report.unchanged.push(scene.key);
      continue;
    }
    if (baseParsed?.success) {
      const baseEntry = baseParsed.data.scenes.find((b) => (entry.uid && b.uid === entry.uid) || b.id === entry.id);
      if (baseEntry) {
        const baseSpec = SceneSpecSchema.safeParse(specPartOfScenesEntry(baseEntry));
        if (baseSpec.success && same(spec, baseSpec.data)) {
          report.unchanged.push(scene.key);
          continue;
        }
        if (baseSpec.success && !same(scene.spec, baseSpec.data)) {
          report.conflicts.push(`${scene.key}: spec changed in the GUI and in the file — kept the GUI version`);
          continue;
        }
      }
    }
    if ((typeof entry.start === "number" && Math.abs(Number(entry.start) - scene.startSec) > 0.001) || (typeof entry.end === "number" && Math.abs(Number(entry.end) - scene.endSec) > 0.001)) {
      report.warnings.push(`${scene.key}: start/end in scenes.json are read-only and were ignored.`);
    }
    if (scene.locked) {
      report.skippedLocked.push(scene.key);
      continue;
    }
    patches.push({ scene, data: { spec } });
  }
  if (report.errors.length) return report; // atomic: nothing applied when any spec is invalid
  return commitPatches(projectId, patches, actor, "Scene specs updated", report);
}

// ---------------------------------------------------------------------------------------
// Storyboard documents from Claude (creative intent + spec per scene, optional restructure)
// ---------------------------------------------------------------------------------------

export const StoryboardDocumentSceneSchema = z.object({
  sceneId: z.string().regex(SCENE_KEY_RE).optional(),
  name: z.string().trim().min(1).max(120),
  /** Word anchor [wordStart, wordEnd) into timeline.json words — required when restructuring. */
  wordStart: z.number().int().nonnegative().optional(),
  wordEnd: z.number().int().positive().optional(),
  visualConcept: z.string().max(4000),
  visualType: VisualTypeSchema,
  animation: z.array(z.string().max(500)).max(30).default([]),
  onScreenText: z.string().max(600).default(""),
  assetsRequired: z.array(AssetRequirementSchema).max(20).default([]),
  notes: z.string().max(8000).default(""),
  /** Creative intent: purpose, beat, metaphor, treatment, composition, motion, shots (CREATIVE_SYSTEM.md). */
  creative: SceneCreativeSchema.optional(),
  spec: SceneSpecSchema,
});

export const StoryboardDocumentSchema = z.object({
  /** "update": change existing scenes (timing kept). "replace": new scene structure from word anchors. */
  mode: z.enum(["update", "replace"]).default("update"),
  note: z.string().max(500).optional(),
  scenes: z.array(StoryboardDocumentSceneSchema).min(1).max(500),
});
export type StoryboardDocument = z.infer<typeof StoryboardDocumentSchema>;

export async function applyStoryboardDocument(projectId: string, input: unknown, actor: Actor, options: { onlyKeys?: string[] } = {}): Promise<ApplyReport> {
  const report = emptyReport();
  const parsed = StoryboardDocumentSchema.safeParse(input);
  if (!parsed.success) {
    report.errors = parsed.error.issues.map((i) => ({ scene: `scenes.${String(i.path[1] ?? "?")}`, path: i.path.map(String).join("."), message: i.message }));
    return report;
  }
  const doc = parsed.data;
  const source = actor === "claude" ? "claude" : actor === "file" ? "file" : "user";

  if (doc.mode === "update") {
    const scenes = await db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
    const patches: ScenePatch[] = [];
    for (const entry of doc.scenes) {
      if (!entry.sceneId) {
        report.errors.push({ scene: entry.name, path: "sceneId", message: 'sceneId is required in "update" mode' });
        continue;
      }
      if (options.onlyKeys && !options.onlyKeys.includes(entry.sceneId)) continue;
      const scene = scenes.find((s) => s.key === entry.sceneId);
      if (!scene) {
        report.errors.push({ scene: entry.sceneId, path: "sceneId", message: "No such scene" });
        continue;
      }
      if (scene.locked) {
        report.skippedLocked.push(scene.key);
        continue;
      }
      const data: ScenePatch["data"] = {};
      const candidate: Record<string, unknown> = { name: entry.name, visualConcept: entry.visualConcept, visualType: entry.visualType, animationNotes: entry.animation, onScreenText: entry.onScreenText, assetsRequired: entry.assetsRequired, notes: entry.notes, spec: entry.spec };
      if (entry.creative !== undefined) candidate.creative = entry.creative;
      for (const [k, v] of Object.entries(candidate)) {
        if (!same(v, scene[k as keyof Scene])) data[k as CreativeField | "spec"] = v;
      }
      if (typeof entry.wordStart === "number" || typeof entry.wordEnd === "number") {
        if (entry.wordStart !== scene.wordStart || entry.wordEnd !== scene.wordEnd) report.warnings.push(`${scene.key}: word anchors ignored in update mode (timing kept).`);
      }
      if (!Object.keys(data).length) report.unchanged.push(scene.key);
      else patches.push({ scene, data });
    }
    if (report.errors.length) return report;
    return commitPatches(projectId, patches, actor, doc.note ?? "Storyboard applied", report);
  }

  // replace mode — new structure anchored to words of the active timeline
  const project = await db.project.findUnique({ where: { id: projectId }, include: { activeTimeline: true } });
  if (!project?.activeTimeline) throw new AppError("PRECONDITION", "Generate or import a voice-over before generating an audio-locked storyboard.");
  const transcript = project.activeTimeline.transcriptId ? await db.transcript.findUnique({ where: { id: project.activeTimeline.transcriptId } }) : null;
  const words = (transcript?.words ?? []) as TimedWord[];
  const timeline = project.activeTimeline.data as TimelineData;
  const existing = await db.scene.findMany({ where: { projectId } });
  const locked = existing.filter((s) => s.locked);
  if (locked.length) throw new AppError("LOCKED", `Can't replace the storyboard while ${locked.map((s) => s.key).join(", ")} ${locked.length === 1 ? "is" : "are"} locked. Use "update" mode.`);
  let expected = 0;
  doc.scenes.forEach((s, i) => {
    if (typeof s.wordStart !== "number" || typeof s.wordEnd !== "number") report.errors.push({ scene: `scene ${i + 1}`, path: `scenes.${i}.wordStart`, message: "wordStart and wordEnd are required in replace mode" });
    else {
      if (s.wordStart !== expected) report.errors.push({ scene: `scene ${i + 1}`, path: `scenes.${i}.wordStart`, message: `must be ${expected} (scenes must be contiguous)` });
      if (s.wordEnd <= s.wordStart) report.errors.push({ scene: `scene ${i + 1}`, path: `scenes.${i}.wordEnd`, message: "must be greater than wordStart" });
      expected = s.wordEnd;
    }
  });
  if (!report.errors.length && expected !== words.length) {
    report.errors.push({ scene: "last scene", path: `scenes.${doc.scenes.length - 1}.wordEnd`, message: `must be ${words.length} (all ${words.length} words must be covered)` });
  }
  if (report.errors.length) return report;
  const anchors = doc.scenes.map((s) => ({ wordStart: s.wordStart!, wordEnd: s.wordEnd! }));
  const bounds = boundariesFromAnchors(words, anchors, timeline.duration);
  await mutateProject(projectId, actor, async (tx) => {
    if (existing.length) {
      await createSnapshot(tx, projectId, "Before replacing the storyboard", "before_storyboard");
      await tx.scene.deleteMany({ where: { projectId } });
    }
    for (let i = 0; i < doc.scenes.length; i++) {
      const s = doc.scenes[i];
      const scene = await tx.scene.create({
        data: {
          projectId,
          key: sceneKey(i + 1),
          order: i,
          name: s.name,
          startSec: bounds[i].start,
          endSec: bounds[i].end,
          timingMode: "audio_locked",
          wordStart: s.wordStart!,
          wordEnd: s.wordEnd!,
          timelineId: project.activeTimeline!.id,
          voiceText: words
            .slice(s.wordStart!, s.wordEnd!)
            .map((w) => w.text)
            .join(" "),
          visualConcept: s.visualConcept,
          visualType: s.visualType,
          animationNotes: json(s.animation),
          onScreenText: s.onScreenText,
          assetsRequired: json(s.assetsRequired),
          notes: s.notes,
          ...(s.creative ? { creative: json(s.creative) } : {}),
          spec: json(s.spec as SceneSpec),
          source,
        },
      });
      await recordSceneVersion(tx, scene, source, doc.note ?? "Created from storyboard document");
      report.applied.push(scene.key);
    }
    await recordStoryboardRevision(tx, projectId, source, doc.note ?? `Storyboard replaced (${doc.scenes.length} scenes)`);
    return { result: null, activity: { type: "storyboard.replaced", message: `${source === "claude" ? "Claude" : "Storyboard"} created ${doc.scenes.length} scenes from timeline v${project.activeTimeline!.version}${doc.note ? ` — ${doc.note}` : ""}` } };
  });
  return report;
}

export function reportHasChanges(report: ApplyReport): boolean {
  return report.applied.length > 0;
}

export function documentFingerprint(value: unknown): string {
  return fingerprint(value);
}

export async function assertSceneExists(projectId: string, key: string): Promise<Scene> {
  const scene = await db.scene.findFirst({ where: { projectId, key } });
  if (!scene) throw notFound(`Scene ${key}`);
  return scene;
}
