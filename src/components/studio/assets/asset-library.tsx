"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, FileText, MoreHorizontal, Music, Pencil, RefreshCcw, Replace, Search, Sparkles, SquarePlus, Trash2, Type } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { AssetKind } from "@/core/spec/enums";
import { ApiError, errorMessage, http, uploadForm } from "@/lib/api-client";
import { formatBytes, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AssetDto } from "@/server/services/assets";
import type { SceneDto } from "@/server/services/scenes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dropzone, EmptyState, ErrorState, Panel } from "../common";
import { InsertMediaDialog } from "./insert-media-dialog";

const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.avif,.svg";
const VIDEO_ACCEPT = ".mp4,.m4v,.mov,.webm";
const AUDIO_ACCEPT = ".mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.weba";
const FONT_ACCEPT = ".ttf,.otf,.woff,.woff2";
const DOC_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.md,.txt";

export const ACCEPT_BY_KIND: Record<AssetKind, string> = {
  image: IMAGE_ACCEPT,
  video: VIDEO_ACCEPT,
  audio: AUDIO_ACCEPT,
  music: AUDIO_ACCEPT,
  sfx: AUDIO_ACCEPT,
  logo: IMAGE_ACCEPT,
  font: FONT_ACCEPT,
  screenshot: IMAGE_ACCEPT,
  icon: IMAGE_ACCEPT,
  brand_guide: DOC_ACCEPT,
  reference: DOC_ACCEPT,
};

export const KIND_LABELS: Record<AssetKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  music: "Music",
  sfx: "Sound effect",
  logo: "Logo",
  font: "Font",
  screenshot: "Screenshot",
  icon: "Icon",
  brand_guide: "Brand guide",
  reference: "Reference",
};

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

const UPLOAD_BATCH_FILES = 8;
const UPLOAD_BATCH_BYTES = 256 * 1024 * 1024;

export function useAssets(projectId: string, kinds: AssetKind[]) {
  return useQuery({
    queryKey: ["project", projectId, "assets", kinds.join(",")],
    queryFn: async () => (await http.get<{ assets: AssetDto[] }>(`/api/projects/${projectId}/assets?kind=${kinds.join(",")}`)).assets,
  });
}

export function useProjectScenes(projectId: string) {
  return useQuery({ queryKey: ["project", projectId, "scenes"], queryFn: async () => (await http.get<{ scenes: SceneDto[] }>(`/api/projects/${projectId}/scenes`)).scenes });
}

export function useUploadAssets(projectId: string) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const upload = async (kind: AssetKind, files: File[], fields: Record<string, string> = {}): Promise<AssetDto[]> => {
    if (!files.length) return [];
    // Any number of files: send them in small batches (the server accepts a limited number per request).
    const batches: File[][] = [];
    for (const file of files) {
      const last = batches[batches.length - 1];
      const lastBytes = last?.reduce((n, f) => n + f.size, 0) ?? 0;
      if (!last || last.length >= UPLOAD_BATCH_FILES || (last.length && lastBytes + file.size > UPLOAD_BATCH_BYTES)) batches.push([file]);
      else last.push(file);
    }
    const totalBytes = Math.max(1, files.reduce((n, f) => n + f.size, 0));
    const uploaded: AssetDto[] = [];
    const failures: string[] = [];
    let doneBytes = 0;
    setProgress(0);
    try {
      for (const batch of batches) {
        const batchBytes = batch.reduce((n, f) => n + f.size, 0);
        const form = new FormData();
        form.append("kind", kind);
        for (const [key, value] of Object.entries(fields)) form.append(key, value);
        for (const file of batch) form.append("file", file, file.name);
        try {
          const res = await uploadForm<{ assets: AssetDto[] }>(`/api/projects/${projectId}/assets?kind=${kind}`, form, (p) => setProgress((doneBytes + p * batchBytes) / totalBytes));
          uploaded.push(...res.assets);
        } catch (e) {
          failures.push(`${batch.length === 1 ? batch[0].name : `${batch.length} files (${batch[0].name}…)`}: ${errorMessage(e)}`);
        }
        doneBytes += batchBytes;
        setProgress(doneBytes / totalBytes);
      }
      if (uploaded.length) toast.success(`Uploaded ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}`);
      if (failures.length) toast.error(uploaded.length ? "Some files were not uploaded" : "Upload failed", { description: failures.slice(0, 4).join("\n") });
      if (uploaded.length) void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      return uploaded;
    } finally {
      setProgress(null);
    }
  };
  return { upload, progress };
}

export function downloadUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

export function AssetPreview({ asset, className }: { asset: AssetDto; className?: string }) {
  if (asset.mimeType.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={asset.url} alt={asset.name} loading="lazy" className={cn("size-full object-contain", className)} />;
  }
  if (asset.mimeType.startsWith("video/")) {
    return (
      <video
        src={asset.url}
        muted
        loop
        playsInline
        preload="metadata"
        className={cn("size-full object-cover", className)}
        onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
        onMouseLeave={(e) => e.currentTarget.pause()}
      />
    );
  }
  if (asset.mimeType.startsWith("audio/")) {
    return (
      <div className={cn("flex size-full flex-col items-center justify-center gap-2 p-3", className)}>
        <Music className="size-6 text-muted-foreground" />
        <audio src={asset.url} controls preload="none" className="h-8 w-full" />
      </div>
    );
  }
  return <div className={cn("flex size-full items-center justify-center text-muted-foreground", className)}>{asset.kind === "font" ? <Type className="size-8" /> : <FileText className="size-8" />}</div>;
}

function AssetCard({ projectId, asset, scenes }: { projectId: string; asset: AssetDto; scenes: SceneDto[] }) {
  const queryClient = useQueryClient();
  const replaceInput = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(asset.name);
  const [conflict, setConflict] = useState<string | null>(null);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => http.patch(`/api/projects/${projectId}/assets/${asset.id}`, body),
    onSuccess: () => {
      setRenaming(false);
      invalidate();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (force: boolean) => http.delete(`/api/projects/${projectId}/assets/${asset.id}${force ? "?force=1" : ""}`),
    onSuccess: () => {
      toast.success(`Deleted “${asset.name}”`);
      setConflict(null);
      invalidate();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "CONFLICT") setConflict(e.message);
      else fail(e);
    },
  });
  const regenerate = useMutation({
    mutationFn: () => http.patch(`/api/projects/${projectId}/asset-requests/${asset.requestId}`, { action: "regenerate", feedback: "" }),
    onSuccess: () => {
      toast.success("Asked for a new attempt", { description: "Open the request above to send it to Claude." });
      invalidate();
    },
    onError: fail,
  });
  const replace = async (file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    try {
      await uploadForm(`/api/projects/${projectId}/assets/${asset.id}`, form, undefined, undefined, "PUT");
      toast.success("File replaced", { description: "Scenes using this asset pick up the new file automatically." });
      invalidate();
    } catch (e) {
      fail(e);
    }
  };
  const [inserting, setInserting] = useState(false);
  const placeable = asset.mimeType.startsWith("video/") || (asset.mimeType.startsWith("image/") && ["image", "screenshot", "logo", "icon", "video"].includes(asset.kind));
  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`));
  const dims = asset.width && asset.height ? `${asset.width}×${asset.height}` : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative aspect-video bg-[repeating-conic-gradient(#191a21_0%_25%,#131419_0%_50%)] bg-[length:18px_18px]">
        <AssetPreview asset={asset} />
        <div className="absolute top-2 left-2 flex gap-1">
          {asset.source === "claude" ? (
            <span className="flex items-center gap-1 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
              <Sparkles className="size-3" /> AI
            </span>
          ) : null}
          {asset.status === "approved" ? <span className="rounded bg-success/90 px-1.5 py-0.5 text-[10px] font-medium text-black">Approved</span> : null}
          {asset.status === "rejected" ? <span className="rounded bg-destructive/90 px-1.5 py-0.5 text-[10px] font-medium text-white">Rejected</span> : null}
        </div>
      </div>
      <div className="space-y-2 p-3">
        {renaming ? (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) patch.mutate({ name: name.trim() });
            }}
          >
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-7" aria-label="Asset name" />
            <Button size="icon-xs" type="submit" aria-label="Save name">
              <Check />
            </Button>
          </form>
        ) : (
          <div className="flex items-start gap-1">
            <p className="min-w-0 flex-1 truncate text-sm font-medium" title={asset.name}>
              {asset.name}
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-xs" variant="ghost" aria-label="Asset actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setRenaming(true)}>
                  <Pencil /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={downloadUrl(asset.url)}>
                    <Download /> Download
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => replaceInput.current?.click()}>
                  <Replace /> Replace file…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copy(asset.id, "Asset id")}>
                  <Copy /> Copy asset id
                </DropdownMenuItem>
                {asset.prompt ? (
                  <DropdownMenuItem onClick={() => copy(asset.prompt!, "Prompt")}>
                    <Copy /> Copy prompt
                  </DropdownMenuItem>
                ) : null}
                {asset.requestId ? (
                  <DropdownMenuItem onClick={() => regenerate.mutate()}>
                    <RefreshCcw /> Regenerate
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => patch.mutate({ status: asset.status === "approved" ? "ready" : "approved" })}>
                  <Check /> {asset.status === "approved" ? "Remove approval" : "Mark approved"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => remove.mutate(false)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">
            {KIND_LABELS[asset.kind] ?? asset.kind}
          </Badge>
          {dims ? <span>{dims}</span> : null}
          {asset.durationSec ? <span>{formatDuration(asset.durationSec)}</span> : null}
          <span>{formatBytes(asset.sizeBytes)}</span>
          {asset.version > 1 ? <span>v{asset.version}</span> : null}
        </div>
        {placeable ? (
          <>
            <Button size="sm" variant="secondary" className="h-7 w-full text-xs" onClick={() => setInserting(true)}>
              <SquarePlus /> Insert into scene
            </Button>
            {inserting ? <InsertMediaDialog projectId={projectId} open={inserting} onOpenChange={setInserting} assetId={asset.id} /> : null}
          </>
        ) : null}
        {["image", "video", "screenshot", "logo", "icon"].includes(asset.kind) ? (
          <Select value={asset.sceneId ?? "none"} onValueChange={(v) => patch.mutate({ sceneId: v === "none" ? null : v })}>
            <SelectTrigger size="sm" className="h-7 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not linked to a scene</SelectItem>
              {scenes.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.key} · {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <button type="button" onClick={() => copy(asset.id, "Asset id")} className="font-mono text-[10px] text-muted-foreground hover:text-foreground" title="Copy the id to reference this asset in a scene spec">
          {asset.id}
        </button>
      </div>
      <input
        ref={replaceInput}
        type="file"
        className="hidden"
        accept={ACCEPT_BY_KIND[asset.kind]}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void replace(file);
          e.target.value = "";
        }}
      />
      <Dialog open={!!conflict} onOpenChange={(open) => !open && setConflict(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This asset is in use</DialogTitle>
            <DialogDescription>{conflict} Deleting it leaves those scenes with a missing-asset warning until you replace the reference.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConflict(null)}>
              Keep asset
            </Button>
            <Button variant="destructive" onClick={() => remove.mutate(true)} disabled={remove.isPending}>
              Delete anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AssetLibrary({
  projectId,
  title,
  description,
  kinds,
  uploadKinds,
  emptyHint,
}: {
  projectId: string;
  title: string;
  description?: string;
  kinds: AssetKind[];
  uploadKinds: AssetKind[];
  emptyHint: string;
}) {
  const assets = useAssets(projectId, kinds);
  const scenes = useProjectScenes(projectId);
  const { upload, progress } = useUploadAssets(projectId);
  const [uploadKind, setUploadKind] = useState<AssetKind>(uploadKinds[0]);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const q = query.trim().toLowerCase();
  const list = (assets.data ?? []).filter((a) => (kindFilter === "all" || a.kind === kindFilter) && (!q || a.name.toLowerCase().includes(q) || (a.prompt ?? "").toLowerCase().includes(q) || a.id.includes(q)));

  return (
    <Panel
      title={title}
      description={description}
      actions={
        <div className="flex items-center gap-2">
          {kinds.length > 1 ? (
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {kinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-8 w-44 pl-7" aria-label="Search assets" />
          </div>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="space-y-2">
          {uploadKinds.length > 1 ? (
            <Select value={uploadKind} onValueChange={(v) => setUploadKind(v as AssetKind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {uploadKinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    Upload as {KIND_LABELS[k].toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Dropzone accept={ACCEPT_BY_KIND[uploadKind]} multiple onFiles={(files) => void upload(uploadKind, files)} label={`Upload ${KIND_LABELS[uploadKind].toLowerCase()} files`} hint="Drop files or click to browse. Files are validated and stored in the project folder." disabled={progress !== null} />
          {progress !== null ? <Progress value={Math.round(progress * 100)} /> : null}
        </div>
        <div>
          {assets.error ? (
            <ErrorState error={assets.error} onRetry={() => void assets.refetch()} />
          ) : !assets.data ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-56 rounded-xl" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <EmptyState title={assets.data.length ? "No matches" : "Nothing here yet"} description={assets.data.length ? "Try another search or type." : emptyHint} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {list.map((asset) => (
                <AssetCard key={asset.id} projectId={projectId} asset={asset} scenes={scenes.data ?? []} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
