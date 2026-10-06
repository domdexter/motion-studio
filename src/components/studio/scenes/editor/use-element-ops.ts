"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { elementAtTime, isAnimated, keyframedPatch } from "@/core/motion/keyframes";
import type { SceneElement } from "@/core/spec/scene";
import type { ElementRef, FrameSize } from "@/core/timeline/element-layout";
import type { ArrangeAction } from "@/core/timeline/element-ops";
import { isSceneMedia } from "@/core/timeline/media-clip";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import type { SceneElementPatch, SceneElementsOperation } from "@/server/services/scene-elements";
import { elementDrafts, elementKey } from "./element-drafts";
import { layoutWithPatch } from "./use-element-edits";

/**
 * Edits of several elements at once through the scene element service — one scene version and one
 * undo step each: moving them together (a drag, align, distribute, arrow-key nudges), delete,
 * duplicate and layer order. Moves show at once as element drafts until the refreshed scene arrives,
 * like single-element edits. Moving an element whose position is keyframed sets its x/y keyframes at
 * the playhead instead of its saved position.
 */

export interface ElementTarget {
  sceneId: string;
  ref: ElementRef;
  /** The saved element (the service checks it is still there). */
  saved: SceneElement;
  /** Seconds after it appears, at the playhead (null or missing: unknown) — moves of keyframed positions key there. */
  localSec?: number | null;
  /** How close to the playhead a keyframe is updated rather than joined by a new one (half a frame). */
  keyTolerance?: number;
}

/** The element where it shows at the playhead: its keyframed properties resolved when the target knows the playhead. */
export function liveElement(target: Pick<ElementTarget, "localSec">, shown: SceneElement): SceneElement {
  return target.localSec !== null && target.localSec !== undefined ? elementAtTime(shown, target.localSec) : shown;
}

/** True when moving the element sets keyframes (its x or y is keyframed and the playhead is known). */
const keysPosition = (target: Pick<ElementTarget, "localSec">, shown: SceneElement) => target.localSec !== null && target.localSec !== undefined && (isAnimated(shown, "x") || isAnimated(shown, "y"));

/** The element moved to x/y, as it shows while the move saves. */
function movedElement(target: Pick<ElementTarget, "localSec" | "keyTolerance">, shown: SceneElement, position: { x: number; y: number }): SceneElement {
  return keysPosition(target, shown) ? layoutWithPatch(shown, keyframedPatch(shown, position, target.localSec ?? 0, target.keyTolerance), {}) : ({ ...shown, ...position } as SceneElement);
}

export interface ElementMove extends ElementTarget {
  /** The element as shown when the move started (its draft, or the saved element). */
  shown: SceneElement;
  x: number;
  y: number;
}

export type MoveGesture = "drag" | "nudge" | "align" | "distribute";
export type ElementOperation = { op: "remove" } | { op: "duplicate"; offsetPx?: number } | { op: "arrange"; action: ArrangeAction } | { op: "group"; name?: string } | { op: "ungroup" };

export interface ElementPatchItem extends ElementTarget {
  patch: SceneElementPatch;
  /** The element as it will show while the edit saves. */
  preview: SceneElement;
}

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });
const position = (n: number) => Math.max(-100, Math.min(200, Math.round(n * 100) / 100));
const itemOf = (t: ElementTarget) => ({ ref: t.ref, type: t.saved.type, ...(isSceneMedia(t.saved) ? { assetId: t.saved.assetId } : {}) });

/** The element as shown right now: its draft when one applies, else the saved element. */
export function shownElement(target: ElementTarget): SceneElement {
  const draft = elementDrafts.snapshot().get(elementKey(target.sceneId, target.ref));
  return draft && draft.base === JSON.stringify(target.saved) ? draft.element : target.saved;
}

/** x/y after moving an element by video pixels (the anchor moves with the box). */
export function shiftedPosition(element: SceneElement, dxPx: number, dyPx: number, frame: FrameSize): { x: number; y: number } {
  return { x: position((element.x ?? 50) + (dxPx / frame.width) * 100), y: position((element.y ?? 50) + (dyPx / frame.height) * 100) };
}

interface NudgeBurst {
  key: string;
  frame: FrameSize;
  items: { target: ElementTarget; start: SceneElement }[];
  dx: number;
  dy: number;
  timer: number;
}

/** Arrow-key presses this close together save as one move. */
const NUDGE_SAVE_MS = 450;

export function useElementOps(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ["project", projectId] }), [queryClient, projectId]);
  const mutation = useMutation({
    mutationFn: ({ sceneId, body }: { sceneId: string; body: SceneElementsOperation }) => http.post<{ refs: ElementRef[] }>(`/api/projects/${projectId}/scenes/${sceneId}/elements`, body),
    onError: fail,
  });
  const { mutateAsync } = mutation;

  /** Property edits of several elements (a group edit, pasted properties) as one undo step, shown at once. `gesture`: a move of keyframed positions (nudges merge into one step). */
  const patch = useCallback(
    (items: ElementPatchItem[], gesture?: MoveGesture) => {
      if (!items.length) return;
      const tokens = items.map((i) => elementDrafts.set(i.sceneId, i.ref, i.preview, i.saved));
      void mutateAsync({ sceneId: items[0].sceneId, body: { op: "patch", items: items.map((i) => ({ ...itemOf(i), patch: i.patch })), ...(gesture ? { gesture } : {}) } })
        .catch(() => undefined)
        .then(refresh)
        .finally(() => items.forEach((i, k) => elementDrafts.clear(i.sceneId, i.ref, tokens[k])));
    },
    [mutateAsync, refresh],
  );

  /** Saves new positions, showing the elements there until the project has refreshed. Keyframed positions get keyframes at the playhead (one patch, one undo step). */
  const move = useCallback(
    (moves: ElementMove[], gesture: MoveGesture) => {
      if (!moves.length) return;
      if (moves.some((m) => keysPosition(m, m.shown))) {
        patch(
          moves.map((m) => {
            const change = keysPosition(m, m.shown) ? keyframedPatch(m.shown, { x: m.x, y: m.y }, m.localSec ?? 0, m.keyTolerance) : { x: m.x, y: m.y };
            return { ...m, patch: change, preview: layoutWithPatch(m.shown, change, {}) };
          }),
          gesture,
        );
        return;
      }
      const tokens = moves.map((m) => elementDrafts.set(m.sceneId, m.ref, { ...m.shown, x: m.x, y: m.y } as SceneElement, m.saved));
      void mutateAsync({ sceneId: moves[0].sceneId, body: { op: "move", gesture, items: moves.map((m) => ({ ...itemOf(m), x: m.x, y: m.y })) } })
        .catch(() => undefined)
        .then(refresh)
        .finally(() => moves.forEach((m, i) => elementDrafts.clear(m.sceneId, m.ref, tokens[i])));
    },
    [mutateAsync, refresh, patch],
  );

  /** Delete, duplicate or layer order; resolves with where the elements are afterwards (the copies for a duplicate), or null when it failed. */
  const operate = useCallback(
    async (targets: ElementTarget[], operation: ElementOperation): Promise<ElementRef[] | null> => {
      if (!targets.length) return null;
      try {
        const { refs } = await mutateAsync({ sceneId: targets[0].sceneId, body: { ...operation, items: targets.map(itemOf) } as SceneElementsOperation });
        await refresh();
        return refs;
      } catch {
        await refresh();
        return null;
      }
    },
    [mutateAsync, refresh],
  );

  const burst = useRef<NudgeBurst | null>(null);
  const flushNudge = useCallback(() => {
    const b = burst.current;
    if (!b) return;
    burst.current = null;
    window.clearTimeout(b.timer);
    move(
      b.items.map(({ target, start }) => ({ ...target, shown: start, ...shiftedPosition(liveElement(target, start), b.dx, b.dy, b.frame) })),
      "nudge",
    );
  }, [move]);

  /** Moves elements by video pixels at once; the move saves after the key presses stop. */
  const nudge = useCallback(
    (targets: ElementTarget[], dxPx: number, dyPx: number, frame: FrameSize) => {
      if (!targets.length) return;
      const key = targets
        .map((t) => elementKey(t.sceneId, t.ref))
        .sort()
        .join("|");
      if (burst.current && burst.current.key !== key) flushNudge();
      const b = burst.current ?? (burst.current = { key, frame, items: targets.map((target) => ({ target, start: shownElement(target) })), dx: 0, dy: 0, timer: 0 });
      b.dx += dxPx;
      b.dy += dyPx;
      for (const { target, start } of b.items) elementDrafts.set(target.sceneId, target.ref, movedElement(target, start, shiftedPosition(liveElement(target, start), b.dx, b.dy, b.frame)), target.saved);
      window.clearTimeout(b.timer);
      b.timer = window.setTimeout(flushNudge, NUDGE_SAVE_MS);
    },
    [flushNudge],
  );
  useEffect(() => () => flushNudge(), [flushNudge]);

  return { move, patch, operate, nudge, flushNudge, pending: mutation.isPending };
}
