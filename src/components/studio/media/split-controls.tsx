"use client";

import { Crosshair, Scissors } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NumField } from "./media-controls";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Split a clip at the playhead, or cut out a section of it (the rest moves up to close the gap). Times are video seconds. */
export function SplitControls({ getTime, startSec, endSec, onSplit, disabled }: { getTime: () => number; startSec: number; endSec: number; onSplit: (atSec: number, removeUntilSec?: number) => void; disabled?: boolean }) {
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const inside = (t: number) => t > startSec + 0.2 && t < endSec - 0.2;
  const valid = from !== null && to !== null && to > from + 0.05 && inside(from) && to < endSec - 0.2;
  return (
    <div className="space-y-2 rounded-lg border border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          title="Splits the clip into two at the playhead (the playhead must be inside the clip)"
          onClick={() => {
            const t = getTime();
            if (inside(t)) onSplit(r3(t));
          }}
        >
          <Scissors /> Split at playhead
        </Button>
        <span className="text-[11px] text-muted-foreground">or cut out a section and close the gap:</span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex w-36 items-end gap-1">
          <NumField label="From (video s)" value={from} placeholder="—" onCommit={(n) => setFrom(r3(n))} />
          <Button size="icon-sm" variant="ghost" title="Set to the playhead" aria-label="Set from to the playhead" onClick={() => setFrom(r3(getTime()))}>
            <Crosshair />
          </Button>
        </div>
        <div className="flex w-36 items-end gap-1">
          <NumField label="To" value={to} placeholder="—" onCommit={(n) => setTo(r3(n))} />
          <Button size="icon-sm" variant="ghost" title="Set to the playhead" aria-label="Set to to the playhead" onClick={() => setTo(r3(getTime()))}>
            <Crosshair />
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !valid}
          onClick={() => {
            if (valid) {
              onSplit(from, to);
              setFrom(null);
              setTo(null);
            }
          }}
        >
          <Scissors /> Cut out{valid ? ` ${(to - from).toFixed(2)}s` : ""}
        </Button>
      </div>
    </div>
  );
}
