import fs from "node:fs/promises";
import { z } from "zod";
import type { Asset, AudioTrack } from "@/generated/prisma/client";
import { MIN_AUDIO_CLIP_SEC } from "@/core/timeline/audio-clips";
import { db } from "../db";
import { AppError, notFound } from "../errors";
import { assertId, assertProjectId } from "../ids";
import { computePeaks, type WaveformPeaks } from "../media/ffmpeg";
import { projectFile, writeFileAtomic } from "../storage/paths";
import { mutateProject, type Actor } from "./mutation";
import { fileUrl } from "./projects";

/**
 * Music and SFX placed on the master timeline. The voice-over stays the primary track (its
 * volume, mute and muted sections live on Project.mix); these tracks are mixed under it (optional
 * ducking). Every change is an undo step for the user.
 */

export const AddAudioTrackSchema = z.object({
  assetId: z.string().min(1).max(80),
  kind: z.enum(["music", "sfx", "voice"]).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  startSec: z.number().min(0).max(24 * 3600).optional(),
});

export const AudioTrackPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["music", "sfx", "voice"]),
    startSec: z.number().min(0).max(24 * 3600),
    trimStartSec: z.number().min(0).max(24 * 3600),
    durationSec: z.number().positive().max(24 * 3600).nullable(),
    volume: z.number().min(0).max(1),
    fadeInSec: z.number().min(0).max(60),
    fadeOutSec: z.number().min(0).max(60),
    muted: z.boolean(),
    loop: z.boolean(),
    duckUnderVoice: z.boolean(),
    order: z.number().int().min(0).max(1000),
  })
  .partial()
  .strict();

const TIMING_KEYS = ["startSec", "trimStartSec", "durationSec"];
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function audioTrackDto(t: AudioTrack & { asset: Asset }) {
  return {
    id: t.id,
    kind: t.kind as "music" | "sfx" | "voice",
    name: t.name,
    assetId: t.assetId,
    assetName: t.asset.name,
    url: fileUrl(t.projectId, t.asset.filePath, t.asset.contentHash.slice(0, 12)),
    /** Waveform of the source file (computed on first request, then cached). */
    peaksUrl: `/api/projects/${t.projectId}/audio-tracks/${t.id}/peaks?v=${t.asset.contentHash.slice(0, 12)}`,
    sourceDurationSec: t.asset.durationSec,
    startSec: t.startSec,
    trimStartSec: t.trimStartSec,
    durationSec: t.durationSec,
    volume: t.volume,
    fadeInSec: t.fadeInSec,
    fadeOutSec: t.fadeOutSec,
    muted: t.muted,
    loop: t.loop,
    duckUnderVoice: t.duckUnderVoice,
    order: t.order,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
export type AudioTrackDto = ReturnType<typeof audioTrackDto>;

export async function listAudioTracks(projectId: string): Promise<AudioTrackDto[]> {
  assertProjectId(projectId);
  const rows = await db.audioTrack.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: { asset: true } });
  return rows.map(audioTrackDto);
}

export async function addAudioTrack(projectId: string, input: z.input<typeof AddAudioTrackSchema>, actor: Actor): Promise<AudioTrackDto> {
  assertProjectId(projectId);
  const data = AddAudioTrackSchema.parse(input);
  const asset = await db.asset.findFirst({ where: { id: data.assetId, projectId } });
  if (!asset) throw notFound("Asset");
  if (!["music", "sfx", "audio"].includes(asset.kind) && !asset.mimeType.startsWith("audio/")) {
    throw new AppError("VALIDATION", "Only audio assets (music or sound effects) can be placed on the timeline.");
  }
  const kind = data.kind ?? (asset.kind === "sfx" ? "sfx" : "music");
  const name = data.name ?? asset.name;
  const order = await db.audioTrack.count({ where: { projectId } });
  const row = await mutateProject(
    projectId,
    actor,
    async (tx) => {
      const created = await tx.audioTrack.create({
        data: {
          projectId,
          assetId: asset.id,
          kind,
          name,
          startSec: r3(data.startSec ?? 0),
          volume: kind === "music" ? 0.35 : kind === "voice" ? 1 : 0.8,
          fadeInSec: kind === "music" ? 1 : 0,
          fadeOutSec: kind === "music" ? 2 : 0,
          duckUnderVoice: kind === "music",
          order,
        },
        include: { asset: true },
      });
      return { result: created, activity: { type: "audio_track.added", message: `Added ${kind} track “${created.name}”`, data: { trackId: created.id, assetId: asset.id } } };
    },
    { history: { label: `add ${kind} “${name}”`, scope: ["audioTracks"] } },
  );
  return audioTrackDto(row);
}

export async function updateAudioTrack(projectId: string, trackId: string, patch: z.input<typeof AudioTrackPatchSchema>, actor: Actor): Promise<AudioTrackDto> {
  assertProjectId(projectId);
  assertId(trackId, "track id");
  const data = AudioTrackPatchSchema.parse(patch);
  for (const key of ["startSec", "trimStartSec", "fadeInSec", "fadeOutSec"] as const) if (data[key] !== undefined) data[key] = r3(data[key]);
  if (typeof data.durationSec === "number") data.durationSec = Math.max(MIN_AUDIO_CLIP_SEC, r3(data.durationSec));
  const existing = await db.audioTrack.findFirst({ where: { id: trackId, projectId }, include: { asset: { select: { durationSec: true } } } });
  if (!existing) throw notFound("Audio track");
  const source = existing.asset.durationSec;
  if (source !== null && data.trimStartSec !== undefined && data.trimStartSec > source - MIN_AUDIO_CLIP_SEC) {
    throw new AppError("VALIDATION", `The trim start must be before the end of “${existing.name}” (${source.toFixed(2)}s).`);
  }
  const keys = Object.keys(data).sort();
  const timing = keys.some((k) => TIMING_KEYS.includes(k));
  const label = timing ? `${keys.includes("trimStartSec") || keys.includes("durationSec") ? "trim" : "move"} “${existing.name}”` : `edit “${existing.name}”`;
  const row = await mutateProject(
    projectId,
    actor,
    async (tx) => {
      const updated = await tx.audioTrack.update({ where: { id: trackId }, data, include: { asset: true } });
      return { result: updated, activity: { type: "audio_track.updated", message: `Updated ${updated.kind} track “${updated.name}”`, data: { trackId, changes: keys } } };
    },
    // Panel tweaks (volume, fades…) in quick succession become one undo step; every timeline drag is its own.
    { history: { label, scope: ["audioTracks"], coalesceKey: timing ? undefined : `audio:${trackId}:${keys.join(",")}` } },
  );
  return audioTrackDto(row);
}

export async function removeAudioTrack(projectId: string, trackId: string, actor: Actor): Promise<void> {
  assertProjectId(projectId);
  assertId(trackId, "track id");
  const existing = await db.audioTrack.findFirst({ where: { id: trackId, projectId } });
  if (!existing) throw notFound("Audio track");
  await mutateProject(
    projectId,
    actor,
    async (tx) => {
      await tx.audioTrack.delete({ where: { id: trackId } });
      return { result: null, activity: { type: "audio_track.removed", message: `Removed ${existing.kind} track “${existing.name}”`, data: { trackId } } };
    },
    { history: { label: `remove “${existing.name}”`, scope: ["audioTracks"] } },
  );
}

/** Waveform peaks of a track's source file, cached next to the project's audio by content hash. */
export async function getAudioTrackPeaks(projectId: string, trackId: string): Promise<WaveformPeaks> {
  assertProjectId(projectId);
  assertId(trackId, "track id");
  const track = await db.audioTrack.findFirst({ where: { id: trackId, projectId }, include: { asset: { select: { id: true, filePath: true, contentHash: true } } } });
  if (!track) throw notFound("Audio track");
  const cache = projectFile(projectId, `audio/peaks/${track.asset.id}-${track.asset.contentHash.slice(0, 12)}.json`);
  const cached = await fs
    .readFile(cache, "utf8")
    .then((text) => JSON.parse(text) as WaveformPeaks)
    .catch(() => null);
  if (cached) return cached;
  const peaks = await computePeaks(projectFile(projectId, track.asset.filePath), 50);
  await writeFileAtomic(cache, JSON.stringify(peaks));
  return peaks;
}
