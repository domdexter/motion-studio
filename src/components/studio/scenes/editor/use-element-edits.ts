"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import type { SceneElement } from "@/core/spec/scene";
import type { ElementRef } from "@/core/timeline/element-layout";
import type { SceneMediaElement } from "@/core/timeline/media-clip";
import { applyElementPatch, type ElementPatchContext } from "@/core/timeline/spec-patch";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import type { SceneElementPatch } from "@/server/services/scene-elements";
import type { SceneMediaPatch } from "@/server/services/scene-media";
import { elementDrafts } from "./element-drafts";

/**
 * Saving element edits from the canvas, the inspector and the timeline. Layout and motion go through
 * the scene element service, media settings through the scene media service — both edit the same
 * scene spec. Each save shows the element as it will be (an element draft) until the refreshed scene
 * arrives, so the preview and the inspector never jump back.
 */

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });
const isMedia = (element: SceneElement): element is SceneMediaElement => element.type === "image" || element.type === "video";

/** The media element as it will be once a media patch is saved (for the preview while it saves). */
export function mediaWithPatch(element: SceneMediaElement, patch: SceneMediaPatch): SceneMediaElement {
  const next: Record<string, unknown> = { ...element };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "dim") next.overlay = typeof value === "number" && value > 0 ? { color: element.overlay?.color ?? "#000000", opacity: value } : undefined;
    else if (key === "endAt" || key === "crop") next[key] = value ?? undefined;
    else if (key === "appearAt" || key === "disappearAt") continue; // Timing is resolved by the server (triggers).
    else next[key] = value;
  }
  return next as SceneMediaElement;
}

/**
 * The element as it will be once a patch is saved — the same function the server applies (placement
 * presets need the frame and the media's aspect, retiming the scene's length). A patch the server
 * would refuse shows nothing new.
 */
export function layoutWithPatch(element: SceneElement, patch: SceneElementPatch, context: ElementPatchContext): SceneElement {
  try {
    return applyElementPatch(element, patch, context);
  } catch {
    return element;
  }
}

export function useElementEdits(projectId: string) {
  const queryClient = useQueryClient();
  const layout = useMutation({
    mutationFn: (v: { sceneId: string; ref: ElementRef; element: SceneElement; patch: SceneElementPatch }) =>
      http.patch(`/api/projects/${projectId}/scenes/${v.sceneId}/elements`, { ref: v.ref, type: v.element.type, ...(isMedia(v.element) ? { assetId: v.element.assetId } : {}), patch: v.patch }),
    onError: fail,
  });
  const media = useMutation({
    mutationFn: (v: { sceneId: string; ref: ElementRef; element: SceneMediaElement; patch: SceneMediaPatch }) => http.patch(`/api/projects/${projectId}/scenes/${v.sceneId}/media`, { ref: v.ref, assetId: v.element.assetId, patch: v.patch }),
    onError: fail,
  });

  /** Runs a save with `preview` shown in place of the saved element `base` until the project has refreshed. */
  const withDraft = useCallback(
    (sceneId: string, ref: ElementRef, base: SceneElement, preview: SceneElement | null, save: () => Promise<unknown>) => {
      const token = preview ? elementDrafts.set(sceneId, ref, preview, base) : undefined;
      void save()
        .catch(() => undefined)
        .then(() => queryClient.invalidateQueries({ queryKey: ["project", projectId] }))
        .finally(() => {
          if (token !== undefined) elementDrafts.clear(sceneId, ref, token);
        });
    },
    [queryClient, projectId],
  );

  const { mutateAsync: saveLayout } = layout;
  const { mutateAsync: saveMedia } = media;

  /** Position, size, rotation, opacity, layer, entrance/exit or placement of any element. */
  const commitLayout = useCallback(
    (sceneId: string, ref: ElementRef, element: SceneElement, patch: SceneElementPatch, preview: SceneElement | null) => withDraft(sceneId, ref, element, preview, () => saveLayout({ sceneId, ref, element, patch })),
    [withDraft, saveLayout],
  );
  /** Fit, darken, trim, speed, audio, timing, zooms or picture edits of an image or video. */
  const commitMedia = useCallback(
    (sceneId: string, ref: ElementRef, element: SceneMediaElement, patch: SceneMediaPatch) => withDraft(sceneId, ref, element, mediaWithPatch(element, patch), () => saveMedia({ sceneId, ref, element, patch })),
    [withDraft, saveMedia],
  );

  return { commitLayout, commitMedia, saving: layout.isPending || media.isPending };
}
