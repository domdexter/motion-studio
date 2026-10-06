import fs from "node:fs/promises";
import { db } from "../db";
import { AppError, notFound } from "../errors";
import { assertId, assertProjectId } from "../ids";
import { extractVideoFrame } from "../media/ffmpeg";
import { projectFile } from "../storage/paths";
import { fileUrl } from "./projects";

/**
 * Filmstrip frames for video clips on the timeline lanes: small JPEGs evenly spaced through the
 * source, extracted once per file version and cached under thumbs/filmstrip/.
 */

const MAX_FRAMES = 16;
const FRAME_WIDTH = 160;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const inFlight = new Map<string, Promise<void>>();

export interface Filmstrip {
  durationSec: number;
  /** Seconds between frames (each frame stands for the span around its time). */
  stepSec: number;
  frames: { timeSec: number; url: string }[];
}

export async function getAssetFilmstrip(projectId: string, assetId: string): Promise<Filmstrip> {
  assertProjectId(projectId);
  assertId(assetId, "asset id");
  const asset = await db.asset.findFirst({ where: { id: assetId, projectId } });
  if (!asset) throw notFound("Asset");
  const durationSec = asset.durationSec;
  if (!asset.mimeType.startsWith("video/") || !durationSec) throw new AppError("VALIDATION", "Only videos with a known length have a filmstrip.");

  const version = asset.contentHash.slice(0, 12);
  const dirRel = `thumbs/filmstrip/${asset.id}-${version}`;
  const count = Math.max(2, Math.min(MAX_FRAMES, Math.ceil(durationSec / 2)));
  const stepSec = durationSec / count;
  const times = Array.from({ length: count }, (_, i) => (i + 0.5) * stepSec);

  const key = `${projectId}/${dirRel}`;
  let job = inFlight.get(key);
  if (!job) {
    job = (async () => {
      await fs.mkdir(projectFile(projectId, dirRel), { recursive: true });
      const source = projectFile(projectId, asset.filePath);
      for (let i = 0; i < count; i++) {
        const out = projectFile(projectId, `${dirRel}/${i}.jpg`);
        const exists = await fs.access(out).then(
          () => true,
          () => false,
        );
        if (!exists) await extractVideoFrame(source, out, Math.min(times[i], Math.max(0, durationSec - 0.05)), FRAME_WIDTH);
      }
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, job);
  }
  await job;
  return { durationSec, stepSec: r3(stepSec), frames: times.map((t, i) => ({ timeSec: r3(t), url: fileUrl(projectId, `${dirRel}/${i}.jpg`, version) })) };
}
