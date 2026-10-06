import path from "node:path";
import { z } from "zod";
import { AssetBriefSchema, type AssetBrief } from "@/core/creative/schema";
import type { AssetRequestStatus } from "@/core/spec/enums";
import type { Asset, AssetRequest, Prisma } from "@/generated/prisma/client";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { assertId, assertProjectId, newId } from "../ids";
import { assetDto, importAsset, type AssetDto } from "./assets";
import { mutateProject, type Actor } from "./mutation";

/**
 * AI asset requests: the explicit hand-off for native image/video generation.
 *   requested → generating → generated → approved | rejected (→ regenerate) | cancelled
 * Claude Code fulfils requests with `npm run studio -- assets:fulfill <request> <file…>`;
 * approving a candidate is always the user's decision.
 */

export const AssetRequestInputSchema = z.object({
  kind: z.enum(["image", "video"]).default("image"),
  prompt: z.string().trim().min(3, "Describe what should be generated.").max(4000),
  negativePrompt: z.string().trim().max(2000).optional(),
  aspectRatio: z.string().regex(/^\d{1,2}:\d{1,2}$/, "Use an aspect ratio like 16:9").default("16:9"),
  width: z.number().int().min(64).max(8192).optional(),
  height: z.number().int().min(64).max(8192).optional(),
  durationSec: z.number().positive().max(120).optional(),
  styleNotes: z.string().max(2000).default(""),
  purpose: z.string().max(500).default(""),
  /** Composition-aware creative brief the generated asset must serve (CREATIVE_SYSTEM.md → Asset briefs). */
  brief: AssetBriefSchema.optional(),
  count: z.number().int().min(1).max(4).default(1),
  sceneId: z.string().max(80).nullable().optional(),
});
export type AssetRequestInput = z.input<typeof AssetRequestInputSchema>;

type RequestRow = AssetRequest & { assets: Asset[]; scene: { key: string } | null };

const INCLUDE = { assets: { orderBy: { createdAt: "asc" } }, scene: { select: { key: true } } } satisfies Prisma.AssetRequestInclude;

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function assetRequestDto(r: RequestRow) {
  return {
    id: r.id,
    projectId: r.projectId,
    kind: r.kind as "image" | "video",
    prompt: r.prompt,
    negativePrompt: r.negativePrompt,
    aspectRatio: r.aspectRatio,
    width: r.width,
    height: r.height,
    durationSec: r.durationSec,
    styleNotes: r.styleNotes,
    purpose: r.purpose,
    brief: (r.brief ?? null) as AssetBrief | null,
    count: r.count,
    status: r.status as AssetRequestStatus,
    requestedBy: r.requestedBy,
    approvedAssetId: r.approvedAssetId,
    feedback: r.feedback,
    error: r.error,
    attempt: r.attempt,
    sceneId: r.sceneId,
    sceneKey: r.scene?.key ?? null,
    candidates: r.assets.map((a) => assetDto(a, r.scene?.key ?? null)),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export type AssetRequestDto = ReturnType<typeof assetRequestDto>;

async function loadRequest(projectId: string, requestId: string): Promise<RequestRow> {
  assertProjectId(projectId);
  assertId(requestId, "request id");
  const row = await db.assetRequest.findFirst({ where: { id: requestId, projectId }, include: INCLUDE });
  if (!row) throw notFound(`Asset request “${requestId}”`);
  return row;
}

/** Request ids are globally unique, so the CLI can resolve the project from the request alone. */
export async function projectIdForRequest(requestId: string): Promise<string> {
  assertId(requestId, "request id");
  const row = await db.assetRequest.findUnique({ where: { id: requestId }, select: { projectId: true } });
  if (!row) throw notFound(`Asset request “${requestId}”`);
  return row.projectId;
}

export async function listAssetRequests(projectId: string, options: { status?: string[] } = {}): Promise<AssetRequestDto[]> {
  assertProjectId(projectId);
  const rows = await db.assetRequest.findMany({
    where: { projectId, ...(options.status?.length ? { status: { in: options.status } } : {}) },
    orderBy: { createdAt: "desc" },
    include: INCLUDE,
  });
  return rows.map(assetRequestDto);
}

export async function getAssetRequest(projectId: string, requestId: string): Promise<AssetRequestDto> {
  return assetRequestDto(await loadRequest(projectId, requestId));
}

export async function createAssetRequest(projectId: string, input: AssetRequestInput, actor: Actor): Promise<AssetRequestDto> {
  assertProjectId(projectId);
  const data = AssetRequestInputSchema.parse(input);
  let sceneId: string | null = null;
  if (data.sceneId) {
    const scene = await db.scene.findFirst({ where: { projectId, OR: [{ id: data.sceneId }, { key: data.sceneId }] }, select: { id: true } });
    if (!scene) throw notFound(`Scene “${data.sceneId}”`);
    sceneId = scene.id;
  }
  const id = newId.assetRequest();
  await mutateProject(projectId, actor, async (tx) => {
    await tx.assetRequest.create({
      data: {
        id,
        projectId,
        sceneId,
        kind: data.kind,
        prompt: data.prompt,
        negativePrompt: data.negativePrompt || null,
        aspectRatio: data.aspectRatio,
        width: data.width ?? null,
        height: data.height ?? null,
        durationSec: data.kind === "video" ? (data.durationSec ?? 5) : null,
        styleNotes: data.styleNotes,
        purpose: data.purpose,
        ...(data.brief ? { brief: json(data.brief) } : {}),
        count: data.count,
        requestedBy: actor === "claude" ? "claude" : "user",
      },
    });
    return { result: id, activity: { type: "asset_request.created", message: `Requested ${data.kind}: “${truncate(data.prompt, 80)}”`, data: { requestId: id, sceneId } } };
  });
  return getAssetRequest(projectId, id);
}

async function transition(projectId: string, requestId: string, actor: Actor, allowed: AssetRequestStatus[], data: Prisma.AssetRequestUpdateInput, message: string): Promise<AssetRequestDto> {
  const row = await loadRequest(projectId, requestId);
  if (!allowed.includes(row.status as AssetRequestStatus)) {
    throw new AppError("CONFLICT", `This asset request is ${row.status}.`, { hint: `Allowed from: ${allowed.join(", ")}.` });
  }
  await mutateProject(projectId, actor, async (tx) => {
    await tx.assetRequest.update({ where: { id: requestId }, data });
    return { result: null, activity: { type: "asset_request.updated", message, data: { requestId, status: data.status } } };
  });
  return getAssetRequest(projectId, requestId);
}

export function markAssetRequestGenerating(projectId: string, requestId: string, actor: Actor) {
  return transition(projectId, requestId, actor, ["requested", "rejected", "generated"], { status: "generating", error: null }, `Generating asset for request ${requestId}`);
}

export function failAssetRequest(projectId: string, requestId: string, error: string, actor: Actor) {
  return transition(projectId, requestId, actor, ["requested", "generating"], { status: "requested", error: truncate(error, 1000) }, `Asset generation failed for ${requestId}: ${truncate(error, 120)}`);
}

export function cancelAssetRequest(projectId: string, requestId: string, actor: Actor) {
  return transition(projectId, requestId, actor, ["requested", "generating", "generated", "rejected"], { status: "cancelled" }, `Cancelled asset request ${requestId}`);
}

export function rejectAssetRequest(projectId: string, requestId: string, feedback: string, actor: Actor) {
  return transition(projectId, requestId, actor, ["generated", "approved"], { status: "rejected", feedback: feedback.trim() || null, approvedAssetId: null }, `Rejected generated asset for ${requestId}${feedback.trim() ? `: ${truncate(feedback.trim(), 120)}` : ""}`);
}

export function regenerateAssetRequest(projectId: string, requestId: string, feedback: string, actor: Actor) {
  return transition(
    projectId,
    requestId,
    actor,
    ["generated", "rejected", "cancelled", "approved"],
    { status: "requested", feedback: feedback.trim() || null, attempt: { increment: 1 }, approvedAssetId: null, error: null },
    `Asked for a new attempt on ${requestId}${feedback.trim() ? `: ${truncate(feedback.trim(), 120)}` : ""}`,
  );
}

export async function fulfillAssetRequest(
  projectId: string,
  requestId: string,
  files: { path: string; originalName?: string }[],
  actor: Actor,
  options: { generator?: string | null; move?: boolean; source?: "claude" | "upload" } = {},
): Promise<{ request: AssetRequestDto; assets: AssetDto[] }> {
  const row = await loadRequest(projectId, requestId);
  if (!["requested", "generating", "generated", "rejected"].includes(row.status)) {
    throw new AppError("CONFLICT", `This asset request is ${row.status}.`, { hint: "Regenerate it first to add new candidates." });
  }
  if (!files.length) throw new AppError("BAD_REQUEST", "Provide at least one generated file.");
  const source = options.source ?? "claude";
  const created: AssetDto[] = [];
  for (const file of files) {
    created.push(
      await importAsset(
        projectId,
        {
          sourcePath: file.path,
          originalName: file.originalName ?? path.basename(file.path),
          kind: row.kind as "image" | "video",
          source,
          name: `${row.kind === "video" ? "Video" : "Image"} · ${truncate(row.prompt, 48)}`,
          prompt: row.prompt,
          generator: options.generator ?? (source === "claude" ? "claude" : null),
          requestId: row.id,
          sceneId: row.sceneId,
          tags: source === "claude" ? ["ai-generated"] : [],
          move: options.move,
        },
        actor,
      ),
    );
  }
  await mutateProject(projectId, actor, async (tx) => {
    await tx.assetRequest.update({ where: { id: requestId }, data: { status: "generated", error: null } });
    return {
      result: null,
      activity: { type: "asset_request.generated", message: `${created.length} candidate${created.length === 1 ? "" : "s"} ready for review (${requestId})`, data: { requestId, assetIds: created.map((a) => a.id) } },
    };
  });
  return { request: await getAssetRequest(projectId, requestId), assets: created };
}

export async function approveAssetRequest(projectId: string, requestId: string, assetId: string, actor: Actor): Promise<AssetRequestDto> {
  const row = await loadRequest(projectId, requestId);
  if (row.status !== "generated" && row.status !== "approved") {
    throw new AppError("CONFLICT", `Only generated requests can be approved (this one is ${row.status}).`);
  }
  if (!row.assets.some((a) => a.id === assetId)) throw new AppError("VALIDATION", "That asset is not a candidate of this request.");
  await mutateProject(projectId, actor, async (tx) => {
    await tx.assetRequest.update({ where: { id: requestId }, data: { status: "approved", approvedAssetId: assetId, feedback: null } });
    await tx.asset.updateMany({ where: { requestId, id: { not: assetId }, status: "approved" }, data: { status: "ready" } });
    await tx.asset.update({ where: { id: assetId }, data: { status: "approved" } });
    if (row.sceneId) {
      const scene = await tx.scene.findUnique({ where: { id: row.sceneId }, select: { assetsRequired: true } });
      const required = Array.isArray(scene?.assetsRequired) ? (scene.assetsRequired as { requestId?: string | null; assetId?: string | null }[]) : [];
      if (required.some((r) => r.requestId === requestId)) {
        await tx.scene.update({ where: { id: row.sceneId }, data: { assetsRequired: json(required.map((r) => (r.requestId === requestId ? { ...r, assetId } : r))) } });
      }
    }
    return { result: null, activity: { type: "asset_request.approved", message: `Approved ${row.kind} for request ${requestId}`, data: { requestId, assetId } } };
  });
  return getAssetRequest(projectId, requestId);
}
