import type { CueId } from "@/core/spec/triggers";
import { refKey, sameRef } from "@/core/timeline/element-ops";
import type { ElementRef } from "@/core/timeline/element-layout";

/**
 * What the editor has selected — one model for the scene editor's canvas, layers, inspector and
 * timeline, and for the Timeline page. The current scene itself lives in the URL; `scene` marks it as
 * picked (on the timeline). Several elements can be selected together, but only within one scene and
 * never mixed with overlays, audio clips, voice-over cuts or markers. Images and videos are elements:
 * the inspector tells them apart.
 */
export type EditorSelection =
  /** `focus`: the part of the scene picked on the timeline (its transition in). */
  | { kind: "scene"; sceneId: string; focus?: "transition" }
  /**
   * `cue`: one cue of the single selected element — a diamond on its timeline bar, a row in its inspector.
   * `keyframe`: one keyframe of the single selected element, by id — a marker on its keyframe row, a key in its inspector.
   */
  | { kind: "elements"; sceneId: string; refs: ElementRef[]; cue?: CueId; keyframe?: string }
  | { kind: "overlay"; id: string }
  | { kind: "audio"; id: string }
  /** A muted section of the voice-over (cuts have no ids; they are kept sorted). */
  | { kind: "voiceCut"; index: number }
  /** A project marker (beat, note, music or sound cue). */
  | { kind: "marker"; id: string }
  /**
   * Spoken words picked on the timeline — `first`…`last` are transcript indexes (a phrase with Shift) in
   * the scene they're spoken in. `target` is the element to cue to them (the one selected before).
   */
  | { kind: "word"; sceneId: string; first: number; last: number; target: ElementRef | null }
  | null;

/** One element with one of its cues. */
export function selectCue(sceneId: string, ref: ElementRef, cue: CueId): EditorSelection {
  return { kind: "elements", sceneId, refs: [ref], cue };
}

/** One element with one of its keyframes. */
export function selectKeyframe(sceneId: string, ref: ElementRef, keyframe: string): EditorSelection {
  return { kind: "elements", sceneId, refs: [ref], keyframe };
}

/** Elements of `sceneId` that are selected (empty when something else is). */
export function selectedRefs(selection: EditorSelection, sceneId: string | null | undefined): ElementRef[] {
  return selection?.kind === "elements" && selection.sceneId === sceneId ? selection.refs : [];
}

export function isElementSelected(selection: EditorSelection, sceneId: string, ref: ElementRef): boolean {
  return selectedRefs(selection, sceneId).some((r) => sameRef(r, ref));
}

export function selectElements(sceneId: string, refs: readonly ElementRef[]): EditorSelection {
  const unique = refs.filter((ref, i) => refs.findIndex((r) => sameRef(r, ref)) === i);
  return unique.length ? { kind: "elements", sceneId, refs: unique } : null;
}

/** Shift-click: adds the element to (or removes it from) a selection in the same scene; anything else is replaced. */
export function toggleElement(selection: EditorSelection, sceneId: string, ref: ElementRef): EditorSelection {
  const current = selectedRefs(selection, sceneId);
  if (!current.length) return selectElements(sceneId, [ref]);
  return current.some((r) => sameRef(r, ref)) ? selectElements(sceneId, current.filter((r) => !sameRef(r, ref))) : selectElements(sceneId, [...current, ref]);
}

/** Marquee with Shift: adds elements to a selection in the same scene. */
export function addElements(selection: EditorSelection, sceneId: string, refs: readonly ElementRef[]): EditorSelection {
  return selectElements(sceneId, [...selectedRefs(selection, sceneId), ...refs]);
}

export { refKey, sameRef };
