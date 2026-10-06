"use client";

import type { PlayerRef } from "@remotion/player";
import { CircleHelp, Eye, EyeOff, Keyboard, Plus, Repeat, Scissors, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import type { Marker } from "@/core/spec/markers";
import type { Keyframe } from "@/core/spec/scene";
import type { TimedWord } from "@/core/spec/timing";
import type { CueId, ElementCue, SceneEvent } from "@/core/spec/triggers";
import { normalizeVoiceCuts, type AudioClipPatch, type VoiceCut } from "@/core/timeline/audio-clips";
import type { SceneMediaTiming } from "@/core/timeline/media-clip";
import type { OverlayZoom } from "@/core/timeline/overlay-zoom";
import type { OverlayTimingPatch } from "@/core/timeline/overlays";
import { secondsToFrames } from "@/core/timing/frames";
import { cn } from "@/lib/utils";
import type { AudioTrackDto } from "@/server/services/audio-tracks";
import type { OverlayClipDto } from "@/server/services/overlay-clips";
import type { SceneDto } from "@/server/services/scenes";
import type { getTimelineView } from "@/server/services/timeline";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AudioTrackEditor } from "../../timeline/audio-track-editor";
import { ElementLaneLabels, ElementTrackEditor, elementLaneLayout, useExpandedElements, type ElementLane, type ElementLaneItem, type ElementTimingCommit } from "../../timeline/element-track-editor";
import { OverlayTrackEditor } from "../../timeline/overlay-track-editor";
import { SceneMediaTrackEditor, type SceneMediaLaneEntry } from "../../timeline/scene-media-track-editor";
import { SceneTrackEditor, type TrackTransition } from "../../timeline/scene-track-editor";
import { TimelineTracks, type TrackMarker } from "../../timeline/timeline-tracks";
import { PLAYBACK_SHORTCUTS } from "../../timeline/use-playback-shortcuts";
import { VoiceCleanupButton } from "../../timeline/voice-cleanup-dialog";
import { VoiceCutEditor, VoiceCutsBar } from "../../timeline/voice-cut-editor";
import { humanize } from "./property-inputs";
import { usePlayerFrame } from "./use-player-frame";

type TimelineView = Awaited<ReturnType<typeof getTimelineView>>;

export type Lane = "media" | "overlays" | "voice" | "audio";

export interface OverlayLaneProps {
  clips: OverlayClipDto[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, patch: OverlayTimingPatch) => void;
  onAddAt: (timeSec: number) => void;
  onRemove: (id: string) => void;
  onCommitZooms: (id: string, zooms: OverlayZoom[]) => void;
  onFocusZoom: (clipId: string, zoomId: string) => void;
}

export interface AudioLaneProps {
  tracks: AudioTrackDto[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, patch: AudioClipPatch) => void;
  onRemove: (id: string) => void;
  cuts: VoiceCut[];
  voiceDurationSec: number;
  onCutsCommit: (cuts: VoiceCut[]) => void;
  cutsBusy: boolean;
  /** The selected muted section of the voice-over (part of the editor selection). */
  selectedCut: number | null;
  onSelectCut: (index: number | null) => void;
  audioHref: string;
}

export interface MediaLaneProps {
  entries: SceneMediaLaneEntry[];
  selectedKey: string | null;
  onSelect: (entry: SceneMediaLaneEntry) => void;
  onCommitTiming: (entry: SceneMediaLaneEntry, timing: SceneMediaTiming) => void;
  onCommitZooms: (entry: SceneMediaLaneEntry, zooms: OverlayZoom[]) => void;
  onFocusZoom: (entry: SceneMediaLaneEntry, zoomId: string) => void;
}

/** The current scene's elements as timing bars (see ElementTrackEditor). */
export interface ElementLaneProps {
  lane: ElementLane;
  selectedKeys: ReadonlySet<string>;
  focusedCue: { key: string; cue: CueId } | null;
  blockedReason: string | null;
  defaultEnterSec: number;
  onSelect: (item: ElementLaneItem, additive: boolean) => void;
  onSelectCue: (item: ElementLaneItem, cue: ElementCue) => void;
  /** The keyframe selected on a keyframe row or in the inspector. */
  focusedKeyframe: { key: string; id: string } | null;
  onSelectKeyframe: (item: ElementLaneItem, keyframe: Keyframe) => void;
  onCommit: (changes: ElementTimingCommit[]) => void;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/** Word selection on the words lane, and picking a word for a cue. */
export interface WordLaneProps {
  selected: readonly [number, number] | null;
  cueWords: ReadonlySet<number>;
  onClick: (index: number, extend: boolean) => void;
  pick: { label: string; onCancel: () => void } | null;
}

const LANE_LABELS: Record<Lane, string> = { media: "scene media", overlays: "overlays", voice: "the voice-over", audio: "music and sound effects" };

/** Show/hide (visual lanes) or mute (audio lanes) a lane in the player; Alt+click solos an audio lane. Preview only, never the render. */
function LaneToggle({ lane, on, onToggle }: { lane: Lane; on: boolean; onToggle: (lane: Lane, solo: boolean) => void }) {
  const audio = lane === "voice" || lane === "audio";
  const Icon = audio ? (on ? Volume2 : VolumeX) : on ? Eye : EyeOff;
  const label = `${on ? (audio ? "Mute" : "Hide") : audio ? "Unmute" : "Show"} ${LANE_LABELS[lane]} in the preview${audio ? " (Alt+click: solo)" : ""}`;
  return (
    <Button size="icon-xs" variant="ghost" className={cn(!on && "text-warning")} aria-label={label} title={`${label}. The render is not affected.`} onClick={(e) => onToggle(lane, audio && e.altKey)}>
      <Icon />
    </Button>
  );
}

/** Every editor shortcut, in a panel rather than a tooltip: a list this long is unreadable on hover. */
function ShortcutsButton() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="Keyboard shortcuts" title="Keyboard shortcuts">
          <Keyboard />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] p-0">
        <p className="border-b border-border px-3 py-2 text-xs font-medium">Keyboard shortcuts</p>
        <dl className="max-h-80 overflow-y-auto px-3 py-2 text-xs">
          {PLAYBACK_SHORTCUTS.map((s) => (
            <div key={s.keys} className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-baseline gap-2 py-0.5">
              <dt className="font-mono text-[11px] text-foreground">{s.keys}</dt>
              <dd className="text-muted-foreground">{s.action}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

function Tool({ label, children, ...props }: { label: React.ReactNode; "aria-label": string } & Omit<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button size="icon-xs" variant="ghost" {...props}>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm text-xs whitespace-pre-line">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

const HELP = [
  "Scenes — drag a boundary to re-time scenes. It snaps to the gap before a spoken word so both scenes stay audio-locked (hold Alt for free timing). The hatched band at a scene's start is its transition: click it to edit.",
  "Elements — each bar is when an element of this scene is on screen, its entrance and exit shaded. Drag a bar to move it (its timed cues move along), drag an edge to trim; it snaps to words, the playhead, markers and other elements (Alt: an exact time). A start dropped on a word is cued to that word. Shift+click selects several bars to move together.",
  "Cues — diamonds on a bar are its emphasis moments and actions; ringed ones follow the voice. Drag one to retime it, click it to edit it in the inspector, Delete removes it.",
  "Keyframes — an element with keyframes has a chevron on its bar: it opens one row per animated property (selecting the element opens them too). Click a keyframe to select it, drag it to change when it happens, double-click a row to add one; Delete removes it and [ / ] step between them. Keyframes count from when the element appears, so they move with it.",
  "Words — click a word to cue things to it (Shift+click for a phrase).",
  "Markers — diamonds under the ruler are project markers (M adds one), shot changes and transitions. Markers too close together group: click the group to choose one.",
  "Scene media — click an image or video to edit it in the inspector. Drag it to move, drag an edge to trim, drag a zoom bar to retime a zoom.",
  "Preview — Shift+click adds elements to the selection, dragging on empty picture selects several, the round handle rotates. Right-click for duplicate, layer order and alignment.",
  "Overlays — drag to move, drag an edge to trim, double-click the lane to add one.",
  "Voiceover — drag the bracket at either end to trim, or double-click the waveform to mute a section. Its timing never moves.",
  "Audio — drag a clip to move it, drag an edge to trim.",
  "Ctrl + wheel over the lanes zooms the timeline.",
].join("\n\n");

const toTrackScene = (s: SceneDto) => ({ id: s.id, key: s.key, name: s.name, startSec: s.startSec, endSec: s.endSec, timingMode: s.timingMode, locked: s.locked, staleTiming: s.staleTiming, stale: s.staleTiming, status: s.status });

/** The docked timeline of the scene editor, following the player's playhead. */
export function TimelinePanel({
  projectId,
  player,
  fps,
  view,
  words,
  scenes,
  scene,
  events,
  onSelectScene,
  onBoundary,
  onSplit,
  busy,
  overlay,
  media,
  audio,
  lanes,
  onToggleLane,
  onLoopSelection,
  selectedEventIds,
  onSelectEvent,
  elements,
  projectMarkers,
  selectedMarkerId,
  onSelectMarker,
  transitions,
  selectedTransitionId,
  onSelectTransition,
  wordLane,
}: {
  projectId: string;
  player: PlayerRef | null;
  fps: number;
  view: TimelineView;
  words: TimedWord[];
  scenes: SceneDto[];
  scene: SceneDto;
  events: SceneEvent[];
  onSelectScene: (key: string) => void;
  onBoundary: (sceneId: string, timeSec: number, snap: boolean) => void;
  onSplit: (atSec: number) => void;
  busy: boolean;
  overlay: OverlayLaneProps;
  media: MediaLaneProps;
  audio: AudioLaneProps;
  /** Which lanes the player shows or plays (preview only). */
  lanes: Record<Lane, boolean>;
  /** Show/hide or mute a lane; `solo` keeps only this audio lane audible. */
  onToggleLane: (lane: Lane, solo: boolean) => void;
  /** Loop the selected clip in the player (null when nothing loopable is selected). */
  onLoopSelection: (() => void) | null;
  /** Event element ids (see SceneEvent.elementId) of the selected elements: their markers are highlighted. */
  selectedEventIds?: ReadonlySet<string>;
  /** Clicking a marker selects what it belongs to. */
  onSelectEvent?: (event: SceneEvent) => void;
  /** The current scene's elements as timing bars; null when its spec is invalid (the ruler then shows every event). */
  elements: ElementLaneProps | null;
  /** Project markers on the ruler. */
  projectMarkers: readonly Marker[];
  selectedMarkerId: string | null;
  onSelectMarker: (id: string) => void;
  /** Each scene's transition in, on the scene track. */
  transitions: ReadonlyMap<string, TrackTransition>;
  selectedTransitionId: string | null;
  onSelectTransition: (sceneId: string) => void;
  wordLane?: WordLaneProps;
}) {
  const { frame } = usePlayerFrame(player);
  const { expanded, toggle: toggleExpanded } = useExpandedElements(elements?.lane ?? null, elements?.selectedKeys ?? NO_KEYS);
  const elementLayout = elementLaneLayout(elements?.lane ?? null, expanded);
  const tl = view.timeline!;
  const time = frame / fps;
  const seek = (t: number) => player?.seekTo(secondsToFrames(t, fps));
  // The ruler: project markers, and the scene's shot changes, transition and media cues. Element cues sit on their bars in the Elements lane.
  const onRuler = (e: SceneEvent) => !elements || e.kind === "shot" || e.elementId === "scene" || e.elementType === "image" || e.elementType === "video";
  const markers: TrackMarker[] = [
    ...projectMarkers.map((m): TrackMarker => ({ id: `m:${m.id}`, time: m.time, label: m.label || `${humanize(m.kind)} marker`, kind: m.kind, selected: m.id === selectedMarkerId })),
    ...events.flatMap((e, i): TrackMarker[] =>
      onRuler(e)
        ? [{ id: `e:${i}`, time: e.time, label: e.label, kind: e.kind === "shot" ? "shot" : e.elementId === "scene" ? "transition" : e.kind, ok: e.ok, voiceSynced: e.voiceSynced, selected: e.kind !== "shot" && !!selectedEventIds?.has(e.elementId) }]
        : [],
    ),
  ];
  const trackScenes = scenes.map(toTrackScene);
  const inside = time > scene.startSec + 0.25 && time < scene.endSec - 0.25;
  // The video runs to the end of the voice-over or the last scene, whichever is later.
  const videoEnd = Math.max(tl.durationSec, view.voice?.durationSec ?? 0, scenes[scenes.length - 1]?.endSec ?? 0);
  const shortcuts = PLAYBACK_SHORTCUTS.map((s) => `${s.keys} — ${s.action}`).join("\n");

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <TimelineTracks
        fill
        className="min-h-0 flex-1 rounded-none border-0"
        durationSec={videoEnd}
        fps={fps}
        voice={view.voice}
        words={words}
        sentences={tl.data.sentences}
        paragraphs={tl.data.paragraphs}
        scenes={trackScenes}
        markers={markers}
        onMarkerClick={(m) => {
          if (m.id?.startsWith("m:")) onSelectMarker(m.id.slice(2));
          else if (m.id?.startsWith("e:")) {
            const event = events[Number(m.id.slice(2))];
            if (event) onSelectEvent?.(event);
          }
        }}
        selectedSceneId={scene.id}
        externalTime={time}
        onSeek={seek}
        onWordClick={wordLane?.onClick}
        selectedWords={wordLane?.selected}
        cueWords={wordLane?.cueWords}
        wordPick={wordLane?.pick}
        headerActions={
          <div className="flex items-center gap-0.5 border-l border-border pl-2">
            <Tool aria-label="Split the scene at the playhead" label="Split this scene at the playhead (S) — snaps to the nearest word" disabled={!inside || scene.locked || busy} onClick={() => onSplit(time)}>
              <Scissors />
            </Tool>
            <Tool aria-label="Loop the selected clip" label="Loop the selected clip in the player (or set a loop range with I and O)" disabled={!onLoopSelection} onClick={() => onLoopSelection?.()}>
              <Repeat />
            </Tool>
            <VoiceCleanupButton words={words} cuts={audio.cuts} durationSec={audio.voiceDurationSec} onCommit={audio.onCutsCommit} onSeek={seek} busy={audio.cutsBusy} />
            <ShortcutsButton />
            <Tool aria-label="How the timeline works" label={HELP}>
              <CircleHelp />
            </Tool>
          </div>
        }
        renderSceneTrack={(ctx) => (
          <SceneTrackEditor
            ctx={ctx}
            scenes={trackScenes}
            words={words}
            selectedId={scene.id}
            onSelect={(id) => {
              const s = scenes.find((x) => x.id === id);
              if (s) onSelectScene(s.key);
            }}
            onCommitBoundary={onBoundary}
            busy={busy}
            transitions={transitions}
            selectedTransitionId={selectedTransitionId}
            onSelectTransition={onSelectTransition}
          />
        )}
        renderElementTrack={elements ? (ctx) => <ElementTrackEditor ctx={ctx} {...elements} markers={projectMarkers} fps={fps} expanded={expanded} onToggleExpand={toggleExpanded} /> : undefined}
        elementTrackHeight={elements ? elementLayout.height : undefined}
        elementLabel={<ElementLaneLabels layout={elementLayout} sceneKey={scene.key} currentTime={time} onToggle={toggleExpanded} />}
        renderMediaTrack={(ctx) => (
          <SceneMediaTrackEditor
            ctx={ctx}
            projectId={projectId}
            entries={media.entries}
            selectedKey={media.selectedKey}
            onSelect={media.onSelect}
            onCommitTiming={media.onCommitTiming}
            onCommitZooms={media.onCommitZooms}
            onFocusZoom={media.onFocusZoom}
          />
        )}
        mediaLabelAction={<LaneToggle lane="media" on={lanes.media} onToggle={onToggleLane} />}
        renderOverlayTrack={(ctx) => (
          <OverlayTrackEditor
            ctx={ctx}
            projectId={projectId}
            clips={overlay.clips}
            selectedId={overlay.selectedId}
            onSelect={overlay.onSelect}
            onCommit={overlay.onCommit}
            onAddAt={overlay.onAddAt}
            onRemove={overlay.onRemove}
            onCommitZooms={overlay.onCommitZooms}
            onFocusZoom={overlay.onFocusZoom}
            snapPoints={scenes.flatMap((s) => [s.startSec, s.endSec])}
            maxEndSec={videoEnd}
          />
        )}
        overlayLabelAction={
          <span className="flex items-center">
            <LaneToggle lane="overlays" on={lanes.overlays} onToggle={onToggleLane} />
            <Button size="icon-xs" variant="ghost" aria-label="Add an overlay at the playhead" title="Add an image or video overlay at the playhead — it can span scene cuts" onClick={() => overlay.onAddAt(time)}>
              <Plus />
            </Button>
          </span>
        }
        renderVoiceEdits={
          audio.voiceDurationSec > 0
            ? (ctx) => <VoiceCutEditor ctx={ctx} cuts={audio.cuts} durationSec={audio.voiceDurationSec} selected={audio.selectedCut} onSelect={audio.onSelectCut} onCommit={audio.onCutsCommit} busy={audio.cutsBusy} />
            : undefined
        }
        voiceLabelAction={
          audio.voiceDurationSec > 0 ? (
            <span className="flex items-center">
              <LaneToggle lane="voice" on={lanes.voice} onToggle={onToggleLane} />
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Mute a section of the voice-over at the playhead"
                title="Mute ½ s of the voice-over at the playhead (drag its edges to adjust)"
                onClick={() => audio.onCutsCommit(normalizeVoiceCuts([...audio.cuts, { startSec: time, endSec: time + 0.5 }], audio.voiceDurationSec))}
              >
                <Scissors />
              </Button>
            </span>
          ) : undefined
        }
        renderAudioTrack={(ctx) => (
          <AudioTrackEditor
            ctx={ctx}
            tracks={audio.tracks}
            selectedId={audio.selectedId}
            onSelect={audio.onSelect}
            onCommit={audio.onCommit}
            onRemove={audio.onRemove}
            snapPoints={scenes.flatMap((s) => [s.startSec, s.endSec])}
            videoEndSec={videoEnd}
          />
        )}
        audioLabelAction={
          <span className="flex items-center">
            <LaneToggle lane="audio" on={lanes.audio} onToggle={onToggleLane} />
            <Button size="icon-xs" variant="ghost" asChild>
              <Link href={audio.audioHref} aria-label="Add music or a sound effect" title="Add music or a sound effect (Audio page)">
                <Plus />
              </Link>
            </Button>
          </span>
        }
      />
      {audio.cuts.length ? (
        <div className="shrink-0 border-t border-border px-3 py-1">
          <VoiceCutsBar cuts={audio.cuts} onSeek={seek} onCommit={audio.onCutsCommit} busy={audio.cutsBusy} />
        </div>
      ) : null}
    </div>
  );
}
