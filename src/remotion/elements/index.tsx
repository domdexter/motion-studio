import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { elementAtTime, isAnimatedElement, keyframeClockSec } from "../../core/motion/keyframes";
import type { ElementOf, SceneElement } from "../../core/spec/scene";
import { elementSpan } from "../../core/timeline/scene-restructure";
import { motionFor, motionStyle } from "../engine/animation";
import { blendStyle, compositingLayers } from "../engine/compositing";
import { useScene } from "../engine/context";
import { composited } from "../engine/layout";
import { CardElementView, CardsElementView } from "./cards";
import { ChartElementView, CounterElementView, DiagramElementView, IconElementView, ListElementView } from "./data";
import { BrowserElementView, DashboardElementView, DesktopElementView, PhoneElementView } from "./devices";
import { ImageElementView, LogoElementView, VideoElementView } from "./media";
import { CircleElementView, GridElementView, LineElementView, ProgressElementView, RectElementView } from "./shapes";
import { BadgeElementView, CaptionsElementView, KineticElementView, TextElementView } from "./text";
import { ButtonElementView, CursorElementView, NotificationElementView } from "./ui";

/**
 * Maps a validated scene element to its renderer, resolved for this frame first: its keyframes run on
 * its own clock (seconds since it appears — its entrance cue plus delay, else its scene or shot start,
 * the rule the editor's timeline and inspector use) and its motion path places it. Every renderer below
 * therefore reads plain values, which is what lets any field a renderer reads be animated.
 */
export function ElementRenderer({ element, tag }: { element: SceneElement; tag?: string }) {
  const ctx = useScene();
  const frame = useCurrentFrame();
  const appear = useMemo(() => (isAnimatedElement(element) ? elementSpan(element, ctx.triggers).appear : null), [element, ctx.triggers]);
  const shown = appear === null ? element : elementAtTime(element, keyframeClockSec(ctx.startFrame + frame, ctx.fps, appear));
  return elementView(shown, tag);
}

function elementView(element: SceneElement, tag?: string) {
  switch (element.type) {
    case "text":
      return <TextElementView element={element} />;
    case "kinetic":
      return <KineticElementView element={element} />;
    case "captions":
      return <CaptionsElementView element={element} />;
    case "badge":
      return <BadgeElementView element={element} />;
    case "card":
      return <CardElementView element={element} />;
    case "cards":
      return <CardsElementView element={element} />;
    case "browser":
      return <BrowserElementView element={element} />;
    case "phone":
      return <PhoneElementView element={element} />;
    case "desktop":
      return <DesktopElementView element={element} />;
    case "dashboard":
      return <DashboardElementView element={element} />;
    case "button":
      return <ButtonElementView element={element} />;
    case "notification":
      return <NotificationElementView element={element} />;
    case "cursor":
      return <CursorElementView element={element} />;
    case "line":
      return <LineElementView element={element} />;
    case "circle":
      return <CircleElementView element={element} />;
    case "rect":
      return <RectElementView element={element} />;
    case "grid":
      return <GridElementView element={element} />;
    case "progress":
      return <ProgressElementView element={element} />;
    case "chart":
      return <ChartElementView element={element} />;
    case "counter":
      return <CounterElementView element={element} />;
    case "diagram":
      return <DiagramElementView element={element} />;
    case "icon":
      return <IconElementView element={element} />;
    case "list":
      return <ListElementView element={element} />;
    case "image":
      return <ImageElementView element={element} />;
    case "video":
      return <VideoElementView element={element} />;
    case "logo":
      return <LogoElementView element={element} />;
    case "group":
      return <GroupElementView element={element} tag={tag} />;
    default:
      return null;
  }
}

/**
 * A group: one layer the size of the frame holding several elements, with its own transform, opacity,
 * timing, animation, keyframes, effects, clip and blend. Children keep their own frame coordinates and
 * their own cues, so grouping never moves anything and a child still lands on its word; what the group
 * adds is applied to all of them at once. `x`/`y` shift the layer (50/50 = where it already is) and
 * scale and rotation turn around `pivot`, in % of the frame. Groups do not nest.
 */
function GroupElementView({ element, tag }: { element: ElementOf<"group">; tag?: string }) {
  const ctx = useScene();
  const frame = useCurrentFrame();
  const motion = motionFor(element, frame, ctx);
  motion.translateX += (((element.x ?? 50) - 50) / 100) * ctx.width;
  motion.translateY += (((element.y ?? 50) - 50) / 100) * ctx.height;
  const layers = compositingLayers(element, ctx.u, ctx.design);
  const ordered = useMemo(() => element.children.map((child, i) => ({ child, i })).sort((a, b) => (a.child.z ?? 0) - (b.child.z ?? 0) || a.i - b.i), [element.children]);
  const inside = (
    <AbsoluteFill style={{ isolation: "isolate" }}>
      {ordered.map(({ child, i }) =>
        // In the editor each child is tagged like any element, so the canvas can select it inside its group.
        tag ? (
          <div key={`${i}-${child.type}`} data-studio-el={`${tag}:${i}`} style={{ display: "contents" }}>
            <ElementRenderer element={child} />
          </div>
        ) : (
          <ElementRenderer key={`${i}-${child.type}`} element={child} />
        ),
      )}
    </AbsoluteFill>
  );
  return (
    <AbsoluteFill style={{ zIndex: element.z ?? 0, ...blendStyle(element) }}>
      <AbsoluteFill style={{ transformOrigin: "50% 50%", ...motionStyle(motion) }}>{composited(layers, inside)}</AbsoluteFill>
    </AbsoluteFill>
  );
}
