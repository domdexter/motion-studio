"use client";

import { ArrowUpRight, Crop as CropIcon, Crosshair, EyeOff, FastForward, MousePointerClick, ScanSearch, Snowflake, Square, Trash2, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ANNOTATION_LABELS,
  CLICK_RIPPLE_SEC,
  MAX_CROP,
  normalizeAnnotations,
  normalizeCrop,
  normalizeSpeedSegments,
  type Annotation,
  type AnnotationType,
  type Crop,
  type SpeedSegment,
} from "@/core/timeline/clip-edits";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { NumField } from "./media-controls";

/**
 * Picture edits shared by the overlay panel and the scene media panel: annotations (blur, box, arrow,
 * label, spotlight, click ripple), crop, and for videos speed ramps and freeze frames. Times are shown
 * in video seconds; they are stored in clip seconds (from when the clip appears).
 *
 * The layout follows the panel's own width (container queries): in a narrow inspector everything
 * stacks with the frame preview full width; on a wide page the preview sits next to the controls.
 */

export interface EditableClip {
  id: string;
  kind: "image" | "video";
  url: string;
  fit: "cover" | "contain";
  /** Video seconds the clip appears. */
  startSec: number;
  /** Seconds it's on screen. */
  durationSec: number;
  trimStartSec: number;
  playbackRate: number;
  /** Width ÷ height of the source media (before the crop). */
  mediaAspect: number | null;
}

export interface ClipEditsPatch {
  crop?: Crop | null;
  speedSegments?: SpeedSegment[];
  annotations?: Annotation[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
const COLORS = ["#FFD23F", "#FF4D4F", "#3B82F6", "#22C55E", "#FFFFFF", "#111111"];
const RATES = [
  { value: 0, label: "Freeze" },
  { value: 0.25, label: "0.25×" },
  { value: 0.5, label: "0.5×" },
  { value: 1.5, label: "1.5×" },
  { value: 2, label: "2×" },
  { value: 4, label: "4×" },
  { value: 8, label: "8×" },
  { value: 16, label: "16×" },
];
const TYPE_ICONS: Record<AnnotationType, React.ReactNode> = {
  blur: <EyeOff />,
  box: <Square />,
  arrow: <ArrowUpRight />,
  label: <Type />,
  spotlight: <ScanSearch />,
  click: <MousePointerClick />,
};
const SHORT_LABELS: Record<AnnotationType, string> = { blur: "Blur", box: "Box", arrow: "Arrow", label: "Label", spotlight: "Spotlight", click: "Click" };

/** A still of the clip at a source second, at the clip's aspect ratio, with editing handles on top. */
function FramePreview({ clip, sourceSec, aspect, children, frameRef, onPointerMove, onPointerUp }: { clip: EditableClip; sourceSec: number; aspect: number; children: React.ReactNode; frameRef: React.RefObject<HTMLDivElement | null>; onPointerMove: (e: React.PointerEvent) => void; onPointerUp: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seek = () => {
      v.pause();
      v.currentTime = Math.max(0, sourceSec);
    };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
  }, [sourceSec]);
  return (
    <div ref={frameRef} className="relative w-full touch-none overflow-hidden rounded-lg bg-black select-none" style={{ aspectRatio: String(aspect) }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {clip.kind === "video" ? (
        <video ref={videoRef} src={clip.url} muted playsInline preload="auto" className="absolute inset-0 block h-full w-full" style={{ objectFit: clip.fit }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={clip.url} alt="" draggable={false} className="absolute inset-0 block h-full w-full" style={{ objectFit: clip.fit }} />
      )}
      {children}
    </div>
  );
}

export function ClipEditsPanel({
  clip,
  crop,
  speedSegments,
  annotations,
  getTime,
  onSeek,
  onCommit,
  disabled,
  className,
}: {
  clip: EditableClip;
  crop: Crop | null;
  speedSegments: SpeedSegment[];
  annotations: Annotation[];
  getTime: () => number;
  onSeek?: (timeSec: number) => void;
  onCommit: (patch: ClipEditsPatch) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [tab, setTab] = useState<"marks" | "crop" | "speed">("marks");
  const count = (n: number) => (n ? ` (${n})` : "");
  // Short labels fit a narrow inspector; wide panels spell them out.
  const tabs = [
    { id: "marks" as const, short: `Annotations${count(annotations.length)}`, label: `Annotations${count(annotations.length)}` },
    { id: "crop" as const, short: crop ? "Crop (on)" : "Crop", label: crop ? "Crop (on)" : "Crop" },
    ...(clip.kind === "video" ? [{ id: "speed" as const, short: `Speed${count(speedSegments.length)}`, label: `Speed & freezes${count(speedSegments.length)}` }] : []),
  ];
  return (
    <div className={cn("@container space-y-3 border-t border-border pt-3", disabled && "pointer-events-none opacity-60", className)}>
      <div className="flex items-center gap-2">
        <Label className="hidden shrink-0 text-xs font-medium @3xl:inline">Edit the picture</Label>
        <div role="tablist" aria-label="Picture edits" className="grid min-w-0 flex-1 auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-muted p-0.5 @3xl:flex-none">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "h-7 min-w-0 truncate rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors",
                tab === t.id ? "bg-background text-foreground shadow-sm dark:bg-input/40" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="@md:hidden">{t.short}</span>
              <span className="hidden @md:inline">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      {tab === "crop" ? (
        <CropEditor clip={clip} crop={crop} onCommit={(next) => onCommit({ crop: next })} />
      ) : tab === "speed" && clip.kind === "video" ? (
        <SpeedSegmentsEditor clip={clip} segments={speedSegments} getTime={getTime} onSeek={onSeek} onCommit={(next) => onCommit({ speedSegments: next })} />
      ) : (
        <AnnotationsEditor clip={clip} crop={crop} annotations={annotations} getTime={getTime} onSeek={onSeek} onCommit={(next) => onCommit({ annotations: next })} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Crop
// ---------------------------------------------------------------------------------------

type CropSide = "left" | "right" | "top" | "bottom" | "move";

function CropEditor({ clip, crop, onCommit }: { clip: EditableClip; crop: Crop | null; onCommit: (crop: Crop | null) => void }) {
  const cropKey = JSON.stringify(crop);
  const [live, setLive] = useState<Crop>(crop ?? NO_CROP);
  useEffect(() => setLive(crop ?? NO_CROP), [cropKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ side: CropSide; x: number; y: number; start: Crop } | null>(null);

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = frameRef.current;
    if (!d || !el) return;
    const b = el.getBoundingClientRect();
    const dx = (e.clientX - d.x) / b.width;
    const dy = (e.clientY - d.y) / b.height;
    const s = d.start;
    const next = { ...s };
    if (d.side === "left") next.left = clamp(s.left + dx, 0, Math.min(MAX_CROP, 0.9 - s.right));
    if (d.side === "right") next.right = clamp(s.right - dx, 0, Math.min(MAX_CROP, 0.9 - s.left));
    if (d.side === "top") next.top = clamp(s.top + dy, 0, Math.min(MAX_CROP, 0.9 - s.bottom));
    if (d.side === "bottom") next.bottom = clamp(s.bottom - dy, 0, Math.min(MAX_CROP, 0.9 - s.top));
    if (d.side === "move") {
      const mx = clamp(dx, -s.left, s.right);
      const my = clamp(dy, -s.top, s.bottom);
      Object.assign(next, { left: s.left + mx, right: s.right - mx, top: s.top + my, bottom: s.bottom - my });
    }
    setLive(next);
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    onCommit(normalizeCrop(live));
  };
  const down = (side: CropSide) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    frameRef.current?.setPointerCapture(e.pointerId);
    drag.current = { side, x: e.clientX, y: e.clientY, start: live };
  };
  const pct = (n: number) => `${n * 100}%`;
  const setSide = (side: keyof Crop, value: number) => onCommit(normalizeCrop({ ...live, [side]: clamp(value / 100, 0, MAX_CROP) }));

  return (
    <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @3xl:gap-4">
      <FramePreview clip={clip} sourceSec={clip.trimStartSec + 0.05} aspect={clip.mediaAspect ?? 16 / 9} frameRef={frameRef} onPointerMove={onMove} onPointerUp={onUp}>
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/60" style={{ height: pct(live.top) }} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60" style={{ height: pct(live.bottom) }} />
        <div className="pointer-events-none absolute left-0 bg-black/60" style={{ top: pct(live.top), bottom: pct(live.bottom), width: pct(live.left) }} />
        <div className="pointer-events-none absolute right-0 bg-black/60" style={{ top: pct(live.top), bottom: pct(live.bottom), width: pct(live.right) }} />
        <div className="absolute cursor-move border-2 border-white" style={{ left: pct(live.left), right: pct(live.right), top: pct(live.top), bottom: pct(live.bottom) }} onPointerDown={down("move")}>
          <div className="absolute top-1/2 -left-1.5 h-8 w-3 -translate-y-1/2 cursor-ew-resize rounded-sm border-2 border-white bg-black" onPointerDown={down("left")} />
          <div className="absolute top-1/2 -right-1.5 h-8 w-3 -translate-y-1/2 cursor-ew-resize rounded-sm border-2 border-white bg-black" onPointerDown={down("right")} />
          <div className="absolute -top-1.5 left-1/2 h-3 w-8 -translate-x-1/2 cursor-ns-resize rounded-sm border-2 border-white bg-black" onPointerDown={down("top")} />
          <div className="absolute -bottom-1.5 left-1/2 h-3 w-8 -translate-x-1/2 cursor-ns-resize rounded-sm border-2 border-white bg-black" onPointerDown={down("bottom")} />
        </div>
      </FramePreview>
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2 @md:grid-cols-4 @3xl:grid-cols-2">
          {(["left", "right", "top", "bottom"] as const).map((side) => (
            <NumField key={side} label={`${side[0].toUpperCase()}${side.slice(1)} (%)`} value={live[side] * 100} onCommit={(n) => setSide(side, n)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" onClick={() => onCommit(normalizeCrop({ ...live, top: Math.max(live.top, 0.08) }))}>
            Cut a browser bar (top 8%)
          </Button>
          <Button size="xs" variant="ghost" disabled={!crop} onClick={() => onCommit(null)}>
            <CropIcon /> Remove crop
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Drag the edges or the box. The part inside fills the clip&apos;s frame; zoom regions and annotations use the cropped picture.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Speed ramps and freeze frames
// ---------------------------------------------------------------------------------------

function SpeedSegmentsEditor({ clip, segments, getTime, onSeek, onCommit }: { clip: EditableClip; segments: SpeedSegment[]; getTime: () => number; onSeek?: (t: number) => void; onCommit: (segments: SpeedSegment[]) => void }) {
  const [freezeSec, setFreezeSec] = useState(2);
  const [fastSec, setFastSec] = useState(3);
  const [fastRate, setFastRate] = useState(4);
  const playhead = () => r3(clamp(getTime() - clip.startSec, 0, Math.max(0, clip.durationSec - 0.1)));
  const commit = (next: SpeedSegment[]) => onCommit(normalizeSpeedSegments(next));
  const add = (rate: number, length: number) => {
    const at = playhead();
    commit([...segments, { id: `s${Date.now().toString(36)}`, startSec: at, endSec: r3(at + Math.max(0.1, length)), rate }]);
  };
  const patch = (id: string, p: Partial<SpeedSegment>) => commit(segments.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const toVideo = (s: number) => r3(clip.startSec + s);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 @xl:grid-cols-2">
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
          <div className="w-24">
            <NumField label="Freeze for (s)" value={freezeSec} onCommit={(n) => setFreezeSec(clamp(n, 0.1, 60))} />
          </div>
          <Button size="sm" variant="outline" onClick={() => add(0, freezeSec)}>
            <Snowflake /> Freeze at playhead
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
          <div className="w-16">
            <NumField label="For (s)" value={fastSec} onCommit={(n) => setFastSec(clamp(n, 0.1, 600))} />
          </div>
          <Select value={String(fastRate)} onValueChange={(v) => setFastRate(Number(v))}>
            <SelectTrigger size="sm" className="w-20" aria-label="Fast-forward speed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RATES.filter((r) => r.value > 1).map((r) => (
                <SelectItem key={r.value} value={String(r.value)}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => add(fastRate, fastSec)}>
            <FastForward /> Fast-forward
          </Button>
        </div>
      </div>
      {segments.length ? (
        <ul className="space-y-1.5">
          {segments.map((s) => (
            <li key={s.id} className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-1.5 rounded-lg border border-border bg-muted/20 p-2">
              <div className="min-w-0 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Speed</Label>
                <Select value={String(s.rate)} onValueChange={(v) => patch(s.id, { rate: Number(v) })}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(RATES.some((r) => r.value === s.rate) ? RATES : [...RATES, { value: s.rate, label: `${s.rate}×` }]).map((r) => (
                      <SelectItem key={r.value} value={String(r.value)}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <NumField label="From (s)" value={toVideo(s.startSec)} onCommit={(n) => patch(s.id, { startSec: Math.max(0, n - clip.startSec) })} />
              <NumField label="To (s)" value={toVideo(s.endSec)} onCommit={(n) => patch(s.id, { endSec: Math.max(0, n - clip.startSec) })} />
              <div className="flex items-center pb-0.5">
                {onSeek ? (
                  <Button size="icon-xs" variant="ghost" aria-label="Go to its start" title="Go to its start" onClick={() => onSeek(toVideo(s.startSec))}>
                    <Crosshair />
                  </Button>
                ) : null}
                <Button size="icon-xs" variant="ghost" aria-label="Remove" title="Remove" onClick={() => commit(segments.filter((x) => x.id !== s.id))}>
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">No speed changes. Move the playhead to a slow part of the recording and fast-forward it, or freeze the picture while you talk about it.</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Times are video seconds while the clip is on screen. A freeze holds the picture and plays the rest later, so the clip runs longer: make it longer on the timeline to see its end. While speed changes are set, the clip&apos;s own audio is muted.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------------------

type AnnotationDrag = { mode: "move" | "resize" | "tip"; x: number; y: number; start: Annotation };

const DEFAULTS: Record<AnnotationType, Partial<Annotation>> = {
  blur: { x: 0.35, y: 0.35, w: 0.3, h: 0.15, strength: 0.6 },
  box: { x: 0.3, y: 0.3, w: 0.4, h: 0.3 },
  arrow: { x: 0.25, y: 0.25, w: 0.2, h: 0.15 },
  label: { x: 0.08, y: 0.08, w: 0, h: 0, text: "Look here" },
  spotlight: { x: 0.3, y: 0.3, w: 0.4, h: 0.4, strength: 0.6 },
  click: { x: 0.5, y: 0.5, w: 0, h: 0 },
};

function AnnotationsEditor({ clip, crop, annotations, getTime, onSeek, onCommit }: { clip: EditableClip; crop: Crop | null; annotations: Annotation[]; getTime: () => number; onSeek?: (t: number) => void; onCommit: (annotations: Annotation[]) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(annotations[0]?.id ?? null);
  const selected = annotations.find((a) => a.id === selectedId) ?? null;
  const [live, setLive] = useState<Annotation | null>(null);
  const drag = useRef<AnnotationDrag | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(selected?.text ?? "");
  useEffect(() => setText(selected?.text ?? ""), [selected?.id, selected?.text]);

  const commit = (next: Annotation[]) => onCommit(normalizeAnnotations(next));
  const patchSelected = (p: Partial<Annotation>) => {
    if (selected) commit(annotations.map((a) => (a.id === selected.id ? { ...a, ...p } : a)));
  };
  const toVideo = (s: number) => r3(clip.startSec + s);
  const playhead = () => r3(clamp(getTime() - clip.startSec, 0, Math.max(0, clip.durationSec - 0.2)));
  const add = (type: AnnotationType) => {
    const at = playhead();
    const a = { id: `a${Date.now().toString(36)}`, type, startSec: at, endSec: r3(at + (type === "click" ? CLICK_RIPPLE_SEC : 2.5)), x: 0, y: 0, w: 0, h: 0, ...DEFAULTS[type] } as Annotation;
    commit([...annotations, a]);
    setSelectedId(a.id);
  };

  const shown = live ?? selected;
  // The frame is the cropped picture: the preview shows the crop's visible part at its aspect ratio.
  const visibleW = 1 - (crop?.left ?? 0) - (crop?.right ?? 0);
  const visibleH = 1 - (crop?.top ?? 0) - (crop?.bottom ?? 0);
  const aspect = ((clip.mediaAspect ?? 16 / 9) * visibleW) / visibleH;
  const sourceSec = clip.kind === "video" ? clip.trimStartSec + (selected ? selected.startSec + 0.1 : 0) * (clip.playbackRate || 1) : 0;

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = frameRef.current;
    if (!d || !el) return;
    const b = el.getBoundingClientRect();
    const dx = (e.clientX - d.x) / b.width;
    const dy = (e.clientY - d.y) / b.height;
    const s = d.start;
    if (d.mode === "move") setLive({ ...s, x: clamp(s.x + dx, 0, 1 - Math.max(0, s.w)), y: clamp(s.y + dy, 0, 1 - Math.max(0, s.h)) });
    else if (d.mode === "resize") setLive({ ...s, w: clamp(s.w + dx, 0.02, 1 - s.x), h: clamp(s.h + dy, 0.02, 1 - s.y) });
    else setLive({ ...s, w: clamp(s.x + s.w + dx, 0, 1) - s.x, h: clamp(s.y + s.h + dy, 0, 1) - s.y });
  };
  const onUp = () => {
    if (drag.current && live) patchSelected({ x: live.x, y: live.y, w: live.w, h: live.h });
    drag.current = null;
    setLive(null);
  };
  const down = (mode: AnnotationDrag["mode"]) => (e: React.PointerEvent) => {
    if (!selected) return;
    e.preventDefault();
    e.stopPropagation();
    frameRef.current?.setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, start: selected };
  };
  const pct = (n: number) => `${n * 100}%`;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <span className="text-[11px] text-muted-foreground">Add at the playhead</span>
        <div className="grid grid-cols-3 gap-1 @3xl:flex @3xl:flex-wrap @3xl:gap-1.5">
          {(Object.keys(ANNOTATION_LABELS) as AnnotationType[]).map((type) => (
            <Button key={type} size="xs" variant="outline" className="min-w-0 justify-start" title={`Add ${ANNOTATION_LABELS[type].toLowerCase()} at the playhead`} onClick={() => add(type)}>
              {TYPE_ICONS[type]}
              <span className="truncate @3xl:hidden">{SHORT_LABELS[type]}</span>
              <span className="hidden @3xl:inline">{ANNOTATION_LABELS[type]}</span>
            </Button>
          ))}
        </div>
      </div>
      {annotations.length ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {annotations.map((a, i) => (
              <Button
                key={a.id}
                size="xs"
                variant={a.id === selected?.id ? "secondary" : "outline"}
                className={cn(a.id === selected?.id && "ring-1 ring-primary")}
                title={`${ANNOTATION_LABELS[a.type]} · ${toVideo(a.startSec).toFixed(2)}–${toVideo(a.endSec).toFixed(2)}s`}
                onClick={() => {
                  setSelectedId(a.id);
                  onSeek?.(toVideo(a.startSec));
                }}
              >
                {TYPE_ICONS[a.type]} {i + 1}
                <span className="font-mono text-[10px] text-muted-foreground">{toVideo(a.startSec).toFixed(1)}s</span>
              </Button>
            ))}
          </div>
          <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] @3xl:gap-4">
            <div className="min-w-0 space-y-2.5">
              {selected ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Shows at (video s)" value={toVideo(selected.startSec)} onCommit={(n) => patchSelected({ startSec: Math.max(0, n - clip.startSec) })} />
                    <NumField label="Until (video s)" value={toVideo(selected.endSec)} onCommit={(n) => patchSelected({ endSec: Math.max(0, n - clip.startSec) })} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => patchSelected({ startSec: playhead(), endSec: Math.max(selected.endSec, playhead() + 0.2) })}>
                      Start at playhead
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => patchSelected({ endSec: Math.max(selected.startSec + 0.2, playhead()) })}>
                      End at playhead
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => {
                        commit(annotations.filter((a) => a.id !== selected.id));
                        setSelectedId(null);
                      }}
                    >
                      <Trash2 /> Remove
                    </Button>
                  </div>
                  {selected.type === "label" ? (
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Text</Label>
                      <Input value={text} maxLength={120} className="h-8 text-xs" onChange={(e) => setText(e.target.value)} onBlur={() => text !== selected.text && patchSelected({ text })} onKeyDown={(e) => e.key === "Enter" && patchSelected({ text })} />
                    </div>
                  ) : null}
                  {selected.type === "blur" || selected.type === "spotlight" ? (
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">
                        {selected.type === "blur" ? "Blur" : "Darken around it"} {Math.round((selected.strength ?? 0.6) * 100)}%
                      </Label>
                      <Slider className="py-2" min={0} max={1} step={0.05} defaultValue={[selected.strength ?? 0.6]} key={`${selected.id}-${selected.strength}`} onValueCommit={([v]) => patchSelected({ strength: v })} aria-label="Strength" />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Color</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={`Color ${c}`}
                            className={cn("size-6 rounded-full border border-border", (selected.color ?? COLORS[0]).toUpperCase() === c && "ring-2 ring-primary ring-offset-1 ring-offset-background")}
                            style={{ background: c }}
                            onClick={() => patchSelected({ color: c })}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {selected.type === "arrow" ? "Drag the arrow's tail or its tip." : selected.type === "click" || selected.type === "label" ? "Drag it to where it should appear." : "Drag the area to move it; drag its corner to resize it."} Annotations stay on the picture when the clip zooms.
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">Pick an annotation to edit it.</p>
              )}
            </div>
            {selected && shown ? (
              // Narrow panels show the frame first (it's what you edit); wide ones put it beside the fields.
              <div className="order-first min-w-0 @3xl:order-none">
                <FramePreview clip={clip} sourceSec={sourceSec} aspect={aspect} frameRef={frameRef} onPointerMove={onMove} onPointerUp={onUp}>
                  {crop ? (
                    <div className="pointer-events-none absolute" style={{ left: `${(-crop.left / visibleW) * 100}%`, top: `${(-crop.top / visibleH) * 100}%`, width: `${100 / visibleW}%`, height: `${100 / visibleH}%` }} />
                  ) : null}
                  {shown.type === "arrow" ? (
                    <>
                      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <line x1={shown.x * 100} y1={shown.y * 100} x2={(shown.x + shown.w) * 100} y2={(shown.y + shown.h) * 100} stroke={shown.color ?? COLORS[0]} strokeWidth={1.2} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 3 }} />
                      </svg>
                      <div className="absolute size-4 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-black" style={{ left: pct(shown.x), top: pct(shown.y) }} onPointerDown={down("move")} />
                      <div className="absolute size-4 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white" style={{ left: pct(shown.x + shown.w), top: pct(shown.y + shown.h), background: shown.color ?? COLORS[0] }} onPointerDown={down("tip")} />
                    </>
                  ) : shown.type === "click" || shown.type === "label" ? (
                    <div
                      className={cn("absolute cursor-move border-2 border-white", shown.type === "click" ? "size-6 -translate-x-1/2 -translate-y-1/2 rounded-full" : "rounded px-2 py-0.5 text-[11px] font-semibold text-black")}
                      style={{ left: pct(shown.x), top: pct(shown.y), background: shown.color ?? COLORS[0] }}
                      onPointerDown={down("move")}
                    >
                      {shown.type === "label" ? shown.text || "Label" : null}
                    </div>
                  ) : (
                    <div className="absolute cursor-move border-2 border-white" style={{ left: pct(shown.x), top: pct(shown.y), width: pct(shown.w), height: pct(shown.h), boxShadow: shown.type === "spotlight" ? "0 0 0 9999px rgba(0,0,0,0.5)" : undefined, backdropFilter: shown.type === "blur" ? "blur(6px)" : undefined }} onPointerDown={down("move")}>
                      <span className="pointer-events-none absolute top-1 left-1 rounded bg-black/70 px-1 text-[10px] whitespace-nowrap text-white">{ANNOTATION_LABELS[shown.type]}</span>
                      <div className="absolute -right-2 -bottom-2 size-4 cursor-nwse-resize rounded-sm border-2 border-white bg-black" onPointerDown={down("resize")} />
                    </div>
                  )}
                </FramePreview>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">Move the playhead to the moment you want, then add a blur to hide details, a box or arrow to point at something, a label, a spotlight, or a click ripple.</p>
      )}
    </div>
  );
}
