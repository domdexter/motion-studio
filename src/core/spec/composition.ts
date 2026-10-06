import type { VoiceCut } from "../timeline/audio-clips";
import type { Annotation, Crop, SpeedSegment } from "../timeline/clip-edits";
import type { OverlayZoom } from "../timeline/overlay-zoom";
import type { OverlayEndBehavior, OverlayPlacement } from "../timeline/overlays";
import type { DesignSystem } from "./design";
import type { SceneSpec } from "./scene";
import type { TimedWord } from "./timing";

/**
 * The single input the Remotion StudioVideo composition consumes — for both the in-browser
 * Player preview and server-side rendering. Media `src` values are absolute URLs: the GUI
 * points them at the Next.js file route, the renderer at its private loopback file server.
 */

export type CompositionScene = {
  id: string;
  key: string;
  name: string;
  /** Absolute seconds on the master timeline. */
  start: number;
  end: number;
  spec: SceneSpec;
  /** False when the stored spec failed validation (the engine renders a placeholder). */
  valid: boolean;
};

export type CompositionAsset = {
  id: string;
  kind: string;
  name: string;
  src: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
};

export type CompositionTrack = {
  id: string;
  /** voice: a separate spoken line (e.g. a CTA after the narration), mixed like the voice-over. */
  kind: "music" | "sfx" | "voice";
  name: string;
  src: string;
  startSec: number;
  trimStartSec: number;
  durationSec: number | null;
  sourceDurationSec: number | null;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
  muted: boolean;
  loop: boolean;
  duckUnderVoice: boolean;
};

/** An image or video on the overlay track: above the scenes, in absolute video time. */
export type CompositionOverlayClip = {
  id: string;
  name: string;
  kind: "image" | "video";
  src: string;
  width: number | null;
  height: number | null;
  sourceDurationSec: number | null;
  placement: OverlayPlacement;
  fit: "cover" | "contain";
  startSec: number;
  durationSec: number;
  trimStartSec: number;
  trimEndSec: number | null;
  playbackRate: number;
  endBehavior: OverlayEndBehavior;
  volume: number;
  /** Clip audio dips while the narrator speaks. */
  duckUnderVoice?: boolean;
  dim: number;
  opacity: number;
  fadeInSec: number;
  fadeOutSec: number;
  /** Zoom regions in clip seconds. */
  zooms?: OverlayZoom[];
  /** Cut from the edges (fractions of the media). */
  crop?: Crop | null;
  /** Speed ramps and freeze frames in clip seconds. */
  speedSegments?: SpeedSegment[];
  /** Blur, boxes, arrows, labels, spotlights and click ripples in clip seconds. */
  annotations?: Annotation[];
};

export type CompositionFont = { family: string; src: string };

export type StudioVideoProps = {
  projectId: string;
  width: number;
  height: number;
  fps: number;
  /** Master duration in seconds (voice-over duration when present). */
  durationSec: number;
  design: DesignSystem;
  brand: { brandName: string; logoAssetId: string | null };
  scenes: CompositionScene[];
  words: TimedWord[];
  /** `cuts`: muted sections of the voice-over (timing is unchanged). */
  voice: { src: string; volume: number; muted: boolean; durationSec: number; cuts?: VoiceCut[] } | null;
  tracks: CompositionTrack[];
  /** Overlay track (visible clips only), drawn above the scenes. */
  overlayClips?: CompositionOverlayClip[];
  assets: Record<string, CompositionAsset>;
  fonts: CompositionFont[];
  overlays?: { safeArea?: boolean; sceneLabels?: boolean };
  /** Burned-in subtitles (set by a render that asks for them). */
  captions?: { style: "minimal" | "boxed" | "bold" | "karaoke"; position: "bottom" | "top" | "center"; cues: { startSec: number; endSec: number; text: string }[] };
  /** Editor preview only (never set for renders): hide or mute timeline lanes while reviewing. */
  preview?: { hideOverlays?: boolean; hideSceneMedia?: boolean; muteVoice?: boolean; muteAudio?: boolean };
};

export const EMPTY_COMPOSITION_DURATION = 5;

/** Remotion composition id registered by src/remotion/Root.tsx. */
export const STUDIO_COMPOSITION_ID = "StudioVideo";

/** Thumbnail card composition: a frame of the video with a title and a tag on top. */
export const THUMBNAIL_COMPOSITION_ID = "StudioThumbnail";

export const THUMBNAIL_LAYOUTS = ["left", "center", "bottom"] as const;
export type ThumbnailLayout = (typeof THUMBNAIL_LAYOUTS)[number];

export type ThumbnailProps = {
  width: number;
  height: number;
  /** URL of the video frame behind the text (null = the design background). */
  background: string | null;
  title: string;
  /** Short tag under the title (empty = none). */
  subtitle: string;
  layout: ThumbnailLayout;
  headingFont: string;
  bodyFont: string;
  background_color: string;
  accent: string;
  textColor: string;
  /** How much the frame is darkened behind the text, 0..0.85. */
  darken: number;
};
