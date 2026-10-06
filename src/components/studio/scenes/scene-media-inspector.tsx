"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Film, ImageIcon, Layers, Maximize, PictureInPicture2, RectangleHorizontal, Repeat, SkipBack, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { CompositionAsset } from "@/core/spec/composition";
import type { ElementOf } from "@/core/spec/scene";
import type { CueId, TriggerContext } from "@/core/spec/triggers";
import { croppedAspect, normalizeCrop, type Crop } from "@/core/timeline/clip-edits";
import { SCENE_MEDIA_PLACEMENTS, SCENE_MEDIA_PLACEMENT_NAMES, detectScenePlacement, type SceneMediaPlacement } from "@/core/timeline/element-layout";
import { MIN_SCENE_MEDIA_SEC, isSceneMedia, sceneMediaAspect, sceneMediaName, sceneVideoTiming, type SceneMediaItem } from "@/core/timeline/media-clip";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SceneMediaPatch } from "@/server/services/scene-media";
import type { SceneDto } from "@/server/services/scenes";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipEditsPanel } from "../media/clip-edits-panel";
import { SpeedControl, TrimEditor } from "../media/media-controls";
import { SplitControls } from "../media/split-controls";
import { suggestZooms } from "../media/suggest-zooms";
import { ZoomPanel } from "../overlays/zoom-editor";
import { CuesSection } from "./editor/cue-editor";
import { ElementActionsMenu, type ElementActions } from "./editor/element-actions";
import { elementDrafts, useElementDraft } from "./editor/element-drafts";
import { useElementFieldContext, type ElementFieldContext } from "./editor/element-fields";
import { AdvancedSection, AnimationSection, AppearanceSection, ArrangeSection, BlockedNote, TransformSection } from "./editor/element-sections";
import { useInspectorEnv } from "./editor/inspector-env";
import { IconAction, InspectorSection, ScrubField, SliderRow } from "./editor/inspector-section";
import { KeyframesSection } from "./editor/keyframes-section";
import { FieldHint, FieldRow, ResetButton, SwitchField, compact } from "./editor/property-fields";
import { mediaWithPatch } from "./editor/use-element-edits";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const PLACEMENT_ICONS: Record<SceneMediaPlacement, React.ComponentType<{ className?: string }>> = { background: Layers, fullscreen: Maximize, framed: RectangleHorizontal, pip: PictureInPicture2 };
const PLACEMENT_SHORT: Record<SceneMediaPlacement, string> = { background: "Background", fullscreen: "Full frame", framed: "Framed", pip: "PiP" };
const PLACEMENT_HINTS: Record<SceneMediaPlacement, string> = {
  background: "Background — full frame, behind the graphics",
  fullscreen: "Full frame — a cutaway over everything",
  framed: "Framed — a centered card",
  pip: "Picture-in-picture — in the corner",
};
const CROP_SIDES: { key: keyof Crop; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
  { key: "right", label: "Right" },
];

/** Ken Burns on an image: it scales from → to across its scene or shot, panning as it goes. */
function PanZoomFields({ ctx }: { ctx: ElementFieldContext }) {
  const kb = (ctx.element as ElementOf<"image">).kenBurns;
  type KenBurns = NonNullable<typeof kb>;
  const save = (next: KenBurns | null) => ctx.commit({ props: { kenBurns: next } });
  const field = (key: keyof KenBurns, label: string, o: { value: number; unit?: string; step: number; min: number; max: number; title: string }) => (
    <ScrubField
      label={label}
      value={kb?.[key] ?? o.value}
      unit={o.unit}
      step={o.step}
      min={o.min}
      max={o.max}
      title={o.title}
      disabled={ctx.disabled}
      onPreview={(n) => kb && ctx.preview({ props: { kenBurns: { ...kb, [key]: n } } })}
      onCancel={ctx.cancel}
      onCommit={(n) => kb && save(compact({ ...kb, [key]: n }))}
    />
  );
  return (
    <div className="space-y-1.5 border-t border-border/60 pt-2">
      <FieldRow label="Pan & zoom" hint="Slowly scales and pans the image while it's on screen (Ken Burns)">
        <SwitchField checked={!!kb} label="Pan and zoom" disabled={ctx.disabled} onChange={(on) => save(on ? { from: 1, to: 1.12 } : null)} />
      </FieldRow>
      {kb ? (
        <div className="grid grid-cols-2 gap-1.5">
          {field("from", "From", { value: 1, unit: "×", step: 0.01, min: 0.5, max: 4, title: "Scale when its scene or shot starts" })}
          {field("to", "To", { value: 1.12, unit: "×", step: 0.01, min: 0.5, max: 4, title: "Scale when its scene or shot ends" })}
          {field("panX", "Pan X", { value: 0, unit: "%", step: 0.5, min: -50, max: 50, title: "Horizontal travel, % of its size" })}
          {field("panY", "Pan Y", { value: 0, unit: "%", step: 0.5, min: -50, max: 50, title: "Vertical travel, % of its size" })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Inspector for an image or video inside a scene: placement and source, transform, appearance and
 * darkening, crop, when it is on screen (split and cut), animation, speed, clip audio, trim, zoom
 * regions, picture edits and layer order. Every change saves a new version of the scene and can be
 * undone; the preview shows it at once.
 */
export function SceneMediaInspector({
  projectId,
  scene,
  item,
  asset,
  frame,
  getTime,
  onSeek,
  onClose,
  blockedReason,
  focusZoomId,
  onRemove,
  onLoop,
  onZoomSelect,
  onOpenSpec,
  actions,
  layers,
  className,
  focusedCue = null,
  onFocusCue,
  focusedKeyframe = null,
  onFocusKeyframe,
}: {
  projectId: string;
  scene: SceneDto;
  item: SceneMediaItem;
  asset: CompositionAsset | undefined;
  /** Video frame size. */
  frame: { width: number; height: number };
  getTime: () => number;
  onSeek: (timeSec: number) => void;
  onClose: () => void;
  /** Why editing is blocked right now (locked scene, unsaved spec edits), or null. */
  blockedReason: string | null;
  /** Zoom to open in the zoom editor (e.g. its bar was clicked on the timeline). */
  focusZoomId?: string | null;
  onRemove?: () => void;
  /** Loop its time on screen in the player. */
  onLoop?: () => void;
  /** Reports the zoom being edited (the editor canvas shows its area). */
  onZoomSelect?: (zoomId: string | null) => void;
  /** Opens the scene spec. */
  onOpenSpec?: () => void;
  /** Duplicate, layer order and alignment (the header's menu). */
  actions?: ElementActions;
  /** The scene's layers list, to add elements to the selection. */
  layers?: React.ReactNode;
  className?: string;
  /** The cue selected on the timeline (its row in Cues is highlighted). */
  focusedCue?: CueId | null;
  onFocusCue?: (cue: CueId | null) => void;
  /** The keyframe selected on the timeline (shown in Keyframes). */
  focusedKeyframe?: string | null;
  onFocusKeyframe?: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const env = useInspectorEnv();
  const saved = item.element;
  const draft = useElementDraft(scene.id, item.ref, saved);
  const el = draft && isSceneMedia(draft) ? draft : saved;
  const mediaAspect = asset?.width && asset.height ? asset.width / asset.height : null;
  const words = env?.words;
  const segment = useMemo<TriggerContext>(
    () => ({ words: words ?? [], sceneStart: scene.startSec, sceneEnd: scene.endSec, ...(item.ref.shotId ? { shotStart: item.segmentStartSec, shotEnd: item.segmentEndSec } : {}) }),
    [words, scene.startSec, scene.endSec, item.ref.shotId, item.segmentStartSec, item.segmentEndSec],
  );
  const { ctx, edits } = useElementFieldContext({ projectId, sceneId: scene.id, elementRef: item.ref, saved, element: el, blockedReason, frame, assetAspect: mediaAspect, sceneDurationSec: scene.durationSec, segment });
  const [keepAspect, setKeepAspect] = useState(true);
  const blocked = !!blockedReason;
  const sendMedia = (patch: SceneMediaPatch) => {
    if (!blocked) edits.commitMedia(scene.id, item.ref, saved, patch);
  };
  const split = useMutation({
    mutationFn: ({ atSec, removeUntilSec }: { atSec: number; removeUntilSec?: number }) =>
      http.post(`/api/projects/${projectId}/scenes/${scene.id}/media/split`, { ref: item.ref, assetId: saved.assetId, atSec, ...(removeUntilSec !== undefined ? { removeUntilSec } : {}), appearSec: item.appearSec, goneSec: item.goneSec }),
    onSuccess: (_d, v) => {
      toast.success(v.removeUntilSec !== undefined ? "Section cut out" : "Split in two", { description: "The second part is a new element in the scene. Press Ctrl+Z to undo." });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined }),
  });

  const isVideo = el.type === "video";
  const name = sceneMediaName(item);
  const sourceSec = asset?.durationSec ?? null;
  const timing = sceneVideoTiming(el, sourceSec);
  const onScreenSec = Math.max(0, item.goneSec - item.appearSec);
  const part = isVideo && (timing.trimEndSec ?? sourceSec) !== null ? Math.max(0, (timing.trimEndSec ?? sourceSec ?? 0) - timing.trimStartSec) : null;
  const clip = {
    id: `${scene.id}:${item.ref.shotId ?? ""}:${item.ref.index}`,
    kind: el.type,
    url: asset?.src ?? "",
    fit: el.fit ?? "cover",
    startSec: item.appearSec,
    durationSec: onScreenSec,
    sourceDurationSec: sourceSec,
    zooms: el.zooms ?? [],
    ...timing,
  };
  const aspect = sceneMediaAspect(el, frame, mediaAspect);
  const placement = detectScenePlacement(el, frame, mediaAspect ? croppedAspect(mediaAspect, el.crop) : null);
  // The size an unset side renders at (the engine sizes media from one side and its aspect ratio).
  const widthPx = el.width !== undefined ? (el.width / 100) * frame.width : el.height !== undefined ? (el.height / 100) * frame.height * aspect : frame.width * (frame.height > frame.width ? 0.86 : 0.6);
  const auto = { width: (widthPx / frame.width) * 100, height: (widthPx / aspect / frame.height) * 100 };
  const dim = el.overlay?.opacity ?? 0;
  const volume = el.type === "video" ? (el.volume ?? 0) : 0;
  const trimmed = timing.trimmedLengthSec;
  const zoomCount = el.zooms?.length ?? 0;
  const editsCount = (el.annotations?.length ?? 0) + (el.crop ? 1 : 0) + (el.type === "video" ? (el.speedSegments?.length ?? 0) : 0);
  const crop: Crop = el.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };

  const setAppear = (videoSec: number) => sendMedia({ appearAt: r3(Math.max(0, clamp(videoSec, item.segmentStartSec, item.goneSec - MIN_SCENE_MEDIA_SEC) - scene.startSec)) });
  const setGone = (videoSec: number) => {
    const t = clamp(videoSec, item.appearSec + MIN_SCENE_MEDIA_SEC, item.segmentEndSec);
    sendMedia({ disappearAt: t >= item.segmentEndSec - 0.02 ? null : r3(t - scene.startSec) });
  };

  return (
    <div className={cn("@container min-w-0", className)}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-panel px-3 py-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted [&_svg]:size-4">{isVideo ? <Film /> : <ImageIcon />}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={asset?.name ?? el.assetId}>
            {asset?.name ?? el.assetId}
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {isVideo ? "Video" : "Image"} · {scene.key} · {name} · {item.appearSec.toFixed(2)}–{item.goneSec.toFixed(2)}s
          </p>
        </div>
        <IconAction label="Go to where it appears" onClick={() => onSeek(item.appearSec)}>
          <SkipBack />
        </IconAction>
        {onLoop ? (
          <IconAction label="Loop its time on screen" onClick={onLoop}>
            <Repeat />
          </IconAction>
        ) : null}
        {actions ? <ElementActionsMenu actions={actions} /> : null}
        {onRemove ? (
          <IconAction label="Delete (Del)" onClick={onRemove} disabled={blocked}>
            <Trash2 />
          </IconAction>
        ) : null}
        <IconAction label="Deselect (Esc)" onClick={onClose}>
          <X />
        </IconAction>
      </div>
      <BlockedNote reason={blockedReason} />

      {!asset ? (
        <p className="px-3 py-3 text-sm text-destructive">The asset {el.assetId} is missing from the project, so this media can&apos;t be edited.</p>
      ) : (
        <>
          <InspectorSection id="media.placement" title="Media" summary={placement ? SCENE_MEDIA_PLACEMENT_NAMES[placement] : "Custom"}>
            <FieldRow label="Source">
              <span className="min-w-0 truncate font-mono text-[11px]" title={`${asset.name} (${asset.id})`}>
                {asset.name}
                <span className="text-muted-foreground">
                  {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
                  {sourceSec ? ` · ${sourceSec.toFixed(1)}s` : ""}
                </span>
              </span>
            </FieldRow>
            <div className="grid grid-cols-4 gap-1" role="group" aria-label="Placement">
              {SCENE_MEDIA_PLACEMENTS.map((p) => {
                const Icon = PLACEMENT_ICONS[p];
                const active = placement === p;
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={blocked}
                    title={PLACEMENT_HINTS[p]}
                    aria-pressed={active}
                    onClick={() => ctx.commit({ placement: p })}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[10px] leading-tight transition-colors disabled:opacity-50",
                      active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {PLACEMENT_SHORT[p]}
                  </button>
                );
              })}
            </div>
            {!placement ? <p className="text-[11px] text-muted-foreground">Placed by hand — pick a preset to snap it back.</p> : null}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Fit</span>
              <Select value={el.fit ?? "cover"} onValueChange={(v) => sendMedia({ fit: v as "cover" | "contain" })} disabled={blocked}>
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

          <TransformSection
            ctx={ctx}
            id="media.transform"
            name={name}
            auto={auto}
            keepAspect={keepAspect}
            onKeepAspect={setKeepAspect}
            hint={<FieldHint>Drag it in the preview to move it; drag a corner to resize (Shift: free).</FieldHint>}
          />

          <AppearanceSection
            ctx={ctx}
            id="media.appearance"
            name={name}
            extra={
              <SliderRow
                label="Darken"
                value={dim}
                display={(v) => `${Math.round(v * 100)}%`}
                min={0}
                max={0.9}
                step={0.05}
                disabled={blocked}
                onPreview={(v) => elementDrafts.set(scene.id, item.ref, mediaWithPatch(el, { dim: v }), saved)}
                onCommit={(v) => (Math.abs(v - (saved.overlay?.opacity ?? 0)) < 0.001 ? elementDrafts.clear(scene.id, item.ref) : sendMedia({ dim: v }))}
              />
            }
          />

          <InspectorSection
            id="media.crop"
            title="Crop"
            summary={el.crop ? CROP_SIDES.map((s) => `${Math.round(crop[s.key] * 100)}`).join(" ") : "none"}
            actions={el.crop ? <ResetButton label="Remove the crop" onClick={() => sendMedia({ crop: null })} disabled={blocked} /> : null}
          >
            <div className="grid grid-cols-2 gap-1.5">
              {CROP_SIDES.map(({ key, label }) => (
                <ScrubField
                  key={key}
                  label={label}
                  unit="%"
                  value={Math.round(crop[key] * 1000) / 10}
                  step={0.5}
                  min={0}
                  max={90}
                  disabled={blocked}
                  title={`Cut from the ${label.toLowerCase()} edge, % of the ${isVideo ? "video" : "image"}`}
                  onPreview={(n) => elementDrafts.set(scene.id, item.ref, mediaWithPatch(el, { crop: normalizeCrop({ ...crop, [key]: n / 100 }) }), saved)}
                  onCancel={() => elementDrafts.clear(scene.id, item.ref)}
                  onCommit={(n) => sendMedia({ crop: normalizeCrop({ ...crop, [key]: n / 100 }) })}
                />
              ))}
            </div>
            <FieldHint>The same crop as Picture edits → Crop, where you can drag it on the frame. Its box keeps its size; the picture inside is cut.</FieldHint>
          </InspectorSection>

          <InspectorSection id="media.timing" title="Timing" summary={`${item.appearSec.toFixed(2)}–${item.goneSec.toFixed(2)}s`}>
            <div className="grid grid-cols-3 gap-1.5">
              <ScrubField label="In" unit="s" value={item.appearSec} step={0.01} min={item.segmentStartSec} max={item.goneSec - MIN_SCENE_MEDIA_SEC} disabled={blocked} title="When it appears (video seconds)" onCommit={setAppear} />
              <ScrubField label="Out" unit="s" value={item.goneSec} step={0.01} min={item.appearSec + MIN_SCENE_MEDIA_SEC} max={item.segmentEndSec} disabled={blocked} title="When it's gone (video seconds)" onCommit={setGone} />
              <ScrubField label="Len" unit="s" value={onScreenSec} step={0.01} min={MIN_SCENE_MEDIA_SEC} max={item.segmentEndSec - item.appearSec} disabled={blocked} title="How long it's on screen" onCommit={(n) => setGone(item.appearSec + n)} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" variant="outline" disabled={blocked} onClick={() => setAppear(getTime())}>
                Start at playhead
              </Button>
              <Button size="xs" variant="outline" disabled={blocked} onClick={() => setGone(getTime())}>
                End at playhead
              </Button>
            </div>
            <SplitControls getTime={getTime} startSec={item.appearSec} endSec={item.goneSec} disabled={blocked || split.isPending} onSplit={(atSec, removeUntilSec) => split.mutate({ atSec, removeUntilSec })} />
            <p className="text-[11px] text-muted-foreground">
              It can move within {item.ref.shotId ? `shot ${item.ref.shotId}` : scene.key} ({item.segmentStartSec.toFixed(2)}–{item.segmentEndSec.toFixed(2)}s). You can also drag it on the timeline.
            </p>
          </InspectorSection>

          <AnimationSection ctx={ctx} id="media.motion" name={name} extra={el.type === "image" ? <PanZoomFields ctx={ctx} /> : null} />

          <KeyframesSection ctx={ctx} id="media.keyframes" name={name} focusedKeyframe={focusedKeyframe} onFocusKeyframe={onFocusKeyframe} />

          <CuesSection ctx={ctx} id="media.cues" name={name} segment={segment} focusedCue={focusedCue} onFocusCue={onFocusCue} />

          {el.type === "video" ? (
            <InspectorSection id="media.video" title="Speed & audio" summary={`${timing.playbackRate}× · ${volume ? `${Math.round(volume * 100)}%` : "muted"}`}>
              <SpeedControl
                rate={timing.playbackRate}
                partSec={part}
                onScreenSec={onScreenSec}
                onScreenLabel="its time in the scene"
                onRate={(rate) => sendMedia({ playbackRate: rate })}
                onPlayIn={(_seconds, rate) => sendMedia({ playbackRate: rate })}
                disabled={blocked}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">When the trimmed part ends</span>
                <Select value={timing.endBehavior} onValueChange={(v) => sendMedia({ loop: v === "loop" })} disabled={blocked}>
                  <SelectTrigger size="sm" className="h-7 w-40 text-xs" aria-label="When the trimmed part ends">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hold">Hold the last frame</SelectItem>
                    <SelectItem value="loop">Loop</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {trimmed !== null && onScreenSec > trimmed + 0.02 ? (
                <p className="text-[11px] text-muted-foreground">
                  On screen {(onScreenSec - trimmed).toFixed(2)}s longer than the trimmed part — it will {timing.endBehavior === "loop" ? "loop" : "hold its last frame"}.
                </p>
              ) : trimmed !== null && trimmed > onScreenSec + 0.02 ? (
                <p className="text-[11px] text-warning">The trimmed part runs {(trimmed - onScreenSec).toFixed(2)}s past its time in the scene, so its end is cut off. Speed it up or trim it.</p>
              ) : null}
              <SliderRow label="Clip audio" value={volume} display={(v) => (v ? `${Math.round(v * 100)}%` : "muted")} min={0} max={1} step={0.05} disabled={blocked} onCommit={(v) => sendMedia({ volume: v })} />
              <Button size="xs" variant={el.duckUnderVoice ? "secondary" : "outline"} className={cn(el.duckUnderVoice && "ring-1 ring-primary")} disabled={blocked || !volume} onClick={() => sendMedia({ duckUnderVoice: !el.duckUnderVoice })} title="Lower the clip's audio while the narrator speaks">
                Lower under the voice-over: {el.duckUnderVoice ? "on" : "off"}
              </Button>
            </InspectorSection>
          ) : null}

          {isVideo ? (
            <InspectorSection id="media.trim" title="Trim" summary={`${timing.trimStartSec.toFixed(2)}–${(timing.trimEndSec ?? sourceSec ?? 0).toFixed(2)}s of the clip`} defaultOpen={false}>
              <TrimEditor clip={clip} disabled={blocked} onCommit={({ trimStartSec, trimEndSec }) => sendMedia({ startFrom: trimStartSec, endAt: trimEndSec })} />
            </InspectorSection>
          ) : null}

          <InspectorSection id="media.zoom" title="Zoom" summary={zoomCount ? `${zoomCount} zoom${zoomCount === 1 ? "" : "s"}` : "none"}>
            <ZoomPanel
              key={clip.id}
              bare
              clip={clip}
              aspect={aspect}
              getTime={getTime}
              onSeek={onSeek}
              focusZoomId={focusZoomId}
              onSelectZoom={onZoomSelect}
              onCommit={(zooms) => sendMedia({ zooms })}
              onSuggest={isVideo ? () => suggestZooms(projectId, el.assetId, { trimStartSec: timing.trimStartSec, trimEndSec: timing.trimEndSec, playbackRate: timing.playbackRate, clipDurationSec: onScreenSec }) : undefined}
            />
          </InspectorSection>

          <InspectorSection id="media.edits" title="Picture edits" summary={editsCount ? String(editsCount) : "none"} defaultOpen={false}>
            <ClipEditsPanel
              key={`edits-${clip.id}`}
              className="border-t-0 pt-0"
              clip={{ id: clip.id, kind: el.type, url: asset.src, fit: el.fit ?? "cover", startSec: item.appearSec, durationSec: onScreenSec, trimStartSec: timing.trimStartSec, playbackRate: timing.playbackRate, mediaAspect }}
              crop={el.crop ?? null}
              speedSegments={el.type === "video" ? (el.speedSegments ?? []) : []}
              annotations={el.annotations ?? []}
              getTime={getTime}
              onSeek={onSeek}
              onCommit={(patch) => sendMedia(patch)}
              disabled={blocked}
            />
          </InspectorSection>

          <ArrangeSection ctx={ctx} id="media.arrange" actions={actions} />
        </>
      )}

      {layers ? (
        <InspectorSection id="media.layers" title="Layers" defaultOpen={false}>
          {layers}
        </InspectorSection>
      ) : null}
      {asset ? <AdvancedSection ctx={ctx} id="media.advanced" onOpenSpec={onOpenSpec} /> : null}
    </div>
  );
}
