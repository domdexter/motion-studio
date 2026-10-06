"use client";

import { Crosshair, Gauge, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE, SPEED_PRESETS, clampPlaybackRate, fitPlaybackRate } from "@/core/timeline/media-clip";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

/** Controls shared by the overlay panel and the scene media panel: number fields, source trim and speed. */

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A number input that commits on blur or Enter. */
export function NumField({ label, value, onCommit, placeholder, disabled }: { label: string; value: number | null; onCommit: (n: number) => void; placeholder?: string; disabled?: boolean }) {
  const [text, setText] = useState(value === null ? "" : String(r2(value)));
  useEffect(() => setText(value === null ? "" : String(r2(value))), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) {
      setText(value === null ? "" : String(r2(value)));
      return;
    }
    if (value === null || Math.abs(n - value) > 0.001) onCommit(n);
  };
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input value={text} placeholder={placeholder} disabled={disabled} inputMode="decimal" className="h-8 font-mono text-xs" onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </div>
  );
}

export interface TrimmableClip {
  id: string;
  url: string;
  trimStartSec: number;
  /** null = the end of the source. */
  trimEndSec: number | null;
  playbackRate: number;
  sourceDurationSec: number | null;
}

/** Source trim for a video: in/out handles over the whole clip with a live preview of the frame being set. */
export function TrimEditor({ clip, onCommit, hint, disabled }: { clip: TrimmableClip; onCommit: (trim: { trimStartSec: number; trimEndSec: number | null }) => void; hint?: string; disabled?: boolean }) {
  const source = clip.sourceDurationSec ?? 0;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [range, setRange] = useState<[number, number]>([clip.trimStartSec, clip.trimEndSec ?? source]);
  const last = useRef(range);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const next: [number, number] = [clip.trimStartSec, clip.trimEndSec ?? source];
    setRange(next);
    last.current = next;
  }, [clip.id, clip.trimStartSec, clip.trimEndSec, source]);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(source, t));
  };
  const commit = ([a, b]: [number, number]) => onCommit({ trimStartSec: r3(a), trimEndSec: Math.abs(b - source) < 0.02 ? null : r3(b) });

  if (!source) return <p className="text-xs text-muted-foreground">The clip length is unknown, so it can&apos;t be trimmed here.</p>;
  return (
    <div className="space-y-2">
      <video
        ref={videoRef}
        src={clip.url}
        muted
        playsInline
        preload="auto"
        className="aspect-video w-full rounded-lg bg-black object-contain"
        onLoadedMetadata={() => seek(range[0])}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          if (playing && e.currentTarget.currentTime >= range[1]) seek(range[1]);
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label={playing ? "Pause" : "Play the trimmed part"}
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (playing) return v.pause();
            if (v.currentTime < range[0] || v.currentTime >= range[1] - 0.05) v.currentTime = range[0];
            v.playbackRate = clip.playbackRate || 1;
            void v.play();
          }}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Slider
          min={0}
          max={source}
          step={0.01}
          minStepsBetweenThumbs={10}
          value={range}
          disabled={disabled}
          aria-label="Trim in and out"
          onValueChange={(v) => {
            const next = [v[0], v[1]] as [number, number];
            seek(next[0] !== last.current[0] ? next[0] : next[1]);
            last.current = next;
            setRange(next);
          }}
          onValueCommit={(v) => commit([v[0], v[1]])}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-end gap-1">
          <NumField label="In (s into the clip)" value={range[0]} disabled={disabled} onCommit={(n) => commit([Math.max(0, Math.min(n, range[1] - 0.1)), range[1]])} />
          <Button size="icon-sm" variant="ghost" disabled={disabled} title="Set in to the preview frame" aria-label="Set in to the preview frame" onClick={() => videoRef.current && commit([Math.min(videoRef.current.currentTime, range[1] - 0.1), range[1]])}>
            <Crosshair />
          </Button>
        </div>
        <div className="flex items-end gap-1">
          <NumField label="Out" value={range[1]} disabled={disabled} onCommit={(n) => commit([range[0], Math.min(source, Math.max(n, range[0] + 0.1))])} />
          <Button size="icon-sm" variant="ghost" disabled={disabled} title="Set out to the preview frame" aria-label="Set out to the preview frame" onClick={() => videoRef.current && commit([range[0], Math.max(videoRef.current.currentTime, range[0] + 0.1)])}>
            <Crosshair />
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Plays {((range[1] - range[0]) / (clip.playbackRate || 1)).toFixed(2)}s of the {source.toFixed(2)}s clip. {hint ?? "Drag the handles — the preview shows the frame."}
      </p>
    </div>
  );
}

/**
 * Video speed: presets, any speed, “plays in” seconds, and a one-click fit so the trimmed part fills
 * exactly the time it's on screen.
 */
export function SpeedControl({
  rate,
  partSec,
  onScreenSec,
  onScreenLabel,
  onRate,
  onPlayIn,
  disabled,
}: {
  rate: number;
  /** Source seconds of the trimmed part (null when the clip length is unknown). */
  partSec: number | null;
  /** Seconds the video is on screen. */
  onScreenSec: number;
  /** What the fit button fills, e.g. “its time on screen”. */
  onScreenLabel: string;
  onRate: (rate: number) => void;
  /** Play the trimmed part in `seconds` at the computed `rate`. */
  onPlayIn: (seconds: number, rate: number) => void;
  disabled?: boolean;
}) {
  const speed = rate || 1;
  const known = partSec !== null && partSec > 0;
  const playsSec = known ? partSec / speed : null;
  const needed = known && onScreenSec > 0 ? partSec / onScreenSec : null;
  const fitRate = known ? fitPlaybackRate(partSec, onScreenSec) : null;
  const fits = playsSec !== null && Math.abs(playsSec - onScreenSec) < 0.02;
  const outOfRange = needed !== null && (needed < MIN_PLAYBACK_RATE || needed > MAX_PLAYBACK_RATE);
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Speed</Label>
        <div className="flex flex-wrap gap-1">
          {SPEED_PRESETS.map((p) => {
            const active = Math.abs(speed - p) < 0.001;
            return (
              <Button key={p} size="xs" variant={active ? "secondary" : "outline"} className={cn(active && "ring-1 ring-primary")} disabled={disabled} onClick={() => onRate(p)}>
                {p}×
              </Button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label={`Any speed (${MIN_PLAYBACK_RATE}–${MAX_PLAYBACK_RATE}×)`} value={speed} disabled={disabled} onCommit={(n) => onRate(clampPlaybackRate(n))} />
        <NumField label="Plays in (s)" value={playsSec} disabled={disabled || !known} onCommit={(n) => known && n > 0 && onPlayIn(r3(n), fitPlaybackRate(partSec, n))} />
      </div>
      {known && onScreenSec > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="outline" disabled={disabled || fits} onClick={() => fitRate !== null && onRate(fitRate)}>
            <Gauge /> Fit to {onScreenLabel} ({onScreenSec.toFixed(2)}s)
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {fits
              ? "The trimmed part fills it exactly."
              : outOfRange
                ? `Needs ${needed!.toFixed(2)}× — speed is limited to ${MIN_PLAYBACK_RATE}–${MAX_PLAYBACK_RATE}×, so trim the clip too.`
                : `Sets ${fitRate}×.`}
          </span>
        </div>
      ) : null}
    </div>
  );
}
