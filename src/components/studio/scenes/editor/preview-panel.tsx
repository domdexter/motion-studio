"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { AlertTriangle, Maximize, Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioVideoProps } from "@/core/spec/composition";
import type { TimedWord } from "@/core/spec/timing";
import { replaceElementAt } from "@/core/timeline/element-layout";
import { durationToTotalFrames, formatClock, secondsToFrames } from "@/core/timing/frames";
import { cn } from "@/lib/utils";
import { StudioVideo } from "@/remotion/StudioVideo";
import type { SceneDto } from "@/server/services/scenes";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useElementDrafts } from "./element-drafts";
import { usePlayerFrame } from "./use-player-frame";

export type PlayMode = "scene" | "range" | "all";
type ViewZoom = "fit" | "0.25" | "0.5" | "1";

/** The picture on screen: its size in CSS pixels and the scale from video pixels. */
export interface StageGeometry {
  width: number;
  height: number;
  scale: number;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function Transport({
  player,
  fps,
  durationSec,
  scene,
  words,
  playMode,
  onPlayMode,
  range,
  zoom,
  onZoom,
}: {
  player: PlayerRef | null;
  fps: number;
  durationSec: number;
  scene: SceneDto;
  words: TimedWord[];
  playMode: PlayMode;
  onPlayMode: (mode: PlayMode) => void;
  range: { in: number; out: number } | null;
  zoom: ViewZoom;
  onZoom: (zoom: ViewZoom) => void;
}) {
  const { frame, playing } = usePlayerFrame(player);
  const total = Math.max(1, durationToTotalFrames(durationSec, fps));
  const t = frame / fps;
  const word = words.find((w) => t >= w.start && t <= w.end);
  const go = (f: number) => player?.seekTo(Math.max(0, Math.min(total - 1, f)));
  const modes: { mode: PlayMode; label: string; title: string }[] = [
    { mode: "scene", label: "Loop scene", title: "Play this scene on a loop" },
    ...(range ? [{ mode: "range" as const, label: `Loop ${formatClock(range.in, 1)}–${formatClock(range.out, 1)}`, title: "Play the loop range (I and O set it, Esc clears it)" }] : []),
    { mode: "all", label: "Whole video", title: "Play the whole video" },
  ];
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-t border-border bg-panel px-2">
      <Button size="icon-sm" variant="ghost" onClick={() => go(secondsToFrames(scene.startSec, fps))} aria-label="Go to the scene start" title="Go to the scene start">
        <SkipBack />
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => go(frame - 1)} aria-label="Back one frame" title="Back one frame (←)">
        <StepBack />
      </Button>
      <Button size="icon-sm" variant="secondary" onClick={() => player?.toggle()} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"}>
        {playing ? <Pause /> : <Play />}
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => go(frame + 1)} aria-label="Forward one frame" title="Forward one frame (→)">
        <StepForward />
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={() => go(secondsToFrames(scene.endSec, fps) - 1)} aria-label="Go to the scene end" title="Go to the scene end">
        <SkipForward />
      </Button>
      <span className="ml-1.5 font-mono text-xs whitespace-nowrap tabular-nums">
        {formatClock(t, 2)}
        <span className="text-muted-foreground"> / {formatClock(durationSec, 2)}</span>
      </span>
      {word ? <span className="ml-1.5 hidden max-w-40 truncate rounded bg-track-voice/15 px-1.5 py-0.5 text-[11px] @2xl:inline">“{word.text}”</span> : null}
      <div className="ml-auto flex items-center gap-1">
        <div className="flex overflow-hidden rounded-md border border-border text-[11px]" role="group" aria-label="Playback range">
          {modes.map(({ mode, label, title }) => (
            <button key={mode} type="button" title={title} aria-pressed={playMode === mode} onClick={() => onPlayMode(mode)} className={cn("px-2 py-1 whitespace-nowrap", playMode === mode ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
        <Select value={zoom} onValueChange={(v) => onZoom(v as ViewZoom)}>
          <SelectTrigger size="sm" className="h-7 w-[4.6rem] text-[11px]" aria-label="Preview zoom" title="Preview zoom">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fit">Fit</SelectItem>
            <SelectItem value="0.25">25%</SelectItem>
            <SelectItem value="0.5">50%</SelectItem>
            <SelectItem value="1">100%</SelectItem>
          </SelectContent>
        </Select>
        <Button size="icon-sm" variant="ghost" onClick={() => player?.requestFullscreen()} aria-label="Fullscreen" title="Fullscreen">
          <Maximize />
        </Button>
      </div>
    </div>
  );
}

/**
 * The preview: the Remotion player sized to fit its panel (or zoomed), playback controls under it, and
 * an optional interactive layer over the picture. Unsaved element edits (drafts) show immediately.
 */
export function PreviewPanel({
  props,
  player,
  playerRef,
  scene,
  words,
  playMode,
  onPlayMode,
  range,
  previewingDraft,
  overlay,
}: {
  props: StudioVideoProps;
  player: PlayerRef | null;
  playerRef: (p: PlayerRef | null) => void;
  scene: SceneDto;
  words: TimedWord[];
  playMode: PlayMode;
  onPlayMode: (mode: PlayMode) => void;
  /** Loop range set with the I and O keys or "Loop the selected clip". */
  range: { in: number; out: number } | null;
  previewingDraft: boolean;
  /** Interactive layer over the picture (selection box, handles). When set, clicking the picture selects instead of playing. */
  overlay?: (stage: StageGeometry) => React.ReactNode;
}) {
  const drafts = useElementDrafts();
  const liveProps = useMemo(() => {
    if (!drafts.size) return props;
    return {
      ...props,
      scenes: props.scenes.map((s) => {
        let spec = s.spec;
        for (const draft of drafts.values()) if (draft.sceneId === s.id) spec = replaceElementAt(spec, draft.ref, draft.element);
        return spec === s.spec ? s : { ...s, spec };
      }),
    };
  }, [props, drafts]);

  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const [zoom, setZoom] = useState<ViewZoom>("fit");
  const total = Math.max(1, durationToTotalFrames(props.durationSec, props.fps));
  let inFrame: number | null = null;
  let outFrame: number | null = null;
  const span = playMode === "scene" ? [scene.startSec, scene.endSec] : playMode === "range" && range ? [range.in, range.out] : null;
  if (span) {
    const first = Math.min(total - 1, secondsToFrames(span[0], props.fps));
    const last = Math.min(total - 1, secondsToFrames(span[1], props.fps) - 1);
    if (last > first) {
      inFrame = first;
      outFrame = last;
    }
  }

  const aspect = props.width / props.height;
  let w: number;
  let h: number;
  if (zoom === "fit") {
    w = Math.max(0, stage.width - 24);
    h = w / aspect;
    const maxH = Math.max(0, stage.height - 24);
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
  } else {
    w = props.width * Number(zoom);
    h = props.height * Number(zoom);
  }
  w = Math.floor(w);
  h = Math.floor(h);
  const geometry: StageGeometry = { width: w, height: h, scale: props.width > 0 ? w / props.width : 1 };

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div ref={stageRef} className={cn("relative min-h-0 flex-1 bg-muted/60 dark:bg-[#07070a]", zoom === "fit" ? "overflow-hidden" : "scrollbar-thin overflow-auto")}>
        <div className="flex min-h-full w-max min-w-full items-center justify-center p-3">
          {w > 0 && h > 0 ? (
            <div className="relative shrink-0 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_8px_30px_rgba(0,0,0,0.35)]" style={{ width: w, height: h }}>
              <Player
                ref={playerRef}
                component={StudioVideo}
                inputProps={liveProps}
                durationInFrames={total}
                compositionWidth={props.width}
                compositionHeight={props.height}
                fps={props.fps}
                style={{ width: w, height: h, overflow: "hidden" }}
                controls={false}
                loop
                inFrame={inFrame}
                outFrame={outFrame}
                clickToPlay={!overlay}
                spaceKeyToPlayOrPause={false}
                numberOfSharedAudioTags={8}
                errorFallback={({ error }) => (
                  <div className="flex size-full flex-col items-center justify-center gap-2 bg-black p-6 text-center text-sm text-red-300">
                    <AlertTriangle className="size-6" />
                    <div>The scene crashed while rendering</div>
                    <div className="max-w-lg text-xs break-words text-red-200/80">{error.message}</div>
                  </div>
                )}
              />
              {overlay ? overlay(geometry) : null}
            </div>
          ) : null}
        </div>
        {previewingDraft ? <span className="pointer-events-none absolute top-2 left-2 rounded bg-warning/90 px-2 py-0.5 text-[11px] font-medium text-black">Previewing unsaved spec</span> : null}
      </div>
      <Transport player={player} fps={props.fps} durationSec={props.durationSec} scene={scene} words={words} playMode={playMode} onPlayMode={onPlayMode} range={range} zoom={zoom} onZoom={setZoom} />
    </div>
  );
}
