"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Library, Loader2, MoreHorizontal, PenLine, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DESIGN_PRESETS } from "@/core/design/presets";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BrandKitDto } from "@/server/services/brand-kits";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AppHeader } from "../app-header";
import { BrandEditor, KitSwatch, useBrandKits } from "../brand/brand-editor";
import { EmptyState, ErrorState, Panel } from "../common";

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

type KitProjects = { id: string; name: string; syncedVersion: number | null; archived: boolean }[];

function NewBrandKitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState("premium_saas");
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setPreset("premium_saas");
    }
  }, [open]);
  const create = useMutation({
    mutationFn: () => http.post<{ brandKit: BrandKitDto }>("/api/brand-kits", { name: name.trim(), description, designPreset: preset }),
    onSuccess: ({ brandKit }) => {
      void queryClient.invalidateQueries({ queryKey: ["brand-kits"] });
      onOpenChange(false);
      router.push(`/settings/brands/${brandKit.id}`);
    },
    onError: fail,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New brand kit</DialogTitle>
          <DialogDescription>Start from a motion design preset — then add the logo, fonts, colors and guidelines.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-kit-name">Name</Label>
            <Input id="new-kit-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incep Platform" maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-kit-description">Description (optional)</Label>
            <Input id="new-kit-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Product launches and social ads" maxLength={2000} />
          </div>
          <div className="space-y-1.5">
            <Label>Starting look</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {DESIGN_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={cn("rounded-lg border p-2 text-left transition-colors hover:border-primary/50", preset === p.id ? "border-primary ring-1 ring-primary" : "border-border")}
                >
                  <div className="flex items-center gap-1">
                    {(["background", "primary", "secondary", "accent"] as const).map((k) => (
                      <span key={k} className="size-3.5 rounded-full border border-foreground/10" style={{ background: p.design.colors[k] }} />
                    ))}
                    {preset === p.id ? <Check className="ml-auto size-3.5 text-primary" /> : null}
                  </div>
                  <div className="mt-1.5 text-xs font-medium">{p.label}</div>
                </button>
              ))}
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Create brand kit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteKitDialog({ kit, open, onOpenChange, onDeleted }: { kit: BrandKitDto; open: boolean; onOpenChange: (open: boolean) => void; onDeleted?: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => http.delete(`/api/brand-kits/${kit.id}`),
    onSuccess: () => {
      toast.success(`Deleted brand kit “${kit.name}”`);
      void queryClient.invalidateQueries({ queryKey: ["brand-kits"] });
      void queryClient.invalidateQueries({ queryKey: ["project"] });
      onOpenChange(false);
      onDeleted?.();
    },
    onError: fail,
  });
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{kit.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The kit and its files are removed from Settings.{" "}
            {kit.projectCount
              ? `${kit.projectCount} project${kit.projectCount === 1 ? "" : "s"} following it keep${kit.projectCount === 1 ? "s" : ""} the current look as a custom brand — nothing in those videos changes.`
              : "No projects follow this kit."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              remove.mutate();
            }}
            disabled={remove.isPending}
          >
            {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete brand kit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function BrandKitCard({ kit }: { kit: BrandKitDto }) {
  const [deleting, setDeleting] = useState(false);
  const t = kit.design.typography;
  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/25">
      <Link href={`/settings/brands/${kit.id}`} className="block">
        <KitSwatch kit={kit} className="h-32 rounded-none" />
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start gap-2">
          <Link href={`/settings/brands/${kit.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
            {kit.name}
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label={`${kit.name} actions`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/settings/brands/${kit.id}`}>
                  <PenLine /> Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {kit.description ? <p className="line-clamp-2 text-xs text-muted-foreground">{kit.description}</p> : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-[11px] text-muted-foreground">
          <span>
            {t.headingFont}
            {t.bodyFont !== t.headingFont ? ` / ${t.bodyFont}` : ""}
          </span>
          <span>·</span>
          <span>
            {kit.projectCount} project{kit.projectCount === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>updated {relativeTime(kit.updatedAt)}</span>
        </div>
      </div>
      <DeleteKitDialog kit={kit} open={deleting} onOpenChange={setDeleting} />
    </article>
  );
}

/** Settings → Brand kits (library). */
export function BrandKitsView() {
  const kits = useBrandKits();
  const [creating, setCreating] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Settings
        </Link>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Brand kits</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Set up a brand once — identity, design system, logo, fonts and references — and use it in any project. Projects that follow a kit update whenever it changes; any project can still customize its own brand.
            </p>
          </div>
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus /> New brand kit
          </Button>
        </div>
        {kits.error ? (
          <ErrorState error={kits.error} title="Could not load brand kits" onRetry={() => void kits.refetch()} />
        ) : !kits.data ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-52 rounded-xl" />
            ))}
          </div>
        ) : kits.data.length === 0 ? (
          <EmptyState
            icon={<Library />}
            title="No brand kits yet"
            description="Create one here, or open a project's Brand page and choose “Save as brand kit”."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> New brand kit
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kits.data.map((kit) => (
              <BrandKitCard key={kit.id} kit={kit} />
            ))}
          </div>
        )}
      </div>
      <NewBrandKitDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/** Compact list for the main Settings page. */
export function BrandKitsSummary() {
  const kits = useBrandKits();
  return (
    <Panel
      title="Brand kits"
      description="Reusable brands for your projects — pick one when creating a project or on a project's Brand page."
      actions={
        <Button size="sm" variant="outline" asChild>
          <Link href="/settings/brands">Manage brand kits</Link>
        </Button>
      }
    >
      {!kits.data ? (
        <Skeleton className="h-24" />
      ) : kits.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No brand kits yet.{" "}
          <Link href="/settings/brands" className="text-primary hover:underline">
            Create your first brand kit
          </Link>{" "}
          so new projects don&apos;t start from scratch.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kits.data.slice(0, 8).map((k) => (
            <Link key={k.id} href={`/settings/brands/${k.id}`} className="rounded-lg border border-border p-2 transition-colors hover:border-primary/50">
              <KitSwatch kit={k} className="h-20" />
              <div className="mt-2 truncate text-sm font-medium">{k.name}</div>
              <div className="text-xs text-muted-foreground">
                {k.projectCount} project{k.projectCount === 1 ? "" : "s"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Settings → Brand kits → one kit: the same editor as a project's Brand page. */
export function BrandKitEditorView({ kitId }: { kitId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["brand-kit", kitId], queryFn: () => http.get<{ brandKit: BrandKitDto; projects: KitProjects }>(`/api/brand-kits/${kitId}`) });
  const kit = q.data?.brandKit;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (kit) {
      setName(kit.name);
      setDescription(kit.description);
    }
  }, [kit?.name, kit?.description]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveInfo = useMutation({
    mutationFn: (body: { name?: string; description?: string }) => http.patch(`/api/brand-kits/${kitId}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brand-kit", kitId] });
      void queryClient.invalidateQueries({ queryKey: ["brand-kits"] });
    },
    onError: fail,
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-8">
        <Link href="/settings/brands" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Brand kits
        </Link>
        {q.error ? (
          <ErrorState error={q.error} title="Could not load this brand kit" onRetry={() => void q.refetch()} />
        ) : !kit || !q.data ? (
          <div className="space-y-4">
            <Skeleton className="h-16 w-96" />
            <Skeleton className="h-[480px]" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <KitSwatch kit={kit} className="h-16 w-28 shrink-0 border border-border" />
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => name.trim() && name.trim() !== kit.name && saveInfo.mutate({ name: name.trim() })}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="h-9 max-w-md border-transparent bg-transparent px-1 text-xl font-semibold tracking-tight shadow-none hover:border-border focus-visible:border-border dark:bg-transparent"
                  aria-label="Brand kit name"
                  maxLength={120}
                />
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => description !== kit.description && saveInfo.mutate({ description })}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  placeholder="Add a description"
                  className="h-7 max-w-xl border-transparent bg-transparent px-1 text-sm text-muted-foreground shadow-none hover:border-border focus-visible:border-border dark:bg-transparent"
                  aria-label="Brand kit description"
                  maxLength={2000}
                />
              </div>
              <Badge variant="outline">v{kit.version}</Badge>
              <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
                <Trash2 /> Delete
              </Button>
            </div>

            <Panel title="Projects following this kit" description="Every change you save here is copied into these projects automatically.">
              {q.data.projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No projects follow this kit yet. Choose it when creating a project, or on a project&apos;s Brand page.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {q.data.projects.map((p) => (
                    <Link key={p.id} href={`/projects/${p.id}/assets/brand`} className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm transition-colors hover:border-primary/50">
                      {p.name}
                      {p.archived ? <span className="text-[10px] text-muted-foreground">archived</span> : null}
                      {p.syncedVersion !== kit.version ? <span className="text-[10px] text-warning">v{p.syncedVersion ?? "?"}</span> : null}
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            <BrandEditor target={{ kind: "kit", kit }} />
            <DeleteKitDialog kit={kit} open={deleting} onOpenChange={setDeleting} onDeleted={() => router.push("/settings/brands")} />
          </>
        )}
      </div>
    </div>
  );
}
