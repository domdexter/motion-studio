"use client";

import type { PlayerRef } from "@remotion/player";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { densityScale } from "@/core/creative/grammar";
import { adjacentKeyframe, removeKeyframesPatch } from "@/core/motion/keyframes";
import { MarkerSchema, parseMarkers, type Marker } from "@/core/spec/markers";
import { validateSceneSpec, type SceneElement } from "@/core/spec/scene";
import { effectiveTransition } from "@/core/spec/scene-transition";
import { collectSceneEvents, elementCues, eventElementId, type CueId, type SceneEvent, type TriggerContext } from "@/core/spec/triggers";
import { cueLabel, cueRemovable } from "@/core/timeline/element-cues";
import { findElementAt, type BoxPx, type ElementRef } from "@/core/timeline/element-layout";
import { alignShifts, distributeShifts, unionBox, type AlignMode, type ArrangeAction, type DistributeAxis } from "@/core/timeline/element-ops";
import { MIN_SCENE_MEDIA_SEC, isSceneMedia } from "@/core/timeline/media-clip";
import { elementSpan, segmentOfElement } from "@/core/timeline/scene-restructure";
import type { SceneLookPatch } from "@/core/timeline/spec-patch";
import { secondsToFrames } from "@/core/timing/frames";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import type { CompositionBuild } from "@/server/services/composition";
import type { SceneDto } from "@/server/services/scenes";
import type { getTimelineView } from "@/server/services/timeline";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InsertMediaDialog } from "../assets/insert-media-dialog";
import { AudioTrackInspector } from "../audio/audio-track-inspector";
import { useAudioTrackMutations, useAudioTracks, useVoiceCutsMutation, useVoiceMix } from "../audio/use-audio-edits";
import { EmptyState, ErrorState } from "../common";
import { useCreativeMetrics, useCreativePlan } from "../creative/shared";
import { AddOverlayDialog } from "../overlays/add-overlay-dialog";
import { OverlayInspector } from "../overlays/overlay-inspector";
import { useOverlayClips, useOverlayMutations } from "../overlays/use-overlays";
import { buildElementLane, type ElementLaneItem, type ElementTimingCommit } from "../timeline/element-track-editor";
import type { TrackTransition } from "../timeline/scene-track-editor";
import { usePlaybackShortcuts } from "../timeline/use-playback-shortcuts";
import { AskClaudeDialog } from "../workspace/ask-claude-dialog";
import { useWorkspace } from "../workspace/workspace-shell";
import { CanvasOverlay, type CanvasApi, type CanvasSelection } from "./editor/canvas-overlay";
import { EditorShell } from "./editor/editor-shell";
import { EditorToolbar } from "./editor/editor-toolbar";
import { ElementMenuItems, OverlayContextMenuItems, SceneContextMenuItems, type ElementActions } from "./editor/element-actions";
import { elementKey, useSettleElementDrafts } from "./editor/element-drafts";
import { ElementInspector } from "./editor/element-inspector";
import { elementName } from "./editor/element-summary";
import { InspectorEnvProvider, type InspectorEnv, type PlayheadSource } from "./editor/inspector-env";
import { LayersList } from "./editor/layers-list";
import { MarkerInspector } from "./editor/marker-inspector";
import { MultiElementInspector } from "./editor/multi-element-inspector";
import { PreviewPanel, type PlayMode } from "./editor/preview-panel";
import { copyProperties, pastePatch, propertyClip, type PropertyGroup } from "./editor/property-clipboard";
import { ReviewPanel, type ReviewTab } from "./editor/review-panel";
import { SceneInspector } from "./editor/scene-inspector";
import { addElements, selectCue, selectElements, selectKeyframe, selectedRefs, toggleElement, type EditorSelection } from "./editor/selection";
import { SidePanel, type SideTab } from "./editor/side-panel";
import { TimelinePanel, type Lane } from "./editor/timeline-panel";
import { layoutWithPatch, useElementEdits } from "./editor/use-element-edits";
import { liveElement, shiftedPosition, shownElement, useElementOps, type ElementTarget, type MoveGesture } from "./editor/use-element-ops";
import { WordInspector } from "./editor/word-inspector";
import { SceneMediaInspector } from "./scene-media-inspector";
import { buildSceneMediaEntries, sceneMediaTimingPatch, useSceneMediaUpdate } from "./use-scene-media";

type TimelineView = Awaited<ReturnType<typeof getTimelineView>>;
type StructureResult = { result: { notes?: string[] } };

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });
const undoHint = (notes: string[] | undefined) => [...(notes ?? []), "Press Ctrl+Z to undo."].join(" ");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The scene editor: a fixed workspace with a toolbar, the preview (with its interactive canvas), a side
 * panel (contextual inspector and creative review) and the docked timeline. The saved scene spec is the
 * single source of truth — the canvas, the layers, the inspector and the timeline all edit it through
 * the scene services, and share one selection (see `EditorSelection`).
 */
export function ScenesPage({ projectId }: { projectId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const invalidate = useCallback(() => void queryClient.invalidateQueries({ queryKey: ["project", projectId] }), [queryClient, projectId]);
  const scenesQ = useQuery({ queryKey: ["project", projectId, "scenes"], queryFn: async () => (await http.get<{ scenes: SceneDto[] }>(`/api/projects/${projectId}/scenes`)).scenes });
  const compQ = useQuery({ queryKey: ["project", projectId, "composition"], queryFn: () => http.get<CompositionBuild>(`/api/projects/${projectId}/composition`), placeholderData: keepPreviousData });
  const timelineQ = useQuery({ queryKey: ["project", projectId, "timeline"], queryFn: async () => (await http.get<{ timeline: TimelineView }>(`/api/projects/${projectId}/timeline`)).timeline });
  const metricsQ = useCreativeMetrics(projectId);
  const planQ = useCreativePlan(projectId);
  useSettleElementDrafts(scenesQ.data);

  const scenes = useMemo(() => scenesQ.data ?? [], [scenesQ.data]);
  const requested = search.get("scene");
  const scene = scenes.find((s) => s.key === requested || s.id === requested) ?? scenes[0] ?? null;
  const select = useCallback((key: string) => router.replace(`/projects/${projectId}/scenes?scene=${encodeURIComponent(key)}`, { scroll: false }), [router, projectId]);

  const [specText, setSpecText] = useState<{ sceneId: string; text: string } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [addOverlayAt, setAddOverlayAt] = useState<number | null>(null);
  const [playMode, setPlayMode] = useState<PlayMode>("scene");
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const playerRef = useCallback((p: PlayerRef | null) => setPlayer(p), []);
  const [selection, setSelection] = useState<EditorSelection>(null);
  const [zoomFocus, setZoomFocus] = useState<string | null>(null);
  // The zoom open in the media inspector; the canvas shows its area.
  const [canvasZoomId, setCanvasZoomId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>("inspector");
  const [reviewTab, setReviewTab] = useState<ReviewTab>("intent");
  const [narrow, setNarrow] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [pendingInsert, setPendingInsert] = useState<{ sceneId: string; elementId: string } | null>(null);
  // Loop range (I and O keys, or "Loop the selected clip") and lane switches for reviewing in the player.
  const [loopRange, setLoopRange] = useState<{ in: number; out: number } | null>(null);
  const [pendingIn, setPendingIn] = useState<number | null>(null);
  const [lanes, setLanes] = useState<Record<Lane, boolean>>({ media: true, overlays: true, voice: true, audio: true });
  const canvasApi = useRef<CanvasApi | null>(null);

  const draftSpec = useMemo(() => {
    if (!specText || !scene || specText.sceneId !== scene.id) return null;
    try {
      const v = validateSceneSpec(JSON.parse(specText.text));
      return v.ok ? v.spec : null;
    } catch {
      return null;
    }
  }, [specText, scene]);

  const props = useMemo(() => {
    const p = compQ.data?.props;
    if (!p) return null;
    if (!draftSpec || !scene) return p;
    return { ...p, scenes: p.scenes.map((s) => (s.id === scene.id ? { ...s, spec: draftSpec, valid: true } : s)) };
  }, [compQ.data, draftSpec, scene]);

  const fps = props?.fps ?? timelineQ.data?.fps ?? 30;
  const frameSize = useMemo(() => ({ width: props?.width ?? 1920, height: props?.height ?? 1080 }), [props?.width, props?.height]);
  const savedSpec = useMemo(() => (scene ? validateSceneSpec(scene.spec) : null), [scene]);
  const effectiveSpec = draftSpec ?? (savedSpec?.ok ? savedSpec.spec : null);
  const timeline = timelineQ.data;
  const words = useMemo(() => (timeline ? (timeline.voiceMatchesTimeline ? timeline.words : timeline.activeWords.length ? timeline.activeWords : timeline.words) : []), [timeline]);
  const events = useMemo(() => (effectiveSpec && scene ? collectSceneEvents(effectiveSpec, { words, sceneStart: scene.startSec, sceneEnd: scene.endSec }) : []), [effectiveSpec, scene, words]);

  // Jump to the scene when it changes (unless it was picked on the timeline or canvas, which keeps the playhead).
  const sceneId = scene?.id;
  const keepPlayhead = useRef(false);
  useEffect(() => {
    if (keepPlayhead.current) {
      keepPlayhead.current = false;
      return;
    }
    if (player && scene) player.seekTo(secondsToFrames(scene.startSec, fps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, sceneId]);

  const clearSelection = useCallback(() => {
    setSelection(null);
    setZoomFocus(null);
  }, []);

  const boundary = useMutation({
    mutationFn: (v: { sceneId: string; timeSec: number; snap: boolean }) => http.post(`/api/projects/${projectId}/scenes/${v.sceneId}/boundary`, { timeSec: v.timeSec, snap: v.snap }),
    onSuccess: (_d, v) => {
      toast.success(v.snap ? "Boundary moved — both scenes stay audio-locked" : "Boundary moved — both scenes are now user-adjusted");
      invalidate();
    },
    onError: (e) => {
      fail(e);
      invalidate();
    },
  });
  const split = useMutation({
    mutationFn: (v: { sceneId: string; key: string; atSec: number }) => http.post<StructureResult>(`/api/projects/${projectId}/scenes/${v.sceneId}/split`, { atSec: v.atSec }),
    onSuccess: ({ result }, v) => {
      toast.success(`${v.key} split into two scenes`, { description: undoHint(result.notes) });
      clearSelection();
      invalidate();
    },
    onError: fail,
  });
  const merge = useMutation({
    mutationFn: (v: { sceneId: string }) => http.post<StructureResult>(`/api/projects/${projectId}/scenes/${v.sceneId}/merge`),
    onSuccess: ({ result }) => {
      toast.success("Scenes merged — both designs kept", { description: undoHint(result.notes) });
      clearSelection();
      invalidate();
    },
    onError: fail,
  });
  const duplicateScene = useMutation({
    mutationFn: (v: { sceneId: string; key: string }) => http.post<{ result: { id: string; key: string; startSec: number; endSec: number; notes: string[] } }>(`/api/projects/${projectId}/scenes/${v.sceneId}/duplicate`),
    onSuccess: async ({ result }, v) => {
      toast.success(`Duplicated ${v.key} as ${result.key}`, { description: undoHint([`It plays after the last scene (${result.startSec.toFixed(2)}–${result.endSec.toFixed(2)}s, user-adjusted timing).`, ...result.notes]) });
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      select(result.key);
      setSelection({ kind: "scene", sceneId: result.id });
    },
    onError: fail,
  });
  const relock = useMutation({
    mutationFn: (v: { sceneId: string }) => http.post(`/api/projects/${projectId}/scenes/${v.sceneId}/relock`),
    onSuccess: () => {
      toast.success("Timing re-locked to the voice-over");
      invalidate();
    },
    onError: fail,
  });
  const approve = useMutation({ mutationFn: (approved: boolean) => http.post(`/api/projects/${projectId}/scenes/${scene!.id}/approve`, { approved }), onSuccess: invalidate, onError: fail });
  const lock = useMutation({ mutationFn: (locked: boolean) => http.post(`/api/projects/${projectId}/scenes/${scene!.id}/lock`, { locked }), onSuccess: invalidate, onError: fail });
  const look = useMutation({
    mutationFn: (v: { sceneId: string; patch: SceneLookPatch }) => http.patch(`/api/projects/${projectId}/scenes/${v.sceneId}/look`, v.patch),
    onSuccess: invalidate,
    onError: (e) => {
      fail(e);
      invalidate();
    },
  });
  const busy = boundary.isPending || split.isPending || merge.isPending || relock.isPending || duplicateScene.isPending;
  const splitMedia = useMutation({
    mutationFn: (v: { sceneId: string; ref: ElementRef; assetId: string; atSec: number; appearSec: number; goneSec: number }) =>
      http.post(`/api/projects/${projectId}/scenes/${v.sceneId}/media/split`, { ref: v.ref, assetId: v.assetId, atSec: v.atSec, appearSec: v.appearSec, goneSec: v.goneSec }),
    onSuccess: () => {
      toast.success("Split in two", { description: "The second part is a new element in the scene. Press Ctrl+Z to undo." });
      invalidate();
    },
    onError: fail,
  });

  const overlaysQ = useOverlayClips(projectId);
  const overlayOps = useOverlayMutations(projectId);
  const overlayClips = useMemo(() => overlaysQ.data ?? [], [overlaysQ.data]);
  const audioQ = useAudioTracks(projectId);
  const audioOps = useAudioTrackMutations(projectId);
  const audioTracks = useMemo(() => audioQ.data ?? [], [audioQ.data]);
  const mixQ = useVoiceMix(projectId);
  const saveCuts = useVoiceCutsMutation(projectId);
  const saveMedia = useSceneMediaUpdate(projectId);
  const edits = useElementEdits(projectId);
  const ops = useElementOps(projectId);
  const seek = useCallback((t: number) => player?.seekTo(secondsToFrames(t, fps)), [player, fps]);
  const currentSec = useCallback(() => (player ? player.getCurrentFrame() / fps : 0), [player, fps]);
  // The playhead for the inspector fields that follow it live (only they subscribe).
  const playheadSource = useMemo<PlayheadSource>(
    () => ({
      subscribe: (listener) => {
        if (!player) return () => undefined;
        player.addEventListener("frameupdate", listener);
        player.addEventListener("seeked", listener);
        return () => {
          player.removeEventListener("frameupdate", listener);
          player.removeEventListener("seeked", listener);
        };
      },
      get: () => (player ? player.getCurrentFrame() / fps : 0),
    }),
    [player, fps],
  );
  // A cue waiting for a word to be clicked on the timeline (Esc cancels).
  const [wordPick, setWordPick] = useState<{ label: string; onPick: (index: number) => void } | null>(null);
  // Following the playhead: while nothing inside a scene is selected, the scene under the playhead (after a seek, or playing through) becomes the current scene.
  const sceneChangedAt = useRef(0);
  const follow = useRef({ scenes, sceneId, selection, select });
  follow.current = { scenes, sceneId, selection, select };
  useEffect(() => {
    sceneChangedAt.current = Date.now();
  }, [sceneId]);
  useEffect(() => {
    if (!player) return;
    const onFrame = () => {
      const { scenes: list, sceneId: current, selection: selected, select: open } = follow.current;
      // A scene picked elsewhere seeks to its start a moment later; don't follow the old position meanwhile.
      if ((selected && selected.kind !== "scene") || Date.now() - sceneChangedAt.current < 400) return;
      // By frame, as the player seeks: a scene's first frame can fall a fraction of a second before its start.
      const frame = player.getCurrentFrame();
      const under = list.find((s) => frame >= secondsToFrames(s.startSec, fps) && frame < secondsToFrames(s.endSec, fps));
      if (!under || under.id === current) return;
      keepPlayhead.current = true;
      open(under.key);
    };
    player.addEventListener("seeked", onFrame);
    player.addEventListener("frameupdate", onFrame);
    return () => {
      player.removeEventListener("seeked", onFrame);
      player.removeEventListener("frameupdate", onFrame);
    };
  }, [player, fps]);
  // Images and videos of every saved scene spec with the seconds they're on screen (the scene media lane and inspector edit these).
  const assets = props?.assets;
  const mediaEntries = useMemo(() => buildSceneMediaEntries(scenes, words, assets), [scenes, words, assets]);

  // What is selected — derived before the shortcuts below so Delete, Escape, S, arrows and Ctrl+D can act on it.
  const specDirty = !!scene && specText?.sceneId === scene.id;
  const blockedReason = !scene ? null : scene.locked ? "This scene is locked — unlock it to edit it." : specDirty ? "You have unsaved edits in Review → Spec — apply or revert them first." : null;
  const elementRefs = useMemo(() => {
    const refs = selectedRefs(selection, scene?.id);
    return savedSpec?.ok ? refs.filter((ref) => findElementAt(savedSpec.spec, ref)) : [];
  }, [selection, scene?.id, savedSpec]);
  const singleRef = elementRefs.length === 1 ? elementRefs[0] : null;
  const selectedElement = singleRef && savedSpec?.ok ? findElementAt(savedSpec.spec, singleRef) : null;
  const selectedMediaEntry = singleRef && scene ? (mediaEntries.find((m) => m.key === elementKey(scene.id, singleRef)) ?? null) : null;
  const selectedOverlay = selection?.kind === "overlay" ? (overlayClips.find((c) => c.id === selection.id) ?? null) : null;
  const selectedAudio = selection?.kind === "audio" ? (audioTracks.find((t) => t.id === selection.id) ?? null) : null;
  const selectedCut = selection?.kind === "voiceCut" ? selection.index : null;
  const voiceCuts = useMemo(() => mixQ.data?.mix.cuts ?? [], [mixQ.data]);
  // Project markers (beats, notes, music and sound cues) sit on the ruler; M adds one at the playhead.
  const { project } = useWorkspace();
  const projectMarkers = useMemo(() => parseMarkers(project?.markers), [project?.markers]);
  const saveMarkers = useMutation({ mutationFn: (markers: Marker[]) => http.put(`/api/projects/${projectId}/markers`, { markers }), onSuccess: invalidate, onError: fail });
  const selectedMarker = selection?.kind === "marker" ? (projectMarkers.find((m) => m.id === selection.id) ?? null) : null;
  // The current scene's elements as timing bars, and every scene's transition in (drawn on the scene track).
  const elementLane = useMemo(() => (scene && savedSpec?.ok ? buildElementLane(scene, savedSpec.spec, words) : null), [scene, savedSpec, words]);
  const design = props?.design;
  const transitions = useMemo(() => {
    const map = new Map<string, TrackTransition>();
    if (!design) return map;
    scenes.forEach((s, i) => {
      const v = validateSceneSpec(s.spec);
      const t = effectiveTransition(v.ok ? v.spec : {}, design, i);
      if (t) map.set(s.id, { type: t.type, duration: t.duration ?? 0, own: v.ok && !!v.spec.transitionIn });
    });
    return map;
  }, [scenes, design]);
  const focusedCue = selection?.kind === "elements" && selection.cue && singleRef && scene ? { key: elementKey(scene.id, singleRef), cue: selection.cue } : null;
  const focusedKeyframe = selection?.kind === "elements" && selection.keyframe && singleRef && scene ? { key: elementKey(scene.id, singleRef), id: selection.keyframe } : null;
  /** The element's scene timing — and its shot's, for elements inside a shot (Timing, Cues and Keyframes). */
  const segmentOf = (ref: ElementRef): TriggerContext | null => (scene && savedSpec?.ok ? segmentOfElement(savedSpec.spec, { start: scene.startSec, end: scene.endSec }, ref.shotId, words) : null);
  /** Seconds after an element appears, at the playhead — its keyframe clock (null when its timing is unknown). */
  const keyframeClockOf = (ref: ElementRef, element: SceneElement): number | null => {
    const segment = segmentOf(ref);
    return segment ? currentSec() - elementSpan(element, segment).appear : null;
  };
  const keyTolerance = 0.5 / fps;
  /** Removes an emphasis moment, action, item cue or click (Delete with a cue selected). */
  const removeCue = (ref: ElementRef, saved: SceneElement, cue: CueId) => {
    if (!scene || blockedReason || !cueRemovable(cue)) return;
    const patch = { cues: { [cue]: null } };
    edits.commitLayout(scene.id, ref, saved, patch, layoutWithPatch(saved, patch, { sceneDurationSec: scene.durationSec }));
    setSelection(selectElements(scene.id, [ref]));
    toast.success(`Removed ${cueLabel(cue, saved.type).toLowerCase()} of ${elementName(saved, ref)}`, { description: "Press Ctrl+Z to undo." });
  };
  /** Removes a keyframe (Delete with one selected); a property left without keyframes keeps its value. */
  const removeKeyframe = (ref: ElementRef, saved: SceneElement, id: string) => {
    const keyframe = saved.keyframes?.find((k) => k.id === id);
    if (!scene || blockedReason || !keyframe) return;
    const patch = removeKeyframesPatch(saved, [id], keyframe.time);
    edits.commitLayout(scene.id, ref, saved, patch, layoutWithPatch(saved, patch, { sceneDurationSec: scene.durationSec }));
    setSelection(selectElements(scene.id, [ref]));
    toast.success(`Removed a keyframe of ${elementName(saved, ref)}`, { description: "Press Ctrl+Z to undo." });
  };

  // Targets carry their keyframe clock: moving an element with a keyframed position keys it at the playhead.
  const targetsOf = (refs: readonly ElementRef[]): ElementTarget[] =>
    scene && savedSpec?.ok
      ? refs.flatMap((ref) => {
          const saved = findElementAt(savedSpec.spec, ref);
          return saved ? [{ sceneId: scene.id, ref, saved, localSec: saved.keyframes?.length ? keyframeClockOf(ref, saved) : null, keyTolerance }] : [];
        })
      : [];

  const duplicateElements = () => {
    const targets = targetsOf(elementRefs);
    if (!scene || blockedReason || !targets.length) return;
    void ops.operate(targets, { op: "duplicate" }).then((refs) => {
      if (!refs) return;
      setSelection(selectElements(scene.id, refs));
      toast.success(`Duplicated ${plural(targets.length, "element")}`, { description: "The copies are selected. Press Ctrl+Z to undo." });
    });
  };
  const removeElements = (refs: readonly ElementRef[]) => {
    const targets = targetsOf(refs);
    if (!scene || blockedReason || !targets.length) return;
    const sceneKey = scene.key;
    void ops.operate(targets, { op: "remove" }).then((after) => {
      if (!after) return;
      setSelection((s) => (s?.kind === "elements" ? null : s));
      toast.success(`Removed ${targets.length === 1 ? (targets[0].saved.id ?? targets[0].saved.type) : plural(targets.length, "element")} from ${sceneKey}`, { description: "Press Ctrl+Z to undo." });
    });
  };
  /** Puts the selection into one group, keeping every element where it is. */
  const groupSelection = () => {
    const targets = targetsOf(elementRefs);
    if (!scene || blockedReason || targets.length < 2) return;
    void ops.operate(targets, { op: "group" }).then((refs) => {
      if (!refs?.length) return;
      setSelection(selectElements(scene.id, refs));
      toast.success(`Grouped ${plural(targets.length, "element")}`, { description: "They move, fade and animate together. Press Ctrl+Z to undo." });
    });
  };
  /** Takes the selected group apart; its children stay where they are and are selected. */
  const ungroupSelection = () => {
    const targets = targetsOf(elementRefs).filter((t) => t.saved.type === "group");
    if (!scene || blockedReason || targets.length !== 1) return;
    void ops.operate(targets, { op: "ungroup" }).then((refs) => {
      if (!refs?.length) return;
      setSelection(selectElements(scene.id, refs));
      toast.success("Ungrouped", { description: "Press Ctrl+Z to undo." });
    });
  };
  const arrangeElements = (action: ArrangeAction) => {
    const targets = targetsOf(elementRefs);
    if (!blockedReason && targets.length) void ops.operate(targets, { op: "arrange", action });
  };
  /** Moves the selection by per-element shifts measured on screen (align and distribute). */
  const shiftElements = (items: { target: ElementTarget; box: BoxPx }[], shifts: { dx: number; dy: number }[], gesture: MoveGesture) => {
    const moves = items.flatMap(({ target }, i) => {
      const { dx, dy } = shifts[i];
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return [];
      const shown = shownElement(target);
      return [{ ...target, shown, ...shiftedPosition(liveElement(target, shown), dx, dy, frameSize) }];
    });
    if (moves.length) ops.move(moves, gesture);
  };
  const measuredTargets = () => {
    const targets = targetsOf(elementRefs);
    const boxes = canvasApi.current?.frameBoxes(targets.map((t) => elementKey(t.sceneId, t.ref))) ?? new Map<string, BoxPx>();
    const items = targets.flatMap((target) => {
      const box = boxes.get(elementKey(target.sceneId, target.ref));
      return box ? [{ target, box }] : [];
    });
    if (items.length < targets.length) {
      toast(items.length ? `${plural(targets.length - items.length, "selected element")} aren't on screen at the playhead and stay where they are.` : "Move the playhead to where the selection is on screen to line it up.", { id: "arrange-offscreen" });
    }
    return items;
  };
  const alignElements = (mode: AlignMode) => {
    if (blockedReason) return;
    const items = measuredTargets();
    if (!items.length) return;
    const to = items.length > 1 ? unionBox(items.map((i) => i.box)) : { left: 0, top: 0, width: frameSize.width, height: frameSize.height };
    shiftElements(items, alignShifts(items.map((i) => i.box), mode, to), "align");
  };
  const distributeElements = (axis: DistributeAxis) => {
    if (blockedReason) return;
    const items = measuredTargets();
    if (items.length >= 3) shiftElements(items, distributeShifts(items.map((i) => i.box), axis), "distribute");
  };
  const copyElementProperties = (group: PropertyGroup) => {
    if (!selectedElement || !singleRef) return;
    const name = elementName(selectedElement, singleRef);
    copyProperties(group, selectedElement, name, segmentOf(singleRef) ?? undefined);
    toast.success(`Copied the ${group} of ${name}`, { description: "Select other elements and paste it." });
  };
  /** Pastes copied properties onto every selected element it applies to, as one undo step. */
  const pasteElementProperties = (group: PropertyGroup) => {
    const clip = propertyClip(group);
    const targets = targetsOf(elementRefs);
    if (!clip || !scene || blockedReason || !targets.length) return;
    const items = targets.flatMap((target) => {
      const patch = pastePatch(clip, target.saved, segmentOf(target.ref) ?? undefined);
      return patch ? [{ ...target, patch, preview: layoutWithPatch(shownElement(target), patch, { frame: frameSize, sceneDurationSec: scene.durationSec }) }] : [];
    });
    if (!items.length) {
      toast(`The copied ${group} doesn't apply to the selection.`);
      return;
    }
    ops.patch(items);
  };
  const elementActions: ElementActions = {
    count: elementRefs.length,
    blockedReason,
    duplicate: duplicateElements,
    remove: () => removeElements(elementRefs),
    arrange: arrangeElements,
    align: alignElements,
    distribute: distributeElements,
    copy: copyElementProperties,
    paste: pasteElementProperties,
    group: groupSelection,
    ungroup: ungroupSelection,
    canGroup: elementRefs.length > 1 && elementRefs.every((r) => r.child === undefined),
    canUngroup: elementRefs.length === 1 && selectedElement?.type === "group",
  };

  // Selects media that was just inserted once the scene has reloaded with it.
  useEffect(() => {
    if (!pendingInsert) return;
    const found = mediaEntries.find((m) => m.sceneId === pendingInsert.sceneId && m.item.element.id === pendingInsert.elementId);
    if (!found) return;
    setSelection(selectElements(found.sceneId, [found.item.ref]));
    setSideTab("inspector");
    setPendingInsert(null);
  }, [pendingInsert, mediaEntries]);

  const previewProps = useMemo(
    () => (props ? { ...props, preview: { hideSceneMedia: !lanes.media, hideOverlays: !lanes.overlays, muteVoice: !lanes.voice, muteAudio: !lanes.audio } } : null),
    [props, lanes],
  );

  usePlaybackShortcuts({
    getTime: currentSec,
    seek,
    toggle: () => player?.toggle(),
    fps,
    durationSec: props?.durationSec ?? 0,
    enabled: !!player,
    onSetIn: (t) => {
      setPendingIn(t);
      if (loopRange && loopRange.out > t + 0.1) setLoopRange({ in: t, out: loopRange.out });
    },
    onSetOut: (t) => {
      const start = pendingIn !== null && pendingIn < t - 0.1 ? pendingIn : (loopRange?.in ?? Math.max(0, t - 2));
      if (t - start < 0.1) return;
      setLoopRange({ in: start, out: t });
      setPlayMode("range");
    },
    onClearRange: () => {
      setLoopRange(null);
      setPendingIn(null);
      setPlayMode((m) => (m === "range" ? "scene" : m));
    },
    onMarker: (t) => {
      const marker = MarkerSchema.parse({ id: `m${Date.now().toString(36)}`, time: Math.round(t * 1000) / 1000, label: "" });
      saveMarkers.mutate([...projectMarkers, marker]);
      setSelection({ kind: "marker", id: marker.id });
      setSideTab("inspector");
    },
    onEscape: () => {
      if (wordPick) {
        setWordPick(null);
        return true;
      }
      if (!selection) return false;
      ops.flushNudge();
      clearSelection();
      return true;
    },
    onDelete: () => {
      if (selectedMarker) {
        saveMarkers.mutate(projectMarkers.filter((m) => m.id !== selectedMarker.id));
        clearSelection();
      } else if (focusedKeyframe && singleRef && selectedElement) {
        removeKeyframe(singleRef, selectedElement, focusedKeyframe.id);
      } else if (focusedCue && singleRef && selectedElement && cueRemovable(focusedCue.cue)) {
        removeCue(singleRef, selectedElement, focusedCue.cue);
      } else if (selectedOverlay) {
        overlayOps.remove.mutate(selectedOverlay.id);
        clearSelection();
      } else if (selectedAudio) {
        audioOps.remove.mutate(selectedAudio.id);
        clearSelection();
      } else if (selectedCut !== null && voiceCuts[selectedCut]) {
        saveCuts.mutate(voiceCuts.filter((_, i) => i !== selectedCut));
        clearSelection();
      } else if (elementRefs.length && !ops.pending) {
        removeElements(elementRefs);
      }
    },
    onNudge: (dx, dy, large) => {
      if (!scene || !elementRefs.length) return false;
      if (blockedReason) {
        toast(blockedReason, { id: "nudge-blocked" });
        return true;
      }
      const step = large ? 10 : 1;
      ops.nudge(targetsOf(elementRefs), dx * step, dy * step, frameSize);
      return true;
    },
    onDuplicate: () => {
      if (!elementRefs.length) return false;
      duplicateElements();
      return true;
    },
    onGroup: (ungroup) => {
      if (ungroup) {
        if (!elementActions.canUngroup) return false;
        ungroupSelection();
        return true;
      }
      if (!elementActions.canGroup) return false;
      groupSelection();
      return true;
    },
    onArrange: (action) => {
      if (!elementRefs.length) return false;
      arrangeElements(action);
      return true;
    },
    // [ and ]: the selected element's previous or next keyframe (of the selected keyframe's property, when one is selected).
    onKeyframeStep: (direction) => {
      if (!scene || !singleRef || !selectedElement?.keyframes?.length) return false;
      const local = keyframeClockOf(singleRef, selectedElement);
      if (local === null) return false;
      const property = focusedKeyframe ? selectedElement.keyframes.find((k) => k.id === focusedKeyframe.id)?.property : undefined;
      const next = adjacentKeyframe(selectedElement.keyframes, local, direction, property ? [property] : undefined, keyTolerance);
      if (next) {
        seek(currentSec() - local + next.time);
        setSelection(selectKeyframe(scene.id, singleRef, next.id));
      }
      return true;
    },
    // S splits the selected clip when the playhead is inside it, otherwise the scene.
    onSplit: (t) => {
      if (selectedMediaEntry && scene && !scene.locked && !specDirty) {
        const { item } = selectedMediaEntry;
        if (t > item.appearSec + MIN_SCENE_MEDIA_SEC && t < item.goneSec - MIN_SCENE_MEDIA_SEC) {
          splitMedia.mutate({ sceneId: selectedMediaEntry.sceneId, ref: item.ref, assetId: item.element.assetId, atSec: t, appearSec: item.appearSec, goneSec: item.goneSec });
          return;
        }
      }
      if (selectedOverlay && t > selectedOverlay.startSec + MIN_SCENE_MEDIA_SEC && t < selectedOverlay.endSec - MIN_SCENE_MEDIA_SEC) {
        overlayOps.split.mutate({ id: selectedOverlay.id, atSec: t });
        return;
      }
      if (scene && !scene.locked && t > scene.startSec + 0.25 && t < scene.endSec - 0.25) split.mutate({ sceneId: scene.id, key: scene.key, atSec: t });
    },
  });

  if (scenesQ.error) {
    return (
      <div className="p-6">
        <ErrorState error={scenesQ.error} onRetry={() => void scenesQ.refetch()} />
      </div>
    );
  }
  if (!scenesQ.data) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <Skeleton className="h-9 w-96" />
        <Skeleton className="flex-1" />
        <Skeleton className="h-60" />
      </div>
    );
  }
  if (!scene) {
    return (
      <div className="mx-auto max-w-xl p-10">
        <EmptyState
          icon={<Layers />}
          title="No scenes yet"
          description="Generate a storyboard first — each scene gets a Remotion spec you can refine here, by hand or with Claude."
          action={
            <Button size="sm" asChild>
              <Link href={`/projects/${projectId}/storyboard`}>Open Storyboard</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const index = scenes.findIndex((s) => s.id === scene.id);
  const approved = scene.status === "approved";
  const sceneMetrics = metricsQ.data?.scenes.find((m) => m.key === scene.key);

  const openInspector = () => {
    setSideTab("inspector");
    if (narrow) setSideOpen(true);
  };
  const openSpec = () => {
    setSideTab("review");
    setReviewTab("spec");
    if (narrow) setSideOpen(true);
  };
  /** Selects an element (Shift: adds it or takes it out), switching to its scene without moving the playhead. */
  const selectElement = (targetSceneId: string, ref: ElementRef, additive = false) => {
    const target = scenes.find((s) => s.id === targetSceneId);
    if (!target) return;
    ops.flushNudge();
    if (target.id !== scene.id) {
      keepPlayhead.current = true;
      select(target.key);
      setSelection(selectElements(target.id, [ref]));
    } else {
      setSelection((s) => (additive ? toggleElement(s, target.id, ref) : selectElements(target.id, [ref])));
    }
    setZoomFocus(null);
    openInspector();
  };
  const selectMany = (targetSceneId: string, refs: ElementRef[], additive: boolean) => {
    ops.flushNudge();
    setSelection((s) => (additive ? addElements(s, targetSceneId, refs) : selectElements(targetSceneId, refs)));
    setZoomFocus(null);
    if (refs.length) openInspector();
  };
  const selectOverlay = (id: string | null) => {
    setSelection(id ? { kind: "overlay", id } : null);
    setZoomFocus(null);
    if (id) openInspector();
  };
  const selectAudio = (id: string | null) => {
    setSelection(id ? { kind: "audio", id } : null);
    if (id) openInspector();
  };
  const selectMarker = (id: string) => {
    const marker = projectMarkers.find((m) => m.id === id);
    setSelection({ kind: "marker", id });
    if (marker) seek(marker.time);
    openInspector();
  };
  /** The transition band on the scene track: that scene, with its Transition section open. */
  const selectTransition = (targetSceneId: string) => {
    const target = scenes.find((s) => s.id === targetSceneId);
    if (!target) return;
    if (target.id !== scene.id) select(target.key);
    else seek(target.startSec);
    setSelection({ kind: "scene", sceneId: target.id, focus: "transition" });
    setZoomFocus(null);
    openInspector();
  };
  /** A cue diamond on an element bar, or a cue row in the inspector. */
  const selectElementCue = (ref: ElementRef, cue: CueId | null) => {
    ops.flushNudge();
    setSelection(cue ? selectCue(scene.id, ref, cue) : selectElements(scene.id, [ref]));
    setZoomFocus(null);
    openInspector();
  };
  /** A keyframe marker on a keyframe row, or a keyframe in the inspector. */
  const selectElementKeyframe = (ref: ElementRef, id: string | null) => {
    ops.flushNudge();
    setSelection(id ? selectKeyframe(scene.id, ref, id) : selectElements(scene.id, [ref]));
    setZoomFocus(null);
    openInspector();
  };
  /** Saves timeline moves and trims: one element through the element service, several as one batch (one undo step each). */
  const commitTiming = (changes: ElementTimingCommit[]) => {
    if (blockedReason) {
      toast(blockedReason, { id: "timing-blocked" });
      return;
    }
    if (changes.length === 1) {
      const [change] = changes;
      edits.commitLayout(scene.id, change.item.ref, change.item.saved, change.patch, change.preview);
    } else {
      ops.patch(changes.map((c) => ({ sceneId: scene.id, ref: c.item.ref, saved: c.item.saved, patch: c.patch, preview: c.preview })));
    }
  };
  /** A word on the timeline: used for a cue that's waiting for one, else selected (Shift: extends it to a phrase) — in its own scene, keeping the playhead. */
  const clickWord = (index: number, extend: boolean) => {
    const w = words[index];
    if (!w) return;
    if (wordPick) {
      setWordPick(null);
      wordPick.onPick(index);
      return;
    }
    const home = scenes.find((s) => w.start >= s.startSec - 0.08 && w.start < s.endSec) ?? scene;
    const previous = selection?.kind === "word" && selection.sceneId === home.id ? selection : null;
    const target = selection?.kind === "elements" && selection.sceneId === home.id && selection.refs.length === 1 ? selection.refs[0] : (previous?.target ?? null);
    if (home.id !== scene.id) {
      keepPlayhead.current = true;
      select(home.key);
    }
    setSelection(extend && previous ? { kind: "word", sceneId: home.id, first: Math.min(previous.first, index), last: Math.max(previous.last, index), target } : { kind: "word", sceneId: home.id, first: index, last: index, target });
    seek(w.start);
    setZoomFocus(null);
    openInspector();
  };
  const loopSpan = selectedMediaEntry ? [selectedMediaEntry.item.appearSec, selectedMediaEntry.item.goneSec] : selectedOverlay ? [selectedOverlay.startSec, selectedOverlay.endSec] : null;
  const loopSelection =
    loopSpan && loopSpan[1] - loopSpan[0] >= 0.1
      ? () => {
          setLoopRange({ in: loopSpan[0], out: loopSpan[1] });
          setPlayMode("range");
          seek(loopSpan[0]);
        }
      : null;

  const inspectorEnv: InspectorEnv = {
    design: props?.design ?? null,
    frame: frameSize,
    assets: props?.assets ?? {},
    fonts: (props?.fonts ?? []).map((f) => f.family),
    words,
    fps,
    getTime: currentSec,
    seek,
    measure: (targetSceneId, ref) => canvasApi.current?.frameBoxes([elementKey(targetSceneId, ref)]).get(elementKey(targetSceneId, ref)) ?? null,
    playhead: playheadSource,
    sentences: timeline?.timeline?.data.sentences ?? [],
    pickWord: (label, onPick) => setWordPick({ label, onPick }),
  };
  // Timed events of the selected elements are highlighted on the timeline; clicking a marker selects its element (and cue).
  const selectedEventIds = new Set(
    savedSpec?.ok
      ? elementRefs.flatMap((ref) => {
          const el = findElementAt(savedSpec.spec, ref);
          return el ? [eventElementId(el, ref.index, ref.shotId)] : [];
        })
      : [],
  );
  const selectEvent = (event: SceneEvent) => {
    seek(event.time);
    if (event.kind === "shot" || event.elementId === "scene" || !savedSpec?.ok) {
      setSelection({ kind: "scene", sceneId: scene.id, ...(event.elementId === "scene" ? { focus: "transition" as const } : {}) });
      openInspector();
      return;
    }
    const spec = savedSpec.spec;
    const lists = [{ shotId: null as string | null, elements: spec.elements }, ...(spec.shots ?? []).map((s) => ({ shotId: s.id as string | null, elements: s.elements }))];
    for (const { shotId, elements } of lists) {
      const found = elements.findIndex((el, i) => eventElementId(el, i, shotId) === event.elementId);
      if (found >= 0) return selectElementCue({ shotId, index: found }, event.cueId ?? null);
    }
  };
  // Words the selected element's cues fire on are underlined on the words lane.
  const cueWords = new Set(
    selectedElement && singleRef
      ? (() => {
          const segment = segmentOf(singleRef);
          return segment ? elementCues(selectedElement, segment, singleRef.shotId).flatMap((c) => (c.voiceSynced && c.wordIndex !== undefined ? [c.wordIndex] : [])) : [];
        })()
      : [],
  );
  /** Loops the cut into this scene in the player. */
  const previewTransition = () => {
    const from = Math.max(0, scene.startSec - 1);
    setLoopRange({ in: from, out: Math.min(scene.endSec, scene.startSec + 1.5) });
    setPlayMode("range");
    seek(from);
    player?.play();
  };

  const canvasSelections: CanvasSelection[] = savedSpec?.ok
    ? elementRefs.flatMap((ref) => {
        const saved = findElementAt(savedSpec.spec, ref);
        if (!saved) return [];
        const entry = mediaEntries.find((m) => m.key === elementKey(scene.id, ref));
        return [{ sceneId: scene.id, ref, saved, blockedReason, media: isSceneMedia(saved), appearSec: entry?.item.appearSec ?? null, seekSec: entry?.item.appearSec ?? scene.startSec, name: elementName(saved, ref), segment: segmentOf(ref) }];
      })
    : [];

  const layers = effectiveSpec ? (
    <LayersList spec={effectiveSpec} selected={elementRefs} blockedReason={blockedReason} busy={ops.pending} actions={elementActions} onSelect={(ref, additive) => selectElement(scene.id, ref, additive)} onRemove={(ref) => removeElements([ref])} />
  ) : null;

  let inspector: React.ReactNode;
  const wordSelection = selection?.kind === "word" && selection.sceneId === scene.id ? selection : null;
  if (selectedMarker) {
    inspector = (
      <MarkerInspector
        key={selectedMarker.id}
        marker={selectedMarker}
        durationSec={props?.durationSec ?? 0}
        busy={saveMarkers.isPending}
        onChange={(next) => saveMarkers.mutate(projectMarkers.map((m) => (m.id === next.id ? next : m)))}
        onDelete={() => {
          saveMarkers.mutate(projectMarkers.filter((m) => m.id !== selectedMarker.id));
          clearSelection();
        }}
        onSeek={seek}
        onClose={clearSelection}
      />
    );
  } else if (wordSelection && savedSpec?.ok) {
    const spoken = words.slice(wordSelection.first, wordSelection.last + 1).map((w) => w.text).join(" ");
    inspector = (
      <WordInspector
        scene={scene}
        spec={savedSpec.spec}
        words={words}
        sentences={timeline?.timeline?.data.sentences ?? []}
        first={wordSelection.first}
        last={wordSelection.last}
        target={wordSelection.target}
        blockedReason={blockedReason}
        onCommit={(ref, saved, patch, focus) => {
          if (blockedReason) return;
          edits.commitLayout(scene.id, ref, saved, patch, layoutWithPatch(saved, patch, { sceneDurationSec: scene.durationSec }));
          toast.success(focus ? `Cued ${elementName(saved, ref)} · ${cueLabel(focus, saved.type).toLowerCase()} to “${spoken}”` : `Updated ${elementName(saved, ref)}`, { description: "Press Ctrl+Z to undo." });
        }}
        onSelectCue={(ref, cue) => selectElementCue(ref, cue)}
        onTarget={(ref) => setSelection({ ...wordSelection, target: ref })}
        onClose={clearSelection}
      />
    );
  } else if (selectedOverlay) {
    inspector = (
      <OverlayInspector
        key={selectedOverlay.id}
        clip={selectedOverlay}
        getTime={currentSec}
        onPatch={(patch) => overlayOps.update.mutate({ id: selectedOverlay.id, patch })}
        onRemove={() => {
          overlayOps.remove.mutate(selectedOverlay.id);
          clearSelection();
        }}
        onClose={clearSelection}
        onSeek={seek}
        onSplit={(atSec, removeUntilSec) => overlayOps.split.mutate({ id: selectedOverlay.id, atSec, removeUntilSec })}
        onLoop={loopSelection ?? undefined}
        frame={frameSize}
        focusZoomId={zoomFocus}
        projectId={projectId}
      />
    );
  } else if (selectedAudio) {
    inspector = (
      <div className="p-2">
        <AudioTrackInspector key={selectedAudio.id} projectId={projectId} track={selectedAudio} durationSec={props?.durationSec ?? 0} onClose={clearSelection} />
      </div>
    );
  } else if (elementRefs.length > 1 && savedSpec?.ok) {
    inspector = <MultiElementInspector scene={scene} spec={savedSpec.spec} refs={elementRefs} frame={frameSize} actions={elementActions} layers={layers} onPatch={ops.patch} onSelectOne={(ref) => selectElement(scene.id, ref)} onClose={clearSelection} />;
  } else if (selectedMediaEntry) {
    inspector = (
      <SceneMediaInspector
        key={selectedMediaEntry.key}
        projectId={projectId}
        scene={scene}
        item={selectedMediaEntry.item}
        asset={props?.assets[selectedMediaEntry.item.element.assetId]}
        frame={frameSize}
        getTime={currentSec}
        onSeek={seek}
        focusZoomId={zoomFocus}
        onZoomSelect={setCanvasZoomId}
        onClose={clearSelection}
        onRemove={() => removeElements([selectedMediaEntry.item.ref])}
        onLoop={loopSelection ?? undefined}
        onOpenSpec={openSpec}
        blockedReason={blockedReason}
        actions={elementActions}
        layers={layers}
        focusedCue={focusedCue?.cue ?? null}
        onFocusCue={(cue) => selectElementCue(selectedMediaEntry.item.ref, cue)}
        focusedKeyframe={focusedKeyframe?.id ?? null}
        onFocusKeyframe={(id) => selectElementKeyframe(selectedMediaEntry.item.ref, id)}
      />
    );
  } else if (singleRef && selectedElement && savedSpec?.ok) {
    inspector = (
      <ElementInspector
        key={elementKey(scene.id, singleRef)}
        projectId={projectId}
        scene={scene}
        elementRef={singleRef}
        segment={segmentOf(singleRef)}
        element={selectedElement}
        frame={frameSize}
        blockedReason={blockedReason}
        onClose={clearSelection}
        onRemove={() => removeElements([singleRef])}
        onOpenSpec={openSpec}
        actions={elementActions}
        layers={layers}
        focusedCue={focusedCue?.cue ?? null}
        onFocusCue={(cue) => selectElementCue(singleRef, cue)}
        focusedKeyframe={focusedKeyframe?.id ?? null}
        onFocusKeyframe={(id) => selectElementKeyframe(singleRef, id)}
      />
    );
  } else {
    inspector = (
      <SceneInspector
        scene={scene}
        spec={effectiveSpec}
        events={events}
        player={player}
        fps={fps}
        nextScene={scenes[index + 1]}
        busy={busy}
        blockedReason={blockedReason}
        layers={layers}
        onSeek={seek}
        onMerge={() => merge.mutate({ sceneId: scene.id })}
        onRelock={() => relock.mutate({ sceneId: scene.id })}
        onDuplicate={() => duplicateScene.mutate({ sceneId: scene.id, key: scene.key })}
        onAddMedia={() => setMediaOpen(true)}
        index={index}
        onLook={(patch) => look.mutate({ sceneId: scene.id, patch })}
        onLock={() => lock.mutate(!scene.locked)}
        lockPending={lock.isPending}
        onApprove={() => approve.mutate(scene.needsReview || !approved)}
        approvePending={approve.isPending}
        onSplit={(atSec) => split.mutate({ sceneId: scene.id, key: scene.key, atSec })}
        onPreviewTransition={previewTransition}
        focus={selection?.kind === "scene" && selection.sceneId === scene.id ? (selection.focus ?? null) : null}
        onSelectScene={(key) => {
          select(key);
          clearSelection();
        }}
      />
    );
  }

  const toolbar = (
    <EditorToolbar
      projectId={projectId}
      scenes={scenes}
      scene={scene}
      onSelectScene={(key) => {
        select(key);
        clearSelection();
      }}
      onLock={() => lock.mutate(!scene.locked)}
      lockPending={lock.isPending}
      onApprove={() => approve.mutate(scene.needsReview || !approved)}
      approvePending={approve.isPending}
      onAskClaude={() => setAskOpen(true)}
      getSceneSec={() => currentSec() - scene.startSec}
      narrow={narrow}
      sideOpen={sideOpen}
      onToggleSide={() => setSideOpen((open) => !open)}
    />
  );

  const contextMenu = elementRefs.length ? (
    <ElementMenuItems actions={elementActions} kind="context" />
  ) : selectedOverlay ? (
    <OverlayContextMenuItems
      onRemove={() => {
        overlayOps.remove.mutate(selectedOverlay.id);
        clearSelection();
      }}
    />
  ) : (
    <SceneContextMenuItems sceneKey={scene.key} disabled={busy || !savedSpec?.ok} onDuplicate={() => duplicateScene.mutate({ sceneId: scene.id, key: scene.key })} />
  );

  const preview = previewProps ? (
    <PreviewPanel
      props={previewProps}
      player={player}
      playerRef={playerRef}
      scene={scene}
      words={words}
      playMode={playMode}
      onPlayMode={setPlayMode}
      range={loopRange}
      previewingDraft={!!draftSpec && specText?.text !== JSON.stringify(scene.spec, null, 2)}
      overlay={(stage) => (
        <CanvasOverlay
          stage={stage}
          player={player}
          fps={fps}
          frame={frameSize}
          sceneId={scene.id}
          selections={canvasSelections}
          selectedOverlayId={selectedOverlay?.id ?? null}
          zoomId={selectedMediaEntry ? canvasZoomId : null}
          contextMenu={contextMenu}
          apiRef={canvasApi}
          onSelectElement={selectElement}
          onSelectElements={selectMany}
          onSelectOverlay={selectOverlay}
          onClearSelection={clearSelection}
          onCommitLayout={(sel, patch, previewElement) => edits.commitLayout(sel.sceneId, sel.ref, sel.saved, patch, previewElement)}
          onCommitMove={(moves) => ops.move(moves.map((m) => ({ sceneId: m.selection.sceneId, ref: m.selection.ref, saved: m.selection.saved, shown: m.element, x: m.x, y: m.y, localSec: m.localSec, keyTolerance })), "drag")}
          onCommitZooms={(sel, zooms) => {
            if (isSceneMedia(sel.saved)) edits.commitMedia(sel.sceneId, sel.ref, sel.saved, { zooms });
          }}
          onSeek={seek}
        />
      )}
    />
  ) : (
    <div className="flex flex-1 p-3">
      <Skeleton className="flex-1 rounded-xl" />
    </div>
  );

  const side = (
    <SidePanel
      tab={sideTab}
      onTab={setSideTab}
      reviewBadge={sceneMetrics?.findings.length}
      onClose={narrow ? () => setSideOpen(false) : undefined}
      inspector={
        <InspectorEnvProvider value={inspectorEnv}>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{inspector}</div>
        </InspectorEnvProvider>
      }
      review={
        <ReviewPanel
          projectId={projectId}
          scene={scene}
          metrics={sceneMetrics}
          acts={planQ.data?.plan.storyArc?.acts ?? []}
          onAskClaude={() => setAskOpen(true)}
          tab={reviewTab}
          onTab={setReviewTab}
          specText={specDirty ? specText.text : null}
          onSpecText={(text) => setSpecText(text === null ? null : { sceneId: scene.id, text })}
        />
      }
    />
  );

  const timelineNode = timeline?.timeline ? (
    <TimelinePanel
      projectId={projectId}
      player={player}
      fps={fps}
      view={timeline}
      words={words}
      scenes={scenes}
      scene={scene}
      events={events}
      selectedEventIds={selectedEventIds}
      onSelectEvent={selectEvent}
      elements={
        elementLane
          ? {
              lane: elementLane,
              selectedKeys: new Set(elementRefs.map((ref) => elementKey(scene.id, ref))),
              focusedCue,
              blockedReason,
              defaultEnterSec: (props?.design.motion.defaultDuration ?? 0.6) * densityScale(savedSpec?.ok ? savedSpec.spec.motion?.density : undefined).duration,
              onSelect: (item, additive) => selectElement(scene.id, item.ref, additive),
              onSelectCue: (item, cue) => selectElementCue(item.ref, cue.id),
              focusedKeyframe,
              onSelectKeyframe: (item, keyframe) => selectElementKeyframe(item.ref, keyframe.id),
              onCommit: commitTiming,
            }
          : null
      }
      projectMarkers={projectMarkers}
      selectedMarkerId={selectedMarker?.id ?? null}
      onSelectMarker={selectMarker}
      transitions={transitions}
      selectedTransitionId={selection?.kind === "scene" && selection.focus === "transition" ? selection.sceneId : null}
      onSelectTransition={selectTransition}
      wordLane={{
        selected: wordSelection ? [wordSelection.first, wordSelection.last] : null,
        cueWords,
        onClick: clickWord,
        pick: wordPick ? { label: wordPick.label, onCancel: () => setWordPick(null) } : null,
      }}
      onSelectScene={(key) => {
        const target = scenes.find((s) => s.key === key);
        if (key !== scene.key) select(key);
        setSelection(target ? { kind: "scene", sceneId: target.id } : null);
        setZoomFocus(null);
      }}
      onBoundary={(id, timeSec, snap) => boundary.mutate({ sceneId: id, timeSec, snap })}
      onSplit={(at) => split.mutate({ sceneId: scene.id, key: scene.key, atSec: at })}
      busy={busy}
      lanes={lanes}
      onToggleLane={(lane, solo) => setLanes((l) => (solo ? { ...l, voice: lane === "voice", audio: lane === "audio" } : { ...l, [lane]: !l[lane] }))}
      onLoopSelection={loopSelection}
      overlay={{
        clips: overlayClips,
        selectedId: selectedOverlay?.id ?? null,
        onSelect: selectOverlay,
        onCommit: (id, patch) => overlayOps.update.mutate({ id, patch }),
        onAddAt: (t) => setAddOverlayAt(t),
        onCommitZooms: (id, zooms) => overlayOps.update.mutate({ id, patch: { zooms } }),
        onFocusZoom: (clipId, zoomId) => {
          selectOverlay(clipId);
          setZoomFocus(zoomId);
        },
        onRemove: (id) => {
          overlayOps.remove.mutate(id);
          if (selectedOverlay?.id === id) clearSelection();
        },
      }}
      media={{
        entries: mediaEntries,
        selectedKey: selectedMediaEntry?.key ?? null,
        onSelect: (entry) => selectElement(entry.sceneId, entry.item.ref),
        onCommitTiming: (entry, t) => saveMedia.mutate({ sceneId: entry.sceneId, ref: entry.item.ref, assetId: entry.item.element.assetId, patch: sceneMediaTimingPatch(entry, t) }),
        onCommitZooms: (entry, zooms) => saveMedia.mutate({ sceneId: entry.sceneId, ref: entry.item.ref, assetId: entry.item.element.assetId, patch: { zooms } }),
        onFocusZoom: (entry, zoomId) => {
          selectElement(entry.sceneId, entry.item.ref);
          setZoomFocus(zoomId);
          const zoom = entry.item.element.zooms?.find((z) => z.id === zoomId);
          if (zoom) seek(entry.item.appearSec + zoom.startSec);
        },
      }}
      audio={{
        tracks: audioTracks,
        selectedId: selectedAudio?.id ?? null,
        onSelect: selectAudio,
        onCommit: (id, patch) => audioOps.update.mutate({ id, patch }),
        onRemove: (id) => {
          audioOps.remove.mutate(id);
          if (selectedAudio?.id === id) clearSelection();
        },
        cuts: voiceCuts,
        voiceDurationSec: mixQ.data?.voiceDurationSec ?? timeline.voice?.durationSec ?? 0,
        onCutsCommit: (cuts) => saveCuts.mutate(cuts),
        cutsBusy: saveCuts.isPending,
        selectedCut,
        onSelectCut: (i) => setSelection((s) => (i === null ? (s?.kind === "voiceCut" ? null : s) : { kind: "voiceCut", index: i })),
        audioHref: `/projects/${projectId}/audio`,
      }}
    />
  ) : (
    <div className="flex h-full items-center justify-center p-4">
      <EmptyState
        title="No timeline yet"
        description="Scene timing comes from the aligned voice-over."
        action={
          <Button size="sm" asChild>
            <Link href={`/projects/${projectId}/voice`}>Open Voice</Link>
          </Button>
        }
      />
    </div>
  );

  return (
    <>
      <EditorShell toolbar={toolbar} preview={preview} side={side} timeline={timelineNode} sideOpen={sideOpen} onNarrowChange={setNarrow} />
      <AskClaudeDialog projectId={projectId} open={askOpen} onOpenChange={setAskOpen} scenes={[{ id: scene.id, key: scene.key }]} />
      {mediaOpen ? (
        <InsertMediaDialog projectId={projectId} open={mediaOpen} onOpenChange={setMediaOpen} sceneId={scene.id} onInsertedIntoScene={(insertedSceneId, elementId) => setPendingInsert({ sceneId: insertedSceneId, elementId })} />
      ) : null}
      {addOverlayAt !== null ? (
        <AddOverlayDialog
          projectId={projectId}
          open
          onOpenChange={(o) => !o && setAddOverlayAt(null)}
          startSec={addOverlayAt}
          onAdded={(clip) => {
            selectOverlay(clip.id);
            setAddOverlayAt(null);
          }}
        />
      ) : null}
    </>
  );
}
