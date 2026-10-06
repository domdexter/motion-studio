import fs from "node:fs/promises";
import path from "node:path";
import { composeGenerationBrief } from "@/core/creative/briefs";
import type { AssetBrief } from "@/core/creative/schema";
import { BrandProfileSchema } from "@/core/spec/brand";
import type { DesignSystem } from "@/core/spec/design";
import { aspectRatioLabel } from "@/core/spec/format";
import { TRANSCRIPT_SOURCE_LABELS, type TimedWord, type TimelineData, type TranscriptSource } from "@/core/spec/timing";
import { STATUS_LABELS } from "@/core/status/pipeline";
import { db } from "../db";
import { projectDir, sha256, writeFileAtomic } from "../storage/paths";
import { getCreativeMetrics, getCreativePlan } from "./creative";
import { getProjectState } from "./state";

/**
 * Materializes projects/<id>/.project/ — the shared state Claude Code reads directly.
 *
 * Editable files (creative-brief.md, design.json, script.md, creative.json, storyboard.json, scenes.json)
 * get a copy in .project/.sync/base/. If a file on disk no longer matches its base, someone
 * (usually Claude Code) edited it and the import has not happened yet — we never overwrite
 * such a pending edit; the importer performs a 3-way merge against the base instead.
 */

export const EDITABLE_CONTEXT_FILES = ["creative-brief.md", "design.json", "script.md", "creative.json", "storyboard.json", "scenes.json"] as const;
export type EditableContextFile = (typeof EDITABLE_CONTEXT_FILES)[number];

const j = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function contextPath(projectId: string, file: string): string {
  return path.join(projectDir(projectId), ".project", file);
}

export function basePath(projectId: string, file: string): string {
  return path.join(projectDir(projectId), ".project", ".sync", "base", file);
}

async function readText(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

export async function readBase(projectId: string, file: EditableContextFile): Promise<string | null> {
  return readText(basePath(projectId, file));
}

/** Marks the current on-disk content of an editable file as acknowledged (after import). */
export async function acknowledgeFile(projectId: string, file: EditableContextFile): Promise<void> {
  const disk = await readText(contextPath(projectId, file));
  if (disk !== null) await writeFileAtomic(basePath(projectId, file), disk);
}

export async function hasPendingEdit(projectId: string, file: EditableContextFile): Promise<boolean> {
  const [disk, base] = await Promise.all([readText(contextPath(projectId, file)), readBase(projectId, file)]);
  return disk !== null && base !== null && disk !== base;
}

// ---------------------------------------------------------------------------------------
// Serializers shared with the CLI and importers
// ---------------------------------------------------------------------------------------

type SceneRow = Awaited<ReturnType<typeof loadScenes>>[number];

function loadScenes(projectId: string) {
  return db.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
}

export function storyboardEntry(s: SceneRow) {
  return {
    uid: s.id,
    sceneId: s.key,
    name: s.name,
    start: r3(s.startSec),
    end: r3(s.endSec),
    duration: r3(s.endSec - s.startSec),
    timingMode: s.timingMode,
    locked: s.locked,
    status: s.status,
    voiceText: s.voiceText,
    visualConcept: s.visualConcept,
    visualType: s.visualType,
    animation: s.animationNotes,
    onScreenText: s.onScreenText,
    assetsRequired: s.assetsRequired,
    notes: s.notes,
    creative: s.creative ?? null,
  };
}

export function scenesFileEntry(s: SceneRow) {
  const spec = (s.spec ?? {}) as Record<string, unknown>;
  return {
    uid: s.id,
    id: s.key,
    name: s.name,
    start: r3(s.startSec),
    end: r3(s.endSec),
    duration: r3(s.endSec - s.startSec),
    locked: s.locked,
    status: s.status,
    ...spec,
  };
}

function brandMarkdown(name: string, brandJson: unknown, design: DesignSystem): string {
  const b = BrandProfileSchema.parse(brandJson ?? {});
  const line = (label: string, value: string) => (value.trim() ? `- **${label}:** ${value.trim()}\n` : "");
  return (
    `# Brand — ${b.brandName || name}\n\n` +
    `> Read-only mirror. Edit brand identity in the GUI (Assets → Brand). Colors and fonts live in design.json.\n\n` +
    line("Brand name", b.brandName) +
    line("Tagline", b.tagline) +
    line("Website", b.website) +
    line("Logo asset", b.logoAssetId ?? "") +
    `\n## Design tokens (from design.json)\n\n` +
    `- Preset: ${design.preset}\n` +
    Object.entries(design.colors)
      .map(([k, v]) => `- ${k}: \`${v}\`\n`)
      .join("") +
    `- Heading font: ${design.typography.headingFont} (${design.typography.headingWeight})\n` +
    `- Body font: ${design.typography.bodyFont}\n` +
    `- Motion: ${design.motion.easing}, ${design.motion.defaultDuration}s, stagger ${design.motion.stagger}s, ${design.motion.intensity}\n\n` +
    (b.visualStyle ? `## Visual style\n\n${b.visualStyle}\n\n` : "") +
    (b.imageStyle ? `## Image style\n\n${b.imageStyle}\n\n` : "") +
    (b.animationStyle ? `## Animation style\n\n${b.animationStyle}\n\n` : "") +
    (b.typographyNotes ? `## Typography\n\n${b.typographyNotes}\n\n` : "") +
    (b.guidelines ? `## Guidelines\n\n${b.guidelines}\n` : "")
  );
}

function readme(p: { id: string; name: string; width: number; height: number; fps: number }, statusLabel: string, lockedKeys: string[]): string {
  return `# ${p.name} — Claude Code project context

Generated by Motion Studio and kept in sync with the database. Read \`AI_WORKFLOW.md\` at the
repository root before changing anything.

- Project id: \`${p.id}\`
- Format: ${p.width}×${p.height} (${aspectRatioLabel(p.width, p.height)}) @ ${p.fps} fps
- Status: ${statusLabel}
- Locked scenes (never modify): ${lockedKeys.length ? lockedKeys.join(", ") : "none"}

| File | Purpose | Editable |
| --- | --- | --- |
| project.json | Metadata, pipeline stages, staleness, next action | no |
| creative-brief.md | Goals, audience, tone | yes |
| brand.md | Brand profile + token summary | no (GUI) |
| design.json | Motion design system tokens every scene inherits | yes |
| script.md | Current script (saving creates a revision) | yes |
| script-analysis.json | Beats, emphasis, visual opportunities (ESTIMATED timing) | via CLI |
| creative.json | Creative plan: direction, story arc, visual language, distribution, asset strategy | yes |
| creative-metrics.json | MEASURED creative signals: treatments, repetition, density, text, contrast, intensity | no |
| creative-review.json | Latest written creative review and its issues | via CLI |
| transcript.json | ACTUAL word timings from the voice-over | no |
| timeline.json | Audio-locked master timeline (segments, phrases, words) | no |
| storyboard.json | Creative intent per scene | creative fields only |
| scenes.json | Remotion scene specs | spec fields only |
| assets.json | Asset library + AI asset requests | via CLI |
| audio.json | Voice / music / SFX mix | no |
| overlays.json | Overlay track: images/videos above the scenes in video time (trim, placement) | no |
| renders.json | Render history | no |
| tasks/*.md | Pending AI tasks for Claude Code | no |

Rules: timing comes from the audio — never edit start/end in files. Locked scenes are
read-only. Design scenes from creative.json, not in isolation (CREATIVE_SYSTEM.md). After
editing run \`npm run studio -- validate ${p.id}\` and \`npm run studio -- creative:metrics ${p.id}\`.
`;
}

// ---------------------------------------------------------------------------------------
// Materialize
// ---------------------------------------------------------------------------------------

export async function materializeProject(projectId: string): Promise<void> {
  const p = await db.project.findUnique({
    where: { id: projectId },
    include: { activeVoiceTake: true, activeTranscript: true, activeTimeline: true, brandKit: { select: { id: true, name: true, version: true } } },
  });
  if (!p) return;
  const root = projectDir(projectId);
  const dir = path.join(root, ".project");
  await fs.mkdir(path.join(dir, "tasks"), { recursive: true });
  await fs.mkdir(path.join(dir, ".sync", "base"), { recursive: true });

  const [state, script, scenes, assets, requests, tracks, renders, tasks, overlayClips] = await Promise.all([
    getProjectState(projectId),
    db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" } }),
    loadScenes(projectId),
    db.asset.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    db.assetRequest.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, include: { assets: { select: { id: true } } } }),
    db.audioTrack.findMany({ where: { projectId }, orderBy: { order: "asc" }, include: { asset: { select: { filePath: true, name: true } } } }),
    db.render.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.aiTask.findMany({ where: { projectId, status: { in: ["pending", "running"] } }, orderBy: { createdAt: "asc" } }),
    db.overlayClip.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: { asset: { select: { filePath: true, name: true, mimeType: true } } } }),
  ]);
  const keyById = new Map(scenes.map((s) => [s.id, s.key]));
  const design = p.design as DesignSystem;
  const words = (p.activeTranscript?.words ?? []) as TimedWord[];
  const timeline = (p.activeTimeline?.data ?? null) as TimelineData | null;

  const files: Record<string, string> = {};
  files["README.md"] = readme(p, STATUS_LABELS[state.pipeline.status], scenes.filter((s) => s.locked).map((s) => s.key));
  files["project.json"] = j({
    id: p.id,
    name: p.name,
    workflow: p.workflow,
    revision: p.revision,
    format: { width: p.width, height: p.height, fps: p.fps, aspect: aspectRatioLabel(p.width, p.height), preset: p.formatPreset },
    status: state.pipeline.status,
    stages: state.pipeline.stages,
    next: state.pipeline.next,
    durationSec: state.durationSec,
    voice: p.activeVoiceTake
      ? {
          version: p.activeVoiceTake.version,
          source: p.activeVoiceTake.source,
          file: p.activeVoiceTake.filePath,
          durationSec: p.activeVoiceTake.durationSec,
          voiceName: p.activeVoiceTake.voiceName,
          modelId: p.activeVoiceTake.modelId,
        }
      : null,
    transcript: p.activeTranscript
      ? { version: p.activeTranscript.version, source: p.activeTranscript.source, words: p.activeTranscript.wordCount }
      : null,
    timeline: p.activeTimeline ? { version: p.activeTimeline.version, source: p.activeTimeline.source, durationSec: p.activeTimeline.durationSec } : null,
    timelineDecision: p.timelineDecision,
    /** Brand kit the project follows (null = custom brand). Colors and fonts are in design.json either way. */
    brandKit: p.brandKit ? { id: p.brandKit.id, name: p.brandKit.name, version: p.brandKit.version, syncedVersion: p.brandKitVersion } : null,
    scenes: {
      count: scenes.length,
      approved: scenes.filter((s) => s.status === "approved").map((s) => s.key),
      locked: scenes.filter((s) => s.locked).map((s) => s.key),
      invalid: Object.values(state.scenes)
        .filter((s) => !s.valid)
        .map((s) => ({ scene: s.key, issues: s.issues })),
      staleTiming: Object.values(state.scenes)
        .filter((s) => s.staleTiming)
        .map((s) => s.key),
    },
    assets: { count: assets.length, openRequests: state.counts.openRequests, awaitingApproval: state.counts.awaitingApproval },
    compositionHash: state.compositionHash,
    updatedAt: p.updatedAt.toISOString(),
  });
  files["creative-brief.md"] = p.brief.trim() ? `${p.brief.trim()}\n` : "";
  files["brand.md"] = brandMarkdown(p.name, p.brand, design);
  files["design.json"] = j(design);
  files["script.md"] = script ? (script.content.endsWith("\n") ? script.content : `${script.content}\n`) : "";
  files["script-analysis.json"] = j(
    script?.analysis
      ? { scriptVersion: script.version, source: script.analysisSource, note: "All timing in this file is ESTIMATED from word counts.", analysis: script.analysis }
      : { scriptVersion: script?.version ?? null, analysis: null },
  );
  files["transcript.json"] = j(
    p.activeTranscript
      ? {
          version: p.activeTranscript.version,
          source: p.activeTranscript.source,
          sourceLabel: TRANSCRIPT_SOURCE_LABELS[p.activeTranscript.source as TranscriptSource] ?? p.activeTranscript.source,
          voiceTakeVersion: p.activeVoiceTake?.version ?? null,
          durationSec: p.activeTranscript.durationSec,
          language: p.activeTranscript.language,
          quality: p.activeTranscript.quality,
          text: p.activeTranscript.text,
          words,
        }
      : { transcript: null },
  );
  files["timeline.json"] = j(
    timeline
      ? {
          timebase: "seconds",
          fps: p.fps,
          version: p.activeTimeline!.version,
          source: p.activeTimeline!.source,
          duration: timeline.duration,
          segments: timeline.sentences,
          phrases: timeline.phrases,
          paragraphs: timeline.paragraphs,
          pauses: timeline.pauses,
          ...(timeline.cues ? { cues: timeline.cues } : {}),
          words,
        }
      : { timeline: null, note: "No timeline yet — generate or import a voice-over and align it first." },
  );
  files["storyboard.json"] = j({
    $schema: "motion-studio/storyboard@1",
    _readme: "Edit creative intent only (name, visualConcept, visualType, animation, onScreenText, assetsRequired, notes, creative). Timing/lock/status are read-only.",
    projectId: p.id,
    timelineVersion: p.activeTimeline?.version ?? null,
    scenes: scenes.map(storyboardEntry),
  });
  const [creativePlan, creativeMetrics, creativeReview] = await Promise.all([
    getCreativePlan(projectId),
    getCreativeMetrics(projectId).catch((err) => {
      console.error(`[context] creative metrics failed for ${projectId}:`, err);
      return null;
    }),
    import("./creative-reviews").then((m) => m.getLatestCreativeReview(projectId)).catch(() => null),
  ]);
  files["creative.json"] = j({
    $schema: "motion-studio/creative@1",
    _readme: "Project creative plan (CREATIVE_SYSTEM.md): direction, storyArc, visualLanguage, visualDistribution, assetStrategy, references, notes. Editing saves the whole file as a new plan revision (a removed section is removed; `creative:apply` merges by section instead). $schema, _readme, projectId, revision, source and updatedAt are read-only.",
    projectId: p.id,
    revision: creativePlan?.version ?? null,
    ...(creativePlan?.plan ?? {}),
  });
  files["creative-metrics.json"] = j(
    creativeMetrics
      ? { _readme: "MEASURED signals computed from the scene specs, timing and assets — not creative judgment. Findings use conservative heuristics; verify them against renders.", ...creativeMetrics }
      : { metrics: null },
  );
  files["creative-review.json"] = j(
    creativeReview
      ? { _readme: "Latest written creative review. Update issue status with `npm run studio -- creative:issue`.", ...creativeReview }
      : { review: null, note: "No creative review yet — create one with `npm run studio -- creative:review <project> <review.json>`." },
  );
  files["scenes.json"] = j({
    $schema: "motion-studio/scenes@1",
    _readme: "Each entry is a SceneSpec (see REMOTION.md). Edit background/transitionIn/camera/elements/notes. uid/id/name/start/end/duration/locked/status are read-only.",
    projectId: p.id,
    fps: p.fps,
    width: p.width,
    height: p.height,
    scenes: scenes.map(scenesFileEntry),
  });
  files["assets.json"] = j({
    assets: assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      source: a.source,
      file: a.filePath,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
      durationSec: a.durationSec,
      status: a.status,
      scene: a.sceneId ? keyById.get(a.sceneId) ?? null : null,
      prompt: a.prompt,
      requestId: a.requestId,
      contentHash: a.contentHash,
    })),
    requests: requests.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      scene: r.sceneId ? keyById.get(r.sceneId) ?? null : null,
      prompt: r.prompt,
      negativePrompt: r.negativePrompt,
      aspectRatio: r.aspectRatio,
      width: r.width,
      height: r.height,
      durationSec: r.durationSec,
      purpose: r.purpose,
      styleNotes: r.styleNotes,
      brief: r.brief ?? null,
      /** Brief + project asset consistency, composed deterministically — what the generation must follow. */
      generationBrief: composeGenerationBrief({
        kind: r.kind as "image" | "video",
        prompt: r.prompt,
        aspectRatio: r.aspectRatio,
        purpose: r.purpose,
        styleNotes: r.styleNotes,
        negativePrompt: r.negativePrompt,
        brief: (r.brief ?? null) as AssetBrief | null,
        consistency: creativePlan?.plan.assetStrategy?.consistency ?? null,
      }),
      count: r.count,
      feedback: r.feedback,
      attempt: r.attempt,
      resultAssetIds: r.assets.map((x) => x.id),
      approvedAssetId: r.approvedAssetId,
    })),
  });
  files["audio.json"] = j({
    voice: p.activeVoiceTake ? { file: p.activeVoiceTake.filePath, ...(p.mix as object) } : null,
    tracks: tracks.map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      assetId: t.assetId,
      file: t.asset.filePath,
      startSec: t.startSec,
      trimStartSec: t.trimStartSec,
      durationSec: t.durationSec,
      volume: t.volume,
      fadeInSec: t.fadeInSec,
      fadeOutSec: t.fadeOutSec,
      muted: t.muted,
      loop: t.loop,
      duckUnderVoice: t.duckUnderVoice,
    })),
  });
  files["overlays.json"] = j({
    _readme: "Overlay track: images and videos drawn above the scenes, placed in absolute video time (they can span scene cuts). Edit with the overlay:* CLI commands or on the timeline.",
    overlays: overlayClips.map((c) => ({
      id: c.id,
      name: c.name,
      assetId: c.assetId,
      kind: c.asset.mimeType.startsWith("video/") ? "video" : "image",
      file: c.asset.filePath,
      placement: c.placement,
      fit: c.fit,
      startSec: c.startSec,
      durationSec: c.durationSec,
      trimStartSec: c.trimStartSec,
      trimEndSec: c.trimEndSec,
      playbackRate: c.playbackRate,
      endBehavior: c.endBehavior,
      volume: c.volume,
      dim: c.dim,
      opacity: c.opacity,
      fadeInSec: c.fadeInSec,
      fadeOutSec: c.fadeOutSec,
      hidden: c.hidden,
      zooms: c.zooms,
      crop: c.crop,
      speedSegments: c.speedSegments,
      annotations: c.annotations,
      duckUnderVoice: c.duckUnderVoice,
    })),
  });
  files["renders.json"] = j({
    renders: renders.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      file: r.outputPath,
      settings: r.settings,
      compositionHash: r.compositionHash,
      stale: !!state.compositionHash && r.compositionHash !== state.compositionHash,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  });

  const taskFiles = new Set<string>();
  for (const t of tasks) {
    const name = `tasks/${t.id}.md`;
    taskFiles.add(name);
    const { taskBriefMarkdown } = await import("./task-brief");
    files[name] = await taskBriefMarkdown(t, { projectName: p.name, keyById });
  }

  for (const [name, content] of Object.entries(files)) {
    const abs = path.join(dir, name);
    const disk = await readText(abs);
    if (disk === content) {
      if ((EDITABLE_CONTEXT_FILES as readonly string[]).includes(name)) {
        const base = await readBase(projectId, name as EditableContextFile);
        if (base !== content) await writeFileAtomic(basePath(projectId, name), content);
      }
      continue;
    }
    if ((EDITABLE_CONTEXT_FILES as readonly string[]).includes(name)) {
      const base = await readBase(projectId, name as EditableContextFile);
      // Pending external edit → leave it for the importer (3-way merge against base).
      if (disk !== null && base !== null && disk !== base) continue;
      await writeFileAtomic(abs, content);
      await writeFileAtomic(basePath(projectId, name), content);
    } else {
      await writeFileAtomic(abs, content);
    }
  }

  // Remove briefs of tasks that are no longer pending.
  const existing = await fs.readdir(path.join(dir, "tasks")).catch(() => [] as string[]);
  await Promise.all(
    existing.filter((f) => f.endsWith(".md") && !taskFiles.has(`tasks/${f}`)).map((f) => fs.rm(path.join(dir, "tasks", f), { force: true })),
  );
  await writeFileAtomic(path.join(dir, ".sync", "materialized.json"), j({ revision: p.revision, at: new Date().toISOString(), hashes: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(v)])) }));
}
