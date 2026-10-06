import { z } from "zod";
import type { Asset, OverlayClip } from "@/generated/prisma/client";
import {
  DEFAULT_IMAGE_OVERLAY_SEC,
  MIN_OVERLAY_SEC,
  OVERLAY_END_BEHAVIORS,
  OVERLAY_PLACEMENTS,
  trimmedLengthSec,
  type OverlayEndBehavior,
  type OverlayPlacement,
} from "@/core/timeline/overlays";
import { Prisma } from "@/generated/prisma/client";
import {
  AnnotationSchema,
  CropSchema,
  MAX_ANNOTATIONS,
  MAX_SPEED_SEGMENTS,
  MIN_ANNOTATION_SEC,
  SpeedSegmentSchema,
  clipSecForSource,
  sourceSecAt,
  splitClipTimes,
  normalizeAnnotations,
  normalizeCrop,
  normalizeSpeedSegments,
  parseAnnotations,
  parseCrop,
  parseSpeedSegments,
  shiftClipTimes,
} from "@/core/timeline/clip-edits";
import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE } from "@/core/timeline/media-clip";
import { MAX_ZOOMS_PER_CLIP, OverlayZoomSchema, normalizeZooms, parseZooms, shiftZoomsForTrim } from "@/core/timeline/overlay-zoom";
import { db, json } from "../db";
import { AppError, notFound } from "../errors";
import { assertId, assertProjectId } from "../ids";
import { mutateProject, type Actor } from "./mutation";
import { fileUrl } from "./projects";

/**
 * Overlay track: images and videos placed on the master timeline above the scenes, in absolute
 * video time. They can span scene cuts and never change scene or voice-over timing.
 */

const Sec = z.number().min(0).max(24 * 3600);
const Duration = z.number().min(MIN_OVERLAY_SEC).max(24 * 3600);

export const AddOverlaySchema = z
  .object({
    assetId: z.string().min(1).max(80),
    name: z.string().trim().min(1).max(120).optional(),
    placement: z.enum(OVERLAY_PLACEMENTS).optional(),
    startSec: Sec.optional(),
    /** Defaults to the trimmed length of a video, or 4 s for an image. */
    durationSec: Duration.optional(),
    trimStartSec: Sec.optional(),
    trimEndSec: Sec.nullable().optional(),
    dim: z.number().min(0).max(0.9).optional(),
    volume: z.number().min(0).max(1).optional(),
  })
  .strict();

export const OverlayPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    placement: z.enum(OVERLAY_PLACEMENTS),
    fit: z.enum(["cover", "contain"]),
    startSec: Sec,
    durationSec: Duration,
    trimStartSec: Sec,
    trimEndSec: Sec.nullable(),
    playbackRate: z.number().min(MIN_PLAYBACK_RATE).max(MAX_PLAYBACK_RATE),
    endBehavior: z.enum(OVERLAY_END_BEHAVIORS),
    volume: z.number().min(0).max(1),
    /** Lower the clip's audio while the narrator speaks. */
    duckUnderVoice: z.boolean(),
    dim: z.number().min(0).max(0.9),
    opacity: z.number().min(0.05).max(1),
    fadeInSec: z.number().min(0).max(10),
    fadeOutSec: z.number().min(0).max(10),
    hidden: z.boolean(),
    order: z.number().int().min(0).max(1000),
    /** Zoom regions in clip seconds; replaces the whole list. */
    zooms: z.array(OverlayZoomSchema).max(MAX_ZOOMS_PER_CLIP),
    /** Cut from the edges (fractions of the media), or null for none. */
    crop: CropSchema.nullable(),
    /** Speed ramps and freeze frames in clip seconds (rate 0 freezes); replaces the whole list. */
    speedSegments: z.array(SpeedSegmentSchema).max(MAX_SPEED_SEGMENTS),
    /** Blur, boxes, arrows, labels, spotlights and click ripples in clip seconds; replaces the whole list. */
    annotations: z.array(AnnotationSchema).max(MAX_ANNOTATIONS),
  })
  .partial()
  .strict();

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const isVideo = (a: Pick<Asset, "mimeType">) => a.mimeType.startsWith("video/");

/** Seconds the trimmed part of a video plays, including speed ramps and freeze frames (null for images or an unknown length). */
function remappedLengthSec(kind: "image" | "video", c: Pick<OverlayClip, "trimStartSec" | "trimEndSec" | "playbackRate" | "speedSegments">, sourceDurationSec: number | null): number | null {
  const segments = parseSpeedSegments(c.speedSegments);
  if (kind !== "video" || !segments.length) return trimmedLengthSec({ kind, trimStartSec: c.trimStartSec, trimEndSec: c.trimEndSec, playbackRate: c.playbackRate, sourceDurationSec });
  const end = c.trimEndSec ?? sourceDurationSec;
  return end === null ? null : r3(clipSecForSource({ trimStartSec: c.trimStartSec, playbackRate: c.playbackRate, speedSegments: segments }, end));
}

export function overlayClipDto(c: OverlayClip & { asset: Asset }) {
  const kind = isVideo(c.asset) ? ("video" as const) : ("image" as const);
  const sourceDurationSec = kind === "video" ? c.asset.durationSec : null;
  return {
    id: c.id,
    name: c.name,
    assetId: c.assetId,
    assetName: c.asset.name,
    kind,
    mimeType: c.asset.mimeType,
    url: fileUrl(c.projectId, c.asset.filePath, c.asset.contentHash.slice(0, 12)),
    width: c.asset.width,
    height: c.asset.height,
    sourceDurationSec,
    placement: c.placement as OverlayPlacement,
    fit: (c.fit === "contain" ? "contain" : "cover") as "cover" | "contain",
    startSec: c.startSec,
    durationSec: c.durationSec,
    endSec: r3(c.startSec + c.durationSec),
    trimStartSec: c.trimStartSec,
    trimEndSec: c.trimEndSec,
    playbackRate: c.playbackRate,
    endBehavior: (c.endBehavior === "loop" ? "loop" : "hold") as OverlayEndBehavior,
    /** Seconds the trimmed part of a video plays (null for images), including speed ramps and freeze frames. */
    trimmedLengthSec: remappedLengthSec(kind, c, sourceDurationSec),
    /** Cut from the edges (fractions of the media), or null. */
    crop: parseCrop(c.crop),
    /** Speed ramps and freeze frames in clip seconds (rate 0 freezes). */
    speedSegments: parseSpeedSegments(c.speedSegments),
    /** Blur, boxes, arrows, labels, spotlights and click ripples in clip seconds. */
    annotations: parseAnnotations(c.annotations),
    volume: c.volume,
    duckUnderVoice: c.duckUnderVoice,
    dim: c.dim,
    opacity: c.opacity,
    fadeInSec: c.fadeInSec,
    fadeOutSec: c.fadeOutSec,
    hidden: c.hidden,
    /** Zoom regions (clip seconds, areas in fractions of the clip frame). */
    zooms: parseZooms(c.zooms),
    order: c.order,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
export type OverlayClipDto = ReturnType<typeof overlayClipDto>;

function assertTrim(asset: Asset, trimStartSec: number, trimEndSec: number | null) {
  const source = asset.durationSec;
  if (source && trimStartSec >= source - 0.05) throw new AppError("VALIDATION", `Trim start must be before the end of the clip (${source.toFixed(2)}s).`);
  if (trimEndSec !== null) {
    if (source && trimEndSec > source + 0.05) throw new AppError("VALIDATION", `Trim end can't be after the end of the clip (${source.toFixed(2)}s).`);
    if (trimEndSec <= trimStartSec + 0.05) throw new AppError("VALIDATION", "Trim end must be after trim start.");
  }
}

export async function listOverlayClips(projectId: string): Promise<OverlayClipDto[]> {
  assertProjectId(projectId);
  const rows = await db.overlayClip.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: { asset: true } });
  return rows.map(overlayClipDto);
}

export async function addOverlayClip(projectId: string, input: z.input<typeof AddOverlaySchema>, actor: Actor): Promise<OverlayClipDto> {
  assertProjectId(projectId);
  const data = AddOverlaySchema.parse(input);
  const asset = await db.asset.findFirst({ where: { id: data.assetId, projectId } });
  if (!asset) throw notFound("Asset");
  if (!isVideo(asset) && !asset.mimeType.startsWith("image/")) {
    throw new AppError("VALIDATION", `“${asset.name}” is not an image or video.`, { hint: "Audio goes on the timeline from the Audio page." });
  }
  const video = isVideo(asset);
  const trimStartSec = video ? (data.trimStartSec ?? 0) : 0;
  const trimEndSec = video ? (data.trimEndSec ?? null) : null;
  if (video) assertTrim(asset, trimStartSec, trimEndSec);
  const trimmed = trimmedLengthSec({ kind: video ? "video" : "image", trimStartSec, trimEndSec, playbackRate: 1, sourceDurationSec: asset.durationSec });
  const durationSec = r3(Math.max(MIN_OVERLAY_SEC, data.durationSec ?? trimmed ?? DEFAULT_IMAGE_OVERLAY_SEC));
  const startSec = r3(data.startSec ?? 0);
  const order = await db.overlayClip.count({ where: { projectId } });
  const row = await mutateProject(projectId, actor, async (tx) => {
    const created = await tx.overlayClip.create({
      data: {
        projectId,
        assetId: asset.id,
        name: data.name ?? asset.name,
        placement: data.placement ?? "fullscreen",
        startSec,
        durationSec,
        trimStartSec,
        trimEndSec,
        dim: data.dim ?? 0,
        volume: video ? (data.volume ?? 0) : 0,
        order,
      },
      include: { asset: true },
    });
    return {
      result: created,
      activity: { type: "overlay.added", message: `Added overlay “${created.name}” at ${startSec.toFixed(2)}–${(startSec + durationSec).toFixed(2)}s`, data: { overlayId: created.id, assetId: asset.id } },
      historyLabel: `add overlay “${created.name}”`,
    };
  }, { history: { label: "add overlay", scope: ["overlays"] } });
  return overlayClipDto(row);
}

export async function updateOverlayClip(projectId: string, overlayId: string, patch: z.input<typeof OverlayPatchSchema>, actor: Actor): Promise<OverlayClipDto> {
  assertProjectId(projectId);
  assertId(overlayId, "overlay id");
  const data = OverlayPatchSchema.parse(patch);
  const existing = await db.overlayClip.findFirst({ where: { id: overlayId, projectId }, include: { asset: true } });
  if (!existing) throw notFound("Overlay");
  if (isVideo(existing.asset)) {
    assertTrim(existing.asset, data.trimStartSec ?? existing.trimStartSec, data.trimEndSec !== undefined ? data.trimEndSec : existing.trimEndSec);
  }
  const { zooms: zoomsInput, crop: cropInput, speedSegments: segmentsInput, annotations: annotationsInput, ...fields } = data;
  const rounded: Record<string, unknown> = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === "number" && k.endsWith("Sec") ? r3(v) : v]));
  // A new in-point moves the picture under the clip, so zooms and annotations follow the picture they were drawn on.
  const existingZooms = parseZooms(existing.zooms);
  const zooms = zoomsInput
    ? normalizeZooms(zoomsInput)
    : data.trimStartSec !== undefined && existingZooms.length
      ? shiftZoomsForTrim(existingZooms, existing.trimStartSec, r3(data.trimStartSec), data.playbackRate ?? existing.playbackRate)
      : null;
  if (zooms) rounded.zooms = json(zooms);
  if (cropInput !== undefined) {
    const crop = normalizeCrop(cropInput);
    rounded.crop = crop ? json(crop) : Prisma.DbNull;
  }
  if (segmentsInput !== undefined) rounded.speedSegments = json(isVideo(existing.asset) ? normalizeSpeedSegments(segmentsInput) : []);
  const existingAnnotations = parseAnnotations(existing.annotations);
  if (annotationsInput !== undefined) rounded.annotations = json(normalizeAnnotations(annotationsInput));
  else if (data.trimStartSec !== undefined && existingAnnotations.length) {
    rounded.annotations = json(shiftClipTimes(existingAnnotations, (r3(data.trimStartSec) - existing.trimStartSec) / (data.playbackRate ?? (existing.playbackRate || 1))));
  }
  const keys = Object.keys(data).sort();
  const only = (...allowed: string[]) => keys.length > 0 && keys.every((k) => allowed.includes(k));
  const what = keys.some((k) => k.startsWith("trim")) ? "trim" : only("zooms") ? "zoom" : only("startSec") ? "move" : only("startSec", "durationSec") ? "retime" : only("hidden") ? (data.hidden ? "hide" : "show") : "edit";
  // Timeline drags are one step each; repeated tweaks of the same panel field merge into one.
  const coalesceKey = what === "edit" ? `overlay:${overlayId}:${keys.join(",")}` : undefined;
  const row = await mutateProject(
    projectId,
    actor,
    async (tx) => {
      const updated = await tx.overlayClip.update({ where: { id: overlayId }, data: rounded, include: { asset: true } });
      return { result: updated, activity: { type: "overlay.updated", message: `Updated overlay “${updated.name}”`, data: { overlayId, changes: Object.keys(data) } } };
    },
    { history: { label: `${what} overlay “${existing.name}”`, scope: ["overlays"], coalesceKey } },
  );
  return overlayClipDto(row);
}

export async function removeOverlayClip(projectId: string, overlayId: string, actor: Actor): Promise<void> {
  assertProjectId(projectId);
  assertId(overlayId, "overlay id");
  const existing = await db.overlayClip.findFirst({ where: { id: overlayId, projectId } });
  if (!existing) throw notFound("Overlay");
  await mutateProject(
    projectId,
    actor,
    async (tx) => {
      await tx.overlayClip.delete({ where: { id: overlayId } });
      return { result: null, activity: { type: "overlay.removed", message: `Removed overlay “${existing.name}”`, data: { overlayId } } };
    },
    { history: { label: `delete overlay “${existing.name}”`, scope: ["overlays"] } },
  );
}

export const SplitOverlaySchema = z
  .object({
    /** Video second to split at. */
    atSec: Sec,
    /** Cut out the section up to this video second; the rest of the clip moves up to close the gap. */
    removeUntilSec: Sec.optional(),
  })
  .strict();

/**
 * Splits a clip into two at a video second, or cuts out a section of it: the part after the section
 * starts where the section started, so the gap closes (other clips don't move). Zooms, annotations and
 * speed segments stay on their picture.
 */
export async function splitOverlayClip(projectId: string, overlayId: string, input: z.input<typeof SplitOverlaySchema>, actor: Actor): Promise<OverlayClipDto[]> {
  assertProjectId(projectId);
  assertId(overlayId, "overlay id");
  const { atSec, removeUntilSec } = SplitOverlaySchema.parse(input);
  const existing = await db.overlayClip.findFirst({ where: { id: overlayId, projectId }, include: { asset: true } });
  if (!existing) throw notFound("Overlay");
  const at = r3(atSec - existing.startSec);
  const resume = r3((removeUntilSec ?? atSec) - existing.startSec);
  if (at < MIN_OVERLAY_SEC || resume < at || resume > existing.durationSec - MIN_OVERLAY_SEC) {
    const range = `${existing.startSec.toFixed(2)}–${(existing.startSec + existing.durationSec).toFixed(2)}s`;
    throw new AppError("VALIDATION", removeUntilSec !== undefined ? `The section must be inside the clip (${range}) and leave some of it on both sides.` : `Split inside the clip (${range}), at least ${MIN_OVERLAY_SEC}s from its edges.`);
  }
  const video = isVideo(existing.asset);
  const segments = parseSpeedSegments(existing.speedSegments);
  const remap = { trimStartSec: existing.trimStartSec, playbackRate: existing.playbackRate, speedSegments: segments };
  const sourceEnd = existing.trimEndSec ?? existing.asset.durationSec ?? null;
  // A cut in the held (or looping) tail keeps the last frame instead of running past the source.
  const sourceAt = (clipSec: number) => r3(sourceEnd !== null ? Math.min(sourceSecAt(remap, clipSec), sourceEnd - 0.05) : sourceSecAt(remap, clipSec));
  const zooms = splitClipTimes(parseZooms(existing.zooms), at, resume);
  const marks = splitClipTimes(parseAnnotations(existing.annotations), at, resume, MIN_ANNOTATION_SEC);
  const speed = splitClipTimes(segments, at, resume);
  const { id: _id, createdAt: _c, updatedAt: _u, asset: _a, crop, zooms: _z, annotations: _an, speedSegments: _s, ...base } = existing;
  const cut = removeUntilSec !== undefined;
  const rows = await mutateProject(
    projectId,
    actor,
    async (tx) => {
      const first = await tx.overlayClip.update({
        where: { id: overlayId },
        data: { durationSec: at, ...(video ? { trimEndSec: sourceAt(at) } : {}), fadeOutSec: 0, zooms: json(zooms.before), annotations: json(marks.before), speedSegments: json(speed.before) },
        include: { asset: true },
      });
      const second = await tx.overlayClip.create({
        data: {
          ...base,
          name: `${existing.name} (2)`,
          startSec: r3(existing.startSec + at),
          durationSec: r3(existing.durationSec - resume),
          ...(video ? { trimStartSec: sourceAt(resume), trimEndSec: existing.trimEndSec } : {}),
          fadeInSec: 0,
          crop: crop === null ? Prisma.DbNull : json(crop),
          zooms: json(zooms.after),
          annotations: json(marks.after),
          speedSegments: json(speed.after),
          order: existing.order + 1,
        },
        include: { asset: true },
      });
      const message = cut ? `Cut ${(resume - at).toFixed(2)}s out of overlay “${existing.name}”` : `Split overlay “${existing.name}” at ${atSec.toFixed(2)}s`;
      return { result: [first, second], activity: { type: "overlay.split", message, data: { overlayId, newOverlayId: second.id, atSec, removeUntilSec } } };
    },
    { history: { label: cut ? `cut a section from overlay “${existing.name}”` : `split overlay “${existing.name}”`, scope: ["overlays"] } },
  );
  return rows.map(overlayClipDto);
}
