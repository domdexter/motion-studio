/**
 * Motion Studio CLI — the explicit action surface Claude Code uses to operate projects.
 *
 *   npm run studio -- <command> [arguments] [--flags]
 *   npm run studio -- help
 *
 * Every mutating command validates input, respects locked scenes, versions changes and records
 * activity attributed to "claude" (override with --actor user).
 */
import "@/server/env";
import fs from "node:fs/promises";
import path from "node:path";
import { DESIGN_PRESETS } from "@/core/design/presets";
import { allSpecElements, assetIdsInSpec, BLEND_MODES, CLIP_REVEALS, CLIP_SHAPES, validateSceneSpec, type SceneSpec } from "@/core/spec/scene";
import { collectSceneEvents } from "@/core/spec/triggers";
import type { TimedWord } from "@/core/spec/timing";
import { formatClock } from "@/core/timing/frames";
import { STATUS_LABELS, STAGE_KEYS } from "@/core/status/pipeline";
import { db } from "@/server/db";
import { AppError, isAppError } from "@/server/errors";
import { enqueueJob, getJob, publicJob } from "@/server/jobs/queue";
import { importAsset, listAssets } from "@/server/services/assets";
import { applyDesignPreset, updateDesign } from "@/server/services/brand";
import { materializeProject } from "@/server/services/context";
import type { Actor } from "@/server/services/mutation";
import { listProjects } from "@/server/services/projects";
import { applyScriptAnalysis, saveScript } from "@/server/services/script";
import { appendScene, findScene, generateStoryboardWithRules, moveSceneBoundary, sceneDto, setSceneLock, updateScene } from "@/server/services/scenes";
import { getProjectState } from "@/server/services/state";
import { applyScenesFile, applyStoryboardDocument, applyStoryboardFile, type ApplyReport } from "@/server/services/storyboard-io";
import { taskBriefMarkdown } from "@/server/services/task-brief";
import { appendTaskLog, completeAiTask, failAiTask, getAiTask, listPendingTasks, startAiTask } from "@/server/services/tasks";
import { getSystemHealth } from "@/server/services/system";
import { recalculateTimeline } from "@/server/services/timeline";
import { enqueueVoiceGeneration, getVoiceMix, updateVoiceMix } from "@/server/services/voice";
import { enqueueAlignment } from "@/server/services/alignment";
import { buildComposition } from "@/server/services/composition";
import { cancelRender, createRender, enqueueStill, enqueueThumbnail, getRender, listRenders, renameLegacyRenderFiles } from "@/server/services/renders";
import { createAssetRequest, failAssetRequest, fulfillAssetRequest, listAssetRequests, markAssetRequestGenerating, projectIdForRequest } from "@/server/services/asset-requests";
import { addAudioTrack, listAudioTracks, updateAudioTrack } from "@/server/services/audio-tracks";
import { addOverlayClip, listOverlayClips, removeOverlayClip, splitOverlayClip, updateOverlayClip } from "@/server/services/overlay-clips";
import { enqueueAudioGeneration } from "@/server/services/audio-generation";
import { MEDIA_PLACEMENTS, insertMediaIntoScene, splitSceneMedia, updateSceneMedia, type MediaPlacement, type SceneMediaPatch } from "@/server/services/scene-media";
import type { ElementRef } from "@/core/timeline/element-layout";
import { aiSceneContext, applyAiEditPlan } from "@/server/services/ai-edits";
import type { EditPlan } from "@/core/ai/edit-plan";
import { applySceneElementsOperation, updateSceneElement, type SceneElementPatch } from "@/server/services/scene-elements";
import { updateSceneLook } from "@/server/services/scene-look";
import type { SceneLookPatch } from "@/core/timeline/spec-patch";
import { captionsFile, chaptersForProject } from "@/server/services/publish";
import { findPausesAndFillers } from "@/core/timeline/voice-cleanup";
import { fitPlaybackRate, listSceneMedia, sceneMediaName, sceneVideoTiming, type SceneMediaItem } from "@/core/timeline/media-clip";
import { applyBrandKitToProject, createBrandKit, detachBrandKit, listBrandKits } from "@/server/services/brand-kits";
import { applySceneTemplate, deleteSceneTemplate, listSceneTemplates, saveSceneTemplate } from "@/server/services/scene-templates";
import { applyCreativePlan, getCreativeMetrics, getCreativePlan, listCreativeRevisions, restoreCreativeRevision } from "@/server/services/creative";
import { listCreativeReviews, requestCreativeReview, requestRefinement, saveCreativeReview, setReviewIssueStatus } from "@/server/services/creative-reviews";
import { ISSUE_STATUSES, type IssueStatus } from "@/core/creative/schema";
import { resolveShotWindows } from "@/core/spec/triggers";
import { elementCues, isCueId, type TriggerContext } from "@/core/spec/triggers";
import { EmphasisSchema, KEYFRAME_EASINGS, MOTION_PATH_TYPES, type KeyframeEasing, type MotionPath, type SceneElement, type Trigger } from "@/core/spec/scene";
import { KEYFRAME_PROPERTIES, animatableProperty, availableProperties, findKeyframeProperty, formatPropertyValue, keyframePropertiesFor, propertySupportIssue, propertyValueIssue, type AnimatableProperty, type KeyframeProperty } from "@/core/spec/animatable";
import { describeEasing } from "@/core/motion/easing";
import { midpoint, pathAsType, pathAt, pathLength } from "@/core/motion/path";
import { animatedProperties, keyframeTracks, removeKeyframesPatch, setKeyframe, updateKeyframe, valueAt } from "@/core/motion/keyframes";
import { cueLabel, describeTrigger } from "@/core/timeline/element-cues";
import { elementSpan, triggerAtTime } from "@/core/timeline/scene-restructure";
import { importPendingContextFiles } from "@/server/sync/importer";
import { AssetKindSchema } from "@/core/spec/enums";

type Flags = Record<string, string | boolean>;

interface Command {
  usage: string;
  description: string;
  run: (args: string[], flags: Flags) => Promise<void>;
}

const tty = process.stdout.isTTY;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c(32);
const red = c(31);
const yellow = c(33);
const dim = c(2);
const bold = c(1);
const cyan = c(36);

/** How an element composites, in one line — for scene:effect and scene:clip. */
function describeCompositing(el: SceneElement): string {
  const parts: string[] = [];
  if (el.blend && el.blend !== "normal") parts.push(el.blend);
  const e = el.effects;
  if (e?.blur) parts.push(`blur ${e.blur}`);
  if (e?.glow) parts.push(`glow ${e.glow}${e.glowColor ? ` ${e.glowColor}` : ""}`);
  if (e?.shadowBlur || e?.shadowX || e?.shadowY) parts.push(`shadow ${e.shadowX ?? 0},${e.shadowY ?? 0},${e.shadowBlur ?? 0}${e.shadowColor ? ` ${e.shadowColor}` : ""}`);
  for (const key of ["brightness", "contrast", "saturate"] as const) if (e?.[key] !== undefined) parts.push(`${key} ${e[key]}`);
  const c = el.clip;
  if (c) parts.push(`${c.type} clip${c.inset ? ` inset ${c.inset.join(",")}` : ""}${c.reveal && c.reveal !== "none" ? ` reveal ${c.reveal} ${Math.round((c.progress ?? 1) * 100)}%` : ""}`);
  return parts.length ? parts.join(" · ") : "no compositing";
}

interface CueEntry {
  element: SceneElement;
  ref: ElementRef;
  /** Its scene's timing, narrowed to its shot. */
  segment: TriggerContext;
}

/** A scene's elements with the timing and words their cues resolve against (scene:cues, scene:cue). */
async function sceneCueContext(projectId: string, scene: { key: string; spec: unknown; startSec: number; endSec: number }) {
  const v = validateSceneSpec(scene.spec);
  if (!v.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it first.`);
  const project = await db.project.findUnique({ where: { id: projectId }, include: { activeTranscript: true } });
  const words = (project?.activeTranscript?.words ?? []) as TimedWord[];
  const base: TriggerContext = { words, sceneStart: scene.startSec, sceneEnd: scene.endSec };
  const windows = resolveShotWindows(v.spec, base);
  // A group's children are elements of the scene too: they keep their own cues, keyframes and ids.
  const withChildren = (element: SceneElement, ref: { shotId: string | null; index: number }, segment: TriggerContext): CueEntry[] =>
    element.type === "group" ? [{ element, ref, segment }, ...element.children.map((child, at) => ({ element: child as SceneElement, ref: { ...ref, child: at }, segment }))] : [{ element, ref, segment }];
  const elements: CueEntry[] = [
    ...v.spec.elements.flatMap((element, index) => withChildren(element, { shotId: null, index }, base)),
    ...(v.spec.shots ?? []).flatMap((shot, i) => shot.elements.flatMap((element, index) => withChildren(element, { shotId: shot.id, index }, { ...base, shotStart: windows[i].start, shotEnd: windows[i].end }))),
  ];
  const nameOf = (e: CueEntry) => e.element.id ?? `${e.ref.shotId ? `${e.ref.shotId}/` : ""}#${e.ref.index + 1}${e.ref.child === undefined ? "" : `.${e.ref.child + 1}`}`;
  const find = (name: string) => {
    const m = /^(?:([A-Za-z0-9_-]+)\/)?#(\d+)$/.exec(name);
    const found = elements.find((e) => e.element.id === name) ?? (m ? elements.find((e) => e.ref.shotId === (m[1] ?? null) && e.ref.index === Number(m[2]) - 1) : undefined);
    if (!found) throw new AppError("NOT_FOUND", `No element “${name}” in ${scene.key}. Its elements: ${elements.map(nameOf).join(", ") || "none"}.`);
    return found;
  };
  return { words, elements, nameOf, find };
}

/**
 * A cue moment from the command line: word:<word>[#n] (the nth time it's spoken in the scene),
 * phrase:<words>[#n], wordIndex:<n>, scene:<seconds into the scene>, video:<seconds>, start (its scene
 * or shot start) or none/default (null: clears the cue). --edge end fires as a word ends; --offset adds seconds.
 */
function parseCueMoment(value: string, segment: TriggerContext, flags: Flags): Trigger | null {
  if (value === "none" || value === "default") return null;
  if (value === "start") return segment.shotStart !== undefined ? { type: "shotStart" } : { type: "sceneStart" };
  const edge = flags.edge === "end" ? { edge: "end" as const } : {};
  const offset = typeof flags.offset === "string" ? { offset: Number(flags.offset) } : {};
  const colon = value.indexOf(":");
  const kind = colon < 0 ? value : value.slice(0, colon);
  const body = colon < 0 ? "" : value.slice(colon + 1);
  const spoken = (text: string) => {
    const m = /^(.*)#(\d+)$/.exec(text);
    return m ? { value: m[1], occurrence: Number(m[2]) } : { value: text };
  };
  switch (kind) {
    case "word":
      return { type: "word", ...spoken(body), ...edge, ...offset };
    case "phrase":
      return { type: "phrase", ...spoken(body), ...edge, ...offset };
    case "wordIndex":
      return { type: "wordIndex", index: Number(body), ...edge, ...offset };
    case "scene":
      return triggerAtTime(segment.sceneStart + Number(body), segment);
    case "video":
      return triggerAtTime(Number(body), segment);
    default:
      throw new AppError("VALIDATION", `Unknown moment “${value}”. Use word:<word>[#n], phrase:<words>[#n], wordIndex:<n>, scene:<seconds>, video:<seconds>, start or none.`);
  }
}

/** One element's cues: id, what, when it fires and what it's cued to. */
function printCues(entry: CueEntry, name: string, words: TimedWord[]) {
  const inShot = entry.segment.shotStart !== undefined;
  const start = entry.segment.shotStart ?? entry.segment.sceneStart;
  const cues = elementCues(entry.element, entry.segment, entry.ref.shotId);
  console.log(`${bold(name)} ${dim(`(${entry.element.type}${entry.ref.shotId ? ` · shot ${entry.ref.shotId}` : ""})`)}`);
  if (!cues.length) console.log(dim(`  no cues — it appears when its ${inShot ? "shot" : "scene"} starts`));
  for (const cue of cues) {
    const source = cue.spoken ? "as its words are spoken (voice sync)" : describeTrigger(cue.trigger, cue.kind === "exit" ? "end" : "start", inShot, words);
    const line = `  ${cue.id.padEnd(12)} ${`${cueLabel(cue.id, entry.element.type)} · ${cue.name}`.padEnd(26)} ${cue.time.toFixed(2)}s (${(cue.time - start).toFixed(2)}s in) · ${source}${cue.delay ? ` + ${cue.delay}s` : ""}`;
    console.log(cue.ok ? line : red(`${line}  ✖ ${cue.reason}`));
  }
}

/** One element's keyframes by property: id, video second, seconds after it appears, value and easing. */
function printKeyframes(entry: CueEntry, name: string) {
  const el = entry.element;
  const span = elementSpan(el, entry.segment);
  console.log(`${bold(name)} ${dim(`(${el.type}${entry.ref.shotId ? ` · shot ${entry.ref.shotId}` : ""} · on screen ${span.appear.toFixed(2)}–${span.gone.toFixed(2)}s)`)}`);
  const properties = animatedProperties(el);
  if (!properties.length) {
    console.log(dim(`  no keyframes — it can animate ${keyframePropertiesFor(el.type).join(", ")}`));
    return;
  }
  const tracks = keyframeTracks(el.keyframes);
  for (const property of properties) {
    console.log(`  ${animatableProperty(property).label}`);
    for (const k of tracks.get(property) ?? []) {
      const outside = k.time > span.gone - span.appear + 0.001;
      const value = formatPropertyValue(property, k.value, true);
      console.log(`    ${k.id.padEnd(12)} ${(span.appear + k.time).toFixed(2)}s (${k.time.toFixed(2)}s after it appears) · ${value} · ${describeEasing(k.easing)}${outside ? yellow(" · after it's gone") : ""}`);
    }
  }
}

/** A keyframe value written for the command line, in whatever the property's value type is (a number, a #hex colour, or "x,y"). */
function parseKeyframeValue(raw: string | undefined, property: AnimatableProperty) {
  if (raw === undefined) return undefined;
  if (property.value === "color") return raw;
  if (property.value === "point") {
    const parts = raw.split(",").map((n) => Number(n.trim()));
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) throw new AppError("VALIDATION", `“${raw}” isn't a point — write it as x,y (e.g. 40,60).`);
    return [parts[0], parts[1]] as [number, number];
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new AppError("VALIDATION", `“${raw}” isn't a number.`);
  return value;
}

/** --easing: a named curve, hold, or a custom cubic Bézier written custom:x1,y1,x2,y2. */
function parseEasing(raw: string | undefined) {
  if (raw === undefined) return undefined;
  if (raw.startsWith("custom:") || raw.startsWith("bezier:")) {
    const parts = raw.slice(raw.indexOf(":") + 1).split(",").map((n) => Number(n.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new AppError("VALIDATION", `A custom curve is four numbers: custom:x1,y1,x2,y2 (like CSS cubic-bezier).`);
    if (parts[0] < 0 || parts[0] > 1 || parts[2] < 0 || parts[2] > 1) throw new AppError("VALIDATION", "A custom curve's x values (the 1st and 3rd) run from 0 to 1 — time can't go backwards.");
    return { bezier: [parts[0], parts[1], parts[2], parts[3]] as [number, number, number, number] };
  }
  if (!(KEYFRAME_EASINGS as readonly string[]).includes(raw)) throw new AppError("VALIDATION", `Unknown easing “${raw}”. Use ${KEYFRAME_EASINGS.join(", ")} or custom:x1,y1,x2,y2.`);
  return raw as KeyframeEasing;
}

/** A point written "x,y" in % of the frame. */
function parsePoint(raw: string | undefined, flag: string) {
  if (raw === undefined) return undefined;
  const parts = raw.split(",").map((n) => Number(n.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) throw new AppError("VALIDATION", `--${flag} is a point in % of the frame, written x,y (e.g. 20,80).`);
  return [parts[0], parts[1]] as [number, number];
}

/** A keyframe moment from the command line, as seconds after the element appears: at:<seconds after it appears>, scene:<seconds into the scene> or video:<seconds>. */
function parseKeyframeMoment(value: string, entry: CueEntry): number {
  const appear = elementSpan(entry.element, entry.segment).appear;
  const colon = value.indexOf(":");
  const n = Number(value.slice(colon + 1));
  const kind = colon < 0 ? "" : value.slice(0, colon);
  if (colon < 0 || !Number.isFinite(n)) throw new AppError("VALIDATION", `Unknown moment “${value}”. Use at:<seconds after it appears>, scene:<seconds into the scene> or video:<seconds>.`);
  if (kind === "at") return n;
  if (kind === "scene") return entry.segment.sceneStart + n - appear;
  if (kind === "video") return n - appear;
  throw new AppError("VALIDATION", `Unknown moment “${value}”. Use at:<seconds after it appears>, scene:<seconds into the scene> or video:<seconds>.`);
}

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) flags[key] = inline;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
      else flags[key] = true;
    } else positional.push(a);
  }
  return { command: positional.shift() ?? "help", positional, flags };
}

function actorOf(flags: Flags): Actor {
  return flags.actor === "user" ? "user" : "claude";
}

function need(args: string[], index: number, name: string): string {
  const v = args[index];
  if (!v) throw new AppError("BAD_REQUEST", `Missing <${name}>.`);
  return v;
}

function str(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function table(rows: Record<string, unknown>[], columns: string[]): void {
  if (!rows.length) {
    console.log(dim("  (none)"));
    return;
  }
  const widths = columns.map((col) => Math.min(60, Math.max(col.length, ...rows.map((r) => String(r[col] ?? "").length))));
  console.log("  " + columns.map((col, i) => bold(col.padEnd(widths[i]))).join("  "));
  for (const r of rows) console.log("  " + columns.map((col, i) => String(r[col] ?? "").slice(0, 60).padEnd(widths[i])).join("  "));
}

async function readJsonFile(file: string): Promise<unknown> {
  const text = await fs.readFile(path.resolve(file), "utf8").catch(() => {
    throw new AppError("BAD_REQUEST", `Cannot read ${file}`);
  });
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new AppError("VALIDATION", `${file} is not valid JSON: ${(err as Error).message}`);
  }
}

async function resolveProject(ref: string | undefined): Promise<string> {
  if (!ref) throw new AppError("BAD_REQUEST", "Missing <project>. Run `npm run studio -- projects` to list ids.");
  const exact = await db.project.findUnique({ where: { id: ref }, select: { id: true } });
  if (exact) return exact.id;
  const matches = await db.project.findMany({
    where: { OR: [{ id: { startsWith: ref } }, { name: { contains: ref, mode: "insensitive" } }] },
    select: { id: true, name: true },
    take: 10,
  });
  if (matches.length === 1) return matches[0].id;
  if (!matches.length) throw new AppError("NOT_FOUND", `No project matches “${ref}”.`);
  throw new AppError("BAD_REQUEST", `“${ref}” matches several projects: ${matches.map((m) => m.id).join(", ")}`);
}

function printReport(report: ApplyReport): void {
  if (report.applied.length) console.log(green(`✔ applied: ${report.applied.join(", ")}`));
  if (report.unchanged.length) console.log(dim(`  unchanged: ${report.unchanged.join(", ")}`));
  if (report.skippedLocked.length) console.log(yellow(`! locked (not changed): ${report.skippedLocked.join(", ")}`));
  for (const w of report.warnings) console.log(yellow(`! ${w}`));
  for (const cf of report.conflicts) console.log(yellow(`! conflict: ${cf}`));
  for (const e of report.errors) console.log(red(`✖ ${e.scene} ${e.path ? `(${e.path})` : ""}: ${e.message}`));
  if (report.errors.length) process.exitCode = 1;
}

async function waitForJob(jobId: string): Promise<void> {
  process.stdout.write(dim(`  waiting for job ${jobId}`));
  for (;;) {
    const job = publicJob(await getJob(jobId));
    if (["succeeded", "failed", "cancelled"].includes(job.status)) {
      process.stdout.write("\n");
      if (job.status === "succeeded") console.log(green(`✔ ${job.type} succeeded`), JSON.stringify(job.result));
      else {
        console.log(red(`✖ ${job.type} ${job.status}: ${job.error?.message ?? ""}`));
        if (job.error?.hint) console.log(dim(`  ${job.error.hint}`));
        process.exitCode = 1;
      }
      return;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const COMMANDS: Record<string, Command> = {
  help: {
    usage: "help",
    description: "List commands",
    run: async () => {
      console.log(bold("Motion Studio CLI") + dim("  npm run studio -- <command> [args] [--flags]\n"));
      for (const [name, cmd] of Object.entries(COMMANDS)) console.log(`  ${cyan(cmd.usage.padEnd(58))} ${dim(cmd.description)}`);
      console.log(dim("\nMutating commands act as “claude” by default; pass --actor user to attribute to the user. See AI_WORKFLOW.md."));
    },
  },

  doctor: {
    usage: "doctor",
    description: "Check database, worker, ffmpeg and Claude CLI",
    run: async () => {
      const h = await getSystemHealth();
      console.log(`${h.database.ok ? green("✔") : red("✖")} database ${h.database.error ?? ""}`);
      console.log(`${h.worker.online ? green("✔") : yellow("!")} worker ${h.worker.online ? "online" : "offline (start with npm run dev)"}`);
      console.log(`${h.ffmpeg.ok ? green("✔") : red("✖")} ffmpeg ${h.ffmpeg.path ?? ""}`);
      console.log(`${h.claudeCli.found ? green("✔") : yellow("!")} claude CLI ${h.claudeCli.version ?? ""}`);
      console.log(`  projects dir: ${h.storage.projectsDir}`);
    },
  },

  projects: {
    usage: "projects [--archived]",
    description: "List projects",
    run: async (_a, flags) => {
      const projects = await listProjects({ filter: flags.archived ? "archived" : "all" });
      table(
        projects.map((p) => ({ id: p.id, name: p.name, status: p.statusLabel, next: p.stage, scenes: p.sceneCount, duration: p.durationSec ? formatClock(p.durationSec) : "—" })),
        ["id", "name", "status", "next", "scenes", "duration"],
      );
    },
  },

  context: {
    usage: "context <project>",
    description: "Summarize project state and refresh .project/ files",
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      await materializeProject(projectId);
      const [project, state, scenes, tasks, requests] = await Promise.all([
        db.project.findUnique({ where: { id: projectId }, include: { activeVoiceTake: true, activeTranscript: true, activeTimeline: true } }),
        getProjectState(projectId),
        db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
        listPendingTasks(projectId),
        db.assetRequest.findMany({ where: { projectId, status: { in: ["requested", "generating", "generated"] } } }),
      ]);
      if (!project) return;
      console.log(bold(`${project.name}`) + dim(`  (${project.id})`));
      console.log(`  ${project.width}×${project.height} @ ${project.fps}fps · ${STATUS_LABELS[state.pipeline.status]} · duration ${state.durationSec ? formatClock(state.durationSec) : "—"}`);
      console.log(`  next: ${state.pipeline.next?.label ?? "nothing pending"}`);
      console.log(bold("\nPipeline"));
      for (const key of STAGE_KEYS) {
        const s = state.pipeline.stages[key];
        const icon = s.state === "ready" || s.state === "optional" ? green("✔") : s.state === "stale" ? yellow("⟳") : s.state === "attention" ? yellow("!") : s.state === "running" ? cyan("…") : dim("○");
        console.log(`  ${icon} ${key.padEnd(11)} ${s.label}${s.reason ? dim(` — ${s.reason}`) : ""}`);
      }
      console.log(bold("\nAudio"));
      console.log(`  voice: ${project.activeVoiceTake ? `v${project.activeVoiceTake.version} ${project.activeVoiceTake.source} ${formatClock(project.activeVoiceTake.durationSec)} (${project.activeVoiceTake.filePath})` : "none"}`);
      console.log(`  transcript: ${project.activeTranscript ? `v${project.activeTranscript.version} ${project.activeTranscript.source} · ${project.activeTranscript.wordCount} words` : "none"}`);
      console.log(`  timeline: ${project.activeTimeline ? `v${project.activeTimeline.version} · ${formatClock(project.activeTimeline.durationSec)}` : "none"}`);
      console.log(bold("\nScenes"));
      table(
        scenes.map((s) => {
          const info = state.scenes[s.id];
          return {
            key: s.key,
            name: s.name,
            time: `${s.startSec.toFixed(2)}–${s.endSec.toFixed(2)}`,
            timing: s.timingMode === "audio_locked" ? "audio" : "user",
            status: s.status,
            locked: s.locked ? "LOCKED" : "",
            spec: info?.valid ? `${(s.spec as SceneSpec).elements?.length ?? 0} el` : red("invalid"),
          };
        }),
        ["key", "name", "time", "timing", "status", "locked", "spec"],
      );
      console.log(bold("\nPending AI tasks"));
      table(tasks.map((t) => ({ id: t.id, type: t.type, status: t.status, title: t.title })), ["id", "type", "status", "title"]);
      console.log(bold("\nOpen asset requests"));
      table(requests.map((r) => ({ id: r.id, kind: r.kind, status: r.status, prompt: r.prompt })), ["id", "kind", "status", "prompt"]);
      console.log(dim(`\nContext files: projects/${projectId}/.project/  (README.md explains each file)`));
    },
  },

  sync: {
    usage: "sync <project>",
    description: "Re-materialize .project/ from the database",
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      await materializeProject(projectId);
      console.log(green(`✔ .project/ refreshed for ${projectId}`));
    },
  },

  apply: {
    usage: "apply <project>",
    description: "Import pending edits of editable .project files (validated, 3-way merged)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const results = await importPendingContextFiles(projectId, flags.actor === "user" ? "user" : "claude");
      for (const r of results) {
        const icon = r.status === "applied" ? green("✔") : r.status === "rejected" ? red("✖") : dim("·");
        console.log(`${icon} ${r.file.padEnd(18)} ${r.message}`);
        if (r.report) printReport(r.report);
        if (r.status === "rejected") process.exitCode = 1;
      }
    },
  },

  validate: {
    usage: "validate <project>",
    description: "Validate scene specs, word triggers, assets and timing coverage",
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      const project = await db.project.findUnique({ where: { id: projectId }, include: { activeTranscript: true, activeTimeline: true } });
      const scenes = await db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
      const assets = new Set((await db.asset.findMany({ where: { projectId }, select: { id: true } })).map((a) => a.id));
      const words = (project?.activeTranscript?.words ?? []) as TimedWord[];
      let errors = 0;
      let warnings = 0;
      for (let i = 0; i < scenes.length; i++) {
        const s = scenes[i];
        const v = validateSceneSpec(s.spec);
        if (!v.ok) {
          errors += v.issues.length;
          for (const issue of v.issues) console.log(red(`✖ ${s.key} spec ${issue.path}: ${issue.message}`));
          continue;
        }
        for (const ev of collectSceneEvents(v.spec, { words, sceneStart: s.startSec, sceneEnd: s.endSec })) {
          if (!ev.ok) {
            warnings++;
            console.log(yellow(`! ${s.key} ${ev.label}: ${ev.reason}`));
          }
        }
        for (const id of assetIdsInSpec(v.spec)) {
          if (!assets.has(id)) {
            errors++;
            console.log(red(`✖ ${s.key}: scene requires asset ${id} (not in the asset library)`));
          }
        }
        for (const { element: el, shotId } of allSpecElements(v.spec)) {
          if (el.type === "text" && el.text.split(/\s+/).length > 14) {
            warnings++;
            console.log(yellow(`! ${s.key} ${shotId ? `${shotId}/` : ""}${el.id ?? "text"}: ${el.text.split(/\s+/).length} words on screen — consider shortening`));
          }
        }
        if (i > 0 && Math.abs(scenes[i - 1].endSec - s.startSec) > 0.002) {
          warnings++;
          console.log(yellow(`! gap/overlap between ${scenes[i - 1].key} (${scenes[i - 1].endSec}) and ${s.key} (${s.startSec})`));
        }
      }
      const lastScene = scenes[scenes.length - 1];
      if (project?.activeTimeline && lastScene && Math.abs(lastScene.endSec - project.activeTimeline.durationSec) > 0.05) {
        if (lastScene.timingMode === "user_adjusted" && lastScene.endSec > project.activeTimeline.durationSec) {
          // An appended end card or CTA runs past the voice-over on purpose.
          console.log(dim(`ℹ ${lastScene.key} runs past the voice-over (${project.activeTimeline.durationSec}s) to ${lastScene.endSec}s — user-adjusted tail`));
        } else {
          warnings++;
          console.log(yellow(`! last scene ends at ${lastScene.endSec}s but the timeline is ${project.activeTimeline.durationSec}s`));
        }
      }
      console.log(errors ? red(`✖ ${errors} error(s), ${warnings} warning(s)`) : green(`✔ valid · ${warnings} warning(s) · ${scenes.length} scenes`));
      if (errors) process.exitCode = 1;
    },
  },

  tasks: {
    usage: "tasks [project]",
    description: "List pending/running AI tasks",
    run: async (args) => {
      const projectId = args[0] ? await resolveProject(args[0]) : undefined;
      const tasks = await listPendingTasks(projectId);
      table(tasks.map((t) => ({ id: t.id, project: t.projectId, type: t.type, status: t.status, title: t.title })), ["id", "project", "type", "status", "title"]);
    },
  },

  "task:show": {
    usage: "task:show <taskId>",
    description: "Print a task brief",
    run: async (args) => {
      const task = await getAiTask(need(args, 0, "taskId"));
      const scenes = await db.scene.findMany({ where: { projectId: task.projectId }, select: { id: true, key: true } });
      const project = await db.project.findUnique({ where: { id: task.projectId }, select: { name: true } });
      console.log(await taskBriefMarkdown(task, { projectName: project?.name ?? task.projectId, keyById: new Map(scenes.map((s) => [s.id, s.key])) }));
    },
  },

  "task:start": {
    usage: "task:start <taskId>",
    description: "Mark a task as running (claimed by Claude)",
    run: async (args) => {
      const t = await startAiTask(need(args, 0, "taskId"), "claude");
      console.log(green(`✔ ${t.id} running — ${t.title}`));
    },
  },

  "task:log": {
    usage: "task:log <taskId> <message…>",
    description: "Append a progress note visible in the GUI",
    run: async (args) => {
      await appendTaskLog(need(args, 0, "taskId"), args.slice(1).join(" "));
      console.log(green("✔ logged"));
    },
  },

  "task:complete": {
    usage: "task:complete <taskId> --summary \"…\"",
    description: "Complete a task with a summary of what changed",
    run: async (args, flags) => {
      const summary = str(flags, "summary");
      if (!summary) throw new AppError("BAD_REQUEST", "--summary is required.");
      const t = await completeAiTask(need(args, 0, "taskId"), summary, "claude");
      console.log(green(`✔ completed ${t.id}`));
    },
  },

  "task:fail": {
    usage: "task:fail <taskId> --error \"…\"",
    description: "Fail a task with the reason",
    run: async (args, flags) => {
      const t = await failAiTask(need(args, 0, "taskId"), str(flags, "error") ?? "Failed", "claude");
      console.log(yellow(`! marked ${t.id} as failed`));
    },
  },

  "script:save": {
    usage: "script:save <project> <file.md> [--note \"…\"]",
    description: "Save a script revision from a file",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const content = await fs.readFile(path.resolve(need(args, 1, "file")), "utf8");
      const res = await saveScript(projectId, { content, note: str(flags, "note") }, actorOf(flags));
      console.log(res.created ? green(`✔ saved script v${res.version}${res.spokenChanged ? "" : " (formatting only)"}`) : dim("  no changes"));
    },
  },

  "analysis:apply": {
    usage: "analysis:apply <project> <analysis.json>",
    description: "Attach a script analysis (beats, emphasis, visual opportunities)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const analysis = await applyScriptAnalysis(projectId, await readJsonFile(need(args, 1, "file")), actorOf(flags));
      console.log(green(`✔ analysis applied: ${analysis.beats.length} beats`));
    },
  },

  "storyboard:draft": {
    usage: "storyboard:draft <project> [--pace fast|medium|slow] [--scenes a,b] [--restructure]",
    description: "Rule-based storyboard draft (or regenerate unlocked scenes)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const res = await generateStoryboardWithRules(
        projectId,
        { pace: str(flags, "pace") as "fast" | "medium" | "slow" | undefined, sceneIds: str(flags, "scenes")?.split(","), restructure: !!flags.restructure },
        actorOf(flags),
      );
      console.log(green("✔"), JSON.stringify(res));
    },
  },

  "storyboard:apply": {
    usage: "storyboard:apply <project> <file.json> [--scenes a,b]",
    description: "Apply a storyboard document ({mode, scenes:[…spec]}) or storyboard.json",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const doc = (await readJsonFile(need(args, 1, "file"))) as { mode?: string; scenes?: { spec?: unknown; sceneId?: string }[] };
      const onlyKeys = str(flags, "scenes")?.split(",");
      const isDocument = !!doc.mode || (Array.isArray(doc.scenes) && doc.scenes.some((s) => s && typeof s === "object" && "spec" in s));
      const report = isDocument ? await applyStoryboardDocument(projectId, doc, actorOf(flags), { onlyKeys }) : await applyStoryboardFile(projectId, doc, actorOf(flags), { onlyKeys });
      printReport(report);
    },
  },

  "scenes:apply": {
    usage: "scenes:apply <project> <scenes.json> [--scenes a,b]",
    description: "Apply scene specs in scenes.json format (atomic validation)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      printReport(await applyScenesFile(projectId, await readJsonFile(need(args, 1, "file")), actorOf(flags), { onlyKeys: str(flags, "scenes")?.split(",") }));
    },
  },

  "scene:show": {
    usage: "scene:show <project> <scene_key>",
    description: "Print a scene's storyboard, spec, spoken words and resolved events",
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene_key"));
      const project = await db.project.findUnique({ where: { id: projectId }, include: { activeTranscript: true } });
      const words = (project?.activeTranscript?.words ?? []) as TimedWord[];
      const dto = sceneDto(scene);
      console.log(bold(`${dto.key} “${dto.name}”`) + dim(`  ${dto.startSec.toFixed(2)}–${dto.endSec.toFixed(2)}s · ${dto.timingMode} · ${dto.status}${dto.locked ? " · LOCKED" : ""} · v${dto.version}`));
      console.log(`voice: ${dto.voiceText}`);
      console.log(`concept: ${dto.visualConcept}`);
      console.log(`on-screen: ${dto.onScreenText}`);
      if (dto.creative) console.log(`creative: ${JSON.stringify(dto.creative)}`);
      else console.log(dim("creative: (no creative intent recorded)"));
      const sceneWords = words.filter((w) => w.start >= dto.startSec - 0.08 && w.start < dto.endSec);
      console.log(dim(`words: ${sceneWords.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(" ")}`));
      const v = validateSceneSpec(scene.spec);
      if (v.ok) {
        for (const w of resolveShotWindows(v.spec, { words, sceneStart: dto.startSec, sceneEnd: dto.endSec })) {
          console.log(`${w.ok ? cyan("▸") : yellow("!")} shot ${w.id} ${w.start.toFixed(2)}–${w.end.toFixed(2)}s (${(w.end - w.start).toFixed(2)}s)${w.reason ? yellow(` ${w.reason}`) : ""}`);
        }
        for (const ev of collectSceneEvents(v.spec, { words, sceneStart: dto.startSec, sceneEnd: dto.endSec })) {
          console.log(`${ev.ok ? dim("·") : yellow("!")} ${ev.time.toFixed(2)}s ${ev.label}${ev.voiceSynced ? cyan(" [voice]") : ""}${ev.reason ? yellow(` ${ev.reason}`) : ""}`);
        }
      }
      console.log(JSON.stringify(scene.spec, null, 2));
    },
  },

  "scene:apply": {
    usage: "scene:apply <project> <scene_key> <file.json> [--message \"…\"]",
    description: "Update one scene: a SceneSpec, or {spec?, name?, visualConcept?, onScreenText?, …}. Timing is kept",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const key = need(args, 1, "scene_key");
      const input = (await readJsonFile(need(args, 2, "file"))) as Record<string, unknown>;
      const patch = Array.isArray(input.elements) ? { spec: input } : input;
      const scene = await updateScene(projectId, key, patch, actorOf(flags), { message: str(flags, "message") });
      console.log(green(`✔ ${scene.key} updated to v${scene.version}`));
    },
  },

  "scene:timing": {
    usage: "scene:timing <project> <scene_key> [--start s] [--end s] [--free]",
    description: "EXPLICIT timing change (only when requested). Snaps to words unless --free",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const key = need(args, 1, "scene_key");
      const scenes = await db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
      const idx = scenes.findIndex((s) => s.key === key);
      if (idx < 0) throw new AppError("NOT_FOUND", `No scene ${key}`);
      const snap = !flags.free;
      if (str(flags, "start") !== undefined) {
        if (idx === 0) throw new AppError("VALIDATION", "The first scene always starts at 0.");
        console.log(JSON.stringify(await moveSceneBoundary(projectId, scenes[idx - 1].id, { timeSec: Number(flags.start), snap }, actorOf(flags))));
      }
      if (str(flags, "end") !== undefined) {
        console.log(JSON.stringify(await moveSceneBoundary(projectId, scenes[idx].id, { timeSec: Number(flags.end), snap }, actorOf(flags))));
      }
    },
  },

  "scene:append": {
    usage: 'scene:append <project> --name "…" --duration 3.5 [--voice-text "…"]',
    description: "Append a user-adjusted scene after the last scene (end card, or a CTA with its own voice line) — only when asked",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const r = await appendScene(projectId, { name: str(flags, "name") ?? "", durationSec: Number(str(flags, "duration")), voiceText: str(flags, "voice-text") }, actorOf(flags));
      console.log(green(`✔ ${r.key}`), dim(`${r.startSec.toFixed(2)}–${r.endSec.toFixed(2)}s · user-adjusted timing`));
    },
  },

  "scene:lock": {
    usage: "scene:lock <project> <scene_key> [--unlock]",
    description: "Lock/unlock a scene (only when the user asks)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      await setSceneLock(projectId, need(args, 1, "scene_key"), !flags.unlock, actorOf(flags));
      console.log(green(`✔ ${flags.unlock ? "unlocked" : "locked"}`));
    },
  },

  "design:apply": {
    usage: "design:apply <project> <design.json>",
    description: "Replace the motion design system (validated)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      await updateDesign(projectId, await readJsonFile(need(args, 1, "file")), actorOf(flags));
      console.log(green("✔ design system updated"));
    },
  },

  "design:preset": {
    usage: `design:preset <project> <${DESIGN_PRESETS.map((p) => p.id).join("|")}> [--keep-colors] [--keep-fonts]`,
    description: "Switch the design preset for the whole video",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      await applyDesignPreset(projectId, need(args, 1, "preset"), { keepColors: !!flags["keep-colors"], keepFonts: !!flags["keep-fonts"] }, actorOf(flags));
      console.log(green("✔ preset applied"));
    },
  },

  assets: {
    usage: "assets <project> [--kind image,video]",
    description: "List assets",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const assets = await listAssets(projectId, str(flags, "kind")?.split(","));
      table(assets.map((a) => ({ id: a.id, kind: a.kind, name: a.name, size: a.width ? `${a.width}×${a.height}` : "", scene: a.sceneKey ?? "", file: a.filePath })), ["id", "kind", "name", "size", "scene", "file"]);
    },
  },

  "assets:import": {
    usage: "assets:import <project> <file> --kind image [--name …] [--scene scene_03] [--prompt …] [--source claude|upload|hyperframes|import]",
    description: "Copy a file into the project asset library (e.g. a HyperFrames clip with --kind video --source hyperframes)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const file = path.resolve(need(args, 1, "file"));
      const kind = AssetKindSchema.parse(str(flags, "kind") ?? "image");
      const sceneKeyFlag = str(flags, "scene");
      const scene = sceneKeyFlag ? await findScene(db, projectId, sceneKeyFlag) : null;
      const sourceFlag = str(flags, "source");
      const sources = ["claude", "upload", "hyperframes", "import"] as const;
      if (sourceFlag && !(sources as readonly string[]).includes(sourceFlag)) throw new AppError("VALIDATION", `--source must be one of ${sources.join(", ")}`);
      const source = (sourceFlag as (typeof sources)[number] | undefined) ?? (actorOf(flags) === "claude" ? "claude" : "upload");
      const asset = await importAsset(
        projectId,
        { sourcePath: file, originalName: path.basename(file), kind, source, name: str(flags, "name"), prompt: str(flags, "prompt") ?? null, generator: source === "hyperframes" ? "hyperframes" : null, sceneId: scene?.id ?? null },
        actorOf(flags),
      );
      console.log(green(`✔ imported ${asset.id} (${asset.kind}) → ${asset.filePath}`));
    },
  },

  "voice:generate": {
    usage: "voice:generate <project> [--provider elevenlabs|system] [--voice <id>] [--wait]",
    description: "Queue voice-over generation from the current script",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const job = await enqueueVoiceGeneration(projectId, { provider: str(flags, "provider") as "elevenlabs" | "system" | undefined, voiceId: str(flags, "voice") ?? null }, { preview: false });
      console.log(green(`✔ queued ${job.id}`));
      if (flags.wait) await waitForJob(job.id);
    },
  },

  align: {
    usage: "align <project> [--method elevenlabs_forced_alignment|elevenlabs_stt|whisper_cpp] [--wait]",
    description: "Queue alignment of the active voice-over",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const job = await enqueueAlignment(projectId, { method: str(flags, "method") as never });
      console.log(green(`✔ queued ${job.id}`));
      if (flags.wait) await waitForJob(job.id);
    },
  },

  "assets:request": {
    usage: 'assets:request <project> --prompt "…" [--kind image|video] [--scene scene_02] [--aspect 16:9] [--style "…"] [--purpose "…"] [--brief brief.json] [--count 1] [--duration 5]',
    description: "Create an AI asset request with an optional composition-aware brief (requested → generating → generated → approved/rejected by the user)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const num = (key: string) => (str(flags, key) === undefined ? undefined : Number(str(flags, key)));
      const request = await createAssetRequest(
        projectId,
        {
          kind: (str(flags, "kind") as "image" | "video" | undefined) ?? "image",
          prompt: str(flags, "prompt") ?? "",
          sceneId: str(flags, "scene") ?? null,
          aspectRatio: str(flags, "aspect"),
          styleNotes: str(flags, "style"),
          purpose: str(flags, "purpose"),
          count: num("count"),
          durationSec: num("duration"),
          negativePrompt: str(flags, "negative"),
          brief: str(flags, "brief") ? ((await readJsonFile(str(flags, "brief")!)) as never) : undefined,
        },
        actorOf(flags),
      );
      console.log(green(`✔ ${request.id}`), dim(`${request.kind} · ${request.aspectRatio}${request.sceneKey ? ` · ${request.sceneKey}` : ""}`));
    },
  },

  requests: {
    usage: "requests <project> [--status requested,generating,generated]",
    description: "List AI asset requests and their candidates",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const requests = await listAssetRequests(projectId, { status: str(flags, "status")?.split(",") });
      table(
        requests.map((r) => ({
          id: r.id,
          status: r.status,
          kind: r.kind,
          scene: r.sceneKey ?? "",
          attempt: r.attempt,
          candidates: r.candidates.length,
          prompt: r.prompt.length > 70 ? `${r.prompt.slice(0, 69)}…` : r.prompt,
          feedback: r.feedback ?? "",
        })),
        ["id", "status", "kind", "scene", "attempt", "candidates", "prompt", "feedback"],
      );
    },
  },

  "assets:generating": {
    usage: "assets:generating [project] <requestId>",
    description: "Mark an asset request as being generated (shows progress in the GUI)",
    run: async (args, flags) => {
      const requestId = args.find((a) => a.startsWith("req_"));
      if (!requestId) throw new AppError("BAD_REQUEST", "Missing <requestId> (req_…).");
      const projectId = await projectIdForRequest(requestId);
      const r = await markAssetRequestGenerating(projectId, requestId, actorOf(flags));
      console.log(green(`✔ ${r.id} ${r.status}`));
    },
  },

  "assets:fulfill": {
    usage: "assets:fulfill [project] <requestId> <file> [file…] [--generator name]",
    description: "Register generated file(s) as candidates for a request (the user approves one in the GUI)",
    run: async (args, flags) => {
      const idx = args.findIndex((a) => a.startsWith("req_"));
      if (idx < 0) throw new AppError("BAD_REQUEST", "Missing <requestId> (req_…).");
      const requestId = args[idx];
      const files = args.slice(idx + 1).map((f) => ({ path: path.resolve(f) }));
      if (!files.length) throw new AppError("BAD_REQUEST", "Pass at least one generated file.");
      const projectId = await projectIdForRequest(requestId);
      const { request, assets } = await fulfillAssetRequest(projectId, requestId, files, actorOf(flags), { generator: str(flags, "generator") ?? "claude", source: "claude" });
      console.log(green(`✔ ${request.id} → ${request.status}`), dim(assets.map((a) => `${a.id} (${a.filePath})`).join(", ")));
    },
  },

  "assets:fail": {
    usage: 'assets:fail [project] <requestId> --reason "…"',
    description: "Report that an asset request could not be generated (it returns to requested with the error)",
    run: async (args, flags) => {
      const requestId = args.find((a) => a.startsWith("req_"));
      if (!requestId) throw new AppError("BAD_REQUEST", "Missing <requestId> (req_…).");
      const projectId = await projectIdForRequest(requestId);
      const r = await failAssetRequest(projectId, requestId, str(flags, "reason") ?? "Generation failed.", actorOf(flags));
      console.log(yellow(`! ${r.id} ${r.status}: ${r.error}`));
    },
  },

  "audio:tracks": {
    usage: "audio:tracks <project>",
    description: "List music/SFX tracks on the timeline and the voice-over's muted sections",
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      const [tracks, { mix }] = await Promise.all([listAudioTracks(projectId), getVoiceMix(projectId)]);
      table(
        tracks.map((t) => ({
          id: t.id,
          kind: t.kind,
          name: t.name,
          start: t.startSec,
          trim: t.trimStartSec,
          length: t.durationSec ?? (t.loop ? "loop" : "full"),
          volume: t.volume,
          fades: `${t.fadeInSec}/${t.fadeOutSec}`,
          duck: t.duckUnderVoice ? "yes" : "",
          muted: t.muted ? "muted" : "",
        })),
        ["id", "kind", "name", "start", "trim", "length", "volume", "fades", "duck", "muted"],
      );
      console.log(dim(`  voice-over muted sections: ${mix.cuts.length ? mix.cuts.map((c) => `${c.startSec}–${c.endSec}s`).join(", ") : "none"}`));
    },
  },

  "audio:add": {
    usage: "audio:add <project> <assetId> [--kind music|sfx|voice] [--start 0] [--volume 0.35] [--duck]",
    description: "Place a music, SFX or voice-line asset on the timeline",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const start = str(flags, "start");
      let track = await addAudioTrack(projectId, { assetId: need(args, 1, "assetId"), kind: str(flags, "kind") as "music" | "sfx" | "voice" | undefined, startSec: start === undefined ? undefined : Number(start) }, actorOf(flags));
      const volume = str(flags, "volume");
      if (volume !== undefined || flags.duck !== undefined) {
        track = await updateAudioTrack(projectId, track.id, { ...(volume !== undefined ? { volume: Number(volume) } : {}), ...(flags.duck !== undefined ? { duckUnderVoice: !!flags.duck } : {}) }, actorOf(flags));
      }
      console.log(green(`✔ ${track.id}`), dim(`${track.kind} “${track.name}” at ${track.startSec}s · volume ${track.volume}`));
    },
  },

  "audio:update": {
    usage: "audio:update <project> <trackId> [--start] [--trim-start] [--duration <s|full>] [--volume 0.35] [--fade-in] [--fade-out] [--loop|--no-loop] [--duck|--no-duck] [--mute|--unmute] [--name …]",
    description: "Change a music/SFX/voice-line track's placement, trim or mix",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const num = (key: string) => (str(flags, key) === undefined ? undefined : Number(str(flags, key)));
      const duration = str(flags, "duration");
      const patch = Object.fromEntries(
        Object.entries({
          name: str(flags, "name"),
          startSec: num("start"),
          trimStartSec: num("trim-start"),
          durationSec: duration === undefined ? undefined : duration === "full" ? null : Number(duration),
          volume: num("volume"),
          fadeInSec: num("fade-in"),
          fadeOutSec: num("fade-out"),
          loop: flags.loop ? true : flags["no-loop"] ? false : undefined,
          duckUnderVoice: flags.duck ? true : flags["no-duck"] ? false : undefined,
          muted: flags.mute ? true : flags.unmute ? false : undefined,
        }).filter(([, v]) => v !== undefined),
      );
      const track = await updateAudioTrack(projectId, need(args, 1, "trackId"), patch, actorOf(flags));
      console.log(green(`✔ ${track.id}`), dim(`${track.kind} “${track.name}” at ${track.startSec}s · trim ${track.trimStartSec}s · length ${track.durationSec ?? "full"} · volume ${track.volume}${track.muted ? " · muted" : ""}`));
    },
  },

  "voice:mute": {
    usage: "voice:mute <project> --start 39.54 [--end 42.04]",
    description: "Mute a section of the voice-over (default: to its end). The voice-over never moves; word timing and scenes are unchanged",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const { mix, voiceDurationSec } = await getVoiceMix(projectId);
      if (voiceDurationSec === null) throw new AppError("PRECONDITION", "This project has no voice-over.");
      const start = Number(str(flags, "start"));
      if (!Number.isFinite(start)) throw new AppError("BAD_REQUEST", "Pass --start <seconds>.");
      const end = str(flags, "end") === undefined ? voiceDurationSec : Number(str(flags, "end"));
      const next = await updateVoiceMix(projectId, { cuts: [...mix.cuts, { startSec: start, endSec: end }] }, actorOf(flags));
      console.log(green("✔ voice-over muted sections"), dim(next.cuts.map((c) => `${c.startSec}–${c.endSec}s`).join(", ") || "none"));
    },
  },

  "voice:unmute": {
    usage: "voice:unmute <project> (--start 39.54 [--end 42.04] | --all)",
    description: "Remove muted voice-over sections that overlap a range (or all of them)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const { mix } = await getVoiceMix(projectId);
      const startText = str(flags, "start");
      if (!flags.all && startText === undefined) throw new AppError("BAD_REQUEST", "Pass --start <seconds> [--end <seconds>] or --all.");
      const start = Number(startText ?? 0);
      const end = str(flags, "end") === undefined ? Infinity : Number(str(flags, "end"));
      const cuts = flags.all ? [] : mix.cuts.filter((c) => !(c.startSec < end && c.endSec > start));
      const next = await updateVoiceMix(projectId, { cuts }, actorOf(flags));
      console.log(green("✔ voice-over muted sections"), dim(next.cuts.map((c) => `${c.startSec}–${c.endSec}s`).join(", ") || "none"));
    },
  },

  overlays: {
    usage: "overlays <project>",
    description: "List the overlay track: images/videos above the scenes in video time (trim, placement)",
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      const clips = await listOverlayClips(projectId);
      if (!clips.length) return console.log(dim("No overlays."));
      table(
        clips.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          placement: c.placement,
          time: `${c.startSec.toFixed(2)}–${c.endSec.toFixed(2)}s`,
          trim: c.kind === "video" ? `${c.trimStartSec.toFixed(2)}–${c.trimEndSec === null ? "end" : c.trimEndSec.toFixed(2)}${c.playbackRate !== 1 ? ` @${c.playbackRate}×` : ""}` : "",
          zooms: c.zooms.length || "",
          hidden: c.hidden ? "hidden" : "",
        })),
        ["id", "name", "kind", "placement", "time", "trim", "zooms", "hidden"],
      );
    },
  },

  "overlay:add": {
    usage: "overlay:add <project> <assetId> [--start 12.5] [--duration 4] [--placement fullscreen|framed|pip] [--trim-start 2] [--trim-end 6.5] [--dim 0.2] [--volume 0]",
    description: "Put an image or video on the overlay track in video time (it can span scene cuts; scene timing is untouched)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const num = (key: string) => (str(flags, key) === undefined ? undefined : Number(str(flags, key)));
      const clip = await addOverlayClip(
        projectId,
        {
          assetId: need(args, 1, "assetId"),
          startSec: num("start"),
          durationSec: num("duration"),
          placement: str(flags, "placement") as never,
          trimStartSec: num("trim-start"),
          trimEndSec: num("trim-end"),
          dim: num("dim"),
          volume: num("volume"),
        },
        actorOf(flags),
      );
      console.log(green(`✔ ${clip.id}`), dim(`${clip.kind} “${clip.name}” ${clip.startSec.toFixed(2)}–${clip.endSec.toFixed(2)}s · ${clip.placement}`));
    },
  },

  "overlay:update": {
    usage: "overlay:update <project> <overlayId> [--start] [--duration] [--trim-start] [--trim-end <s|end>] [--placement] [--fit cover|contain] [--rate 1 | --fit-speed] [--loop|--hold] [--volume] [--dim] [--opacity] [--fade-in] [--fade-out] [--hidden|--visible] [--name …]",
    description: "Change an overlay clip's timing, trim, placement or look",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const num = (key: string) => (str(flags, key) === undefined ? undefined : Number(str(flags, key)));
      const trimEnd = str(flags, "trim-end");
      const patch = Object.fromEntries(
        Object.entries({
          name: str(flags, "name"),
          startSec: num("start"),
          durationSec: num("duration"),
          trimStartSec: num("trim-start"),
          trimEndSec: trimEnd === undefined ? undefined : trimEnd === "end" ? null : Number(trimEnd),
          placement: str(flags, "placement"),
          fit: str(flags, "fit"),
          playbackRate: num("rate"),
          endBehavior: flags.loop ? "loop" : flags.hold ? "hold" : undefined,
          volume: num("volume"),
          dim: num("dim"),
          opacity: num("opacity"),
          fadeInSec: num("fade-in"),
          fadeOutSec: num("fade-out"),
          hidden: flags.hidden ? true : flags.visible ? false : undefined,
        }).filter(([, v]) => v !== undefined),
      );
      if (flags["fit-speed"]) {
        // The speed at which the trimmed part plays in exactly the clip's time on screen.
        const existing = (await listOverlayClips(projectId)).find((c) => c.id === need(args, 1, "overlayId"));
        if (!existing || existing.kind !== "video") throw new AppError("BAD_REQUEST", "--fit-speed needs a video overlay.");
        const trimStart = (patch.trimStartSec as number | undefined) ?? existing.trimStartSec;
        const trimEnd = patch.trimEndSec !== undefined ? (patch.trimEndSec as number | null) : existing.trimEndSec;
        const end = trimEnd ?? existing.sourceDurationSec;
        if (end === null) throw new AppError("BAD_REQUEST", "The clip length is unknown, so its speed can't be fitted.");
        patch.playbackRate = fitPlaybackRate(end - trimStart, (patch.durationSec as number | undefined) ?? existing.durationSec);
      }
      const clip = await updateOverlayClip(projectId, need(args, 1, "overlayId"), patch, actorOf(flags));
      console.log(green(`✔ ${clip.id}`), dim(`${clip.startSec.toFixed(2)}–${clip.endSec.toFixed(2)}s${clip.kind === "video" ? ` · trim ${clip.trimStartSec}–${clip.trimEndSec ?? "end"}` : ""} · ${clip.placement}${clip.hidden ? " · hidden" : ""}`));
    },
  },

  "overlay:zoom": {
    usage: "overlay:zoom <project> <overlayId> --start 47.9 --end 51.2 --area 50,20,40 [--to 10,20,40] [--ease 0.5]",
    description: "Zoom into an area of an overlay clip (area = left%,top%,size% of the clip frame; --to pans to a second area; times in video seconds)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const overlayId = need(args, 1, "overlayId");
      const clip = (await listOverlayClips(projectId)).find((c) => c.id === overlayId);
      if (!clip) throw new AppError("NOT_FOUND", "Overlay not found.");
      const area = (key: string) => {
        const value = str(flags, key);
        if (value === undefined) return null;
        const [x, y, size] = value.split(",").map((n) => Number(n) / 100);
        if (![x, y, size].every((n) => Number.isFinite(n))) throw new AppError("BAD_REQUEST", `--${key} must be left,top,size in percent of the clip frame (e.g. 50,20,40).`);
        return { x, y, size };
      };
      const rect = area("area");
      if (!rect) throw new AppError("BAD_REQUEST", "Pass --area left,top,size (percent of the clip frame).");
      const start = Number(str(flags, "start"));
      const end = Number(str(flags, "end"));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new AppError("BAD_REQUEST", "Pass --start and --end in video seconds (end after start).");
      const zoom = {
        id: `z${Date.now().toString(36)}`,
        startSec: Math.max(0, start - clip.startSec),
        endSec: Math.max(0, end - clip.startSec),
        rect,
        toRect: area("to"),
        easeSec: str(flags, "ease") === undefined ? 0.5 : Number(str(flags, "ease")),
      };
      const updated = await updateOverlayClip(projectId, overlayId, { zooms: [...clip.zooms, zoom] }, actorOf(flags));
      console.log(
        green(`✔ ${updated.id}`),
        dim(updated.zooms.map((z, i) => `${i + 1}: ${(updated.startSec + z.startSec).toFixed(2)}–${(updated.startSec + z.endSec).toFixed(2)}s @ ${Math.round(z.rect.x * 100)},${Math.round(z.rect.y * 100)},${Math.round(z.rect.size * 100)}%${z.toRect ? " → pan" : ""}`).join(" · ")),
      );
    },
  },

  "overlay:unzoom": {
    usage: "overlay:unzoom <project> <overlayId> (--index 1 | --all)",
    description: "Remove zoom regions from an overlay clip",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const overlayId = need(args, 1, "overlayId");
      const clip = (await listOverlayClips(projectId)).find((c) => c.id === overlayId);
      if (!clip) throw new AppError("NOT_FOUND", "Overlay not found.");
      const index = Number(str(flags, "index"));
      if (!flags.all && !(Number.isInteger(index) && index >= 1 && index <= clip.zooms.length)) throw new AppError("BAD_REQUEST", `Pass --index 1…${clip.zooms.length} or --all.`);
      const updated = await updateOverlayClip(projectId, overlayId, { zooms: flags.all ? [] : clip.zooms.filter((_, i) => i !== index - 1) }, actorOf(flags));
      console.log(green(`✔ ${updated.id}`), dim(`${updated.zooms.length} zoom region${updated.zooms.length === 1 ? "" : "s"} left`));
    },
  },

  "overlay:remove": {
    usage: "overlay:remove <project> <overlayId>",
    description: "Remove a clip from the overlay track",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      await removeOverlayClip(projectId, need(args, 1, "overlayId"), actorOf(flags));
      console.log(green("✔ removed"));
    },
  },

  brands: {
    usage: "brands",
    description: "List brand kits (Settings → Brand kits) and how many projects follow each",
    run: async () => {
      const kits = await listBrandKits();
      if (!kits.length) return console.log(dim("No brand kits yet — create them in Settings → Brand kits or with brand:save."));
      for (const k of kits) {
        console.log(`${bold(k.id)}  ${k.name}  ${dim(`v${k.version} · ${k.design.preset} · ${k.design.typography.headingFont} · ${k.files.length} files · ${k.projectCount} project(s)`)}`);
      }
    },
  },

  "brand:apply": {
    usage: "brand:apply <project> <kitId>",
    description: "Make a project follow a brand kit (ONLY when the user asks — it replaces the project's brand and design system)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const result = await applyBrandKitToProject(projectId, need(args, 1, "kitId"), actorOf(flags));
      console.log(green(`✔ ${projectId} follows ${result.brandKitId}`), dim(`v${result.version}`));
    },
  },

  "brand:detach": {
    usage: "brand:detach <project>",
    description: "Stop following the brand kit — the project keeps its current brand as a custom brand",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      await detachBrandKit(projectId, actorOf(flags));
      console.log(green(`✔ ${projectId} now has a custom brand`));
    },
  },

  "brand:save": {
    usage: 'brand:save <project> --name "Kit name" [--no-link]',
    description: "Save a project's brand (identity, design system, logo, fonts, references) as a reusable brand kit",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const kit = await createBrandKit({ name: str(flags, "name") ?? "", fromProjectId: projectId, linkProject: !flags["no-link"] }, actorOf(flags));
      console.log(green(`✔ ${kit.id}`), dim(`“${kit.name}” · ${kit.files.length} files${flags["no-link"] ? "" : ` · ${projectId} follows it`}`));
    },
  },

  "audio:generate": {
    usage: 'audio:generate <project> --kind music|sfx|voice --prompt "…" [--duration 30] [--vocals] [--loop] [--influence 0.3] [--name "…"] [--start 0] [--no-add] [--wait]',
    description: "Generate music (default: video length, instrumental), a sound effect, or a voice line (--kind voice: --prompt is the words, spoken with the voice-over's voice; prints word timing) with ElevenLabs into the audio library and timeline",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const kind = str(flags, "kind") ?? "music";
      if (kind !== "music" && kind !== "sfx" && kind !== "voice") throw new AppError("VALIDATION", "--kind must be music, sfx or voice");
      const num = (key: string) => (str(flags, key) === undefined ? undefined : Number(str(flags, key)));
      const job = await enqueueAudioGeneration(
        projectId,
        {
          kind,
          prompt: str(flags, "prompt") ?? args.slice(1).join(" "),
          durationSec: num("duration") ?? null,
          instrumental: !flags.vocals,
          loop: !!flags.loop,
          promptInfluence: num("influence"),
          name: str(flags, "name"),
          addToTimeline: !flags["no-add"],
          startSec: num("start") ?? 0,
        },
        actorOf(flags),
      );
      console.log(green(`✔ queued ${job.id}`), dim(`${kind} generation`));
      if (flags.wait) await waitForJob(job.id);
    },
  },

  "scene:media": {
    usage: "scene:media <project> <scene> <assetId> [--placement background|fullscreen|framed|pip] [--trim 0] [--trim-end 9] [--rate 1] [--loop|--no-loop] [--volume 0] [--appear 1.5] [--disappear 4] [--dim 0.35]",
    description: "Place an image or video asset into a scene (appear/disappear are seconds into the scene; timing stays audio-owned)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const placement = (str(flags, "placement") ?? "background") as MediaPlacement;
      if (!MEDIA_PLACEMENTS.includes(placement)) throw new AppError("VALIDATION", `--placement must be one of ${MEDIA_PLACEMENTS.join(", ")}`);
      const num = (key: string) => (str(flags, key) === undefined ? undefined : Number(str(flags, key)));
      const { scene, elementId } = await insertMediaIntoScene(
        projectId,
        need(args, 1, "scene"),
        {
          assetId: need(args, 2, "assetId"),
          placement,
          startFrom: num("trim"),
          endAt: num("trim-end"),
          playbackRate: num("rate"),
          loop: flags.loop ? true : flags["no-loop"] ? false : undefined,
          volume: num("volume"),
          appearAt: num("appear"),
          disappearAt: num("disappear"),
          dim: num("dim"),
        },
        actorOf(flags),
      );
      console.log(green(`✔ ${scene.key} v${scene.version}`), dim(`added ${elementId} (${placement})`));
    },
  },

  "overlay:edits": {
    usage: "overlay:edits <project> <overlayId> edits.json",
    description: "Set an overlay clip's crop, speed ramps and freeze frames, and annotations from JSON {crop, speedSegments, annotations} (clip seconds; see PROJECT_SCHEMA.md)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const input = (await readJsonFile(need(args, 2, "file"))) as Record<string, unknown>;
      const patch = Object.fromEntries(["crop", "speedSegments", "annotations", "duckUnderVoice"].filter((k) => k in input).map((k) => [k, input[k]]));
      if (!Object.keys(patch).length) throw new AppError("BAD_REQUEST", "The file needs crop, speedSegments, annotations or duckUnderVoice.");
      const clip = await updateOverlayClip(projectId, need(args, 1, "overlayId"), patch, actorOf(flags));
      console.log(green(`✔ ${clip.id}`), dim(`crop ${clip.crop ? "on" : "off"} · ${clip.speedSegments.length} speed segment(s) · ${clip.annotations.length} annotation(s)`));
    },
  },

  "overlay:split": {
    usage: "overlay:split <project> <overlayId> --at 14.2 [--until 16]",
    description: "Split an overlay clip at a video second, or cut out the section until --until (the rest of the clip moves up to close the gap)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const at = Number(str(flags, "at"));
      const until = str(flags, "until");
      if (!Number.isFinite(at)) throw new AppError("BAD_REQUEST", "Pass --at <video seconds>.");
      const clips = await splitOverlayClip(projectId, need(args, 1, "overlayId"), { atSec: at, ...(until !== undefined ? { removeUntilSec: Number(until) } : {}) }, actorOf(flags));
      for (const c of clips) console.log(green(`✔ ${c.id}`), dim(`${c.name} · ${c.startSec.toFixed(2)}–${c.endSec.toFixed(2)}s`));
    },
  },

  "scene:media:edits": {
    usage: "scene:media:edits <project> <scene> <element> edits.json",
    description: "Set crop, speed ramps and freeze frames, and annotations of an image or video in a scene from JSON {crop, speedSegments, annotations} (seconds from when it appears)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const { scene, item, sourceSec } = await sceneMediaItem(projectId, need(args, 1, "scene"), need(args, 2, "element"));
      const input = (await readJsonFile(need(args, 3, "file"))) as Record<string, unknown>;
      const patch = Object.fromEntries(["crop", "speedSegments", "annotations", "duckUnderVoice"].filter((k) => k in input).map((k) => [k, input[k]])) as SceneMediaPatch;
      if (!Object.keys(patch).length) throw new AppError("BAD_REQUEST", "The file needs crop, speedSegments, annotations or duckUnderVoice.");
      const { element } = await updateSceneMedia(projectId, scene.id, { ref: item.ref, assetId: item.element.assetId, patch }, actorOf(flags));
      console.log(green(`✔ ${scene.key}`), dim(describeSceneMedia(element ? { ...item, element } : item, sourceSec)));
    },
  },

  templates: {
    usage: "templates",
    description: "List scene templates: built-in (title card, YouTube end screen, lower third) and saved ones",
    run: async () => {
      for (const t of await listSceneTemplates()) {
        const extra = t.builtin ? `built-in · fields: ${t.fields.map((f) => f.key).join(", ")}` : `${t.kind === "elements" ? `${t.elementCount} element(s)` : "scene"} · ${t.fileCount} file(s)${t.sourceSceneKey ? ` · from ${t.sourceSceneKey}` : ""}`;
        console.log(`${bold(t.id)}  ${t.name}  ${dim(extra)}`);
      }
    },
  },

  "template:save": {
    usage: 'template:save <project> <scene> --name "Name" [--description "…"] [--elements id1,id2]',
    description: "Save a scene (or only some of its elements, e.g. a lower third) as a template usable in any project; its images and videos are copied with it",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const elements = str(flags, "elements");
      const t = await saveSceneTemplate(
        projectId,
        need(args, 1, "scene"),
        { name: str(flags, "name") ?? "", description: str(flags, "description"), ...(elements ? { elementIds: elements.split(/[\s,]+/).filter(Boolean) } : {}) },
        actorOf(flags),
      );
      console.log(green(`✔ saved ${t.id}`), dim(`${t.name} · ${t.kind} · ${t.fileCount} file(s)`));
    },
  },

  "template:apply": {
    usage: "template:apply <project> <scene> <templateId> [--title … --kicker … --link … --name …] [--at 2 --duration 4 --side left|right]",
    description: "Apply a template to a scene (ONLY when asked): scene templates replace the design (timing stays), element templates such as builtin:lower-third are added at --at seconds into the scene",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const fields: Record<string, string> = {};
      for (const key of ["title", "kicker", "link", "name"]) {
        const v = str(flags, key);
        if (v !== undefined) fields[key] = v;
      }
      const at = str(flags, "at");
      const duration = str(flags, "duration");
      const side = str(flags, "side");
      const scene = await applySceneTemplate(
        projectId,
        need(args, 1, "scene"),
        { templateId: need(args, 2, "templateId"), fields, ...(at !== undefined ? { atSec: Number(at) } : {}), ...(duration !== undefined ? { durationSec: Number(duration) } : {}), ...(side === "left" || side === "right" ? { side } : {}) },
        actorOf(flags),
      );
      console.log(green(`✔ ${scene.key} v${scene.version}`), dim(`applied ${args[2]}`));
    },
  },

  "template:delete": {
    usage: "template:delete <templateId>",
    description: "Delete a saved scene template (ONLY when asked)",
    run: async (args) => {
      await deleteSceneTemplate(need(args, 0, "templateId"));
      console.log(green(`✔ deleted ${args[0]}`));
    },
  },

  "scene:media:split": {
    usage: "scene:media:split <project> <scene> <element> --at 14.2 [--until 16]",
    description: "Split an image or video in a scene at a video second, or cut out the section until --until (the second part becomes its own element)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const { scene, item } = await sceneMediaItem(projectId, need(args, 1, "scene"), need(args, 2, "element"));
      const at = Number(str(flags, "at"));
      const until = str(flags, "until");
      if (!Number.isFinite(at)) throw new AppError("BAD_REQUEST", "Pass --at <video seconds>.");
      const { scene: updated } = await splitSceneMedia(
        projectId,
        scene.id,
        { ref: item.ref, assetId: item.element.assetId, atSec: at, ...(until !== undefined ? { removeUntilSec: Number(until) } : {}), appearSec: item.appearSec, goneSec: item.goneSec },
        actorOf(flags),
      );
      console.log(green(`✔ ${updated.key} v${updated.version}`), dim(until !== undefined ? `cut ${at}–${until}s out of ${sceneMediaName(item)}` : `split ${sceneMediaName(item)} at ${at}s`));
    },
  },

  "voice:cleanup": {
    usage: "voice:cleanup <project> [--pauses] [--min-pause 0.8] [--apply]",
    description: "List filler words (um, uh, …) and long silences in the voice-over; --apply mutes the filler words (add --pauses to mute the silences too). Timing never moves",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const { mix, voiceDurationSec } = await getVoiceMix(projectId);
      if (voiceDurationSec === null) throw new AppError("PRECONDITION", "This project has no voice-over.");
      const project = await db.project.findUnique({ where: { id: projectId }, select: { activeTranscript: { select: { words: true } } } });
      const words = (project?.activeTranscript?.words ?? []) as TimedWord[];
      const minPause = str(flags, "min-pause");
      const found = findPausesAndFillers(words, { cuts: mix.cuts, durationSec: voiceDurationSec, ...(minPause !== undefined ? { minPauseSec: Number(minPause) } : {}) });
      if (!found.length) return console.log(dim("No filler words or long silences found."));
      for (const s of found) console.log(`${s.kind === "filler" ? cyan("filler") : dim("pause ")} ${s.startSec.toFixed(2)}–${s.endSec.toFixed(2)}s ${s.label}`);
      if (!flags.apply) return console.log(dim("Run again with --apply to mute the filler words (add --pauses to include the silences)."));
      const picked = found.filter((s) => s.kind === "filler" || flags.pauses);
      const next = await updateVoiceMix(projectId, { cuts: [...mix.cuts, ...picked.map((s) => ({ startSec: s.startSec, endSec: s.endSec }))] }, actorOf(flags));
      console.log(green(`✔ muted ${picked.length} part${picked.length === 1 ? "" : "s"}`), dim(`${next.cuts.length} muted section(s) in total`));
    },
  },

  "export:captions": {
    usage: "export:captions <project> [--format srt|vtt] [--out captions.srt]",
    description: "Captions from the voice-over's words (muted parts left out): prints them, or writes --out",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const format = str(flags, "format") === "vtt" ? "vtt" : "srt";
      const text = await captionsFile(projectId, format);
      const out = str(flags, "out");
      if (!out) return console.log(text);
      await fs.writeFile(path.resolve(out), text, "utf8");
      console.log(green(`✔ ${path.resolve(out)}`));
    },
  },

  "export:chapters": {
    usage: "export:chapters <project>",
    description: "YouTube chapters (0:00 Title) from the scene names; short scenes join the chapter before them",
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      const { text, valid } = await chaptersForProject(projectId);
      console.log(text);
      if (!valid) console.log(yellow("YouTube needs at least 3 chapters of 10 s or more; merge or rename scenes to get more."));
    },
  },

  thumbnail: {
    usage: "thumbnail <project> --title \"Stop typing.\" [--tag \"FREE AI DICTATION\"] [--sec 12.5] [--layout left|center|bottom] [--darken 0.55] [--wait]",
    description: "Make a YouTube thumbnail (1280×720 JPEG in exports/): a frame of the video with a title and a tag",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const sec = str(flags, "sec");
      const darken = str(flags, "darken");
      const job = await enqueueThumbnail(projectId, {
        title: str(flags, "title") ?? "",
        subtitle: str(flags, "tag"),
        ...(sec !== undefined ? { sec: Number(sec) } : {}),
        layout: (str(flags, "layout") ?? "left") as "left" | "center" | "bottom",
        ...(darken !== undefined ? { darken: Number(darken) } : {}),
      });
      console.log(green(`✔ queued ${job.id}`), dim("thumbnail"));
      if (flags.wait) await waitForJob(job.id);
    },
  },

  "scene:media:list": {
    usage: "scene:media:list <project> <scene>",
    description: "List a scene's images and videos: time on screen, trim, speed and zoom regions",
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      const { scene, items } = await sceneMediaItems(projectId, need(args, 1, "scene"));
      if (!items.length) return console.log(dim(`${scene.key} has no images or videos.`));
      const assets = await db.asset.findMany({ where: { projectId, id: { in: items.map((i) => i.element.assetId) } }, select: { id: true, durationSec: true } });
      const sources = new Map(assets.map((a) => [a.id, a.durationSec]));
      for (const item of items) console.log(`${cyan("▸")} ${describeSceneMedia(item, sources.get(item.element.assetId) ?? null)}`);
    },
  },

  "scene:media:update": {
    usage: "scene:media:update <project> <scene> <element> [--trim-start 2] [--trim-end <s|end>] [--rate 1.5 | --fit-speed] [--loop|--hold] [--volume 0] [--dim 0.3] [--fit cover|contain]",
    description: "Trim an image or video in a scene, change its speed (--fit-speed: the trimmed part fills its time in the scene), loop or hold, clip audio, darkening or fit",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const { scene, item, sourceSec } = await sceneMediaItem(projectId, need(args, 1, "scene"), need(args, 2, "element"));
      const num = (key: string) => (str(flags, key) === undefined ? undefined : Number(str(flags, key)));
      const trimEnd = str(flags, "trim-end");
      const patch = Object.fromEntries(
        Object.entries({
          startFrom: num("trim-start"),
          endAt: trimEnd === undefined ? undefined : trimEnd === "end" ? null : Number(trimEnd),
          playbackRate: num("rate"),
          loop: flags.loop ? true : flags.hold ? false : undefined,
          volume: num("volume"),
          dim: num("dim"),
          fit: str(flags, "fit"),
        }).filter(([, v]) => v !== undefined),
      ) as SceneMediaPatch;
      if (flags["fit-speed"]) {
        const timing = sceneVideoTiming(item.element, sourceSec);
        const end = (patch.endAt !== undefined ? patch.endAt : timing.trimEndSec) ?? sourceSec;
        if (item.element.type !== "video" || end === null) throw new AppError("BAD_REQUEST", "--fit-speed needs a video whose length is known.");
        patch.playbackRate = fitPlaybackRate(end - (patch.startFrom ?? timing.trimStartSec), item.goneSec - item.appearSec);
      }
      const { element } = await updateSceneMedia(projectId, scene.id, { ref: item.ref, assetId: item.element.assetId, patch }, actorOf(flags));
      console.log(green(`✔ ${scene.key}`), dim(describeSceneMedia(element ? { ...item, element } : item, sourceSec)));
    },
  },

  "scene:element": {
    usage:
      "scene:element <project> <scene> <element> [--x 50] [--y 50] [--width 40|auto] [--height 30|auto] [--anchor center|top-left|…] [--rotation 0] [--rotate-x 0] [--rotate-y 0] [--depth 1200] [--scale 1] [--opacity 0.8] [--z 5] [--placement background|fullscreen|framed|pip] [--enter fade:0.5] [--exit fade:0.4|none] [--idle float|none] [--appear 1.2|start] [--disappear 4.5|end] [--style '{\"radius\":24}'] [--props '{\"size\":72}']",
    description:
      "Change any property of a scene element: position, size, anchor, rotation, 3D tilt (--rotate-x / --rotate-y, seen from --depth away), scale, opacity, layer, entrance/exit (type:seconds), idle motion, when it appears/disappears (seconds into the scene), style keys (--style) and its type's own properties such as text, typography, data or items (--props, JSON; null resets a key). Images and videos can be re-placed with a placement preset",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const v = validateSceneSpec(scene.spec);
      if (!v.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it first.`);
      const elementRef = need(args, 2, "element");
      const all = [
        ...v.spec.elements.map((element, index) => ({ element, ref: { shotId: null as string | null, index } })),
        ...(v.spec.shots ?? []).flatMap((shot) => shot.elements.map((element, index) => ({ element, ref: { shotId: shot.id as string | null, index } }))),
      ];
      const nameOf = (e: (typeof all)[number]) => e.element.id ?? `${e.ref.shotId ? `${e.ref.shotId}/` : ""}#${e.ref.index + 1}`;
      const m = /^(?:([A-Za-z0-9_-]+)\/)?#(\d+)$/.exec(elementRef);
      const found = all.find((e) => e.element.id === elementRef) ?? (m ? all.find((e) => e.ref.shotId === (m[1] ?? null) && e.ref.index === Number(m[2]) - 1) : undefined);
      if (!found) throw new AppError("NOT_FOUND", `No element “${elementRef}” in ${scene.key}. Its elements: ${all.map(nameOf).join(", ") || "none"}.`);
      const num = (key: string) => (str(flags, key) === undefined ? undefined : Number(str(flags, key)));
      const size = (key: string) => (str(flags, key) === undefined ? undefined : str(flags, key) === "auto" ? null : Number(str(flags, key)));
      const motion = (key: "enter" | "exit") => {
        const value = str(flags, key);
        if (value === undefined) return undefined;
        if (value === "none") return key === "exit" ? null : { type: "none" };
        const [type, seconds] = value.split(":");
        return { ...(type ? { type } : {}), ...(seconds ? { duration: Number(seconds) } : {}) };
      };
      const object = (key: string) => {
        const value = str(flags, key);
        if (value === undefined) return undefined;
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch (err) {
          throw new AppError("VALIDATION", `--${key} must be JSON, e.g. --${key} '{"radius":24}' (${(err as Error).message}).`);
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AppError("VALIDATION", `--${key} must be a JSON object, e.g. --${key} '{"radius":24}'.`);
        return parsed as Record<string, unknown>;
      };
      // "start" / "end": back to its scene or shot's own start or end.
      const time = (key: string, edge: string) => (str(flags, key) === undefined ? undefined : str(flags, key) === edge ? null : Number(str(flags, key)));
      const patch = Object.fromEntries(
        Object.entries({
          x: num("x"),
          y: num("y"),
          width: size("width"),
          height: size("height"),
          anchor: str(flags, "anchor"),
          rotation: num("rotation"),
          rotateX: num("rotate-x"),
          rotateY: num("rotate-y"),
          depth: num("depth"),
          scale: num("scale"),
          opacity: num("opacity"),
          z: num("z"),
          placement: str(flags, "placement"),
          enter: motion("enter"),
          exit: motion("exit"),
          idle: str(flags, "idle"),
          appearAt: time("appear", "start"),
          disappearAt: time("disappear", "end"),
          style: object("style"),
          props: object("props"),
        }).filter(([, value]) => value !== undefined),
      ) as SceneElementPatch;
      if (!Object.keys(patch).length) throw new AppError("BAD_REQUEST", "Pass at least one change, e.g. --x 30 --y 40, --opacity 0.8, --placement framed or --props '{\"size\":72}'.");
      const { element } = await updateSceneElement(projectId, scene.id, { ref: found.ref, type: found.element.type, patch }, actorOf(flags));
      const e = element ?? found.element;
      console.log(
        green(`✔ ${scene.key}`),
        dim(
          [
            `${nameOf(found)} (${e.type})`,
            `x ${e.x ?? 50}% y ${e.y ?? 50}%${e.anchor ? ` at its ${e.anchor}` : ""}`,
            e.width !== undefined || e.height !== undefined ? `size ${e.width !== undefined ? `${e.width}%` : "auto"} × ${e.height !== undefined ? `${e.height}%` : "auto"}` : "",
            e.rotation ? `${e.rotation}°` : "",
            e.rotateX || e.rotateY ? `tilt ${e.rotateX ?? 0}° × ${e.rotateY ?? 0}°` : "",
            e.opacity !== undefined ? `opacity ${e.opacity}` : "",
            e.z !== undefined ? `layer ${e.z}` : "",
            e.enter ? `enter ${e.enter.type} ${e.enter.duration ?? "default"}s` : "",
            e.exit ? `exit ${e.exit.type} ${e.exit.duration ?? "default"}s` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      );
    },
  },

  "scene:cues": {
    usage: "scene:cues <project> <scene> [element]",
    description:
      "List an element's cues (or every element's in the scene): entrance, exit, emphasis moments, actions (press, count-up, collapse, connections), item entrances, cursor clicks and path points — each with its cue id, the moment it fires and what it's cued to (a spoken word, a time or its default)",
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const context = await sceneCueContext(projectId, scene);
      const entries = args[2] ? [context.find(args[2])] : context.elements;
      console.log(bold(`${scene.key} · ${scene.startSec.toFixed(2)}–${scene.endSec.toFixed(2)}s`), context.words.length ? "" : dim("(no transcript yet: word cues can't resolve)"));
      for (const entry of entries) printCues(entry, context.nameOf(entry), context.words);
    },
  },

  "scene:cue": {
    usage: "scene:cue <project> <scene> <element> <cue|emphasis+type|click+> <word:platform[#2]|phrase:one platform|wordIndex:57|scene:1.2|video:34.5|start|none> [--edge end] [--offset 0.1]",
    description:
      "Cue an element's motion to a spoken word, a phrase or a time. <cue> is an id from scene:cues (enter, exit, emphasis:0, pressAt, animateAt, collapseAt, connectAt, item:2, click:0, path:1), emphasis+<pulse|pop|shake|glow|highlight|underline|colorShift|bounce> for a new emphasis moment, or click+ for a new cursor click. A word cue names the word and which time it's spoken in the scene, so it follows the voice-over; none clears a cue (an emphasis moment or click is removed, an entrance or exit follows its scene again)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const context = await sceneCueContext(projectId, scene);
      const entry = context.find(need(args, 2, "element"));
      const cue = need(args, 3, "cue");
      const moment = parseCueMoment(need(args, 4, "moment"), entry.segment, flags);
      let patch: SceneElementPatch;
      if (cue.startsWith("emphasis+")) {
        const name = cue.slice("emphasis+".length);
        const type = EmphasisSchema.shape.type.safeParse(name);
        if (!type.success) throw new AppError("VALIDATION", `Unknown emphasis “${name}”. Use ${EmphasisSchema.shape.type.options.join(", ")}.`);
        if (!moment) throw new AppError("VALIDATION", "A new emphasis moment needs a moment, e.g. word:platform.");
        patch = { emphasis: [...(entry.element.emphasis ?? []), { type: type.data, at: moment }] };
      } else if (cue === "click+") {
        if (entry.element.type !== "cursor") throw new AppError("VALIDATION", "Only cursors have clicks.");
        if (!moment) throw new AppError("VALIDATION", "A new click needs a moment, e.g. word:book.");
        patch = { cues: { [`click:${entry.element.clicks?.length ?? 0}`]: moment } };
      } else {
        if (!isCueId(cue)) throw new AppError("VALIDATION", `Unknown cue “${cue}”. Run scene:cues to see the cue ids of ${context.nameOf(entry)}.`);
        patch = { cues: { [cue]: moment } };
      }
      const { element } = await updateSceneElement(projectId, scene.id, { ref: entry.ref, type: entry.element.type, patch }, actorOf(flags));
      console.log(green(`✔ ${scene.key}`));
      printCues({ ...entry, element: element ?? entry.element }, context.nameOf(entry), context.words);
    },
  },

  "scene:keyframes": {
    usage: "scene:keyframes <project> <scene> [element]",
    description:
      `List an element's property keyframes (or those of every animated element in the scene): for each animated property (${KEYFRAME_PROPERTIES.join(", ")}) its keyframes with id, video second, seconds after the element appears, value and easing. Keyframes count from when the element appears, so they move with it`,
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const context = await sceneCueContext(projectId, scene);
      const entries = args[2] ? [context.find(args[2])] : context.elements.filter((e) => animatedProperties(e.element).length);
      console.log(bold(`${scene.key} · ${scene.startSec.toFixed(2)}–${scene.endSec.toFixed(2)}s`));
      if (!entries.length) console.log(dim("  no element has keyframes"));
      for (const entry of entries) printKeyframes(entry, context.nameOf(entry));
    },
  },

  "scene:keyframe": {
    usage: `scene:keyframe <project> <scene> <element> <${KEYFRAME_PROPERTIES.join("|")}|keyframe-id> <at:1.2|scene:2.5|video:34.1|none|keep> [value] [--easing linear|hold|easeOut|…]`,
    description:
      "Animate a property of an element (ONLY when asked). With a property: the keyframe at that moment gets the value (default: the value the property has there), else one is added; none removes the property's keyframes (it keeps the value it has when the element appears). With a keyframe id from scene:keyframes: a moment moves it (its value stays), keep leaves it where it is, [value] and --easing change it, none removes it (a property left without keyframes keeps that keyframe's value). Moments: at:<seconds after the element appears>, scene:<seconds into the scene>, video:<seconds>. --easing is how the value travels to the next keyframe: a name, hold, or a custom curve as custom:x1,y1,x2,y2",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const context = await sceneCueContext(projectId, scene);
      const entry = context.find(need(args, 2, "element"));
      const target = need(args, 3, "property or keyframe id");
      const moment = need(args, 4, "moment");
      const el = entry.element;
      const name = context.nameOf(entry);
      const span = elementSpan(el, entry.segment);
      const onScreen = span.gone - span.appear;
      const easing = parseEasing(str(flags, "easing"));
      const valueArg = args[5];
      const within = (time: number) => {
        if (time < -0.0005 || time > onScreen + 0.0005) throw new AppError("VALIDATION", `That moment is ${time.toFixed(2)}s after ${name} appears, outside its time on screen (0–${onScreen.toFixed(2)}s, ${span.appear.toFixed(2)}–${span.gone.toFixed(2)}s in the video).`);
        return Math.min(onScreen, Math.max(0, time));
      };
      // The animatable property registry decides what can be keyframed, on which elements, with what values.
      const readValue = (property: KeyframeProperty) => {
        const value = parseKeyframeValue(valueArg, animatableProperty(property));
        if (value === undefined) return undefined;
        const issue = propertyValueIssue(property, value);
        if (issue) throw new AppError("VALIDATION", `${issue}.`);
        return value;
      };
      let patch: SceneElementPatch;
      const definition = findKeyframeProperty(target);
      if (definition) {
        const property = definition.id as KeyframeProperty;
        const unsupported = propertySupportIssue(el.type, property);
        if (unsupported) throw new AppError("VALIDATION", `${unsupported}.`);
        if (definition.requires === "motionPath" && !el.motionPath) throw new AppError("VALIDATION", `${name} has no motion path — add one with scene:path first.`);
        const value = readValue(property);
        if (value === undefined && definition.defaultValue === null && !el.keyframes?.some((k) => k.property === property)) {
          throw new AppError("VALIDATION", `${property} has no value of its own to start from — give one, e.g. scene:keyframe … ${property} ${moment} <value>.`);
        }
        if (moment === "none") {
          const ids = (el.keyframes ?? []).filter((k) => k.property === property).map((k) => k.id);
          if (!ids.length) throw new AppError("VALIDATION", `${name} has no ${property} keyframes.`);
          patch = removeKeyframesPatch(el, ids, 0);
        } else {
          const time = within(parseKeyframeMoment(moment, entry));
          patch = { keyframes: setKeyframe(el.keyframes, { property, time, value: value ?? valueAt(el, property, time), ...(easing ? { easing } : {}) }, 0.001).keyframes };
        }
      } else {
        const keyframe = el.keyframes?.find((k) => k.id === target);
        if (!keyframe) throw new AppError("NOT_FOUND", `No property or keyframe “${target}” on ${name}. Use ${keyframePropertiesFor(el.type).join(", ")} or a keyframe id from scene:keyframes.`);
        if (moment === "none") patch = removeKeyframesPatch(el, [keyframe.id], keyframe.time);
        else {
          const value = readValue(keyframe.property);
          const time = moment === "keep" ? undefined : within(parseKeyframeMoment(moment, entry));
          patch = { keyframes: updateKeyframe(el.keyframes, keyframe.id, { ...(time !== undefined ? { time } : {}), ...(value !== undefined ? { value } : {}), ...(easing ? { easing } : {}) }, onScreen) };
        }
      }
      const { element } = await updateSceneElement(projectId, scene.id, { ref: entry.ref, type: el.type, patch }, actorOf(flags));
      console.log(green(`✔ ${scene.key}`));
      printKeyframes({ ...entry, element: element ?? el }, name);
    },
  },

  "scene:path": {
    usage: "scene:path <project> <scene> <element> [--type linear|quadratic|cubic] [--from 20,80] [--to 80,30] [--c1 50,10] [--c2 70,20] [--orient on|off] [--none]",
    description:
      "Give an element a motion path — a curve it travels instead of sitting at one x/y (ONLY when asked). Without --from/--to a new path starts where the element is and runs across the frame, with its progress keyframed from 0 to 1 over its time on screen. Points are % of the frame. --orient turns the element along the curve; --none removes the path and leaves it where it is. Animate the travel with scene:keyframe <element> pathProgress",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const context = await sceneCueContext(projectId, scene);
      const entry = context.find(need(args, 2, "element"));
      const el = entry.element;
      const name = context.nameOf(entry);
      const span = elementSpan(el, entry.segment);
      const supported = availableProperties({ type: el.type, motionPath: true });
      if (!supported.includes("pathProgress")) throw new AppError("VALIDATION", `${el.type} elements aren't placed by x and y, so they can't travel a path.`);
      let patch: SceneElementPatch;
      if (flags.none) {
        if (!el.motionPath) throw new AppError("VALIDATION", `${name} has no motion path.`);
        const at = Number(valueAt(el, "pathProgress", 0));
        const point = pathAt(el.motionPath, at).point;
        patch = { motionPath: null, x: Math.round(point[0] * 100) / 100, y: Math.round(point[1] * 100) / 100, keyframes: (el.keyframes ?? []).filter((k) => k.property !== "pathProgress") };
      } else {
        const type = str(flags, "type");
        if (type !== undefined && !(MOTION_PATH_TYPES as readonly string[]).includes(type)) throw new AppError("VALIDATION", `Unknown path type “${type}”. Use ${MOTION_PATH_TYPES.join(", ")}.`);
        const from = parsePoint(str(flags, "from"), "from");
        const to = parsePoint(str(flags, "to"), "to");
        const c1 = parsePoint(str(flags, "c1"), "c1");
        const c2 = parsePoint(str(flags, "c2"), "c2");
        const orientFlag = str(flags, "orient");
        const orient = orientFlag === undefined ? undefined : orientFlag !== "off" && orientFlag !== "false";
        const current = el.motionPath;
        const base: MotionPath = current ?? {
          type: "quadratic",
          from: [el.x ?? 50, el.y ?? 50],
          to: [Math.min(95, (el.x ?? 50) + 25), el.y ?? 50],
          c1: [midpoint([el.x ?? 50, el.y ?? 50], [Math.min(95, (el.x ?? 50) + 25), el.y ?? 50])[0], Math.max(2, (el.y ?? 50) - 18)],
        };
        let next: MotionPath = { ...base, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(c1 ? { c1 } : {}), ...(c2 ? { c2 } : {}), ...(orient === undefined ? {} : { orient: orient || undefined }) };
        if (type) next = pathAsType(next, type as MotionPath["type"]);
        // A new path is animated from the start: without progress keyframes it would sit at its first point.
        const keyframes = current || el.keyframes?.some((k) => k.property === "pathProgress")
          ? undefined
          : setKeyframe(setKeyframe(el.keyframes, { property: "pathProgress", time: 0, value: 0 }, 0.001).keyframes, { property: "pathProgress", time: Math.max(0.1, span.gone - span.appear), value: 1, easing: "easeInOut" }, 0.001).keyframes;
        patch = { motionPath: next, ...(keyframes ? { keyframes } : {}) };
      }
      const { element } = await updateSceneElement(projectId, scene.id, { ref: entry.ref, type: el.type, patch }, actorOf(flags));
      console.log(green(`✔ ${scene.key}`));
      const saved = element ?? el;
      if (saved.motionPath) {
        const p = saved.motionPath;
        console.log(`${bold(name)} ${dim(`${p.type} path`)}  ${p.from.join(",")} → ${p.to.join(",")}${p.c1 ? ` · c1 ${p.c1.join(",")}` : ""}${p.c2 ? ` · c2 ${p.c2.join(",")}` : ""} · ${pathLength(p).toFixed(1)}% long${p.orient ? " · turns with it" : ""}`);
      } else console.log(dim(`${name} no longer travels a path.`));
      printKeyframes({ ...entry, element: saved }, name);
    },
  },

  "scene:context": {
    usage: "scene:context <project> <scene> [--element title] [--json]",
    description:
      "The structured state of one scene for planning an edit: its timing, its elements with what they animate and what they are cued to, the words it can be cued to, the design tokens and motion vocabulary to prefer, and the project's assets. With --element, that element in full",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const context = await aiSceneContext(projectId, scene.id, { element: str(flags, "element") });
      if (flags.json) {
        console.log(JSON.stringify(context, null, 2));
        return;
      }
      console.log(bold(`${context.scene.key} · ${context.scene.name}`), dim(`${context.scene.startSec.toFixed(2)}–${context.scene.endSec.toFixed(2)}s · ${context.scene.durationSec.toFixed(2)}s${context.scene.locked ? " · locked" : ""}${context.scene.approved ? " · approved" : ""}`));
      if (context.scene.voiceText) console.log(dim(`“${context.scene.voiceText}”`));
      console.log();
      console.log(bold("Elements"));
      const rows = (list: typeof context.elements, indent: string): void => {
        for (const el of list) {
          console.log(
            `${indent}${el.target.padEnd(16)} ${dim(el.type.padEnd(10))} ${el.summary.slice(0, 40).padEnd(42)} ${dim(`${el.onScreen.from.toFixed(2)}–${el.onScreen.to.toFixed(2)}s`)}${el.animates.length ? ` ${dim(`◆ ${el.animates.join(", ")}`)}` : ""}`,
          );
          for (const cue of el.cues) console.log(`${indent}  ${dim(`${cue.id}: ${cue.what} at ${cue.atSec.toFixed(2)}s${cue.word ? ` on “${cue.word}”` : ""}${cue.ok === false ? ` — ${cue.reason}` : ""}`)}`);
          if (el.children) rows(el.children, `${indent}  `);
        }
      };
      rows(context.elements, "  ");
      console.log();
      console.log(bold("Words it can cue to"), dim(`(${context.words.length})`));
      console.log(`  ${context.words.map((w) => `${w.text}@${w.start.toFixed(2)}`).join("  ")}`);
      if (context.selected) {
        console.log();
        console.log(bold(`Selected · ${context.selected.target}`));
        console.log(JSON.stringify(context.selected.element, null, 2));
      }
    },
  },

  "scene:edit": {
    usage: "scene:edit <project> <scene> <plan.json> [--preview]",
    description:
      'Apply a structured edit plan to a scene: {"note":"…","edits":[{"op":"set","target":"title","patch":{…}}, …]}. Operations: set, add, remove, duplicate, arrange, keyframe, clearKeyframes, path, cue, group, ungroup, scene. Every edit goes through the same patches, validation, history and undo as a hand edit. --preview shows what the plan would do without saving it',
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const plan = (await readJsonFile(need(args, 2, "plan.json"))) as EditPlan;
      const result = await applyAiEditPlan(projectId, scene.id, { plan, preview: !!flags.preview }, actorOf(flags));
      console.log(green(`✔ ${scene.key} · ${result.changes.length} ${result.changes.length === 1 ? "change" : "changes"}${result.preview ? dim(" (preview — nothing saved)") : ""}`));
      if (plan.note) console.log(dim(plan.note));
      for (const line of result.explanation) console.log(`  ${line}`);
      if (result.preview) console.log(dim("Run it again without --preview to save it."));
    },
  },

  "scene:effect": {
    usage: "scene:effect <project> <scene> <element> [--blur 8] [--glow 24] [--glow-color #7DD3FC] [--shadow 0,8,24] [--shadow-color #000] [--brightness 1.1] [--contrast 1.2] [--saturate 0] [--blend multiply|normal|…] [--none]",
    description:
      "Effects on an element as a whole — blur, glow, drop shadow, brightness, contrast, saturation — and how it blends with what is underneath (ONLY when asked). Lengths are design units; --shadow takes x,y,blur. Every value can be keyframed with scene:keyframe (effectBlur, glow, glowColor, shadowX, shadowY, shadowBlur, shadowColor, brightness, contrast, saturate). --none removes them all",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const context = await sceneCueContext(projectId, scene);
      const entry = context.find(need(args, 2, "element"));
      const name = context.nameOf(entry);
      const patch: SceneElementPatch = {};
      const blend = str(flags, "blend");
      if (blend !== undefined) {
        if (!(BLEND_MODES as readonly string[]).includes(blend)) throw new AppError("VALIDATION", `Unknown blend mode “${blend}”. Use ${BLEND_MODES.join(", ")}.`);
        patch.blend = blend === "normal" ? null : (blend as (typeof BLEND_MODES)[number]);
      }
      if (flags.none) patch.effects = null;
      else {
        const effects: Record<string, number | string | null> = {};
        const num = (flag: string, key: string) => {
          const raw = str(flags, flag);
          if (raw === undefined) return;
          if (raw === "none") {
            effects[key] = null;
            return;
          }
          const value = Number(raw);
          if (!Number.isFinite(value)) throw new AppError("VALIDATION", `--${flag} takes a number, or none to remove it.`);
          effects[key] = value;
        };
        num("blur", "blur");
        num("glow", "glow");
        num("brightness", "brightness");
        num("contrast", "contrast");
        num("saturate", "saturate");
        for (const [flag, key] of [
          ["glow-color", "glowColor"],
          ["shadow-color", "shadowColor"],
        ] as const) {
          const raw = str(flags, flag);
          if (raw !== undefined) effects[key] = raw === "none" ? null : raw;
        }
        const shadow = str(flags, "shadow");
        if (shadow !== undefined) {
          if (shadow === "none") Object.assign(effects, { shadowX: null, shadowY: null, shadowBlur: null, shadowColor: null });
          else {
            const parts = shadow.split(",").map((n) => Number(n.trim()));
            if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) throw new AppError("VALIDATION", "--shadow takes x,y,blur in design units (e.g. 0,8,24).");
            Object.assign(effects, { shadowX: parts[0], shadowY: parts[1], shadowBlur: parts[2] });
          }
        }
        if (Object.keys(effects).length) patch.effects = effects as SceneElementPatch["effects"];
      }
      if (!Object.keys(patch).length) throw new AppError("VALIDATION", "Nothing to change. Pass an effect flag, --blend or --none.");
      const { element } = await updateSceneElement(projectId, scene.id, { ref: entry.ref, type: entry.element.type, patch }, actorOf(flags));
      const saved = element ?? entry.element;
      console.log(green(`✔ ${scene.key}`));
      console.log(`${bold(name)} ${dim(describeCompositing(saved))}`);
    },
  },

  "scene:clip": {
    usage: "scene:clip <project> <scene> <element> [--shape rect|circle|ellipse] [--inset 10,0,10,0] [--radius 8] [--reveal none|left|right|up|down] [--progress 0.5] [--none]",
    description:
      "A shape an element is seen through, in % of its own box (ONLY when asked). --inset takes top,right,bottom,left; --radius rounds a rect. With a --reveal direction the clip wipes open: animate it with scene:keyframe <element> clipProgress. --none removes the clip",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const context = await sceneCueContext(projectId, scene);
      const entry = context.find(need(args, 2, "element"));
      const el = entry.element;
      const name = context.nameOf(entry);
      let patch: SceneElementPatch;
      if (flags.none) {
        if (!el.clip) throw new AppError("VALIDATION", `${name} has no clip.`);
        patch = { clip: null, keyframes: (el.keyframes ?? []).filter((k) => k.property !== "clipProgress") };
      } else {
        const clip: Record<string, unknown> = {};
        const shape = str(flags, "shape");
        if (shape !== undefined) {
          if (!(CLIP_SHAPES as readonly string[]).includes(shape)) throw new AppError("VALIDATION", `Unknown clip shape “${shape}”. Use ${CLIP_SHAPES.join(", ")}.`);
          clip.type = shape;
        }
        const inset = str(flags, "inset");
        if (inset !== undefined) {
          if (inset === "none") clip.inset = null;
          else {
            const parts = inset.split(",").map((n) => Number(n.trim()));
            if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new AppError("VALIDATION", "--inset takes top,right,bottom,left in % of the element's box.");
            clip.inset = parts;
          }
        }
        const radius = str(flags, "radius");
        if (radius !== undefined) clip.radius = radius === "none" ? null : Number(radius);
        const reveal = str(flags, "reveal");
        if (reveal !== undefined) {
          if (!(CLIP_REVEALS as readonly string[]).includes(reveal)) throw new AppError("VALIDATION", `Unknown reveal “${reveal}”. Use ${CLIP_REVEALS.join(", ")}.`);
          clip.reveal = reveal === "none" ? null : reveal;
        }
        const progress = str(flags, "progress");
        if (progress !== undefined) clip.progress = Number(progress);
        if (!Object.keys(clip).length && !el.clip) clip.type = "rect";
        patch = { clip: clip as SceneElementPatch["clip"] };
      }
      const { element } = await updateSceneElement(projectId, scene.id, { ref: entry.ref, type: el.type, patch }, actorOf(flags));
      const saved = element ?? el;
      console.log(green(`✔ ${scene.key}`));
      console.log(`${bold(name)} ${dim(describeCompositing(saved))}`);
      printKeyframes({ ...entry, element: saved }, name);
    },
  },

  "scene:group": {
    usage: 'scene:group <project> <scene> <element> <element…> [--name "Title block"]',
    description:
      "Put several elements of a scene into one group (ONLY when asked): they keep their own positions and cues, and the group's transform, opacity, timing, animation and effects apply to all of them at once. Groups do not nest",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const context = await sceneCueContext(projectId, scene);
      const names = args.slice(2).filter(Boolean);
      if (names.length < 2) throw new AppError("VALIDATION", "Name at least two elements to group.");
      const entries = names.map((n) => context.find(n));
      const groupName = str(flags, "name");
      const { refs } = await applySceneElementsOperation(
        projectId,
        scene.id,
        { op: "group", items: entries.map((e) => ({ ref: e.ref, type: e.element.type })), ...(groupName ? { name: groupName } : {}) },
        actorOf(flags),
      );
      console.log(green(`✔ ${scene.key} grouped ${entries.length} elements`), dim(`#${(refs[0]?.index ?? 0) + 1}`));
    },
  },

  "scene:ungroup": {
    usage: "scene:ungroup <project> <scene> <group>",
    description:
      "Take a group apart (ONLY when asked): its children go back into the scene where the group was, keeping the group's offset and opacity. A group transform that can't belong to a single element is reported",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const context = await sceneCueContext(projectId, scene);
      const entry = context.find(need(args, 2, "group"));
      if (entry.element.type !== "group") throw new AppError("VALIDATION", `${context.nameOf(entry)} is not a group.`);
      const { refs } = await applySceneElementsOperation(projectId, scene.id, { op: "ungroup", items: [{ ref: entry.ref, type: "group" }] }, actorOf(flags));
      console.log(green(`✔ ${scene.key} ungrouped into ${refs.length} elements`));
    },
  },

  "scene:look": {
    usage: "scene:look <project> <scene> [--transition fade[:0.5[:left]]|default] [--camera pushIn[:0.04]|static] [--density minimal|low|medium|high|peak|default]",
    description: "Set how a scene enters over the previous one (type:seconds:direction, or default for the design system's transition), its camera move (type:amount) and its motion density",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const scene = await findScene(db, projectId, need(args, 1, "scene"));
      const patch: SceneLookPatch = {};
      const transition = str(flags, "transition");
      if (transition !== undefined) {
        const [type, seconds, direction] = transition.split(":");
        patch.transitionIn = transition === "default" ? null : ({ type, duration: seconds ? Number(seconds) : null, direction: direction || null } as NonNullable<SceneLookPatch["transitionIn"]>);
      }
      const camera = str(flags, "camera");
      if (camera !== undefined) {
        const [type, amount] = camera.split(":");
        patch.camera = type === "static" || type === "none" ? null : ({ type, amount: amount ? Number(amount) : null } as NonNullable<SceneLookPatch["camera"]>);
      }
      const density = str(flags, "density");
      if (density !== undefined) patch.density = density === "default" ? null : (density as SceneLookPatch["density"]);
      if (!Object.keys(patch).length) throw new AppError("BAD_REQUEST", "Pass --transition, --camera or --density, e.g. --transition slide:0.5:up.");
      const updated = await updateSceneLook(projectId, scene.id, patch, actorOf(flags));
      const v = validateSceneSpec(updated.spec);
      const spec = v.ok ? v.spec : null;
      const t = spec?.transitionIn;
      console.log(
        green(`✔ ${updated.key}`),
        dim(
          [
            `transition ${t ? `${t.type}${t.duration !== undefined ? ` ${t.duration}s` : ""}${t.direction ? ` ${t.direction}` : ""}` : "design default"}`,
            `camera ${spec?.camera ? `${spec.camera.type}${spec.camera.amount !== undefined ? ` ${spec.camera.amount}` : ""}` : "static"}`,
            `density ${spec?.motion?.density ?? "default"}`,
          ].join(" · "),
        ),
      );
    },
  },

  "scene:media:zoom": {
    usage: "scene:media:zoom <project> <scene> <element> --start 47.9 --end 51.2 --area 50,20,40 [--to 10,20,40] [--ease 0.5]",
    description: "Zoom into an area of an image or video in a scene (area = left%,top%,size% of its frame; --to pans to a second area; times in video seconds)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const { scene, item, sourceSec } = await sceneMediaItem(projectId, need(args, 1, "scene"), need(args, 2, "element"));
      const area = (key: string) => {
        const value = str(flags, key);
        if (value === undefined) return null;
        const [x, y, size] = value.split(",").map((n) => Number(n) / 100);
        if (![x, y, size].every((n) => Number.isFinite(n))) throw new AppError("BAD_REQUEST", `--${key} must be left,top,size in percent of the media frame (e.g. 50,20,40).`);
        return { x, y, size };
      };
      const rect = area("area");
      if (!rect) throw new AppError("BAD_REQUEST", "Pass --area left,top,size (percent of the media frame).");
      const start = Number(str(flags, "start"));
      const end = Number(str(flags, "end"));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new AppError("BAD_REQUEST", "Pass --start and --end in video seconds (end after start).");
      if (start < item.appearSec - 0.01 || end > item.goneSec + 0.01) throw new AppError("BAD_REQUEST", `The zoom must fall inside the time ${sceneMediaName(item)} is on screen (${item.appearSec.toFixed(2)}–${item.goneSec.toFixed(2)}s).`);
      const zoom = {
        id: `z${Date.now().toString(36)}`,
        startSec: Math.max(0, start - item.appearSec),
        endSec: Math.max(0, end - item.appearSec),
        rect,
        toRect: area("to"),
        easeSec: str(flags, "ease") === undefined ? 0.5 : Number(str(flags, "ease")),
      };
      const { element } = await updateSceneMedia(projectId, scene.id, { ref: item.ref, assetId: item.element.assetId, patch: { zooms: [...(item.element.zooms ?? []), zoom] } }, actorOf(flags));
      console.log(green(`✔ ${scene.key}`), dim(describeSceneMedia(element ? { ...item, element } : item, sourceSec)));
    },
  },

  "scene:media:unzoom": {
    usage: "scene:media:unzoom <project> <scene> <element> (--index 1 | --all)",
    description: "Remove zoom regions from an image or video in a scene",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const { scene, item } = await sceneMediaItem(projectId, need(args, 1, "scene"), need(args, 2, "element"));
      const zooms = item.element.zooms ?? [];
      const index = Number(str(flags, "index"));
      if (!flags.all && !(Number.isInteger(index) && index >= 1 && index <= zooms.length)) {
        throw new AppError("BAD_REQUEST", zooms.length ? `Pass --index 1…${zooms.length} or --all.` : `${sceneMediaName(item)} has no zoom regions.`);
      }
      const left = flags.all ? [] : zooms.filter((_, i) => i !== index - 1);
      await updateSceneMedia(projectId, scene.id, { ref: item.ref, assetId: item.element.assetId, patch: { zooms: left } }, actorOf(flags));
      console.log(green(`✔ ${scene.key}`), dim(`${left.length} zoom region${left.length === 1 ? "" : "s"} left on ${sceneMediaName(item)}`));
    },
  },

  creative: {
    usage: "creative <project> [--json]",
    description: "Show the creative plan: direction, story arc, visual language, distribution",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const plan = await getCreativePlan(projectId);
      if (flags.json) return console.log(JSON.stringify(plan, null, 2));
      if (!plan) return console.log(dim("No creative plan yet — write one (CREATIVE_SYSTEM.md) and save it with creative:apply."));
      const { direction, storyArc, visualLanguage, visualDistribution } = plan.plan;
      console.log(bold(`Creative plan v${plan.version}`) + dim(`  ${plan.source} · ${plan.sections.join(", ")}`));
      if (direction) {
        console.log(`\n${bold("Concept")}   ${direction.concept}`);
        if (direction.coreMessage) console.log(`${bold("Message")}   ${direction.coreMessage}`);
        if (direction.tone) console.log(`${bold("Tone")}      ${direction.tone}`);
        if (direction.pacing) console.log(`${bold("Pacing")}    ${direction.pacing}`);
        if (direction.avoid.length) console.log(dim(`avoid: ${direction.avoid.join(" · ")}`));
      }
      if (storyArc) {
        console.log(bold("\nStory arc"));
        for (const act of storyArc.acts) console.log(`  ${act.id.padEnd(14)} ${act.name.padEnd(24)} ${act.intensity ? `${"★".repeat(act.intensity)}${"☆".repeat(5 - act.intensity)}` : "     "}  ${dim(act.scenes.join(", "))}`);
      }
      if (visualLanguage?.summary) console.log(`\n${bold("Visual language")}  ${visualLanguage.summary}`);
      if (visualDistribution) console.log(`\n${bold("Distribution")}  ${Object.entries(visualDistribution).map(([k, v]) => `${k} ${Math.round((v ?? 0) * 100)}%`).join(" · ")}`);
    },
  },

  "creative:apply": {
    usage: 'creative:apply <project> <plan.json> [--replace] [--note "…"]',
    description: "Save the creative plan (sections in the file replace those sections; --replace stores exactly the file)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const res = await applyCreativePlan(projectId, await readJsonFile(need(args, 1, "file")), actorOf(flags), { mode: flags.replace ? "replace" : "merge", note: str(flags, "note") });
      console.log(res.changed ? green(`✔ creative plan v${res.plan?.version} · ${res.changedSections.join(", ")}`) : dim("  no changes"));
      for (const w of res.warnings) console.log(yellow(`! ${w}`));
    },
  },

  "creative:revisions": {
    usage: "creative:revisions <project>",
    description: "List creative plan revisions",
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      table((await listCreativeRevisions(projectId)).map((r) => ({ version: `v${r.version}`, source: r.source, sections: r.sections.join(", "), note: r.note, created: r.createdAt })), ["version", "source", "sections", "note", "created"]);
    },
  },

  "creative:restore": {
    usage: "creative:restore <project> <version>",
    description: "Restore a creative plan revision (saved as a new revision)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const res = await restoreCreativeRevision(projectId, Number(need(args, 1, "version")), actorOf(flags));
      console.log(res.changed ? green(`✔ restored as v${res.plan?.version}`) : dim("  already current"));
    },
  },

  "creative:metrics": {
    usage: "creative:metrics <project> [--scene scene_03] [--all] [--json]",
    description: "MEASURED creative signals: treatments, layout repetition, motion density, text load, contrast, intensity curve",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const m = await getCreativeMetrics(projectId);
      const only = str(flags, "scene");
      if (flags.json) return console.log(JSON.stringify(only ? (m.scenes.find((s) => s.key === only) ?? null) : m, null, 2));
      console.log(bold("Creative metrics") + dim(`  measured from specs, timing and assets — signals, not judgment · ${m.coverage.scenesWithIntent}/${m.coverage.scenes} scenes with creative intent`));
      const scenes = only ? m.scenes.filter((s) => s.key === only) : m.scenes;
      table(
        scenes.map((s) => ({
          scene: s.key,
          detected: s.detected.family ?? "—",
          planned: s.intent.treatment ?? "—",
          density: `${s.intent.density ?? "?"}→${s.motion.measuredDensity}`,
          intensity: `${s.intensity.planned ?? "?"}→${s.intensity.measured}`,
          burst: s.motion.maxBurst,
          words: s.typography.maxWordsOnScreen,
          shots: s.motion.shots.length || "",
          layout: s.layout.signature,
          findings: s.findings.filter((f) => f.severity !== "info").length || "",
        })),
        ["scene", "detected", "planned", "density", "intensity", "burst", "words", "shots", "layout", "findings"],
      );
      if (!only) {
        const pct = (v: number | undefined) => `${Math.round((v ?? 0) * 100)}%`;
        console.log(bold("\nDistribution") + dim("  measured (planned / target)"));
        for (const fam of new Set([...Object.keys(m.distribution.measured), ...Object.keys(m.distribution.target ?? {}), ...Object.keys(m.distribution.planned)])) {
          const k = fam as keyof typeof m.distribution.measured;
          console.log(`  ${fam.padEnd(18)} ${pct(m.distribution.measured[k]).padStart(4)} ${dim(`(${pct(m.distribution.planned[k])} / ${m.distribution.target ? pct(m.distribution.target[k]) : "—"})`)}`);
        }
        console.log(`${bold("\nIntensity")}  planned  ${m.intensity.map((i) => i.planned ?? "·").join(" ")}\n           measured ${m.intensity.map((i) => i.measured).join(" ")}`);
        console.log(`${bold("Transitions")}  ${Object.entries(m.transitions).map(([t, c]) => `${t}×${c}`).join(" · ") || "—"}`);
      }
      const findings = m.findings.filter((f) => (flags.all || f.severity !== "info") && (!only || f.scene === only));
      console.log(bold(`\nFindings`) + dim(`  ${m.counts.high} high · ${m.counts.medium} medium · ${m.counts.low} low · ${m.counts.info} info${flags.all ? "" : " (--all shows info)"}`));
      for (const f of findings) {
        const sev = f.severity === "high" ? red("HIGH") : f.severity === "medium" ? yellow("MED ") : f.severity === "low" ? cyan("low ") : dim("info");
        console.log(`  ${sev} ${dim(f.category.padEnd(12))} ${f.scene ? `${f.scene}${f.shot ? `/${f.shot}` : ""} ` : ""}${f.message}${f.measured ? dim(` [${f.measured}]`) : ""}`);
      }
    },
  },

  "creative:review": {
    usage: "creative:review <project> <review.json>",
    description: "Save a written creative review (Creative QA) — scores are advisory and must be backed by issues",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const r = await saveCreativeReview(projectId, await readJsonFile(need(args, 1, "file")), actorOf(flags));
      console.log(green(`✔ review v${r.version} ${r.id}`), dim(`${r.issues.length} issues${r.overallScore !== null ? ` · advisory score ${r.overallScore}` : ""}`));
    },
  },

  "creative:reviews": {
    usage: "creative:reviews <project> [--issues]",
    description: "List creative reviews (--issues prints the latest review's issues)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const reviews = await listCreativeReviews(projectId);
      table(
        reviews.map((r) => ({ version: `v${r.version}`, id: r.id, title: r.title || r.request, score: r.overallScore ?? "", issues: `${r.issues.filter((i) => i.status === "open" || i.status === "accepted").length}/${r.issues.length} open`, stale: r.stale ? "stale" : "", created: r.createdAt })),
        ["version", "id", "title", "score", "issues", "stale", "created"],
      );
      if (flags.issues && reviews[0]) {
        for (const i of reviews[0].issues) console.log(`  ${i.id.padEnd(6)} ${i.status.padEnd(9)} ${i.severity.padEnd(6)} ${i.category.padEnd(12)} ${i.scene ?? "project"}  ${i.issue}\n         ${dim(`→ ${i.recommendation}`)}`);
      }
    },
  },

  "creative:issue": {
    usage: "creative:issue <project> <reviewId> <issueId[,issueId]> --status open|accepted|dismissed|resolved",
    description: "Update review issue status (e.g. resolved after a refinement)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const status = str(flags, "status");
      if (!status || !(ISSUE_STATUSES as readonly string[]).includes(status)) throw new AppError("VALIDATION", `--status must be one of ${ISSUE_STATUSES.join(", ")}`);
      const r = await setReviewIssueStatus(projectId, need(args, 1, "reviewId"), need(args, 2, "issueId").split(","), status as IssueStatus, actorOf(flags));
      console.log(green(`✔ review v${r.version}: ${need(args, 2, "issueId")} → ${status}`));
    },
  },

  "creative:refine": {
    usage: 'creative:refine <project> <reviewId> <issueId[,issueId]> [--instruction "…"]',
    description: "Create an explicit refinement task from review issues (marks them accepted)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const task = await requestRefinement(projectId, need(args, 1, "reviewId"), { issueIds: need(args, 2, "issueId").split(","), instruction: str(flags, "instruction") }, actorOf(flags));
      console.log(green(`✔ ${task.id}`), dim(task.title));
    },
  },

  "creative:request-review": {
    usage: 'creative:request-review <project> "question…" [--scenes scene_02,scene_03]',
    description: "Create a read-only creative review task (e.g. \"Find the three weakest scenes\")",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const task = await requestCreativeReview(projectId, { request: args.slice(1).join(" ") || "Review this video like a senior motion designer.", sceneIds: str(flags, "scenes")?.split(",") }, actorOf(flags));
      console.log(green(`✔ ${task.id}`), dim(task.title));
    },
  },

  composition: {
    usage: "composition <project> [--json]",
    description: "Summarize the exact Remotion input the preview and renderer use (or print it with --json)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const build = await buildComposition(projectId);
      if (flags.json) {
        console.log(JSON.stringify(build.props, null, 2));
        return;
      }
      const p = build.props;
      console.log(bold(`${p.width}×${p.height} @ ${p.fps}fps · ${formatClock(p.durationSec)} · ${p.scenes.length} scenes · ${p.words.length} words · ${Object.keys(p.assets).length} visual assets · voice: ${p.voice ? "yes" : "no"} · tracks: ${p.tracks.length}`));
      console.log(dim(`  composition hash ${build.compositionHash ?? "—"}`));
      for (const s of build.issues.invalidScenes) console.log(red(`✖ ${s.key} invalid spec: ${s.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`));
      for (const m of build.issues.missingAssets) console.log(red(`✖ Scene ${m.sceneKey} requires asset ${m.assetId}.`));
      if (build.issues.staleTimingScenes.length) console.log(yellow(`! timing stale: ${build.issues.staleTimingScenes.join(", ")}`));
      if (build.issues.unapprovedScenes.length) console.log(yellow(`! not approved: ${build.issues.unapprovedScenes.join(", ")}`));
      if (!build.issues.invalidScenes.length && !build.issues.missingAssets.length) console.log(green("✔ renderable"));
    },
  },

  render: {
    usage: "render <project> [--kind final|preview|scene|range] [--scene scene_02] [--start 4.5 --end 9] [--preset project|youtube|tiktok|instagram_feed|square] [--quality high|standard|draft] [--fps 24|25|30|50|60] [--concurrency 4] [--loudness youtube|podcast|broadcast] [--captions minimal|boxed|bold|karaoke] [--caption-position bottom|top|center] [--no-audio] [--force] [--label text] [--wait]",
    description: "Queue a Remotion render (MP4 H.264); --force renders a final video with unapproved scenes",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const num = (key: string) => {
        const v = str(flags, key);
        return v === undefined ? undefined : Number(v);
      };
      const kind = str(flags, "kind") ?? (str(flags, "scene") ? "scene" : str(flags, "start") ? "range" : "final");
      const { render, job } = await createRender(
        projectId,
        {
          kind: kind as "final" | "preview" | "scene" | "range",
          sceneId: str(flags, "scene"),
          startSec: num("start"),
          endSec: num("end"),
          preset: str(flags, "preset") as never,
          quality: str(flags, "quality") as never,
          includeAudio: !flags["no-audio"],
          force: !!flags.force,
          label: str(flags, "label"),
          fps: num("fps") as never,
          concurrency: num("concurrency"),
          loudness: str(flags, "loudness") as never,
          captions: str(flags, "captions") as never,
          captionPosition: str(flags, "caption-position") as never,
        },
        actorOf(flags),
      );
      console.log(green(`✔ queued ${render.id}`), dim(`${render.label} · job ${job.id}`));
      if (flags.wait) {
        await waitForJob(job.id).catch(() => undefined);
        const done = await getRender(projectId, render.id);
        if (done.status === "complete") console.log(green(`✔ ${done.outputPath}`), dim(`${((done.sizeBytes ?? 0) / 1e6).toFixed(1)} MB · ${done.durationSec?.toFixed(2)}s`));
        else console.log(red(`✖ ${done.status}${done.error ? `: ${done.error.message}` : ""}${done.error?.sceneKey ? ` (scene ${done.error.sceneKey})` : ""}`));
      }
    },
  },

  renders: {
    usage: "renders <project>",
    description: "List render history (status, stale flag, output file)",
    run: async (args) => {
      const projectId = await resolveProject(args[0]);
      const renders = await listRenders(projectId);
      table(
        renders.map((r) => ({ id: r.id, status: r.status, progress: `${Math.round(r.progress * 100)}%`, stale: r.stale ? "stale" : "", label: r.label, output: r.outputPath ?? r.error?.message ?? "" })),
        ["id", "status", "progress", "stale", "label", "output"],
      );
    },
  },

  "renders:rename": {
    usage: "renders:rename <project> [--renumber]",
    description: "Rename completed renders still stored as renders/<renderId>.mp4 to project-named files (--renumber also renames named files by render order)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const { renamed, skipped } = await renameLegacyRenderFiles(projectId, actorOf(flags), { renumber: !!flags.renumber });
      for (const r of renamed) console.log(green(`✔ ${r.from} → ${r.to}`));
      for (const s of skipped) console.log(yellow(`! ${s.id}: ${s.reason}`));
      if (!renamed.length && !skipped.length) console.log(dim("Nothing to rename."));
    },
  },

  "render:cancel": {
    usage: "render:cancel <project> <renderId>",
    description: "Cancel a queued or running render",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const r = await cancelRender(projectId, need(args, 1, "renderId"), actorOf(flags));
      console.log(green(`✔ ${r.id} ${r.status}`));
    },
  },

  still: {
    usage: "still <project> [--sec 12.5] [--png] [--purpose thumbnail|still] [--wait]",
    description: "Export a still frame (default: project thumbnail at 35% of the video)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      const sec = str(flags, "sec");
      const job = await enqueueStill(projectId, { sec: sec === undefined ? undefined : Number(sec), format: flags.png ? "png" : "jpeg", purpose: (str(flags, "purpose") as "thumbnail" | "still" | undefined) ?? "thumbnail" });
      console.log(green(`✔ queued ${job.id}`));
      if (flags.wait) await waitForJob(job.id);
    },
  },

  "timeline:recalculate": {
    usage: "timeline:recalculate <project>",
    description: "Rebuild the timeline from the active transcript (re-times audio-locked scenes)",
    run: async (args, flags) => {
      const projectId = await resolveProject(args[0]);
      console.log(green("✔"), JSON.stringify(await recalculateTimeline(projectId, actorOf(flags))));
    },
  },

  job: {
    usage: "job <jobId> [--wait]",
    description: "Show a background job",
    run: async (args, flags) => {
      const id = need(args, 0, "jobId");
      if (flags.wait) return waitForJob(id);
      console.log(JSON.stringify(publicJob(await getJob(id)), null, 2));
    },
  },
};

export function registerCommand(name: string, command: Command): void {
  COMMANDS[name] = command;
}

export { enqueueJob, resolveProject, readJsonFile, waitForJob, need, str, actorOf, table, green, red, yellow, dim, bold };

/** A scene's images and videos with the seconds they're on screen. */
async function sceneMediaItems(projectId: string, sceneRef: string) {
  const scene = await findScene(db, projectId, sceneRef);
  const project = await db.project.findUnique({ where: { id: projectId }, include: { activeTranscript: true } });
  const words = (project?.activeTranscript?.words ?? []) as TimedWord[];
  const v = validateSceneSpec(scene.spec);
  if (!v.ok) throw new AppError("PRECONDITION", `The spec of ${scene.key} is invalid — fix it first.`);
  return { scene, items: listSceneMedia(v.spec, { words, sceneStart: scene.startSec, sceneEnd: scene.endSec }) };
}

/** One image or video of a scene, by element id (`video_1`) or position (`#2`, `shot_b/#1`). */
async function sceneMediaItem(projectId: string, sceneRef: string, elementRef: string) {
  const { scene, items } = await sceneMediaItems(projectId, sceneRef);
  const m = /^(?:([A-Za-z0-9_-]+)\/)?#(\d+)$/.exec(elementRef);
  const item = items.find((i) => i.element.id === elementRef) ?? (m ? items.find((i) => i.ref.shotId === (m[1] ?? null) && i.ref.index === Number(m[2]) - 1) : undefined);
  if (!item) throw new AppError("NOT_FOUND", `No image or video “${elementRef}” in ${scene.key}. ${items.length ? `Its media: ${items.map(sceneMediaName).join(", ")}.` : "It has no images or videos."}`);
  const asset = await db.asset.findFirst({ where: { id: item.element.assetId, projectId }, select: { name: true, durationSec: true } });
  return { scene, item, sourceSec: asset?.durationSec ?? null };
}

function describeSceneMedia(item: SceneMediaItem, sourceSec: number | null): string {
  const t = sceneVideoTiming(item.element, sourceSec);
  const zooms = item.element.zooms ?? [];
  return [
    `${sceneMediaName(item)} (${item.element.type} ${item.element.assetId})`,
    `on screen ${item.appearSec.toFixed(2)}–${item.goneSec.toFixed(2)}s`,
    ...(item.element.type === "video" ? [`trim ${t.trimStartSec}–${t.trimEndSec ?? "end"}`, `${t.playbackRate}×`, t.trimmedLengthSec !== null ? `plays ${t.trimmedLengthSec.toFixed(2)}s, then ${t.endBehavior === "loop" ? "loops" : "holds"}` : ""] : []),
    zooms.length ? `zooms ${zooms.map((z) => `${(item.appearSec + z.startSec).toFixed(2)}–${(item.appearSec + z.endSec).toFixed(2)}s`).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = COMMANDS[command];
  if (!cmd) {
    console.error(red(`Unknown command “${command}”.`) + " Run `npm run studio -- help`.");
    process.exitCode = 1;
    return;
  }
  try {
    await cmd.run(positional, flags);
  } catch (err) {
    if (isAppError(err)) {
      const e = err as AppError;
      console.error(red(`✖ ${e.message}`));
      if (e.hint) console.error(dim(`  ${e.hint}`));
      if (e.details) console.error(dim(JSON.stringify(e.details, null, 2)));
    } else {
      console.error(red(`✖ ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main();
