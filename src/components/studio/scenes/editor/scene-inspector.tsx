"use client";

import type { PlayerRef } from "@remotion/player";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Combine, CopyPlus, Lock, LockOpen, Magnet, Play, Plus, Scissors, SkipBack } from "lucide-react";
import { DENSITY_INFO } from "@/core/creative/grammar";
import { CameraSchema, MOTION_DENSITIES, TRANSITIONS, validateSceneSpec, type SceneSpec, type Transition } from "@/core/spec/scene";
import type { SceneEvent } from "@/core/spec/triggers";
import type { SceneLookPatch } from "@/core/timeline/spec-patch";
import { formatClock } from "@/core/timing/frames";
import { cn } from "@/lib/utils";
import type { SceneDto } from "@/server/services/scenes";
import { Button } from "@/components/ui/button";
import { useInspectorEnv } from "./inspector-env";
import { InspectorSection, ScrubField } from "./inspector-section";
import { FieldHint, FieldRow, SegmentedField, SelectField } from "./property-fields";
import { humanize } from "./property-inputs";
import { usePlayerFrame } from "./use-player-frame";

function PlayheadTime({ player, fps, scene }: { player: PlayerRef | null; fps: number; scene: SceneDto }) {
  const { frame } = usePlayerFrame(player);
  const t = frame / fps;
  const inside = t >= scene.startSec && t < scene.endSec;
  return (
    <span className="font-mono">
      {formatClock(t, 2)}
      <span className="text-muted-foreground">{inside ? ` · ${(t - scene.startSec).toFixed(2)}s in` : " · outside the scene"}</span>
    </span>
  );
}

function SplitAtPlayhead({ player, fps, scene, disabled, onSplit }: { player: PlayerRef | null; fps: number; scene: SceneDto; disabled: boolean; onSplit: (timeSec: number) => void }) {
  const { frame } = usePlayerFrame(player);
  const t = frame / fps;
  const inside = t > scene.startSec + 0.25 && t < scene.endSec - 0.25;
  return (
    <Button size="xs" variant="outline" disabled={disabled || !inside} onClick={() => onSplit(t)} title={inside ? "Split this scene at the playhead (S) — both parts keep what's on screen" : "Move the playhead inside the scene to split it"}>
      <Scissors /> Split at playhead
    </Button>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

const TRANSITION_LABELS: Record<Transition["type"], string> = { none: "None", cut: "Cut", fade: "Fade", slide: "Slide", wipe: "Wipe", zoom: "Zoom", blur: "Blur", scale: "Scale", morph: "Morph" };
const DIRECTIONS: { value: "left" | "right" | "up" | "down"; label: string; icon: React.ReactNode }[] = [
  { value: "left", label: "Moving left", icon: <ArrowLeft /> },
  { value: "right", label: "Moving right", icon: <ArrowRight /> },
  { value: "up", label: "Moving up", icon: <ArrowUp /> },
  { value: "down", label: "Moving down", icon: <ArrowDown /> },
];
const CAMERAS = CameraSchema.shape.type.options.filter((c) => c !== "static");
const isAnimated = (t: Transition | null | undefined): t is Transition => !!t && t.type !== "none" && t.type !== "cut";

function transitionText(own: Transition | undefined, fallback: Transition | null, defaultSec: number): string {
  const t = own ?? fallback;
  if (!isAnimated(t)) return own ? "a cut" : "a cut (design default)";
  return `${t.type} ${t.duration ?? defaultSec}s${t.direction && (t.type === "slide" || t.type === "wipe") ? ` ${t.direction}` : ""}${own ? "" : " (design default)"}`;
}

function TransitionSection({
  spec,
  index,
  nextScene,
  disabled,
  focused,
  onLook,
  onPreview,
  onSelectScene,
}: {
  spec: SceneSpec;
  index: number;
  nextScene: SceneDto | undefined;
  disabled: boolean;
  /** Picked on the timeline's scene track. */
  focused: boolean;
  onLook: (patch: SceneLookPatch) => void;
  onPreview: () => void;
  onSelectScene: (key: string) => void;
}) {
  const env = useInspectorEnv();
  const design = env?.design ?? null;
  const own = spec.transitionIn;
  const fallback = design?.transition ?? null;
  const defaultSec = design?.motion.transitionDuration ?? 0.45;
  const effective = own ?? fallback;
  const animated = isAnimated(effective);
  const nextSpec = nextScene ? validateSceneSpec(nextScene.spec) : null;
  return (
    <InspectorSection id="scene.transition" title="Transition" focused={focused} summary={index === 0 ? "first scene" : transitionText(own, fallback, defaultSec)}>
      {index === 0 ? (
        <FieldHint>The first scene never transitions in.</FieldHint>
      ) : (
        <>
          <FieldRow label="In" onReset={own ? () => onLook({ transitionIn: null }) : undefined} disabled={disabled}>
            <SelectField
              value={own?.type}
              defaultLabel={`Design default (${fallback ? TRANSITION_LABELS[fallback.type].toLowerCase() : "fade"})`}
              options={TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABELS[t] }))}
              ariaLabel="Transition into this scene"
              disabled={disabled}
              onChange={(type) => onLook({ transitionIn: type ? { type } : null })}
            />
          </FieldRow>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
            <ScrubField
              label="Length"
              unit="s"
              value={animated ? (effective.duration ?? defaultSec) : null}
              placeholder="—"
              step={0.05}
              min={0.05}
              max={2}
              disabled={disabled || !animated}
              title="How long it takes; it plays over the end of the previous scene"
              onCommit={(n) => animated && onLook({ transitionIn: { type: effective.type, duration: n } })}
              onReset={own?.duration !== undefined ? () => onLook({ transitionIn: { duration: null } }) : undefined}
            />
            <Button size="xs" variant="outline" className="h-7" disabled={!animated} onClick={onPreview} title="Plays the cut into this scene in a loop (Esc clears the loop)">
              <Play /> Preview
            </Button>
          </div>
          {animated && (effective.type === "slide" || effective.type === "wipe") ? (
            <FieldRow label="Direction">
              <SegmentedField value={effective.direction ?? "left"} options={DIRECTIONS} ariaLabel="Direction" disabled={disabled} onChange={(d) => onLook({ transitionIn: { type: effective.type, direction: d === "left" ? null : d } })} />
            </FieldRow>
          ) : null}
        </>
      )}
      {nextScene ? (
        <FieldRow label="Out">
          <span className="min-w-0 flex-1 truncate text-[11px]">
            {nextScene.key} enters with {transitionText(nextSpec?.ok ? nextSpec.spec.transitionIn : undefined, fallback, defaultSec)}
          </span>
          <Button size="xs" variant="ghost" className="h-6 shrink-0" onClick={() => onSelectScene(nextScene.key)} title={`Open ${nextScene.key} to change how it enters`}>
            Edit
          </Button>
        </FieldRow>
      ) : (
        <FieldHint>This is the last scene.</FieldHint>
      )}
      <FieldHint>A transition plays over the end of the previous scene — this scene still starts on its word. Element entrances and exits are set on each element.</FieldHint>
    </InspectorSection>
  );
}

/** What the inspector shows with no element selected: the scene, its transition and look, its layers and its timed events. */
export function SceneInspector({
  scene,
  spec,
  events,
  player,
  fps,
  index,
  nextScene,
  busy,
  blockedReason,
  layers,
  onSeek,
  onMerge,
  onRelock,
  onDuplicate,
  onAddMedia,
  onLook,
  onLock,
  lockPending,
  onApprove,
  approvePending,
  onSplit,
  onPreviewTransition,
  onSelectScene,
  focus = null,
}: {
  scene: SceneDto;
  spec: SceneSpec | null;
  events: SceneEvent[];
  player: PlayerRef | null;
  fps: number;
  /** Position of the scene in the video (the first scene never transitions in). */
  index: number;
  nextScene: SceneDto | undefined;
  busy: boolean;
  /** Why the scene can't be edited right now (locked scene, unsaved spec), or null. */
  blockedReason: string | null;
  /** The scene's layers list. */
  layers: React.ReactNode;
  onSeek: (timeSec: number) => void;
  onMerge: () => void;
  onRelock: () => void;
  onDuplicate: () => void;
  onAddMedia: () => void;
  /** Transition, camera or motion density. */
  onLook: (patch: SceneLookPatch) => void;
  onLock: () => void;
  lockPending: boolean;
  onApprove: () => void;
  approvePending: boolean;
  onSplit: (timeSec: number) => void;
  onPreviewTransition: () => void;
  onSelectScene: (key: string) => void;
  /** The part of the scene picked on the timeline: its section opens and scrolls into view. */
  focus?: "transition" | null;
}) {
  const audioLocked = scene.timingMode === "audio_locked";
  const approved = scene.status === "approved";
  const status = scene.needsReview ? "Changed after approval" : approved ? "Approved" : "Draft";
  const count = spec ? spec.elements.length + (spec.shots ?? []).reduce((n, s) => n + s.elements.length, 0) : 0;
  const lookDisabled = !!blockedReason || !spec;

  return (
    <div>
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-track-scene/15 px-1.5 py-0.5 font-mono text-[10px] text-track-scene">{scene.key}</span>
          <span className="min-w-0 truncate text-sm font-medium">{scene.name}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Select an element on the canvas, in the layers or on the timeline to edit it.</p>
      </div>

      <InspectorSection id="scene.info" title="Scene" summary={`${scene.durationSec.toFixed(2)}s · ${status.toLowerCase()}`}>
        <div>
          <InfoRow label="Starts">
            <span className="font-mono">{formatClock(scene.startSec, 2)}</span>
          </InfoRow>
          <InfoRow label="Ends">
            <span className="font-mono">{formatClock(scene.endSec, 2)}</span>
          </InfoRow>
          <InfoRow label="Duration">
            <span className="font-mono">{scene.durationSec.toFixed(2)}s</span>
          </InfoRow>
          <InfoRow label="Timing">
            <span className={cn("inline-flex items-center gap-1", !audioLocked && "text-warning")}>
              {audioLocked ? <Lock className="size-3" /> : null}
              {audioLocked ? "Audio-locked" : "User-adjusted"}
            </span>
          </InfoRow>
          <InfoRow label="Status">
            {status} · v{scene.version}
            {scene.locked ? " · locked" : ""}
          </InfoRow>
          <InfoRow label="Playhead">
            <PlayheadTime player={player} fps={fps} scene={scene} />
          </InfoRow>
        </div>
        {scene.voiceText ? (
          <blockquote className="line-clamp-4 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs leading-snug" title={scene.voiceText}>
            “{scene.voiceText}”
          </blockquote>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant={scene.locked ? "secondary" : "outline"} disabled={lockPending} onClick={onLock} title={scene.locked ? "Unlock the scene to edit it" : "Lock the scene: nothing in it can be changed until it's unlocked"}>
            {scene.locked ? <LockOpen /> : <Lock />} {scene.locked ? "Unlock" : "Lock"}
          </Button>
          <Button size="xs" variant="outline" disabled={approvePending} onClick={onApprove} title={scene.needsReview ? "Approve the changes" : approved ? "Back to draft" : "Approve this scene"}>
            <Check /> {scene.needsReview ? "Approve changes" : approved ? "Mark as draft" : "Approve"}
          </Button>
          <Button size="xs" variant="outline" onClick={() => onSeek(scene.startSec)}>
            <SkipBack /> Go to start
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <SplitAtPlayhead player={player} fps={fps} scene={scene} disabled={scene.locked || busy} onSplit={onSplit} />
          <Button size="xs" variant="outline" disabled={!nextScene || scene.locked || nextScene.locked || busy} onClick={onMerge} title="Merge this scene with the next one — both designs are kept, as shots">
            <Combine /> Merge with next
          </Button>
          <Button size="xs" variant="outline" disabled={busy || !spec} onClick={onDuplicate} title="Copy this scene's design into a new scene after the last scene">
            <CopyPlus /> Duplicate
          </Button>
          {!audioLocked ? (
            <Button size="xs" variant="outline" disabled={scene.locked || busy} onClick={onRelock} title="Snap this scene's boundaries back to spoken words">
              <Magnet /> Re-lock to audio
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          The voice-over owns timing: drag scene boundaries on the timeline (they snap to words; Alt for free timing). Splitting keeps what&apos;s on screen on both sides of the cut; a duplicate goes after the last scene.
        </p>
      </InspectorSection>

      {spec ? (
        <>
          <TransitionSection spec={spec} index={index} nextScene={nextScene} disabled={lookDisabled} focused={focus === "transition"} onLook={onLook} onPreview={onPreviewTransition} onSelectScene={onSelectScene} />

          <InspectorSection id="scene.look" title="Camera & motion" summary={`${spec.camera ? spec.camera.type : "static"} · ${spec.motion?.density ?? "medium"}`}>
            <FieldRow label="Camera" onReset={spec.camera ? () => onLook({ camera: null }) : undefined} disabled={lookDisabled}>
              <SelectField value={spec.camera?.type} defaultLabel="Static" options={CAMERAS.map((c) => ({ value: c, label: humanize(c) }))} ariaLabel="Camera move" disabled={lookDisabled} onChange={(type) => onLook({ camera: type ? { type } : null })} />
            </FieldRow>
            {spec.camera ? (
              <ScrubField label="Amount" value={spec.camera.amount ?? 0.04} step={0.005} min={0} max={0.5} disabled={lookDisabled} title="How far the camera moves (0.04 is a gentle push-in)" onCommit={(n) => onLook({ camera: { amount: n } })} onReset={spec.camera.amount !== undefined ? () => onLook({ camera: { amount: null } }) : undefined} />
            ) : null}
            <FieldRow label="Density" onReset={spec.motion?.density ? () => onLook({ density: null }) : undefined} disabled={lookDisabled}>
              <SelectField
                value={spec.motion?.density}
                defaultLabel="Default (medium)"
                options={MOTION_DENSITIES.map((d) => ({ value: d, label: `${DENSITY_INFO[d].label} — ${DENSITY_INFO[d].use.toLowerCase()}` }))}
                ariaLabel="Motion density"
                disabled={lookDisabled}
                onChange={(density) => onLook({ density: density ?? null })}
              />
            </FieldRow>
            <FieldHint>The camera moves over the whole scene. Density scales the default length, travel, emphasis and idle motion of every element in it.</FieldHint>
          </InspectorSection>
        </>
      ) : null}

      <InspectorSection
        id="scene.layers"
        title="Layers"
        summary={String(count)}
        actions={
          <Button size="xs" variant="ghost" disabled={!!blockedReason} onClick={onAddMedia} title="Add an image or video to this scene">
            <Plus /> Media
          </Button>
        }
      >
        {!spec ? (
          <p className="text-xs text-destructive">This scene&apos;s spec is invalid — fix it in Review → Spec.</p>
        ) : (
          <>
            {blockedReason ? (
              <p className="text-[11px] text-muted-foreground">
                <Lock className="mr-1 inline size-3" />
                {blockedReason}
              </p>
            ) : null}
            {layers}
            <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">Background: {spec.background ? spec.background.type : "design system default"} — edit it in the scene spec.</p>
          </>
        )}
      </InspectorSection>

      <InspectorSection id="scene.events" title="Timed events" summary={String(events.length)} defaultOpen={false}>
        {events.length ? (
          <ul className="-mx-1.5 space-y-px">
            {events.map((e, i) => (
              <li key={i}>
                <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted/60" onClick={() => onSeek(e.time)}>
                  <span className="font-mono text-muted-foreground tabular-nums">{e.time.toFixed(2)}s</span>
                  <span className={cn("size-2 shrink-0 rotate-45 rounded-[1px]", !e.ok ? "bg-destructive" : e.kind === "emphasis" ? "bg-warning" : "bg-primary")} />
                  <span className="truncate">{e.label}</span>
                  {e.voiceSynced ? <span className="ml-auto shrink-0 text-[10px] text-track-voice">voice-synced</span> : null}
                </button>
                {!e.ok && e.reason ? <p className="px-1.5 pb-1 text-[10px] text-destructive">{e.reason}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No timed events.</p>
        )}
      </InspectorSection>
    </div>
  );
}
