import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import type { Anchor, SceneElement } from "../../core/spec/scene";
import { motionFor, motionStyle, type MotionState } from "./animation";
import { alpha, resolveColor, SHADOWS } from "./color";
import { blendStyle, compositingLayers } from "./compositing";
import { useScene, type SceneContextValue } from "./context";

const ANCHOR_TRANSLATE: Record<Anchor, [string, string]> = {
  center: ["-50%", "-50%"],
  "top-left": ["0%", "0%"],
  top: ["-50%", "0%"],
  "top-right": ["-100%", "0%"],
  left: ["0%", "-50%"],
  right: ["-100%", "-50%"],
  "bottom-left": ["0%", "-100%"],
  bottom: ["-50%", "-100%"],
  "bottom-right": ["-100%", "-100%"],
};

/**
 * Positions an element (x/y percent + anchor), sizes it (width % of frame width, height % of
 * frame height) and applies its motion. The element it is handed is already resolved for this frame —
 * `ElementRenderer` runs its keyframes and motion path first (core/motion/keyframes.ts, the same
 * resolution the editor shows) — so x, y, width, height, scale and the rest are simply read here.
 * Entrance, exit, emphasis and idle motion compose on top. Renderers receive the motion state for
 * text-level reveals.
 */
export function ElementBox({
  element,
  children,
  width,
  height,
  style,
}: {
  element: SceneElement;
  children: (motion: MotionState, ctx: SceneContextValue) => ReactNode;
  width?: number;
  height?: number;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const shown = element;
  const motion = motionFor(shown, frame, ctx);
  const [tx, ty] = ANCHOR_TRANSLATE[element.anchor ?? "center"];
  const w = width ?? (shown.width !== undefined ? (shown.width / 100) * ctx.width : undefined);
  const h = height ?? (shown.height !== undefined ? (shown.height / 100) * ctx.height : undefined);
  // Compositing (engine/compositing.ts): blend outside the motion transform, effects and clip inside it.
  const inner = composited(compositingLayers(shown, ctx.u, ctx.design), children(motion, ctx));
  return (
    <div
      style={{
        position: "absolute",
        left: `${shown.x ?? 50}%`,
        top: `${shown.y ?? 50}%`,
        // Without an explicit width, size to content (left: 50% would otherwise halve the available width).
        width: w ?? "max-content",
        height: h,
        transform: `translate(${tx}, ${ty})`,
        zIndex: element.z ?? 0,
        ...blendStyle(shown),
        ...style,
      }}
    >
      <div style={{ width: "100%", height: "100%", transformOrigin: "center center", ...motionStyle(motion) }}>{inner}</div>
    </div>
  );
}

/** Wraps a rendered element in its compositing layers, outermost first (effects, then the clip). */
export function composited(layers: CSSProperties[], node: ReactNode): ReactNode {
  return layers.reduceRight<ReactNode>((inner, style) => <div style={style}>{inner}</div>, node);
}

/** Surface styling shared by cards, windows and panels (respects element.style overrides). */
export function surfaceStyle(element: SceneElement, ctx: SceneContextValue, options: { variant?: string; accent?: string } = {}): CSSProperties {
  const { design, u } = ctx;
  const s = element.style ?? {};
  const radius = u(s.radius ?? design.shape.radius);
  const glass = s.glass ?? options.variant === "glass";
  const solid = options.variant === "solid";
  const outline = options.variant === "outline";
  const accent = resolveColor(options.accent, design, "primary");
  const background = s.background
    ? resolveColor(s.background, design)
    : solid
      ? accent
      : glass
        ? alpha(design.colors.surface, 0.55)
        : outline
          ? "transparent"
          : design.colors.surface;
  const shadowKind = s.shadow ?? (outline ? "none" : design.shape.shadow);
  const shadow = shadowKind === "glow" ? SHADOWS.glow(u, accent) : SHADOWS[shadowKind](u);
  return {
    background,
    borderRadius: radius,
    border: `${u(s.borderWidth ?? Math.max(1, design.shape.borderWidth))}px solid ${s.borderColor ? resolveColor(s.borderColor, design) : outline ? alpha(design.colors.text, 0.22) : alpha(design.colors.text, 0.09)}`,
    boxShadow: shadow,
    backdropFilter: glass ? `blur(${u(s.blur ?? 24)}px) saturate(1.3)` : undefined,
    padding: s.padding !== undefined ? u(s.padding) : undefined,
    overflow: "hidden",
  };
}
