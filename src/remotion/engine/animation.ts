import type { CSSProperties } from "react";
import { grammarEnter, roleScale } from "../../core/creative/grammar";
import { DEFAULT_DEPTH } from "../../core/spec/animatable";
import type { Anchor, Emphasis, EnterAnimation, ExitAnimation, SceneElement } from "../../core/spec/scene";
import { bell, clamp01, ease } from "./easing";
import type { SceneContextValue } from "./context";
import { alpha, resolveColor } from "./color";

/**
 * Element motion: enter → (emphasis, idle) → exit. Returns composable transform/opacity/filter
 * values. Text-level reveals (wordReveal, charReveal, typewriter, mask) keep the element
 * visible here and use `enterProgress`/`enterFrame` inside the text renderer.
 *
 * Motion grammar: an element with `motionIntent` and no `enter` uses the grammar's entrance.
 * Motion hierarchy: `motionRole` scales travel, emphasis and idle (tertiary never idles).
 * Density: the scene's `motion.density` scales default durations, travel, emphasis and idle
 * (via ctx.intensity / ctx.motionScale). Without these fields motion is unchanged.
 */

export interface MotionState {
  enterFrame: number;
  enterDuration: number;
  /** 0..1 eased enter progress. */
  enterProgress: number;
  /** 0..1 raw (linear) enter progress. */
  enterRaw: number;
  exitProgress: number;
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  /** Extra one-axis scale from the element (squash and stretch); presets scale `scale`, these stay its own. */
  scaleX: number;
  scaleY: number;
  rotate: number;
  /** 3D tilt, in degrees. An entrance (flip) adds to whatever tilt the element itself has. */
  rotateX: number;
  rotateY: number;
  /** The viewer's distance from a tilted element, in px (only read when it is tilted). */
  perspective: number;
  blur: number;
  clipPath?: string;
  glow?: string;
  /** CSS transform origin; a converging element scales around its anchor. */
  origin?: string;
  visible: boolean;
}

const ANCHOR_ORIGIN: Record<Anchor, string> = {
  center: "50% 50%",
  "top-left": "0% 0%",
  top: "50% 0%",
  "top-right": "100% 0%",
  left: "0% 50%",
  right: "100% 50%",
  "bottom-left": "0% 100%",
  bottom: "50% 100%",
  "bottom-right": "100% 100%",
};

const TEXT_LEVEL = new Set(["wordReveal", "charReveal", "typewriter", "mask", "draw"]);
/** Which element types render the reveal themselves (text.tsx, shapes.tsx). */
const RENDERS_REVEAL: Record<string, ReadonlySet<string>> = {
  wordReveal: new Set(["text"]),
  charReveal: new Set(["text"]),
  typewriter: new Set(["text"]),
  mask: new Set(["text"]),
  draw: new Set(["line", "circle", "rect"]),
};
/** Media fills its box, so a fixed travel in design units barely moves it: slides get a share of the box. */
const BOX_TRAVEL: Record<string, number> = { rise: 0.12, slideUp: 0.5, slideDown: 0.5, slideLeft: 0.5, slideRight: 0.5 };

/**
 * An entrance the element can actually play. A text reveal on an image would otherwise do nothing at
 * all (the renderer owns it), so it falls back to the closest preset that every element can play.
 */
function playableEnter(enter: EnterAnimation, type: SceneElement["type"]): EnterAnimation {
  const renders = RENDERS_REVEAL[enter.type];
  if (!renders || renders.has(type)) return enter;
  return { ...enter, type: enter.type === "draw" || enter.type === "mask" ? "wipe" : "fade" };
}

/** The entrance an element actually uses (explicit `enter`, else its motion intent's grammar). */
export function effectiveEnter(el: SceneElement): EnterAnimation | undefined {
  return el.enter ?? (el.motionIntent ? grammarEnter(el.motionIntent, el.type) : undefined);
}

export function motionFor(el: SceneElement, frame: number, ctx: SceneContextValue): MotionState {
  const { design, u } = ctx;
  const enter = effectiveEnter(el);
  const exit: ExitAnimation | undefined = el.exit;
  const role = roleScale(el.motionRole);
  const k = ctx.intensity * role.distance;
  const state: MotionState = {
    enterFrame: 0,
    enterDuration: 1,
    enterProgress: 1,
    enterRaw: 1,
    exitProgress: 0,
    opacity: el.opacity ?? 1,
    translateX: 0,
    translateY: 0,
    scale: el.scale ?? 1,
    scaleX: el.scaleX ?? 1,
    scaleY: el.scaleY ?? 1,
    rotate: el.rotation ?? 0,
    rotateX: el.rotateX ?? 0,
    rotateY: el.rotateY ?? 0,
    perspective: ctx.u(el.depth ?? DEFAULT_DEPTH),
    blur: 0,
    // What rotation and scale turn around: the element's pivot, else its centre (a converging exit sets its own).
    origin: el.pivot ? `${el.pivot[0]}% ${el.pivot[1]}%` : undefined,
    visible: true,
  };

  if (enter && enter.type !== "none") {
    const playable = playableEnter(enter, el.type);
    const enterFrame = ctx.frameAt(enter.at, "sceneStart", enter.delay ?? 0);
    const duration = Math.max(1, ctx.frames(enter.duration ?? design.motion.defaultDuration * ctx.motionScale.duration * role.duration));
    const raw = clamp01((frame - enterFrame) / duration);
    const p = ease(enter.easing ?? (playable.type === "pop" ? "backOut" : undefined), raw, design.motion.easing);
    state.enterFrame = enterFrame;
    state.enterDuration = duration;
    state.enterRaw = raw;
    state.enterProgress = p;
    if (frame < enterFrame && !TEXT_LEVEL.has(playable.type)) state.visible = false;
    // Media is sized in % of the frame, so its travel is a share of its own box unless a distance was set.
    const boxTravel = (axis: "x" | "y") => {
      if (playable.distance !== undefined || (el.type !== "image" && el.type !== "video")) return 0;
      const share = BOX_TRAVEL[playable.type] ?? 0;
      const box = axis === "y" ? ((el.height ?? 0) / 100) * ctx.height : ((el.width ?? 0) / 100) * ctx.width;
      return box * share * Math.min(1.4, k);
    };
    const dist = (d: number, axis: "x" | "y" = "y") => Math.max(u(playable.distance ?? d) * k, boxTravel(axis));
    switch (playable.type) {
      case "fade":
        state.opacity *= p;
        break;
      case "rise":
        state.opacity *= p;
        state.translateY += (1 - p) * dist(48);
        break;
      case "slideUp":
        state.opacity *= Math.min(1, p * 1.6);
        state.translateY += (1 - p) * dist(140);
        break;
      case "slideDown":
        state.opacity *= Math.min(1, p * 1.6);
        state.translateY -= (1 - p) * dist(140);
        break;
      case "slideLeft":
        state.opacity *= Math.min(1, p * 1.6);
        state.translateX += (1 - p) * dist(200, "x");
        break;
      case "slideRight":
        state.opacity *= Math.min(1, p * 1.6);
        state.translateX -= (1 - p) * dist(200, "x");
        break;
      case "scale":
        state.opacity *= p;
        state.scale *= 1 - Math.max(0.14 * Math.min(2, k), 0.14) * (1 - p);
        break;
      case "pop": {
        state.opacity *= clamp01(raw * 2.5);
        state.scale *= 0.55 + 0.45 * p;
        break;
      }
      case "blur":
        state.opacity *= p;
        state.blur += (1 - p) * u(22);
        break;
      case "wipe":
        state.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
        break;
      case "zoom":
        state.opacity *= p;
        state.scale *= 1 + Math.max(0.25 * Math.min(2, k), 0.22) * (1 - p);
        break;
      case "flip":
        state.opacity *= clamp01(raw * 2);
        state.rotateX += (1 - p) * 70;
        break;
      default:
        break; // text-level reveal handled by the renderer
    }
  }

  if (exit && exit.type !== "none") {
    const duration = Math.max(1, ctx.frames(exit.duration ?? design.motion.transitionDuration));
    const exitFrame = exit.at ? ctx.frameAt(exit.at, "sceneEnd") : ctx.segmentEndFrame - duration;
    const q = ease(exit.easing ?? "easeIn", (frame - exitFrame) / duration, "easeIn");
    state.exitProgress = q;
    const dist = (d: number) => u(exit.distance ?? d) * k;
    switch (exit.type) {
      case "fade":
        state.opacity *= 1 - q;
        break;
      case "slideUp":
        state.opacity *= 1 - q;
        state.translateY -= q * dist(120);
        break;
      case "slideDown":
        state.opacity *= 1 - q;
        state.translateY += q * dist(120);
        break;
      case "slideLeft":
        state.opacity *= 1 - q;
        state.translateX -= q * dist(200);
        break;
      case "slideRight":
        state.opacity *= 1 - q;
        state.translateX += q * dist(200);
        break;
      case "scale":
        state.opacity *= 1 - q;
        state.scale *= 1 - 0.14 * q;
        break;
      case "blur":
        state.opacity *= 1 - q;
        state.blur += q * u(22);
        break;
      case "wipe":
        state.clipPath = `inset(0 0 0 ${q * 100}%)`;
        break;
      case "zoom":
        state.opacity *= 1 - q;
        state.scale *= 1 + 0.22 * q;
        break;
      case "collapse":
        state.opacity *= 1 - q;
        state.scale *= 1 - 0.85 * q;
        break;
      case "converge": {
        // The anchor travels to the target point (not scaled by density: the point is the design).
        const [toX, toY] = exit.to ?? [50, 50];
        state.origin = ANCHOR_ORIGIN[el.anchor ?? "center"];
        state.translateX += ((toX - (el.x ?? 50)) / 100) * ctx.width * q;
        state.translateY += ((toY - (el.y ?? 50)) / 100) * ctx.height * q;
        state.rotate *= 1 - q;
        state.scale *= 1 - 0.9 * q;
        state.opacity *= 1 - clamp01((q - 0.55) / 0.45);
        break;
      }
    }
  }

  for (const em of el.emphasis ?? []) applyEmphasis(state, em, frame, ctx, role.emphasis);
  applyIdle(state, el, frame, ctx, role.idle);
  return state;
}

function applyEmphasis(state: MotionState, em: Emphasis, frame: number, ctx: SceneContextValue, roleEmphasis: number): void {
  const start = ctx.frameAt(em.at, "sceneStart");
  const duration = Math.max(1, ctx.frames(em.duration ?? 0.6));
  const t = (frame - start) / duration;
  if (t < 0 || t > 1) return;
  const k = (em.intensity ?? 1) * ctx.designIntensity * ctx.motionScale.emphasis * roleEmphasis;
  const b = bell(t);
  switch (em.type) {
    case "pulse":
      state.scale *= 1 + 0.07 * b * k;
      break;
    case "pop":
      state.scale *= 1 + 0.16 * b * k;
      break;
    case "shake":
      state.translateX += Math.sin(t * Math.PI * 7) * ctx.u(14) * (1 - t) * k;
      state.rotate += Math.sin(t * Math.PI * 5) * 1.2 * (1 - t) * k;
      break;
    case "bounce":
      state.translateY -= Math.abs(Math.sin(t * Math.PI * 2)) * ctx.u(22) * (1 - t) * k;
      break;
    case "glow":
    case "highlight":
    case "underline":
    case "colorShift":
      state.glow = `drop-shadow(0 0 ${ctx.u(26) * b * k}px ${alpha(resolveColor(em.color, ctx.design, "primary"), 0.9)})`;
      break;
  }
}

function applyIdle(state: MotionState, el: SceneElement, frame: number, ctx: SceneContextValue, roleIdle: number): void {
  if (!el.idle || el.idle === "none") return;
  const k = ctx.designIntensity * ctx.motionScale.idle * roleIdle;
  if (k <= 0) return;
  const sec = frame / ctx.fps;
  switch (el.idle) {
    case "float":
      state.translateY += Math.sin((sec / 4.2) * Math.PI * 2) * ctx.u(7) * k;
      break;
    case "breathe":
      state.scale *= 1 + Math.sin((sec / 5) * Math.PI * 2) * 0.012 * k;
      break;
    case "drift":
      state.translateX += Math.sin((sec / 7) * Math.PI * 2) * ctx.u(10) * k;
      state.translateY += Math.cos((sec / 9) * Math.PI * 2) * ctx.u(5) * k;
      break;
    case "spin":
      state.rotate += sec * 18 * Math.min(1, k);
      break;
    case "pulse":
      state.opacity *= 1 - 0.12 * Math.min(1, k) * (0.5 - 0.5 * Math.sin((sec / 1.8) * Math.PI * 2));
      break;
  }
}

export function motionStyle(m: MotionState): CSSProperties {
  // One-axis scales multiply the uniform one, so a preset's pulse still reads through a squash.
  const sx = m.scale * m.scaleX;
  const sy = m.scale * m.scaleY;
  const transforms = [
    m.translateX || m.translateY ? `translate3d(${m.translateX}px, ${m.translateY}px, 0)` : "",
    // Perspective first, so the tilts to its right are seen from that distance; the element itself stays flat.
    m.rotateX || m.rotateY ? `perspective(${m.perspective}px)` : "",
    m.rotateX ? `rotateX(${m.rotateX}deg)` : "",
    m.rotateY ? `rotateY(${m.rotateY}deg)` : "",
    m.rotate ? `rotate(${m.rotate}deg)` : "",
    sx !== 1 || sy !== 1 ? (sx === sy ? `scale(${sx})` : `scale(${sx}, ${sy})`) : "",
  ].filter(Boolean);
  const filters = [m.blur > 0.05 ? `blur(${m.blur}px)` : "", m.glow ?? ""].filter(Boolean);
  return {
    opacity: m.visible ? Math.max(0, Math.min(1, m.opacity)) : 0,
    transform: transforms.length ? transforms.join(" ") : undefined,
    filter: filters.length ? filters.join(" ") : undefined,
    clipPath: m.clipPath,
    ...(m.origin ? { transformOrigin: m.origin } : {}),
    willChange: "transform, opacity",
  };
}
