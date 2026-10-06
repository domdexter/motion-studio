"use client";

import { AudioWaveform, Captions, Combine, FileText, FolderOpen } from "lucide-react";
import { WORKFLOW_INFO, type Workflow } from "@/core/spec/enums";
import { cn } from "@/lib/utils";

export const START_OPTIONS: { id: Workflow; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "script_only", icon: FileText },
  { id: "audio_only", icon: AudioWaveform },
  { id: "script_audio", icon: Combine },
  { id: "script_audio_timeline", icon: Captions },
  { id: "imported", icon: FolderOpen },
];

export function WorkflowChooser({ value, onChange, options = START_OPTIONS }: { value: Workflow | null; onChange: (w: Workflow) => void; options?: typeof START_OPTIONS }) {
  return (
    <div role="radiogroup" aria-label="What do you have?" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {options.map(({ id, icon: Icon }) => {
        const info = WORKFLOW_INFO[id];
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(id)}
            className={cn(
              "group relative flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              selected && "border-primary bg-primary/[0.06] ring-1 ring-primary",
            )}
          >
            <div className="flex w-full items-center gap-3">
              <span className={cn("flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors", selected && "bg-primary/15 text-primary")}>
                <Icon className="size-[18px]" />
              </span>
              <span className="font-medium">{info.label}</span>
              <span className={cn("ml-auto size-4 rounded-full border border-border", selected && "border-[5px] border-primary")} />
            </div>
            <p className="text-sm leading-snug text-muted-foreground">{info.description}</p>
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground/80">
              {info.steps.slice(0, 6).map((s, i) => (
                <span key={s} className="flex items-center gap-1">
                  {i > 0 ? <span className="text-muted-foreground/40">→</span> : null}
                  <span className="rounded bg-muted/70 px-1.5 py-0.5">{s}</span>
                </span>
              ))}
              {info.steps.length > 6 ? <span className="text-muted-foreground/60">→ …</span> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
