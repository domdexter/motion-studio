import type { CSSProperties } from "react";
import type { Camera, Transition } from "../../core/spec/scene";
import type { DesignSystem } from "../../core/spec/design";
import { effectiveTransition } from "../../core/spec/scene-transition";
import { ease } from "../engine/easing";

// Which transition a scene or shot enters with is shared with the editor's timeline.
export { effectiveTransition, shotTransition } from "../../core/spec/scene-transition";

/** Seconds the previous scene must keep rendering underneath this scene's transition. */
export function transitionOverlapSec(spec: { transitionIn?: Transition }, design: DesignSystem, index: number): number {
  return effectiveTransition(spec, design, index)?.duration ?? 0;
}

/**
 * Style applied to the INCOMING scene during its first frames. The scene still starts exactly
 * on its audio-locked frame; the outgoing scene simply keeps playing underneath.
 */
export function transitionStyle(transition: Transition | null, frame: number, fps: number, unit: number): CSSProperties | null {
  if (!transition) return null;
  const duration = Math.max(1, Math.round((transition.duration ?? 0.45) * fps));
  if (frame >= duration) return null;
  const p = ease("easeInOut", frame / duration);
  const e = ease("expoOut", frame / duration);
  const dir = transition.direction ?? "left";
  switch (transition.type) {
    case "fade":
      return { opacity: p };
    case "slide": {
      const offset = (1 - e) * 100;
      const transform = dir === "left" ? `translateX(${offset}%)` : dir === "right" ? `translateX(${-offset}%)` : dir === "up" ? `translateY(${offset}%)` : `translateY(${-offset}%)`;
      return { transform, boxShadow: "0 0 80px rgba(0,0,0,0.45)" };
    }
    case "wipe": {
      const r = (1 - e) * 100;
      const clipPath = dir === "left" ? `inset(0 0 0 ${r}%)` : dir === "right" ? `inset(0 ${r}% 0 0)` : dir === "up" ? `inset(${r}% 0 0 0)` : `inset(0 0 ${r}% 0)`;
      return { clipPath };
    }
    case "zoom":
      return { opacity: p, transform: `scale(${1.12 - 0.12 * e})` };
    case "blur":
      return { opacity: p, filter: `blur(${(1 - p) * 26 * unit}px)` };
    case "scale":
      return { opacity: p, transform: `scale(${0.94 + 0.06 * e})`, borderRadius: `${(1 - e) * 32 * unit}px`, overflow: "hidden" };
    case "morph":
      return { opacity: p, transform: `scale(${1.05 - 0.05 * e})`, filter: `blur(${(1 - p) * 12 * unit}px) saturate(${1 + (1 - p) * 0.3})` };
    default:
      return null;
  }
}

export function cameraStyle(camera: Camera | undefined, frame: number, durationInFrames: number, width: number, height: number, fps: number): CSSProperties | undefined {
  if (!camera || camera.type === "static") return undefined;
  const amount = camera.amount ?? 0.04;
  const t = ease("smooth", frame / Math.max(1, durationInFrames));
  const sec = frame / fps;
  switch (camera.type) {
    case "pushIn":
      return { transform: `scale(${1 + amount * t})` };
    case "pullOut":
      return { transform: `scale(${1 + amount * (1 - t)})` };
    case "panLeft":
      return { transform: `scale(${1 + amount}) translateX(${(0.5 - t) * amount * width}px)` };
    case "panRight":
      return { transform: `scale(${1 + amount}) translateX(${(t - 0.5) * amount * width}px)` };
    case "panUp":
      return { transform: `scale(${1 + amount}) translateY(${(0.5 - t) * amount * height}px)` };
    case "panDown":
      return { transform: `scale(${1 + amount}) translateY(${(t - 0.5) * amount * height}px)` };
    case "drift":
      return { transform: `scale(${1 + amount * 0.6}) translate(${Math.sin(sec / 5) * amount * width * 0.12}px, ${Math.cos(sec / 7) * amount * height * 0.12}px)` };
    default:
      return undefined;
  }
}
