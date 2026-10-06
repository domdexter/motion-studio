"use client";

import { Captions, Lock, MousePointerClick, Pause, Play, ZoomIn, ZoomOut } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Segment, TimedWord } from "@/core/spec/timing";
import { clusterByDistance } from "@/core/timeline/time-snap";
import { formatTimecode } from "@/core/timing/frames";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { drawWaveform, usePeaks } from "../audio/waveform-player";

export interface TrackScene {
  id: string;
  key: string;
  name: string;
  startSec: number;
  endSec: number;
  timingMode: string;
  locked: boolean;
  stale?: boolean;
  status?: string;
}

export interface TrackMarker {
  time: number;
  label: string;
  kind: "enter" | "exit" | "emphasis" | "action" | "beat" | "note" | "music" | "sfx" | "shot" | "transition";
  ok?: boolean;
  voiceSynced?: boolean;
  /** Belongs to what is selected (drawn larger and outlined). */
  selected?: boolean;
  /** Identifies the marker for `onMarkerClick`. */
  id?: string;
}

export interface TimelineHandle {
  seek: (t: number) => void;
  /** Play or pause the voice-over. */
  toggle: () => void;
  play: () => void;
  pause: () => void;
  getTime: () => number;
}

export interface SceneTrackContext {
  pxPerSec: number;
  durationSec: number;
  words: TimedWord[];
  currentTime: number;
  seek: (t: number) => void;
}

interface TimelineTracksProps {
  durationSec: number;
  fps: number;
  voice: { url: string; peaksUrl: string | null } | null;
  words: TimedWord[];
  sentences: Segment[];
  paragraphs: Segment[];
  scenes: TrackScene[];
  markers?: TrackMarker[];
  /** Clicking a marker (instead of seeking under it), e.g. to select its element. Markers too close to click one by one open a list. */
  onMarkerClick?: (marker: TrackMarker) => void;
  selectedSceneId?: string | null;
  onSelectScene?: (id: string) => void;
  /** Replaces the read-only scene track (the scene editor supplies an interactive one). */
  renderSceneTrack?: (ctx: SceneTrackContext) => React.ReactNode;
  /** The Elements lane under the scene track: a scene's elements as timing bars with their cues. */
  renderElementTrack?: (ctx: SceneTrackContext) => React.ReactNode;
  /** Height of the Elements lane in pixels (it grows with its rows). */
  elementTrackHeight?: number;
  /** Label of the Elements lane. */
  elementLabel?: React.ReactNode;
  /** Shows the scene media lane (images/videos inside scenes, with their zoom bars) under the scene track. */
  renderMediaTrack?: (ctx: SceneTrackContext) => React.ReactNode;
  /** Small control next to the Scene media label. */
  mediaLabelAction?: React.ReactNode;
  /** Shows the overlay lane (images/videos above the scenes) under the scene track. */
  renderOverlayTrack?: (ctx: SceneTrackContext) => React.ReactNode;
  /** Small control next to the Overlays label (e.g. an add button). */
  overlayLabelAction?: React.ReactNode;
  /** Interactive layer over the voice-over waveform (trim its start/end, mute sections). */
  renderVoiceEdits?: (ctx: SceneTrackContext) => React.ReactNode;
  /** Small control next to the Voiceover label. */
  voiceLabelAction?: React.ReactNode;
  /** Shows the audio lane (music, SFX and voice-line clips) under the overlay lane. */
  renderAudioTrack?: (ctx: SceneTrackContext) => React.ReactNode;
  /** Small control next to the Audio label. */
  audioLabelAction?: React.ReactNode;
  /** Clicking a word selects it (`extend`: Shift, for a phrase) instead of only seeking. */
  onWordClick?: (index: number, extend: boolean) => void;
  /** Transcript indexes [first, last] of the selected words. */
  selectedWords?: readonly [number, number] | null;
  /** Words the cues of the selection fire on (underlined). */
  cueWords?: ReadonlySet<number>;
  /** Waiting for a word to be clicked (a cue being set): the words lane shows and zooms in, with a way to cancel. */
  wordPick?: { label: string; onCancel: () => void } | null;
  /** Editing tools shown in the header after the timecode. */
  headerActions?: React.ReactNode;
  /** Fill the parent's height: the lanes scroll inside while the ruler and lane labels stay in view. */
  fill?: boolean;
  onTime?: (t: number) => void;
  /** Called when the user seeks via the timeline (not on playback ticks). */
  onSeek?: (t: number) => void;
  /** When true, playback is driven externally (e.g. the Remotion Player); the timeline only shows `time`. */
  externalTime?: number;
  className?: string;
}

const LABEL_WIDTH = 116;
const ROWS = { ruler: 36, voice: 58, words: 26, segments: 34, beats: 22, scenes: 46, elements: 28, media: 44, overlays: 44, audio: 44 } as const;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
const MIN_PPS = 10;
const MAX_PPS = 1200;
/** Words show from this zoom; picking a word zooms in to at least this much. */
const WORDS_PPS = 45;
const PICK_PPS = 90;
/** Markers closer than this group into one hit target; each marker's hit target is this wide. */
const MARKER_GROUP_PX = 10;
const MARKER_HIT_PX = 14;
const TRANSCRIPT_LANES_KEY = "motion-studio:timeline:transcript-lanes";

export const MARKER_COLORS: Record<TrackMarker["kind"], string> = {
  enter: "bg-primary",
  action: "bg-primary",
  exit: "bg-muted-foreground",
  emphasis: "bg-warning",
  transition: "bg-info",
  shot: "bg-track-scene",
  beat: "bg-zinc-400",
  note: "bg-info",
  music: "bg-track-voice",
  sfx: "bg-orange-400",
};

function pickStep(pxPerSec: number): number {
  return TICK_STEPS.find((s) => s * pxPerSec >= 72) ?? 120;
}

const markerTitle = (m: TrackMarker) => `${m.label} · ${m.time.toFixed(2)}s${m.voiceSynced ? " · synced to the voice" : ""}${m.ok === false ? " (unresolved)" : ""}`;

/**
 * Markers on the ruler at their exact times. Each has a hit target wider than its diamond; markers too
 * close to click one by one share a target that lists them, so the one you mean can be picked without
 * moving anything off its time.
 */
function MarkerGroup({ items, pxPerSec, onPick }: { items: TrackMarker[]; pxPerSec: number; onPick?: (marker: TrackMarker) => void }) {
  const [open, setOpen] = useState(false);
  const first = items[0].time;
  const pad = MARKER_HIT_PX / 2;
  const single = items.length === 1;
  const box = (
    <div
      role={onPick ? "button" : undefined}
      tabIndex={onPick ? 0 : undefined}
      aria-label={single ? markerTitle(items[0]) : `${items.length} markers`}
      title={single ? `${markerTitle(items[0])}${onPick ? " — click to select" : ""}` : `${items.length} markers close together — click to choose one`}
      className={cn("absolute top-[15px] h-4 rounded-sm", onPick && "cursor-pointer hover:bg-foreground/10", !single && "bg-foreground/[0.05]")}
      style={{ left: first * pxPerSec - pad, width: (items[items.length - 1].time - first) * pxPerSec + pad * 2 }}
      onPointerDown={onPick ? (e) => e.stopPropagation() : undefined}
      onClick={onPick && single ? () => onPick(items[0]) : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onPick && single) onPick(items[0]);
      }}
    >
      {items.map((m, i) => (
        <span
          key={`${m.id ?? m.label}-${i}`}
          className={cn(
            "pointer-events-none absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px]",
            MARKER_COLORS[m.kind],
            m.voiceSynced && "ring-1 ring-track-voice ring-offset-1 ring-offset-panel",
            m.ok === false && "bg-destructive",
            m.selected && "z-10 size-3 ring-2 ring-foreground ring-offset-1 ring-offset-panel",
          )}
          style={{ left: (m.time - first) * pxPerSec + pad }}
        />
      ))}
      {!single ? <span className="pointer-events-none absolute -top-2.5 -right-1 rounded-full bg-muted px-1 font-mono text-[8px] leading-3 text-muted-foreground">{items.length}</span> : null}
    </div>
  );
  if (!onPick || single) return box;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{box}</PopoverTrigger>
      {/* Portaled, but React still bubbles its pointer events to the ruler, which would seek and capture the pointer. */}
      <PopoverContent side="bottom" align="start" className="w-72 p-1" onPointerDown={(e) => e.stopPropagation()}>
        <p className="px-2 pt-1 pb-1.5 text-[10px] text-muted-foreground">
          {items.length} markers between {first.toFixed(2)}s and {items[items.length - 1].time.toFixed(2)}s
        </p>
        {items.map((m, i) => (
          <button
            key={`${m.id ?? m.label}-${i}`}
            type="button"
            className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted", m.selected && "bg-primary/10")}
            onClick={() => {
              setOpen(false);
              onPick(m);
            }}
          >
            <span className={cn("size-2 shrink-0 rotate-45 rounded-[1px]", MARKER_COLORS[m.kind], m.ok === false && "bg-destructive")} />
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">{m.time.toFixed(2)}s</span>
            <span className="min-w-0 truncate">{m.label}</span>
            {m.voiceSynced ? <span className="ml-auto shrink-0 text-[10px] text-track-voice">voice</span> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The master timeline: ruler with markers, voice-over waveform, words, sentences, paragraphs, scenes,
 * the scene's elements, scene media, overlays and audio. One scroll area moves the lanes in both
 * directions while the ruler and the lane labels stay in view. Ctrl/⌘ + wheel zooms around the pointer.
 */
export const TimelineTracks = forwardRef<TimelineHandle, TimelineTracksProps>(function TimelineTracks(props, ref) {
  const { durationSec, fps, voice, words, sentences, paragraphs, scenes, markers = [], externalTime } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // The vertical position the user scrolled to, kept across lane height changes.
  const wantedTop = useRef(0);
  const restoringTop = useRef(false);
  const lanesRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Width of the visible lane area (without the labels) and the horizontal scroll position.
  const [viewport, setViewport] = useState({ width: 800, scrollLeft: 0 });
  const [pxPerSec, setPxPerSec] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [follow, setFollow] = useState(true);
  const [transcript, setTranscript] = useState(true);
  const peaks = usePeaks(voice?.peaksUrl);
  const onTimeRef = useRef(props.onTime);
  onTimeRef.current = props.onTime;

  useEffect(() => {
    try {
      if (localStorage.getItem(TRANSCRIPT_LANES_KEY) === "off") setTranscript(false);
    } catch {
      // Storage unavailable: keep the lanes shown.
    }
  }, []);
  const toggleTranscript = () => {
    const next = !transcript;
    setTranscript(next);
    try {
      localStorage.setItem(TRANSCRIPT_LANES_KEY, next ? "on" : "off");
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
  };

  const shownTime = externalTime ?? time;
  const safeDuration = Math.max(0.5, durationSec);
  const pps = pxPerSec ?? Math.max(20, (viewport.width - 24) / safeDuration);
  // In "fit" mode the content must never exceed the viewport: a 1px overflow toggles the
  // horizontal scrollbar, which changes the height and makes the layout oscillate.
  const fits = pxPerSec === null && (viewport.width - 24) / safeDuration >= 20;
  const contentWidth = fits ? Math.max(0, viewport.width) : Math.ceil(safeDuration * pps) + 24;
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const timeRef = useRef(shownTime);
  timeRef.current = shownTime;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () =>
      setViewport((v) => {
        const width = Math.max(0, el.clientWidth - LABEL_WIDTH);
        return v.width === width && v.scrollLeft === el.scrollLeft ? v : { width, scrollLeft: el.scrollLeft };
      });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl/⌘ + wheel zooms around the pointer (a non-passive listener, so the page itself doesn't zoom).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const offset = Math.max(0, e.clientX - el.getBoundingClientRect().left - LABEL_WIDTH);
      const current = ppsRef.current;
      const at = (el.scrollLeft + offset) / current;
      const next = Math.max(MIN_PPS, Math.min(MAX_PPS, current * Math.exp(-e.deltaY * 0.0015)));
      setPxPerSec(next);
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, at * next - offset);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Picking a word: zoom in far enough to click one, around the playhead.
  const picking = !!props.wordPick;
  useEffect(() => {
    const el = scrollRef.current;
    if (!picking || !el || ppsRef.current >= WORDS_PPS + 15) return;
    setPxPerSec(PICK_PPS);
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, timeRef.current * PICK_PPS - (el.clientWidth - LABEL_WIDTH) / 2);
    });
  }, [picking]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const t = audioRef.current?.currentTime ?? 0;
      setTime(t);
      onTimeRef.current?.(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // The lanes change height when the current scene changes (the elements lane grows with its rows).
  // The browser clamps scrollTop when the content shrinks, which threw the view back to the top while
  // scrubbing, so the last position the user scrolled to is restored after every resize.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      const next = Math.min(wantedTop.current, max);
      if (Math.abs(el.scrollTop - next) < 0.5) return;
      restoringTop.current = true;
      el.scrollTop = next;
      requestAnimationFrame(() => {
        restoringTop.current = false;
      });
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !follow) return;
    const x = shownTime * pps;
    const visible = el.clientWidth - LABEL_WIDTH;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + visible - 80) {
      el.scrollLeft = Math.max(0, x - visible * 0.25);
    }
  }, [shownTime, pps, follow]);

  // Waveform for the visible window only (the canvas stays viewport-sized at any zoom).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = viewport.width;
    const height = ROWS.voice;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const from = viewport.scrollLeft / pps;
    const to = (viewport.scrollLeft + width) / pps;
    if (!voice) {
      ctx.clearRect(0, 0, width, height);
      return;
    }
    drawWaveform(ctx, peaks.data, { width, height, from, to, playedUntil: shownTime, barWidth: 2, gap: 1 });
  }, [viewport, pps, peaks.data, shownTime, voice, transcript]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(safeDuration, t));
      if (audioRef.current) audioRef.current.currentTime = clamped;
      setTime(clamped);
      onTimeRef.current?.(clamped);
      props.onSeek?.(clamped);
    },
    [safeDuration, props],
  );

  useImperativeHandle(
    ref,
    () => ({
      seek,
      toggle: () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) void audio.play();
        else audio.pause();
      },
      play: () => void audioRef.current?.play(),
      pause: () => audioRef.current?.pause(),
      getTime: () => audioRef.current?.currentTime ?? time,
    }),
    [seek, time],
  );

  /** Timeline seconds under a pointer (the ruler and the lanes share the same left edge). */
  const timeFromEvent = (clientX: number) => {
    const lanes = lanesRef.current;
    return lanes ? (clientX - lanes.getBoundingClientRect().left) / pps : 0;
  };

  const zoomBy = (factor: number) => {
    const el = scrollRef.current;
    const center = el ? (el.scrollLeft + viewport.width / 2) / pps : 0;
    const next = Math.max(MIN_PPS, Math.min(MAX_PPS, pps * factor));
    setPxPerSec(next);
    requestAnimationFrame(() => {
      if (el) el.scrollLeft = Math.max(0, center * next - viewport.width / 2);
    });
  };

  const visibleFrom = viewport.scrollLeft / pps - 1;
  const visibleTo = (viewport.scrollLeft + viewport.width) / pps + 1;
  const step = pickStep(pps);
  const ticks = useMemo(() => {
    const out: number[] = [];
    const start = Math.max(0, Math.floor(visibleFrom / step) * step);
    for (let t = start; t <= Math.min(safeDuration, visibleTo); t += step) out.push(Math.round(t * 1000) / 1000);
    return out;
  }, [visibleFrom, visibleTo, step, safeDuration]);
  // The words lane also shows while a word is being picked, even with the transcript lanes hidden.
  const showWords = transcript || picking;
  const visibleWords = showWords && pps >= WORDS_PPS ? words.flatMap((w, index) => (w.end >= visibleFrom && w.start <= visibleTo ? [{ w, index }] : [])) : [];
  const markerGroups = clusterByDistance(
    markers.filter((m) => m.time >= visibleFrom && m.time <= visibleTo),
    pps,
    MARKER_GROUP_PX,
  );
  const selectedScene = scenes.find((s) => s.id === props.selectedSceneId);
  const selectedWords = props.selectedWords ?? null;

  const block = (start: number, end: number) => ({ left: start * pps, width: Math.max(2, (end - start) * pps) });
  const ctx: SceneTrackContext = { pxPerSec: pps, durationSec: safeDuration, words, currentTime: shownTime, seek };
  const label = "flex items-center border-b border-border px-3";
  const labelWithAction = "flex items-center justify-between gap-1 border-b border-border pr-1.5 pl-3";
  const elementsHeight = props.elementTrackHeight ?? ROWS.elements;

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border border-border bg-card", props.fill && "h-full min-h-0", props.className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5">
        {externalTime === undefined ? (
          <Button size="icon-sm" variant="secondary" disabled={!voice} aria-label={playing ? "Pause" : "Play"} onClick={() => (playing ? audioRef.current?.pause() : void audioRef.current?.play())}>
            {playing ? <Pause /> : <Play />}
          </Button>
        ) : null}
        <span className="font-mono text-xs tabular">
          {formatTimecode(shownTime, fps)}
          <span className="text-muted-foreground"> / {formatTimecode(safeDuration, fps)}</span>
        </span>
        {props.headerActions}
        {props.wordPick ? (
          <span className="flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
            <MousePointerClick className="size-3.5" /> Click a word for {props.wordPick.label}
            <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={props.wordPick.onCancel}>
              Cancel (Esc)
            </button>
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="icon-xs"
            variant={transcript ? "secondary" : "ghost"}
            aria-pressed={transcript}
            aria-label={transcript ? "Hide the words, sentences and paragraphs lanes" : "Show the words, sentences and paragraphs lanes"}
            title={transcript ? "Hide the words, sentences and paragraphs lanes" : "Show the words, sentences and paragraphs lanes"}
            onClick={toggleTranscript}
          >
            <Captions />
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Keep the playhead in view while playing">
            <Switch checked={follow} onCheckedChange={setFollow} className="scale-75" /> Follow
          </label>
          <Button size="icon-xs" variant="ghost" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out">
            <ZoomOut />
          </Button>
          <Slider className="w-24" min={Math.log(MIN_PPS)} max={Math.log(MAX_PPS)} step={0.01} value={[Math.log(pps)]} onValueChange={([v]) => setPxPerSec(Math.exp(v))} aria-label="Zoom" title="Zoom (Ctrl + wheel over the lanes)" />
          <Button size="icon-xs" variant="ghost" onClick={() => zoomBy(1.5)} aria-label="Zoom in">
            <ZoomIn />
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setPxPerSec(null)}>
            Fit
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className={cn("scrollbar-thin relative overflow-auto overscroll-contain [scrollbar-gutter:stable]", props.fill && "min-h-0 flex-1")}
        style={{ ["--tl-labels" as string]: `${LABEL_WIDTH}px` }}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (!restoringTop.current) wantedTop.current = el.scrollTop;
          const width = Math.max(0, el.clientWidth - LABEL_WIDTH);
          setViewport((v) => (v.width === width && v.scrollLeft === el.scrollLeft ? v : { width, scrollLeft: el.scrollLeft }));
        }}
        onKeyDown={(e) => {
          if (e.key === " " && externalTime === undefined) {
            e.preventDefault();
            if (playing) audioRef.current?.pause();
            else void audioRef.current?.play();
          }
        }}
        tabIndex={0}
      >
        <div ref={contentRef} className="relative" style={{ width: LABEL_WIDTH + contentWidth }}>
          {/* Ruler with markers — stays at the top while the lanes scroll */}
          <div className="sticky top-0 z-30 flex border-b border-border bg-panel" style={{ height: ROWS.ruler }}>
            <div className="sticky left-0 z-10 flex shrink-0 items-end border-r border-border bg-panel px-3 pb-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase" style={{ width: LABEL_WIDTH }}>
              Markers
            </div>
            <div
              className="relative cursor-pointer touch-none"
              style={{ width: contentWidth }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture?.(e.pointerId);
                seek(timeFromEvent(e.clientX));
              }}
              onPointerMove={(e) => e.buttons === 1 && seek(timeFromEvent(e.clientX))}
            >
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-border/70" style={{ left: t * pps }}>
                  <span className="absolute top-0.5 left-1 font-mono text-[10px] whitespace-nowrap text-muted-foreground">
                    {step < 1 ? t.toFixed(step < 0.5 ? 2 : 1) : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`}
                  </span>
                </div>
              ))}
              {scenes
                .filter((s) => s.startSec > 0.001 && s.startSec >= visibleFrom && s.startSec <= visibleTo)
                .map((s) => (
                  <div key={s.id} className="pointer-events-none absolute bottom-0 h-2.5 w-px bg-track-scene/70" style={{ left: s.startSec * pps }} title={`${s.key} starts`} />
                ))}
              {markerGroups.map((group) => (
                <MarkerGroup key={`${group.time}-${group.items[0].id ?? group.items[0].label}`} items={group.items} pxPerSec={pps} onPick={props.onMarkerClick} />
              ))}
              <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-primary" style={{ left: shownTime * pps }}>
                <div className="absolute top-0 -left-[5px] h-2.5 w-[11px] rounded-b-[3px] bg-primary" />
              </div>
            </div>
          </div>

          <div className="flex">
            {/* Lane labels — stay at the left while the lanes scroll */}
            <div className="sticky left-0 z-20 shrink-0 border-r border-border bg-panel text-[10px] font-medium tracking-wider text-muted-foreground uppercase" style={{ width: LABEL_WIDTH }}>
              <div style={{ height: ROWS.voice }} className={labelWithAction}>
                Voiceover
                {props.voiceLabelAction}
              </div>
              {showWords ? (
                <div style={{ height: ROWS.words }} className={cn(label, picking && "text-primary")}>
                  Words
                </div>
              ) : null}
              {transcript ? (
                <>
                  <div style={{ height: ROWS.segments }} className={cn(label, "gap-1")}>
                    <Lock className="size-3" /> Segments
                  </div>
                  <div style={{ height: ROWS.beats }} className={label}>
                    Paragraphs
                  </div>
                </>
              ) : null}
              <div style={{ height: ROWS.scenes }} className={label}>
                Scenes
              </div>
              {props.renderElementTrack ? (
                <div style={{ height: elementsHeight }} className={cn(label, "relative items-start pt-1.5")} title="When each element of the scene is on screen, with its emphasis moments, actions and keyframes">
                  {props.elementLabel ?? "Elements"}
                </div>
              ) : null}
              {props.renderMediaTrack ? (
                <div style={{ height: ROWS.media }} className={labelWithAction} title="Images and videos inside scenes">
                  Scene media
                  {props.mediaLabelAction}
                </div>
              ) : null}
              {props.renderOverlayTrack ? (
                <div style={{ height: ROWS.overlays }} className={labelWithAction}>
                  Overlays
                  {props.overlayLabelAction}
                </div>
              ) : null}
              {props.renderAudioTrack ? (
                <div style={{ height: ROWS.audio }} className={labelWithAction}>
                  Audio
                  {props.audioLabelAction}
                </div>
              ) : null}
            </div>

            <div ref={lanesRef} className="relative" style={{ width: contentWidth }}>
              {/* Scene boundaries and the selected scene, behind every lane */}
              <div className="pointer-events-none absolute inset-0">
                {selectedScene ? <div className="absolute inset-y-0 bg-primary/[0.04]" style={block(selectedScene.startSec, selectedScene.endSec)} /> : null}
                {scenes
                  .filter((s) => s.startSec > 0.001 && s.startSec >= visibleFrom && s.startSec <= visibleTo)
                  .map((s) => (
                    <div key={s.id} className="absolute inset-y-0 w-px bg-foreground/[0.08]" style={{ left: s.startSec * pps }} />
                  ))}
              </div>

              {/* Voiceover waveform */}
              <div className="relative border-b border-border" style={{ height: ROWS.voice }} onPointerDown={(e) => seek(timeFromEvent(e.clientX))}>
                <canvas ref={canvasRef} className="pointer-events-none sticky block" style={{ left: LABEL_WIDTH }} />
                {voice && props.renderVoiceEdits ? props.renderVoiceEdits(ctx) : null}
                {!voice ? <span className="absolute top-1/2 left-3 -translate-y-1/2 text-xs text-muted-foreground">No voice-over</span> : null}
              </div>

              {/* Words — click one to select it (Shift: a phrase), or to pick it for a cue */}
              {showWords ? (
                <div className={cn("relative border-b border-border", picking && "bg-primary/[0.06]")} style={{ height: ROWS.words }} onPointerDown={(e) => seek(timeFromEvent(e.clientX))}>
                  {pps < WORDS_PPS ? <span className="pointer-events-none sticky left-[calc(var(--tl-labels,0px)+0.5rem)] mt-1 inline-block text-[10px] text-muted-foreground/70">Zoom in to see words</span> : null}
                  {visibleWords.map(({ w, index }) => {
                    const selected = !!selectedWords && index >= selectedWords[0] && index <= selectedWords[1];
                    const cued = !!props.cueWords?.has(index);
                    return (
                      <div
                        key={index}
                        role={props.onWordClick ? "button" : undefined}
                        aria-pressed={props.onWordClick ? selected : undefined}
                        title={`${w.text} · ${w.start.toFixed(2)}–${w.end.toFixed(2)}s${cued ? " · a cue fires on this word" : ""}${props.onWordClick ? (picking ? " — click to use this word" : " — click to select, Shift+click for a phrase") : ""}`}
                        className={cn(
                          "absolute top-1 bottom-1 overflow-hidden rounded-sm border border-track-voice/30 bg-track-voice/10 px-1 text-[10px] leading-4 whitespace-nowrap text-foreground/80",
                          w.interpolated && "border-dashed",
                          cued && "border-b-2 border-b-track-voice",
                          selected && "z-10 border-primary bg-primary/25 text-foreground",
                          props.onWordClick && (picking ? "cursor-crosshair hover:border-primary hover:bg-primary/30" : "cursor-pointer hover:bg-track-voice/25"),
                        )}
                        style={block(w.start, w.end)}
                        onPointerDown={
                          props.onWordClick
                            ? (e) => {
                                e.stopPropagation();
                                props.onWordClick?.(index, e.shiftKey);
                              }
                            : undefined
                        }
                      >
                        {w.text}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {transcript ? (
                <>
                  {/* Sentences (audio-locked) */}
                  <div className="relative border-b border-border" style={{ height: ROWS.segments }}>
                    {sentences
                      .filter((s) => s.end >= visibleFrom && s.start <= visibleTo)
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => seek(s.start)}
                          title={`${s.id} · ${s.start.toFixed(2)}–${s.end.toFixed(2)}s\n${s.text}`}
                          className="absolute top-1 bottom-1 overflow-hidden rounded border border-foreground/15 bg-foreground/[0.06] px-1.5 text-left text-[11px] leading-6 whitespace-nowrap text-foreground/85 hover:bg-foreground/10"
                          style={block(s.start, s.end)}
                        >
                          {s.text}
                        </button>
                      ))}
                  </div>

                  {/* Paragraphs */}
                  <div className="relative border-b border-border" style={{ height: ROWS.beats }}>
                    {paragraphs.map((p, i) => (
                      <div key={p.id} className="absolute top-1 bottom-1 overflow-hidden rounded-sm bg-muted px-1.5 text-[10px] leading-3.5 whitespace-nowrap text-muted-foreground" style={block(p.start, p.end)} title={p.text}>
                        ¶{i + 1} {p.text}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {/* Scenes */}
              <div className="relative border-b border-border" style={{ height: ROWS.scenes }}>
                {props.renderSceneTrack
                  ? props.renderSceneTrack(ctx)
                  : scenes.map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          props.onSelectScene?.(s.id);
                          seek(s.startSec);
                        }}
                        title={`${s.key} · ${s.name}\n${s.startSec.toFixed(2)}–${s.endSec.toFixed(2)}s · ${s.timingMode === "audio_locked" ? "audio-locked" : "user-adjusted"}`}
                        className={cn(
                          "absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border px-2 text-left text-[11px] leading-tight",
                          i % 2 ? "border-track-scene/50 bg-track-scene/20" : "border-track-scene/40 bg-track-scene/12",
                          props.selectedSceneId === s.id && "ring-2 ring-primary",
                          s.stale && "border-stale/70 bg-stale/15",
                        )}
                        style={block(s.startSec, s.endSec)}
                      >
                        <span className="block truncate font-medium">
                          {s.timingMode === "audio_locked" ? <Lock className="mr-1 inline size-2.5" /> : null}
                          {s.key.replace("scene_", "S")} {s.name}
                        </span>
                        <span className="block truncate font-mono text-[9px] text-muted-foreground">{(s.endSec - s.startSec).toFixed(2)}s</span>
                      </button>
                    ))}
                {!scenes.length && !props.renderSceneTrack ? <span className="pointer-events-none sticky left-[calc(var(--tl-labels,0px)+0.5rem)] mt-3 inline-block text-[11px] text-muted-foreground">No scenes yet — generate the storyboard</span> : null}
              </div>

              {/* Elements of the scene (timing bars with their cues) */}
              {props.renderElementTrack ? (
                <div className="relative border-b border-border" style={{ height: elementsHeight }}>
                  {props.renderElementTrack(ctx)}
                </div>
              ) : null}

              {/* Scene media (images/videos inside scenes) */}
              {props.renderMediaTrack ? (
                <div className="relative border-b border-border" style={{ height: ROWS.media }}>
                  {props.renderMediaTrack(ctx)}
                </div>
              ) : null}

              {/* Overlays (images/videos above the scenes) */}
              {props.renderOverlayTrack ? (
                <div className="relative border-b border-border" style={{ height: ROWS.overlays }}>
                  {props.renderOverlayTrack(ctx)}
                </div>
              ) : null}

              {/* Audio clips (music, SFX, voice lines) */}
              {props.renderAudioTrack ? (
                <div className="relative border-b border-border" style={{ height: ROWS.audio }}>
                  {props.renderAudioTrack(ctx)}
                </div>
              ) : null}

              {/* Playhead */}
              <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-primary shadow-[0_0_6px_rgba(124,108,255,0.8)]" style={{ left: shownTime * pps }} />
            </div>
          </div>
        </div>
      </div>
      {voice && externalTime === undefined ? (
        <audio ref={audioRef} src={voice.url} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      ) : null}
    </div>
  );
});
