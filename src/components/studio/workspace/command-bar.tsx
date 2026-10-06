"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Clapperboard, ClipboardCheck, Compass, Film, ImageDown, ListChecks, Loader2, RotateCcw, Settings, Sparkles, Wand2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaskDto } from "@/server/services/tasks";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { REFINE_PRESETS, REVIEW_PRESETS } from "../creative/shared";
import { NAV_GROUPS, SECONDARY_NAV } from "./nav";

const TASK_STATUS: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  running: "bg-info/15 text-info",
  completed: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function TasksSheet({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const tasks = useQuery({
    queryKey: ["project", projectId, "tasks"],
    queryFn: async () => (await http.get<{ tasks: TaskDto[] }>(`/api/projects/${projectId}/tasks`)).tasks,
    enabled: open,
    refetchInterval: open ? 3000 : false,
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "cancel" | "retry" }) => http.patch(`/api/projects/${projectId}/tasks/${id}`, { action }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bot className="size-4 text-primary" /> Claude tasks
          </SheetTitle>
          <SheetDescription>
            Explicit, reviewable requests for Claude Code. In an interactive Claude Code session run <code className="rounded bg-muted px-1">npm run studio -- tasks</code>; with headless execution enabled in Settings the worker runs them automatically.
          </SheetDescription>
        </SheetHeader>
        <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-4 pb-6">
          {tasks.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {tasks.data?.length === 0 ? <p className="text-sm text-muted-foreground">No tasks yet.</p> : null}
          {tasks.data?.map((t) => (
            <div key={t.id} className="rounded-lg border border-border bg-card p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", TASK_STATUS[t.status])}>{t.status}</span>
                <span className="truncate font-medium">{t.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relativeTime(t.createdAt)}</span>
              </div>
              {t.instruction ? <p className="mt-1.5 text-muted-foreground">{t.instruction}</p> : null}
              {t.scope.sceneKeys?.length ? <p className="mt-1 text-xs text-muted-foreground">Scenes: {t.scope.sceneKeys.join(", ")}</p> : null}
              {t.resultSummary ? <p className="mt-1.5 text-success">{t.resultSummary}</p> : null}
              {t.error ? <p className="mt-1.5 text-destructive">{t.error}</p> : null}
              {t.log.length ? (
                <pre className="scrollbar-thin mt-2 max-h-32 overflow-auto rounded bg-black/30 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                  {t.log
                    .slice(-12)
                    .map((l) => l.text)
                    .join("\n")}
                </pre>
              ) : null}
              <div className="mt-2 flex gap-1.5">
                {t.status === "pending" || t.status === "running" ? (
                  <Button size="xs" variant="outline" onClick={() => act.mutate({ id: t.id, action: "cancel" })}>
                    <X /> Cancel
                  </Button>
                ) : null}
                {t.status === "failed" || t.status === "cancelled" ? (
                  <Button size="xs" variant="outline" onClick={() => act.mutate({ id: t.id, action: "retry" })}>
                    <RotateCcw /> Retry
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Ctrl/⌘ K: ask Claude in natural language (creates an explicit task), run deterministic
 * studio actions, or jump anywhere in the workspace.
 */
export function CommandBar({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const base = `/projects/${projectId}`;
  const sceneKey = pathname.startsWith(`${base}/scenes`) || pathname.startsWith(`${base}/preview`) ? params.get("scene") : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ view?: string; prompt?: string } | undefined>).detail;
      if (detail?.view === "tasks") setTasksOpen(true);
      else {
        setQuery(detail?.prompt ?? "");
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("studio:command-bar", onEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("studio:command-bar", onEvent);
    };
  }, []);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined, action: e instanceof ApiError && e.action ? { label: e.action.label, onClick: () => router.push(e.action!.href) } : undefined });

  const createTask = useMutation({
    mutationFn: (body: { type: string; instruction?: string; scope?: Record<string, unknown> }) => http.post<{ task: TaskDto }>(`/api/projects/${projectId}/tasks`, { instruction: "", ...body }),
    onSuccess: ({ task }) => {
      toast.success(`Sent to Claude Code: ${task.title}`, {
        description: task.executor === "headless" ? "Claude is working on it in the background." : "Waiting for Claude Code — run `npm run studio -- tasks` in your Claude Code session.",
        action: { label: "View tasks", onClick: () => setTasksOpen(true) },
      });
      setOpen(false);
      setQuery("");
      invalidate();
    },
    onError: fail,
  });
  const runAction = useMutation({
    mutationFn: async (action: "draft" | "preview-render" | "thumbnail") => {
      if (action === "draft") return http.post(`/api/projects/${projectId}/storyboard/generate`, { mode: "rules" });
      if (action === "preview-render") return http.post(`/api/projects/${projectId}/renders`, { kind: "preview", force: true });
      return http.post(`/api/projects/${projectId}/exports/still`, { purpose: "thumbnail" });
    },
    onSuccess: (_d, action) => {
      toast.success(action === "draft" ? "Storyboard drafted" : action === "preview-render" ? "Draft render queued" : "Thumbnail export queued");
      setOpen(false);
      invalidate();
      if (action === "preview-render") router.push(`${base}/render`);
    },
    onError: fail,
  });

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const busy = createTask.isPending || runAction.isPending;
  const trimmed = query.trim();

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
          <DialogTitle className="sr-only">Command bar</DialogTitle>
          <Command loop>
            <CommandInput value={query} onValueChange={setQuery} placeholder={sceneKey ? `Ask Claude about ${sceneKey}, or search actions…` : "Ask Claude, or search actions…"} />
            <CommandList className="max-h-[440px]">
              <CommandEmpty>No matching actions — press Enter on “Ask Claude” to send it as a request.</CommandEmpty>
              {trimmed ? (
                <CommandGroup heading="Ask Claude">
                  <CommandItem
                    forceMount
                    value={`__ask__ ${trimmed}`}
                    disabled={busy}
                    onSelect={() => createTask.mutate({ type: sceneKey ? "edit_scene" : "command", instruction: trimmed, scope: sceneKey ? { sceneIds: [sceneKey] } : {} })}
                  >
                    {createTask.isPending ? <Loader2 className="animate-spin" /> : <Sparkles className="text-primary" />}
                    <span className="truncate">
                      Ask Claude{sceneKey ? ` (${sceneKey})` : ""}: “{trimmed}”
                    </span>
                    <CommandShortcut>↵</CommandShortcut>
                  </CommandItem>
                  <CommandItem forceMount value={`__review__ ${trimmed}`} disabled={busy} onSelect={() => createTask.mutate({ type: "creative_review", instruction: trimmed, scope: sceneKey ? { sceneIds: [sceneKey] } : {} })}>
                    <ClipboardCheck className="text-primary" />
                    <span className="truncate">
                      Creative review, no changes{sceneKey ? ` (${sceneKey})` : ""}: “{trimmed}”
                    </span>
                  </CommandItem>
                </CommandGroup>
              ) : null}
              <CommandGroup heading="Claude Code">
                <CommandItem disabled={busy} onSelect={() => createTask.mutate({ type: "analyze_script" })}>
                  <Sparkles /> Analyze the script
                </CommandItem>
                <CommandItem disabled={busy} onSelect={() => createTask.mutate({ type: "plan_creative" })}>
                  <Compass /> Plan the creative direction with Claude
                </CommandItem>
                <CommandItem disabled={busy} onSelect={() => createTask.mutate({ type: "generate_storyboard", scope: { keepTiming: true, keepVoice: true } })}>
                  <Clapperboard /> Generate the storyboard with Claude
                </CommandItem>
                <CommandItem disabled={busy} onSelect={() => createTask.mutate({ type: "generate_assets" })}>
                  <ImageDown /> Generate missing assets with Claude
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    setOpen(false);
                    setTasksOpen(true);
                  }}
                >
                  <ListChecks /> View Claude tasks
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Creative review — nothing changes">
                {REVIEW_PRESETS.map((p) => (
                  <CommandItem key={p} value={`review ${p}`} disabled={busy} onSelect={() => createTask.mutate({ type: "creative_review", instruction: p })}>
                    <ClipboardCheck /> {p.replace(/\.$/, "")}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Creative refinement — timing and voice kept">
                {sceneKey ? (
                  <CommandItem value={`refine cinematic ${sceneKey}`} disabled={busy} onSelect={() => createTask.mutate({ type: "refine_creative", instruction: `Make ${sceneKey} more cinematic without changing timing.`, scope: { sceneIds: [sceneKey], keepTiming: true, keepVoice: true } })}>
                    <Wand2 /> Make {sceneKey} more cinematic without changing timing
                  </CommandItem>
                ) : null}
                {REFINE_PRESETS.map((p) => (
                  <CommandItem key={p} value={`refine ${p}`} disabled={busy} onSelect={() => createTask.mutate({ type: "refine_creative", instruction: p, scope: { keepTiming: true, keepVoice: true } })}>
                    <Wand2 /> {p.replace(/\.$/, "")}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Actions">
                <CommandItem disabled={busy} onSelect={() => runAction.mutate("draft")}>
                  <Wand2 /> Quick storyboard draft (rules)
                </CommandItem>
                <CommandItem disabled={busy} onSelect={() => runAction.mutate("preview-render")}>
                  <Film /> Render a draft preview
                </CommandItem>
                <CommandItem onSelect={() => go(`${base}/render`)}>
                  <Film /> Render the final video…
                </CommandItem>
                <CommandItem disabled={busy} onSelect={() => runAction.mutate("thumbnail")}>
                  <ImageDown /> Export thumbnail
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Go to">
                {[...NAV_GROUPS.flatMap((g) => g.items), ...SECONDARY_NAV].map((item) => (
                  <CommandItem key={item.key} value={`go ${item.label}`} onSelect={() => go(base + item.href)}>
                    <item.icon /> {item.label}
                  </CommandItem>
                ))}
                <CommandItem value="go settings" onSelect={() => go("/settings")}>
                  <Settings /> Settings
                </CommandItem>
                <CommandItem value="go projects dashboard" onSelect={() => go("/")}>
                  <Clapperboard /> All projects
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
      <TasksSheet projectId={projectId} open={tasksOpen} onOpenChange={setTasksOpen} />
    </>
  );
}
