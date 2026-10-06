"use client";

import { Loader2, Pause, Play, Plus, Sparkles, Trash2, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_ZOOM_EASE_SEC, MAX_ZOOMS_PER_CLIP, MIN_ZOOM_SEC, MIN_ZOOM_SIZE, clampZoomRect, normalizeZooms, zoomTransform, zoomViewAt, type OverlayZoom, type ZoomRect } from "@/core/timeline/overlay-zoom";
import type { OverlayEndBehavior } from "@/core/timeline/overlays";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/**
 * Zoom regions for an overlay clip or an image/video inside a scene: add a zoom at the playhead, draw
 * the area on the clip's frame, set when it zooms in and out, optionally pan to a second area, and
 * preview the move.
 */

/** What the zoom editor needs to know about a clip (an overlay clip, or media inside a scene). */
export interface ZoomableClip {
  id: string;
  kind: "image" | "video";
  url: string;
  fit: "cover" | "contain";
  /** Video seconds the clip appears; zoom times count from here. */
  startSec: number;
  /** Seconds it's on screen. */
  durationSec: number;
  trimStartSec: number;
  playbackRate: number;
  trimmedLengthSec: number | null;
  endBehavior: OverlayEndBehavior;
  zooms: OverlayZoom[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const EASES = [
  { value: 0.3, label: "Snappy (0.3 s)" },
  { value: 0.5, label: "Smooth (0.5 s)" },
  { value: 0.8, label: "Slow (0.8 s)" },
  { value: 1.2, label: "Very slow (1.2 s)" },
];
const rectStyle = (r: ZoomRect) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.size * 100}%`, height: `${r.size * 100}%` });

/** Source second of a video shown at a clip second (trim, speed, hold or loop). */
function sourceTimeAt(clip: ZoomableClip, clipSec: number): number {
  const rate = clip.playbackRate || 1;
  let t = Math.max(0, clipSec);
  const trimmed = clip.trimmedLengthSec;
  if (trimmed !== null && trimmed > 0 && t >= trimmed) t = clip.endBehavior === "loop" ? t % trimmed : Math.max(0, trimmed - 0.04);
  return clip.trimStartSec + t * rate;
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const shown = value.toFixed(2);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return setText(shown);
    if (Math.abs(n - value) > 0.001) onCommit(n);
  };
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input value={text} inputMode="decimal" className="h-8 font-mono text-xs" onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </div>
  );
}

interface AreaDrag {
  mode: "move" | "tl" | "br";
  originX: number;
  originY: number;
  start: ZoomRect;
}

export function ZoomPanel({
  clip,
  aspect,
  getTime,
  onSeek,
  onCommit,
  focusZoomId,
  showTimelineHint = true,
  onSuggest,
  onSelectZoom,
  bare = false,
}: {
  /** Finds zoom suggestions where part of a recording changes (videos only). */
  onSuggest?: () => Promise<OverlayZoom[]>;
  clip: ZoomableClip;
  /** Width ÷ height of the clip's frame on screen. */
  aspect: number;
  getTime: () => number;
  onSeek?: (timeSec: number) => void;
  onCommit: (zooms: OverlayZoom[]) => void;
  focusZoomId?: string | null;
  /** Mention the zoom bars on the timeline (overlay clips have them). */
  showTimelineHint?: boolean;
  /** Reports the zoom being edited (null when none), e.g. so the editor canvas can show its area. */
  onSelectZoom?: (zoomId: string | null) => void;
  /** Inside an inspector section: no divider or heading of its own. */
  bare?: boolean;
}) {
  const zooms = clip.zooms;
  const [selectedId, setSelectedId] = useState<string | null>(focusZoomId ?? zooms[0]?.id ?? null);
  useEffect(() => {
    if (focusZoomId) setSelectedId(focusZoomId);
  }, [focusZoomId]);
  const selected = zooms.find((z) => z.id === selectedId) ?? null;
  const onSelectZoomRef = useRef(onSelectZoom);
  onSelectZoomRef.current = onSelectZoom;
  const selectedZoomId = selected?.id ?? null;
  useEffect(() => {
    onSelectZoomRef.current?.(selectedZoomId);
  }, [selectedZoomId]);
  useEffect(() => () => onSelectZoomRef.current?.(null), []);
  const [target, setTarget] = useState<"rect" | "toRect">("rect");
  const hasPan = !!selected?.toRect;
  useEffect(() => {
    if (!hasPan) setTarget("rect");
  }, [hasPan]);
  const [liveRect, setLiveRect] = useState<ZoomRect | null>(null);
  const [playing, setPlaying] = useState(false);
  const dragRef = useRef<AreaDrag | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const duration = clip.durationSec;
  const toVideo = (clipSec: number) => r3(clip.startSec + clipSec);
  const commit = (next: OverlayZoom[]) => onCommit(normalizeZooms(next));
  const patchSelected = (patch: Partial<OverlayZoom>) => {
    if (selected) commit(zooms.map((z) => (z.id === selected.id ? { ...z, ...patch } : z)));
  };

  const areaRect = selected ? (liveRect ?? (target === "toRect" && selected.toRect ? selected.toRect : selected.rect)) : null;
  const otherRect = selected ? (target === "toRect" ? selected.rect : selected.toRect) : null;

  // Show the frame the area applies to: fully zoomed in (first area) or at the end of the pan (second area).
  const editSec = selected ? (target === "toRect" ? Math.max(selected.startSec, selected.endSec - selected.easeSec) : Math.min(selected.endSec, selected.startSec + selected.easeSec)) : 0;
  const sourceSec = clip.kind === "video" ? sourceTimeAt(clip, editSec) : 0;
  useEffect(() => {
    const v = videoRef.current;
    if (!v || playing) return;
    const seek = () => {
      v.pause();
      v.currentTime = sourceSec;
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
  }, [sourceSec, playing, selectedId]);

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    videoRef.current?.pause();
    if (mediaRef.current) mediaRef.current.style.transform = "";
    setPlaying(false);
  };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const preview = () => {
    if (!selected) return;
    if (playing) return stop();
    const from = Math.max(0, selected.startSec - 0.6);
    const to = Math.min(duration, selected.endSec + 0.6);
    setPlaying(true);
    const v = videoRef.current;
    if (v) {
      v.playbackRate = clip.playbackRate || 1;
      v.currentTime = sourceTimeAt(clip, from);
      void v.play();
    }
    const t0 = performance.now();
    const tick = () => {
      const clipSec = from + (performance.now() - t0) / 1000;
      if (mediaRef.current) mediaRef.current.style.transform = zoomTransform(zoomViewAt(clipSec, zooms)) ?? "";
      if (clipSec >= to) return stop();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const [suggesting, setSuggesting] = useState(false);
  const suggest = async () => {
    if (!onSuggest) return;
    setSuggesting(true);
    try {
      const found = await onSuggest();
      // Skip suggestions that overlap a zoom the clip already has.
      const fresh = found.filter((s) => !zooms.some((z) => s.startSec < z.endSec && s.endSec > z.startSec));
      if (!fresh.length) {
        toast.info(found.length ? "The suggested moments already have zooms" : "No clear moments to zoom into", { description: found.length ? undefined : "Zoom suggestions look for typing, clicks or menus in one part of the screen." });
        return;
      }
      const next = normalizeZooms([...zooms, ...fresh]).slice(0, MAX_ZOOMS_PER_CLIP);
      commit(next);
      setSelectedId(fresh[0].id);
      toast.success(`${fresh.length} zoom${fresh.length === 1 ? "" : "s"} suggested`, { description: "Check each area and time. Press Ctrl+Z to undo." });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't suggest zooms");
    } finally {
      setSuggesting(false);
    }
  };

  const add = () => {
    const playhead = getTime() - clip.startSec;
    const at = playhead >= 0 && playhead < duration ? playhead : 0;
    const startSec = r3(Math.max(0, Math.min(at, duration - MIN_ZOOM_SEC)));
    const zoom: OverlayZoom = { id: `z${Date.now().toString(36)}`, startSec, endSec: r3(Math.min(duration, startSec + 2.5)), rect: { x: 0.25, y: 0.25, size: 0.5 }, toRect: null, easeSec: DEFAULT_ZOOM_EASE_SEC };
    commit([...zooms, zoom]);
    setSelectedId(zoom.id);
    setTarget("rect");
  };

  const onAreaDown = (e: React.PointerEvent, mode: AreaDrag["mode"]) => {
    if (!areaRect || playing) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { mode, originX: e.clientX, originY: e.clientY, start: areaRect };
  };
  const onAreaMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const el = areaRef.current;
    if (!d || !el) return;
    const bounds = el.getBoundingClientRect();
    const dx = (e.clientX - d.originX) / bounds.width;
    const dy = (e.clientY - d.originY) / bounds.height;
    const s = d.start;
    let next: ZoomRect;
    if (d.mode === "move") next = { ...s, x: s.x + dx, y: s.y + dy };
    else if (d.mode === "br") next = { ...s, size: Math.max(MIN_ZOOM_SIZE, Math.min(s.size + (dx + dy) / 2, 1 - s.x, 1 - s.y)) };
    else {
      // The top-left handle keeps the bottom-right corner in place.
      const size = Math.max(MIN_ZOOM_SIZE, Math.min(s.size - (dx + dy) / 2, s.x + s.size, s.y + s.size));
      next = { x: s.x + s.size - size, y: s.y + s.size - size, size };
    }
    setLiveRect(clampZoomRect(next));
  };
  const onAreaUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && liveRect && selected) patchSelected(target === "toRect" ? { toRect: liveRect } : { rect: liveRect });
    setLiveRect(null);
  };

  /** Zoom presets keep the area's centre and change how close it is. */
  const setZoomFactor = (factor: number) => {
    if (!selected || !areaRect) return;
    const size = 1 / factor;
    const cx = areaRect.x + areaRect.size / 2;
    const cy = areaRect.y + areaRect.size / 2;
    const rect = clampZoomRect({ x: cx - size / 2, y: cy - size / 2, size });
    patchSelected(target === "toRect" ? { toRect: rect } : { rect });
  };
  /** Clicking the frame outside the area centres the area there. */
  const centerAt = (e: React.PointerEvent) => {
    if (!selected || !areaRect || playing || (e.target as HTMLElement).closest("[data-zoom-area]")) return;
    const bounds = areaRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const cx = (e.clientX - bounds.left) / bounds.width;
    const cy = (e.clientY - bounds.top) / bounds.height;
    const rect = clampZoomRect({ x: cx - areaRect.size / 2, y: cy - areaRect.size / 2, size: areaRect.size });
    patchSelected(target === "toRect" ? { toRect: rect } : { rect });
  };

  const easeOptions = selected && !EASES.some((e) => e.value === selected.easeSec) ? [...EASES, { value: selected.easeSec, label: `${selected.easeSec} s` }] : EASES;

  return (
    <div className={cn("@container space-y-3", !bare && "border-t border-border pt-3")}>
      <div className="flex flex-wrap items-center gap-2">
        {!bare ? (
          <>
            <Label className="flex items-center gap-1.5 text-xs font-medium">
              <ZoomIn className="size-3.5" /> Zoom
            </Label>
            <span className="text-[11px] text-muted-foreground">Zoom into part of the {clip.kind === "video" ? "recording" : "image"} while you talk about it.</span>
          </>
        ) : null}
        {onSuggest && clip.kind === "video" && (
          <Button size="xs" variant="outline" className={cn(!bare && "ml-auto")} onClick={suggest} disabled={suggesting || zooms.length >= MAX_ZOOMS_PER_CLIP} title="Looks for moments where only part of the recording changes (typing, clicks, menus) and adds a zoom there">
            {suggesting ? <Loader2 className="animate-spin" /> : <Sparkles />} Suggest zooms
          </Button>
        )}
        <Button size="xs" variant="outline" className={cn(!bare && !(onSuggest && clip.kind === "video") && "ml-auto")} onClick={add} disabled={zooms.length >= MAX_ZOOMS_PER_CLIP || duration < MIN_ZOOM_SEC}>
          <Plus /> Add zoom at playhead
        </Button>
      </div>

      {zooms.length ? (
        <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {zooms.map((z, i) => (
                <Button
                  key={z.id}
                  size="xs"
                  variant={z.id === selected?.id ? "secondary" : "outline"}
                  className={cn(z.id === selected?.id && "ring-1 ring-primary")}
                  onClick={() => {
                    setSelectedId(z.id);
                    onSeek?.(toVideo(z.startSec));
                  }}
                >
                  Zoom {i + 1}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {toVideo(z.startSec).toFixed(1)}–{toVideo(z.endSec).toFixed(1)}s · {(1 / (z.toRect ? Math.min(z.rect.size, z.toRect.size) : z.rect.size)).toFixed(1)}×
                  </span>
                </Button>
              ))}
            </div>
            {selected ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <TimeField label="Zooms in at (video s)" value={toVideo(selected.startSec)} onCommit={(n) => patchSelected({ startSec: Math.max(0, Math.min(n - clip.startSec, selected.endSec - MIN_ZOOM_SEC)) })} />
                  <TimeField label="Back out by (video s)" value={toVideo(selected.endSec)} onCommit={(n) => patchSelected({ endSec: Math.min(duration, Math.max(n - clip.startSec, selected.startSec + MIN_ZOOM_SEC)) })} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="xs" variant="outline" onClick={() => patchSelected({ startSec: Math.max(0, Math.min(getTime() - clip.startSec, selected.endSec - MIN_ZOOM_SEC)) })}>
                    Start at playhead
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => patchSelected({ endSec: Math.min(duration, Math.max(getTime() - clip.startSec, selected.startSec + MIN_ZOOM_SEC)) })}>
                    End at playhead
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      commit(zooms.filter((z) => z.id !== selected.id));
                      setSelectedId(null);
                    }}
                  >
                    <Trash2 /> Remove
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-[11px] text-muted-foreground">How close</span>
                  {[1.5, 2, 3, 4].map((factor) => (
                    <Button key={factor} size="xs" variant={areaRect && Math.abs(1 / areaRect.size - factor) < 0.05 ? "secondary" : "outline"} onClick={() => setZoomFactor(factor)}>
                      {factor}×
                    </Button>
                  ))}
                </div>
                <div className="grid grid-cols-2 items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Zoom in and out</Label>
                    <Select value={String(selected.easeSec)} onValueChange={(v) => patchSelected({ easeSec: Number(v) })}>
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {easeOptions.map((e) => (
                          <SelectItem key={e.value} value={String(e.value)}>
                            {e.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 pb-1.5 text-xs">
                    <Switch
                      checked={hasPan}
                      onCheckedChange={(on) => {
                        patchSelected({ toRect: on ? clampZoomRect({ ...selected.rect, x: selected.rect.x + 0.25 }) : null });
                        if (on) setTarget("toRect");
                      }}
                    />
                    Pan to a second area
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {(1 / (areaRect?.size ?? 1)).toFixed(1)}× zoom. Drag the box to choose the area; drag a corner to zoom closer or wider.
                  {hasPan ? " While it holds, the view pans from the first area to the second." : ""}
                  {showTimelineHint ? " You can also drag the zoom bar inside the clip on the timeline." : ""}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">Pick a zoom to edit it.</p>
            )}
          </div>

          {selected && areaRect ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                {hasPan ? (
                  <>
                    <Button size="xs" variant={target === "rect" ? "secondary" : "ghost"} onClick={() => setTarget("rect")}>
                      First area
                    </Button>
                    <Button size="xs" variant={target === "toRect" ? "secondary" : "ghost"} onClick={() => setTarget("toRect")}>
                      Pan to
                    </Button>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Zoom area</span>
                )}
                <Button size="xs" variant="outline" className="ml-auto" onClick={preview}>
                  {playing ? <Pause /> : <Play />} {playing ? "Stop" : "Preview zoom"}
                </Button>
              </div>
              <div
                ref={areaRef}
                className="relative w-full touch-none overflow-hidden rounded-lg bg-black select-none"
                style={{ aspectRatio: String(aspect) }}
                onPointerDown={centerAt}
                onPointerMove={onAreaMove}
                onPointerUp={onAreaUp}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setLiveRect(null);
                }}
              >
                <div ref={mediaRef} className="absolute inset-0" style={{ transformOrigin: "0 0" }}>
                  {clip.kind === "video" ? (
                    <video ref={videoRef} src={clip.url} muted playsInline preload="auto" className="block h-full w-full" style={{ objectFit: clip.fit }} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={clip.url} alt="" draggable={false} className="block h-full w-full" style={{ objectFit: clip.fit }} />
                  )}
                </div>
                {!playing ? (
                  <>
                    {otherRect ? <div className="pointer-events-none absolute border-2 border-dashed border-white/60" style={rectStyle(otherRect)} /> : null}
                    <div data-zoom-area className="absolute cursor-move border-2 border-white" style={{ ...rectStyle(areaRect), boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }} onPointerDown={(e) => onAreaDown(e, "move")}>
                      <div className="absolute -top-2 -left-2 size-4 cursor-nwse-resize rounded-sm border-2 border-white bg-black" onPointerDown={(e) => onAreaDown(e, "tl")} />
                      <div className="absolute -right-2 -bottom-2 size-4 cursor-nwse-resize rounded-sm border-2 border-white bg-black" onPointerDown={(e) => onAreaDown(e, "br")} />
                      <span className="pointer-events-none absolute top-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">{target === "toRect" ? "Pan to" : "Zoom area"}</span>
                    </div>
                  </>
                ) : null}
              </div>
              <p className="font-mono text-[10px] text-muted-foreground">
                Frame at {toVideo(editSec).toFixed(2)}s{clip.kind === "video" ? ` · ${sourceSec.toFixed(2)}s into the clip` : ""}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">No zooms yet. Move the playhead to where you want to zoom in, then click Add zoom at playhead.</p>
      )}
    </div>
  );
}
