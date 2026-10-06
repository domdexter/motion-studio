import { createContext, useContext } from "react";
import { densityScale, type MotionScale } from "../../core/creative/grammar";
import type { CompositionAsset, CompositionScene, StudioVideoProps } from "../../core/spec/composition";
import type { DesignSystem } from "../../core/spec/design";
import type { Trigger } from "../../core/spec/scene";
import type { TimedWord } from "../../core/spec/timing";
import { resolveTrigger, wordsInScene, wordsInSegment, type ShotWindow, type TriggerContext } from "../../core/spec/triggers";
import { secondsToFrames } from "../../core/timing/frames";

/**
 * Everything an element renderer needs about its scene. All timing goes through frameAt(), which
 * resolves triggers (word, phrase, time, sceneTime…) on the master timeline and converts to
 * scene-relative frames — so word-synced animations land on the exact spoken frame. Inside a shot
 * the context is narrowed: default timing and shot triggers refer to the shot's segment.
 */
export interface SceneContextValue {
  fps: number;
  width: number;
  height: number;
  portrait: boolean;
  /** Design units → pixels (1u = min(width,height)/1080 px). */
  u: (n: number) => number;
  design: DesignSystem;
  brand: StudioVideoProps["brand"];
  assets: Record<string, CompositionAsset>;
  words: TimedWord[];
  sceneWords: TimedWord[];
  /** Words spoken in the current segment: the scene, or the shot being rendered. Voice-synced text matches against these. */
  segmentWords: TimedWord[];
  scene: CompositionScene;
  index: number;
  total: number;
  /** Absolute frame where this scene starts. */
  startFrame: number;
  /** Frames from scene start to scene end (excludes the transition overlap). */
  durationInFrames: number;
  /** Scene-relative frames of the current segment: the shot being rendered, or the whole scene. */
  segmentStartFrame: number;
  segmentEndFrame: number;
  /** Shot being rendered (null for scene-level elements). */
  shotId: string | null;
  /** Trigger timing of the segment being rendered: the scene, narrowed to the shot (when elements appear, for their keyframe clocks). */
  triggers: TriggerContext;
  /** Travel/overshoot multiplier: design intensity × scene motion density. */
  intensity: number;
  /** The design system's intensity alone. */
  designIntensity: number;
  /** Scene motion density scale (spec.motion.density). */
  motionScale: MotionScale;
  /** Seconds → frames. */
  frames: (seconds: number) => number;
  /** Trigger → scene-relative frame. */
  frameAt: (trigger: Trigger | undefined, fallback?: "sceneStart" | "sceneEnd", delaySec?: number) => number;
  /** Scene-relative frame of a spoken word (by index in the transcript). */
  frameOfWord: (wordIndex: number, edge?: "start" | "end") => number;
  preview: boolean;
  /** Editor preview: images and videos inside scenes are hidden (the Scene media lane is switched off). */
  hideMedia: boolean;
}

export const SceneContext = createContext<SceneContextValue | null>(null);

export function useScene(): SceneContextValue {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useScene must be used inside a scene");
  return ctx;
}

const INTENSITY = { subtle: 0.65, standard: 1, energetic: 1.35 } as const;

function frameResolver(triggerCtx: TriggerContext, fps: number, startFrame: number): SceneContextValue["frameAt"] {
  return (trigger, fallback = "sceneStart", delaySec = 0) => {
    const r = resolveTrigger(trigger, triggerCtx, fallback);
    return secondsToFrames(r.time + delaySec, fps) - startFrame;
  };
}

export function buildSceneContext(input: { props: StudioVideoProps; scene: CompositionScene; index: number; fps: number; width: number; height: number; preview: boolean }): SceneContextValue {
  const { props, scene, index, fps, width, height } = input;
  const unit = Math.min(width, height) / 1080;
  const startFrame = secondsToFrames(scene.start, fps);
  const endFrame = secondsToFrames(scene.end, fps);
  const durationInFrames = Math.max(1, endFrame - startFrame);
  const motionScale = densityScale(scene.spec.motion?.density);
  const designIntensity = INTENSITY[props.design.motion.intensity] ?? 1;
  const sceneWords = wordsInScene(props.words, scene.start, scene.end);
  const triggers: TriggerContext = { words: props.words, sceneStart: scene.start, sceneEnd: scene.end };
  return {
    fps,
    width,
    height,
    portrait: height > width,
    u: (n: number) => n * unit,
    design: props.design,
    brand: props.brand,
    assets: props.assets,
    words: props.words,
    sceneWords,
    segmentWords: sceneWords,
    scene,
    index,
    total: props.scenes.length,
    startFrame,
    durationInFrames,
    segmentStartFrame: 0,
    segmentEndFrame: durationInFrames,
    shotId: null,
    triggers,
    intensity: designIntensity * motionScale.distance,
    designIntensity,
    motionScale,
    frames: (seconds: number) => Math.round(seconds * fps),
    frameAt: frameResolver(triggers, fps, startFrame),
    frameOfWord: (wordIndex, edge = "start") => {
      const w = props.words[wordIndex];
      if (!w) return 0;
      return secondsToFrames(edge === "end" ? w.end : w.start, fps) - startFrame;
    },
    preview: input.preview,
    hideMedia: !!props.preview?.hideSceneMedia,
  };
}

/** Narrows a scene context to one shot: default timing and shot triggers refer to the shot. */
export function shotContext(ctx: SceneContextValue, shot: Pick<ShotWindow, "id" | "start" | "end">): SceneContextValue {
  const triggerCtx: TriggerContext = { words: ctx.words, sceneStart: ctx.scene.start, sceneEnd: ctx.scene.end, shotStart: shot.start, shotEnd: shot.end };
  return {
    ...ctx,
    segmentWords: wordsInSegment(ctx.words, triggerCtx),
    shotId: shot.id,
    triggers: triggerCtx,
    segmentStartFrame: secondsToFrames(shot.start, ctx.fps) - ctx.startFrame,
    segmentEndFrame: secondsToFrames(shot.end, ctx.fps) - ctx.startFrame,
    frameAt: frameResolver(triggerCtx, ctx.fps, ctx.startFrame),
  };
}
