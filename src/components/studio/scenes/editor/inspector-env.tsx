"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { CompositionAsset } from "@/core/spec/composition";
import type { DesignSystem } from "@/core/spec/design";
import type { Segment, TimedWord } from "@/core/spec/timing";
import type { BoxPx, ElementRef, FrameSize } from "@/core/timeline/element-layout";

/**
 * What the inspector's sections need to know about the editor around them: the project's design
 * system (colour tokens, fonts, defaults), its assets, the frame, the playhead and where an element is
 * drawn right now. Read-only context — edits still go through the element services.
 */
export interface InspectorEnv {
  design: DesignSystem | null;
  frame: FrameSize;
  assets: Record<string, CompositionAsset>;
  /** Uploaded brand font families (the renderer loads them, like the curated fonts). */
  fonts: string[];
  words: TimedWord[];
  /** Frames per second of the video: a keyframe within half a frame of the playhead is at it. */
  fps?: number;
  getTime: () => number;
  seek: (timeSec: number) => void;
  /** The element's layout box in video pixels, or null when it isn't on screen at the playhead. */
  measure: (sceneId: string, ref: ElementRef) => BoxPx | null;
  /** The playhead as a store, for the few fields that follow it live (see `usePlayheadTime`). */
  playhead?: PlayheadSource;
  /** Sentences of the voice-over (context around a selected word). */
  sentences?: Segment[];
  /** Asks the timeline for a word: the next word clicked there is passed to `onPick` (its transcript index); Esc cancels. */
  pickWord?: (label: string, onPick: (index: number) => void) => void;
}

/** The playhead's time, subscribed to without re-rendering the whole inspector on every frame. */
export interface PlayheadSource {
  subscribe: (listener: () => void) => () => void;
  get: () => number;
}

const InspectorEnvContext = createContext<InspectorEnv | null>(null);

export const InspectorEnvProvider = InspectorEnvContext.Provider;

/** The inspector environment, or null outside the scene editor (sections fall back to plain values). */
export function useInspectorEnv(): InspectorEnv | null {
  return useContext(InspectorEnvContext);
}

const NO_PLAYHEAD: PlayheadSource = { subscribe: () => () => undefined, get: () => 0 };

/** Seconds at the playhead, following playback and seeks (0 without a playhead). Only the component calling it re-renders. */
export function usePlayheadTime(): number {
  const source = useInspectorEnv()?.playhead ?? NO_PLAYHEAD;
  return useSyncExternalStore(source.subscribe, source.get, () => 0);
}
