"use client";

import { useQuery } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatClock } from "@/core/timing/frames";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface WaveformHandle {
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
}

interface Peaks {
  peaksPerSecond: number;
  durationSec: number;
  data: number[];
}

export function usePeaks(peaksUrl: string | null | undefined) {
  return useQuery({
    queryKey: ["peaks", peaksUrl],
    queryFn: async () => (await fetch(peaksUrl!)).json() as Promise<Peaks>,
    enabled: !!peaksUrl,
    staleTime: Infinity,
  });
}

/** Draws a bar waveform for [from, to) seconds into a canvas. */
export function drawWaveform(ctx: CanvasRenderingContext2D, peaks: Peaks | undefined, opts: { width: number; height: number; from: number; to: number; playedUntil?: number; color?: string; playedColor?: string; barWidth?: number; gap?: number }) {
  const { width, height, from, to } = opts;
  const barWidth = opts.barWidth ?? 2;
  const step = barWidth + (opts.gap ?? 1);
  ctx.clearRect(0, 0, width, height);
  const bars = Math.max(1, Math.floor(width / step));
  const span = Math.max(1e-6, to - from);
  // Theme-aware defaults: unplayed bars use the text color at low alpha, played bars the voice track color.
  const styles = typeof window !== "undefined" ? getComputedStyle(ctx.canvas) : null;
  const unplayed = opts.color ?? styles?.color ?? "rgb(236,236,240)";
  const unplayedAlpha = opts.color ? 1 : 0.3;
  const played = opts.playedColor ?? (styles?.getPropertyValue("--track-voice").trim() || "#3dd6f5");
  for (let b = 0; b < bars; b++) {
    const t0 = from + (b / bars) * span;
    const t1 = from + ((b + 1) / bars) * span;
    let max = 0;
    if (peaks) {
      const i0 = Math.floor(t0 * peaks.peaksPerSecond);
      const i1 = Math.max(i0 + 1, Math.ceil(t1 * peaks.peaksPerSecond));
      for (let i = i0; i < i1 && i < peaks.data.length; i++) if (i >= 0) max = Math.max(max, peaks.data[i]);
    }
    const amp = peaks ? Math.max(0.03, max / 255) : 0.05;
    const h = amp * (height - 6);
    const x = b * step;
    const isPlayed = opts.playedUntil !== undefined && t0 < opts.playedUntil;
    ctx.fillStyle = isPlayed ? played : unplayed;
    ctx.globalAlpha = isPlayed ? 1 : unplayedAlpha;
    ctx.fillRect(x, (height - h) / 2, barWidth, h);
    ctx.globalAlpha = 1;
  }
}

export const WaveformPlayer = forwardRef<
  WaveformHandle,
  { url: string; peaksUrl: string | null; durationSec: number; height?: number; onTime?: (seconds: number) => void; className?: string }
>(function WaveformPlayer({ url, peaksUrl, durationSec, height = 56, onTime, className }, ref) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [width, setWidth] = useState(0);
  const peaks = usePeaks(peaksUrl);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWaveform(ctx, peaks.data, { width, height, from: 0, to: durationSec, playedUntil: time });
  }, [width, height, peaks.data, time, durationSec]);

  const seek = useCallback((seconds: number) => {
    const t = Math.max(0, Math.min(durationSec, seconds));
    if (audioRef.current) audioRef.current.currentTime = t;
    setTime(t);
    onTimeRef.current?.(t);
  }, [durationSec]);

  useImperativeHandle(ref, () => ({ seek, play: () => void audioRef.current?.play(), pause: () => audioRef.current?.pause() }), [seek]);

  const seekFromClientX = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    seek(((clientX - rect.left) / rect.width) * durationSec);
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Button size="icon" variant="secondary" aria-label={playing ? "Pause" : "Play"} onClick={() => (playing ? audioRef.current?.pause() : void audioRef.current?.play())}>
        {playing ? <Pause /> : <Play />}
      </Button>
      <div
        ref={containerRef}
        className="relative min-w-0 flex-1 cursor-pointer select-none"
        style={{ height }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          seekFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekFromClientX(e.clientX);
        }}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-valuenow={time}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seek(time + 1);
          if (e.key === "ArrowLeft") seek(time - 1);
          if (e.key === " ") {
            e.preventDefault();
            if (playing) audioRef.current?.pause();
            else void audioRef.current?.play();
          }
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
      <span className="w-28 shrink-0 text-right font-mono text-xs text-muted-foreground tabular">
        {formatClock(time)} / {formatClock(durationSec)}
      </span>
      <audio
        ref={audioRef}
        src={url}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onSeeked={(e) => setTime(e.currentTarget.currentTime)}
      />
    </div>
  );
});
