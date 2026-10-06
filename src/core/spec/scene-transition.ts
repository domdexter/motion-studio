import type { DesignSystem } from "./design";
import type { Transition } from "./scene";

/**
 * How scenes and shots enter. Shared by the Remotion engine and the editor's timeline, so the
 * transition drawn on the timeline is the one that renders.
 */

/** Effective transition for a scene (first scene never transitions in). */
export function effectiveTransition(spec: { transitionIn?: Transition }, design: DesignSystem, index: number): Transition | null {
  if (index === 0) return null;
  const t = spec.transitionIn ?? design.transition;
  if (!t || t.type === "none" || t.type === "cut") return null;
  return { ...t, duration: t.duration ?? design.motion.transitionDuration };
}

/** Effective transition into a shot. Shots cut by default — a shot transition must be asked for. */
export function shotTransition(shot: { transitionIn?: Transition }, design: DesignSystem): Transition | null {
  const t = shot.transitionIn;
  if (!t || t.type === "none" || t.type === "cut") return null;
  return { ...t, duration: t.duration ?? design.motion.transitionDuration };
}
