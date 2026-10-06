"use client";

import { Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { TimedWord } from "@/core/spec/timing";
import { normalizeVoiceCuts, type VoiceCut } from "@/core/timeline/audio-clips";
import { findPausesAndFillers } from "@/core/timeline/voice-cleanup";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Finds filler words (um, uh, …) and long silences in the voice-over and mutes the ones you pick. The
 * timing never moves: muted parts go silent, so breaths and room noise disappear but nothing shifts.
 */
export function VoiceCleanupButton({ words, cuts, durationSec, onCommit, onSeek, busy }: { words: TimedWord[]; cuts: VoiceCut[]; durationSec: number; onCommit: (cuts: VoiceCut[]) => void; onSeek?: (t: number) => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const suggestions = useMemo(() => (open ? findPausesAndFillers(words, { cuts, durationSec }) : []), [open, words, cuts, durationSec]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(suggestions.filter((s) => s.kind === "filler").map((s) => s.id));
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const apply = () => {
    const extra = suggestions.filter((s) => chosen.has(s.id)).map((s) => ({ startSec: s.startSec, endSec: s.endSec }));
    onCommit(normalizeVoiceCuts([...cuts, ...extra], durationSec));
    setOpen(false);
    setPicked(null);
  };
  const fillers = suggestions.filter((s) => s.kind === "filler").length;

  return (
    <>
      <Button size="sm" variant="outline" disabled={!words.length || busy} onClick={() => setOpen(true)} title="Find filler words and long silences in the voice-over">
        <Sparkles /> Clean up voice
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setPicked(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Clean up the voice-over</DialogTitle>
            <DialogDescription>
              Pick what to mute. Filler words go silent; long silences lose their breaths and room noise. The timing never moves, so nothing else shifts. Muted parts show on the voice-over lane and can be undone.
            </DialogDescription>
          </DialogHeader>
          {suggestions.length ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Button size="xs" variant="outline" onClick={() => setPicked(new Set(suggestions.map((s) => s.id)))}>
                  Pick all
                </Button>
                <Button size="xs" variant="outline" onClick={() => setPicked(new Set(suggestions.filter((s) => s.kind === "filler").map((s) => s.id)))}>
                  Only filler words ({fillers})
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setPicked(new Set())}>
                  None
                </Button>
              </div>
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {suggestions.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                    <input type="checkbox" className="size-4 accent-primary" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Mute ${s.label}`} />
                    <span className={s.kind === "filler" ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
                    <button type="button" className="ml-auto font-mono text-xs text-muted-foreground hover:text-foreground" onClick={() => onSeek?.(Math.max(0, s.startSec - 0.5))} title="Jump there">
                      {s.startSec.toFixed(2)}–{s.endSec.toFixed(2)}s
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No filler words or long silences found.</p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!chosen.size || busy} onClick={apply}>
              Mute {chosen.size} {chosen.size === 1 ? "part" : "parts"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
