"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Combine, Flag, GitCompare, Hammer, Layers, Loader2, Magnet, Plus, RefreshCcw, Scissors, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { densityScale } from "@/core/creative/grammar";
import { adjacentKeyframe, removeKeyframesPatch } from "@/core/motion/keyframes";
import { MarkerSchema, parseMarkers, type Marker } from "@/core/spec/markers";
import { validateSceneSpec } from "@/core/spec/scene";
import { effectiveTransition } from "@/core/spec/scene-transition";
import { elementCues, resolveShotWindows, type CueId, type TriggerContext } from "@/core/spec/triggers";
import { normalizeVoiceCuts } from "@/core/timeline/audio-clips";
import { cueLabel, cueRemovable } from "@/core/timeline/element-cues";
import { findElementAt, type ElementRef } from "@/core/timeline/element-layout";
import { sceneMediaKey, type SceneMediaRef } from "@/core/timeline/media-clip";
import { elementSpan, segmentOfElement } from "@/core/timeline/scene-restructure";
import { useAssets, useProjectScenes } from "../assets/asset-library";
import { SceneMediaInspector } from "../scenes/scene-media-inspector";
import { buildSceneMediaEntries, sceneMediaTimingPatch, useSceneMediaUpdate } from "../scenes/use-scene-media";
import { elementKey, useSettleElementDrafts } from "../scenes/editor/element-drafts";
import { ElementInspector } from "../scenes/editor/element-inspector";
import { elementName } from "../scenes/editor/element-summary";
import { InspectorEnvProvider, type InspectorEnv, type PlayheadSource } from "../scenes/editor/inspector-env";
import { MarkerInspector } from "../scenes/editor/marker-inspector";
import { selectCue, selectElements, selectKeyframe, toggleElement, type EditorSelection } from "../scenes/editor/selection";
import { layoutWithPatch, useElementEdits } from "../scenes/editor/use-element-edits";
import { useElementOps } from "../scenes/editor/use-element-ops";
import { WordInspector } from "../scenes/editor/word-inspector";
import { ElementLaneLabels, ElementTrackEditor, buildElementLane, elementLaneLayout, useExpandedElements, type ElementLaneLayout, type ElementTimingCommit } from "./element-track-editor";
import { SceneMediaTrackEditor } from "./scene-media-track-editor";
import { usePlaybackShortcuts } from "./use-playback-shortcuts";
import { VoiceCleanupButton } from "./voice-cleanup-dialog";
import { formatClock } from "@/core/timing/frames";
import type { compareTimelineCandidate, getTimelineView } from "@/server/services/timeline";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, Panel } from "../common";
import { EditHistoryControls } from "../history/edit-history-controls";
import { useWorkspace } from "../workspace/workspace-shell";
import { AddOverlayDialog } from "../overlays/add-overlay-dialog";
import { OverlayInspector } from "../overlays/overlay-inspector";
import { useOverlayClips, useOverlayMutations } from "../overlays/use-overlays";
import { AudioTrackInspector } from "../audio/audio-track-inspector";
import { useAudioTrackMutations, useAudioTracks, useVoiceCutsMutation, useVoiceMix } from "../audio/use-audio-edits";
import { AudioTrackEditor } from "./audio-track-editor";
import { OverlayTrackEditor } from "./overlay-track-editor";
import { VoiceCutEditor, VoiceCutsBar } from "./voice-cut-editor";
import { SceneTrackEditor, type TrackTransition } from "./scene-track-editor";
import { TimelineTracks, type TimelineHandle } from "./timeline-tracks";

type TimelineView = Awaited<ReturnType<typeof getTimelineView>>;
type Comparison = Awaited<ReturnType<typeof compareTimelineCandidate>>;
type ViewScene = TimelineView["scenes"][number];

const ROW_STATUS: Record<string, string> = {
  same: "text-muted-foreground",
  shifted: "text-info",
  changed: "text-warning",
  removed: "text-destructive",
};

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

function CompareDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useQuery({
    queryKey: ["project", projectId, "timeline-compare"],
    queryFn: async () => (await http.get<{ comparison: Comparison }>(`/api/projects/${projectId}/timeline/compare`)).comparison,
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compare timelines</DialogTitle>
          <DialogDescription>Current timeline vs. the timeline the new voice-over would produce. Nothing changes until you recalculate.</DialogDescription>
        </DialogHeader>
        {q.error ? <ErrorState error={q.error} /> : null}
        {!q.data ? (
          <Skeleton className="h-72" />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-6 text-sm">
              <span>
                Current: timeline v{q.data.old.version} · {formatClock(q.data.old.durationSec)} · {q.data.old.sentences} segments
              </span>
              <span>
                New: transcript v{q.data.new.transcriptVersion} · {formatClock(q.data.new.durationSec)} · {q.data.new.sentences} segments
              </span>
              <span className={q.data.durationDelta ? "text-warning" : "text-muted-foreground"}>
                Δ duration {q.data.durationDelta > 0 ? "+" : ""}
                {q.data.durationDelta.toFixed(2)}s
              </span>
            </div>
            <div className="max-h-72 overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-popover text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-normal">Segment</th>
                    <th className="px-3 py-2 font-normal">Current</th>
                    <th className="px-3 py-2 font-normal">New</th>
                    <th className="px-3 py-2 font-normal">Δ start</th>
                    <th className="px-3 py-2 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.rows.map((r, i) => (
                    <tr key={i} className="border-t border-border/60 align-top">
                      <td className="max-w-md px-3 py-2">
                        <p>{r.text}</p>
                        {r.newText && r.status === "changed" ? <p className="mt-1 text-xs text-warning">→ {r.newText}</p> : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {r.oldStart.toFixed(2)}–{r.oldEnd.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.newStart !== null ? `${r.newStart.toFixed(2)}–${r.newEnd?.toFixed(2)}` : "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.deltaStart !== null ? `${r.deltaStart > 0 ? "+" : ""}${r.deltaStart.toFixed(2)}s` : "—"}</td>
                      <td className={cn("px-3 py-2 text-xs capitalize", ROW_STATUS[r.status])}>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {q.data.scenes.length ? (
              <div>
                <p className="mb-2 text-sm font-medium">Scene impact</p>
                <div className="max-h-48 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <tbody>
                      {q.data.scenes.map((s) => {
                        const moved = Math.abs(s.newStart - s.oldStart) > 0.02 || Math.abs(s.newEnd - s.oldEnd) > 0.02;
                        return (
                          <tr key={s.key} className="border-t border-border/60 first:border-t-0">
                            <td className="px-3 py-1.5 font-mono text-xs">{s.key}</td>
                            <td className="px-3 py-1.5">{s.name}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{s.timingMode === "audio_locked" ? "audio-locked" : "user-adjusted (kept)"}</td>
                            <td className="px-3 py-1.5 font-mono text-xs">
                              {s.oldStart.toFixed(2)}–{s.oldEnd.toFixed(2)}
                            </td>
                            <td className={cn("px-3 py-1.5 font-mono text-xs", moved ? "text-info" : "text-muted-foreground")}>
                              → {s.newStart.toFixed(2)}–{s.newEnd.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SceneTimingPanel({
  projectId,
  scenes,
  selectedId,
  transition,
  getTime,
  busy,
  onRename,
  onSplit,
  onMerge,
  onRelock,
}: {
  projectId: string;
  scenes: ViewScene[];
  selectedId: string | null;
  /** The selected scene's transition in (none: it cuts in). */
  transition: TrackTransition | undefined;
  getTime: () => number;
  busy: boolean;
  onRename: (id: string, name: string) => void;
  onSplit: (id: string, atSec: number) => void;
  onMerge: (id: string) => void;
  onRelock: (id: string) => void;
}) {
  const scene = scenes.find((s) => s.id === selectedId) ?? null;
  const [name, setName] = useState(scene?.name ?? "");
  useEffect(() => setName(scene?.name ?? ""), [scene?.id, scene?.name]);
  if (!scene) {
    return (
      <Panel title="Scene timing" description="Select a scene on the scene track to rename, split or merge it and to see its elements.">
        <p className="text-sm text-muted-foreground">Drag the boundaries between scenes directly on the track. They snap to the gap before a spoken word, so scenes stay audio-locked; hold Alt while dragging for free timing.</p>
      </Panel>
    );
  }
  const idx = scenes.findIndex((s) => s.id === scene.id);
  const next = scenes[idx + 1];
  const canRename = !scene.locked && !!name.trim() && name.trim() !== scene.name && !busy;
  return (
    <Panel
      title={`${scene.key} · timing`}
      description={`${formatClock(scene.startSec, 2)}–${formatClock(scene.endSec, 2)} · ${(scene.endSec - scene.startSec).toFixed(2)}s · ${scene.timingMode === "audio_locked" ? "audio-locked" : "user-adjusted"}`}
      actions={
        <Button size="xs" variant="ghost" asChild>
          <Link href={`/projects/${projectId}/scenes?scene=${scene.key}`}>
            <Layers /> Scene editor
          </Link>
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input value={name} disabled={scene.locked} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canRename && onRename(scene.id, name.trim())} aria-label="Scene name" />
          <Button size="sm" variant="outline" disabled={!canRename} onClick={() => onRename(scene.id, name.trim())}>
            Rename
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={scene.locked || busy}
            onClick={() => {
              const t = getTime();
              if (t <= scene.startSec + 0.25 || t >= scene.endSec - 0.25) {
                toast.error("Move the playhead inside this scene first.");
                return;
              }
              onSplit(scene.id, t);
            }}
          >
            <Scissors /> Split at playhead
          </Button>
          <Button size="sm" variant="outline" disabled={!next || scene.locked || next.locked || busy} onClick={() => onMerge(scene.id)}>
            <Combine /> Merge with next
          </Button>
          {scene.timingMode === "user_adjusted" ? (
            <Button size="sm" variant="outline" disabled={scene.locked || busy} onClick={() => onRelock(scene.id)}>
              <Magnet /> Re-lock to audio
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {transition ? `Enters with ${transition.type} (${transition.duration.toFixed(2)}s${transition.own ? "" : ", the design default"}) over the end of the previous scene — ` : idx === 0 ? "The first scene never transitions in — " : "Cuts in — "}
          change it in the{" "}
          <Link className="underline underline-offset-2" href={`/projects/${projectId}/scenes?scene=${scene.key}`}>
            scene editor
          </Link>
          . Its elements are on the Elements lane.
        </p>
        {scene.locked ? <p className="text-xs text-muted-foreground">This scene is locked, so its timing can&apos;t change.</p> : null}
      </div>
    </Panel>
  );
}

function MarkerRow({ marker, onSeek, onRename, onDelete }: { marker: Marker; onSeek: () => void; onRename: (label: string) => void; onDelete: () => void }) {
  const [label, setLabel] = useState(marker.label);
  useEffect(() => setLabel(marker.label), [marker.label]);
  return (
    <li className="flex items-center gap-2 py-1.5">
      <button type="button" className="font-mono text-xs text-muted-foreground tabular-nums hover:text-foreground" onClick={onSeek}>
        {formatClock(marker.time, 2)}
      </button>
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label.trim() !== marker.label && onRename(label.trim())}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-7 text-sm"
        aria-label="Marker label"
      />
      <Button size="icon-xs" variant="ghost" onClick={onDelete} aria-label="Delete marker">
        <Trash2 />
      </Button>
    </li>
  );
}

function MarkersPanel({ markers, busy, getTime, onSeek, onChange }: { markers: Marker[]; busy: boolean; getTime: () => number; onSeek: (t: number) => void; onChange: (next: Marker[]) => void }) {
  const [label, setLabel] = useState("");
  const add = () => {
    const time = Math.round(getTime() * 1000) / 1000;
    onChange([...markers, { id: Math.random().toString(36).slice(2, 10), time, label: label.trim() || `Beat ${markers.length + 1}`, kind: "beat" }]);
    setLabel("");
  };
  return (
    <Panel title={`Markers (${markers.length})`} description="Creative beats and notes on the timeline. They never change the audio timing.">
      <div className="flex gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" onKeyDown={(e) => e.key === "Enter" && add()} aria-label="New marker label" />
        <Button size="sm" onClick={add} disabled={busy}>
          <Flag /> Add at playhead
        </Button>
      </div>
      {markers.length ? (
        <ul className="scrollbar-thin mt-3 max-h-56 divide-y divide-border overflow-auto">
          {markers.map((m) => (
            <MarkerRow
              key={m.id}
              marker={m}
              onSeek={() => onSeek(m.time)}
              onRename={(next) => onChange(markers.map((x) => (x.id === m.id ? { ...x, label: next } : x)))}
              onDelete={() => onChange(markers.filter((x) => x.id !== m.id))}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No markers yet.</p>
      )}
    </Panel>
  );
}

/** The Elements lane's labels, following the playhead (on this page it is the voice-over's). */
function PlayheadLaneLabels({ playhead, layout, sceneKey, onToggle }: { playhead: PlayheadSource; layout: ElementLaneLayout; sceneKey: string; onToggle: (key: string) => void }) {
  const time = useSyncExternalStore(playhead.subscribe, playhead.get, () => 0);
  return <ElementLaneLabels layout={layout} sceneKey={sceneKey} currentTime={time} onToggle={onToggle} />;
}

export function TimelinePage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const { project } = useWorkspace();
  const tracks = useRef<TimelineHandle>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(params.get("review") === "compare");
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const { data, error, refetch } = useQuery({
    queryKey: ["project", projectId, "timeline"],
    queryFn: async () => (await http.get<{ timeline: TimelineView }>(`/api/projects/${projectId}/timeline`)).timeline,
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });

  const recalc = useMutation({
    mutationFn: () => http.post<{ result: { version: number; remappedScenes: number; snapshotVersion: number | null } }>(`/api/projects/${projectId}/timeline/recalculate`),
    onSuccess: ({ result }) => {
      setConfirmOpen(false);
      toast.success(`Timeline v${result.version} built`, {
        description: result.remappedScenes ? `${result.remappedScenes} scenes re-timed · snapshot v${result.snapshotVersion} saved` : undefined,
      });
      invalidate();
    },
    onError: (e) => toast.error("Could not recalculate the timeline", { description: errorMessage(e) }),
  });
  const keep = useMutation({
    mutationFn: () => http.post(`/api/projects/${projectId}/timeline/keep`),
    onSuccess: () => {
      toast.success("Kept the existing timeline");
      invalidate();
    },
    onError: fail,
  });
  const boundary = useMutation({
    mutationFn: (v: { id: string; timeSec: number; snap: boolean }) => http.post(`/api/projects/${projectId}/scenes/${v.id}/boundary`, { timeSec: v.timeSec, snap: v.snap }),
    onSuccess: (_d, v) => {
      toast.success(v.snap ? "Boundary moved — scenes stay audio-locked" : "Boundary moved — scenes are now user-adjusted");
      invalidate();
    },
    onError: (e) => {
      fail(e);
      invalidate();
    },
  });
  const split = useMutation({
    mutationFn: (v: { id: string; atSec: number }) => http.post(`/api/projects/${projectId}/scenes/${v.id}/split`, { atSec: v.atSec }),
    onSuccess: () => {
      toast.success("Scene split");
      invalidate();
    },
    onError: fail,
  });
  const merge = useMutation({
    mutationFn: (id: string) => http.post(`/api/projects/${projectId}/scenes/${id}/merge`),
    onSuccess: () => {
      toast.success("Scenes merged");
      invalidate();
    },
    onError: fail,
  });
  const relock = useMutation({
    mutationFn: (id: string) => http.post(`/api/projects/${projectId}/scenes/${id}/relock`),
    onSuccess: () => {
      toast.success("Timing re-locked to the voice-over");
      invalidate();
    },
    onError: fail,
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => http.patch(`/api/projects/${projectId}/scenes/${v.id}`, { name: v.name }),
    onSuccess: () => {
      toast.success("Scene renamed");
      invalidate();
    },
    onError: fail,
  });
  const saveMarkers = useMutation({
    mutationFn: (markers: Marker[]) => http.put(`/api/projects/${projectId}/markers`, { markers }),
    onSuccess: invalidate,
    onError: fail,
  });
  const overlaysQ = useOverlayClips(projectId);
  const overlayOps = useOverlayMutations(projectId);
  // One selection, shared model with the scene editor: an overlay, an audio clip, a voice-over cut, elements, a word or a marker.
  const [selection, setSelection] = useState<EditorSelection>(null);
  const overlayId = selection?.kind === "overlay" ? selection.id : null;
  const setOverlayId = (id: string | null) => setSelection((s) => (id ? { kind: "overlay", id } : s?.kind === "overlay" ? null : s));
  const [addOverlayAt, setAddOverlayAt] = useState<number | null>(null);
  const audioQ = useAudioTracks(projectId);
  const audioOps = useAudioTrackMutations(projectId);
  const audioId = selection?.kind === "audio" ? selection.id : null;
  const setAudioId = (id: string | null) => setSelection((s) => (id ? { kind: "audio", id } : s?.kind === "audio" ? null : s));
  const mixQ = useVoiceMix(projectId);
  const saveCuts = useVoiceCutsMutation(projectId);
  const cutIndex = selection?.kind === "voiceCut" ? selection.index : null;
  const setCutIndex = (index: number | null) => setSelection((s) => (index !== null ? { kind: "voiceCut", index } : s?.kind === "voiceCut" ? null : s));
  const [zoomFocus, setZoomFocus] = useState<string | null>(null);
  // Images and videos inside scenes (the Scene media lane and its panel).
  const scenesQ = useProjectScenes(projectId);
  useSettleElementDrafts(scenesQ.data);
  const mediaAssetsQ = useAssets(projectId, ["video", "image", "screenshot"]);
  const saveMedia = useSceneMediaUpdate(projectId);
  const mediaSel = selection?.kind === "elements" && selection.refs.length === 1 ? { sceneId: selection.sceneId, ref: selection.refs[0] } : null;
  const setMediaSel = (value: { sceneId: string; ref: SceneMediaRef } | null) => setSelection((s) => (value ? selectElements(value.sceneId, [value.ref]) : s?.kind === "elements" ? null : s));
  const [mediaZoomFocus, setMediaZoomFocus] = useState<string | null>(null);
  const laneWords = data ? (data.voiceMatchesTimeline ? data.words : data.activeWords.length ? data.activeWords : data.words) : undefined;
  const mediaAssets = useMemo(() => Object.fromEntries((mediaAssetsQ.data ?? []).map((a) => [a.id, a])), [mediaAssetsQ.data]);
  const mediaEntries = useMemo(() => buildSceneMediaEntries(scenesQ.data ?? [], laneWords ?? [], mediaAssets), [scenesQ.data, laneWords, mediaAssets]);
  const timelineEnd = data ? Math.max(data.timeline?.durationSec ?? 0, data.voice?.durationSec ?? 0, ...data.scenes.map((s) => s.endSec)) : 0;

  // The selected scene's elements, cues and words — the same lane and inspectors as the scene editor.
  const edits = useElementEdits(projectId);
  const ops = useElementOps(projectId);
  const [wordPick, setWordPick] = useState<{ label: string; onPick: (index: number) => void } | null>(null);
  const playheadTime = useRef(0);
  const playheadListeners = useRef(new Set<() => void>());
  const playhead = useMemo<PlayheadSource>(
    () => ({
      subscribe: (listener) => {
        playheadListeners.current.add(listener);
        return () => {
          playheadListeners.current.delete(listener);
        };
      },
      get: () => playheadTime.current,
    }),
    [],
  );
  const onTime = useCallback((t: number) => {
    playheadTime.current = t;
    playheadListeners.current.forEach((listener) => listener());
  }, []);
  const selectedScene = scenesQ.data?.find((s) => s.id === selectedSceneId) ?? null;
  const selectedSpec = useMemo(() => (selectedScene ? validateSceneSpec(selectedScene.spec) : null), [selectedScene]);
  const elementLane = useMemo(() => (selectedScene && selectedSpec?.ok ? buildElementLane(selectedScene, selectedSpec.spec, laneWords ?? []) : null), [selectedScene, selectedSpec, laneWords]);
  const design = project?.design;
  const transitions = useMemo(() => {
    const map = new Map<string, TrackTransition>();
    if (!design) return map;
    (scenesQ.data ?? []).forEach((s, i) => {
      const v = validateSceneSpec(s.spec);
      const t = effectiveTransition(v.ok ? v.spec : {}, design, i);
      if (t) map.set(s.id, { type: t.type, duration: t.duration ?? 0, own: v.ok && !!v.spec.transitionIn });
    });
    return map;
  }, [scenesQ.data, design]);
  const projectMarkers = parseMarkers(project?.markers);
  const selectedMarker = selection?.kind === "marker" ? (projectMarkers.find((m) => m.id === selection.id) ?? null) : null;
  const elementSel = selection?.kind === "elements" && selectedScene && selection.sceneId === selectedScene.id ? selection : null;
  const singleRef = elementSel?.refs.length === 1 ? elementSel.refs[0] : null;
  const selectedElement = singleRef && selectedSpec?.ok ? findElementAt(selectedSpec.spec, singleRef) : null;
  const focusedCue = elementSel?.cue && singleRef && selectedScene ? { key: elementKey(selectedScene.id, singleRef), cue: elementSel.cue } : null;
  const focusedKeyframe = elementSel?.keyframe && singleRef && selectedScene ? { key: elementKey(selectedScene.id, singleRef), id: elementSel.keyframe } : null;
  const laneSelectedKeys = useMemo(() => new Set((elementSel?.refs ?? []).map((ref) => elementKey(elementSel?.sceneId ?? "", ref))), [elementSel]);
  const { expanded, toggle: toggleExpanded } = useExpandedElements(elementLane, laneSelectedKeys);
  const elementLayout = elementLaneLayout(elementLane, expanded);
  const elementBlocked = selectedScene?.locked ? "This scene is locked — unlock it in the scene editor to edit it." : null;
  /** Removes a selected emphasis moment, action, item cue or click (Delete). */
  const removeCue = (cue: CueId) => {
    if (!selectedScene || !singleRef || !selectedElement || elementBlocked || !cueRemovable(cue)) return;
    const patch = { cues: { [cue]: null } };
    edits.commitLayout(selectedScene.id, singleRef, selectedElement, patch, layoutWithPatch(selectedElement, patch, { sceneDurationSec: selectedScene.durationSec }));
    setSelection(selectElements(selectedScene.id, [singleRef]));
    toast.success(`Removed ${cueLabel(cue, selectedElement.type).toLowerCase()} of ${elementName(selectedElement, singleRef)}`, { description: "Press Ctrl+Z to undo." });
  };
  /** Removes a selected keyframe (Delete); a property left without keyframes keeps its value. */
  const removeKeyframe = (id: string) => {
    const keyframe = selectedElement?.keyframes?.find((k) => k.id === id);
    if (!selectedScene || !singleRef || !selectedElement || elementBlocked || !keyframe) return;
    const patch = removeKeyframesPatch(selectedElement, [id], keyframe.time);
    edits.commitLayout(selectedScene.id, singleRef, selectedElement, patch, layoutWithPatch(selectedElement, patch, { sceneDurationSec: selectedScene.durationSec }));
    setSelection(selectElements(selectedScene.id, [singleRef]));
    toast.success(`Removed a keyframe of ${elementName(selectedElement, singleRef)}`, { description: "Press Ctrl+Z to undo." });
  };

  usePlaybackShortcuts({
    getTime: () => tracks.current?.getTime() ?? 0,
    seek: (t) => tracks.current?.seek(t),
    toggle: () => tracks.current?.toggle(),
    fps: data?.fps ?? 30,
    durationSec: timelineEnd,
    enabled: !!data?.timeline,
    onSplit: (t) => {
      const scene = data?.scenes.find((s) => t > s.startSec + 0.25 && t < s.endSec - 0.25);
      if (scene) split.mutate({ id: scene.id, atSec: t });
    },
    onMarker: (t) => saveMarkers.mutate([...parseMarkers(project?.markers), MarkerSchema.parse({ id: `m${Date.now().toString(36)}`, time: Math.round(t * 1000) / 1000, label: "" })]),
    onEscape: () => {
      if (wordPick) {
        setWordPick(null);
        return true;
      }
      if (!selection) return false;
      setSelection(null);
      return true;
    },
    onDelete: () => {
      if (selectedMarker) {
        saveMarkers.mutate(projectMarkers.filter((m) => m.id !== selectedMarker.id));
        setSelection(null);
      } else if (focusedKeyframe) {
        removeKeyframe(focusedKeyframe.id);
      } else if (focusedCue) {
        removeCue(focusedCue.cue);
      }
    },
    onKeyframeStep: (direction) => {
      if (!selectedScene || !singleRef || !selectedElement?.keyframes?.length || !selectedSpec?.ok) return false;
      const segment = segmentOfElement(selectedSpec.spec, { start: selectedScene.startSec, end: selectedScene.endSec }, singleRef.shotId, laneWords ?? []);
      const appear = elementSpan(selectedElement, segment).appear;
      const now = tracks.current?.getTime() ?? 0;
      const property = focusedKeyframe ? selectedElement.keyframes.find((k) => k.id === focusedKeyframe.id)?.property : undefined;
      const next = adjacentKeyframe(selectedElement.keyframes, now - appear, direction, property ? [property] : undefined, 0.5 / (data?.fps ?? 30));
      if (next) {
        tracks.current?.seek(appear + next.time);
        setSelection(selectKeyframe(selectedScene.id, singleRef, next.id));
      }
      return true;
    },
  });

  if (error) return <div className="p-6"><ErrorState error={error} onRetry={() => void refetch()} /></div>;
  if (!data) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-20" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const tl = data.timeline;
  const kept = data.decision?.decision === "keep" && data.voice && data.decision.voiceTakeId === data.voice.id;
  const words = data.voiceMatchesTimeline ? data.words : data.activeWords.length ? data.activeWords : data.words;
  const markers = projectMarkers;
  const busy = boundary.isPending || split.isPending || merge.isPending || relock.isPending || rename.isPending;
  const getTime = () => tracks.current?.getTime() ?? 0;
  const overlayClips = overlaysQ.data ?? [];
  const selectedOverlay = overlayClips.find((c) => c.id === overlayId) ?? null;
  // The video runs to the end of the voice-over or the last scene, whichever is later.
  const videoEnd = Math.max(tl?.durationSec ?? 0, data.voice?.durationSec ?? 0, ...data.scenes.map((s) => s.endSec));
  const audioTracks = audioQ.data ?? [];
  const selectedAudio = audioTracks.find((t) => t.id === audioId) ?? null;
  const voiceCuts = mixQ.data?.mix.cuts ?? [];
  const voiceLength = mixQ.data?.voiceDurationSec ?? data.voice?.durationSec ?? 0;
  const selectedMediaKey = mediaSel ? sceneMediaKey(mediaSel.sceneId, mediaSel.ref) : null;
  const selectedMedia = selectedMediaKey ? (mediaEntries.find((e) => e.key === selectedMediaKey) ?? null) : null;
  const selectedMediaScene = selectedMedia ? (scenesQ.data?.find((s) => s.id === selectedMedia.sceneId) ?? null) : null;
  const selectedMediaAsset = selectedMedia ? mediaAssets[selectedMedia.item.element.assetId] : undefined;
  const openMedia = (entry: (typeof mediaEntries)[number], zoomId: string | null = null) => {
    setMediaSel({ sceneId: entry.sceneId, ref: entry.item.ref });
    setMediaZoomFocus(zoomId);
    setOverlayId(null);
    setAudioId(null);
    setSelectedSceneId(entry.sceneId);
  };

  /** The element's scene timing, narrowed to its shot (Timing and Cues). */
  const segmentOf = (ref: ElementRef): TriggerContext | null => {
    if (!selectedScene || !selectedSpec?.ok) return null;
    const base: TriggerContext = { words, sceneStart: selectedScene.startSec, sceneEnd: selectedScene.endSec };
    if (!ref.shotId) return base;
    const shotIndex = selectedSpec.spec.shots?.findIndex((s) => s.id === ref.shotId) ?? -1;
    const window = shotIndex >= 0 ? resolveShotWindows(selectedSpec.spec, base)[shotIndex] : undefined;
    return window ? { ...base, shotStart: window.start, shotEnd: window.end } : base;
  };
  const frame = { width: project?.width ?? 1920, height: project?.height ?? 1080 };
  const inspectorEnv: InspectorEnv = {
    design: project?.design ?? null,
    frame,
    assets: {},
    fonts: [],
    words,
    fps: data.fps,
    getTime,
    seek: (t) => tracks.current?.seek(t),
    measure: () => null,
    playhead,
    sentences: tl?.data.sentences ?? [],
    pickWord: (label, onPick) => setWordPick({ label, onPick }),
  };
  const wordSelection = selection?.kind === "word" && selectedScene && selection.sceneId === selectedScene.id ? selection : null;
  /** A word on the timeline: used for a cue waiting for one, else selected (Shift: a phrase) in its own scene. */
  const clickWord = (index: number, extend: boolean) => {
    const w = words[index];
    if (!w) return;
    if (wordPick) {
      setWordPick(null);
      wordPick.onPick(index);
      return;
    }
    const home = (scenesQ.data ?? []).find((s) => w.start >= s.startSec - 0.08 && w.start < s.endSec);
    tracks.current?.seek(w.start);
    if (!home) return;
    const previous = selection?.kind === "word" && selection.sceneId === home.id ? selection : null;
    const target = selection?.kind === "elements" && selection.sceneId === home.id && selection.refs.length === 1 ? selection.refs[0] : (previous?.target ?? null);
    setSelectedSceneId(home.id);
    setSelection(extend && previous ? { kind: "word", sceneId: home.id, first: Math.min(previous.first, index), last: Math.max(previous.last, index), target } : { kind: "word", sceneId: home.id, first: index, last: index, target });
  };
  const commitTiming = (changes: ElementTimingCommit[]) => {
    if (!selectedScene) return;
    if (elementBlocked) {
      toast(elementBlocked, { id: "timing-blocked" });
      return;
    }
    if (changes.length === 1) {
      const [change] = changes;
      edits.commitLayout(selectedScene.id, change.item.ref, change.item.saved, change.patch, change.preview);
    } else {
      ops.patch(changes.map((c) => ({ sceneId: selectedScene.id, ref: c.item.ref, saved: c.item.saved, patch: c.patch, preview: c.preview })));
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

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Timeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tl
              ? `Timeline v${tl.version} · ${tl.source === "imported" ? "imported timing" : "derived from word timing"} · transcript v${tl.transcriptVersion ?? "—"} · ${formatClock(tl.durationSec)} · ${data.fps} fps · built ${relativeTime(tl.createdAt)}`
              : "The master timeline is derived from the actual voice-over."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {tl ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-success" /> Voice timing is read-only — scenes reference it through word anchors.
            </div>
          ) : null}
          <EditHistoryControls projectId={projectId} />
        </div>
      </div>

      {data.candidate && tl ? (
        <div className={cn("rounded-xl border p-4", kept ? "border-border bg-muted/30" : "border-stale/40 bg-stale/10")}>
          <div className="flex flex-wrap items-start gap-3">
            <AlertTriangle className={cn("mt-0.5 size-5", kept ? "text-muted-foreground" : "text-stale")} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{kept ? "Using the existing timeline with the new voice-over" : "Voice-over changed. Existing scene timing may no longer match."}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {kept
                  ? `You chose to keep timeline v${tl.version} ${relativeTime(data.decision!.at)}. You can still recalculate at any time.`
                  : `Transcript v${data.candidate.version} (${data.candidate.source}) is newer than the one timeline v${tl.version} was built from. Nothing has been changed automatically.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setConfirmOpen(true)}>
                <RefreshCcw /> Recalculate timeline
              </Button>
              {!kept ? (
                <Button size="sm" variant="outline" onClick={() => keep.mutate()} disabled={keep.isPending}>
                  Keep existing timeline
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => setCompareOpen(true)}>
                <GitCompare /> Compare timelines
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!tl && data.candidate ? (
        <Panel title="Build the timeline" description={`Transcript v${data.candidate.version} is ready.`}>
          <Button onClick={() => recalc.mutate()} disabled={recalc.isPending}>
            {recalc.isPending ? <Loader2 className="animate-spin" /> : <Hammer />} Build timeline
          </Button>
        </Panel>
      ) : null}

      {!tl && !data.candidate ? (
        <EmptyState
          icon={<AlertTriangle />}
          title="No timeline yet"
          description="Precise timing only exists once real audio exists. Generate or import a voice-over and align it (or import SRT/VTT/JSON timestamps)."
          action={
            <Button size="sm" asChild>
              <Link href={`/projects/${projectId}/voice`}>Open Voice</Link>
            </Button>
          }
        />
      ) : null}

      {tl ? (
        <>
          <TimelineTracks
            ref={tracks}
            durationSec={videoEnd}
            fps={data.fps}
            voice={data.voice}
            words={words}
            sentences={tl.data.sentences}
            paragraphs={tl.data.paragraphs}
            scenes={data.scenes}
            markers={markers.map((m) => ({ id: `m:${m.id}`, time: m.time, label: m.label || "Marker", kind: m.kind, selected: m.id === selectedMarker?.id }))}
            onMarkerClick={(m) => {
              if (!m.id?.startsWith("m:")) return;
              const id = m.id.slice(2);
              const marker = markers.find((x) => x.id === id);
              setSelection({ kind: "marker", id });
              if (marker) tracks.current?.seek(marker.time);
            }}
            onTime={onTime}
            onWordClick={clickWord}
            selectedWords={wordSelection ? [wordSelection.first, wordSelection.last] : null}
            cueWords={cueWords}
            wordPick={wordPick ? { label: wordPick.label, onCancel: () => setWordPick(null) } : null}
            selectedSceneId={selectedSceneId}
            onSelectScene={setSelectedSceneId}
            renderSceneTrack={
              data.scenes.length
                ? (ctx) => (
                    <SceneTrackEditor
                      ctx={ctx}
                      scenes={data.scenes.map((s) => ({ ...s, staleTiming: s.stale }))}
                      words={words}
                      selectedId={selectedSceneId}
                      onSelect={setSelectedSceneId}
                      onCommitBoundary={(id, timeSec, snap) => boundary.mutate({ id, timeSec, snap })}
                      busy={busy}
                      transitions={transitions}
                      selectedTransitionId={null}
                      onSelectTransition={(id) => {
                        setSelectedSceneId(id);
                        const scene = data.scenes.find((s) => s.id === id);
                        if (scene) tracks.current?.seek(scene.startSec);
                      }}
                    />
                  )
                : undefined
            }
            renderElementTrack={(ctx) =>
              elementLane ? (
                <ElementTrackEditor
                  ctx={ctx}
                  lane={elementLane}
                  selectedKeys={new Set((elementSel?.refs ?? []).map((ref) => elementKey(elementLane.sceneId, ref)))}
                  focusedCue={focusedCue}
                  blockedReason={elementBlocked}
                  markers={markers}
                  defaultEnterSec={(project?.design?.motion.defaultDuration ?? 0.6) * densityScale(selectedSpec?.ok ? selectedSpec.spec.motion?.density : undefined).duration}
                  onSelect={(item, additive) => setSelection((s) => (additive ? toggleElement(s, elementLane.sceneId, item.ref) : selectElements(elementLane.sceneId, [item.ref])))}
                  onSelectCue={(item, cue) => setSelection(selectCue(elementLane.sceneId, item.ref, cue.id))}
                  focusedKeyframe={focusedKeyframe}
                  onSelectKeyframe={(item, keyframe) => setSelection(selectKeyframe(elementLane.sceneId, item.ref, keyframe.id))}
                  fps={data.fps}
                  expanded={expanded}
                  onToggleExpand={toggleExpanded}
                  onCommit={commitTiming}
                />
              ) : (
                <span className="pointer-events-none sticky left-[calc(var(--tl-labels,0px)+0.5rem)] mt-1.5 inline-block text-[11px] text-muted-foreground">Select a scene on the scene track to see its elements</span>
              )
            }
            elementTrackHeight={elementLane ? elementLayout.height : undefined}
            elementLabel={<PlayheadLaneLabels playhead={playhead} layout={elementLayout} sceneKey={selectedScene?.key ?? "no scene"} onToggle={toggleExpanded} />}
            renderMediaTrack={(ctx) => (
              <SceneMediaTrackEditor
                ctx={ctx}
                projectId={projectId}
                entries={mediaEntries}
                selectedKey={selectedMediaKey}
                onSelect={(entry) => openMedia(entry)}
                onCommitTiming={(entry, timing) => saveMedia.mutate({ sceneId: entry.sceneId, ref: entry.item.ref, assetId: entry.item.element.assetId, patch: sceneMediaTimingPatch(entry, timing) })}
                onCommitZooms={(entry, zooms) => saveMedia.mutate({ sceneId: entry.sceneId, ref: entry.item.ref, assetId: entry.item.element.assetId, patch: { zooms } })}
                onFocusZoom={(entry, zoomId) => {
                  openMedia(entry, zoomId);
                  const zoom = entry.item.element.zooms?.find((z) => z.id === zoomId);
                  if (zoom) tracks.current?.seek(entry.item.appearSec + zoom.startSec);
                }}
              />
            )}
            renderOverlayTrack={(ctx) => (
              <OverlayTrackEditor
                ctx={ctx}
                projectId={projectId}
                clips={overlayClips}
                selectedId={overlayId}
                onSelect={setOverlayId}
                onCommit={(id, patch) => overlayOps.update.mutate({ id, patch })}
                onAddAt={(t) => setAddOverlayAt(t)}
                onRemove={(id) => {
                  overlayOps.remove.mutate(id);
                  if (overlayId === id) setOverlayId(null);
                }}
                onCommitZooms={(id, zooms) => overlayOps.update.mutate({ id, patch: { zooms } })}
                onFocusZoom={(clipId, zoomId) => {
                  setOverlayId(clipId);
                  setZoomFocus(zoomId);
                }}
                snapPoints={data.scenes.flatMap((s) => [s.startSec, s.endSec])}
                maxEndSec={videoEnd}
              />
            )}
            overlayLabelAction={
              <Button size="icon-xs" variant="ghost" aria-label="Add overlay at the playhead" title="Add overlay at the playhead" onClick={() => setAddOverlayAt(getTime())}>
                <Plus />
              </Button>
            }
            renderVoiceEdits={
              voiceLength > 0
                ? (ctx) => <VoiceCutEditor ctx={ctx} cuts={voiceCuts} durationSec={voiceLength} selected={cutIndex} onSelect={setCutIndex} onCommit={(cuts) => saveCuts.mutate(cuts)} busy={saveCuts.isPending} />
                : undefined
            }
            voiceLabelAction={
              voiceLength > 0 ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Mute a section of the voice-over at the playhead"
                  title="Mute ½ s of the voice-over at the playhead (drag its edges to adjust)"
                  onClick={() => {
                    const t = getTime();
                    saveCuts.mutate(normalizeVoiceCuts([...voiceCuts, { startSec: t, endSec: t + 0.5 }], voiceLength));
                  }}
                >
                  <Scissors />
                </Button>
              ) : undefined
            }
            renderAudioTrack={(ctx) => (
              <AudioTrackEditor
                ctx={ctx}
                tracks={audioTracks}
                selectedId={audioId}
                onSelect={setAudioId}
                onCommit={(id, patch) => audioOps.update.mutate({ id, patch })}
                onRemove={(id) => {
                  audioOps.remove.mutate(id);
                  if (audioId === id) setAudioId(null);
                }}
                snapPoints={data.scenes.flatMap((s) => [s.startSec, s.endSec])}
                videoEndSec={videoEnd}
              />
            )}
            audioLabelAction={
              <Button size="icon-xs" variant="ghost" asChild>
                <Link href={`/projects/${projectId}/audio`} aria-label="Add music or a sound effect" title="Add music or a sound effect (Audio page)">
                  <Plus />
                </Link>
              </Button>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            {voiceLength > 0 ? <VoiceCleanupButton words={words} cuts={voiceCuts} durationSec={voiceLength} onCommit={(cuts) => saveCuts.mutate(cuts)} onSeek={(t) => tracks.current?.seek(t)} busy={saveCuts.isPending} /> : null}
            <VoiceCutsBar cuts={voiceCuts} onSeek={(t) => tracks.current?.seek(t)} onCommit={(cuts) => saveCuts.mutate(cuts)} busy={saveCuts.isPending} />
          </div>
          {selectedAudio ? <AudioTrackInspector key={selectedAudio.id} projectId={projectId} track={selectedAudio} durationSec={videoEnd} onClose={() => setAudioId(null)} /> : null}
          {selectedOverlay ? (
            <OverlayInspector
              key={selectedOverlay.id}
              className="overflow-hidden rounded-xl border border-border bg-card"
              clip={selectedOverlay}
              getTime={getTime}
              onPatch={(patch) => overlayOps.update.mutate({ id: selectedOverlay.id, patch })}
              onRemove={() => {
                overlayOps.remove.mutate(selectedOverlay.id);
                setOverlayId(null);
              }}
              onClose={() => setOverlayId(null)}
              onSeek={(t) => tracks.current?.seek(t)}
              onSplit={(atSec, removeUntilSec) => overlayOps.split.mutate({ id: selectedOverlay.id, atSec, removeUntilSec })}
              frame={frame}
              focusZoomId={zoomFocus}
              projectId={projectId}
            />
          ) : null}
          <InspectorEnvProvider value={inspectorEnv}>
            {selectedMedia && selectedMediaScene ? (
              <SceneMediaInspector
                key={selectedMedia.key}
                className="overflow-hidden rounded-xl border border-border bg-card"
                projectId={projectId}
                scene={selectedMediaScene}
                item={selectedMedia.item}
                asset={
                  selectedMediaAsset
                    ? { id: selectedMediaAsset.id, kind: selectedMediaAsset.kind, name: selectedMediaAsset.name, src: selectedMediaAsset.url, mimeType: selectedMediaAsset.mimeType, width: selectedMediaAsset.width, height: selectedMediaAsset.height, durationSec: selectedMediaAsset.durationSec }
                    : undefined
                }
                frame={frame}
                getTime={getTime}
                onSeek={(t) => tracks.current?.seek(t)}
                focusZoomId={mediaZoomFocus}
                onClose={() => setMediaSel(null)}
                blockedReason={selectedMediaScene.locked ? "This scene is locked — unlock it to edit its media." : null}
                focusedCue={focusedCue?.cue ?? null}
                onFocusCue={(cue) => setSelection(cue ? selectCue(selectedMedia.sceneId, selectedMedia.item.ref, cue) : selectElements(selectedMedia.sceneId, [selectedMedia.item.ref]))}
                focusedKeyframe={focusedKeyframe?.id ?? null}
                onFocusKeyframe={(id) => setSelection(id ? selectKeyframe(selectedMedia.sceneId, selectedMedia.item.ref, id) : selectElements(selectedMedia.sceneId, [selectedMedia.item.ref]))}
              />
            ) : null}
            {selectedScene && selectedElement && singleRef && !selectedMedia ? (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <ElementInspector
                  key={elementKey(selectedScene.id, singleRef)}
                  projectId={projectId}
                  scene={selectedScene}
                  elementRef={singleRef}
                  element={selectedElement}
                  frame={frame}
                  segment={segmentOf(singleRef)}
                  blockedReason={elementBlocked}
                  onClose={() => setSelection(null)}
                  onRemove={() => void ops.operate([{ sceneId: selectedScene.id, ref: singleRef, saved: selectedElement }], { op: "remove" }).then((after) => after && setSelection(null))}
                  onOpenSpec={() => router.push(`/projects/${projectId}/scenes?scene=${selectedScene.key}`)}
                  focusedCue={focusedCue?.cue ?? null}
                  onFocusCue={(cue) => setSelection(cue ? selectCue(selectedScene.id, singleRef, cue) : selectElements(selectedScene.id, [singleRef]))}
                  focusedKeyframe={focusedKeyframe?.id ?? null}
                  onFocusKeyframe={(id) => setSelection(id ? selectKeyframe(selectedScene.id, singleRef, id) : selectElements(selectedScene.id, [singleRef]))}
                />
              </div>
            ) : null}
            {wordSelection && selectedScene && selectedSpec?.ok ? (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <WordInspector
                  scene={selectedScene}
                  spec={selectedSpec.spec}
                  words={words}
                  sentences={tl.data.sentences}
                  first={wordSelection.first}
                  last={wordSelection.last}
                  target={wordSelection.target}
                  blockedReason={elementBlocked}
                  onCommit={(ref, saved, patch, focus) => {
                    if (elementBlocked) return;
                    edits.commitLayout(selectedScene.id, ref, saved, patch, layoutWithPatch(saved, patch, { sceneDurationSec: selectedScene.durationSec }));
                    toast.success(focus ? `Cued ${elementName(saved, ref)} · ${cueLabel(focus, saved.type).toLowerCase()}` : `Updated ${elementName(saved, ref)}`, { description: "Press Ctrl+Z to undo." });
                  }}
                  onSelectCue={(ref, cue) => setSelection(selectCue(selectedScene.id, ref, cue))}
                  onTarget={(ref) => setSelection({ ...wordSelection, target: ref })}
                  onClose={() => setSelection(null)}
                />
              </div>
            ) : null}
          </InspectorEnvProvider>
          {elementSel && elementSel.refs.length > 1 && selectedScene ? (
            <Panel title={`${elementSel.refs.length} elements selected`} description="Drag one of their bars to move them together — one undo step.">
              <Button size="sm" variant="outline" asChild>
                <Link href={`/projects/${projectId}/scenes?scene=${selectedScene.key}`}>
                  <Layers /> Edit them together in the scene editor
                </Link>
              </Button>
            </Panel>
          ) : null}
          {selectedMarker ? (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <MarkerInspector
                key={selectedMarker.id}
                marker={selectedMarker}
                durationSec={videoEnd}
                busy={saveMarkers.isPending}
                onChange={(next) => saveMarkers.mutate(markers.map((m) => (m.id === next.id ? next : m)))}
                onDelete={() => {
                  saveMarkers.mutate(markers.filter((m) => m.id !== selectedMarker.id));
                  setSelection(null);
                }}
                onSeek={(t) => tracks.current?.seek(t)}
                onClose={() => setSelection(null)}
              />
            </div>
          ) : null}
          {data.scenes.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <SceneTimingPanel
                projectId={projectId}
                scenes={data.scenes}
                selectedId={selectedSceneId}
                transition={selectedSceneId ? transitions.get(selectedSceneId) : undefined}
                getTime={getTime}
                busy={busy}
                onRename={(id, name) => rename.mutate({ id, name })}
                onSplit={(id, atSec) => split.mutate({ id, atSec })}
                onMerge={(id) => merge.mutate(id)}
                onRelock={(id) => relock.mutate(id)}
              />
              <MarkersPanel markers={markers} busy={saveMarkers.isPending} getTime={getTime} onSeek={(t) => tracks.current?.seek(t)} onChange={(next) => saveMarkers.mutate(next)} />
            </div>
          ) : (
            <MarkersPanel markers={markers} busy={saveMarkers.isPending} getTime={getTime} onSeek={(t) => tracks.current?.seek(t)} onChange={(next) => saveMarkers.mutate(next)} />
          )}
          <Panel title={`Segments (${tl.data.sentences.length})`} description="Actual timing from the audio. Scene boundaries snap to these words.">
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-normal">#</th>
                    <th className="py-2 pr-3 font-normal">Text</th>
                    <th className="py-2 pr-3 font-normal">Start</th>
                    <th className="py-2 pr-3 font-normal">End</th>
                    <th className="py-2 pr-3 font-normal">Duration</th>
                    <th className="py-2 font-normal">¶</th>
                  </tr>
                </thead>
                <tbody>
                  {tl.data.sentences.map((s, i) => (
                    <tr key={s.id} className="cursor-pointer border-b border-border/50 hover:bg-muted/30" onClick={() => tracks.current?.seek(s.start)}>
                      <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{i + 1}</td>
                      <td className="py-1.5 pr-3">{s.text}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{s.start.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{s.end.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{(s.end - s.start).toFixed(2)}s</td>
                      <td className="py-1.5 font-mono text-xs text-muted-foreground">{(s.paragraph ?? 0) + 1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recalculate the timeline?</DialogTitle>
            <DialogDescription>
              Builds a new timeline from transcript v{data.candidate?.version ?? "—"}. Audio-locked scenes move to the matching words of the new voice-over; user-adjusted scenes keep
              their times. A project snapshot is saved first, and every scene keeps its version history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => recalc.mutate()} disabled={recalc.isPending}>
              {recalc.isPending ? <Loader2 className="animate-spin" /> : <RefreshCcw />} Recalculate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CompareDialog projectId={projectId} open={compareOpen} onOpenChange={setCompareOpen} />
      {addOverlayAt !== null ? (
        <AddOverlayDialog
          projectId={projectId}
          open
          onOpenChange={(o) => !o && setAddOverlayAt(null)}
          startSec={addOverlayAt}
          onAdded={(clip) => {
            setOverlayId(clip.id);
            setAddOverlayAt(null);
          }}
        />
      ) : null}
    </div>
  );
}
