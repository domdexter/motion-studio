"use client";

import { CheckCheck, ChevronLeft, ChevronRight, Eye, Lock, LockOpen, PanelRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { formatClock } from "@/core/timing/frames";
import { cn } from "@/lib/utils";
import type { SceneDto } from "@/server/services/scenes";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EditHistoryControls } from "../../history/edit-history-controls";
import { SceneTemplatesButton } from "../scene-templates-dialog";

function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function Chip({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <span title={title} className={cn("flex h-6 shrink-0 items-center gap-1 rounded-md border border-border px-1.5 whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

/**
 * Scene navigation, the scene's timing and status, and the scene-level actions in one compact row.
 * Narrower editors drop the timing chips and button labels (their tooltips stay).
 */
export function EditorToolbar({
  projectId,
  scenes,
  scene,
  onSelectScene,
  onLock,
  lockPending,
  onApprove,
  approvePending,
  onAskClaude,
  getSceneSec,
  narrow,
  sideOpen,
  onToggleSide,
}: {
  projectId: string;
  scenes: SceneDto[];
  scene: SceneDto;
  onSelectScene: (key: string) => void;
  onLock: () => void;
  lockPending: boolean;
  onApprove: () => void;
  approvePending: boolean;
  onAskClaude: () => void;
  /** Playhead seconds into the scene (templates insert there). */
  getSceneSec: () => number;
  /** Narrow editors float the side panel; the toolbar shows its toggle. */
  narrow: boolean;
  sideOpen: boolean;
  onToggleSide: () => void;
}) {
  const index = scenes.findIndex((s) => s.id === scene.id);
  const approved = scene.status === "approved";
  const audioLocked = scene.timingMode === "audio_locked";
  const timingTitle = audioLocked ? "Timing follows the voice-over — scene boundaries sit on spoken words" : "Timing was adjusted by hand (not locked to the voice-over)";
  const status = scene.needsReview
    ? { label: "Changed after approval", short: "Changed", tone: "bg-warning/15 text-warning" }
    : approved
      ? { label: "Approved", short: "Approved", tone: "bg-success/15 text-success" }
      : { label: "Draft", short: "Draft", tone: "bg-muted text-muted-foreground" };

  return (
    <div className="@container shrink-0 border-b border-border bg-panel">
      <div className="flex h-11 min-w-0 items-center gap-1.5 px-2">
        <div className="flex shrink-0 items-center gap-0.5">
          <Hint label="Previous scene">
            <Button size="icon-sm" variant="ghost" disabled={index <= 0} onClick={() => onSelectScene(scenes[index - 1].key)} aria-label="Previous scene">
              <ChevronLeft />
            </Button>
          </Hint>
          <Select value={scene.key} onValueChange={onSelectScene}>
            <SelectTrigger size="sm" className="w-36 @4xl:w-52 @6xl:w-64" aria-label="Scene">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scenes.map((s) => (
                <SelectItem key={s.id} value={s.key}>
                  {s.key} · {s.name}
                  {s.locked ? " (locked)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Hint label="Next scene">
            <Button size="icon-sm" variant="ghost" disabled={index >= scenes.length - 1} onClick={() => onSelectScene(scenes[index + 1].key)} aria-label="Next scene">
              <ChevronRight />
            </Button>
          </Hint>
        </div>

        <div className="hidden min-w-0 items-center gap-1 overflow-hidden font-mono text-[11px] text-muted-foreground @4xl:flex">
          <Chip title="Where the scene starts and ends on the video timeline">
            {formatClock(scene.startSec, 2)} → {formatClock(scene.endSec, 2)}
          </Chip>
          <Chip title={`Scene length · ${timingTitle}`} className={cn("@6xl:hidden", !audioLocked && "border-warning/40 text-warning")}>
            {audioLocked ? <Lock className="size-3" /> : null}
            {scene.durationSec.toFixed(2)}s
          </Chip>
          <Chip title="Scene length" className="hidden @6xl:flex">
            {scene.durationSec.toFixed(2)}s
          </Chip>
          <Chip title={timingTitle} className={cn("hidden @6xl:flex", !audioLocked && "border-warning/40 text-warning")}>
            {audioLocked ? <Lock className="size-3" /> : null}
            {audioLocked ? "audio-locked" : "user-adjusted"}
          </Chip>
          <Chip title="Scene version" className="hidden @7xl:flex">
            v{scene.version}
          </Chip>
        </div>
        <Chip title={`${formatClock(scene.startSec, 2)} → ${formatClock(scene.endSec, 2)} · ${scene.durationSec.toFixed(2)}s · ${timingTitle}`} className={cn("font-mono text-[11px] text-muted-foreground @4xl:hidden", !audioLocked && "border-warning/40 text-warning")}>
          {audioLocked ? <Lock className="size-3" /> : null}
          {scene.durationSec.toFixed(1)}s
        </Chip>
        <span title={status.label} className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", status.tone)}>
          <span className="@5xl:hidden">{status.short}</span>
          <span className="hidden @5xl:inline">{status.label}</span>
        </span>
        {!scene.valid ? <span className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-destructive">Invalid spec</span> : null}
        {scene.staleTiming ? <span className="shrink-0 rounded bg-stale/15 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-stale">Timing stale</span> : null}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <EditHistoryControls projectId={projectId} />
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
          <Hint label={scene.locked ? "Unlock this scene" : "Lock this scene — edits by you and Claude are blocked until it's unlocked"}>
            <Button size="sm" variant={scene.locked ? "secondary" : "ghost"} onClick={onLock} disabled={lockPending} aria-label={scene.locked ? "Unlock scene" : "Lock scene"}>
              {scene.locked ? <Lock /> : <LockOpen />}
              <span className="hidden @5xl:inline">{scene.locked ? "Locked" : "Lock"}</span>
            </Button>
          </Hint>
          <Hint label={scene.needsReview ? "Approve the changed scene again" : approved ? "Mark this scene as not approved" : "Approve this scene"}>
            <Button size="sm" variant={approved && !scene.needsReview ? "outline" : "default"} disabled={scene.locked || approvePending || !scene.valid} onClick={onApprove} aria-label={scene.needsReview ? "Re-approve" : approved ? "Unapprove" : "Approve"}>
              <CheckCheck />
              <span className="hidden @4xl:inline">{scene.needsReview ? "Re-approve" : approved ? "Unapprove" : "Approve"}</span>
            </Button>
          </Hint>
          <span className="inline-flex @6xl:hidden">
            <SceneTemplatesButton compact projectId={projectId} scene={scene} getSceneSec={getSceneSec} />
          </span>
          <span className="hidden @6xl:inline-flex">
            <SceneTemplatesButton projectId={projectId} scene={scene} getSceneSec={getSceneSec} />
          </span>
          <Hint label="Ask Claude to change this scene">
            <Button size="sm" variant="outline" disabled={scene.locked} onClick={onAskClaude} aria-label="Ask Claude">
              <Sparkles className="text-primary" />
              <span className="hidden @4xl:inline">Ask Claude</span>
            </Button>
          </Hint>
          <Hint label="Open this scene on the Preview page">
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/projects/${projectId}/preview?scene=${scene.key}`} aria-label="Preview">
                <Eye />
                <span className="hidden @5xl:inline">Preview</span>
              </Link>
            </Button>
          </Hint>
          {narrow ? (
            <Hint label={sideOpen ? "Hide the inspector" : "Show the inspector"}>
              <Button size="icon-sm" variant={sideOpen ? "secondary" : "ghost"} onClick={onToggleSide} aria-label={sideOpen ? "Hide the inspector" : "Show the inspector"} aria-pressed={sideOpen}>
                <PanelRight />
              </Button>
            </Hint>
          ) : null}
        </div>
      </div>
    </div>
  );
}
