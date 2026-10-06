import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureBrowser, makeCancelSignal, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { Prisma } from "@/generated/prisma/client";
import { STUDIO_COMPOSITION_ID, THUMBNAIL_COMPOSITION_ID, type StudioVideoProps, type ThumbnailLayout, type ThumbnailProps } from "@/core/spec/composition";
import { secondsToFrames } from "@/core/timing/frames";
import { db, json } from "../db";
import { AppError } from "../errors";
import type { JobHandlerContext } from "../jobs/types";
import { buildComposition } from "../services/composition";
import { formatBytesServer } from "../services/format-server";
import { recordActivity, bumpRevision } from "../services/mutation";
import { fileUrl } from "../services/projects";
import type { RenderErrorInfo, RenderSettings } from "../services/renders";
import { getSettings } from "../services/settings";
import { projectFile } from "../storage/paths";
import { getRemotionBundle } from "./bundle";
import { LOUDNESS_TARGETS, measureLoudness, normalizationGain } from "@/core/audio/loudness";
import { buildCaptionCues } from "@/core/publish/captions";
import { applyAudioGain, decodeAudioMono } from "../media/ffmpeg";
import { renderConcurrency } from "./concurrency";
import { getMediaServer } from "./media-server";

/**
 * Worker-side Remotion rendering (never imported by Next.js): bundle → headless browser →
 * renderMedia (H.264) → thumbnail. Progress is written to the Render row (streamed to the GUI
 * via SSE); failures record the stage, the failing scene when known, and browser logs.
 */

function sceneAt(props: StudioVideoProps, frame: number) {
  const t = frame / props.fps;
  return props.scenes.find((s) => t >= s.start && t < s.end) ?? null;
}

/**
 * Parallel browser tabs (the render's own value, else Settings → Render, else automatic; see
 * ./concurrency) and, when the composition contains video, an explicit OffthreadVideo cache size.
 */
function videoRenderOptions(props: StudioVideoProps, requested: number | null | undefined): { concurrency: number; offthreadVideoCacheSizeInBytes?: number } {
  const hasVideo = Object.values(props.assets).some((a) => a.mimeType.startsWith("video/"));
  const concurrency = renderConcurrency(requested, hasVideo);
  if (!hasVideo) return { concurrency };
  const cacheBytes = Math.round(Math.min(2 * 1024 ** 3, Math.max(512 * 1024 ** 2, os.freemem() * 0.4)));
  return { concurrency, offthreadVideoCacheSizeInBytes: cacheBytes };
}

function describeFailure(err: unknown, props: StudioVideoProps | null, stage: string, logs: string[]): RenderErrorInfo {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack?.slice(0, 4000) : undefined;
  const sceneMatch = /Scene (\S+) (?:element|has)/.exec(message);
  const frameMatch = /frame[^0-9\n]{0,16}(\d+)/i.exec(message);
  const frame = frameMatch ? Number(frameMatch[1]) : null;
  let sceneKey: string | null = null;
  let sceneName: string | null = null;
  if (props) {
    const scene = (sceneMatch ? props.scenes.find((s) => s.key === sceneMatch[1]) : null) ?? (frame !== null ? sceneAt(props, frame) : null);
    if (scene) {
      sceneKey = scene.key;
      sceneName = scene.name;
    }
  }
  return { message: message.slice(0, 2000), stage, frame, sceneKey, sceneName, logs: logs.slice(-40), stack };
}

async function prepare(projectId: string, ctx: JobHandlerContext, bundleShare: number) {
  let lastReport = 0;
  const { serveUrl } = await getRemotionBundle((f) => {
    const now = Date.now();
    if (now - lastReport < 700) return;
    lastReport = now;
    void ctx.progress(0.01 + f * bundleShare, "Bundling composition");
  });
  if (ctx.cancelled) throw new Error("Cancelled.");
  await ctx.progress(0.01 + bundleShare, "Preparing headless browser");
  await ensureBrowser();
  const media = await getMediaServer();
  const build = await buildComposition(projectId, { mediaUrl: (rel, version) => media.urlFor(projectId, rel, version) });
  return { serveUrl, build };
}

export async function runRenderVideo(ctx: JobHandlerContext) {
  const { renderId } = ctx.job.payload as { renderId: string };
  const render = await db.render.findUnique({ where: { id: renderId } });
  if (!render) throw new AppError("NOT_FOUND", "Render not found.");
  const projectId = render.projectId;
  const settings = render.settings as unknown as RenderSettings;
  const logs: string[] = [];
  // Project-named file (settings.fileName); renders queued before names existed use their id.
  const fileStem = settings.fileName ?? renderId;
  const outRel = `renders/${fileStem}.mp4`;
  const thumbRel = `renders/${fileStem}.jpg`;
  const outAbs = projectFile(projectId, outRel);
  let stage = "bundling";
  let props: StudioVideoProps | null = null;
  const update = (data: Prisma.RenderUpdateInput) => db.render.update({ where: { id: renderId }, data }).catch(() => undefined);

  try {
    await update({ status: "bundling", stage: "Bundling composition", startedAt: new Date(), progress: 0, error: Prisma.DbNull });
    await bumpRevision(projectId);
    const prepared = await prepare(projectId, ctx, 0.07);
    stage = "preparing";
    // The render's frame rate may differ from the project's: all timing is in seconds, so frames follow it.
    const built = prepared.build.props;
    const captionStyle = settings.request?.captions ?? "off";
    props = {
      ...built,
      width: settings.width,
      height: settings.height,
      fps: settings.fps ?? built.fps,
      ...(captionStyle !== "off" ? { captions: { style: captionStyle, position: settings.request.captionPosition ?? "bottom", cues: buildCaptionCues(built.words, { cuts: built.voice?.cuts }) } } : {}),
      ...(settings.includeAudio ? {} : { voice: null, tracks: [], overlayClips: built.overlayClips?.map((c) => ({ ...c, volume: 0 })) }),
    };
    const inputProps = props as unknown as Record<string, unknown>;
    await update({ stage: "Preparing composition" });
    const composition = await selectComposition({ serveUrl: prepared.serveUrl, id: STUDIO_COMPOSITION_ID, inputProps });
    const totalFrames = settings.frameRange ? settings.frameRange[1] - settings.frameRange[0] + 1 : composition.durationInFrames;
    await fs.mkdir(path.dirname(outAbs), { recursive: true });

    stage = "rendering";
    await update({ status: "rendering", stage: "Rendering frames", totalFrames, renderedFrames: 0 });
    await bumpRevision(projectId);
    const { cancelSignal, cancel } = makeCancelSignal();
    const onAbort = () => cancel();
    ctx.signal.addEventListener("abort", onAbort);
    let lastReport = 0;
    const renderProps = props;
    const attempt = (options: { concurrency: number; offthreadVideoCacheSizeInBytes?: number }) =>
      renderMedia({
        serveUrl: prepared.serveUrl,
        composition,
        inputProps,
        codec: "h264",
        outputLocation: outAbs,
        // High quality: lossless PNG frames + a slower x264 preset keep small UI text and screenshots crisp.
        ...(settings.crf <= 18 ? { imageFormat: "png" as const, x264Preset: "slow" as const } : { imageFormat: "jpeg" as const, jpegQuality: settings.jpegQuality }),
        crf: settings.crf,
        frameRange: settings.frameRange,
        overwrite: true,
        enforceAudioTrack: settings.includeAudio,
        ...options,
        cancelSignal,
        onBrowserLog: (log) => {
          const type = String(log.type);
          if (type === "error" || type === "warning") {
            logs.push(`[${type}] ${log.text}`.slice(0, 600));
            if (logs.length > 200) logs.shift();
          }
        },
        onProgress: ({ progress, renderedFrames, encodedFrames, stitchStage }) => {
          const now = Date.now();
          if (now - lastReport < 500 && progress < 1) return;
          lastReport = now;
          const encoding = stitchStage === "muxing" || renderedFrames >= totalFrames;
          stage = encoding ? "encoding" : "rendering";
          const label = encoding ? `Encoding video (${Math.min(encodedFrames, totalFrames)}/${totalFrames})` : `Rendering frames (${renderedFrames}/${totalFrames})`;
          void update({ status: encoding ? "encoding" : "rendering", progress, renderedFrames, stage: label });
          void ctx.progress(0.1 + progress * 0.85, label);
        },
      });
    try {
      const options = videoRenderOptions(renderProps, settings.concurrency);
      try {
        await attempt(options);
      } catch (err) {
        // Video frames were evicted before use (too many parallel frames for the free memory): retry once with one.
        const message = err instanceof Error ? err.message : String(err);
        if (ctx.cancelled || options.concurrency <= 1 || !/No frame found at position/i.test(message)) throw err;
        logs.push(`[warning] ${message.split("\n")[0].slice(0, 300)}; retrying with 1 parallel frame and a larger video cache.`);
        lastReport = 0;
        await update({ status: "rendering", stage: "Retrying with 1 parallel frame", progress: 0, renderedFrames: 0 });
        await attempt({ concurrency: 1, offthreadVideoCacheSizeInBytes: Math.round(Math.min(4 * 1024 ** 3, Math.max(1024 ** 3, os.freemem() * 0.6))) });
      }
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
    }
    if (ctx.cancelled) throw new Error("Cancelled.");

    if (settings.includeAudio && settings.loudness && settings.loudness !== "off") {
      // Measure the finished mix and bring it to the target (peaks stay under −1 dBFS); the picture is copied untouched.
      stage = "loudness";
      await ctx.progress(0.955, "Normalizing loudness");
      await update({ stage: "Normalizing loudness" });
      const target = LOUDNESS_TARGETS[settings.loudness];
      const measured = measureLoudness(await decodeAudioMono(outAbs, 48000, ctx.signal), 48000);
      const { gainDb, limitedByPeak } = normalizationGain(measured, target.lufs);
      if (measured.integratedLufs !== null && Math.abs(gainDb) >= 0.1) {
        const adjusted = outAbs.replace(/\.mp4$/, ".loudness.mp4");
        await applyAudioGain(outAbs, adjusted, gainDb, ctx.signal);
        await fs.rename(adjusted, outAbs);
      }
      await update({ settings: json({ ...settings, loudnessResult: { target: settings.loudness, targetLufs: target.lufs, measuredLufs: measured.integratedLufs, gainDb, limitedByPeak } }) });
    }

    stage = "thumbnail";
    await ctx.progress(0.96, "Creating thumbnail");
    const [first, last] = settings.frameRange ?? [0, composition.durationInFrames - 1];
    const thumbFrame = Math.min(last, first + Math.round((last - first) * 0.35));
    await renderStill({
      serveUrl: prepared.serveUrl,
      composition,
      inputProps,
      frame: thumbFrame,
      output: projectFile(projectId, thumbRel),
      imageFormat: "jpeg",
      jpegQuality: 85,
      scale: Math.min(1, 960 / settings.width),
      overwrite: true,
    });

    const stat = await fs.stat(outAbs);
    const durationSec = totalFrames / composition.fps;
    await db.render.update({
      where: { id: renderId },
      data: { status: "complete", progress: 1, stage: null, outputPath: outRel, thumbnailPath: thumbRel, sizeBytes: stat.size, durationSec, renderedFrames: totalFrames, finishedAt: new Date() },
    });
    if (render.kind !== "final") {
      // Give the dashboard card a picture until a final render exists.
      await db.project.updateMany({ where: { id: projectId, thumbnailPath: null }, data: { thumbnailPath: thumbRel } });
    } else {
      await db.project.update({ where: { id: projectId }, data: { thumbnailPath: thumbRel } });
      // Optional convenience copy of final renders (Settings → Render → output folder).
      const outputDir = getSettings().render.outputDir;
      if (outputDir) {
        const dir = path.resolve(outputDir);
        const preferred = path.join(dir, `${fileStem}.mp4`);
        // Another project with the same name may already own that name in the shared folder.
        const target = await fs.access(preferred).then(
          () => path.join(dir, `${fileStem}-${renderId}.mp4`),
          () => preferred,
        );
        await fs
          .mkdir(path.dirname(target), { recursive: true })
          .then(() => fs.copyFile(outAbs, target))
          .catch((err) => logs.push(`[warning] Could not copy the render to ${target}: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
    await recordActivity(projectId, "worker", { type: "render.complete", message: `Rendered ${render.label} (${formatBytesServer(stat.size)})`, data: { renderId, outputPath: outRel } });
    return { renderId, outputPath: outRel, url: fileUrl(projectId, outRel, renderId), sizeBytes: stat.size, durationSec };
  } catch (err) {
    await fs.rm(outAbs, { force: true }).catch(() => undefined);
    if (ctx.cancelled) {
      await update({ status: "cancelled", stage: null, finishedAt: new Date(), error: json({ message: "Cancelled.", stage }) });
      await recordActivity(projectId, "worker", { type: "render.cancelled", message: `Cancelled render ${render.label}`, data: { renderId } });
      throw err;
    }
    const info = describeFailure(err, props, stage, logs);
    await update({ status: "failed", stage: null, finishedAt: new Date(), error: json(info) });
    await recordActivity(projectId, "worker", { type: "render.failed", message: `Render failed${info.sceneKey ? ` in ${info.sceneKey}` : ""}: ${info.message.slice(0, 160)}`, data: { renderId, stage } });
    throw new AppError("INTERNAL", `Render failed during ${stage}${info.sceneKey ? ` (scene ${info.sceneKey})` : ""}: ${info.message.slice(0, 400)}`, { details: info });
  }
}

export async function runRenderStill(ctx: JobHandlerContext) {
  const projectId = ctx.job.projectId!;
  const payload = ctx.job.payload as { sec?: number; purpose?: "thumbnail" | "still"; format?: "jpeg" | "png" };
  await ctx.progress(0.01, "Bundling composition");
  const { serveUrl, build } = await prepare(projectId, ctx, 0.4);
  if (!build.props.scenes.length) throw new AppError("PRECONDITION", "Generate a storyboard before exporting a thumbnail.");
  const inputProps = build.props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: STUDIO_COMPOSITION_ID, inputProps });
  const frame = Math.max(0, Math.min(composition.durationInFrames - 1, secondsToFrames(payload.sec ?? build.props.durationSec * 0.35, composition.fps)));
  const png = payload.format === "png";
  const purpose = payload.purpose ?? "thumbnail";
  const rel = `exports/${purpose}-${new Date().toISOString().replace(/[:.]/g, "-")}.${png ? "png" : "jpg"}`;
  const abs = projectFile(projectId, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await ctx.progress(0.6, "Rendering frame");
  // Remotion only accepts a quality option for JPEG output.
  await renderStill({ serveUrl, composition, inputProps, frame, output: abs, ...(png ? { imageFormat: "png" as const } : { imageFormat: "jpeg" as const, jpegQuality: 90 }), overwrite: true });
  if (purpose === "thumbnail") await db.project.update({ where: { id: projectId }, data: { thumbnailPath: rel } });
  await recordActivity(projectId, "worker", { type: "export.still", message: `Exported ${purpose} at ${(frame / composition.fps).toFixed(2)}s`, data: { path: rel } });
  return { path: rel, url: fileUrl(projectId, rel), downloadUrl: `${fileUrl(projectId, rel)}?download=1`, frame };
}

/**
 * YouTube thumbnail: renders a frame of the video, then the thumbnail card (the frame, darkened toward
 * a big title and an optional tag) as a 1280×720 JPEG in exports/.
 */
export async function runRenderThumbnail(ctx: JobHandlerContext) {
  const projectId = ctx.job.projectId!;
  const payload = ctx.job.payload as { sec?: number; title: string; subtitle?: string; layout?: ThumbnailLayout; darken?: number; width?: number; height?: number };
  await ctx.progress(0.01, "Bundling composition");
  const { serveUrl, build } = await prepare(projectId, ctx, 0.35);
  if (!build.props.scenes.length) throw new AppError("PRECONDITION", "Generate a storyboard before making a thumbnail.");
  const inputProps = build.props as unknown as Record<string, unknown>;
  const video = await selectComposition({ serveUrl, id: STUDIO_COMPOSITION_ID, inputProps });
  const frame = Math.max(0, Math.min(video.durationInFrames - 1, secondsToFrames(payload.sec ?? build.props.durationSec * 0.35, video.fps)));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const frameRel = `exports/thumbnail-frame-${stamp}.png`;
  await fs.mkdir(path.dirname(projectFile(projectId, frameRel)), { recursive: true });
  await ctx.progress(0.45, "Rendering the video frame");
  await renderStill({ serveUrl, composition: video, inputProps, frame, output: projectFile(projectId, frameRel), imageFormat: "png", overwrite: true });

  await ctx.progress(0.75, "Rendering the thumbnail");
  const media = await getMediaServer();
  const design = build.props.design;
  const card: ThumbnailProps = {
    width: payload.width ?? 1280,
    height: payload.height ?? 720,
    background: media.urlFor(projectId, frameRel, stamp),
    title: payload.title,
    subtitle: payload.subtitle ?? "",
    layout: payload.layout ?? "left",
    headingFont: design.typography.headingFont,
    bodyFont: design.typography.bodyFont,
    background_color: design.colors.background,
    accent: design.colors.accent,
    textColor: "#FFFFFF",
    darken: payload.darken ?? 0.55,
  };
  const cardProps = card as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: THUMBNAIL_COMPOSITION_ID, inputProps: cardProps });
  const rel = `exports/youtube-thumbnail-${stamp}.jpg`;
  await renderStill({ serveUrl, composition, inputProps: cardProps, frame: 0, output: projectFile(projectId, rel), imageFormat: "jpeg", jpegQuality: 92, overwrite: true });
  await fs.rm(projectFile(projectId, frameRel), { force: true }).catch(() => undefined);
  await recordActivity(projectId, "worker", { type: "export.thumbnail", message: `Made a YouTube thumbnail “${payload.title}” from ${(frame / video.fps).toFixed(2)}s`, data: { path: rel } });
  return { path: rel, url: fileUrl(projectId, rel), downloadUrl: `${fileUrl(projectId, rel)}?download=1`, frame };
}
