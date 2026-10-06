"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Film, ImageIcon, Layers, Loader2, Lock, Maximize, PictureInPicture2, RectangleHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AssetDto } from "@/server/services/assets";
import type { OverlayClipDto } from "@/server/services/overlay-clips";
import type { MediaPlacement } from "@/server/services/scene-media";
import type { SceneDto } from "@/server/services/scenes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { AssetPreview, useAssets, useProjectScenes } from "./asset-library";

const PLACEMENTS: { value: MediaPlacement; label: string; description: string; icon: React.ReactNode }[] = [
  { value: "background", label: "Background", description: "Full frame, behind the graphics (dimmed)", icon: <Layers /> },
  { value: "fullscreen", label: "Full frame", description: "A cutaway over everything", icon: <Maximize /> },
  { value: "framed", label: "Framed", description: "Centered card with a shadow", icon: <RectangleHorizontal /> },
  { value: "pip", label: "Picture-in-picture", description: "Small, in the corner", icon: <PictureInPicture2 /> },
];

const MEDIA_KINDS = ["video", "image", "screenshot"] as const;

type Target = "scene" | "overlay";

function numberOrUndefined(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Places an image or video either inside a scene (scene timing stays owned by the voice-over; the
 * media plays inside it) or on the overlay track (above the scenes at a time in the video, trimmable
 * and free to run across scene cuts).
 */
export function InsertMediaDialog({
  projectId,
  open,
  onOpenChange,
  assetId: fixedAssetId,
  sceneId: fixedSceneId,
  onInsertedIntoScene,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId?: string;
  sceneId?: string;
  /** Called with the new element id after media is inserted into a scene (e.g. to open its panel). */
  onInsertedIntoScene?: (sceneId: string, elementId: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const assets = useAssets(projectId, [...MEDIA_KINDS]);
  const scenes = useProjectScenes(projectId);
  const [target, setTarget] = useState<Target>("scene");
  const [assetId, setAssetId] = useState(fixedAssetId ?? "");
  const [sceneId, setSceneId] = useState(fixedSceneId ?? "");
  const [placement, setPlacement] = useState<MediaPlacement>("background");
  const [trim, setTrim] = useState("");
  const [trimEnd, setTrimEnd] = useState("");
  const [rate, setRate] = useState("1");
  const [loop, setLoop] = useState<"auto" | "loop" | "once">("auto");
  const [volume, setVolume] = useState(0);
  const [appear, setAppear] = useState("");
  const [disappear, setDisappear] = useState("");
  const [overlayStart, setOverlayStart] = useState("");
  const [dim, setDim] = useState(0.35);

  const asset: AssetDto | undefined = (assets.data ?? []).find((a) => a.id === assetId);
  const sceneList = useMemo(() => scenes.data ?? [], [scenes.data]);
  const scene: SceneDto | undefined = sceneList.find((s) => s.id === sceneId);
  const isVideo = !!asset?.mimeType.startsWith("video/");
  const overlay = target === "overlay";

  useEffect(() => {
    if (!open) return;
    setTarget("scene");
    setAssetId(fixedAssetId ?? "");
    setSceneId(fixedSceneId ?? "");
    setPlacement("background");
    setTrim("");
    setTrimEnd("");
    setRate("1");
    setLoop("auto");
    setVolume(0);
    setAppear("");
    setDisappear("");
    setOverlayStart("");
    setDim(0.35);
  }, [open, fixedAssetId, fixedSceneId]);

  // Default scene: the one the asset is linked to, else the first unlocked scene.
  useEffect(() => {
    if (!open || sceneId || !sceneList.length) return;
    const linked = asset?.sceneId ? sceneList.find((s) => s.id === asset.sceneId && !s.locked) : undefined;
    const first = linked ?? sceneList.find((s) => !s.locked);
    if (first) setSceneId(first.id);
  }, [open, sceneId, sceneList, asset?.sceneId]);

  const chooseTarget = (next: Target) => {
    setTarget(next);
    if (next === "overlay") {
      if (placement === "background") setPlacement("fullscreen");
      setDim(0);
    }
  };

  const insert = useMutation({
    mutationFn: async (): Promise<{ kind: "scene"; scene: SceneDto; elementId: string } | { kind: "overlay"; overlay: OverlayClipDto }> => {
      if (overlay) {
        const res = await http.post<{ overlay: OverlayClipDto }>(`/api/projects/${projectId}/overlays`, {
          assetId,
          placement: placement === "background" ? "fullscreen" : placement,
          startSec: Math.max(0, numberOrUndefined(overlayStart) ?? scene?.startSec ?? 0),
          trimStartSec: isVideo ? numberOrUndefined(trim) : undefined,
          trimEndSec: isVideo ? numberOrUndefined(trimEnd) : undefined,
          dim,
          volume: isVideo ? volume : undefined,
        });
        return { kind: "overlay", overlay: res.overlay };
      }
      const res = await http.post<{ scene: SceneDto; elementId: string }>(`/api/projects/${projectId}/scenes/${sceneId}/media`, {
        assetId,
        placement,
        startFrom: isVideo ? numberOrUndefined(trim) : undefined,
        endAt: isVideo ? numberOrUndefined(trimEnd) : undefined,
        playbackRate: isVideo ? Number(rate) : undefined,
        loop: isVideo && loop !== "auto" ? loop === "loop" : undefined,
        volume: isVideo ? volume : undefined,
        appearAt: numberOrUndefined(appear),
        disappearAt: numberOrUndefined(disappear),
        dim,
      });
      return { kind: "scene", scene: res.scene, elementId: res.elementId };
    },
    onSuccess: (res) => {
      if (res.kind === "overlay") {
        toast.success(`Added “${res.overlay.name}” to the overlay track`, {
          description: `${res.overlay.startSec.toFixed(2)}–${res.overlay.endSec.toFixed(2)}s — drag it on the timeline to move it, drag its edges to trim.`,
          action: { label: "Open timeline", onClick: () => router.push(`/projects/${projectId}/scenes`) },
        });
      } else {
        onInsertedIntoScene?.(res.scene.id, res.elementId);
        toast.success(`Added to ${res.scene.key} · ${res.scene.name}`, {
          description: "A new scene version was saved — review and approve it. Trim, speed and zoom it from Scenes → Elements.",
          action: { label: "Open scene", onClick: () => router.push(`/projects/${projectId}/scenes?scene=${res.scene.key}`) },
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined }),
  });

  const sceneDuration = scene ? scene.endSec - scene.startSec : 0;
  const visible = Math.max(0, (numberOrUndefined(disappear) ?? sceneDuration) - (numberOrUndefined(appear) ?? 0));
  const playable = isVideo && asset?.durationSec ? ((numberOrUndefined(trimEnd) ?? asset.durationSec) - (numberOrUndefined(trim) ?? 0)) / Number(rate || 1) : null;
  const willLoop = loop === "loop" || (loop === "auto" && playable !== null && playable < visible);
  const overlayLength = isVideo && asset?.durationSec ? Math.max(0, (numberOrUndefined(trimEnd) ?? asset.durationSec) - (numberOrUndefined(trim) ?? 0)) : 4;
  const overlayFrom = numberOrUndefined(overlayStart) ?? scene?.startSec ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{overlay ? "Add to the overlay track" : "Insert into a scene"}</DialogTitle>
          <DialogDescription>
            {overlay
              ? "Overlays sit above the scenes at a time in the video, can run across scene cuts, and can be trimmed and moved on the timeline. Scene timing doesn't change."
              : "The scene keeps its voice-over timing — your media plays inside it. Adding it creates a new scene version."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "scene", label: "Inside a scene", description: "Part of one scene's design", icon: <Clapperboard /> },
                { value: "overlay", label: "Overlay track", description: "Trim it and place it anywhere on the timeline", icon: <Layers /> },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => chooseTarget(t.value)}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
                  target === t.value ? "border-primary bg-primary/5" : "border-border hover:border-foreground/30",
                )}
              >
                {t.icon}
                <span>
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                </span>
              </button>
            ))}
          </div>

          {fixedAssetId ? null : (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Media</Label>
              {!assets.data ? (
                <Skeleton className="h-28" />
              ) : assets.data.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No images or videos yet — upload them in Assets → Videos or Images.</p>
              ) : (
                <div className="scrollbar-thin grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                  {assets.data.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAssetId(a.id)}
                      className={cn("overflow-hidden rounded-lg border text-left transition-colors", a.id === assetId ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-foreground/30")}
                    >
                      <div className="checkerboard relative aspect-video">
                        <AssetPreview asset={a} />
                      </div>
                      <div className="flex items-center gap-1 px-1.5 py-1 text-[11px]">
                        {a.mimeType.startsWith("video/") ? <Film className="size-3 shrink-0" /> : <ImageIcon className="size-3 shrink-0" />}
                        <span className="truncate">{a.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {fixedAssetId && asset ? (
            <div className="flex items-center gap-3 rounded-lg border border-border p-2">
              <div className="checkerboard relative aspect-video w-28 shrink-0 overflow-hidden rounded">
                <AssetPreview asset={asset} />
              </div>
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{asset.name}</p>
                <p className="text-xs text-muted-foreground">
                  {isVideo ? `Video · ${formatDuration(asset.durationSec)}` : "Image"}
                  {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
                </p>
              </div>
            </div>
          ) : null}

          {fixedSceneId && !overlay ? null : (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{overlay ? "Start with a scene (optional)" : "Scene"}</Label>
              <Select
                value={sceneId}
                onValueChange={(v) => {
                  setSceneId(v);
                  setOverlayStart("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={sceneList.length ? "Choose a scene" : "Generate a storyboard first"} />
                </SelectTrigger>
                <SelectContent>
                  {sceneList.map((s) => (
                    <SelectItem key={s.id} value={s.id} disabled={s.locked && !overlay}>
                      {s.locked ? <Lock className="size-3" /> : null}
                      {s.key} · {s.name} · {formatDuration(s.endSec - s.startSec)}
                      {overlay ? ` · starts ${s.startSec.toFixed(2)}s` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {scene && !overlay ? <p className="line-clamp-2 text-xs text-muted-foreground">“{scene.voiceText}”</p> : null}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Placement</Label>
            <div className="grid grid-cols-2 gap-2">
              {PLACEMENTS.filter((p) => !overlay || p.value !== "background").map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => {
                    setPlacement(p.value);
                    setDim(p.value === "background" ? 0.35 : 0);
                  }}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
                    placement === p.value ? "border-primary bg-primary/5" : "border-border hover:border-foreground/30",
                  )}
                >
                  {p.icon}
                  <span>
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className="block text-xs text-muted-foreground">{p.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {isVideo ? (
            overlay ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Trim start (s into clip)</Label>
                  <Input value={trim} onChange={(e) => setTrim(e.target.value)} placeholder="0" inputMode="decimal" className="font-mono" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Trim end</Label>
                  <Input value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} placeholder={asset?.durationSec ? `${asset.durationSec.toFixed(2)} — clip end` : "clip end"} inputMode="decimal" className="font-mono" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Clip audio {volume ? `${Math.round(volume * 100)}%` : "muted"}</Label>
                  <Slider className="py-2.5" min={0} max={1} step={0.05} value={[volume]} onValueChange={([v]) => setVolume(v)} aria-label="Clip volume" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Trim start (s)</Label>
                  <Input value={trim} onChange={(e) => setTrim(e.target.value)} placeholder="0" inputMode="decimal" className="font-mono" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Trim end</Label>
                  <Input value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} placeholder={asset?.durationSec ? `${asset.durationSec.toFixed(2)} — clip end` : "clip end"} inputMode="decimal" className="font-mono" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Speed</Label>
                  <Select value={rate} onValueChange={setRate}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["0.5", "0.75", "1", "1.25", "1.5", "2"].map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}×
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">When the clip ends</Label>
                  <Select value={loop} onValueChange={(v) => setLoop(v as typeof loop)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="loop">Loop</SelectItem>
                      <SelectItem value="once">Play once</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Clip audio {volume ? `${Math.round(volume * 100)}%` : "muted"}</Label>
                  <Slider className="py-2.5" min={0} max={1} step={0.05} value={[volume]} onValueChange={([v]) => setVolume(v)} aria-label="Clip volume" />
                </div>
              </div>
            )
          ) : null}

          {overlay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Starts at (s in the video)</Label>
                <Input value={overlayStart} onChange={(e) => setOverlayStart(e.target.value)} placeholder={scene ? `${scene.startSec.toFixed(2)} — ${scene.key} start` : "0"} inputMode="decimal" className="font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Darken {Math.round(dim * 100)}%</Label>
                <Slider className="py-2.5" min={0} max={0.9} step={0.05} value={[dim]} onValueChange={([v]) => setDim(v)} aria-label="Darken overlay" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Appear at (s into scene)</Label>
                <Input value={appear} onChange={(e) => setAppear(e.target.value)} placeholder="0 — scene start" inputMode="decimal" className="font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Disappear at</Label>
                <Input value={disappear} onChange={(e) => setDisappear(e.target.value)} placeholder={scene ? `${sceneDuration.toFixed(2)} — scene end` : "scene end"} inputMode="decimal" className="font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Darken {Math.round(dim * 100)}%</Label>
                <Slider className="py-2.5" min={0} max={0.9} step={0.05} value={[dim]} onValueChange={([v]) => setDim(v)} aria-label="Darken overlay" />
              </div>
            </div>
          )}

          {asset && overlay ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              On screen {overlayFrom.toFixed(2)}–{(overlayFrom + overlayLength).toFixed(2)}s{isVideo ? ` · plays ${overlayLength.toFixed(2)}s of the clip` : ""}. Fine-tune it on the Scenes timeline afterwards.
            </p>
          ) : scene && asset ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Visible for {visible.toFixed(2)}s of the {sceneDuration.toFixed(2)}s scene
              {isVideo && playable !== null ? ` · clip plays ${playable.toFixed(2)}s${willLoop ? " — it will loop" : playable < visible ? " — it will hold its last frame" : ""}` : ""}.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => insert.mutate()} disabled={!assetId || (!overlay && (!sceneId || !!scene?.locked)) || insert.isPending}>
            {insert.isPending ? <Loader2 className="animate-spin" /> : null} {overlay ? "Add to overlay track" : "Insert into scene"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
