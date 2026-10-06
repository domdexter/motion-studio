"use client";

import { Flag, SkipBack, Trash2, X } from "lucide-react";
import { MARKER_KINDS, type Marker } from "@/core/spec/markers";
import { formatClock } from "@/core/timing/frames";
import { Button } from "@/components/ui/button";
import { InspectorHeader } from "./element-sections";
import { IconAction, InspectorSection, ScrubField } from "./inspector-section";
import { FieldHint, FieldRow, SelectField, TextField } from "./property-fields";
import { humanize } from "./property-inputs";

/** Inspector for a project marker picked on the ruler: its label, kind and time. Markers are notes — they never move anything. */
export function MarkerInspector({
  marker,
  durationSec,
  busy,
  onChange,
  onDelete,
  onSeek,
  onClose,
}: {
  marker: Marker;
  /** Length of the video (the latest a marker can sit). */
  durationSec: number;
  busy: boolean;
  onChange: (next: Marker) => void;
  onDelete: () => void;
  onSeek: (timeSec: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="@container min-w-0">
      <InspectorHeader icon={<Flag />} title={marker.label || "Marker"} subtitle={`${humanize(marker.kind)} marker · ${formatClock(marker.time, 2)}`}>
        <IconAction label="Delete (Del)" onClick={onDelete} disabled={busy}>
          <Trash2 />
        </IconAction>
        <IconAction label="Deselect (Esc)" onClick={onClose}>
          <X />
        </IconAction>
      </InspectorHeader>
      <InspectorSection id="marker.info" title="Marker" summary={`${marker.time.toFixed(2)}s`}>
        <FieldRow label="Label">
          <TextField value={marker.label} ariaLabel="Marker label" placeholder="Beat, note, music cue…" maxLength={120} onCommit={(label) => onChange({ ...marker, label: label.trim() })} />
        </FieldRow>
        <FieldRow label="Kind">
          <SelectField value={marker.kind} options={MARKER_KINDS.map((k) => ({ value: k, label: humanize(k) }))} ariaLabel="Marker kind" disabled={busy} onChange={(kind) => kind && onChange({ ...marker, kind })} />
        </FieldRow>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
          <ScrubField label="Time" unit="s" value={marker.time} step={0.01} min={0} max={durationSec} disabled={busy} title="Where the marker sits (video seconds)" onCommit={(time) => onChange({ ...marker, time })} />
          <Button size="xs" variant="outline" className="h-7" onClick={() => onSeek(marker.time)}>
            <SkipBack /> Go to
          </Button>
        </div>
        <FieldHint>Markers are notes on the timeline — beats, music and sound cues. They never move the voice-over, scenes or elements, but element bars and cues snap to them. Press M to add one at the playhead.</FieldHint>
      </InspectorSection>
    </div>
  );
}
