"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, FileCode2, History, Loader2, RotateCcw, Save, Server, User, Workflow } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ErrorState, Panel } from "../common";

interface Snapshot {
  id: string;
  version: number;
  label: string;
  reason: string;
  scenes: number;
  audioTracks: number;
  createdAt: string;
}

interface ActivityItem {
  id: string;
  actor: string;
  type: string;
  message: string;
  createdAt: string;
}

const REASONS: Record<string, string> = {
  manual: "Saved",
  before_storyboard: "Auto · before storyboard",
  before_restore: "Auto · before restore",
  before_timeline: "Auto · before timeline",
  before_recalculate: "Auto · before recalculation",
};

const ACTORS: Record<string, { label: string; icon: typeof User; className: string }> = {
  user: { label: "You", icon: User, className: "bg-muted text-foreground" },
  claude: { label: "Claude", icon: Bot, className: "bg-primary/15 text-primary" },
  file: { label: "File edit", icon: FileCode2, className: "bg-info/15 text-info" },
  worker: { label: "Worker", icon: Workflow, className: "bg-success/15 text-success" },
  system: { label: "System", icon: Server, className: "bg-muted text-muted-foreground" },
};

export function VersionsPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState<Snapshot | null>(null);
  const [actor, setActor] = useState("all");
  const snapshots = useQuery({ queryKey: ["project", projectId, "snapshots"], queryFn: async () => (await http.get<{ snapshots: Snapshot[] }>(`/api/projects/${projectId}/snapshots`)).snapshots });
  const activity = useQuery({ queryKey: ["project", projectId, "activity"], queryFn: async () => (await http.get<{ activities: ActivityItem[] }>(`/api/projects/${projectId}/activity?limit=200`)).activities });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });

  const save = useMutation({
    mutationFn: () => http.post<{ snapshot: { version: number } }>(`/api/projects/${projectId}/snapshots`, { label }),
    onSuccess: ({ snapshot }) => {
      toast.success(`Saved version v${snapshot.version}`);
      setLabel("");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const restore = useMutation({
    mutationFn: (version: number) => http.post<{ result: { restoredVersion: number; backupVersion: number; missingVoice: boolean } }>(`/api/projects/${projectId}/snapshots/${version}/restore`),
    onSuccess: ({ result }) => {
      toast.success(`Restored v${result.restoredVersion}`, {
        description: `Your previous state was saved as v${result.backupVersion}.${result.missingVoice ? " The voice-over of that version no longer exists, so no voice is active." : ""}`,
      });
      setConfirm(null);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined }),
  });

  const items = (activity.data ?? []).filter((a) => actor === "all" || a.actor === actor);

  return (
    <div className="mx-auto max-w-[1300px] space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Versions &amp; activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every change is recorded with who made it — you, Claude Code, a file edit or the worker. Project versions capture the full creative state and can be restored at any time.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Panel title="Project versions" description="Scenes, design, brand, markers, audio mix and the active voice/timeline. Binaries are referenced, never duplicated.">
          <div className="flex gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Version label, e.g. Client review" onKeyDown={(e) => e.key === "Enter" && save.mutate()} aria-label="Version label" />
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save version
            </Button>
          </div>
          <div className="mt-4">
            {snapshots.error ? <ErrorState error={snapshots.error} /> : null}
            {!snapshots.data ? (
              <Skeleton className="h-40" />
            ) : snapshots.data.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No versions yet. Versions are also saved automatically before big changes.</p>
            ) : (
              <ul className="divide-y divide-border">
                {snapshots.data.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <History className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">v{s.version}</span>
                        <span className="truncate text-sm font-medium">{s.label}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {REASONS[s.reason] ?? s.reason.replace(/_/g, " ")} · {s.scenes} scenes · {s.audioTracks} audio tracks · {relativeTime(s.createdAt)}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setConfirm(s)}>
                      <RotateCcw /> Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel
          title="Activity"
          actions={
            <ToggleGroup type="single" size="sm" variant="outline" value={actor} onValueChange={(v) => v && setActor(v)}>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="user">You</ToggleGroupItem>
              <ToggleGroupItem value="claude">Claude</ToggleGroupItem>
              <ToggleGroupItem value="file">Files</ToggleGroupItem>
              <ToggleGroupItem value="worker">Worker</ToggleGroupItem>
            </ToggleGroup>
          }
        >
          {activity.error ? <ErrorState error={activity.error} /> : null}
          {!activity.data ? (
            <Skeleton className="h-64" />
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No activity for this filter.</p>
          ) : (
            <ul className="scrollbar-thin max-h-[640px] space-y-1 overflow-y-auto pr-1">
              {items.map((a) => {
                const meta = ACTORS[a.actor] ?? ACTORS.system;
                return (
                  <li key={a.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/30">
                    <span className={cn("mt-0.5 flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", meta.className)}>
                      <meta.icon className="size-3" /> {meta.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{a.message}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{a.type}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground" title={new Date(a.createdAt).toLocaleString()}>
                      {relativeTime(a.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Dialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore v{confirm?.version}?</DialogTitle>
            <DialogDescription>
              “{confirm?.label}” replaces the current scenes, design, brand, markers, audio mix and active voice/timeline. Your current state is saved as a new version first, and every scene keeps its version history — so this can be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button onClick={() => confirm && restore.mutate(confirm.version)} disabled={restore.isPending}>
              {restore.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Restore version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
