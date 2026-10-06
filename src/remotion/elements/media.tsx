import type { CSSProperties, ReactNode } from "react";
import { Freeze, Img, Loop, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import type { ElementOf } from "../../core/spec/scene";
import { duckGain, speechIntervals } from "../../core/audio/ducking";
import { croppedAspect, hasTimeRemap } from "../../core/timeline/clip-edits";
import { sceneVideoEnd } from "../../core/timeline/media-clip";
import { zoomTransform, zoomViewAt, type OverlayZoom } from "../../core/timeline/overlay-zoom";
import { readableOn, resolveColor, SHADOWS } from "../engine/color";
import { useScene, type SceneContextValue } from "../engine/context";
import { clamp01 } from "../engine/easing";
import { fontStack } from "../engine/fonts";
import { ElementBox } from "../engine/layout";
import { AnnotationLayer, CropFrame, RemappedVideo } from "./clip-layers";
import { MissingAsset } from "./shared";

/**
 * Media: Image (Ken Burns, masks, overlay, crop, zoom regions, annotations), Video (trim, speed, speed
 * ramps and freeze frames, loop or hold, crop, zoom regions, annotations), Logo (brand logo or wordmark).
 */

function mediaBox(element: ElementOf<"image"> | ElementOf<"video">, ctx: SceneContextValue) {
  const asset = ctx.assets[element.assetId];
  const aspect = asset?.width && asset.height ? croppedAspect(asset.width / asset.height, element.crop) : 16 / 9;
  let w = element.width !== undefined ? (element.width / 100) * ctx.width : undefined;
  let h = element.height !== undefined ? (element.height / 100) * ctx.height : undefined;
  if (w === undefined && h === undefined) w = ctx.width * (ctx.portrait ? 0.86 : 0.6);
  if (w === undefined) w = (h as number) * aspect;
  if (h === undefined) h = w / aspect;
  if (element.type === "image" && element.mask === "circle") {
    const d = Math.min(w, h);
    w = d;
    h = d;
  }
  return { asset, w, h };
}

function frameStyle(element: ElementOf<"image"> | ElementOf<"video">, ctx: SceneContextValue, radius: number): CSSProperties {
  const s = element.style;
  const { u, design } = ctx;
  return {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    borderRadius: radius,
    boxShadow: s?.shadow ? (s.shadow === "glow" ? SHADOWS.glow(u, design.colors.primary) : SHADOWS[s.shadow](u)) : undefined,
    border: s?.borderColor ? `${u(s.borderWidth ?? 2)}px solid ${resolveColor(s.borderColor, design)}` : undefined,
    background: s?.background ? resolveColor(s.background, design) : undefined,
  };
}

/** Scene-relative frame where media appears: a video starts playing and zoom regions and annotations start counting here. */
function appearFrameOf(element: ElementOf<"image"> | ElementOf<"video">, ctx: SceneContextValue): number {
  return element.enter?.at || ctx.shotId ? Math.max(0, ctx.frameAt(element.enter?.at, "sceneStart", element.enter?.delay ?? 0)) : 0;
}

/** CSS transform of the zoom regions at a scene frame (undefined when none is active). */
function zoomAt(zooms: OverlayZoom[] | undefined, frame: number, appearFrame: number, fps: number): string | undefined {
  return zooms?.length ? zoomTransform(zoomViewAt((frame - appearFrame) / fps, zooms)) : undefined;
}

/** Zoom regions scale and move the media inside its frame; the frame itself never moves. */
function ZoomLayer({ zooms, transform, children }: { zooms: OverlayZoom[] | undefined; transform: string | undefined; children: ReactNode }) {
  if (!zooms?.length) return <>{children}</>;
  return <div style={{ position: "absolute", inset: 0, transformOrigin: "0 0", transform }}>{children}</div>;
}

export function ImageElementView({ element }: { element: ElementOf<"image"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  if (ctx.hideMedia) return null;
  const { u, design } = ctx;
  const { asset, w, h } = mediaBox(element, ctx);
  const radius = element.mask === "circle" ? 9999 : u(element.radius ?? (element.mask === "rounded" ? design.shape.radius * 1.5 : 0));
  const kb = element.kenBurns;
  const t = clamp01((frame - ctx.segmentStartFrame) / Math.max(1, ctx.segmentEndFrame - ctx.segmentStartFrame));
  const scale = kb ? (kb.from ?? 1) + ((kb.to ?? 1.12) - (kb.from ?? 1)) * t : 1;
  const pan = kb ? `translate(${(kb.panX ?? 0) * t}%, ${(kb.panY ?? 0) * t}%) ` : "";
  const appearFrame = appearFrameOf(element, ctx);
  const zoom = zoomAt(element.zooms, frame, appearFrame, ctx.fps);
  return (
    <ElementBox element={element} width={w} height={h}>
      {() => (
        <div style={frameStyle(element, ctx, radius)}>
          {asset ? (
            <ZoomLayer zooms={element.zooms} transform={zoom}>
              <CropFrame crop={element.crop}>
                <Img src={asset.src} style={{ width: "100%", height: "100%", objectFit: element.fit ?? "cover", transform: `${pan}scale(${scale})` }} />
              </CropFrame>
              <AnnotationLayer annotations={element.annotations} timeSec={(frame - appearFrame) / ctx.fps} width={w} height={h} />
            </ZoomLayer>
          ) : (
            <MissingAsset id={element.assetId} radius={radius} />
          )}
          {element.overlay ? <div style={{ position: "absolute", inset: 0, background: resolveColor(element.overlay.color, design), opacity: element.overlay.opacity }} /> : null}
        </div>
      )}
    </ElementBox>
  );
}

export function VideoElementView({ element }: { element: ElementOf<"video"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  if (ctx.hideMedia) return null;
  const { u, design } = ctx;
  const { asset, w, h } = mediaBox(element, ctx);
  const radius = u(element.radius ?? 0);
  const rate = element.playbackRate ?? 1;
  const volume = element.volume ?? 0;
  const start = element.startFrom ?? 0;
  const end = sceneVideoEnd(element);
  const sourceEnd = end ?? asset?.durationSec ?? null;
  const trimBefore = start > 0 ? Math.round(start * ctx.fps) : undefined;
  const trimAfter = end !== null ? Math.round(end * ctx.fps) : undefined;
  const style: CSSProperties = { width: "100%", height: "100%", objectFit: element.fit ?? "cover" };
  // Frames the trimmed part plays; afterwards it loops or holds its last frame.
  const clipFrames = sourceEnd !== null && sourceEnd > start ? Math.max(1, Math.floor(((sourceEnd - start) / rate) * ctx.fps)) : 0;
  // Clip audio can dip while the narrator speaks (f counts from when the clip starts playing).
  const speech = element.duckUnderVoice && volume > 0 ? speechIntervals(ctx.words, []) : null;
  const playStartFrame = ctx.startFrame + appearFrameOf(element, ctx);
  const clipVolume = speech?.length ? (f: number) => volume * duckGain((playStartFrame + f) / ctx.fps, speech) : volume;
  const video = (muted: boolean) => (asset ? <OffthreadVideo src={asset.src} trimBefore={trimBefore} trimAfter={trimAfter} playbackRate={rate} volume={clipVolume} muted={muted || volume === 0} style={style} /> : null);
  let clip: ReactNode = null;
  if (asset) {
    if (hasTimeRemap(element)) {
      clip = <RemappedVideo src={asset.src} clip={{ trimStartSec: start, playbackRate: rate, speedSegments: element.speedSegments }} trimEndSec={end} sourceDurationSec={asset.durationSec} loop={!!element.loop} style={style} />;
    } else if (clipFrames <= 1) clip = video(false);
    else if (element.loop) clip = <Loop durationInFrames={clipFrames}>{video(false)}</Loop>;
    else
      clip = (
        <>
          <Sequence durationInFrames={clipFrames}>{video(false)}</Sequence>
          <Sequence from={clipFrames}>
            <Freeze frame={clipFrames - 1}>{video(true)}</Freeze>
          </Sequence>
        </>
      );
  }
  // A clip that appears mid-scene (or in a later shot) starts playing when it appears, not at the scene start.
  const appearFrame = appearFrameOf(element, ctx);
  const zoom = zoomAt(element.zooms, frame, appearFrame, ctx.fps);
  return (
    <ElementBox element={element} width={w} height={h}>
      {() => (
        <div style={frameStyle(element, ctx, radius)}>
          {clip ? (
            <ZoomLayer zooms={element.zooms} transform={zoom}>
              <CropFrame crop={element.crop}>
                {appearFrame > 0 ? (
                  <Sequence from={appearFrame} layout="none">
                    {clip}
                  </Sequence>
                ) : (
                  clip
                )}
              </CropFrame>
              <AnnotationLayer annotations={element.annotations} timeSec={(frame - appearFrame) / ctx.fps} width={w} height={h} />
            </ZoomLayer>
          ) : (
            <MissingAsset id={element.assetId} radius={radius} />
          )}
          {element.overlay ? <div style={{ position: "absolute", inset: 0, background: resolveColor(element.overlay.color, design), opacity: element.overlay.opacity }} /> : null}
        </div>
      )}
    </ElementBox>
  );
}

export function LogoElementView({ element }: { element: ElementOf<"logo"> }) {
  const ctx = useScene();
  const { u, design } = ctx;
  const assetId = element.assetId ?? ctx.brand.logoAssetId ?? undefined;
  const asset = assetId ? ctx.assets[assetId] : undefined;
  const size = u(element.size ?? 120);
  const name = element.text ?? ctx.brand.brandName;
  const variant = element.variant ?? (asset ? "mark" : "wordmark");
  const color = resolveColor(element.color, design, "text");
  const heading = fontStack(design.typography.headingFont);
  const mark = asset ? (
    <Img src={asset.src} style={{ height: size, width: "auto", display: "block", objectFit: "contain" }} />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: `linear-gradient(145deg, ${design.colors.primary}, ${design.colors.secondary})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: readableOn(design.colors.primary, design),
        fontFamily: heading,
        fontWeight: 800,
        fontSize: size * 0.5,
        flexShrink: 0,
      }}
    >
      {(name || "•").trim().charAt(0).toUpperCase()}
    </div>
  );
  const word = <div style={{ fontFamily: heading, fontWeight: design.typography.headingWeight, fontSize: size * 0.62, color, letterSpacing: "-0.02em", whiteSpace: "nowrap", lineHeight: 1 }}>{name}</div>;
  return (
    <ElementBox element={element}>
      {() =>
        variant === "mark" ? (
          mark
        ) : variant === "wordmark" ? (
          word
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: size * 0.3 }}>
            {mark}
            {name ? word : null}
          </div>
        )
      }
    </ElementBox>
  );
}
