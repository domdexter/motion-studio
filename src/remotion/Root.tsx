import { Composition } from "remotion";
import { DEFAULT_DESIGN } from "../core/design/presets";
import { EMPTY_COMPOSITION_DURATION, STUDIO_COMPOSITION_ID, THUMBNAIL_COMPOSITION_ID, type StudioVideoProps, type ThumbnailProps } from "../core/spec/composition";
import { durationToTotalFrames } from "../core/timing/frames";
import { StudioVideo } from "./StudioVideo";
import { ThumbnailCard } from "./thumbnail/ThumbnailCard";

export const DEFAULT_STUDIO_PROPS: StudioVideoProps = {
  projectId: "preview",
  width: 1920,
  height: 1080,
  fps: 30,
  durationSec: EMPTY_COMPOSITION_DURATION,
  design: DEFAULT_DESIGN,
  brand: { brandName: "Motion Studio", logoAssetId: null },
  scenes: [],
  words: [],
  voice: null,
  tracks: [],
  assets: {},
  fonts: [],
};

const DEFAULT_THUMBNAIL_PROPS: ThumbnailProps = {
  width: 1280,
  height: 720,
  background: null,
  title: "Your title",
  subtitle: "",
  layout: "left",
  headingFont: DEFAULT_DESIGN.typography.headingFont,
  bodyFont: DEFAULT_DESIGN.typography.bodyFont,
  background_color: DEFAULT_DESIGN.colors.background,
  accent: DEFAULT_DESIGN.colors.accent,
  textColor: "#FFFFFF",
  darken: 0.55,
};

/** H.264 requires even dimensions. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function RemotionRoot() {
  return (
    <>
      <Composition
        id={STUDIO_COMPOSITION_ID}
        component={StudioVideo}
        durationInFrames={durationToTotalFrames(EMPTY_COMPOSITION_DURATION, 30)}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={DEFAULT_STUDIO_PROPS}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(1, durationToTotalFrames(props.durationSec || EMPTY_COMPOSITION_DURATION, props.fps)),
          fps: props.fps,
          width: even(props.width),
          height: even(props.height),
        })}
      />
      <Composition
        id={THUMBNAIL_COMPOSITION_ID}
        component={ThumbnailCard}
        durationInFrames={1}
        fps={30}
        width={1280}
        height={720}
        defaultProps={DEFAULT_THUMBNAIL_PROPS}
        calculateMetadata={({ props }) => ({ width: even(props.width), height: even(props.height) })}
      />
    </>
  );
}
