"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Library, Link2Off, Loader2, Palette, PenLine, Save } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, errorMessage, http } from "@/lib/api-client";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandEditor, KitSwatch, useBrandKits } from "../brand/brand-editor";
import { PageHeader, Panel } from "../common";
import { useWorkspace } from "../workspace/workspace-shell";

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

/** Where this project's brand comes from: a shared brand kit, or a custom brand for this project only. */
function BrandSourcePanel({ projectId }: { projectId: string }) {
  const { project } = useWorkspace();
  const queryClient = useQueryClient();
  const kits = useBrandKits();
  const [pendingKit, setPendingKit] = useState<BrandKitDto | null>(null);
  const [confirmDetach, setConfirmDetach] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [kitName, setKitName] = useState("");
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["brand-kits"] });
  };
  const apply = useMutation({
    mutationFn: (kit: BrandKitDto) => http.post(`/api/projects/${projectId}/brand-kit`, { kitId: kit.id }),
    onSuccess: (_d, kit) => {
      toast.success(`Now following “${kit.name}”`, { description: "Identity, design system, logo and fonts were copied in. Scenes keep their structure and timing." });
      setPendingKit(null);
      invalidate();
    },
    onError: fail,
  });
  const detach = useMutation({
    mutationFn: () => http.delete(`/api/projects/${projectId}/brand-kit`),
    onSuccess: () => {
      toast.success("This project now has a custom brand", { description: "It keeps its current look — edits here stay in this project." });
      setConfirmDetach(false);
      invalidate();
    },
    onError: fail,
  });
  const saveAsKit = useMutation({
    mutationFn: () => http.post<{ brandKit: BrandKitDto }>("/api/brand-kits", { name: kitName.trim(), fromProjectId: projectId, linkProject: true }),
    onSuccess: ({ brandKit }) => {
      toast.success(`Saved brand kit “${brandKit.name}”`, { description: "It's available to every project, and this project now follows it." });
      setSaveOpen(false);
      invalidate();
    },
    onError: fail,
  });

  if (!project) return null;
  const linked = project.brandKit;
  const allKits = kits.data ?? [];
  const linkedKit = linked ? allKits.find((k) => k.id === linked.id) : undefined;
  const others = allKits.filter((k) => k.id !== linked?.id);

  return (
    <Panel title="Brand source" description="Use a brand kit from Settings — set up once, reused by every project — or customize the brand for this project only.">
      {linked ? (
        <div className="flex flex-wrap items-center gap-4">
          {linkedKit ? <KitSwatch kit={linkedKit} className="h-16 w-28 shrink-0 border border-border" /> : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Library className="size-4 text-primary" /> Following brand kit <span className="font-semibold">{linked.name}</span>
              <Badge variant="outline">v{linked.version}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Identity, design system, logo and fonts come from the kit and update automatically whenever it changes. The editor below is read-only.</p>
            {linked.syncedVersion !== linked.version ? <p className="mt-0.5 text-xs text-warning">Last synced from v{linked.syncedVersion ?? "?"} — reopen the kit or re-select it to sync.</p> : null}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={`/settings/brands/${linked.id}`}>
                <PenLine /> Edit brand kit
              </Link>
            </Button>
            {others.length ? (
              <Select value="" onValueChange={(id) => setPendingKit(others.find((k) => k.id === id) ?? null)}>
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue placeholder="Switch kit…" />
                </SelectTrigger>
                <SelectContent>
                  {others.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => setConfirmDetach(true)}>
              <Link2Off /> Customize for this project
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Palette className="size-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Custom brand for this project</div>
            <p className="text-xs text-muted-foreground">Edits below apply to this project only.</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value="" onValueChange={(id) => setPendingKit(allKits.find((k) => k.id === id) ?? null)} disabled={!allKits.length}>
              <SelectTrigger size="sm" className="w-52">
                <SelectValue placeholder={kits.isLoading ? "Loading brand kits…" : allKits.length ? "Use a brand kit…" : "No brand kits yet"} />
              </SelectTrigger>
              <SelectContent>
                {allKits.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setKitName(project.brand.brandName || project.name);
                setSaveOpen(true);
              }}
            >
              <Save /> Save as brand kit
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link href="/settings/brands">Manage brand kits</Link>
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={!!pendingKit} onOpenChange={(open) => !open && setPendingKit(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use brand kit “{pendingKit?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This project&apos;s identity, design system, logo and fonts are replaced with the kit&apos;s{linked ? "" : " (a version of the project is saved first)"}. The project then follows the kit and updates whenever the kit changes. Scenes keep
              their structure and timing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pendingKit) apply.mutate(pendingKit);
              }}
              disabled={apply.isPending}
            >
              {apply.isPending ? <Loader2 className="animate-spin" /> : null} Use this kit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDetach} onOpenChange={setConfirmDetach}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Customize the brand for this project?</AlertDialogTitle>
            <AlertDialogDescription>
              The project stops following “{linked?.name}” and keeps its current look, so you can edit it here. Later changes to the kit won&apos;t reach this project. You can switch back to a kit at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                detach.mutate();
              }}
              disabled={detach.isPending}
            >
              {detach.isPending ? <Loader2 className="animate-spin" /> : null} Customize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as brand kit</DialogTitle>
            <DialogDescription>Copies this project&apos;s identity, design system, logo, fonts and references into a reusable kit in Settings. This project will follow the new kit.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (kitName.trim()) saveAsKit.mutate();
            }}
          >
            <Label htmlFor="kit-name">Kit name</Label>
            <Input id="kit-name" autoFocus value={kitName} onChange={(e) => setKitName(e.target.value)} maxLength={120} />
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveAsKit.mutate()} disabled={!kitName.trim() || saveAsKit.isPending}>
              {saveAsKit.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save brand kit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

export function BrandPage({ projectId }: { projectId: string }) {
  const { project } = useWorkspace();
  if (!project) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-6">
      <PageHeader title="Brand" description="Brand identity plus the motion design system every scene inherits. Change it to restyle the whole video without touching scene structure or timing." />
      <BrandSourcePanel projectId={projectId} />
      <BrandEditor target={{ kind: "project", projectId, brand: project.brand, design: project.design }} readOnly={!!project.brandKit} />
    </div>
  );
}
