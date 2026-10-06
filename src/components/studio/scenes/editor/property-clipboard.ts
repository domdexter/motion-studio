"use client";

import { useSyncExternalStore } from "react";
import { isAnimated, patchValueOf, retimeKeyframes, withNewKeyframeIds } from "@/core/motion/keyframes";
import { KEYFRAME_PROPERTIES, animatableProperty, keyframePropertiesFor } from "@/core/spec/animatable";
import { APPEARANCE_PROPS, STYLE_SUPPORT, entrancesFor } from "@/core/spec/element-properties";
import type { ElementType, SceneElement, Trigger } from "@/core/spec/scene";
import type { TriggerContext } from "@/core/spec/triggers";
import { elementSpan, retimeTrigger } from "@/core/timeline/scene-restructure";
import type { SceneElementPatch } from "@/server/services/scene-elements";

/**
 * Copy and paste of an element's transform, appearance, animation, timing or keyframes onto other
 * elements. One copied element per group, kept for this editor session. Pasting builds a normal element
 * patch, filtered to what the target's renderer reads, so it saves (and undoes) like any other edit.
 * Content is never pasted, and cues only come with timing: the entrance and exit cues and the emphasis
 * moments, kept on the same spoken words in the same scene, and at the same seconds into the scene
 * anywhere else. Keyframes replace the target's with new ids at the same times after it appears; saved
 * transform and appearance values skip the properties the target animates (they wouldn't show).
 */

export type PropertyGroup = "transform" | "appearance" | "animation" | "timing" | "keyframes";
export const PROPERTY_GROUPS: PropertyGroup[] = ["transform", "appearance", "animation", "timing", "keyframes"];

export interface PropertyClip {
  group: PropertyGroup;
  type: ElementType;
  /** The element's name, for menu labels. */
  name: string;
  element: SceneElement;
  /** Where the copied element's cues resolve (its scene, narrowed to its shot) — timing keeps their moments. */
  segment?: TriggerContext;
}

let clips: Partial<Record<PropertyGroup, PropertyClip>> = {};
const listeners = new Set<() => void>();

export function copyProperties(group: PropertyGroup, element: SceneElement, name: string, segment?: TriggerContext) {
  clips = { ...clips, [group]: { group, type: element.type, name, element: JSON.parse(JSON.stringify(element)) as SceneElement, segment } };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function usePropertyClip(group: PropertyGroup): PropertyClip | null {
  return useSyncExternalStore(
    subscribe,
    () => clips[group] ?? null,
    () => null,
  );
}

export function propertyClip(group: PropertyGroup): PropertyClip | null {
  return clips[group] ?? null;
}

const NO_CLIPS: Partial<Record<PropertyGroup, PropertyClip>> = {};

/** Everything copied, by group. */
export function usePropertyClips(): Partial<Record<PropertyGroup, PropertyClip>> {
  return useSyncExternalStore(
    subscribe,
    () => clips,
    () => NO_CLIPS,
  );
}

/** Lines and cursors are placed by their points, so they have no transform to copy or paste. */
const UNPLACED = new Set<ElementType>(["line", "cursor"]);

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The copied element's cues for another element (see the module comment); without both timings they are pasted as written. */
function timingPatch(clip: PropertyClip, to: TriggerContext | undefined): SceneElementPatch {
  const source = clip.element;
  const from = clip.segment;
  const move = (trigger: Trigger, fallback: "sceneStart" | "sceneEnd"): Trigger => (from && to ? (retimeTrigger(trigger, fallback, { from, to, shift: to.sceneStart - from.sceneStart }).trigger ?? trigger) : trigger);
  const enter = source.enter && source.enter.type !== "none" ? source.enter : undefined;
  // An entrance delay is part of when it appears, so it travels as the cue's offset.
  const enterAt = enter?.at ? (enter.delay ? ({ ...enter.at, offset: r3((enter.at.offset ?? 0) + enter.delay) } as Trigger) : enter.at) : undefined;
  const exitAt = source.exit && source.exit.type !== "none" ? source.exit.at : undefined;
  return {
    cues: { enter: enterAt ? move(enterAt, "sceneStart") : null, exit: exitAt ? move(exitAt, "sceneEnd") : null },
    emphasis: source.emphasis?.length ? source.emphasis.map((e) => ({ ...e, at: move(e.at, "sceneStart") })) : null,
  };
}

/** The copied keyframes for another element: the properties it can animate, with new ids, folded into its time on screen when its timing is known. */
function keyframesPatch(clip: PropertyClip, target: SceneElement, to: TriggerContext | undefined): SceneElementPatch | null {
  const supported = keyframePropertiesFor(target.type);
  const list = (clip.element.keyframes ?? []).filter((k) => supported.includes(k.property));
  if (!list.length) return null;
  const fresh = withNewKeyframeIds(list, new Set(target.keyframes?.map((k) => k.id)));
  if (!to) return { keyframes: fresh };
  const span = elementSpan(target, to);
  return { keyframes: retimeKeyframes(fresh, 0, span.gone - span.appear).keyframes };
}

/** Leaves out saved values of properties the target animates (each in the element field the registry names). */
function withoutAnimated(patch: SceneElementPatch, target: SceneElement): SceneElementPatch {
  for (const property of KEYFRAME_PROPERTIES) {
    if (patchValueOf(patch, property) === undefined || !isAnimated(target, property)) continue;
    const { patchIn, field } = animatableProperty(property);
    const key = field.includes(".") ? field.slice(field.indexOf(".") + 1) : field;
    const group = patchIn === "element" ? (patch as Record<string, unknown>) : ((patch as Record<string, unknown>)[patchIn] as Record<string, unknown> | undefined);
    if (group) delete group[key];
  }
  return patch;
}

/** The patch that gives `target` the copied properties, or null when they don't apply to it. `targetSegment`: its scene (and shot) timing, for timing and keyframes. */
export function pastePatch(clip: PropertyClip, target: SceneElement, targetSegment?: TriggerContext): SceneElementPatch | null {
  const source = clip.element;
  if (clip.group === "timing") return timingPatch(clip, targetSegment);
  if (clip.group === "keyframes") return keyframesPatch(clip, target, targetSegment);
  if (clip.group === "transform") {
    if (UNPLACED.has(target.type) || UNPLACED.has(source.type)) return null;
    return withoutAnimated(
      {
        x: source.x ?? null,
        y: source.y ?? null,
        width: source.width ?? null,
        height: source.height ?? null,
        anchor: source.anchor ?? null,
        rotation: source.rotation ?? null,
        scale: source.scale ?? null,
        scaleX: source.scaleX ?? null,
        scaleY: source.scaleY ?? null,
        pivot: source.pivot ?? null,
        rotateX: source.rotateX ?? null,
        rotateY: source.rotateY ?? null,
        depth: source.depth ?? null,
      },
      target,
    );
  }
  if (clip.group === "appearance") {
    const styleKeys = STYLE_SUPPORT[target.type];
    const same = source.type === target.type;
    // Look fields of another type only carry over when they mean the same thing (a colour).
    const propKeys = (APPEARANCE_PROPS[target.type] ?? []).filter((key) => same || (key === "color" && (APPEARANCE_PROPS[source.type] ?? []).includes("color")));
    return withoutAnimated(
      {
        opacity: source.opacity ?? null,
        ...(styleKeys.length ? { style: Object.fromEntries(styleKeys.map((key) => [key, source.style?.[key] ?? null])) } : {}),
        ...(propKeys.length ? { props: Object.fromEntries(propKeys.map((key) => [key, (source as Record<string, unknown>)[key] ?? null])) } : {}),
      },
      target,
    );
  }
  const patch: SceneElementPatch = { idle: source.idle ?? null };
  const enter = source.enter;
  if (enter && enter.type !== "none" && entrancesFor(target.type).includes(enter.type)) {
    patch.enter = { type: enter.type, duration: enter.duration ?? null, easing: enter.easing ?? null, stagger: enter.stagger ?? null, distance: enter.distance ?? null };
  }
  const exit = source.exit;
  if (exit && exit.type !== "none" && exit.type !== "converge") patch.exit = { type: exit.type, ...(exit.duration ? { duration: exit.duration } : {}), easing: exit.easing ?? null, distance: exit.distance ?? null };
  return patch;
}
