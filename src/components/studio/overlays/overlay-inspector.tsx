"use client";

import { Eye, EyeOff, Film, ImageIcon, Maximize, PictureInPicture2, RectangleHorizontal, Repeat, SkipBack, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { croppedAspect } from "@/core/timeline/clip-edits";
import { MIN_OVERLAY_SEC, OVERLAY_PLACEMENT_LABELS, OVERLAY_PLACEMENTS, overlayBox, type OverlayPlacement } from "@/core/timeline/overlays";
import { cn } from "@/lib/utils";
import type { OverlayClipDto } from "@/server/services/overlay-clips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipEditsPanel } from "../media/clip-edits-panel";
import { SpeedControl, TrimEditor } from "../media/media-controls";
import { SplitControls } from "../media/split-controls";
import { suggestZooms } from "../media/suggest-zooms";
import { IconAction, InspectorSection, ScrubField, SliderRow } from "../scenes/editor/inspector-section";
import type { OverlayPatch } from "./use-overlays";
import { ZoomPanel } from "./zoom-editor";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

const PLACEMENT_ICONS: Record<OverlayPlacement, React.ReactNode> = {
  fullscreen: <Maximize className="size-4" />,
  framed: <RectangleHorizontal className="size-4" />,
  pip: <PictureInPicture2 className="size-4" />,
};

/**
 * Inspector for a clip on the overlay track (images and videos above the scenes, in video time):
 * placement, timing, opacity and fades, speed and clip audio, trim, zoom regions and picture edits.
 */
export function OverlayInspector({
  clip,
  getTime,
  onPatch,
  onRemove,
  onClose,
  onSeek,
  onSplit,
  frame,
  focusZoomId,
  projectId,
  onLoop,
  onZoomSelect,
  className,
}: {
  clip: OverlayClipDto;
  /** Enables zoom suggestions for videos. */
  projectId?: string;
  getTime: () => number;
  onPatch: (patch: OverlayPatch) => void;
  onRemove: () => void;
  onClose: () => void;
  onSeek?: (timeSec: number) => void;
  /** Split at a video second, or cut out a section up to `removeUntilSec`. */
  onSplit?: (atSec: number, removeUntilSec?: number) => void;
  /** Video frame size (for the zoom editor's aspect ratio). */
  frame: { width: number; height: number };
  /** Zoom to open in the zoom editor (e.g. clicked on the timeline). */
  focusZoomId?: string | null;
  /** Loop the clip in the player. */
  onLoop?: () => void;
  /** Reports the zoom being edited. */
  onZoomSelect?: (zoomId: string | null) => void;
  className?: string;
}) {
  const [name, setName] = useState(clip.name);
  useEffect(() => setName(clip.name), [clip.name]);
  const isVideo = clip.kind === "video";
  const longerThanTrim = clip.trimmedLengthSec !== null && clip.durationSec > clip.trimmedLengthSec + 0.01;
  const rate = clip.playbackRate || 1;
  const source = clip.sourceDurationSec;
  /** Source seconds of the trimmed part (null when the clip length is unknown). */
  const part = isVideo && (clip.trimEndSec ?? source) !== null ? Math.max(0, (clip.trimEndSec ?? source ?? 0) - clip.trimStartSec) : null;
  // The clip's time on screen follows its trimmed part unless it was deliberately longer (hold or loop).
  const followsTrim = clip.trimmedLengthSec === null || Math.abs(clip.durationSec - clip.trimmedLengthSec) < 0.05;
  const mediaAspect = clip.width && clip.height ? clip.width / clip.height : null;
  const box = overlayBox(clip.placement, frame, mediaAspect ? croppedAspect(mediaAspect, clip.crop) : null);
  const zoomCount = clip.zooms.length;
  const editsCount = clip.annotations.length + (clip.crop ? 1 : 0) + clip.speedSegments.length;

  return (
    <div className={cn("@container min-w-0", className)}>
      <div className="sticky top-0 z-10 space-y-1 border-b border-border bg-panel px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted [&_svg]:size-4">{isVideo ? <Film /> : <ImageIcon />}</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== clip.name && onPatch({ name: name.trim() })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="h-7 min-w-0 flex-1 text-sm font-medium"
            aria-label="Overlay name"
          />
          <IconAction label={clip.hidden ? "Show in the video" : "Hide from the video (keeps it on the track)"} className={cn(clip.hidden && "text-warning")} onClick={() => onPatch({ hidden: !clip.hidden })}>
            {clip.hidden ? <EyeOff /> : <Eye />}
          </IconAction>
          {onSeek ? (
            <IconAction label="Go to its start" onClick={() => onSeek(clip.startSec)}>
              <SkipBack />
            </IconAction>
          ) : null}
          {onLoop ? (
            <IconAction label="Loop it in the player" onClick={onLoop}>
              <Repeat />
            </IconAction>
          ) : null}
          <IconAction label="Delete (Del)" onClick={onRemove}>
            <Trash2 />
          </IconAction>
          <IconAction label="Deselect (Esc)" onClick={onClose}>
            <X />
          </IconAction>
        </div>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          Overlay {isVideo ? "video" : "image"} · {clip.startSec.toFixed(2)}–{clip.endSec.toFixed(2)}s · above the scenes{clip.hidden ? " · hidden" : ""}
        </p>
      </div>

      <InspectorSection id="overlay.placement" title="Placement" summary={OVERLAY_PLACEMENT_LABELS[clip.placement]}>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Placement">
          {OVERLAY_PLACEMENTS.map((p) => {
            const active = clip.placement === p;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => onPatch({ placement: p })}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[10px] leading-tight transition-colors",
                  active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {PLACEMENT_ICONS[p]}
                {OVERLAY_PLACEMENT_LABELS[p]}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">Fit</span>
          <Select value={clip.fit} onValueChange={(v) => onPatch({ fit: v as "cover" | "contain" })}>
            <SelectTrigger size="sm" className="h-7 w-40 text-xs" aria-label="Fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cover">Fill (crop edges)</SelectItem>
              <SelectItem value="contain">Fit inside</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </InspectorSection>

      <InspectorSection id="overlay.timing" title="Timing" summary={`${clip.startSec.toFixed(2)}–${clip.endSec.toFixed(2)}s`}>
        <div className="grid grid-cols-3 gap-1.5">
          <ScrubField label="In" unit="s" value={clip.startSec} step={0.01} min={0} title="When it starts (video seconds)" onCommit={(n) => onPatch({ startSec: Math.max(0, n) })} />
          <ScrubField label="Out" unit="s" value={clip.endSec} step={0.01} min={clip.startSec + MIN_OVERLAY_SEC} title="When it ends (video seconds)" onCommit={(n) => onPatch({ durationSec: Math.max(MIN_OVERLAY_SEC, n - clip.startSec) })} />
          <ScrubField label="Len" unit="s" value={clip.durationSec} step={0.01} min={MIN_OVERLAY_SEC} title="How long it's on screen" onCommit={(n) => onPatch({ durationSec: Math.max(MIN_OVERLAY_SEC, n) })} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" onClick={() => onPatch({ startSec: r3(getTime()) })}>
            Start at playhead
          </Button>
          <Button size="xs" variant="outline" onClick={() => onPatch({ durationSec: r3(Math.max(MIN_OVERLAY_SEC, getTime() - clip.startSec)) })}>
            End at playhead
          </Button>
        </div>
        {onSplit ? <SplitControls getTime={getTime} startSec={clip.startSec} endSec={clip.endSec} onSplit={onSplit} /> : null}
      </InspectorSection>

      <InspectorSection id="overlay.appearance" title="Appearance" summary={`${Math.round(clip.opacity * 100)}%${clip.fadeInSec || clip.fadeOutSec ? ` · fades ${clip.fadeInSec}/${clip.fadeOutSec}s` : ""}`}>
        <SliderRow label="Opacity" value={clip.opacity} display={(v) => `${Math.round(v * 100)}%`} min={0.05} max={1} step={0.05} onCommit={(v) => onPatch({ opacity: v })} />
        <SliderRow label="Darken" value={clip.dim} display={(v) => `${Math.round(v * 100)}%`} min={0} max={0.9} step={0.05} onCommit={(v) => onPatch({ dim: v })} />
        <div className="grid grid-cols-2 gap-1.5">
          <ScrubField label="Fade in" unit="s" value={clip.fadeInSec} step={0.05} min={0} max={10} onCommit={(n) => onPatch({ fadeInSec: n })} />
          <ScrubField label="Fade out" unit="s" value={clip.fadeOutSec} step={0.05} min={0} max={10} onCommit={(n) => onPatch({ fadeOutSec: n })} />
        </div>
      </InspectorSection>

      {isVideo ? (
        <InspectorSection id="overlay.video" title="Speed & audio" summary={`${rate}× · ${clip.volume ? `${Math.round(clip.volume * 100)}%` : "muted"}`}>
          <SpeedControl
            rate={rate}
            partSec={part}
            onScreenSec={clip.durationSec}
            onScreenLabel="its time on screen"
            onRate={(next) => onPatch({ playbackRate: next, ...(followsTrim && part ? { durationSec: r3(Math.max(MIN_OVERLAY_SEC, part / next)) } : {}) })}
            onPlayIn={(seconds, next) => onPatch({ playbackRate: next, durationSec: r3(Math.max(MIN_OVERLAY_SEC, seconds)) })}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">If it&apos;s on screen longer</span>
            <Select value={clip.endBehavior} onValueChange={(v) => onPatch({ endBehavior: v as "hold" | "loop" })}>
              <SelectTrigger size="sm" className="h-7 w-40 text-xs" aria-label="If it's on screen longer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hold">Hold the last frame</SelectItem>
                <SelectItem value="loop">Loop</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {longerThanTrim ? <p className="text-[11px] text-muted-foreground">On screen {(clip.durationSec - (clip.trimmedLengthSec ?? 0)).toFixed(2)}s longer than the trimmed part — it will {clip.endBehavior === "loop" ? "loop" : "hold its last frame"}.</p> : null}
          <SliderRow label="Clip audio" value={clip.volume} display={(v) => (v ? `${Math.round(v * 100)}%` : "muted")} min={0} max={1} step={0.05} onCommit={(v) => onPatch({ volume: v })} />
          <Button size="xs" variant={clip.duckUnderVoice ? "secondary" : "outline"} className={cn(clip.duckUnderVoice && "ring-1 ring-primary")} disabled={!clip.volume} onClick={() => onPatch({ duckUnderVoice: !clip.duckUnderVoice })} title="Lower the clip's audio while the narrator speaks">
            Lower under the voice-over: {clip.duckUnderVoice ? "on" : "off"}
          </Button>
        </InspectorSection>
      ) : null}

      {isVideo ? (
        <InspectorSection id="overlay.trim" title="Trim" summary={`${clip.trimStartSec.toFixed(2)}–${(clip.trimEndSec ?? source ?? 0).toFixed(2)}s of the clip`} defaultOpen={false}>
          <TrimEditor
            clip={clip}
            hint="Drag the handles (the preview shows the frame), or trim on the timeline by dragging the clip's edges."
            onCommit={({ trimStartSec, trimEndSec }) => onPatch({ trimStartSec, trimEndSec, ...(followsTrim ? { durationSec: r3(Math.max(MIN_OVERLAY_SEC, ((trimEndSec ?? source ?? 0) - trimStartSec) / rate)) } : {}) })}
          />
        </InspectorSection>
      ) : null}

      <InspectorSection id="overlay.zoom" title="Zoom" summary={zoomCount ? `${zoomCount} zoom${zoomCount === 1 ? "" : "s"}` : "none"}>
        <ZoomPanel
          key={clip.id}
          bare
          clip={clip}
          aspect={box.width / box.height}
          getTime={getTime}
          onSeek={onSeek}
          focusZoomId={focusZoomId}
          onSelectZoom={onZoomSelect}
          onCommit={(zooms) => onPatch({ zooms })}
          onSuggest={projectId && isVideo ? () => suggestZooms(projectId, clip.assetId, { trimStartSec: clip.trimStartSec, trimEndSec: clip.trimEndSec, playbackRate: rate, clipDurationSec: clip.durationSec }) : undefined}
        />
      </InspectorSection>

      <InspectorSection id="overlay.edits" title="Picture edits" summary={editsCount ? String(editsCount) : "none"} defaultOpen={false}>
        <ClipEditsPanel
          key={`edits-${clip.id}`}
          className="border-t-0 pt-0"
          clip={{ id: clip.id, kind: clip.kind, url: clip.url, fit: clip.fit, startSec: clip.startSec, durationSec: clip.durationSec, trimStartSec: clip.trimStartSec, playbackRate: rate, mediaAspect }}
          crop={clip.crop}
          speedSegments={clip.speedSegments}
          annotations={clip.annotations}
          getTime={getTime}
          onSeek={onSeek}
          onCommit={(patch) => onPatch(patch)}
        />
      </InspectorSection>
    </div>
  );
}
