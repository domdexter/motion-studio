"use client";

import { Archive, ArchiveRestore, Copy, FolderOpen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ProjectCard as ProjectCardData } from "@/server/services/projects";
import { errorMessage, http } from "@/lib/api-client";
import { formatDuration, pluralize, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FormatFrame } from "../common";
import { RenderStatusLine, StatusPill } from "../status";

function Placeholder({ project }: { project: ProjectCardData }) {
  const initials = project.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div
      className="flex size-full items-center justify-center"
      style={{
        background: `radial-gradient(120% 90% at 20% 10%, ${project.brandColors.primary}55 0%, transparent 55%), radial-gradient(90% 80% at 90% 100%, ${project.brandColors.accent}33 0%, transparent 60%), ${project.brandColors.background}`,
      }}
    >
      <span className="text-2xl font-semibold tracking-tight text-white/85">{initials}</span>
    </div>
  );
}

export function ProjectCard({ project }: { project: ProjectCardData }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [failedThumb, setFailedThumb] = useState<string | null>(null);
  const [copyName, setCopyName] = useState(`${project.name} (copy)`);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["projects"] });

  const rename = useMutation({
    mutationFn: () => http.patch(`/api/projects/${project.id}`, { name }),
    onSuccess: () => {
      toast.success("Project renamed");
      setRenameOpen(false);
      void refresh();
    },
    onError: (e) => toast.error("Rename failed", { description: errorMessage(e) }),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => http.post(`/api/projects/${project.id}/archive`, { archived }),
    onSuccess: (_d, archived) => {
      toast.success(archived ? "Project archived" : "Project restored");
      void refresh();
    },
    onError: (e) => toast.error("Could not update archive state", { description: errorMessage(e) }),
  });
  const duplicate = useMutation({
    mutationFn: () => http.post<{ id: string }>(`/api/projects/${project.id}/duplicate`, { name: copyName }),
    onSuccess: (d) => {
      toast.success("Project duplicated", { action: { label: "Open", onClick: () => router.push(`/projects/${d.id}`) } });
      setDuplicateOpen(false);
      void refresh();
    },
    onError: (e) => toast.error("Duplicate failed", { description: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: () => http.delete(`/api/projects/${project.id}`),
    onSuccess: () => {
      toast.success("Project deleted");
      void refresh();
    },
    onError: (e) => toast.error("Delete failed", { description: errorMessage(e) }),
  });

  return (
    <>
      <article className={cn("group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/25", project.archived && "opacity-70")}>
        <Link href={`/projects/${project.id}`} className="relative block aspect-[16/10] bg-canvas p-3" aria-label={`Open ${project.name}`}>
          <FormatFrame width={project.width} height={project.height}>
            {project.thumbnailUrl && project.thumbnailUrl !== failedThumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={project.thumbnailUrl} alt="" className="size-full object-cover" onError={() => setFailedThumb(project.thumbnailUrl)} />
            ) : (
              <Placeholder project={project} />
            )}
          </FormatFrame>
          <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/80 backdrop-blur">
            {project.aspect} · {project.fps}fps
          </span>
          <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur tabular">{formatDuration(project.durationSec)}</span>
        </Link>
        <div className="flex flex-1 flex-col gap-2 p-3.5">
          <div className="flex items-start gap-2">
            <Link href={`/projects/${project.id}`} className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-medium" title={project.name}>
                {project.name}
              </h3>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="-mt-0.5 -mr-1 text-muted-foreground" aria-label="Project actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => router.push(`/projects/${project.id}`)}>
                  <FolderOpen /> Open
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setName(project.name);
                    setRenameOpen(true);
                  }}
                >
                  <Pencil /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setCopyName(`${project.name} (copy)`);
                    setDuplicateOpen(true);
                  }}
                >
                  <Copy /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => archive.mutate(!project.archived)}>
                  {project.archived ? <ArchiveRestore /> : <Archive />} {project.archived ? "Unarchive" : "Archive"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={project.status} />
            {project.staleCount > 0 ? <span className="rounded-full bg-stale/10 px-2 py-0.5 text-[11px] text-stale">{pluralize(project.staleCount, "stale stage")}</span> : null}
            {project.archived ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Archived</span> : null}
          </div>
          <p className="line-clamp-1 text-xs text-muted-foreground" title={project.stage}>
            {project.stage}
          </p>
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2.5 text-xs">
            <RenderStatusLine render={project.render} />
            <span className="text-muted-foreground">{pluralize(project.sceneCount, "scene")}</span>
          </div>
          <p className="text-[11px] text-muted-foreground/70">Updated {relativeTime(project.updatedAt)}</p>
        </div>
      </article>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) rename.mutate();
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} />
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || rename.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate project</DialogTitle>
            <DialogDescription>Copies the script, voice takes, timing, storyboard, scenes, assets and history. Renders are not copied.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              duplicate.mutate();
            }}
          >
            <Input value={copyName} onChange={(e) => setCopyName(e.target.value)} autoFocus maxLength={120} />
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setDuplicateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!copyName.trim() || duplicate.isPending}>
                {duplicate.isPending ? "Duplicating…" : "Duplicate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the project, its history, and every file in its project folder (audio, assets, renders). This cannot be undone. Consider archiving instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => remove.mutate()}>
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
