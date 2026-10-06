"use client";

import { X } from "lucide-react";
import type { AudioTrackDto } from "@/server/services/audio-tracks";
import { Button } from "@/components/ui/button";
import { TrackRow } from "../assets/audio-page";

/** The selected audio clip's settings under the timeline (the same controls as the Audio page). */
export function AudioTrackInspector({ projectId, track, durationSec, onClose }: { projectId: string; track: AudioTrackDto; durationSec: number; onClose: () => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>Audio clip — drag it on the timeline to move it, drag an edge to trim. Ctrl+Z undoes.</span>
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close the audio clip panel">
          <X />
        </Button>
      </div>
      <TrackRow projectId={projectId} track={track} durationSec={durationSec} />
    </div>
  );
}
