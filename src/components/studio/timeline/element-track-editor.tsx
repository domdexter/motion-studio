"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { describeEasing } from "@/core/motion/easing";
import { animatedProperties, keyframeTracks, setKeyframe, updateKeyframe, valueAt } from "@/core/motion/keyframes";
import { animatableProperty, formatPropertyValue, type KeyframeProperty } from "@/core/spec/animatable";
import { isGroup, type Keyframe, type SceneElement, type SceneSpec } from "@/core/spec/scene";
import type { TimedWord } from "@/core/spec/timing";
import { elementCues, resolveShotWindows, type CueId, type ElementCue, type TriggerContext } from "@/core/spec/triggers";
import { dragElementSpan, elementTimingPatch, moveLimits, spokenTrigger, type TimingChange, type TimingEdge } from "@/core/timeline/element-cues";
import type { ElementRef } from "@/core/timeline/element-layout";
import { isSceneMedia } from "@/core/timeline/media-clip";
import { elementSpan, triggerAtTime, type ElementSpan } from "@/core/timeline/scene-restructure";
import { clusterByDistance, snapEdges, type SnapTarget } from "@/core/timeline/time-snap";
import { cn } from "@/lib/utils";
import type { SceneElementPatch } from "@/server/services/scene-elements";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { elementDrafts, elementKey, useElementDrafts } from "../scenes/editor/element-drafts";
import { elementIcon, elementName } from "../scenes/editor/element-summary";
import { keyframeMarkerClass } from "../scenes/editor/keyframe-fields";
import { layoutWithPatch } from "../scenes/editor/use-element-edits";
import type { SceneTrackContext } from "./timeline-tracks";

/**
 * The Elements lane: when each element of a scene is on screen, drawn from the saved scene spec (and
 * any edit still saving), with its entrance and exit shaded at the ends and its emphasis moments,
 * actions, item cues and cursor points as diamonds. Drag a bar to move the element (its timed cues and
 * keyframes move along), drag an edge to trim it, drag a diamond to retime that cue. Everything snaps to
 * spoken words, the playhead, the scene or shot edges, markers and the other elements (Alt: an exact
 * time); an entrance or cue dropped on a word is cued to that word, so it keeps following the voice-over.
 * Shift+click selects several bars to move together. Each release saves one element patch — the same one
 * the inspector's Timing section saves — as one undo step.
 *
 * An element with keyframes expands (its chevron, or selecting it) into one row per animated property
 * below the bars. Keyframe markers sit at their exact times: click one to select it, drag it to change
 * when it happens (its value stays; snapping as above, within the element's time on screen), double-click
 * a row to add a keyframe with the value there.
 */

export interface ElementLaneItem {
  /** `${sceneId}:${shotId}:${index}` — the element draft key. */
  key: string;
  ref: ElementRef;
  saved: SceneElement;
  /** JSON of the saved element (drafts made from it apply). */
  json: string;
  name: string;
  /** Its scene's timing, narrowed to its shot for an element inside a shot. */
  segment: TriggerContext;
  row: number;
}

export interface ElementLane {
  sceneId: string;
  /** Elements drawn as bars (images and videos have the Scene media lane). */
  items: ElementLaneItem[];
  rows: number;
  /** Every element with keyframes, images and videos included — the ones that expand into keyframe rows. */
  animated: ElementLaneItem[];
}

export const ELEMENT_ROW_PX = 20;
export const KEYFRAME_ROW_PX = 18;

export interface KeyframeLaneSection {
  item: ElementLaneItem;
  /** Top of its header row, in lane pixels. */
  top: number;
  rows: { property: KeyframeProperty; top: number }[];
}

export interface ElementLaneLayout {
  height: number;
  barsHeight: number;
  sections: KeyframeLaneSection[];
}

const NO_KEYS: ReadonlySet<string> = new Set();

/** Where the bars and each expanded element's keyframe rows go, and how tall the lane is. */
export function elementLaneLayout(lane: ElementLane | null, expanded: ReadonlySet<string> = NO_KEYS): ElementLaneLayout {
  const barsHeight = Math.max(1, lane?.rows ?? 1) * ELEMENT_ROW_PX + 8;
  let top = barsHeight;
  const sections: KeyframeLaneSection[] = [];
  for (const item of lane?.animated ?? []) {
    if (!expanded.has(item.key)) continue;
    const properties = animatedProperties(item.saved);
    const header = top;
    const rows = properties.map((property, i) => ({ property, top: header + KEYFRAME_ROW_PX * (i + 1) }));
    sections.push({ item, top: header, rows });
    top = header + KEYFRAME_ROW_PX * (properties.length + 1) + 4;
  }
  return { height: top, barsHeight, sections };
}

export const elementLaneHeight = (lane: ElementLane | null, expanded?: ReadonlySet<string>) => elementLaneLayout(lane, expanded).height;

/** Which animated elements show their keyframe rows: a selected one does unless collapsed, any other once expanded. */
export function useExpandedElements(lane: ElementLane | null, selectedKeys: ReadonlySet<string>): { expanded: ReadonlySet<string>; toggle: (key: string) => void } {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const expanded = new Set((lane?.animated ?? []).filter((item) => overrides.get(item.key) ?? selectedKeys.has(item.key)).map((item) => item.key));
  const toggle = (key: string) => setOverrides((m) => new Map(m).set(key, !(m.get(key) ?? selectedKeys.has(key))));
  return { expanded, toggle };
}

/**
 * A scene's elements for the lane (images and videos have the Scene media lane), packed into rows so
 * elements on screen together stay visible. Rows come from the saved timing, so a bar keeps its row
 * while it's dragged.
 */
export function buildElementLane(scene: { id: string; startSec: number; endSec: number }, spec: SceneSpec, words: TimedWord[]): ElementLane {
  const base: TriggerContext = { words, sceneStart: scene.startSec, sceneEnd: scene.endSec };
  const windows = resolveShotWindows(spec, base);
  const entries: Omit<ElementLaneItem, "row">[] = [];
  const animated: ElementLaneItem[] = [];
  const push = (saved: SceneElement, ref: { shotId: string | null; index: number; child?: number }, segment: TriggerContext) => {
    const entry = { key: elementKey(scene.id, ref), ref, saved, json: JSON.stringify(saved), name: elementName(saved, ref), segment };
    if (animatedProperties(saved).length) animated.push({ ...entry, row: -1 });
    if (!isSceneMedia(saved)) entries.push(entry);
  };
  const add = (elements: SceneElement[], shotId: string | null, segment: TriggerContext) =>
    elements.forEach((saved, index) => {
      push(saved, { shotId, index }, segment);
      // A group's children keep their own cues and keyframes, so they have their own bars and rows.
      if (isGroup(saved)) saved.children.forEach((child, at) => push(child as SceneElement, { shotId, index, child: at }, segment));
    });
  add(spec.elements, null, base);
  (spec.shots ?? []).forEach((shot, i) => add(shot.elements, shot.id, { ...base, shotStart: windows[i].start, shotEnd: windows[i].end }));
  const spans = entries.map((e) => elementSpan(e.saved, e.segment));
  const ends: number[] = [];
  const rows = new Array<number>(entries.length);
  for (const i of entries.map((_, k) => k).sort((a, b) => spans[a].appear - spans[b].appear || a - b)) {
    let row = ends.findIndex((end) => end <= spans[i].appear + 0.001);
    if (row < 0) row = ends.length;
    ends[row] = spans[i].gone;
    rows[i] = row;
  }
  return { sceneId: scene.id, items: entries.map((e, i) => ({ ...e, row: rows[i] })), rows: ends.length, animated };
}

export interface ElementTimingCommit {
  item: ElementLaneItem;
  patch: SceneElementPatch;
  /** The element as it will show while the edit saves. */
  preview: SceneElement;
}

interface View {
  item: ElementLaneItem;
  /** As shown: the draft while an edit saves, else the saved element. */
  element: SceneElement;
  span: ElementSpan;
  cues: ElementCue[];
}

type Drag =
  | { kind: "timing"; key: string; edge: TimingEdge; x0: number; moved: boolean; group: { view: View; bounds: { start: number; end: number } }[]; targets: SnapTarget[]; changes: Map<string, TimingChange>; snap: SnapTarget | null }
  | { kind: "cue"; key: string; cue: ElementCue; x0: number; moved: boolean; targets: SnapTarget[]; time: number; word: { index: number; edge: "start" | "end" } | null; snap: SnapTarget | null }
  | { kind: "keyframe"; key: string; keyframe: Keyframe; x0: number; moved: boolean; targets: SnapTarget[]; time: number; snap: SnapTarget | null };

const SNAP_PX = 8;
const CUE_GROUP_PX = 9;
const CUE_HIT_PX = 12;
/** Entrances revealed part by part: their length isn't the element's, so no shading. */
const PART_REVEALS = new Set(["wordReveal", "charReveal", "typewriter", "mask"]);
const CUE_COLORS: Record<ElementCue["kind"], string> = { enter: "bg-primary", exit: "bg-primary", emphasis: "bg-warning", action: "bg-foreground/75", path: "bg-muted-foreground" };

const boundsOf = (segment: TriggerContext) => ({ start: segment.shotStart ?? segment.sceneStart, end: segment.shotEnd ?? segment.sceneEnd });
const patchContext = (segment: TriggerContext) => ({ sceneDurationSec: Math.max(0, segment.sceneEnd - segment.sceneStart), segment });

function CueDiamond({ cue, left, focused }: { cue: ElementCue; left: number; focused: boolean }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute top-1/2 size-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border border-background/60",
        CUE_COLORS[cue.kind],
        cue.voiceSynced && "ring-1 ring-track-voice",
        !cue.ok && "bg-destructive",
        focused && "z-10 size-2.5 ring-2 ring-foreground",
      )}
      style={{ left }}
    />
  );
}

const cueTitle = (cue: ElementCue) => `${cue.name} · ${cue.time.toFixed(2)}s${cue.voiceSynced ? " · on the voice" : ""}${cue.ok ? "" : ` · ${cue.reason ?? "unresolved"}`}`;

/** Diamonds of one element's cues at their exact times; cues too close to grab one by one share a target that lists them. */
function CueGroup({ cues, originSec, pps, focused, onPick }: { cues: ElementCue[]; originSec: number; pps: number; focused: CueId | null; onPick: (cue: ElementCue) => void }) {
  const [open, setOpen] = useState(false);
  const first = cues[0].time;
  const pad = CUE_HIT_PX / 2;
  const single = cues.length === 1;
  const box = (
    <div
      data-cue={single ? cues[0].id : undefined}
      data-cue-group={single ? undefined : ""}
      title={single ? `${cueTitle(cues[0])}\nDrag to retime (snaps to words; Alt: exact time) · click to edit` : `${cues.length} cues close together — click to choose one`}
      className="absolute inset-y-0 z-20 cursor-pointer rounded-sm hover:bg-foreground/15"
      style={{ left: (first - originSec) * pps - pad, width: (cues[cues.length - 1].time - first) * pps + pad * 2 }}
    >
      {cues.map((cue) => (
        <CueDiamond key={cue.id} cue={cue} left={(cue.time - first) * pps + pad} focused={cue.id === focused} />
      ))}
      {!single ? <span className="pointer-events-none absolute -top-1.5 -right-1 rounded-full bg-muted px-0.5 font-mono text-[8px] leading-2.5 text-muted-foreground">{cues.length}</span> : null}
    </div>
  );
  if (single) return box;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{box}</PopoverTrigger>
      {/* Portaled, but React still bubbles its pointer events to the bar, which would start a drag. */}
      <PopoverContent side="bottom" align="start" className="w-64 p-1" onPointerDown={(e) => e.stopPropagation()}>
        {cues.map((cue) => (
          <button
            key={cue.id}
            type="button"
            className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted", cue.id === focused && "bg-primary/10")}
            onClick={() => {
              setOpen(false);
              onPick(cue);
            }}
          >
            <span className={cn("size-2 shrink-0 rotate-45 rounded-[1px]", CUE_COLORS[cue.kind], !cue.ok && "bg-destructive")} />
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">{cue.time.toFixed(2)}s</span>
            <span className="min-w-0 truncate">{cue.name}</span>
            {cue.voiceSynced ? <span className="ml-auto shrink-0 text-[10px] text-track-voice">voice</span> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Labels of the Elements lane: its name and scene, and each expanded element's keyframe rows with their values at the playhead. */
export function ElementLaneLabels({ layout, sceneKey, currentTime, onToggle }: { layout: ElementLaneLayout; sceneKey: string; currentTime: number; onToggle: (key: string) => void }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span>Elements</span>
      <span className="truncate font-mono text-[9px] tracking-normal text-muted-foreground/80 normal-case">{sceneKey}</span>
      {layout.sections.map((section) => {
        const { item } = section;
        const Icon = elementIcon(item.saved.type);
        const appear = elementSpan(item.saved, item.segment).appear;
        return (
          <Fragment key={item.key}>
            <button
              type="button"
              className="absolute inset-x-0 flex items-center gap-1 border-t border-border/70 pr-1.5 pl-1 text-left text-[10px] font-normal tracking-normal text-foreground/85 normal-case hover:bg-muted/60"
              style={{ top: section.top, height: KEYFRAME_ROW_PX }}
              title={`${item.name}: hide its keyframe rows`}
              onClick={() => onToggle(item.key)}
            >
              <ChevronDown className="size-3 shrink-0 text-keyframe" />
              <Icon className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate font-mono">{item.name}</span>
            </button>
            {section.rows.map((row) => (
              <span key={row.property} className="absolute inset-x-0 flex items-center justify-between gap-1 pr-1.5 pl-5 text-[10px] font-normal tracking-normal normal-case" style={{ top: row.top, height: KEYFRAME_ROW_PX }}>
                <span className="truncate text-muted-foreground">{animatableProperty(row.property).label}</span>
                <span className="font-mono text-[9px] text-keyframe tabular-nums" title="At the playhead">
                  {formatPropertyValue(row.property, valueAt(item.saved, row.property, currentTime - appear))}
                </span>
              </span>
            ))}
          </Fragment>
        );
      })}
    </span>
  );
}

export function ElementTrackEditor({
  ctx,
  lane,
  selectedKeys,
  focusedCue,
  focusedKeyframe = null,
  blockedReason,
  markers,
  defaultEnterSec,
  fps = 30,
  expanded = NO_KEYS,
  onToggleExpand,
  onSelect,
  onSelectCue,
  onSelectKeyframe,
  onCommit,
}: {
  ctx: SceneTrackContext;
  lane: ElementLane;
  selectedKeys: ReadonlySet<string>;
  /** The cue selected in the inspector or on the lane. */
  focusedCue: { key: string; cue: CueId } | null;
  /** The keyframe selected in the inspector or on a keyframe row. */
  focusedKeyframe?: { key: string; id: string } | null;
  /** Why the scene can't be edited (locked, unsaved spec): bars still select, nothing drags. */
  blockedReason: string | null;
  /** Project markers (they snap). */
  markers: readonly { time: number; label: string }[];
  /** Seconds an entrance takes when it doesn't say. */
  defaultEnterSec: number;
  /** Frames per second (a keyframe within half a frame of the playhead is at it). */
  fps?: number;
  /** Elements whose keyframe rows show (see `useExpandedElements`). */
  expanded?: ReadonlySet<string>;
  onToggleExpand?: (key: string) => void;
  onSelect: (item: ElementLaneItem, additive: boolean) => void;
  onSelectCue: (item: ElementLaneItem, cue: ElementCue) => void;
  onSelectKeyframe?: (item: ElementLaneItem, keyframe: Keyframe) => void;
  onCommit: (changes: ElementTimingCommit[]) => void;
}) {
  const pps = ctx.pxPerSec;
  const drafts = useElementDrafts();
  const [drag, setDrag] = useState<Drag | null>(null);
  const frame = useRef(0);
  const tokens = useRef(new Map<string, number>());
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const viewOf = (item: ElementLaneItem): View => {
    const draft = drafts.get(item.key);
    const element = draft && draft.base === item.json ? draft.element : item.saved;
    return { item, element, span: elementSpan(element, item.segment), cues: elementCues(element, item.segment, item.ref.shotId) };
  };
  const views: View[] = lane.items.map(viewOf);
  const layout = elementLaneLayout(lane, expanded);

  const targetsFor = (view: View, exclude: ReadonlySet<string>): SnapTarget[] => {
    const { start, end } = boundsOf(view.item.segment);
    const inShot = view.item.segment.shotStart !== undefined;
    // Spoken words come first: where a word and something else (another cue on that word) meet, the drop is cued to the word and keeps following the voice-over.
    const targets: SnapTarget[] = [];
    ctx.words.forEach((w, index) => {
      if (w.end < start - 0.5 || w.start > end + 0.5) return;
      targets.push({ time: w.start, kind: "word", label: `“${w.text}”`, word: { index, edge: "start" } }, { time: w.end, kind: "word", label: `the end of “${w.text}”`, word: { index, edge: "end" } });
    });
    targets.push(
      { time: ctx.currentTime, kind: "playhead", label: "the playhead" },
      { time: start, kind: inShot ? "shot" : "scene", label: inShot ? "the shot start" : "the scene start" },
      { time: end, kind: inShot ? "shot" : "scene", label: inShot ? "the shot end" : "the scene end" },
      ...markers.map((m) => ({ time: m.time, kind: "marker" as const, label: m.label ? `marker “${m.label}”` : "a marker" })),
    );
    for (const other of views) {
      if (exclude.has(other.item.key)) continue;
      targets.push({ time: other.span.appear, kind: "element", label: `${other.item.name} appearing` }, { time: other.span.gone, kind: "element", label: `${other.item.name} gone` });
      for (const cue of other.cues) if (cue.kind !== "enter" && cue.kind !== "exit") targets.push({ time: cue.time, kind: "cue", label: `${other.item.name} ${cue.name}` });
    }
    return targets;
  };

  /** Snap targets for a keyframe: the playhead, words, when its element appears and is gone, its cues, its other keyframes and markers. */
  const keyframeTargets = (view: View, keyframe: Keyframe): SnapTarget[] => {
    const { appear, gone } = view.span;
    const targets: SnapTarget[] = [{ time: ctx.currentTime, kind: "playhead", label: "the playhead" }];
    ctx.words.forEach((w) => {
      if (w.start >= appear - 0.01 && w.start <= gone + 0.01) targets.push({ time: w.start, kind: "cue", label: `“${w.text}”` });
    });
    targets.push({ time: appear, kind: "element", label: `${view.item.name} appearing` }, { time: gone, kind: "element", label: `${view.item.name} gone` });
    for (const cue of view.cues) targets.push({ time: cue.time, kind: "cue", label: cue.name });
    for (const k of view.element.keyframes ?? []) if (k.id !== keyframe.id) targets.push({ time: appear + k.time, kind: "cue", label: `its ${animatableProperty(k.property).label.toLowerCase()} keyframe` });
    targets.push(...markers.map((m) => ({ time: m.time, kind: "marker" as const, label: m.label ? `marker “${m.label}”` : "a marker" })));
    return targets;
  };

  /** Shows the dragged elements in the preview and the inspector (one frame at a time). */
  const preview = (entries: { view: View; element: SceneElement }[]) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      for (const { view, element } of entries) tokens.current.set(view.item.key, elementDrafts.set(lane.sceneId, view.item.ref, element, view.item.saved));
    });
  };
  const previewPatches = (entries: { view: View; patch: SceneElementPatch }[]) => preview(entries.map(({ view, patch }) => ({ view, element: layoutWithPatch(view.element, patch, patchContext(view.item.segment)) })));
  const dropPreview = (keys: Iterable<string>) => {
    cancelAnimationFrame(frame.current);
    for (const key of keys) {
      const item = lane.items.find((i) => i.key === key) ?? lane.animated.find((i) => i.key === key);
      const token = tokens.current.get(key);
      if (item && token !== undefined) elementDrafts.clear(lane.sceneId, item.ref, token);
      tokens.current.delete(key);
    }
  };

  const timeAt = (clientX: number, laneEl: Element) => (clientX - laneEl.getBoundingClientRect().left) / pps;
  const locked = !!blockedReason;
  const halfFrame = 0.5 / fps;

  return (
    <div
      className="absolute inset-0"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) ctx.seek(timeAt(e.clientX, e.currentTarget));
      }}
    >
      {!lane.items.length ? <span className="pointer-events-none sticky left-[calc(var(--tl-labels,0px)+0.5rem)] mt-1.5 inline-block text-[11px] text-muted-foreground">No elements in this scene — its images and videos are in the Scene media lane</span> : null}
      {views.map((view) => {
        const { item, element } = view;
        const change = drag?.kind === "timing" ? drag.changes.get(item.key) : undefined;
        const appear = change?.appear ?? view.span.appear;
        const gone = change?.gone ?? view.span.gone;
        const width = Math.max(4, (gone - appear) * pps);
        const selected = selectedKeys.has(item.key);
        const Icon = elementIcon(element.type);
        const enterCue = view.cues.find((c) => c.kind === "enter");
        const exitCue = view.cues.find((c) => c.kind === "exit");
        const enterSec = enterCue && !PART_REVEALS.has(enterCue.animation ?? "") ? (enterCue.duration ?? defaultEnterSec) : 0;
        const exitSec = view.span.gone - view.span.exitStart;
        const cueDrag = drag?.kind === "cue" && drag.key === item.key ? drag : null;
        const inner = view.cues.filter((c) => c.kind !== "enter" && c.kind !== "exit").map((c) => (cueDrag && cueDrag.cue.id === c.id ? { ...c, time: cueDrag.time } : c));
        const problems = view.cues.filter((c) => !c.ok);
        const dragging = drag?.key === item.key;
        const expandable = !!onToggleExpand && lane.animated.some((a) => a.key === item.key);
        const isExpanded = expanded.has(item.key);
        return (
          <div
            key={item.key}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${item.name}, on screen ${appear.toFixed(2)} to ${gone.toFixed(2)} seconds`}
            title={`${item.name} · ${element.type}${item.ref.shotId ? ` · shot ${item.ref.shotId}` : ""}\n${appear.toFixed(2)}–${gone.toFixed(2)}s (${(gone - appear).toFixed(2)}s)${problems.length ? `\n⚠ ${problems.map((p) => p.reason).join("; ")}` : ""}\n${blockedReason ?? "Drag to move · drag an edge to trim · snaps to words, the playhead and other elements (Alt: exact time) · Shift+click to select several"}`}
            className={cn(
              "absolute touch-none rounded border text-[10px] select-none",
              "border-primary/40 bg-primary/10 hover:bg-primary/15",
              selected && "z-10 border-primary bg-primary/20 ring-1 ring-primary",
              problems.length && "border-destructive/70",
              locked ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
              dragging && drag?.moved && "z-20 shadow-md",
            )}
            style={{ left: appear * pps, width, top: 4 + item.row * ELEMENT_ROW_PX, height: ELEMENT_ROW_PX - 3 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelect(item, e.shiftKey);
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              const target = e.target as HTMLElement;
              if (target.closest("[data-cue-group]") || target.closest("[data-expand]")) return;
              const additive = e.shiftKey || e.metaKey || e.ctrlKey;
              const cueId = target.closest<HTMLElement>("[data-cue]")?.dataset.cue;
              if (cueId && !additive) {
                const cue = view.cues.find((c) => c.id === cueId);
                if (!cue) return;
                onSelectCue(item, cue);
                if (locked) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag({ kind: "cue", key: item.key, cue, x0: e.clientX, moved: false, targets: targetsFor(view, new Set([item.key])), time: cue.time, word: null, snap: null });
                return;
              }
              if (additive) {
                onSelect(item, true);
                return;
              }
              if (!selected) onSelect(item, false);
              if (locked) {
                const laneEl = e.currentTarget.parentElement;
                if (laneEl) ctx.seek(Math.max(view.span.appear, Math.min(view.span.gone, timeAt(e.clientX, laneEl))));
                return;
              }
              e.currentTarget.setPointerCapture(e.pointerId);
              const edge = (target.closest("[data-edge]")?.getAttribute("data-edge") ?? "move") as TimingEdge;
              // Moving a bar of a multi-selection moves them all; trimming changes only this one.
              const keys = edge === "move" && selected && selectedKeys.size > 1 ? selectedKeys : new Set([item.key]);
              const group = views.filter((v) => keys.has(v.item.key)).map((v) => ({ view: v, bounds: boundsOf(v.item.segment) }));
              setDrag({ kind: "timing", key: item.key, edge, x0: e.clientX, moved: false, group, targets: targetsFor(view, keys), changes: new Map(), snap: null });
            }}
            onPointerMove={(e) => {
              if (!drag || drag.key !== item.key || drag.kind === "keyframe") return;
              const dx = e.clientX - drag.x0;
              if (!drag.moved && Math.abs(dx) < 3) return;
              let delta = dx / pps;
              if (drag.kind === "cue") {
                const { start, end } = boundsOf(item.segment);
                let time = drag.cue.time + delta;
                let snap: SnapTarget | null = null;
                if (!e.altKey) {
                  const snapped = snapEdges([time], drag.targets, SNAP_PX / pps);
                  if (snapped.target) {
                    time = snapped.target.time;
                    snap = snapped.target;
                  }
                }
                time = Math.max(start, Math.min(end, time));
                const word = snap?.word && Math.abs(snap.time - time) < 0.002 ? snap.word : null;
                setDrag({ ...drag, moved: true, time, snap: word || snap?.time === time ? snap : null, word });
                const trigger = word ? spokenTrigger(ctx.words, word.index, word.index, item.segment, { edge: word.edge }) : triggerAtTime(time, item.segment);
                previewPatches([{ view, patch: { cues: { [drag.cue.id]: trigger } } }]);
                return;
              }
              const lead = drag.group.find((g) => g.view.item.key === drag.key) ?? { view, bounds: boundsOf(item.segment) };
              const span = lead.view.span;
              let snap: SnapTarget | null = null;
              let appearEdge = false;
              if (!e.altKey) {
                const edges = drag.edge === "move" ? [span.appear + delta, span.gone + delta] : [drag.edge === "start" ? span.appear + delta : span.gone + delta];
                const snapped = snapEdges(edges, drag.targets, SNAP_PX / pps);
                if (snapped.target) {
                  delta += snapped.shift;
                  snap = snapped.target;
                  appearEdge = drag.edge === "start" || (drag.edge === "move" && snapped.edge === 0);
                }
              }
              if (drag.edge === "move") {
                // One shift for the whole group, keeping every element inside its scene or shot.
                let lo = -Infinity;
                let hi = Infinity;
                for (const g of drag.group) {
                  const [a, b] = moveLimits(g.view.span, g.bounds);
                  lo = Math.max(lo, a);
                  hi = Math.min(hi, b);
                }
                const clamped = Math.max(lo, Math.min(hi, delta));
                if (Math.abs(clamped - delta) > 0.0005) snap = null;
                delta = clamped;
              }
              const changes = new Map<string, TimingChange>();
              for (const g of drag.group) {
                const next = dragElementSpan(g.view.span, g.bounds, drag.edge, delta);
                const onWord = g.view.item.key === drag.key && appearEdge && snap?.word && Math.abs(next.appear - snap.time) < 0.002 ? snap.word : null;
                changes.set(g.view.item.key, { ...next, appearWord: onWord });
              }
              const leadChange = changes.get(drag.key);
              if (snap && leadChange && Math.abs((appearEdge ? leadChange.appear : leadChange.gone) - snap.time) > 0.002 && Math.abs(leadChange.appear - snap.time) > 0.002 && Math.abs(leadChange.gone - snap.time) > 0.002) snap = null;
              setDrag({ ...drag, moved: true, changes, snap });
              previewPatches(
                drag.group.flatMap((g) => {
                  const c = changes.get(g.view.item.key);
                  return c ? [{ view: g.view, patch: elementTimingPatch(g.view.element, g.view.item.segment, c) }] : [];
                }),
              );
            }}
            onPointerUp={(e) => {
              if (!drag || drag.key !== item.key || drag.kind === "keyframe") return;
              e.currentTarget.releasePointerCapture(e.pointerId);
              cancelAnimationFrame(frame.current);
              const final = drag;
              setDrag(null);
              if (!final.moved) {
                if (final.kind === "cue") ctx.seek(final.cue.time);
                else {
                  const laneEl = e.currentTarget.parentElement;
                  if (laneEl) ctx.seek(Math.max(view.span.appear, Math.min(view.span.gone, timeAt(e.clientX, laneEl))));
                }
                return;
              }
              if (final.kind === "cue") {
                const trigger = final.word ? spokenTrigger(ctx.words, final.word.index, final.word.index, item.segment, { edge: final.word.edge }) : triggerAtTime(final.time, item.segment);
                const patch: SceneElementPatch = { cues: { [final.cue.id]: trigger } };
                if (Math.abs(final.time - final.cue.time) < 0.0005 && !final.word) {
                  dropPreview([item.key]);
                  return;
                }
                onCommit([{ item, patch, preview: layoutWithPatch(view.element, patch, patchContext(item.segment)) }]);
                return;
              }
              const commits: ElementTimingCommit[] = [];
              const unchanged: string[] = [];
              for (const { view: v } of final.group) {
                const c = final.changes.get(v.item.key);
                const patch = c ? elementTimingPatch(v.element, v.item.segment, c) : {};
                if (Object.keys(patch).length) commits.push({ item: v.item, patch, preview: layoutWithPatch(v.element, patch, patchContext(v.item.segment)) });
                else unchanged.push(v.item.key);
              }
              dropPreview(unchanged);
              if (commits.length) onCommit(commits);
            }}
            onPointerCancel={() => {
              if (!drag || drag.key !== item.key || drag.kind === "keyframe") return;
              dropPreview(drag.kind === "timing" ? drag.group.map((g) => g.view.item.key) : [item.key]);
              setDrag(null);
            }}
          >
            {enterSec > 0 ? <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l bg-gradient-to-r from-primary/35 to-transparent" style={{ width: Math.min(width, enterSec * pps) }} /> : null}
            {exitSec > 0.001 ? <div className="pointer-events-none absolute inset-y-0 right-0 rounded-r bg-gradient-to-l from-primary/35 to-transparent" style={{ width: Math.min(width, exitSec * pps) }} /> : null}
            {enterCue?.voiceSynced ? <div className="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-l bg-track-voice" title="Enters on the voice" /> : null}
            {exitCue?.voiceSynced ? <div className="pointer-events-none absolute inset-y-0 right-0 w-0.5 rounded-r bg-track-voice" /> : null}
            <span className={cn("pointer-events-none absolute inset-0 flex items-center gap-1 overflow-hidden px-1.5 leading-none", expandable && width > 28 && "pl-5")}>
              <Icon className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono">{item.name}</span>
            </span>
            {!locked ? (
              <>
                <div data-edge="start" className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l hover:bg-primary/40" />
                <div data-edge="end" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r hover:bg-primary/40" />
              </>
            ) : null}
            {expandable && width > 28 ? (
              <button
                type="button"
                data-expand=""
                aria-expanded={isExpanded}
                aria-label={isExpanded ? `Hide the keyframe rows of ${item.name}` : `Show the keyframe rows of ${item.name}`}
                title={isExpanded ? "Hide its keyframe rows" : "Show its keyframes, one row per animated property"}
                className="absolute inset-y-0 left-1.5 z-10 flex w-3.5 items-center justify-center rounded-sm text-keyframe hover:bg-keyframe/20"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand?.(item.key);
                }}
              >
                <ChevronRight className={cn("size-3 transition-transform", isExpanded && "rotate-90")} />
              </button>
            ) : null}
            {clusterByDistance(inner, pps, CUE_GROUP_PX).map((group) => (
              <CueGroup
                key={group.items[0].id}
                cues={group.items}
                originSec={appear}
                pps={pps}
                focused={focusedCue?.key === item.key ? focusedCue.cue : null}
                onPick={(cue) => {
                  onSelectCue(item, cue);
                  ctx.seek(cue.time);
                }}
              />
            ))}
          </div>
        );
      })}

      {layout.sections.map((section) => {
        const view = viewOf(section.item);
        const { item } = section;
        const { appear, gone } = view.span;
        const tracks = keyframeTracks(view.element.keyframes);
        const keyDrag = drag?.kind === "keyframe" && drag.key === item.key ? drag : null;
        return (
          <Fragment key={item.key}>
            <div
              className="absolute inset-x-0 border-t border-border/70"
              style={{ top: section.top, height: KEYFRAME_ROW_PX }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) ctx.seek(timeAt(e.clientX, e.currentTarget));
              }}
            >
              <button
                type="button"
                className={cn("absolute inset-y-[3px] min-w-1 truncate rounded-sm border border-keyframe/30 bg-keyframe/[0.07] px-1 text-left font-mono text-[9px] leading-[10px] text-muted-foreground hover:bg-keyframe/15", selectedKeys.has(item.key) && "border-keyframe/60 text-foreground")}
                style={{ left: appear * pps, width: Math.max(4, (gone - appear) * pps) }}
                title={`${item.name}: its keyframes over its time on screen (${appear.toFixed(2)}–${gone.toFixed(2)}s) — click to select it`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSelect(item, false)}
              >
                {item.name}
              </button>
            </div>
            {section.rows.map((row) => {
              const keys = tracks.get(row.property) ?? [];
              const shown = keys.map((k) => (keyDrag?.keyframe.id === k.id ? { ...k, time: keyDrag.time - appear } : k)).sort((a, b) => a.time - b.time);
              return (
                <div
                  key={row.property}
                  className="absolute inset-x-0"
                  style={{ top: row.top, height: KEYFRAME_ROW_PX }}
                  title={locked ? blockedReason ?? undefined : `${animatableProperty(row.property).label} of ${item.name} — double-click to add a keyframe with the value there`}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) ctx.seek(timeAt(e.clientX, e.currentTarget));
                  }}
                  onDoubleClick={(e) => {
                    if (locked || e.target !== e.currentTarget) return;
                    const local = timeAt(e.clientX, e.currentTarget) - appear;
                    if (local < -halfFrame || local > gone - appear + halfFrame) return;
                    const time = Math.max(0, Math.min(gone - appear, local));
                    const { keyframes, id } = setKeyframe(view.element.keyframes, { property: row.property, time, value: valueAt(view.element, row.property, time) }, halfFrame);
                    const patch: SceneElementPatch = { keyframes };
                    onCommit([{ item, patch, preview: layoutWithPatch(view.element, patch, patchContext(item.segment)) }]);
                    const added = keyframes.find((k) => k.id === id);
                    if (added) onSelectKeyframe?.(item, added);
                  }}
                >
                  <div className="pointer-events-none absolute top-1/2 h-px -translate-y-1/2 bg-border" style={{ left: appear * pps, width: Math.max(0, (gone - appear) * pps) }} />
                  {shown.slice(1).map((k, i) => {
                    const prev = shown[i];
                    // The stretch between two keyframes belongs to the earlier one, which carries its
                    // curve: clicking it selects that keyframe, so the inspector edits this stretch alone.
                    const selectedStretch = focusedKeyframe?.key === item.key && focusedKeyframe.id === prev.id;
                    return (
                      <button
                        key={`seg-${k.id}`}
                        type="button"
                        className={cn(
                          "absolute top-1/2 h-3 -translate-y-1/2 bg-transparent",
                          locked ? "cursor-default" : "cursor-pointer",
                        )}
                        style={{ left: (appear + prev.time) * pps, width: Math.max(0, (k.time - prev.time) * pps) }}
                        title={`${describeEasing(prev.easing)} from ${(appear + prev.time).toFixed(2)}s to ${(appear + k.time).toFixed(2)}s — click to edit this stretch's curve`}
                        aria-label={`Interpolation stretch, ${describeEasing(prev.easing)}`}
                        aria-pressed={selectedStretch}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => onSelectKeyframe?.(item, keys.find((x) => x.id === prev.id) ?? prev)}
                      >
                        <span
                          className={cn(
                            "pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2",
                            prev.easing === "hold" ? "h-0 border-t border-dashed border-keyframe/70" : "h-[2px] bg-keyframe/55",
                            selectedStretch && "h-[3px] bg-keyframe",
                          )}
                        />
                      </button>
                    );
                  })}
                  {shown.map((k) => {
                    const time = appear + k.time;
                    const selected = focusedKeyframe?.key === item.key && focusedKeyframe.id === k.id;
                    const atPlayhead = Math.abs(ctx.currentTime - time) <= halfFrame;
                    const outside = k.time > gone - appear + 0.001;
                    return (
                      <div
                        key={k.id}
                        data-keyframe={k.id}
                        role="button"
                        aria-pressed={selected}
                        aria-label={`${animatableProperty(k.property).label} keyframe, ${formatPropertyValue(k.property, k.value)} at ${time.toFixed(2)} seconds`}
                        title={`${animatableProperty(k.property).label} ${formatPropertyValue(k.property, k.value)} · ${time.toFixed(2)}s (${k.time.toFixed(2)}s after it appears) · ${describeEasing(k.easing)}${outside ? " · after it's gone" : ""}\n${locked ? (blockedReason ?? "") : "Click to select · drag to change when (Alt: no snapping) · Delete removes it"}`}
                        className={cn("group absolute top-1/2 z-10 flex size-3.5 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center", locked ? "cursor-pointer" : "cursor-grab active:cursor-grabbing")}
                        style={{ left: time * pps }}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          const original = keys.find((x) => x.id === k.id) ?? k;
                          onSelectKeyframe?.(item, original);
                          if (locked) {
                            ctx.seek(appear + original.time);
                            return;
                          }
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setDrag({ kind: "keyframe", key: item.key, keyframe: original, x0: e.clientX, moved: false, targets: keyframeTargets(view, original), time: appear + original.time, snap: null });
                        }}
                        onPointerMove={(e) => {
                          if (!keyDrag || keyDrag.keyframe.id !== k.id) return;
                          const dx = e.clientX - keyDrag.x0;
                          if (!keyDrag.moved && Math.abs(dx) < 3) return;
                          let time = appear + keyDrag.keyframe.time + dx / pps;
                          let snap: SnapTarget | null = null;
                          if (!e.altKey) {
                            const snapped = snapEdges([time], keyDrag.targets, SNAP_PX / pps);
                            if (snapped.target) {
                              time = snapped.target.time;
                              snap = snapped.target;
                            }
                          }
                          time = Math.max(appear, Math.min(gone, time));
                          setDrag({ ...keyDrag, moved: true, time, snap: snap && Math.abs(snap.time - time) < 0.002 ? snap : null });
                          preview([{ view, element: { ...view.element, keyframes: updateKeyframe(view.element.keyframes, k.id, { time: time - appear }, gone - appear) } as SceneElement }]);
                        }}
                        onPointerUp={(e) => {
                          if (!keyDrag || keyDrag.keyframe.id !== k.id) return;
                          e.currentTarget.releasePointerCapture(e.pointerId);
                          cancelAnimationFrame(frame.current);
                          setDrag(null);
                          if (!keyDrag.moved || Math.abs(keyDrag.time - (appear + keyDrag.keyframe.time)) < 0.0005) {
                            dropPreview([item.key]);
                            ctx.seek(appear + keyDrag.keyframe.time);
                            return;
                          }
                          const patch: SceneElementPatch = { keyframes: updateKeyframe(view.element.keyframes, k.id, { time: keyDrag.time - appear }, gone - appear) };
                          onCommit([{ item, patch, preview: layoutWithPatch(view.element, patch, patchContext(item.segment)) }]);
                        }}
                        onPointerCancel={() => {
                          if (!keyDrag || keyDrag.keyframe.id !== k.id) return;
                          dropPreview([item.key]);
                          setDrag(null);
                        }}
                      >
                        <span
                          className={cn(
                            keyframeMarkerClass(k.easing),
                            "transition-transform group-hover:scale-125",
                            selected ? "size-[11px] ring-2 ring-foreground" : "size-[9px]",
                            atPlayhead && !selected && "ring-1 ring-primary",
                            outside && "opacity-40",
                          )}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </Fragment>
        );
      })}
      {drag?.moved ? <DragTip drag={drag} pps={pps} /> : null}
    </div>
  );
}

function DragTip({ drag, pps }: { drag: Drag; pps: number }) {
  let time: number;
  let text: string;
  if (drag.kind === "cue") {
    time = drag.time;
    text = `${drag.cue.name} ${drag.time.toFixed(2)}s${drag.word ? ` · on ${drag.snap?.label ?? "the word"}` : drag.snap ? ` · at ${drag.snap.label}` : " · exact time"}`;
  } else if (drag.kind === "keyframe") {
    time = drag.time;
    text = `${animatableProperty(drag.keyframe.property).label} keyframe ${drag.time.toFixed(2)}s${drag.snap ? ` · at ${drag.snap.label}` : ""}`;
  } else {
    const lead = drag.changes.get(drag.key);
    if (!lead) return null;
    time = drag.edge === "end" ? lead.gone : lead.appear;
    const what = drag.edge === "move" ? `${lead.appear.toFixed(2)}–${lead.gone.toFixed(2)}s` : drag.edge === "start" ? `appears ${lead.appear.toFixed(2)}s` : `gone ${lead.gone.toFixed(2)}s`;
    const snapped = lead.appearWord ? ` · cued to ${drag.snap?.label ?? "the word"}` : drag.snap ? ` · at ${drag.snap.label}` : "";
    text = `${what}${snapped}${drag.group.length > 1 ? ` · ${drag.group.length} elements` : ""}`;
  }
  return (
    <div className="pointer-events-none absolute -top-1 z-30 -translate-x-1/2 -translate-y-full rounded bg-popover px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-popover-foreground shadow" style={{ left: time * pps }}>
      {text}
    </div>
  );
}
