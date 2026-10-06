"use client";

import { Film, ImageIcon, Loader2, Maximize, PictureInPicture2, RectangleHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { OVERLAY_PLACEMENT_LABELS, OVERLAY_PLACEMENTS, type OverlayPlacement } from "@/core/timeline/overlays";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OverlayClipDto } from "@/server/services/overlay-clips";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetPreview, useAssets } from "../assets/asset-library";
import { useOverlayMutations } from "./use-overlays";

const ICONS: Record<OverlayPlacement, React.ReactNode> = { fullscreen: <Maximize />, framed: <RectangleHorizontal />, pip: <PictureInPicture2 /> };

/** Picks an image or video and puts it on the overlay track at a time in the video. */
export function AddOverlayDialog({
  projectId,
  open,
  onOpenChange,
  startSec,
  onAdded,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startSec: number;
  onAdded?: (clip: OverlayClipDto) => void;
}) {
  const assets = useAssets(projectId, ["video", "image", "screenshot"]);
  const { add } = useOverlayMutations(projectId);
  const [assetId, setAssetId] = useState("");
  const [placement, setPlacement] = useState<OverlayPlacement>("fullscreen");
  const [start, setStart] = useState(startSec.toFixed(2));
  useEffect(() => {
    if (open) setStart(startSec.toFixed(2));
  }, [open, startSec]);

  const submit = async () => {
    const clip = await add.mutateAsync({ assetId, placement, startSec: Math.max(0, Number(start) || 0) });
    toast.success(`Added “${clip.name}” to the overlay track`, { description: "Drag it on the timeline to move it; drag its edges to trim." });
    onAdded?.(clip);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add an overlay</DialogTitle>
          <DialogDescription>Overlays sit above the scenes at a time in the video and can run across scene cuts. Scene and voice-over timing don&apos;t change.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Image or video</Label>
            {!assets.data ? (
              <Skeleton className="h-28" />
            ) : assets.data.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No images or videos yet — upload them in Assets → Videos or Images.</p>
            ) : (
              <div className="scrollbar-thin grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
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
                      {a.mimeType.startsWith("video/") ? <span className="ml-auto shrink-0 text-muted-foreground">{formatDuration(a.durationSec)}</span> : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Placement</Label>
              <div className="flex flex-wrap gap-1.5">
                {OVERLAY_PLACEMENTS.map((p) => (
                  <Button key={p} size="sm" variant={placement === p ? "secondary" : "outline"} className={cn(placement === p && "ring-1 ring-primary")} onClick={() => setPlacement(p)}>
                    {ICONS[p]} {OVERLAY_PLACEMENT_LABELS[p]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="w-32 space-y-2">
              <Label className="text-xs text-muted-foreground">Starts at (s)</Label>
              <Input value={start} onChange={(e) => setStart(e.target.value)} inputMode="decimal" className="font-mono" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">A video starts at its full length; trim it afterwards on the timeline or in the overlay panel. Images start at 4 seconds.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!assetId || add.isPending}>
            {add.isPending ? <Loader2 className="animate-spin" /> : null} Add overlay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
