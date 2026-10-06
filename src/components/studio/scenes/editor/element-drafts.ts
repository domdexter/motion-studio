"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { validateSceneSpec, type SceneElement } from "@/core/spec/scene";
import { findElementAt, type ElementRef } from "@/core/timeline/element-layout";

/**
 * Element edits in flight — a canvas drag, a scrubbed field, or an inspector change that is still
 * saving — shown right away in the preview and the inspector. The saved scene spec stays the only
 * source of truth: every draft remembers the saved element it was made from and stops applying as
 * soon as that saved element changes (the edit landed, was undone, or someone else changed it).
 * Components subscribe here directly, so a drag re-renders the preview and its fields, not the page.
 */

export interface ElementDraft {
  sceneId: string;
  ref: ElementRef;
  element: SceneElement;
  /** JSON of the saved element the draft was made from. */
  base: string;
  token: number;
}

/** `${sceneId}:${shotId}:${index}` — the same key as the scene media lane. */
export const elementKey = (sceneId: string, ref: ElementRef) => `${sceneId}:${ref.shotId ?? ""}:${ref.index}${ref.child === undefined ? "" : `:${ref.child}`}`;

let drafts: ReadonlyMap<string, ElementDraft> = new Map();
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const elementDrafts = {
  /** Shows `element` in place of the saved element `base`. Returns a token that clears exactly this draft. */
  set(sceneId: string, ref: ElementRef, element: SceneElement, base: SceneElement): number {
    const token = ++counter;
    const next = new Map(drafts);
    next.set(elementKey(sceneId, ref), { sceneId, ref, element, base: JSON.stringify(base), token });
    drafts = next;
    emit();
    return token;
  },
  /** Removes the draft (only if it is still the one `token` created, when given). */
  clear(sceneId: string, ref: ElementRef, token?: number) {
    const key = elementKey(sceneId, ref);
    const draft = drafts.get(key);
    if (!draft || (token !== undefined && draft.token !== token)) return;
    const next = new Map(drafts);
    next.delete(key);
    drafts = next;
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => drafts,
};

const EMPTY: ReadonlyMap<string, ElementDraft> = new Map();

export function useElementDrafts(): ReadonlyMap<string, ElementDraft> {
  return useSyncExternalStore(elementDrafts.subscribe, elementDrafts.snapshot, () => EMPTY);
}

/** The in-flight version of one element, or null when it has none (or its saved element has changed since). */
export function useElementDraft(sceneId: string | null, ref: ElementRef | null, saved: SceneElement | null): SceneElement | null {
  const key = sceneId && ref ? elementKey(sceneId, ref) : null;
  const savedJson = useMemo(() => (saved ? JSON.stringify(saved) : null), [saved]);
  const draft = useSyncExternalStore(
    elementDrafts.subscribe,
    () => (key ? (drafts.get(key) ?? null) : null),
    () => null,
  );
  return draft && draft.base === savedJson ? draft.element : null;
}

/** Drops drafts whose saved element changed or is gone. Call it wherever scenes load and elements are edited. */
export function useSettleElementDrafts(scenes: readonly { id: string; spec: unknown }[] | undefined) {
  useEffect(() => {
    if (!scenes) return;
    for (const draft of [...drafts.values()]) {
      const scene = scenes.find((s) => s.id === draft.sceneId);
      const valid = scene ? validateSceneSpec(scene.spec) : null;
      const saved = valid?.ok ? findElementAt(valid.spec, draft.ref) : null;
      if (!saved || JSON.stringify(saved) !== draft.base) elementDrafts.clear(draft.sceneId, draft.ref, draft.token);
    }
  }, [scenes]);
}
