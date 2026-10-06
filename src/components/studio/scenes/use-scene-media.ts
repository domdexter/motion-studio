"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { validateSceneSpec } from "@/core/spec/scene";
import type { TimedWord } from "@/core/spec/timing";
import { listSceneMedia, sceneMediaKey, sceneVideoTiming, type SceneMediaRef } from "@/core/timeline/media-clip";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import type { SceneMediaPatch } from "@/server/services/scene-media";
import type { SceneDto } from "@/server/services/scenes";
import type { SceneMediaLaneEntry } from "../timeline/scene-media-track-editor";

export interface SceneMediaUpdate {
  sceneId: string;
  ref: SceneMediaRef;
  /** The asset the element shows, so an edit never lands on an element that changed underneath. */
  assetId: string;
  patch: SceneMediaPatch;
}

/** Saves an edit to an image or video inside a scene (a new scene version) and refreshes the project. */
export function useSceneMediaUpdate(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sceneId, ref, assetId, patch }: SceneMediaUpdate) => http.patch(`/api/projects/${projectId}/scenes/${sceneId}/media`, { ref, assetId, patch }),
    onError: (e) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
  });
}

/** The images and videos of every saved scene spec as scene media lane entries. */
export function buildSceneMediaEntries(scenes: SceneDto[], words: TimedWord[], assets: Record<string, { name: string; durationSec: number | null }> | undefined): SceneMediaLaneEntry[] {
  return scenes.flatMap((s) => {
    const v = validateSceneSpec(s.spec);
    if (!v.ok) return [];
    return listSceneMedia(v.spec, { words, sceneStart: s.startSec, sceneEnd: s.endSec }).map((item) => {
      const asset = assets?.[item.element.assetId];
      const timing = sceneVideoTiming(item.element, asset?.durationSec ?? null);
      return {
        key: sceneMediaKey(s.id, item.ref),
        sceneId: s.id,
        sceneKey: s.key,
        sceneStartSec: s.startSec,
        locked: s.locked,
        item,
        name: asset?.name ?? item.element.id ?? item.element.type,
        trimmedLengthSec: timing.trimmedLengthSec,
        endBehavior: timing.endBehavior,
        playbackRate: timing.playbackRate,
        trimStartSec: timing.trimStartSec,
      };
    });
  });
}

/** The patch for a timeline move or trim: only the edges that moved are saved, so a right-edge trim keeps a voice-synced entrance. */
export function sceneMediaTimingPatch(entry: SceneMediaLaneEntry, timing: { appearSec: number; goneSec: number; trimStartSec: number }): SceneMediaPatch {
  const { item } = entry;
  const appearMoved = Math.abs(timing.appearSec - item.appearSec) > 0.0005;
  const goneMoved = Math.abs(timing.goneSec - item.goneSec) > 0.0005;
  return {
    ...(appearMoved ? { appearAt: Math.max(0, timing.appearSec - entry.sceneStartSec) } : {}),
    ...(goneMoved ? { disappearAt: timing.goneSec >= item.segmentEndSec - 0.02 ? null : timing.goneSec - entry.sceneStartSec } : {}),
    ...(item.element.type === "video" && Math.abs(timing.trimStartSec - entry.trimStartSec) > 0.0005 ? { startFrom: timing.trimStartSec } : {}),
  };
}
