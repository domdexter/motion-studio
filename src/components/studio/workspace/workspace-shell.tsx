"use client";

import { AlertTriangle, ArrowLeft, Loader2, Settings as SettingsIcon, Sparkles, Wifi, WifiOff } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Suspense, useContext, useMemo } from "react";
import { STAGE_KEYS } from "@/core/status/pipeline";
import { formatDuration } from "@/lib/format";
import { useProject, useProjectEvents, type LiveJob, type LiveRender } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { ProjectDetail } from "@/server/services/projects";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HealthIndicator } from "../app-header";
import { ThemeToggle } from "../theme-toggle";
import { ErrorState } from "../common";
import { LogoMark } from "../logo";
import { StageDot, StatusPill } from "../status";
import { CommandBar } from "./command-bar";
import { NAV_GROUPS, SECONDARY_NAV, STAGE_LABELS, STAGE_ROUTES, navItemState } from "./nav";

interface WorkspaceContextValue {
  projectId: string;
  project: ProjectDetail | undefined;
  live: { connected: boolean; jobs: LiveJob[]; renders: LiveRender[] };
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceShell");
  return ctx;
}

const JOB_LABELS: Record<string, string> = {
  "voice.generate": "Generating voice-over",
  "voice.preview": "Generating voice preview",
  "alignment.forced": "Aligning script to audio",
  "alignment.stt": "Transcribing audio",
  "alignment.whisper": "Transcribing locally",
  "render.video": "Rendering video",
  "render.still": "Rendering still",
  "export.package": "Exporting package",
  "audio.generate": "Generating music / SFX",
  "ai.headless": "Claude is working",
};

function Sidebar({ projectId, project }: { projectId: string; project: ProjectDetail | undefined }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const isActive = (href: string) => (href === "" ? pathname === base : pathname.startsWith(base + href));
  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="border-b border-sidebar-border px-3 pt-3 pb-3">
        <Link href="/" className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          <LogoMark className="size-5" />
          Projects
        </Link>
        {project ? (
          <div className="mt-2 px-1">
            <div className="truncate text-sm font-semibold tracking-tight" title={project.name}>
              {project.name}
            </div>
            <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span>
                {project.width}×{project.height}
              </span>
              <span>·</span>
              <span>{project.fps}fps</span>
              <span>·</span>
              <span>{formatDuration(project.state.durationSec)}</span>
            </div>
            <StatusPill status={project.state.pipeline.status} className="mt-2" />
          </div>
        ) : (
          <div className="mt-2 space-y-2 px-1">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        )}
      </div>
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-2">
            <div className="px-2 pt-2 pb-1 text-[10px] font-medium tracking-wider text-muted-foreground/70 uppercase">{group.label}</div>
            {group.items.map((item) => {
              const state = navItemState(item, project?.state.pipeline);
              const active = isActive(item.href);
              return (
                <Link
                  key={item.key}
                  href={base + item.href}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-foreground",
                    active && "bg-sidebar-accent text-foreground",
                  )}
                >
                  <item.icon className={cn("size-4 text-muted-foreground group-hover:text-foreground", active && "text-foreground")} />
                  <span className="flex-1">{item.label}</span>
                  {state && item.stages ? <StageDot state={state} title={item.stages.map((s) => `${STAGE_LABELS[s]}: ${project?.state.pipeline.stages[s].label}`).join(" · ")} /> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-2">
        {SECONDARY_NAV.map((item) => (
          <Link
            key={item.key}
            href={base + item.href}
            className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-foreground", isActive(item.href) && "bg-sidebar-accent text-foreground")}
          >
            <item.icon className="size-4 text-muted-foreground" />
            {item.label}
          </Link>
        ))}
        <div className="mt-1 flex items-center justify-between px-1">
          <HealthIndicator compact />
          <Button variant="ghost" size="icon-xs" asChild>
            <Link href="/settings" aria-label="Settings">
              <SettingsIcon />
            </Link>
          </Button>
        </div>
      </div>
    </aside>
  );
}

function PipelineStepper({ projectId, project }: { projectId: string; project: ProjectDetail }) {
  const stages = project.state.pipeline.stages;
  return (
    <div className="hidden items-center gap-1 xl:flex">
      {STAGE_KEYS.map((key, i) => (
        <div key={key} className="flex items-center gap-1">
          {i > 0 ? <span className="h-px w-2 bg-border" /> : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href={`/projects/${projectId}${STAGE_ROUTES[key]}`} className="flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground hover:border-zinc-600 hover:text-foreground">
                <StageDot state={stages[key].state} />
                {STAGE_LABELS[key]}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="text-xs font-medium">
                {STAGE_LABELS[key]} · {stages[key].label}
              </div>
              {stages[key].reason ? <div className="mt-0.5 text-xs text-muted-foreground">{stages[key].reason}</div> : null}
            </TooltipContent>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}

function JobsIndicator({ jobs, renders }: { jobs: LiveJob[]; renders: LiveRender[] }) {
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued");
  if (active.length === 0 && renders.length === 0) return null;
  const first = active[0];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-2 rounded-full bg-info/10 px-2.5 py-1 text-xs text-info">
          <Loader2 className="size-3.5 animate-spin" />
          {first ? `${JOB_LABELS[first.type] ?? first.type}${first.progress > 0 ? ` ${Math.round(first.progress * 100)}%` : first.status === "queued" ? " (queued)" : ""}` : "Rendering"}
          {active.length > 1 ? <span className="text-info/70">+{active.length - 1}</span> : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="space-y-1 text-xs">
          {active.map((j) => (
            <div key={j.id}>
              {JOB_LABELS[j.type] ?? j.type} — {j.status === "queued" ? "waiting for worker" : `${Math.round(j.progress * 100)}%${j.stage ? ` · ${j.stage}` : ""}`}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function StaleBanner({ projectId, project }: { projectId: string; project: ProjectDetail }) {
  const timeline = project.state.pipeline.stages.timeline;
  if (timeline.state !== "stale" || project.state.counts.scenes === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-stale/30 bg-stale/10 px-5 py-2 text-sm">
      <AlertTriangle className="size-4 text-stale" />
      <span className="text-foreground">Voice-over changed. Existing scene timing may no longer match.</span>
      <Button size="xs" variant="outline" className="ml-auto" asChild>
        <Link href={`/projects/${projectId}/timeline?review=voice-change`}>Review timeline</Link>
      </Button>
    </div>
  );
}

export function WorkspaceShell({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const { data: project, error, refetch } = useProject(projectId);
  const live = useProjectEvents(projectId);
  // One object per change, so every consumer of the workspace context does not re-render on each tick.
  const workspace = useMemo(() => ({ projectId, project, live }), [projectId, project, live]);

  if (error && !project) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24">
        <ErrorState error={error} title="Could not open this project" onRetry={() => void refetch()} />
        <Button variant="ghost" className="mt-4" asChild>
          <Link href="/">
            <ArrowLeft /> Back to projects
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar projectId={projectId} project={project} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-panel px-4">
            {project ? <PipelineStepper projectId={projectId} project={project} /> : <Skeleton className="h-5 w-96" />}
            <div className="ml-auto flex items-center gap-2">
              <JobsIndicator jobs={live.jobs} renders={live.renders} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn("flex size-6 items-center justify-center rounded-md", live.connected ? "text-muted-foreground" : "text-warning")}>
                    {live.connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{live.connected ? "Live sync connected — changes from Claude Code appear automatically" : "Live sync disconnected — reconnecting…"}</TooltipContent>
              </Tooltip>
              <ThemeToggle />
              <Button size="sm" variant="outline" className="gap-2" onClick={() => window.dispatchEvent(new CustomEvent("studio:command-bar"))}>
                <Sparkles className="text-primary" /> Ask Claude
                <kbd className="ml-1 hidden rounded border border-border px-1 font-mono text-[10px] text-muted-foreground sm:inline">Ctrl K</kbd>
              </Button>
            </div>
          </header>
          {project ? <StaleBanner projectId={projectId} project={project} /> : null}
          <main className="scrollbar-thin min-h-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
      <Suspense fallback={null}>
        <CommandBar projectId={projectId} />
      </Suspense>
    </WorkspaceContext.Provider>
  );
}
