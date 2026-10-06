import fs from "node:fs/promises";
import { z } from "zod";
import { DESIGN_PRESETS, applyBrandToDesign, getDesignPreset } from "@/core/design/presets";
import { BrandProfileSchema, type BrandProfile } from "@/core/spec/brand";
import { DesignSystemSchema, type DesignSystem } from "@/core/spec/design";
import { WORKFLOW_INFO, WorkflowSchema } from "@/core/spec/enums";
import { FORMAT_PRESETS, FormatPresetIdSchema, aspectRatioLabel, validateDimensions } from "@/core/spec/format";
import { scriptSpokenHash } from "@/core/script/script";
import { STATUS_LABELS, type ProductionStatus } from "@/core/status/pipeline";
import { parseVoiceMix } from "@/core/timeline/audio-clips";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { assertProjectId, newProjectId } from "../ids";
import { ensureProjectDirs, projectDir, projectFile } from "../storage/paths";
import { materializeSafely, mutateProject, type Actor } from "./mutation";
import { forgetProjectState, getProjectState, type ProjectState } from "./state";

// ---------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const BrandInputSchema = z.object({
  brandName: z.string().max(120).optional(),
  tagline: z.string().max(240).optional(),
  website: z.string().max(240).optional(),
  primaryColor: HexColor.optional(),
  secondaryColor: HexColor.optional(),
  accentColor: HexColor.optional(),
  backgroundColor: HexColor.optional(),
  textColor: HexColor.optional(),
  headingFont: z.string().max(80).optional(),
  bodyFont: z.string().max(80).optional(),
  typographyNotes: z.string().max(4000).optional(),
  visualStyle: z.string().max(4000).optional(),
  imageStyle: z.string().max(4000).optional(),
  animationStyle: z.string().max(4000).optional(),
  guidelines: z.string().max(20000).optional(),
});
export type BrandInput = z.infer<typeof BrandInputSchema>;

export const CreateProjectSchema = z
  .object({
    name: z.string().trim().min(1, "Project name is required").max(120),
    workflow: WorkflowSchema.default("blank"),
    formatPreset: FormatPresetIdSchema.default("landscape_16_9"),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(30),
    designPreset: z.string().default("premium_saas"),
    brand: BrandInputSchema.optional(),
    brief: z.string().max(20000).default(""),
    script: z.string().max(200_000).optional(),
  })
  .transform((v, ctx) => {
    const preset = FORMAT_PRESETS.find((p) => p.id === v.formatPreset);
    const width = preset ? preset.width : v.width;
    const height = preset ? preset.height : v.height;
    if (!width || !height) {
      ctx.addIssue({ code: "custom", message: "Custom formats need a width and height.", path: ["width"] });
      return z.NEVER;
    }
    const dimError = validateDimensions(width, height);
    if (dimError) {
      ctx.addIssue({ code: "custom", message: dimError, path: ["width"] });
      return z.NEVER;
    }
    return { ...v, width, height };
  });
export type CreateProjectInput = z.input<typeof CreateProjectSchema>;

export const ListProjectsQuerySchema = z.object({
  search: z.string().max(200).optional(),
  sort: z.enum(["updated", "created", "name"]).default("updated"),
  filter: z.enum(["active", "archived", "all"]).default("active"),
  status: z.string().optional(),
});
export type ListProjectsQuery = z.input<typeof ListProjectsQuerySchema>;

export const UpdateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    brief: z.string().max(20000).optional(),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).optional(),
    formatPreset: FormatPresetIdSchema.optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------------------

export interface ProjectCard {
  id: string;
  name: string;
  workflow: string;
  width: number;
  height: number;
  fps: number;
  aspect: string;
  durationSec: number | null;
  status: ProductionStatus;
  statusLabel: string;
  stage: string;
  staleCount: number;
  sceneCount: number;
  render: { status: string; progress: number; stale: boolean; createdAt: string } | null;
  thumbnailUrl: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
  brandColors: { primary: string; background: string; accent: string };
}

export function fileUrl(projectId: string, relPath: string, version?: string | number): string {
  const encoded = relPath
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `/api/projects/${projectId}/files/${encoded}${version !== undefined ? `?v=${encodeURIComponent(String(version))}` : ""}`;
}

async function fileExists(projectId: string, relPath: string): Promise<boolean> {
  try {
    await fs.access(projectFile(projectId, relPath));
    return true;
  } catch {
    return false;
  }
}

/**
 * The project picture: the saved thumbnail, or — when its file was deleted from disk — the newest
 * render thumbnail that still exists (final renders first).
 */
async function liveThumbnailPath(projectId: string, saved: string | null): Promise<string | null> {
  if (saved && (await fileExists(projectId, saved))) return saved;
  const renders = await db.render.findMany({
    where: { projectId, status: "complete", thumbnailPath: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { kind: true, thumbnailPath: true },
    take: 60,
  });
  for (const r of [...renders.filter((r) => r.kind === "final"), ...renders.filter((r) => r.kind !== "final")]) {
    if (await fileExists(projectId, r.thumbnailPath!)) return r.thumbnailPath;
  }
  return null;
}

function toCard(p: { id: string; name: string; workflow: string; width: number; height: number; fps: number; thumbnailPath: string | null; archivedAt: Date | null; createdAt: Date; updatedAt: Date; revision: number; design: unknown }, state: ProjectState): ProjectCard {
  const design = p.design as DesignSystem;
  return {
    id: p.id,
    name: p.name,
    workflow: p.workflow,
    width: p.width,
    height: p.height,
    fps: p.fps,
    aspect: aspectRatioLabel(p.width, p.height),
    durationSec: state.durationSec,
    status: state.pipeline.status,
    statusLabel: STATUS_LABELS[state.pipeline.status],
    stage: state.pipeline.next?.label ?? STATUS_LABELS[state.pipeline.status],
    staleCount: state.pipeline.staleCount,
    sceneCount: state.counts.scenes,
    render: state.latestRender
      ? { status: state.latestRender.status, progress: state.latestRender.progress, stale: state.latestRender.stale, createdAt: state.latestRender.createdAt }
      : null,
    thumbnailUrl: p.thumbnailPath ? fileUrl(p.id, p.thumbnailPath, p.revision) : null,
    archived: !!p.archivedAt,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    revision: p.revision,
    brandColors: { primary: design?.colors?.primary ?? "#7C6CFF", background: design?.colors?.background ?? "#07080D", accent: design?.colors?.accent ?? "#FFB547" },
  };
}

const CARD_SELECT = {
  id: true,
  name: true,
  workflow: true,
  width: true,
  height: true,
  fps: true,
  thumbnailPath: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  revision: true,
  design: true,
} as const;

export async function listProjects(query: ListProjectsQuery = {}): Promise<ProjectCard[]> {
  const q = ListProjectsQuerySchema.parse(query);
  const rows = await db.project.findMany({
    where: {
      ...(q.filter === "active" ? { archivedAt: null } : q.filter === "archived" ? { archivedAt: { not: null } } : {}),
      ...(q.search?.trim() ? { name: { contains: q.search.trim(), mode: "insensitive" as const } } : {}),
    },
    orderBy: q.sort === "name" ? { name: "asc" } : q.sort === "created" ? { createdAt: "desc" } : { updatedAt: "desc" },
    select: CARD_SELECT,
  });
  const cards = await Promise.all(rows.map(async (p) => toCard({ ...p, thumbnailPath: await liveThumbnailPath(p.id, p.thumbnailPath) }, await getProjectState(p.id))));
  return q.status ? cards.filter((c) => c.status === q.status) : cards;
}

export async function countProjects(): Promise<{ total: number; active: number; archived: number }> {
  const [total, archived] = await Promise.all([db.project.count(), db.project.count({ where: { archivedAt: { not: null } } })]);
  return { total, active: total - archived, archived };
}

export async function getProjectDetail(projectId: string) {
  assertProjectId(projectId);
  const p = await db.project.findUnique({
    where: { id: projectId },
    include: {
      activeVoiceTake: {
        select: { id: true, version: true, source: true, label: true, filePath: true, mimeType: true, durationSec: true, contentHash: true, voiceName: true, modelId: true, createdAt: true, peaksPath: true },
      },
      activeTranscript: { select: { id: true, version: true, source: true, wordCount: true, durationSec: true, voiceTakeId: true, createdAt: true } },
      activeTimeline: { select: { id: true, version: true, source: true, durationSec: true, transcriptId: true, createdAt: true } },
      brandKit: { select: { id: true, name: true, version: true } },
    },
  });
  if (!p) throw notFound("Project");
  const [state, script, thumbnailPath] = await Promise.all([
    getProjectState(projectId),
    db.scriptRevision.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { id: true, version: true, createdAt: true, contentHash: true } }),
    liveThumbnailPath(projectId, p.thumbnailPath),
  ]);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    workflow: p.workflow,
    formatPreset: p.formatPreset,
    width: p.width,
    height: p.height,
    fps: p.fps,
    aspect: aspectRatioLabel(p.width, p.height),
    brief: p.brief,
    brand: BrandProfileSchema.parse(p.brand ?? {}),
    /** The brand kit this project follows (null = custom brand). */
    brandKit: p.brandKit ? { id: p.brandKit.id, name: p.brandKit.name, version: p.brandKit.version, syncedVersion: p.brandKitVersion } : null,
    design: p.design as DesignSystem,
    markers: p.markers,
    mix: parseVoiceMix(p.mix),
    timelineDecision: p.timelineDecision as { voiceTakeId: string; decision: "keep" | "recalculate"; at: string } | null,
    thumbnailUrl: thumbnailPath ? fileUrl(p.id, thumbnailPath, p.revision) : null,
    revision: p.revision,
    archived: !!p.archivedAt,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    folder: projectDir(p.id),
    script: script ? { id: script.id, version: script.version, createdAt: script.createdAt.toISOString() } : null,
    voice: p.activeVoiceTake
      ? {
          ...p.activeVoiceTake,
          createdAt: p.activeVoiceTake.createdAt.toISOString(),
          url: fileUrl(p.id, p.activeVoiceTake.filePath, p.activeVoiceTake.contentHash.slice(0, 12)),
          peaksUrl: p.activeVoiceTake.peaksPath ? fileUrl(p.id, p.activeVoiceTake.peaksPath, p.activeVoiceTake.contentHash.slice(0, 12)) : null,
        }
      : null,
    transcript: p.activeTranscript ? { ...p.activeTranscript, createdAt: p.activeTranscript.createdAt.toISOString() } : null,
    timeline: p.activeTimeline ? { ...p.activeTimeline, createdAt: p.activeTimeline.createdAt.toISOString() } : null,
    state,
  };
}
export type ProjectDetail = Awaited<ReturnType<typeof getProjectDetail>>;

// ---------------------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------------------

function brandFromInput(input: BrandInput | undefined): BrandProfile {
  return BrandProfileSchema.parse({
    brandName: input?.brandName ?? "",
    tagline: input?.tagline ?? "",
    website: input?.website ?? "",
    typographyNotes: input?.typographyNotes ?? "",
    visualStyle: input?.visualStyle ?? "",
    imageStyle: input?.imageStyle ?? "",
    animationStyle: input?.animationStyle ?? "",
    guidelines: input?.guidelines ?? "",
  });
}

export async function createProject(input: CreateProjectInput, actor: Actor = "user"): Promise<ProjectDetail> {
  const data = CreateProjectSchema.parse(input);
  let id = newProjectId(data.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await db.project.findUnique({ where: { id }, select: { id: true } });
    if (!exists) break;
    id = newProjectId(data.name);
  }
  const preset = getDesignPreset(data.designPreset) ?? DESIGN_PRESETS[0];
  const design = DesignSystemSchema.parse(applyBrandToDesign(preset.design, data.brand ?? {}));
  const brand = brandFromInput(data.brand);

  await ensureProjectDirs(id);
  await db.$transaction(async (tx) => {
    await tx.project.create({
      data: {
        id,
        name: data.name,
        workflow: data.workflow,
        formatPreset: data.formatPreset,
        width: data.width,
        height: data.height,
        fps: data.fps,
        brief: data.brief,
        brand: json(brand),
        design: json(design),
        mix: json({ volume: 1, muted: false }),
        revision: 1,
      },
    });
    if (data.script?.trim()) {
      await tx.scriptRevision.create({
        data: { projectId: id, version: 1, content: data.script, contentHash: scriptSpokenHash(data.script), source: "user", note: "Initial script" },
      });
    }
    await tx.activity.create({
      data: { projectId: id, actor, type: "project.created", message: `Project “${data.name}” created · ${WORKFLOW_INFO[data.workflow].label}` },
    });
  });
  await materializeSafely(id);
  return getProjectDetail(id);
}

export async function updateProject(projectId: string, patch: z.input<typeof UpdateProjectSchema>, actor: Actor = "user"): Promise<ProjectDetail> {
  const data = UpdateProjectSchema.parse(patch);
  const current = await db.project.findUnique({ where: { id: projectId }, select: { name: true, width: true, height: true, formatPreset: true } });
  if (!current) throw notFound("Project");
  let dims: { width?: number; height?: number; formatPreset?: string } = {};
  if (data.formatPreset) {
    const preset = FORMAT_PRESETS.find((p) => p.id === data.formatPreset);
    const width = preset?.width ?? data.width ?? current.width;
    const height = preset?.height ?? data.height ?? current.height;
    const err = validateDimensions(width, height);
    if (err) throw new AppError("VALIDATION", err);
    dims = { width, height, formatPreset: data.formatPreset };
  }
  const changes = Object.keys(data).filter((k) => k !== "width" && k !== "height");
  await mutateProject(projectId, actor, async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.brief !== undefined ? { brief: data.brief } : {}),
        ...(data.fps !== undefined ? { fps: data.fps } : {}),
        ...dims,
      },
    });
    return {
      result: null,
      activity: {
        type: data.name && data.name !== current.name ? "project.renamed" : "project.updated",
        message: data.name && data.name !== current.name ? `Renamed “${current.name}” → “${data.name}”` : `Updated project ${changes.join(", ")}`,
      },
    };
  });
  return getProjectDetail(projectId);
}

export async function setArchived(projectId: string, archived: boolean, actor: Actor = "user"): Promise<void> {
  await mutateProject(projectId, actor, async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { archivedAt: archived ? new Date() : null } });
    return { result: null, activity: { type: archived ? "project.archived" : "project.unarchived", message: archived ? "Project archived" : "Project restored from archive" } };
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  assertProjectId(projectId);
  const exists = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!exists) throw notFound("Project");
  const running = await db.job.count({ where: { projectId, status: "running" } });
  if (running > 0) throw new AppError("CONFLICT", "This project has running jobs. Cancel them before deleting.");
  await db.project.delete({ where: { id: projectId } });
  forgetProjectState(projectId);
  await fs.rm(projectDir(projectId), { recursive: true, force: true });
}

export async function assertProjectExists(projectId: string): Promise<void> {
  assertProjectId(projectId);
  const exists = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!exists) throw notFound("Project");
}
