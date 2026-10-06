import { AbsoluteFill, Freeze, Img, Loop, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { duckGain } from "../../core/audio/ducking";
import type { CompositionOverlayClip } from "../../core/spec/composition";
import { croppedAspect, hasTimeRemap } from "../../core/timeline/clip-edits";
import { zoomTransform, zoomViewAt } from "../../core/timeline/overlay-zoom";
import { overlayBox, overlayOpacity, trimmedLengthSec } from "../../core/timeline/overlays";
import { secondsToFrames } from "../../core/timing/frames";
import { AnnotationLayer, CropFrame, RemappedVideo } from "../elements/clip-layers";

/**
 * Overlay track: images and videos above the scenes, placed in absolute video time. A video plays
 * its trimmed part (trimBefore/trimAfter), or follows its speed ramps and freeze frames; when the clip
 * stays on screen longer than that part it loops or holds its last frame. Crop, zoom regions and
 * annotations apply inside the clip's frame; clip audio can dip while the narrator speaks.
 */
export function OverlayClips({ clips, intervals }: { clips: CompositionOverlayClip[]; intervals: [number, number][] }) {
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <>
      {clips.map((clip) => {
        const from = secondsToFrames(clip.startSec, fps);
        if (from >= durationInFrames) return null;
        const length = Math.min(durationInFrames - from, Math.max(1, Math.round(clip.durationSec * fps)));
        return (
          <Sequence key={clip.id} from={from} durationInFrames={length} name={`Overlay · ${clip.name}`}>
            <OverlayClipView clip={clip} from={from} length={length} intervals={intervals} />
          </Sequence>
        );
      })}
    </>
  );
}

function OverlayClipView({ clip, from, length, intervals }: { clip: CompositionOverlayClip; from: number; length: number; intervals: [number, number][] }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const unit = Math.min(width, height) / 1080;
  const box = overlayBox(clip.placement, { width, height }, clip.width && clip.height ? croppedAspect(clip.width / clip.height, clip.crop) : null);
  const mediaStyle = { width: "100%", height: "100%", objectFit: clip.fit, display: "block" } as const;
  const volume = clip.duckUnderVoice && clip.volume > 0 && intervals.length ? (f: number) => clip.volume * duckGain((from + f) / fps, intervals) : clip.volume;

  let media: React.ReactNode;
  if (clip.kind === "image") {
    media = <Img src={clip.src} style={mediaStyle} />;
  } else if (hasTimeRemap(clip)) {
    media = <RemappedVideo src={clip.src} clip={clip} trimEndSec={clip.trimEndSec} sourceDurationSec={clip.sourceDurationSec} loop={clip.endBehavior === "loop"} style={mediaStyle} />;
  } else {
    const trimBefore = clip.trimStartSec > 0 ? Math.round(clip.trimStartSec * fps) : undefined;
    const trimAfter = clip.trimEndSec !== null ? Math.round(clip.trimEndSec * fps) : undefined;
    const trimmed = trimmedLengthSec(clip);
    const clipFrames = trimmed !== null ? Math.max(1, Math.floor(trimmed * fps)) : null;
    const video = (muted: boolean) => (
      <OffthreadVideo src={clip.src} trimBefore={trimBefore} trimAfter={trimAfter} playbackRate={clip.playbackRate || 1} volume={volume} muted={muted || clip.volume === 0} style={mediaStyle} />
    );
    if (clipFrames === null || clipFrames >= length) {
      media = video(false);
    } else if (clip.endBehavior === "loop") {
      media = <Loop durationInFrames={clipFrames}>{video(false)}</Loop>;
    } else {
      media = (
        <>
          <Sequence durationInFrames={clipFrames}>{video(false)}</Sequence>
          <Sequence from={clipFrames}>
            <Freeze frame={clipFrames - 1}>{video(true)}</Freeze>
          </Sequence>
        </>
      );
    }
  }

  return (
    <AbsoluteFill style={{ opacity: overlayOpacity(frame, length, fps, clip) }}>
      {/* data-studio-overlay: the editor canvas selects and measures overlay clips by it (no effect on the picture). */}
      <div
        data-studio-overlay={clip.id}
        style={{
          position: "absolute",
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          overflow: "hidden",
          borderRadius: box.rounded ? 24 * unit : 0,
          boxShadow: box.rounded ? `0 ${24 * unit}px ${80 * unit}px rgba(0,0,0,0.45), 0 ${2 * unit}px ${6 * unit}px rgba(0,0,0,0.25)` : undefined,
          background: clip.fit === "contain" ? "#000000" : undefined,
        }}
      >
        {/* Zoom regions scale and move the media (and the annotations drawn on it) inside the clip frame; the frame itself never moves. */}
        <div style={{ position: "absolute", inset: 0, transformOrigin: "0 0", transform: clip.zooms?.length ? zoomTransform(zoomViewAt(frame / fps, clip.zooms)) : undefined }}>
          <CropFrame crop={clip.crop}>{media}</CropFrame>
          <AnnotationLayer annotations={clip.annotations} timeSec={frame / fps} width={box.width} height={box.height} />
        </div>
        {clip.dim > 0 ? <div style={{ position: "absolute", inset: 0, background: "#000000", opacity: clip.dim }} /> : null}
      </div>
    </AbsoluteFill>
  );
}
