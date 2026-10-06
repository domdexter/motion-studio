import { z } from "zod";
import { EditPlanError, EditPlanSchema, applyEditPlan, elementLabel, explainChanges, type EditChange, type EditPlan } from "@/core/ai/edit-plan";
import { ANIMATABLE_PROPERTIES, animatableProperty, availableProperties } from "@/core/spec/animatable";
import { MOTION_GRAMMAR } from "@/core/creative/grammar";
import { COLOR_TOKENS, EASINGS, ELEMENT_TYPES, allSpecElements, isGroup, validateSceneSpec, type SceneElement, type SceneSpec } from "@/core/spec/scene";
import { APPEARANCE_PROPS, ELEMENT_TYPE_LABELS, STYLE_SUPPORT, TYPOGRAPHY_PROPS, elementPropertyKeys, sizeModeOf } from "@/core/spec/element-properties";
import { elementCues } from "@/core/spec/triggers";
import { segmentOfElement } from "@/core/timeline/scene-restructure";
import { elementSpan } from "@/core/timeline/scene-restructure";
import { db } from "../db";
import { AppError } from "../errors";
import { assertProjectId } from "../ids";
import type { Actor } from "./mutation";
import { findScene, loadWords, sceneDto, updateScene, type SceneDto } from "./scenes";

/**
 * AI editing — Claude as a client of the scene model.
 *
 * A request becomes a structured edit plan (core/ai/edit-plan.ts), which is applied with the same
 * patches the editor uses, validated with the same schema, saved with `updateScene` so it takes one
 * undo step and one scene version, and refused on a locked scene like any other edit. `preview: true`
 * returns the resulting spec and the change list without saving anything, so a plan can be shown
 * before it is accepted.
 *
 * `aiSceneContext` is the other half: the focused, structured state Claude reasons over — this scene,
 * its elements, its timing, the words it can cue to, the design tokens and presets it should prefer,
 * and what each element can animate. Never the whole application state.
 */

export const AiEditRequestSchema = z.strictObject({
  plan: EditPlanSchema,
  /** Apply and return the result without saving it. */
  preview: z.boolean().optional(),
});
export type AiEditRequest = z.input<typeof AiEditRequestSchema>;

export interface AiEditResult {
  /** The saved scene (absent for a preview). */
  scene?: SceneDto;
  /** The spec the plan produces, validated. */
  spec: SceneSpec;
  changes: EditChange[];
  /** The change list in plain language, one line per element. */
  explanation: string[];
  preview: boolean;
}

/**
 * Applies an edit plan to one scene. Every refusal is a sentence a person can act on: which edit
 * failed, on which element, and why.
 */
export async function applyAiEditPlan(projectId: string, sceneIdOrKey: string, input: AiEditRequest, actor: Actor): Promise<AiEditResult> {
  assertProjectId(projectId);
  const { plan, preview = false } = AiEditRequestSchema.parse(input);
  const scene = await findScene(db, projectId, sceneIdOrKey);
  if (scene.locked && !preview) throw new AppError("LOCKED", `${scene.key.replace("scene_", "Scene ")} is locked. Unlock it before editing it.`);
  const current = validateSceneSpec(scene.spec);
  if (!current.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it before editing it.`, { details: current.issues });

  const project = await db.project.findUnique({ where: { id: projectId }, select: { width: true, height: true } });
  const words = await loadWords(db, projectId);
  const sceneDurationSec = Math.max(0, scene.endSec - scene.startSec);
  const context = {
    frame: project ? { width: project.width, height: project.height } : undefined,
    sceneDurationSec,
    segment: segmentOfElement(current.spec, { start: scene.startSec, end: scene.endSec }, null, words),
  };

  let result;
  try {
    result = applyEditPlan(current.spec, plan, context);
  } catch (e) {
    if (e instanceof EditPlanError) {
      throw new AppError("VALIDATION", e.index === undefined ? e.message : `Edit ${e.index + 1} of the plan could not be applied: ${e.message}`, {
        hint: "Every AI edit goes through the same validation as a hand edit. Fix the plan and send it again.",
      });
    }
    throw e;
  }

  const validated = validateSceneSpec(result.spec);
  if (!validated.ok) {
    throw new AppError("VALIDATION", `The plan would leave ${scene.key} invalid, so nothing was changed.`, { details: validated.issues });
  }

  const explanation = explainChanges(result.changes);
  if (preview) return { spec: validated.spec, changes: result.changes, explanation, preview: true };

  const what = result.changes.length === 1 ? result.changes[0].target : `${new Set(result.changes.map((c) => c.target)).size} elements`;
  const updated = await updateScene(
    projectId,
    scene.id,
    { spec: validated.spec },
    actor,
    { message: plan.note ?? `Edited ${what} in ${scene.key}`, historyLabel: `edit ${what} in ${scene.key}` },
  );
  return { scene: updated, spec: validated.spec, changes: result.changes, explanation, preview: false };
}

// ---------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------

export interface AiElementSummary {
  target: string;
  /** The shot it belongs to, when it lives in one. */
  shotId?: string;
  type: string;
  label: string;
  summary: string;
  /** Where it sits, as the inspector shows it. */
  at?: { x: number; y: number; width?: number; height?: number };
  /** Seconds into the scene it appears and is gone. */
  onScreen: { from: number; to: number };
  /** What it animates now. */
  animates: string[];
  /** What it could animate. */
  canAnimate: string[];
  /** Its cues: what happens, when it happens in the scene, and the word it follows. */
  cues: { id: string; what: string; atSec: number; word?: string; ok?: false; reason?: string }[];
  /** Children, for a group. */
  children?: AiElementSummary[];
}

export interface AiSceneContext {
  project: { id: string; width: number; height: number; fps: number };
  scene: { key: string; name: string; startSec: number; endSec: number; durationSec: number; locked: boolean; approved: boolean; voiceText: string };
  /** The words spoken inside the scene, with the seconds they land on — what a cue can name. */
  words: { index: number; text: string; start: number }[];
  elements: AiElementSummary[];
  /** The selected element in full, when one is named. */
  selected?: { target: string; element: SceneElement };
  design: { colors: Record<string, string>; typography: unknown; shape: unknown; motion: unknown; tokens: readonly string[] };
  /** What Claude should reach for before inventing values. */
  vocabulary: {
    elementTypes: readonly string[];
    easings: readonly string[];
    motionIntents: string[];
    animatableProperties: { id: string; label: string; unit: string; range?: readonly [number, number]; elements: string }[];
  };
  assets: { id: string; kind: string; name: string }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function summarize(element: SceneElement, target: string, spec: SceneSpec, segment: ReturnType<typeof segmentOfElement>, sceneStart: number, shotId: string | null = null, words: readonly { text: string }[] = []): AiElementSummary {
  const span = elementSpan(element, segment);
  const cues = elementCues(element, segment, shotId).map((c) => ({
    id: c.id,
    what: c.name,
    atSec: r2(c.time - sceneStart),
    ...(c.wordIndex !== undefined && words[c.wordIndex] ? { word: words[c.wordIndex].text } : {}),
    ...(c.ok ? {} : { ok: false as const, reason: c.reason }),
  }));
  return {
    target,
    ...(shotId ? { shotId } : {}),
    type: element.type,
    label: ELEMENT_TYPE_LABELS[element.type],
    summary: describeElement(element),
    ...(element.type === "group" ? {} : { at: { x: r2(element.x ?? 50), y: r2(element.y ?? 50), ...(element.width !== undefined ? { width: r2(element.width) } : {}), ...(element.height !== undefined ? { height: r2(element.height) } : {}) } }),
    onScreen: { from: r2(span.appear - sceneStart), to: r2(span.gone - sceneStart) },
    animates: [...new Set((element.keyframes ?? []).map((k) => k.property))],
    canAnimate: [...availableProperties(element)],
    cues,
    ...(isGroup(element) ? { children: element.children.map((child, i) => summarize(child, child.id ?? `${target}.${i + 1}`, spec, segment, sceneStart, shotId, words)) } : {}),
  };
}

function describeElement(element: SceneElement): string {
  const record = element as Record<string, unknown>;
  if (typeof record.text === "string") return record.text.slice(0, 80);
  if (isGroup(element)) return element.name ?? `${element.children.length} elements`;
  if (element.type === "image" || element.type === "video") return element.assetId;
  return ELEMENT_TYPE_LABELS[element.type];
}

/** The structured state Claude reasons over for one scene — focused, not the whole project. */
export async function aiSceneContext(projectId: string, sceneIdOrKey: string, options: { element?: string } = {}): Promise<AiSceneContext> {
  assertProjectId(projectId);
  const scene = await findScene(db, projectId, sceneIdOrKey);
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, width: true, height: true, fps: true, design: true } });
  if (!project) throw new AppError("NOT_FOUND", "Project not found.");
  const parsed = validateSceneSpec(scene.spec);
  if (!parsed.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it before asking for an edit.`, { details: parsed.issues });
  const spec = parsed.spec;
  const words = await loadWords(db, projectId);
  const segment = segmentOfElement(spec, { start: scene.startSec, end: scene.endSec }, null, words);
  const design = project.design as { colors: Record<string, string>; typography: unknown; shape: unknown; motion: unknown };

  const elements = allSpecElements(spec)
    .filter((e) => e.child === null)
    .map(({ element, shotId, index }) => summarize(element, elementLabel(element, { shotId, index }), spec, segment, scene.startSec, shotId, words));

  const selected = options.element ? allSpecElements(spec).find((e) => elementLabel(e.element, { shotId: e.shotId, index: e.index, child: e.child ?? undefined }) === options.element) : undefined;
  if (options.element && !selected) throw new AppError("NOT_FOUND", `No element “${options.element}” in ${scene.key}.`);

  const assets = await db.asset.findMany({ where: { projectId }, select: { id: true, kind: true, name: true }, take: 40 });

  return {
    project: { id: project.id, width: project.width, height: project.height, fps: project.fps },
    scene: {
      key: scene.key,
      name: scene.name ?? "",
      startSec: r2(scene.startSec),
      endSec: r2(scene.endSec),
      durationSec: r2(scene.endSec - scene.startSec),
      locked: scene.locked,
      approved: scene.status === "approved",
      voiceText: scene.voiceText ?? "",
    },
    words: words
      .map((w, index) => ({ index, text: w.text, start: r2(w.start) }))
      .filter((w) => w.start >= scene.startSec - 0.08 && w.start < scene.endSec),
    elements,
    ...(selected ? { selected: { target: options.element!, element: selected.element } } : {}),
    design: { colors: design.colors, typography: design.typography, shape: design.shape, motion: design.motion, tokens: COLOR_TOKENS },
    vocabulary: {
      elementTypes: ELEMENT_TYPES,
      easings: EASINGS,
      motionIntents: Object.keys(MOTION_GRAMMAR),
      animatableProperties: ANIMATABLE_PROPERTIES.filter((p) => p.status === "enabled").map((p) => ({
        id: p.id,
        label: p.label,
        unit: p.unit,
        ...(p.range ? { range: p.range } : {}),
        elements: p.elements === "all" ? "all" : "only" in p.elements ? `only ${p.elements.only.join(", ")}` : `all but ${p.elements.except.join(", ")}`,
      })),
    },
    assets: assets.map((a) => ({ id: a.id, kind: a.kind, name: a.name })),
  };
}

/** What an element type can be given — the editor's own lists, for a plan that has to stay inside them. */
export function aiElementCapabilities(type: SceneElement["type"]) {
  return {
    type,
    label: ELEMENT_TYPE_LABELS[type],
    properties: elementPropertyKeys(type),
    style: STYLE_SUPPORT[type],
    appearance: APPEARANCE_PROPS[type] ?? [],
    typography: TYPOGRAPHY_PROPS[type] ?? [],
    animatable: [...availableProperties({ type, motionPath: true, clip: true })].map((id) => animatableProperty(id).id),
    sizing: sizeModeOf({ type } as SceneElement),
  };
}
