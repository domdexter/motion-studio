"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Clapperboard, Film, Info, Lock, Maximize, Pause, Play, Repeat, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { durationToTotalFrames, formatClock } from "@/core/timing/frames";
import { http } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { StudioVideo } from "@/remotion/StudioVideo";
import type { CompositionBuild } from "@/server/services/composition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, ErrorState } from "../common";
import { useWorkspace } from "../workspace/workspace-shell";

type SceneFrame = CompositionBuild["sceneFrames"][number];
type Mode = "all" | "scene" | "range";

/** "83.2", "1:23.2" or "0:01:23" → seconds. */
function parseTime(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length > 3 || parts.some((p) => p.trim() === "" || Number.isNaN(Number(p)))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function sceneAtFrame(scenes: SceneFrame[], frame: number): SceneFrame | null {
  return scenes.find((s) => frame >= s.startFrame && frame < s.endFrame) ?? null;
}

// ---------------------------------------------------------------------------------------

function Scrubber({
  frame,
  durationInFrames,
  fps,
  scenes,
  inFrame,
  outFrame,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: {
  frame: number;
  durationInFrames: number;
  fps: number;
  scenes: SceneFrame[];
  inFrame: number | null;
  outFrame: number | null;
  onSeek: (frame: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = Math.max(1, durationInFrames - 1);
  const pct = (f: number) => `${(Math.max(0, Math.min(last, f)) / last) * 100}%`;
  const frameAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return Math.round(((clientX - rect.left) / Math.max(1, rect.width)) * last);
  };
  const durationSec = durationInFrames / fps;
  const step = durationSec <= 20 ? 2 : durationSec <= 60 ? 5 : durationSec <= 180 ? 15 : 30;
  const ticks = Array.from({ length: Math.floor(durationSec / step) + 1 }, (_, i) => i * step);
  const current = sceneAtFrame(scenes, frame);

  return (
    <div
      ref={ref}
      className="relative h-12 cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onScrubStart();
        onSeek(frameAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(frameAt(e.clientX));
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        onScrubEnd();
      }}
    >
      <div className="absolute inset-x-0 top-0 h-7 overflow-hidden rounded-md bg-muted/40">
        {scenes.map((s, i) => (
          <div
            key={s.id}
            className={cn(
              "absolute top-0 bottom-0 truncate border-r border-background/80 px-1.5 text-[10px] leading-7 text-muted-foreground",
              i % 2 ? "bg-primary/10" : "bg-primary/[0.17]",
              current?.id === s.id && "bg-primary/35 text-foreground",
            )}
            style={{ left: pct(s.startFrame), width: `${((Math.min(last, s.endFrame) - s.startFrame) / last) * 100}%` }}
          >
            <span className="font-mono">{s.key.replace(/^scene_/, "")}</span> {s.name}
          </div>
        ))}
        {inFrame !== null && outFrame !== null ? (
          <>
            <div className="absolute top-0 bottom-0 left-0 bg-black/60" style={{ width: pct(inFrame) }} />
            <div className="absolute top-0 right-0 bottom-0 bg-black/60" style={{ left: pct(outFrame) }} />
          </>
        ) : null}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-4">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 font-mono text-[9px] text-muted-foreground" style={{ left: pct(t * fps) }}>
            {formatClock(t, 0)}
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute top-0 bottom-4 w-px bg-primary" style={{ left: pct(frame) }}>
        <div className="absolute -top-1 -left-[5px] size-[11px] rounded-full border-2 border-background bg-primary" />
      </div>
    </div>
  );
}

function Transport({
  player,
  fps,
  durationInFrames,
  scenes,
  inFrame,
  outFrame,
  loop,
  onLoopChange,
  onSceneChange,
}: {
  player: PlayerRef | null;
  fps: number;
  durationInFrames: number;
  scenes: SceneFrame[];
  inFrame: number | null;
  outFrame: number | null;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  onSceneChange: (key: string | null) => void;
}) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [jump, setJump] = useState("");
  const resumeAfterScrub = useRef(false);

  useEffect(() => {
    if (!player) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onMute = (e: { detail: { isMuted: boolean } }) => setMuted(e.detail.isMuted);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("seeked", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onPause);
    player.addEventListener("mutechange", onMute);
    setFrame(player.getCurrentFrame());
    setPlaying(player.isPlaying());
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("seeked", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onPause);
      player.removeEventListener("mutechange", onMute);
    };
  }, [player]);

  const seek = useCallback(
    (f: number) => {
      if (!player) return;
      const min = inFrame ?? 0;
      const max = outFrame ?? durationInFrames - 1;
      player.seekTo(Math.max(min, Math.min(max, Math.round(f))));
    },
    [player, inFrame, outFrame, durationInFrames],
  );

  const currentScene = sceneAtFrame(scenes, frame);
  const currentKey = currentScene?.key ?? null;
  useEffect(() => onSceneChange(currentKey), [currentKey, onSceneChange]);

  const prevScene = () => {
    const before = scenes.filter((s) => s.startFrame < frame - fps * 0.25);
    seek(before.length ? before[before.length - 1].startFrame : 0);
  };
  const nextScene = () => {
    const after = scenes.find((s) => s.startFrame > frame);
    if (after) seek(after.startFrame);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!player || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.getAttribute("role") === "slider"))) return;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(player.getCurrentFrame() - (e.shiftKey ? fps : 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(player.getCurrentFrame() + (e.shiftKey ? fps : 1));
      } else if (e.key === "Home") {
        seek(0);
      } else if (e.key === "End") {
        seek(durationInFrames - 1);
      } else if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey) {
        player.requestFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, seek, fps, durationInFrames]);

  const submitJump = () => {
    const sec = parseTime(jump);
    if (sec === null) return;
    seek(sec * fps);
    setJump("");
  };

  return (
    <div className="shrink-0 border-t border-border bg-panel px-4 pt-2 pb-3">
      <Scrubber
        frame={frame}
        durationInFrames={durationInFrames}
        fps={fps}
        scenes={scenes}
        inFrame={inFrame}
        outFrame={outFrame}
        onSeek={seek}
        onScrubStart={() => {
          resumeAfterScrub.current = !!player?.isPlaying();
          player?.pause();
        }}
        onScrubEnd={() => {
          if (resumeAfterScrub.current) player?.play();
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={prevScene} aria-label="Previous scene">
              <SkipBack />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Previous scene</TooltipContent>
        </Tooltip>
        <Button size="icon-sm" variant="ghost" onClick={() => seek(frame - 1)} aria-label="Previous frame">
          <ChevronLeft />
        </Button>
        <Button size="icon" className="rounded-full" onClick={(e) => player?.toggle(e)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => seek(frame + 1)} aria-label="Next frame">
          <ChevronRight />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={nextScene} aria-label="Next scene">
              <SkipForward />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Next scene</TooltipContent>
        </Tooltip>
        <div className="ml-2 font-mono text-sm tabular-nums">
          {formatClock(frame / fps, 2)} <span className="text-muted-foreground">/ {formatClock(durationInFrames / fps, 2)}</span>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">f{frame}</span>
        {currentScene ? (
          <Badge variant="outline" className="ml-2 max-w-64 truncate">
            {currentScene.key} · {currentScene.name}
          </Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <Input
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitJump()}
            placeholder="Jump to 0:12.5"
            className="h-8 w-32 font-mono text-xs"
            aria-label="Jump to timestamp"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant={loop ? "secondary" : "ghost"} onClick={() => onLoopChange(!loop)} aria-label="Loop">
                <Repeat />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Loop playback</TooltipContent>
          </Tooltip>
          <Button size="icon-sm" variant="ghost" onClick={() => (player?.isMuted() ? player.unmute() : player?.mute())} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" onClick={() => player?.requestFullscreen()} aria-label="Fullscreen">
                <Maximize />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fullscreen (F)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function IssuesBar({ build, projectId }: { build: CompositionBuild; projectId: string }) {
  const base = `/projects/${projectId}`;
  const items: { tone: string; icon: typeof AlertTriangle; text: string; href: string; cta: string }[] = [];
  const { issues, props } = build;
  if (issues.invalidScenes.length) {
    items.push({ tone: "text-destructive", icon: AlertTriangle, text: `Invalid scene spec in ${issues.invalidScenes.map((s) => s.key).join(", ")} — shown as a placeholder.`, href: `${base}/scenes?scene=${issues.invalidScenes[0].key}`, cta: "Fix scene" });
  }
  if (issues.missingAssets.length) {
    const m = issues.missingAssets[0];
    items.push({ tone: "text-warning", icon: AlertTriangle, text: `Scene ${m.sceneKey} requires asset ${m.assetId}.${issues.missingAssets.length > 1 ? ` (+${issues.missingAssets.length - 1} more)` : ""}`, href: `${base}/assets/images`, cta: "Open assets" });
  }
  if (issues.staleTimingScenes.length) {
    items.push({ tone: "text-stale", icon: AlertTriangle, text: "Voice-over changed. Existing scene timing may no longer match.", href: `${base}/timeline?review=voice-change`, cta: "Review timeline" });
  }
  if (!props.voice) {
    items.push({ tone: "text-info", icon: Info, text: "No voice-over yet — scene timing is estimated and the preview is silent.", href: `${base}/voice`, cta: "Add voice-over" });
  }
  if (!items.length) return null;
  return (
    <div className="space-y-px border-b border-border">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 bg-muted/20 px-5 py-1.5 text-xs">
          <item.icon className={cn("size-3.5 shrink-0", item.tone)} />
          <span className="text-foreground/90">{item.text}</span>
          <Link href={item.href} className="ml-auto shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            {item.cta}
          </Link>
        </div>
      ))}
    </div>
  );
}

function SceneList({ scenes, fps, currentKey, focusKey, onSelect }: { scenes: SceneFrame[]; fps: number; currentKey: string | null; focusKey: string | null; onSelect: (scene: SceneFrame) => void }) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l border-border bg-panel lg:flex">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Scenes</span>
        <span className="text-xs text-muted-foreground">{scenes.length}</span>
      </div>
      <div className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-2">
        {scenes.length === 0 ? <p className="px-2 py-6 text-center text-xs text-muted-foreground">No scenes yet.</p> : null}
        {scenes.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s)}
            className={cn(
              "w-full rounded-lg border px-3 py-2 text-left transition-colors",
              currentKey === s.key ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-muted/40",
              focusKey === s.key && "ring-1 ring-primary/40",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground">{s.key}</span>
              {s.locked ? <Lock className="size-3 text-muted-foreground" /> : null}
              <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
                {formatClock(s.startFrame / fps, 1)}–{formatClock(s.endFrame / fps, 1)}
              </span>
            </div>
            <div className="mt-0.5 truncate text-sm">{s.name}</div>
            <div className="mt-1">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px]", s.status === "approved" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{s.status === "approved" ? "Approved" : "Draft"}</span>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------------------

export function PreviewPage({ projectId }: { projectId: string }) {
  const { project } = useWorkspace();
  const search = useSearchParams();
  const revision = project?.revision;
  const query = useQuery({
    queryKey: ["composition", projectId, revision],
    queryFn: () => http.get<CompositionBuild>(`/api/projects/${projectId}/composition`),
    enabled: revision !== undefined,
    placeholderData: keepPreviousData,
  });
  const build = query.data;
  const props = build?.props;

  const [overlays, setOverlays] = useState({ safeArea: false, sceneLabels: false });
  const [mode, setMode] = useState<Mode>(search.get("scene") ? "scene" : "all");
  const [zoom, setZoom] = useState<"fit" | "0.5" | "1">("fit");
  const [loop, setLoop] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(search.get("scene"));
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [range, setRange] = useState({ start: "", end: "" });
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const playerRef = useCallback((instance: PlayerRef | null) => setPlayer(instance), []);
  const [stageRef, stage] = useElementSize<HTMLDivElement>();

  const fps = props?.fps ?? 30;
  const durationInFrames = props ? Math.max(1, durationToTotalFrames(props.durationSec, props.fps)) : 1;
  const inputProps = useMemo(() => (props ? { ...props, overlays } : null), [props, overlays]);
  const scenes = useMemo(() => build?.sceneFrames ?? [], [build]);
  const focusScene = scenes.find((s) => s.key === (focusKey ?? currentKey)) ?? null;

  let inFrame: number | null = null;
  let outFrame: number | null = null;
  if (mode === "scene" && focusScene) {
    inFrame = Math.min(focusScene.startFrame, durationInFrames - 1);
    outFrame = Math.min(durationInFrames - 1, Math.max(inFrame, focusScene.endFrame - 1));
  } else if (mode === "range") {
    const a = parseTime(range.start);
    const b = parseTime(range.end);
    if (a !== null && b !== null && b > a) {
      inFrame = Math.max(0, Math.min(durationInFrames - 1, Math.round(a * fps)));
      outFrame = Math.max(0, Math.min(durationInFrames - 1, Math.round(b * fps) - 1));
    }
  }
  if (inFrame !== null && outFrame !== null && outFrame <= inFrame) {
    inFrame = null;
    outFrame = null;
  }

  // Deep links: ?scene=scene_03 or ?t=12.5
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !player || !build) return;
    deepLinked.current = true;
    const t = parseTime(search.get("t") ?? "");
    const scene = build.sceneFrames.find((s) => s.key === search.get("scene"));
    if (scene) player.seekTo(scene.startFrame);
    else if (t !== null) player.seekTo(Math.min(durationInFrames - 1, Math.round(t * build.props.fps)));
  }, [player, build, search, durationInFrames]);

  const selectScene = (scene: SceneFrame) => {
    setFocusKey(scene.key);
    player?.seekTo(scene.startFrame);
  };

  let playerWidth = 0;
  let playerHeight = 0;
  if (props) {
    const aspect = props.width / props.height;
    if (zoom === "fit") {
      const availW = Math.max(0, stage.width - 48);
      const availH = Math.max(0, stage.height - 48);
      playerWidth = availW;
      playerHeight = availW / aspect;
      if (playerHeight > availH) {
        playerHeight = availH;
        playerWidth = availH * aspect;
      }
    } else {
      playerWidth = props.width * Number(zoom);
      playerHeight = props.height * Number(zoom);
    }
  }

  const hasContent = !!props && (props.scenes.length > 0 || !!props.voice);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <div className="mr-2">
          <h1 className="text-lg font-semibold tracking-tight">Preview</h1>
          <p className="text-xs text-muted-foreground">The live Remotion composition — exactly what the renderer will produce.</p>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v as Mode)}>
          <ToggleGroupItem value="all">Entire video</ToggleGroupItem>
          <ToggleGroupItem value="scene" disabled={!scenes.length}>
            Scene
          </ToggleGroupItem>
          <ToggleGroupItem value="range">Range</ToggleGroupItem>
        </ToggleGroup>
        {mode === "scene" && focusScene ? <span className="text-xs text-muted-foreground">Looping {focusScene.key} — pick another in the scene list</span> : null}
        {mode === "range" ? (
          <div className="flex items-center gap-1.5">
            <Input className="h-8 w-20 font-mono text-xs" placeholder="0:02" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} aria-label="Range start" />
            <span className="text-muted-foreground">→</span>
            <Input className="h-8 w-20 font-mono text-xs" placeholder="0:08" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} aria-label="Range end" />
          </div>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={overlays.safeArea} onCheckedChange={(v) => setOverlays((o) => ({ ...o, safeArea: v }))} />
            Safe area
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={overlays.sceneLabels} onCheckedChange={(v) => setOverlays((o) => ({ ...o, sceneLabels: v }))} />
            Scene labels
          </label>
          <ToggleGroup type="single" variant="outline" size="sm" value={zoom} onValueChange={(v) => v && setZoom(v as typeof zoom)}>
            <ToggleGroupItem value="fit">Fit</ToggleGroupItem>
            <ToggleGroupItem value="0.5">50%</ToggleGroupItem>
            <ToggleGroupItem value="1">100%</ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" asChild>
            <Link href={`/projects/${projectId}/render`}>
              <Film /> Render
            </Link>
          </Button>
        </div>
      </div>
      {build ? <IssuesBar build={build} projectId={projectId} /> : null}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={stageRef} className={cn("relative min-h-0 flex-1 bg-[#050507]", zoom === "fit" ? "overflow-hidden" : "overflow-auto")}>
            {query.error && !build ? (
              <div className="mx-auto max-w-lg p-10">
                <ErrorState error={query.error} title="Could not load the composition" onRetry={() => void query.refetch()} />
              </div>
            ) : !props ? (
              <div className="absolute inset-0 flex items-center justify-center p-10">
                <Skeleton className="aspect-video w-full max-w-3xl" />
              </div>
            ) : !hasContent ? (
              <div className="mx-auto max-w-lg p-10">
                <EmptyState
                  icon={<Clapperboard className="size-6" />}
                  title="Nothing to preview yet"
                  description="Add a voice-over and generate a storyboard — scenes appear here as a playable Remotion video."
                  action={
                    <Button asChild>
                      <Link href={`/projects/${projectId}/storyboard`}>Open Storyboard</Link>
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className={cn(zoom === "fit" ? "absolute inset-0 flex items-center justify-center" : "flex min-h-full min-w-max items-center justify-center p-6")}>
                {inputProps && playerWidth > 0 && playerHeight > 0 ? (
                  <Player
                    ref={playerRef}
                    component={StudioVideo}
                    inputProps={inputProps}
                    durationInFrames={durationInFrames}
                    compositionWidth={props.width}
                    compositionHeight={props.height}
                    fps={props.fps}
                    style={{ width: playerWidth, height: playerHeight, boxShadow: "0 30px 80px rgba(0,0,0,0.55)", borderRadius: 6, overflow: "hidden" }}
                    controls={false}
                    loop={loop || mode !== "all"}
                    inFrame={inFrame}
                    outFrame={outFrame}
                    clickToPlay
                    doubleClickToFullscreen
                    spaceKeyToPlayOrPause={false}
                    moveToBeginningWhenEnded={false}
                    numberOfSharedAudioTags={8}
                    errorFallback={({ error }) => (
                      <div className="flex size-full flex-col items-center justify-center gap-2 bg-black p-6 text-center text-sm text-red-300">
                        <AlertTriangle className="size-6" />
                        <div className="font-medium">The composition crashed</div>
                        <div className="max-w-xl text-xs break-words text-red-200/80">{error.message}</div>
                      </div>
                    )}
                  />
                ) : null}
              </div>
            )}
          </div>
          {props && hasContent ? (
            <Transport
              player={player}
              fps={fps}
              durationInFrames={durationInFrames}
              scenes={scenes}
              inFrame={inFrame}
              outFrame={outFrame}
              loop={loop}
              onLoopChange={setLoop}
              onSceneChange={setCurrentKey}
            />
          ) : null}
        </div>
        <SceneList scenes={scenes} fps={fps} currentKey={currentKey} focusKey={mode === "scene" ? (focusScene?.key ?? null) : null} onSelect={selectScene} />
      </div>
    </div>
  );
}
