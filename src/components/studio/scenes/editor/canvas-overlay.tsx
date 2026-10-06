"use client";

import type { PlayerRef } from "@remotion/player";
import { Lock, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { elementAtTime, keyframedPatch } from "@/core/motion/keyframes";
import type { SceneElement } from "@/core/spec/scene";
import type { TriggerContext } from "@/core/spec/triggers";
import {
  ROTATION_MAGNET,
  ROTATION_SNAP_STEP,
  angleDelta,
  layoutBoxPx,
  moveLayout,
  pointerAngle,
  resizeLayout,
  snapBox,
  snapRotation,
  snapTargets,
  type BoxPx,
  type ElementRef,
  type FrameSize,
  type LayoutFields,
  type ResizeCorner,
  type SnapLine,
  type SnapTargets,
} from "@/core/timeline/element-layout";
import { sameRef, unionBox } from "@/core/timeline/element-ops";
import { MIN_ZOOM_SIZE, clampZoomRect, normalizeZooms, zoomViewAt, type OverlayZoom, type ZoomRect } from "@/core/timeline/overlay-zoom";
import { elementSpan } from "@/core/timeline/scene-restructure";
import { formatClock } from "@/core/timing/frames";
import { cn } from "@/lib/utils";
import type { SceneElementPatch } from "@/server/services/scene-elements";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { MotionPathLayer } from "./canvas-motion-path";
import { elementDrafts, elementKey, useElementDrafts } from "./element-drafts";
import type { StageGeometry } from "./preview-panel";
import { layoutWithPatch } from "./use-element-edits";
import { usePlayerFrame } from "./use-player-frame";

/**
 * The interactive layer over the preview picture. Clicking selects the topmost visible element or
 * overlay under the pointer; Shift+click adds an element to the selection or takes it out; dragging on
 * empty picture (or on a full-frame background) draws a selection box. A selected element gets a
 * bounding box: drag it to move, pull a corner to resize (images and videos keep their proportions;
 * Shift frees them), turn the handle above it to rotate (Shift: 15° steps). Moves and resizes snap to
 * the frame's edges and centre lines and to other elements' edges and centres (Alt: no snapping).
 * Several selected elements move together. The zoom being edited in the inspector shows its area
 * inside the media, where it can be moved and resized. Changes show at once as element drafts and
 * save through the same services as the inspector and the timeline. Right-click opens `contextMenu`.
 * An element with keyframes is handled where it shows at the playhead: moving, turning or resizing a
 * keyframed property sets a keyframe there (one per property for the whole drag), like the inspector.
 */

export interface CanvasSelection {
  sceneId: string;
  ref: ElementRef;
  /** The saved element. */
  saved: SceneElement;
  /** Why it can't be edited right now (locked scene, unsaved spec), or null. */
  blockedReason: string | null;
  /** Images and videos resize proportionally and can show zoom areas. */
  media: boolean;
  /** Video seconds an image or video appears (its zoom clock starts here), else null. */
  appearSec: number | null;
  /** Where "go to it" seeks when it isn't on screen. */
  seekSec: number;
  name: string;
  /** Its scene's timing, narrowed to its shot — its keyframe clock (null: unknown). */
  segment: TriggerContext | null;
}

/** Element sizes on screen, for actions that need them (align, distribute). */
export interface CanvasApi {
  /** Layout boxes in video pixels of the given elements (by element key) that are on screen now. */
  frameBoxes: (keys: readonly string[]) => Map<string, BoxPx>;
}

export interface CanvasMove {
  selection: CanvasSelection;
  /** The element as shown when the drag started (its draft or saved element, keyframes not resolved). */
  element: SceneElement;
  /** Seconds after it appears at the playhead when it has keyframes (its keyframed x/y key there), else null. */
  localSec: number | null;
  x: number;
  y: number;
}

interface Measured {
  box: BoxPx;
  visible: boolean;
}

interface LayoutDrag {
  kind: "move" | "resize";
  corner: ResizeCorner | null;
  x: number;
  y: number;
  /** The element (keyframed values resolved at the playhead) and its on-screen box when the drag started. */
  element: SceneElement;
  /** The element as shown, keyframes unresolved — what patches apply to. */
  base: SceneElement;
  /** Seconds after it appears at the playhead, when it has keyframes. */
  local: number | null;
  start: BoxPx;
  /** Its size in video pixels. */
  size: { width: number; height: number };
  moved: boolean;
  patch: SceneElementPatch | null;
  box: BoxPx;
  lines: SnapLine[];
  targets: SnapTargets;
}

interface RotateDrag {
  kind: "rotate";
  x: number;
  y: number;
  /** The box's centre in client pixels (it rotates around it). */
  center: { x: number; y: number };
  lastAngle: number;
  /** Degrees turned since the drag started (unwrapped, so it can pass ±180°). */
  turned: number;
  startRotation: number;
  rotation: number;
  element: SceneElement;
  base: SceneElement;
  local: number | null;
  moved: boolean;
}

interface GroupDrag {
  kind: "group";
  x: number;
  y: number;
  items: { selection: CanvasSelection; element: SceneElement; base: SceneElement; local: number | null }[];
  /** The selection's bounds in video pixels when the drag started. */
  bounds: BoxPx;
  /** Video pixels moved, after snapping. */
  dx: number;
  dy: number;
  moved: boolean;
  lines: SnapLine[];
  targets: SnapTargets;
}

interface ZoomDrag {
  kind: "zoom";
  mode: "move" | "tl" | "br";
  x: number;
  y: number;
  start: ZoomRect;
  rect: ZoomRect;
  moved: boolean;
}

interface MarqueeDrag {
  kind: "marquee";
  x: number;
  y: number;
  /** Corners in stage pixels. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  additive: boolean;
  /** The full-frame element under the press: a click (no drag) selects it. */
  backdrop: { sceneId: string; ref: ElementRef } | null;
  moved: boolean;
}

type Drag = LayoutDrag | RotateDrag | GroupDrag | ZoomDrag | MarqueeDrag;

const CORNERS: { corner: ResizeCorner; className: string }[] = [
  { corner: "nw", className: "-top-[5px] -left-[5px] cursor-nwse-resize" },
  { corner: "ne", className: "-top-[5px] -right-[5px] cursor-nesw-resize" },
  { corner: "sw", className: "-bottom-[5px] -left-[5px] cursor-nesw-resize" },
  { corner: "se", className: "-right-[5px] -bottom-[5px] cursor-nwse-resize" },
];

/** Snapping distance in screen pixels. */
const SNAP_PX = 6;
const OVERLAY_KEY = "overlay";
const NO_MEASURES: ReadonlyMap<string, Measured> = new Map();

function opacityChain(el: HTMLElement, stop: HTMLElement): number {
  let value = 1;
  for (let node: HTMLElement | null = el; node && node !== stop; node = node.parentElement) value *= Number.parseFloat(getComputedStyle(node).opacity || "1");
  return value;
}

function relativeBox(el: HTMLElement, stageEl: HTMLElement): BoxPx | null {
  const r = el.getBoundingClientRect();
  if (r.width < 0.5 && r.height < 0.5) return null;
  const s = stageEl.getBoundingClientRect();
  return { left: r.left - s.left, top: r.top - s.top, width: r.width, height: r.height };
}

/** The layout box of a tagged scene element on screen (before its own motion) and whether it shows right now. */
function measureTagged(tagged: HTMLElement, stageEl: HTMLElement): Measured | null {
  const layoutBox = tagged.firstElementChild;
  if (!(layoutBox instanceof HTMLElement)) return null;
  const box = relativeBox(layoutBox, stageEl);
  if (!box) return null;
  const motion = layoutBox.firstElementChild instanceof HTMLElement ? layoutBox.firstElementChild : layoutBox;
  return { box, visible: Number.parseFloat(getComputedStyle(motion).opacity || "1") > 0.02 };
}

function measureElement(stageEl: HTMLElement, key: string): Measured | null {
  const tagged = stageEl.querySelector<HTMLElement>(`[data-studio-el="${key}"]`);
  return tagged ? measureTagged(tagged, stageEl) : null;
}

function measureOverlay(stageEl: HTMLElement, id: string): Measured | null {
  const el = stageEl.querySelector<HTMLElement>(`[data-studio-overlay="${id}"]`);
  const box = el ? relativeBox(el, stageEl) : null;
  return el && box ? { box, visible: opacityChain(el, stageEl) > 0.02 } : null;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
const sameMeasured = (a: Measured | undefined, b: Measured | undefined) =>
  a === b || (!!a && !!b && a.visible === b.visible && near(a.box.left, b.box.left) && near(a.box.top, b.box.top) && near(a.box.width, b.box.width) && near(a.box.height, b.box.height));
const sameMeasures = (a: ReadonlyMap<string, Measured>, b: ReadonlyMap<string, Measured>) => a.size === b.size && [...b].every(([key, m]) => sameMeasured(a.get(key), m));

function parseKey(key: string): { sceneId: string; ref: ElementRef } | null {
  const [sceneId, shotId, index, child] = key.split(":");
  if (!sceneId || index === "" || !Number.isInteger(Number(index))) return null;
  return { sceneId, ref: { shotId: shotId || null, index: Number(index), ...(child !== undefined && child !== "" ? { child: Number(child) } : {}) } };
}

/**
 * The topmost visible element or overlay under a point. Inside a group the group itself is picked
 * first — clicking again, once it is selected, reaches the child under the pointer (as in the layers
 * list, where children are listed under their group).
 */
function pick(root: HTMLElement, stageEl: HTMLElement, clientX: number, clientY: number, isSelected: (sceneId: string, ref: ElementRef) => boolean): { kind: "element"; sceneId: string; ref: ElementRef } | { kind: "overlay"; id: string } | null {
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    if (!(node instanceof HTMLElement) || root.contains(node)) continue;
    if (!stageEl.contains(node)) break;
    const overlay = node.closest<HTMLElement>("[data-studio-overlay]");
    if (overlay && stageEl.contains(overlay)) {
      if (opacityChain(overlay, stageEl) > 0.02) return { kind: "overlay", id: overlay.dataset.studioOverlay ?? "" };
      continue;
    }
    const tagged = node.closest<HTMLElement>("[data-studio-el]");
    const layoutBox = tagged?.firstElementChild;
    if (!tagged || !(layoutBox instanceof HTMLElement) || !stageEl.contains(tagged)) continue;
    const motion = layoutBox.firstElementChild instanceof HTMLElement ? layoutBox.firstElementChild : layoutBox;
    if (opacityChain(motion, stageEl) <= 0.02) continue;
    const parsed = parseKey(tagged.dataset.studioEl ?? "");
    if (!parsed) continue;
    if (parsed.ref.child !== undefined) {
      const group = { shotId: parsed.ref.shotId, index: parsed.ref.index };
      if (!isSelected(parsed.sceneId, group) && !isSelected(parsed.sceneId, parsed.ref)) return { kind: "element", sceneId: parsed.sceneId, ref: group };
    }
    return { kind: "element", ...parsed };
  }
  return null;
}

const coversStage = (box: BoxPx, stage: StageGeometry) => box.width >= stage.width * 0.98 && box.height >= stage.height * 0.98;

/** Video-pixel boxes of the other elements on screen (snap targets); full-frame layers are left out — their edges are the frame's. */
function otherBoxes(stageEl: HTMLElement, exclude: ReadonlySet<string>, stage: StageGeometry): BoxPx[] {
  const scale = stage.scale || 1;
  const out: BoxPx[] = [];
  for (const tagged of stageEl.querySelectorAll<HTMLElement>("[data-studio-el]")) {
    if (exclude.has(tagged.dataset.studioEl ?? "")) continue;
    const m = measureTagged(tagged, stageEl);
    if (!m?.visible || coversStage(m.box, stage)) continue;
    out.push({ left: m.box.left / scale, top: m.box.top / scale, width: m.box.width / scale, height: m.box.height / scale });
    if (out.length >= 80) break;
  }
  return out;
}

const position = (n: number) => Math.max(-100, Math.min(200, Math.round(n * 100) / 100));
const inside = (box: BoxPx, x: number, y: number) => x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;

export function CanvasOverlay({
  stage,
  player,
  fps,
  frame,
  sceneId,
  selections,
  selectedOverlayId,
  zoomId,
  contextMenu,
  apiRef,
  onSelectElement,
  onSelectElements,
  onSelectOverlay,
  onClearSelection,
  onCommitLayout,
  onCommitMove,
  onCommitZooms,
  onSeek,
}: {
  stage: StageGeometry;
  player: PlayerRef | null;
  fps: number;
  frame: FrameSize;
  /** The scene being edited: a selection box selects its elements. */
  sceneId: string;
  /** Selected elements of the scene (one: move, resize, rotate, zoom areas; several: move together). */
  selections: CanvasSelection[];
  selectedOverlayId: string | null;
  /** The zoom being edited in the inspector (images and videos). */
  zoomId: string | null;
  /** Items of the right-click menu (for the selection after the right-click). */
  contextMenu: ReactNode;
  apiRef?: RefObject<CanvasApi | null>;
  /** `additive`: Shift+click adds the element to the selection or takes it out. */
  onSelectElement: (sceneId: string, ref: ElementRef, additive: boolean) => void;
  /** A selection box: these elements (added to the selection with Shift). */
  onSelectElements: (sceneId: string, refs: ElementRef[], additive: boolean) => void;
  onSelectOverlay: (id: string) => void;
  onClearSelection: () => void;
  /** Move, resize or rotate of one element. */
  onCommitLayout: (selection: CanvasSelection, patch: SceneElementPatch, preview: SceneElement) => void;
  /** Several elements moved together. */
  onCommitMove: (moves: CanvasMove[]) => void;
  onCommitZooms: (selection: CanvasSelection, zooms: OverlayZoom[]) => void;
  onSeek: (timeSec: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<ReadonlyMap<string, Measured>>(NO_MEASURES);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const draftFrame = useRef(0);
  const { frame: playFrame } = usePlayerFrame(player);
  const drafts = useElementDrafts();
  const keys = useMemo(() => selections.map((s) => elementKey(s.sceneId, s.ref)), [selections]);
  const savedJson = useMemo(() => selections.map((s) => JSON.stringify(s.saved)), [selections]);
  const keysSig = keys.join("|");
  const shownAt = (i: number): SceneElement => {
    const draft = drafts.get(keys[i]);
    return draft && draft.base === savedJson[i] ? draft.element : selections[i].saved;
  };
  /** A selected element as shown (`base`), where it shows at the playhead (`live`: keyframed values resolved), and its keyframe clock. */
  const clockAt = (i: number): { base: SceneElement; live: SceneElement; local: number | null } => {
    const base = shownAt(i);
    const segment = selections[i].segment;
    if (!segment || !base.keyframes?.length) return { base, live: base, local: null };
    const local = playFrame / fps - elementSpan(base, segment).appear;
    return { base, live: elementAtTime(base, local), local };
  };
  const keyTolerance = 0.5 / fps;
  /** What a canvas edit saves: keyframes at the playhead for keyframed properties, the values for the rest. */
  const commitPatch = (base: SceneElement, local: number | null, patch: SceneElementPatch): SceneElementPatch => (local === null ? patch : keyframedPatch(base, patch, local, keyTolerance));
  /** The element as a canvas edit shows it while dragging. */
  const draftOf = (base: SceneElement, local: number | null, patch: SceneElementPatch): SceneElement => (local === null ? ({ ...base, ...patch } as SceneElement) : layoutWithPatch(base, commitPatch(base, local, patch), {}));

  // Follow the selection's boxes every frame: animation, camera moves and transitions move them on screen.
  useEffect(() => {
    const stageEl = rootRef.current?.parentElement;
    const watched = keysSig ? keysSig.split("|") : [];
    if (!stageEl || (!watched.length && !selectedOverlayId)) {
      setMeasured(NO_MEASURES);
      return;
    }
    let raf = 0;
    const tick = () => {
      const next = new Map<string, Measured>();
      for (const key of watched) {
        const m = measureElement(stageEl, key);
        if (m) next.set(key, m);
      }
      if (!watched.length && selectedOverlayId) {
        const m = measureOverlay(stageEl, selectedOverlayId);
        if (m) next.set(OVERLAY_KEY, m);
      }
      setMeasured((prev) => (sameMeasures(prev, next) ? prev : next));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [keysSig, selectedOverlayId]);
  useEffect(() => () => cancelAnimationFrame(draftFrame.current), []);

  const scale = stage.scale || 1;
  /**
   * The motion path of the one selected element, drawn and dragged on the canvas. Dragging previews the
   * element on its new curve through the same element draft the inspector uses, and saves once on release.
   * It is built as a value, not a nested component: a component defined during a render is a new type
   * every frame, which would throw away the drag it is in the middle of.
   */
  const motionPathLayer = () => {
    if (!single || several) return null;
    const { base, live, local } = clockAt(0);
    const path = base.motionPath;
    if (!path) return null;
    const progress = local === null ? (typeof base.pathProgress === "number" ? base.pathProgress : 0) : typeof live.pathProgress === "number" ? live.pathProgress : 0;
    return (
      <MotionPathLayer
        path={path}
        stage={stage}
        progress={progress}
        locked={locked}
        onPreview={(next) => elementDrafts.set(single.sceneId, single.ref, { ...base, motionPath: next }, single.saved)}
        onCommit={(next) => {
          elementDrafts.clear(single.sceneId, single.ref);
          onCommitLayout(single, { motionPath: next }, { ...base, motionPath: next });
        }}
      />
    );
  };
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      frameBoxes: (list) => {
        const out = new Map<string, BoxPx>();
        const stageEl = rootRef.current?.parentElement;
        if (!stageEl) return out;
        for (const key of list) {
          const m = measureElement(stageEl, key);
          if (m) out.set(key, { left: m.box.left / scale, top: m.box.top / scale, width: m.box.width / scale, height: m.box.height / scale });
        }
        return out;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, scale]);

  const single = selections.length === 1 ? selections[0] : null;
  const several = selections.length > 1;
  const locked = !selections.length || selections.some((s) => !!s.blockedReason);
  const singleClock = single ? clockAt(0) : null;
  const shown = singleClock?.live ?? null;
  const singleMeasured = single ? (measured.get(keys[0]) ?? null) : null;
  const rotating = drag?.kind === "rotate" && drag.moved ? drag : null;
  const rotation = rotating ? rotating.rotation : (shown?.rotation ?? 0);
  const sizable = !!shown && (!!single?.media || shown.width !== undefined || shown.height !== undefined);
  const canResize = !locked && sizable && !rotation;
  const canRotate = !!single && !locked;
  const t = playFrame / fps;
  const zooms = shown && (shown.type === "image" || shown.type === "video") ? (shown.zooms ?? []) : [];
  const zoomIndex = zoomId ? zooms.findIndex((z) => z.id === zoomId) : -1;
  const editingZoom = single?.media && zoomIndex >= 0 ? zooms[zoomIndex] : null;
  const clipSec = single?.appearSec !== null && single?.appearSec !== undefined ? t - single.appearSec : null;
  const zoomedIn = !!editingZoom && clipSec !== null && zoomViewAt(clipSec, zooms).size < 0.999;
  const zoomRect = drag?.kind === "zoom" ? drag.rect : (editingZoom?.rect ?? null);
  const groupBoxes = several ? keys.flatMap((key) => measured.get(key)?.box ?? []) : [];
  const groupBox = groupBoxes.length ? unionBox(groupBoxes) : null;
  const overlayMeasured = !selections.length ? (measured.get(OVERLAY_KEY) ?? null) : null;

  const stageElement = () => rootRef.current?.parentElement ?? null;
  const isSelectedRef = (sceneId: string, ref: ElementRef) => selections.some((sel) => sel.sceneId === sceneId && sameRef(sel.ref, ref));
  const pickAt = (clientX: number, clientY: number) => {
    const root = rootRef.current;
    const stageEl = stageElement();
    return root && stageEl ? pick(root, stageEl, clientX, clientY, isSelectedRef) : null;
  };
  const targetsExcludingSelection = () => {
    const stageEl = stageElement();
    return snapTargets(frame, stageEl ? otherBoxes(stageEl, new Set(keys), stage) : []);
  };

  const start = (e: React.PointerEvent, next: Drag) => {
    e.preventDefault();
    rootRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = next;
    setDrag(next);
  };
  const update = (next: Drag) => {
    dragRef.current = next;
    setDrag(next);
  };
  const endDrag = (pointerId?: number) => {
    if (pointerId !== undefined && rootRef.current?.hasPointerCapture(pointerId)) rootRef.current.releasePointerCapture(pointerId);
    dragRef.current = null;
    setDrag(null);
    cancelAnimationFrame(draftFrame.current);
  };
  const showDrafts = (entries: { selection: CanvasSelection; element: SceneElement }[]) => {
    cancelAnimationFrame(draftFrame.current);
    draftFrame.current = requestAnimationFrame(() => entries.forEach(({ selection, element }) => elementDrafts.set(selection.sceneId, selection.ref, element, selection.saved)));
  };

  const beginLayout = (e: React.PointerEvent, kind: LayoutDrag["kind"], corner: ResizeCorner | null) => {
    e.stopPropagation();
    if (e.button !== 0 || !single || !shown || !singleClock || !singleMeasured) return;
    if (kind === "move" && e.shiftKey) return onSelectElement(single.sceneId, single.ref, true);
    if (locked) return;
    const box = singleMeasured.box;
    start(e, { kind, corner, x: e.clientX, y: e.clientY, element: shown, base: singleClock.base, local: singleClock.local, start: box, size: { width: box.width / scale, height: box.height / scale }, moved: false, patch: null, box, lines: [], targets: targetsExcludingSelection() });
  };

  const beginRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    const stageEl = stageElement();
    if (e.button !== 0 || !single || !shown || !singleClock || !singleMeasured || locked || !stageEl) return;
    const s = stageEl.getBoundingClientRect();
    const box = singleMeasured.box;
    const center = { x: s.left + box.left + box.width / 2, y: s.top + box.top + box.height / 2 };
    const rotationNow = shown.rotation ?? 0;
    start(e, { kind: "rotate", x: e.clientX, y: e.clientY, center, lastAngle: pointerAngle(center, { x: e.clientX, y: e.clientY }), turned: 0, startRotation: rotationNow, rotation: rotationNow, element: shown, base: singleClock.base, local: singleClock.local, moved: false });
  };

  const beginGroup = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || !several || !groupBox) return;
    if (e.shiftKey) {
      const hit = pickAt(e.clientX, e.clientY);
      if (hit?.kind === "element") onSelectElement(hit.sceneId, hit.ref, true);
      return;
    }
    if (locked) return;
    const items = selections.map((selection, i) => {
      const clock = clockAt(i);
      return { selection, element: clock.live, base: clock.base, local: clock.local };
    });
    const bounds = { left: groupBox.left / scale, top: groupBox.top / scale, width: groupBox.width / scale, height: groupBox.height / scale };
    start(e, { kind: "group", x: e.clientX, y: e.clientY, items, bounds, dx: 0, dy: 0, moved: false, lines: [], targets: targetsExcludingSelection() });
  };

  const beginZoom = (e: React.PointerEvent, mode: ZoomDrag["mode"]) => {
    e.stopPropagation();
    if (e.button !== 0 || !editingZoom || locked) return;
    start(e, { kind: "zoom", mode, x: e.clientX, y: e.clientY, start: editingZoom.rect, rect: editingZoom.rect, moved: false });
  };

  const onRootPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const root = rootRef.current;
    const stageEl = stageElement();
    if (!root || !stageEl) return;
    const hit = pick(root, stageEl, e.clientX, e.clientY, isSelectedRef);
    if (hit?.kind === "overlay") return onSelectOverlay(hit.id);
    if (hit?.kind === "element") {
      const box = measureElement(stageEl, elementKey(hit.sceneId, hit.ref))?.box;
      // A full-frame layer is the backdrop: dragging on it draws a selection box, a click selects it.
      if (!box || !coversStage(box, stage)) return onSelectElement(hit.sceneId, hit.ref, e.shiftKey);
    }
    const r = root.getBoundingClientRect();
    const point = { x: e.clientX - r.left, y: e.clientY - r.top };
    start(e, { kind: "marquee", x: e.clientX, y: e.clientY, from: point, to: point, additive: e.shiftKey, backdrop: hit?.kind === "element" ? { sceneId: hit.sceneId, ref: hit.ref } : null, moved: false });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;

    if (d.kind === "marquee") {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) update({ ...d, moved: true, to: { x: e.clientX - r.left, y: e.clientY - r.top } });
      return;
    }

    if (d.kind === "zoom") {
      const bw = singleMeasured?.box.width || 1;
      const bh = singleMeasured?.box.height || 1;
      const dx = (e.clientX - d.x) / bw;
      const dy = (e.clientY - d.y) / bh;
      const s = d.start;
      let rect: ZoomRect;
      if (d.mode === "move") rect = { ...s, x: s.x + dx, y: s.y + dy };
      else if (d.mode === "br") rect = { ...s, size: Math.max(MIN_ZOOM_SIZE, Math.min(s.size + (dx + dy) / 2, 1 - s.x, 1 - s.y)) };
      else {
        // The top-left handle keeps the bottom-right corner in place.
        const size = Math.max(MIN_ZOOM_SIZE, Math.min(s.size - (dx + dy) / 2, s.x + s.size, s.y + s.size));
        rect = { x: s.x + s.size - size, y: s.y + s.size - size, size };
      }
      update({ ...d, moved: true, rect: clampZoomRect(rect) });
      return;
    }

    if (d.kind === "group") {
      const dxRaw = (e.clientX - d.x) / scale;
      const dyRaw = (e.clientY - d.y) / scale;
      const snapped = snapBox({ ...d.bounds, left: d.bounds.left + dxRaw, top: d.bounds.top + dyRaw }, d.targets, e.altKey ? 0 : SNAP_PX / scale);
      const next: GroupDrag = { ...d, moved: true, dx: dxRaw + snapped.dx, dy: dyRaw + snapped.dy, lines: snapped.lines };
      update(next);
      showDrafts(next.items.map(({ selection, element, base, local }) => ({ selection, element: draftOf(base, local, { x: position((element.x ?? 50) + (next.dx / frame.width) * 100), y: position((element.y ?? 50) + (next.dy / frame.height) * 100) }) })));
      return;
    }

    if (!single) return;

    if (d.kind === "rotate") {
      const angle = pointerAngle(d.center, { x: e.clientX, y: e.clientY });
      const turned = d.turned + angleDelta(d.lastAngle, angle);
      const rotationNext = snapRotation(d.startRotation + turned, e.shiftKey ? { step: ROTATION_SNAP_STEP } : e.altKey ? {} : { magnet: ROTATION_MAGNET });
      update({ ...d, moved: true, lastAngle: angle, turned, rotation: rotationNext });
      showDrafts([{ selection: single, element: draftOf(d.base, d.local, { rotation: rotationNext }) }]);
      return;
    }

    const el = d.element;
    const layout: LayoutFields = { x: el.x, y: el.y, width: el.width, height: el.height, anchor: el.anchor };
    let dx = (e.clientX - d.x) / scale;
    let dy = (e.clientY - d.y) / scale;
    const startPx = layoutBoxPx(layout, d.size, frame);
    const place = (b: BoxPx): BoxPx => ({ left: d.start.left + (b.left - startPx.left) * scale, top: d.start.top + (b.top - startPx.top) * scale, width: b.width * scale, height: b.height * scale });
    const threshold = e.altKey ? 0 : SNAP_PX / scale;
    let patch: SceneElementPatch;
    let box: BoxPx;
    let lines: SnapLine[];
    if (d.kind === "move") {
      const r = moveLayout(layout, d.size, frame, dx, dy, threshold, d.targets);
      patch = { x: r.x, y: r.y };
      box = place(r.box);
      lines = r.lines;
    } else if (single.media) {
      const free = e.shiftKey;
      const r = resizeLayout(layout, d.size, frame, d.corner!, dx, dy, { keepAspect: !free, snap: { targets: d.targets, threshold } });
      const size = free || (el.width !== undefined && el.height !== undefined) ? { width: r.width, height: r.height } : el.height !== undefined ? { height: r.height } : { width: r.width };
      patch = { x: r.x, y: r.y, ...size };
      box = place(r.box);
      lines = r.lines;
    } else {
      // Other elements only resize the sides they have a set size for.
      if (el.width === undefined) dx = 0;
      if (el.height === undefined) dy = 0;
      const r = resizeLayout(layout, d.size, frame, d.corner!, dx, dy, { keepAspect: e.shiftKey, snap: { targets: d.targets, threshold, axes: { x: el.width !== undefined, y: el.height !== undefined } } });
      patch = { x: r.x, y: r.y, ...(el.width !== undefined ? { width: r.width } : {}), ...(el.height !== undefined ? { height: r.height } : {}) };
      box = place(r.box);
      lines = r.lines;
    }
    update({ ...d, moved: true, patch, box, lines });
    showDrafts([{ selection: single, element: draftOf(d.base, d.local, patch) }]);
  };

  const finishMarquee = (d: MarqueeDrag) => {
    if (!d.moved) {
      if (d.backdrop) onSelectElement(d.backdrop.sceneId, d.backdrop.ref, d.additive);
      else if (!d.additive) onClearSelection();
      return;
    }
    const stageEl = stageElement();
    if (!stageEl) return;
    const area = { left: Math.min(d.from.x, d.to.x), top: Math.min(d.from.y, d.to.y), width: Math.abs(d.to.x - d.from.x), height: Math.abs(d.to.y - d.from.y) };
    const refs: ElementRef[] = [];
    for (const tagged of stageEl.querySelectorAll<HTMLElement>("[data-studio-el]")) {
      const parsed = parseKey(tagged.dataset.studioEl ?? "");
      const m = parsed?.sceneId === sceneId ? measureTagged(tagged, stageEl) : null;
      if (!parsed || !m?.visible) continue;
      const b = m.box;
      const touches = b.left < area.left + area.width && b.left + b.width > area.left && b.top < area.top + area.height && b.top + b.height > area.top;
      // A full-frame layer touches every box: it's only picked when the box covers it.
      const enclosed = b.left >= area.left && b.top >= area.top && b.left + b.width <= area.left + area.width && b.top + b.height <= area.top + area.height;
      if (touches && (!coversStage(b, stage) || enclosed)) refs.push(parsed.ref);
    }
    onSelectElements(sceneId, refs, d.additive);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    endDrag(e.pointerId);
    if (d.kind === "marquee") return finishMarquee(d);
    if (d.kind === "group") {
      if (!d.moved) {
        // A click inside the selection picks the element under the pointer.
        const hit = pickAt(e.clientX, e.clientY);
        if (hit?.kind === "element") onSelectElement(hit.sceneId, hit.ref, false);
        return;
      }
      onCommitMove(d.items.map(({ selection, element, base, local }) => ({ selection, element: base, localSec: local, x: position((element.x ?? 50) + (d.dx / frame.width) * 100), y: position((element.y ?? 50) + (d.dy / frame.height) * 100) })));
      return;
    }
    if (!single || !d.moved) return;
    if (d.kind === "zoom") {
      if (editingZoom) onCommitZooms(single, normalizeZooms(zooms.map((z) => (z.id === editingZoom.id ? { ...z, rect: d.rect } : z))));
      return;
    }
    if (d.kind === "rotate") {
      if (Math.abs(d.rotation - d.startRotation) > 0.001) {
        const patch = commitPatch(d.base, d.local, { rotation: d.rotation });
        onCommitLayout(single, patch, draftOf(d.base, d.local, { rotation: d.rotation }));
      } else elementDrafts.clear(single.sceneId, single.ref);
      return;
    }
    if (d.patch) onCommitLayout(single, commitPatch(d.base, d.local, d.patch), draftOf(d.base, d.local, d.patch));
  };

  const onPointerCancel = () => {
    const d = dragRef.current;
    endDrag();
    if (!d?.moved) return;
    if (d.kind === "group") d.items.forEach(({ selection }) => elementDrafts.clear(selection.sceneId, selection.ref));
    else if ((d.kind === "move" || d.kind === "resize" || d.kind === "rotate") && single) elementDrafts.clear(single.sceneId, single.ref);
  };

  // Right-click: act on what's under the pointer (keeping the selection when the click is inside it).
  const onContextMenu = (e: React.MouseEvent) => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const area = single ? singleMeasured?.box : groupBox;
    if (area && inside(area, e.clientX - r.left, e.clientY - r.top)) return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit?.kind === "element") {
      if (!keys.includes(elementKey(hit.sceneId, hit.ref))) onSelectElement(hit.sceneId, hit.ref, false);
    } else if (hit?.kind === "overlay") {
      if (hit.id !== selectedOverlayId) onSelectOverlay(hit.id);
    } else onClearSelection();
  };

  const layoutDrag = drag && (drag.kind === "move" || drag.kind === "resize") && drag.moved ? drag : null;
  const groupDrag = drag?.kind === "group" && drag.moved ? drag : null;
  const marquee = drag?.kind === "marquee" && drag.moved ? drag : null;
  const box = layoutDrag ? layoutDrag.box : single ? singleMeasured?.box : overlayMeasured?.box;
  const lines = layoutDrag?.lines ?? groupDrag?.lines ?? [];
  const size = (p: SceneElementPatch, el: SceneElement) => `${(p.width ?? el.width) !== undefined ? `${p.width ?? el.width}%` : "auto"} × ${(p.height ?? el.height) !== undefined ? `${p.height ?? el.height}%` : "auto"}`;
  const label = rotating ? `${rotating.rotation}°` : layoutDrag?.patch ? (layoutDrag.kind === "move" ? `x ${layoutDrag.patch.x}% · y ${layoutDrag.patch.y}%` : size(layoutDrag.patch, layoutDrag.element)) : single ? single.name : "Overlay";
  const measuredAny = single ? !!singleMeasured : several ? groupBoxes.length > 0 : true;
  const blockedReason = selections[0]?.blockedReason ?? null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={rootRef}
          className={cn("absolute inset-0 z-10 touch-none select-none", (layoutDrag?.kind === "move" || groupDrag) && "cursor-move", rotating && "cursor-grabbing")}
          onPointerDown={onRootPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onContextMenu={onContextMenu}
        >
          {lines.map((l, i) => (
            <div
              key={i}
              className="pointer-events-none absolute bg-fuchsia-500"
              style={l.axis === "x" ? { left: l.pos * scale, top: l.start * scale, width: 1, height: Math.max(1, (l.end - l.start) * scale) } : { top: l.pos * scale, left: l.start * scale, height: 1, width: Math.max(1, (l.end - l.start) * scale) }}
            />
          ))}

          {marquee ? (
            <div
              className="pointer-events-none absolute rounded-[2px] border border-primary bg-primary/10"
              style={{ left: Math.min(marquee.from.x, marquee.to.x), top: Math.min(marquee.from.y, marquee.to.y), width: Math.abs(marquee.to.x - marquee.from.x), height: Math.abs(marquee.to.y - marquee.from.y) }}
            />
          ) : null}

          {motionPathLayer()}

          {several
            ? selections.map((selection, i) => {
                const m = measured.get(keys[i]);
                const turn = clockAt(i).live.rotation;
                return m ? (
                  <div
                    key={keys[i]}
                    className={cn("pointer-events-none absolute border border-primary/80", !m.visible && "border-dashed")}
                    style={{ left: m.box.left, top: m.box.top, width: m.box.width, height: m.box.height, transform: turn ? `rotate(${turn}deg)` : undefined }}
                  />
                ) : null;
              })
            : null}
          {several && groupBox ? (
            <div
              className={cn("absolute", locked ? "border border-dashed border-white/80" : "cursor-move border border-dashed border-primary")}
              style={{ left: groupBox.left, top: groupBox.top, width: groupBox.width, height: groupBox.height, boxShadow: "0 0 0 1px rgba(0,0,0,0.35)" }}
              onPointerDown={beginGroup}
            >
              <span className={cn("pointer-events-none absolute -top-[18px] left-[-1px] flex items-center gap-1 rounded-t-sm px-1.5 py-px text-[10px] leading-4 font-medium whitespace-nowrap", locked ? "bg-black/70 text-white" : "bg-primary text-primary-foreground")}>
                {locked ? <Lock className="size-2.5" /> : null}
                {selections.length} elements{groupDrag ? ` · ${Math.round(groupDrag.dx)}, ${Math.round(groupDrag.dy)} px` : ""}
              </span>
            </div>
          ) : null}

          {box && (single || (!selections.length && selectedOverlayId)) ? (
            <div
              className={cn(
                "absolute",
                single ? (locked ? "border border-dashed border-white/80" : "cursor-move border-[1.5px] border-primary") : "border-[1.5px] border-dashed border-info",
                singleMeasured && !singleMeasured.visible && !layoutDrag && "border-dashed",
              )}
              style={{ left: box.left, top: box.top, width: box.width, height: box.height, transform: rotation ? `rotate(${rotation}deg)` : undefined, boxShadow: "0 0 0 1px rgba(0,0,0,0.35)" }}
              onPointerDown={(e) => (single ? beginLayout(e, "move", null) : e.stopPropagation())}
            >
              {editingZoom && zoomRect && !zoomedIn && !locked ? (
                <div className="absolute inset-0 overflow-hidden">
                  <div
                    className="absolute cursor-move border-2 border-white"
                    style={{ left: `${zoomRect.x * 100}%`, top: `${zoomRect.y * 100}%`, width: `${zoomRect.size * 100}%`, height: `${zoomRect.size * 100}%`, boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
                    onPointerDown={(e) => beginZoom(e, "move")}
                  >
                    <span className="pointer-events-none absolute top-1 left-1 rounded bg-black/70 px-1 text-[10px] whitespace-nowrap text-white">
                      Zoom {zoomIndex + 1} · {(1 / zoomRect.size).toFixed(1)}×
                    </span>
                    <div className="absolute -top-1.5 -left-1.5 size-3 cursor-nwse-resize rounded-sm border-2 border-white bg-black" onPointerDown={(e) => beginZoom(e, "tl")} />
                    <div className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-sm border-2 border-white bg-black" onPointerDown={(e) => beginZoom(e, "br")} />
                  </div>
                </div>
              ) : null}
              <span
                className={cn(
                  "pointer-events-none absolute -top-[18px] left-[-1.5px] flex max-w-64 items-center gap-1 truncate rounded-t-sm px-1.5 py-px text-[10px] leading-4 font-medium whitespace-nowrap",
                  single ? (locked ? "bg-black/70 text-white" : "bg-primary text-primary-foreground") : "bg-info text-white",
                )}
              >
                {locked && single ? <Lock className="size-2.5" /> : null}
                {label}
              </span>
              {canRotate && drag?.kind !== "zoom" ? (
                <div className="pointer-events-none absolute -top-9 left-1/2 flex -translate-x-1/2 flex-col items-center">
                  <div
                    role="slider"
                    aria-label="Rotate"
                    aria-valuenow={rotation}
                    title="Drag to rotate (Shift: 15° steps · Alt: no snapping to right angles)"
                    className="pointer-events-auto flex size-4 cursor-grab items-center justify-center rounded-full border-[1.5px] border-primary bg-white shadow-sm active:cursor-grabbing"
                    onPointerDown={beginRotate}
                  >
                    <RotateCw className="size-2.5 text-primary" />
                  </div>
                  <div className="h-[18px] w-px bg-primary" />
                </div>
              ) : null}
              {canResize && drag?.kind !== "zoom" ? CORNERS.map(({ corner, className }) => <div key={corner} className={cn("absolute size-2.5 rounded-[2px] border-[1.5px] border-primary bg-white", className)} onPointerDown={(e) => beginLayout(e, "resize", corner)} />) : null}
            </div>
          ) : null}

          <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1">
            {selections.length && !measuredAny ? (
              <span className="pointer-events-auto flex items-center gap-2 rounded-md bg-black/75 px-2 py-1 text-[11px] text-white">
                {single ? `“${single.name}” isn't` : `None of the ${selections.length} selected elements is`} on screen at {formatClock(t, 2)}
                <Button size="xs" variant="secondary" className="h-5 px-1.5 text-[10px]" onClick={() => onSeek(selections[0].seekSec)}>
                  Go to it
                </Button>
              </span>
            ) : null}
            {blockedReason && measuredAny ? <span className="rounded-md bg-black/75 px-2 py-1 text-[11px] text-white">{blockedReason}</span> : null}
            {editingZoom && zoomedIn && single?.appearSec !== null && single?.appearSec !== undefined ? (
              <span className="pointer-events-auto flex items-center gap-2 rounded-md bg-black/75 px-2 py-1 text-[11px] text-white">
                Zoom {zoomIndex + 1} is zooming in here
                <Button size="xs" variant="secondary" className="h-5 px-1.5 text-[10px]" onClick={() => onSeek(single.appearSec! + editingZoom.startSec - 0.5 / fps)}>
                  Edit its area
                </Button>
              </span>
            ) : null}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">{contextMenu}</ContextMenuContent>
    </ContextMenu>
  );
}
