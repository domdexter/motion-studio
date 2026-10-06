import { z } from "zod";
import { Prisma, type Scene } from "@/generated/prisma/client";
import { parseSceneCreative, type SceneCreative } from "@/core/creative/schema";
import { BrandProfileSchema } from "@/core/spec/brand";
import { AssetRequirementSchema, VisualTypeSchema } from "@/core/spec/enums";
import { assetIdsInSpec, validateSceneSpec, type SceneSpec } from "@/core/spec/scene";
import type { TimedWord, TimelineData } from "@/core/spec/timing";
import { parseScript } from "@/core/script/script";
import { DesignSystemSchema } from "@/core/spec/design";
import { draftScene, draftStoryboard } from "@/core/storyboard/draft";
import { SceneMergeLimitError, copySceneSpec, mergeSceneSpecs, splitSceneSpec } from "@/core/timeline/scene-restructure";
import { LEAD_IN_SEC, planScenes, recomputeSceneTimes, type ScenePlan } from "@/core/timeline/scenes";
import { db, json, type DbOrTx, type Tx } from "../db";
import { AppError, notFound } from "../errors";
import { mutateProject, type Actor } from "./mutation";
import { recordSceneVersion, recordStoryboardRevision, type SceneSnapshot } from "./scene-history";
import { getSettings } from "./settings";
import { createSnapshot } from "./snapshots";
import { getProjectState, sceneFingerprint, type SceneStateInfo } from "./state";

/**
 * Scenes = storyboard intent + scene spec + timing. Invariants enforced here:
 *  - locked scenes are never modified (creative content, spec or timing)
 *  - visual edits never move timing unless explicitly requested
 *  - scene keys always match display order (scene_01, scene_02, …)
 *  - every change creates a scene version; structural changes create a storyboard revision
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const sceneKey = (n: number) => `scene_${String(n).padStart(n > 99 ? 3 : 2, "0")}`;
const SOURCE_FOR_ACTOR: Record<Actor, string> = { user: "user", claude: "claude", file: "file", worker: "system", system: "system" };

export function sceneDto(s: Scene, info?: SceneStateInfo) {
  return {
    id: s.id,
    key: s.key,
    order: s.order,
    name: s.name,
    startSec: s.startSec,
    endSec: s.endSec,
    durationSec: r3(s.endSec - s.startSec),
    timingMode: s.timingMode as "audio_locked" | "user_adjusted",
    wordStart: s.wordStart,
    wordEnd: s.wordEnd,
    timelineId: s.timelineId,
    voiceText: s.voiceText,
    visualConcept: s.visualConcept,
    visualType: s.visualType,
    animationNotes: s.animationNotes as string[],
    onScreenText: s.onScreenText,
    assetsRequired: s.assetsRequired as z.infer<typeof AssetRequirementSchema>[],
    notes: s.notes,
    spec: s.spec as SceneSpec,
    /** Creative intent (null when none was recorded). */
    creative: (s.creative ?? null) as SceneCreative | null,
    status: s.status as "draft" | "approved",
    locked: s.locked,
    approvedAt: s.approvedAt?.toISOString() ?? null,
    version: s.version,
    source: s.source,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    valid: info?.valid ?? true,
    issues: info?.issues ?? [],
    staleTiming: info?.staleTiming ?? false,
    needsReview: info?.needsReview ?? false,
    missingAssetIds: info?.missingAssetIds ?? [],
  };
}
export type SceneDto = ReturnType<typeof sceneDto>;

export async function listScenes(projectId: string): Promise<SceneDto[]> {
  const [scenes, state] = await Promise.all([db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } }), getProjectState(projectId)]);
  return scenes.map((s) => sceneDto(s, state.scenes[s.id]));
}

export async function findScene(client: DbOrTx, projectId: string, idOrKey: string): Promise<Scene> {
  const scene = await client.scene.findFirst({ where: { projectId, OR: [{ id: idOrKey }, { key: idOrKey }] } });
  if (!scene) throw notFound(`Scene “${idOrKey}”`);
  return scene;
}

function assertUnlocked(scene: Scene): void {
  if (scene.locked) {
    throw new AppError("LOCKED", `${scene.key.replace("scene_", "Scene ")} is locked. Unlock it before making changes.`);
  }
}

async function loadTimelineContext(client: DbOrTx, projectId: string) {
  const project = await client.project.findUnique({ where: { id: projectId }, include: { activeTimeline: true, activeTranscript: true } });
  if (!project) throw notFound("Project");
  const timeline = project.activeTimeline;
  if (!timeline) {
    throw new AppError("PRECONDITION", "Generate or import a voice-over before generating an audio-locked storyboard.", {
      action: { label: "Open Voice", href: `/projects/${projectId}/voice` },
    });
  }
  const transcript =
    timeline.transcriptId && timeline.transcriptId === project.activeTranscript?.id
      ? project.activeTranscript
      : timeline.transcriptId
        ? await client.transcript.findUnique({ where: { id: timeline.transcriptId } })
        : null;
  return { project, timeline, data: timeline.data as TimelineData, words: (transcript?.words ?? []) as TimedWord[] };
}

function wordsText(words: TimedWord[], start: number | null, end: number | null): string {
  if (start === null || end === null) return "";
  return words
    .slice(start, end)
    .map((w) => w.text)
    .join(" ");
}

/** Anchor range of words whose start lies inside [startSec, endSec). */
function anchorsForRange(words: TimedWord[], startSec: number, endSec: number): { wordStart: number | null; wordEnd: number | null } {
  let first = -1;
  let last = -1;
  words.forEach((w, i) => {
    if (w.start >= startSec - 0.05 && w.start < endSec) {
      if (first < 0) first = i;
      last = i;
    }
  });
  return first < 0 ? { wordStart: null, wordEnd: null } : { wordStart: first, wordEnd: last + 1 };
}

/** The cut before word k (same rule the planner uses): slightly ahead of the word, inside the pause. */
function cutBeforeWord(words: TimedWord[], k: number): number {
  const w = words[k];
  const prev = words[k - 1];
  const gap = prev ? Math.max(0, w.start - prev.end) : 0;
  return r3(w.start - Math.min(LEAD_IN_SEC, gap / 2));
}

export async function renumberScenes(tx: Tx, projectId: string): Promise<void> {
  const scenes = await tx.scene.findMany({ where: { projectId }, orderBy: [{ startSec: "asc" }, { order: "asc" }] });
  for (const s of scenes) await tx.scene.update({ where: { id: s.id }, data: { key: `tmp_${s.id}` } });
  for (let i = 0; i < scenes.length; i++) await tx.scene.update({ where: { id: scenes[i].id }, data: { key: sceneKey(i + 1), order: i } });
}

// ---------------------------------------------------------------------------------------
// Rule-based storyboard
// ---------------------------------------------------------------------------------------

export const RulesStoryboardSchema = z.object({
  pace: z.enum(["fast", "medium", "slow"]).optional(),
  /** Regenerate only these scenes (ids or keys), keeping their timing. */
  sceneIds: z.array(z.string()).max(500).optional(),
  /** Throw away the current scene structure and re-plan from the timeline (not allowed with locked scenes). */
  restructure: z.boolean().optional(),
});

export async function generateStoryboardWithRules(projectId: string, input: z.input<typeof RulesStoryboardSchema>, actor: Actor) {
  const opts = RulesStoryboardSchema.parse(input ?? {});
  const ctx = await loadTimelineContext(db, projectId);
  if (!ctx.words.length) throw new AppError("PRECONDITION", "The active timeline has no word timing to storyboard.");
  const brand = BrandProfileSchema.parse(ctx.project.brand ?? {});
  const script = await db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { content: true } });
  const markdownEmphasis = script ? parseScript(script.content).emphasis : [];
  const pace = opts.pace ?? getSettings().ai.storyboardPace;
  const existing = await db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const base = { words: ctx.words, width: ctx.project.width, height: ctx.project.height, brand, markdownEmphasis };

  if (existing.length === 0 || opts.restructure) {
    const locked = existing.filter((s) => s.locked);
    if (locked.length) {
      throw new AppError("LOCKED", `${locked.map((s) => s.key).join(", ")} ${locked.length === 1 ? "is" : "are"} locked, so the storyboard can't be restructured.`, {
        hint: "Unlock those scenes, or regenerate individual unlocked scenes instead.",
      });
    }
    const plans = planScenes(ctx.data, ctx.words, pace);
    const drafts = draftStoryboard({ ...base, plans });
    return mutateProject(projectId, actor, async (tx) => {
      const snapshot = existing.length ? await createSnapshot(tx, projectId, "Before regenerating the storyboard", "before_storyboard") : null;
      if (existing.length) await tx.scene.deleteMany({ where: { projectId } });
      for (let k = 0; k < drafts.length; k++) {
        const d = drafts[k];
        const scene = await tx.scene.create({
          data: {
            projectId,
            key: sceneKey(k + 1),
            order: k,
            name: d.name,
            startSec: d.start,
            endSec: d.end,
            timingMode: "audio_locked",
            wordStart: d.wordStart,
            wordEnd: d.wordEnd,
            timelineId: ctx.timeline.id,
            voiceText: d.voiceText,
            visualConcept: d.visualConcept,
            visualType: d.visualType,
            animationNotes: json(d.animationNotes),
            onScreenText: d.onScreenText,
            assetsRequired: json(d.assetsRequired),
            notes: d.notes,
            spec: json(d.spec),
            source: "rules",
          },
        });
        await recordSceneVersion(tx, scene, "rules", "Drafted by the rule-based storyboard");
      }
      const version = await recordStoryboardRevision(tx, projectId, "rules", `Rule-based draft · ${drafts.length} scenes · ${pace} pace`);
      return {
        result: { scenes: drafts.length, storyboardVersion: version, snapshotVersion: snapshot?.version ?? null },
        activity: { type: "storyboard.generated", message: `Drafted a ${drafts.length}-scene storyboard from timeline v${ctx.timeline.version} (rule-based, ${pace} pace)` },
      };
    });
  }

  const targets = opts.sceneIds ? existing.filter((s) => opts.sceneIds!.includes(s.id) || opts.sceneIds!.includes(s.key)) : existing;
  const skippedLocked = targets.filter((s) => s.locked).map((s) => s.key);
  const editable = targets.filter((s) => !s.locked);
  if (!editable.length) throw new AppError("LOCKED", skippedLocked.length ? "All selected scenes are locked." : "No scenes selected.");
  const plans: ScenePlan[] = existing.map((s) => {
    const anchors = s.wordStart !== null && s.wordEnd !== null ? { wordStart: s.wordStart, wordEnd: s.wordEnd } : anchorsForRange(ctx.words, s.startSec, s.endSec);
    return {
      wordStart: anchors.wordStart ?? 0,
      wordEnd: anchors.wordEnd ?? 0,
      start: s.startSec,
      end: s.endSec,
      voiceText: s.voiceText || wordsText(ctx.words, anchors.wordStart, anchors.wordEnd),
    };
  });
  return mutateProject(projectId, actor, async (tx) => {
    for (const s of editable) {
      const i = existing.findIndex((e) => e.id === s.id);
      const d = draftScene({ ...base, plans }, i);
      const updated = await tx.scene.update({
        where: { id: s.id },
        data: {
          name: d.name,
          visualConcept: d.visualConcept,
          visualType: d.visualType,
          animationNotes: json(d.animationNotes),
          onScreenText: d.onScreenText,
          notes: d.notes,
          spec: json(d.spec),
          status: "draft",
          approvedAt: null,
          approvedFingerprint: null,
          version: { increment: 1 },
          source: "rules",
        },
      });
      await recordSceneVersion(tx, updated, "rules", "Regenerated by the rule-based storyboard (timing kept)");
    }
    const version = await recordStoryboardRevision(tx, projectId, "rules", `Regenerated ${editable.map((s) => s.key).join(", ")}`);
    return {
      result: { regenerated: editable.map((s) => s.key), skippedLocked, storyboardVersion: version },
      activity: {
        type: "storyboard.regenerated",
        message: `Regenerated ${editable.length} scene${editable.length === 1 ? "" : "s"} (rule-based, timing kept)${skippedLocked.length ? ` · skipped locked ${skippedLocked.join(", ")}` : ""}`,
      },
    };
  });
}

// ---------------------------------------------------------------------------------------
// Creative edits
// ---------------------------------------------------------------------------------------

export const UpdateSceneSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    visualConcept: z.string().max(4000),
    visualType: VisualTypeSchema,
    animationNotes: z.array(z.string().max(500)).max(30),
    onScreenText: z.string().max(600),
    assetsRequired: z.array(AssetRequirementSchema).max(20),
    notes: z.string().max(8000),
    spec: z.unknown(),
    /** SceneCreative, or null to clear the recorded intent. */
    creative: z.unknown(),
  })
  .partial()
  .strict();

/** Undo label for a scene edit: “rename scene_03”, “remove image_1 from scene_03”, … */
function sceneEditLabel(scene: Scene, changed: string[], spec?: SceneSpec): string {
  if (changed.length === 1 && changed[0] === "name") return `rename ${scene.key}`;
  if (changed.every((k) => k === "creative")) return `edit ${scene.key} intent`;
  if (changed.length === 1 && spec) {
    const old = (scene.spec as SceneSpec | null)?.elements ?? [];
    if (spec.elements.length === old.length - 1) {
      const gone = old.find((e) => !spec.elements.some((n) => n.id !== undefined && n.id === e.id));
      return `remove ${gone?.id ?? gone?.type ?? "an element"} from ${scene.key}`;
    }
    return `edit ${scene.key} spec`;
  }
  return `edit ${scene.key} storyboard`;
}

export async function updateScene(
  projectId: string,
  idOrKey: string,
  patch: z.input<typeof UpdateSceneSchema>,
  actor: Actor,
  options: { message?: string; keepApproval?: boolean; historyLabel?: string; coalesceKey?: string } = {},
): Promise<SceneDto> {
  const data = UpdateSceneSchema.parse(patch);
  const scene = await findScene(db, projectId, idOrKey);
  assertUnlocked(scene);
  let spec: SceneSpec | undefined;
  if (data.spec !== undefined) {
    const result = validateSceneSpec(data.spec);
    if (!result.ok) {
      throw new AppError("VALIDATION", `The scene spec for ${scene.key} is invalid.`, { details: result.issues, hint: "See REMOTION.md for the scene spec reference." });
    }
    spec = result.spec;
  }
  let creative: SceneCreative | null | undefined;
  if (data.creative !== undefined) {
    if (data.creative === null) creative = null;
    else {
      const result = parseSceneCreative(data.creative);
      if (!result.ok) throw new AppError("VALIDATION", `The creative intent for ${scene.key} is invalid.`, { details: result.issues, hint: "See CREATIVE_SYSTEM.md → Scene creative intent." });
      creative = result.value;
    }
  }
  const changed = Object.keys(data);
  if (!changed.length) return sceneDto(scene);
  // Creative intent is not rendered and not part of the approval fingerprint, so editing only intent keeps approval.
  const keepApproval = options.keepApproval || changed.every((k) => k === "creative");
  const updated = await mutateProject(projectId, actor, async (tx) => {
    const row = await tx.scene.update({
      where: { id: scene.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.visualConcept !== undefined ? { visualConcept: data.visualConcept } : {}),
        ...(data.visualType !== undefined ? { visualType: data.visualType } : {}),
        ...(data.animationNotes !== undefined ? { animationNotes: json(data.animationNotes) } : {}),
        ...(data.onScreenText !== undefined ? { onScreenText: data.onScreenText } : {}),
        ...(data.assetsRequired !== undefined ? { assetsRequired: json(data.assetsRequired) } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(spec ? { spec: json(spec) } : {}),
        ...(creative !== undefined ? { creative: creative === null ? Prisma.DbNull : json(creative) } : {}),
        ...(keepApproval ? {} : { status: "draft", approvedAt: null, approvedFingerprint: null }),
        version: { increment: 1 },
        source: SOURCE_FOR_ACTOR[actor],
      },
    });
    const message = options.message ?? `Edited ${changed.join(", ")}`;
    await recordSceneVersion(tx, row, SOURCE_FOR_ACTOR[actor], message);
    return {
      result: row,
      activity: { type: "scene.updated", message: `${scene.key}: ${message}${scene.status === "approved" && !keepApproval ? " (approval reset)" : ""}`, data: { sceneId: scene.id, changed } },
    };
  }, { history: { label: options.historyLabel ?? sceneEditLabel(scene, changed, spec), scope: ["scenes"], coalesceKey: options.coalesceKey } });
  const state = await getProjectState(projectId);
  return sceneDto(updated, state.scenes[updated.id]);
}

export async function setSceneLock(projectId: string, idOrKey: string, locked: boolean, actor: Actor): Promise<void> {
  const scene = await findScene(db, projectId, idOrKey);
  if (scene.locked === locked) return;
  await mutateProject(projectId, actor, async (tx) => {
    await tx.scene.update({ where: { id: scene.id }, data: { locked } });
    return { result: null, activity: { type: locked ? "scene.locked" : "scene.unlocked", message: `${locked ? "Locked" : "Unlocked"} ${scene.key} “${scene.name}”` } };
  });
}

export async function setSceneApproval(projectId: string, idOrKey: string, approved: boolean, actor: Actor): Promise<void> {
  const scene = await findScene(db, projectId, idOrKey);
  if (approved) {
    const validation = validateSceneSpec(scene.spec);
    if (!validation.ok) throw new AppError("VALIDATION", `${scene.key} has an invalid spec and can't be approved.`, { details: validation.issues });
    const ids = assetIdsInSpec(validation.spec);
    const assets = await db.asset.findMany({ where: { projectId, id: { in: ids } }, select: { id: true, contentHash: true, name: true } });
    const missing = ids.filter((id) => !assets.some((a) => a.id === id));
    if (missing.length) throw new AppError("VALIDATION", `${scene.key} requires asset ${missing.join(", ")}.`, { hint: "Add or generate the asset, or remove it from the scene." });
    const fingerprint = sceneFingerprint(scene, new Map(assets.map((a) => [a.id, a.contentHash])));
    await mutateProject(projectId, actor, async (tx) => {
      await tx.scene.update({ where: { id: scene.id }, data: { status: "approved", approvedAt: new Date(), approvedFingerprint: fingerprint } });
      return { result: null, activity: { type: "scene.approved", message: `Approved ${scene.key} “${scene.name}”` } };
    }, { history: { label: `approve ${scene.key}`, scope: ["scenes"] } });
  } else {
    await mutateProject(projectId, actor, async (tx) => {
      await tx.scene.update({ where: { id: scene.id }, data: { status: "draft", approvedAt: null, approvedFingerprint: null } });
      return { result: null, activity: { type: "scene.unapproved", message: `Marked ${scene.key} as draft` } };
    }, { history: { label: `unapprove ${scene.key}`, scope: ["scenes"] } });
  }
}

export async function approveAllScenes(projectId: string, actor: Actor): Promise<{ approved: string[]; skipped: { key: string; reason: string }[] }> {
  const [all, assets] = await Promise.all([
    db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
    db.asset.findMany({ where: { projectId }, select: { id: true, contentHash: true } }),
  ]);
  const hashes = new Map(assets.map((a) => [a.id, a.contentHash]));
  // Approved scenes that changed after approval (e.g. re-timed to a new voice-over) are approved again.
  const scenes = all.filter((s) => s.status !== "approved" || (!!s.approvedFingerprint && s.approvedFingerprint !== sceneFingerprint(s, hashes)));
  const approved: string[] = [];
  const skipped: { key: string; reason: string }[] = [];
  for (const s of scenes) {
    try {
      await setSceneApproval(projectId, s.id, true, actor);
      approved.push(s.key);
    } catch (err) {
      skipped.push({ key: s.key, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { approved, skipped };
}

// ---------------------------------------------------------------------------------------
// Timing edits (never touch the voice timeline — only scene boundaries)
// ---------------------------------------------------------------------------------------

export const BoundarySchema = z.object({ timeSec: z.number().min(0), snap: z.boolean().default(true) });

/** Moves the boundary between a scene and the next one. Snapping keeps both scenes audio-locked. */
export async function moveSceneBoundary(projectId: string, leftIdOrKey: string, input: z.input<typeof BoundarySchema>, actor: Actor) {
  const opts = BoundarySchema.parse(input);
  const ctx = await loadTimelineContext(db, projectId);
  const scenes = await db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const li = scenes.findIndex((s) => s.id === leftIdOrKey || s.key === leftIdOrKey);
  if (li < 0) throw notFound(`Scene “${leftIdOrKey}”`);
  const left = scenes[li];
  const right = scenes[li + 1];
  if (!right) throw new AppError("VALIDATION", `${left.key} is the last scene — there is no boundary after it.`);
  assertUnlocked(left);
  assertUnlocked(right);
  const min = left.startSec + 0.2;
  const max = right.endSec - 0.2;
  if (max <= min) throw new AppError("VALIDATION", "These scenes are too short to move the boundary.");
  let t = Math.min(max, Math.max(min, opts.timeSec));
  const words = ctx.words;
  type TimingPatch = { startSec?: number; endSec?: number; wordStart?: number | null; wordEnd?: number | null; voiceText?: string; timingMode?: string };
  let leftData: TimingPatch;
  let rightData: TimingPatch;
  const ws = left.wordStart ?? anchorsForRange(words, left.startSec, left.endSec).wordStart;
  const we = right.wordEnd ?? anchorsForRange(words, right.startSec, right.endSec).wordEnd;
  if (opts.snap && words.length && ws !== null && we !== null && we - ws >= 2) {
    let best = -1;
    let bestDist = Infinity;
    for (let k = ws + 1; k < we; k++) {
      const cut = cutBeforeWord(words, k);
      if (cut <= left.startSec + 0.05 || cut >= right.endSec - 0.05) continue;
      const d = Math.abs(cut - t);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    if (best < 0) throw new AppError("VALIDATION", "No word boundary to snap to here. Hold Alt to place the cut freely.");
    t = cutBeforeWord(words, best);
    leftData = { endSec: t, wordStart: ws, wordEnd: best, voiceText: wordsText(words, ws, best) };
    rightData = { startSec: t, wordStart: best, wordEnd: we, voiceText: wordsText(words, best, we) };
  } else {
    const la = anchorsForRange(words, left.startSec, t);
    const ra = anchorsForRange(words, t, right.endSec);
    leftData = { endSec: r3(t), timingMode: "user_adjusted", ...la, voiceText: wordsText(words, la.wordStart, la.wordEnd) || left.voiceText };
    rightData = { startSec: r3(t), timingMode: "user_adjusted", ...ra, voiceText: wordsText(words, ra.wordStart, ra.wordEnd) || right.voiceText };
  }
  return mutateProject(projectId, actor, async (tx) => {
    const a = await tx.scene.update({ where: { id: left.id }, data: { ...leftData, version: { increment: 1 } } });
    const b = await tx.scene.update({ where: { id: right.id }, data: { ...rightData, version: { increment: 1 } } });
    const how = opts.snap ? "snapped to word" : "free placement (user-adjusted)";
    await recordSceneVersion(tx, a, SOURCE_FOR_ACTOR[actor], `End moved to ${t.toFixed(2)}s (${how})`);
    await recordSceneVersion(tx, b, SOURCE_FOR_ACTOR[actor], `Start moved to ${t.toFixed(2)}s (${how})`);
    await recordStoryboardRevision(tx, projectId, SOURCE_FOR_ACTOR[actor], `Boundary ${left.key}/${right.key} → ${t.toFixed(2)}s`);
    return { result: { timeSec: t, snapped: opts.snap }, activity: { type: "scene.timing", message: `Moved boundary between ${left.key} and ${right.key} to ${t.toFixed(2)}s (${how})` } };
  }, { history: { label: `move the cut between ${left.key} and ${right.key}`, scope: ["scenes"] } });
}

/** Re-derives a user-adjusted scene's times from the audio (word anchors). */
export async function relockSceneTiming(projectId: string, idOrKey: string, actor: Actor) {
  const ctx = await loadTimelineContext(db, projectId);
  const scene = await findScene(db, projectId, idOrKey);
  assertUnlocked(scene);
  const scenes = await db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const inputs = scenes.map((s) => {
    const anchors = s.wordStart !== null && s.wordEnd !== null ? { wordStart: s.wordStart, wordEnd: s.wordEnd } : anchorsForRange(ctx.words, s.startSec, s.endSec);
    return { id: s.id, timingMode: (s.id === scene.id ? "audio_locked" : s.timingMode) as "audio_locked" | "user_adjusted", ...anchors, start: s.startSec, end: s.endSec };
  });
  const times = recomputeSceneTimes(inputs, ctx.words, ctx.data.duration);
  return mutateProject(projectId, actor, async (tx) => {
    let touched = 0;
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const next = times[i];
      if (s.locked) continue;
      if (s.id !== scene.id && Math.abs(next.start - s.startSec) < 0.001 && Math.abs(next.end - s.endSec) < 0.001) continue;
      const row = await tx.scene.update({
        where: { id: s.id },
        data: {
          startSec: next.start,
          endSec: next.end,
          ...(s.id === scene.id ? { timingMode: "audio_locked", wordStart: inputs[i].wordStart, wordEnd: inputs[i].wordEnd, timelineId: ctx.timeline.id } : {}),
          version: { increment: 1 },
        },
      });
      await recordSceneVersion(tx, row, SOURCE_FOR_ACTOR[actor], s.id === scene.id ? "Timing re-locked to the voice-over" : `Boundary adjusted after re-locking ${scene.key}`);
      touched++;
    }
    await recordStoryboardRevision(tx, projectId, SOURCE_FOR_ACTOR[actor], `Re-locked ${scene.key} to the voice-over`);
    return { result: { touched }, activity: { type: "scene.relocked", message: `Re-locked ${scene.key} to the voice-over timing` } };
  }, { history: { label: `re-lock ${scene.key} to the voice-over`, scope: ["scenes"] } });
}

export async function splitScene(projectId: string, idOrKey: string, atSec: number, actor: Actor) {
  const ctx = await loadTimelineContext(db, projectId);
  const scene = await findScene(db, projectId, idOrKey);
  assertUnlocked(scene);
  const words = ctx.words;
  const anchors = scene.wordStart !== null && scene.wordEnd !== null ? { wordStart: scene.wordStart, wordEnd: scene.wordEnd } : anchorsForRange(words, scene.startSec, scene.endSec);
  if (anchors.wordStart === null || anchors.wordEnd === null || anchors.wordEnd - anchors.wordStart < 2) {
    throw new AppError("VALIDATION", `${scene.key} has fewer than two spoken words and can't be split.`);
  }
  let k = -1;
  let bestDist = Infinity;
  for (let i = anchors.wordStart + 1; i < anchors.wordEnd; i++) {
    const d = Math.abs(cutBeforeWord(words, i) - atSec);
    if (d < bestDist) {
      bestDist = d;
      k = i;
    }
  }
  const cut = Math.min(scene.endSec - 0.1, Math.max(scene.startSec + 0.1, cutBeforeWord(words, k)));
  const project = ctx.project;
  const plans: ScenePlan[] = [
    { wordStart: anchors.wordStart, wordEnd: k, start: scene.startSec, end: cut, voiceText: wordsText(words, anchors.wordStart, k) },
    { wordStart: k, wordEnd: anchors.wordEnd, start: cut, end: scene.endSec, voiceText: wordsText(words, k, anchors.wordEnd) },
  ];
  // Each part keeps what is on screen during its time. An invalid spec can't be divided: the first part keeps it and the second gets a drafted design.
  const current = validateSceneSpec(scene.spec);
  let parts: { first: SceneSpec; second: SceneSpec; notes: string[] } | null = null;
  if (current.ok) {
    const assets = await db.asset.findMany({ where: { projectId, id: { in: assetIdsInSpec(current.spec) } }, select: { id: true, durationSec: true } });
    const durations = new Map(assets.map((a) => [a.id, a.durationSec]));
    const divided = splitSceneSpec(current.spec, { start: scene.startSec, end: scene.endSec }, cut, { words, sourceDurationSec: (id) => durations.get(id) ?? null });
    const first = validateSceneSpec(divided.first);
    const second = validateSceneSpec(divided.second);
    if (!first.ok || !second.ok) {
      throw new AppError("VALIDATION", `Could not divide the design of ${scene.key} at ${cut.toFixed(2)}s — nothing was changed.`, { details: !first.ok ? first.issues : !second.ok ? second.issues : [] });
    }
    parts = { first: first.spec, second: second.spec, notes: divided.notes };
  }
  const drafted = parts ? null : draftScene({ plans, words, width: project.width, height: project.height, brand: BrandProfileSchema.parse(project.brand ?? {}) }, 1);
  const hadShots = current.ok && !!current.spec.shots?.length;
  return mutateProject(projectId, actor, async (tx) => {
    const a = await tx.scene.update({
      where: { id: scene.id },
      data: {
        endSec: cut,
        wordStart: anchors.wordStart,
        wordEnd: k,
        voiceText: plans[0].voiceText,
        ...(parts ? { spec: json(parts.first), creative: partCreative(scene.creative, parts.first, hadShots), status: "draft", approvedAt: null, approvedFingerprint: null } : {}),
        version: { increment: 1 },
      },
    });
    await recordSceneVersion(tx, a, SOURCE_FOR_ACTOR[actor], `Split at ${cut.toFixed(2)}s (kept first part)`);
    const b = await tx.scene.create({
      data: {
        projectId,
        key: `tmp_split_${scene.id}`,
        order: scene.order + 1,
        name: `${scene.name} (2)`,
        startSec: cut,
        endSec: scene.endSec,
        timingMode: scene.timingMode,
        wordStart: k,
        wordEnd: anchors.wordEnd,
        timelineId: scene.timelineId,
        voiceText: plans[1].voiceText,
        ...(parts
          ? {
              visualConcept: scene.visualConcept,
              visualType: scene.visualType,
              animationNotes: json(scene.animationNotes),
              onScreenText: scene.onScreenText,
              assetsRequired: json(scene.assetsRequired),
              spec: json(parts.second),
              creative: partCreative(scene.creative, parts.second, hadShots),
            }
          : { visualConcept: drafted!.visualConcept, visualType: drafted!.visualType, animationNotes: json(drafted!.animationNotes), onScreenText: drafted!.onScreenText, assetsRequired: json([]), spec: json(drafted!.spec) }),
        notes: `Split from ${scene.key}.`,
        source: SOURCE_FOR_ACTOR[actor],
      },
    });
    await recordSceneVersion(tx, b, SOURCE_FOR_ACTOR[actor], `Created by splitting ${scene.key}`);
    await renumberScenes(tx, projectId);
    await recordStoryboardRevision(tx, projectId, SOURCE_FOR_ACTOR[actor], `Split ${scene.key} at ${cut.toFixed(2)}s`);
    const notes = parts ? parts.notes : [`${scene.key}'s spec is invalid, so the second part got a new drafted design.`];
    return { result: { cutSec: cut, newSceneId: b.id, notes }, activity: { type: "scene.split", message: `Split ${scene.key} “${scene.name}” at ${cut.toFixed(2)}s` } };
  }, { history: { label: `split ${scene.key}`, scope: ["scenes"] } });
}

/** Words of the active timeline's transcript, or none (structural edits then keep spoken-word triggers as written). */
export async function loadWords(client: DbOrTx, projectId: string): Promise<TimedWord[]> {
  const project = await client.project.findUnique({ where: { id: projectId }, include: { activeTimeline: true, activeTranscript: true } });
  const transcriptId = project?.activeTimeline?.transcriptId;
  if (!project || !transcriptId) return [];
  const transcript = transcriptId === project.activeTranscript?.id ? project.activeTranscript : await client.transcript.findUnique({ where: { id: transcriptId } });
  return (transcript?.words ?? []) as TimedWord[];
}

/** A split part's creative intent: its shot plan keeps only the shots that part still has. */
function partCreative(creative: Scene["creative"], spec: SceneSpec, hadShots: boolean) {
  if (creative === null) return Prisma.DbNull;
  const parsed = parseSceneCreative(creative);
  if (!parsed.ok || !hadShots || !parsed.value.shots?.length) return json(creative);
  const ids = new Set((spec.shots ?? []).map((s) => s.id));
  const shots = parsed.value.shots.filter((s) => ids.has(s.id));
  return json({ ...parsed.value, shots: shots.length ? shots : undefined });
}

/** The merged scene's intent: the first scene's, with the second scene's shot plan added (renamed shots follow). */
function mergedCreative(a: Scene, b: Scene, renamedShots: ReadonlyMap<string, string>) {
  const first = a.creative ? parseSceneCreative(a.creative) : null;
  const second = b.creative ? parseSceneCreative(b.creative) : null;
  const secondValue = second?.ok ? second.value : null;
  if (!first?.ok) return a.creative !== null ? json(a.creative) : secondValue ? json({ ...secondValue, shots: secondValue.shots?.map((s) => ({ ...s, id: renamedShots.get(s.id) ?? s.id })) }) : Prisma.DbNull;
  if (!secondValue?.shots?.length) return json(first.value);
  const shots = [...(first.value.shots ?? []), ...secondValue.shots.map((s) => ({ ...s, id: renamedShots.get(s.id) ?? s.id }))].slice(0, 12);
  const merged = parseSceneCreative({ ...first.value, shots });
  return json(merged.ok ? merged.value : first.value);
}

/**
 * Merges a scene with the next one, keeping both designs: each scene's content plays as shots at its
 * own time (see `mergeSceneSpecs`). Refused — without changing anything — when a spec is invalid or the
 * combined design wouldn't fit one scene.
 */
export async function mergeWithNext(projectId: string, idOrKey: string, actor: Actor) {
  const scenes = await db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const i = scenes.findIndex((s) => s.id === idOrKey || s.key === idOrKey);
  if (i < 0) throw notFound(`Scene “${idOrKey}”`);
  const a = scenes[i];
  const b = scenes[i + 1];
  if (!b) throw new AppError("VALIDATION", `${a.key} is the last scene — nothing to merge with.`);
  assertUnlocked(a);
  assertUnlocked(b);
  const specA = validateSceneSpec(a.spec);
  const specB = validateSceneSpec(b.spec);
  if (!specA.ok || !specB.ok) {
    throw new AppError("PRECONDITION", `The spec of ${!specA.ok ? a.key : b.key} is invalid — fix it before merging, so neither design is lost.`, { details: !specA.ok ? specA.issues : !specB.ok ? specB.issues : [] });
  }
  const [words, project] = await Promise.all([loadWords(db, projectId), db.project.findUnique({ where: { id: projectId }, select: { design: true } })]);
  const design = DesignSystemSchema.safeParse(project?.design);
  let merged: ReturnType<typeof mergeSceneSpecs>;
  try {
    merged = mergeSceneSpecs({ key: a.key, spec: specA.spec, start: a.startSec, end: a.endSec }, { key: b.key, spec: specB.spec, start: b.startSec, end: b.endSec }, { words, transition: design.success ? design.data.transition : undefined });
  } catch (err) {
    if (err instanceof SceneMergeLimitError) throw new AppError("VALIDATION", err.message, { hint: "Remove shots or elements from one of the scenes first — nothing was changed." });
    throw err;
  }
  const checked = validateSceneSpec(merged.spec);
  if (!checked.ok) throw new AppError("VALIDATION", `Could not combine the designs of ${a.key} and ${b.key} — nothing was changed.`, { details: checked.issues });
  const join = (x: string, y: string, separator: string, max: number) => [x, y].filter(Boolean).join(separator).slice(0, max);
  const list = (x: unknown, y: unknown, max: number) => {
    const all = [...(Array.isArray(x) ? x : []), ...(Array.isArray(y) ? y : [])];
    return all.filter((item, index) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(item)) === index).slice(0, max);
  };
  return mutateProject(projectId, actor, async (tx) => {
    const row = await tx.scene.update({
      where: { id: a.id },
      data: {
        endSec: b.endSec,
        wordEnd: b.wordEnd ?? a.wordEnd,
        voiceText: [a.voiceText, b.voiceText].filter(Boolean).join(" "),
        timingMode: a.timingMode === "audio_locked" && b.timingMode === "audio_locked" ? "audio_locked" : "user_adjusted",
        visualConcept: join(a.visualConcept, b.visualConcept, "\n\n", 4000),
        onScreenText: join(a.onScreenText, b.onScreenText, " / ", 600),
        animationNotes: json(list(a.animationNotes, b.animationNotes, 30)),
        assetsRequired: json(list(a.assetsRequired, b.assetsRequired, 20)),
        notes: join(a.notes, `Merged with ${b.key} “${b.name}”.`, " ", 8000),
        spec: json(checked.spec),
        creative: mergedCreative(a, b, merged.renamedShots),
        status: "draft",
        approvedAt: null,
        approvedFingerprint: null,
        version: { increment: 1 },
      },
    });
    await recordSceneVersion(tx, row, SOURCE_FOR_ACTOR[actor], `Merged with ${b.key} (both designs kept)`);
    await recordStoryboardRevision(tx, projectId, SOURCE_FOR_ACTOR[actor], `Before merge snapshot of ${b.key} kept in this revision`);
    await tx.scene.delete({ where: { id: b.id } });
    await renumberScenes(tx, projectId);
    return { result: { mergedInto: a.id, notes: merged.notes }, activity: { type: "scene.merged", message: `Merged ${b.key} “${b.name}” into ${a.key} (both designs kept)` } };
  }, { history: { label: `merge ${b.key} into ${a.key}`, scope: ["scenes"] } });
}

/**
 * Copies a scene's design into a new scene after the last one, with the same length and user-adjusted
 * timing. The voice-over owns the timeline, so a copy can't go between narrated scenes; its triggers
 * become times inside the scene. The source is only read, so a locked scene can be duplicated.
 */
export async function duplicateScene(projectId: string, idOrKey: string, actor: Actor) {
  const scene = await findScene(db, projectId, idOrKey);
  const current = validateSceneSpec(scene.spec);
  if (!current.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it before duplicating the scene.`, { details: current.issues });
  const [last, words] = await Promise.all([db.scene.findFirstOrThrow({ where: { projectId }, orderBy: { order: "desc" } }), loadWords(db, projectId)]);
  const start = last.endSec;
  const end = r3(start + Math.max(0.5, scene.endSec - scene.startSec));
  const copy = copySceneSpec(current.spec, { start: scene.startSec, end: scene.endSec }, { start, end }, words);
  const checked = validateSceneSpec(copy.spec);
  if (!checked.ok) throw new AppError("VALIDATION", `Could not copy the design of ${scene.key}.`, { details: checked.issues });
  return mutateProject(projectId, actor, async (tx) => {
    const row = await tx.scene.create({
      data: {
        projectId,
        key: `tmp_duplicate_${scene.id}`,
        order: last.order + 1,
        name: `${scene.name} (copy)`.slice(0, 120),
        startSec: start,
        endSec: end,
        timingMode: "user_adjusted",
        timelineId: last.timelineId,
        voiceText: "",
        visualConcept: scene.visualConcept,
        visualType: scene.visualType,
        animationNotes: json(scene.animationNotes),
        onScreenText: scene.onScreenText,
        assetsRequired: json(scene.assetsRequired),
        notes: `Duplicated from ${scene.key} “${scene.name}” (placed after the last scene).`,
        spec: json(checked.spec),
        creative: scene.creative === null ? Prisma.DbNull : json(scene.creative),
        source: SOURCE_FOR_ACTOR[actor],
      },
    });
    await recordSceneVersion(tx, row, SOURCE_FOR_ACTOR[actor], `Duplicated from ${scene.key}`);
    await renumberScenes(tx, projectId);
    await recordStoryboardRevision(tx, projectId, SOURCE_FOR_ACTOR[actor], `Duplicated ${scene.key} after ${last.key}`);
    const created = await tx.scene.findUniqueOrThrow({ where: { id: row.id } });
    return {
      result: { id: created.id, key: created.key, startSec: start, endSec: end, notes: copy.notes },
      activity: { type: "scene.duplicated", message: `Duplicated ${scene.key} “${scene.name}” as ${created.key} (${start.toFixed(2)}–${end.toFixed(2)}s)` },
    };
  }, { history: { label: `duplicate ${scene.key}`, scope: ["scenes"] } });
}

export const AppendSceneSchema = z.object({
  name: z.string().trim().min(1).max(120),
  durationSec: z.number().min(0.5).max(120),
  /** Words spoken in the scene when they come from a separate voice line (not the voice-over). */
  voiceText: z.string().trim().max(2000).optional(),
});

/**
 * Appends a user-adjusted scene after the last scene (an end card, or a CTA with its own voice line
 * on the audio timeline). It has no word anchors, so re-timing the voice-over keeps its seconds.
 */
export async function appendScene(projectId: string, input: z.input<typeof AppendSceneSchema>, actor: Actor) {
  const data = AppendSceneSchema.parse(input);
  const last = await db.scene.findFirst({ where: { projectId }, orderBy: { order: "desc" } });
  if (!last) throw new AppError("PRECONDITION", "Create a storyboard before appending scenes.");
  const start = last.endSec;
  const end = r3(start + data.durationSec);
  return mutateProject(projectId, actor, async (tx) => {
    const row = await tx.scene.create({
      data: {
        projectId,
        key: `tmp_append_${last.id}`,
        order: last.order + 1,
        name: data.name,
        startSec: start,
        endSec: end,
        timingMode: "user_adjusted",
        timelineId: last.timelineId,
        voiceText: data.voiceText ?? "",
        notes: "Appended after the narration (user-adjusted timing).",
        spec: json({ version: 1, elements: [] }),
        source: SOURCE_FOR_ACTOR[actor],
      },
    });
    await recordSceneVersion(tx, row, SOURCE_FOR_ACTOR[actor], `Appended at ${start.toFixed(2)}–${end.toFixed(2)}s`);
    await renumberScenes(tx, projectId);
    await recordStoryboardRevision(tx, projectId, SOURCE_FOR_ACTOR[actor], `Appended “${data.name}” after ${last.key}`);
    const created = await tx.scene.findUniqueOrThrow({ where: { id: row.id } });
    return {
      result: { key: created.key, startSec: start, endSec: end },
      activity: { type: "scene.appended", message: `Appended scene ${created.key} “${data.name}” (${start.toFixed(2)}–${end.toFixed(2)}s)` },
    };
  }, { history: { label: `add scene “${data.name}”`, scope: ["scenes"] } });
}

// ---------------------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------------------

export async function listSceneVersions(projectId: string, idOrKey: string) {
  const scene = await findScene(db, projectId, idOrKey);
  const versions = await db.sceneVersion.findMany({ where: { sceneId: scene.id }, orderBy: { version: "desc" } });
  return versions.map((v) => {
    const snap = v.snapshot as SceneSnapshot;
    return {
      version: v.version,
      source: v.source,
      message: v.message,
      createdAt: v.createdAt.toISOString(),
      name: snap.name,
      onScreenText: snap.onScreenText,
      visualConcept: snap.visualConcept,
      elements: Array.isArray((snap.spec as SceneSpec)?.elements) ? (snap.spec as SceneSpec).elements.length : 0,
      startSec: snap.startSec,
      endSec: snap.endSec,
      current: v.version === scene.version,
    };
  });
}

export async function restoreSceneVersion(projectId: string, idOrKey: string, version: number, actor: Actor, options: { keepTiming?: boolean } = {}) {
  const scene = await findScene(db, projectId, idOrKey);
  assertUnlocked(scene);
  const row = await db.sceneVersion.findUnique({ where: { sceneId_version: { sceneId: scene.id, version } } });
  if (!row) throw notFound(`${scene.key} v${version}`);
  const snap = row.snapshot as SceneSnapshot;
  const keepTiming = options.keepTiming ?? true;
  return mutateProject(projectId, actor, async (tx) => {
    const updated = await tx.scene.update({
      where: { id: scene.id },
      data: {
        name: snap.name,
        visualConcept: snap.visualConcept,
        visualType: snap.visualType,
        animationNotes: json(snap.animationNotes),
        onScreenText: snap.onScreenText,
        assetsRequired: json(snap.assetsRequired),
        notes: snap.notes,
        spec: json(snap.spec),
        // Versions saved before creative intent existed keep the current intent.
        ...(snap.creative !== undefined ? { creative: snap.creative === null ? Prisma.DbNull : json(snap.creative) } : {}),
        ...(keepTiming ? {} : { startSec: snap.startSec, endSec: snap.endSec, timingMode: snap.timingMode, wordStart: snap.wordStart, wordEnd: snap.wordEnd }),
        status: "draft",
        approvedAt: null,
        approvedFingerprint: null,
        version: { increment: 1 },
        source: "restore",
      },
    });
    await recordSceneVersion(tx, updated, "restore", `Restored v${version}${keepTiming ? " (timing kept)" : ""}`);
    return { result: sceneDto(updated), activity: { type: "scene.restored", message: `Restored ${scene.key} to v${version}${keepTiming ? " (timing kept)" : ""}` } };
  }, { history: { label: `restore ${scene.key} v${version}`, scope: ["scenes"] } });
}
