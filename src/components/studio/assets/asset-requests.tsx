"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Plus, RefreshCcw, Sparkles, Upload, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { REGIONS } from "@/core/creative/schema";
import { aspectRatioLabel } from "@/core/spec/format";
import { ApiError, errorMessage, http, uploadForm } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AssetRequestDto } from "@/server/services/asset-requests";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "../common";
import { useWorkspace } from "../workspace/workspace-shell";
import { ACCEPT_BY_KIND, AssetPreview, useProjectScenes } from "./asset-library";

const STATUS_STYLE: Record<string, string> = {
  requested: "bg-warning/15 text-warning",
  generating: "bg-info/15 text-info",
  generated: "bg-primary/15 text-primary",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  generating: "Generating",
  generated: "Ready for review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const ASPECTS = ["16:9", "9:16", "1:1", "4:5", "3:2", "2:3", "21:9"];

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

function RequestCard({ projectId, request }: { projectId: string; request: AssetRequestDto }) {
  const queryClient = useQueryClient();
  const uploadInput = useRef<HTMLInputElement>(null);
  const [feedbackFor, setFeedbackFor] = useState<null | "reject" | "regenerate">(null);
  const [feedback, setFeedback] = useState("");
  const [uploading, setUploading] = useState(false);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => http.patch(`/api/projects/${projectId}/asset-requests/${request.id}`, body),
    onSuccess: (_d, body) => {
      const action = body.action as string;
      toast.success(action === "approve" ? "Approved — use its asset id in a scene, or ask Claude to place it" : action === "reject" ? "Results rejected" : action === "regenerate" ? "New attempt requested" : "Request updated");
      setFeedbackFor(null);
      setFeedback("");
      invalidate();
    },
    onError: fail,
  });
  const claude = useMutation({
    mutationFn: () =>
      http.post(`/api/projects/${projectId}/tasks`, {
        type: "generate_assets",
        instruction: `Fulfil asset request ${request.id}.${request.feedback ? ` Feedback on the previous attempt: ${request.feedback}` : ""}`,
      }),
    onSuccess: () => {
      toast.success("Sent to Claude Code", { description: "Claude generates it with its native image/video generation and registers the result with assets:fulfill." });
      invalidate();
    },
    onError: fail,
  });
  const uploadResult = async (files: FileList | null) => {
    if (!files?.length) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("file", f, f.name));
    setUploading(true);
    try {
      await uploadForm(`/api/projects/${projectId}/asset-requests/${request.id}/fulfill`, form);
      toast.success("Result attached — review and approve it");
      invalidate();
    } catch (e) {
      fail(e);
    } finally {
      setUploading(false);
    }
  };

  const open = ["requested", "generating", "generated", "rejected"].includes(request.status);
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium", STATUS_STYLE[request.status])}>
          {request.status === "generating" ? <Loader2 className="size-3 animate-spin" /> : null}
          {STATUS_LABEL[request.status] ?? request.status}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{request.id}</span>
        {request.sceneKey ? (
          <Badge variant="outline" className="text-[10px]">
            {request.sceneKey}
          </Badge>
        ) : null}
        <span className="text-[11px] text-muted-foreground">
          {request.aspectRatio}
          {request.kind === "video" && request.durationSec ? ` · ${request.durationSec}s` : ""} · attempt {request.attempt} · requested by {request.requestedBy === "claude" ? "Claude" : "you"} · {relativeTime(request.createdAt)}
        </span>
      </div>
      <p className="mt-2 text-sm">{request.prompt}</p>
      {request.styleNotes ? <p className="mt-1 text-xs text-muted-foreground">Style · {request.styleNotes}</p> : null}
      {request.purpose ? <p className="text-xs text-muted-foreground">Purpose · {request.purpose}</p> : null}
      {request.brief ? (
        <div className="mt-2 rounded-lg border border-border bg-muted/20 p-2 text-xs">
          <p className="mb-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">Composition brief</p>
          <dl className="grid grid-cols-[96px_1fr] gap-x-2 gap-y-0.5">
            {(
              [
                ["Meaning", request.brief.narrativeMeaning],
                ["Subject", request.brief.subject],
                ["Composition", request.brief.composition],
                ["Focal point", request.brief.focalPoint],
                ["Negative space", request.brief.negativeSpace],
                ["Lighting", request.brief.lighting],
                ["Style", request.brief.style],
              ] as [string, string | undefined][]
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <Fragment key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </Fragment>
              ))}
          </dl>
          {request.brief.palette.length ? (
            <div className="mt-1.5 flex items-center gap-1">
              {request.brief.palette.map((c) => (
                <span key={c} className="size-3.5 rounded-sm border border-border" style={{ background: c }} title={c} />
              ))}
            </div>
          ) : null}
          {request.brief.avoid.length ? <p className="mt-1 text-muted-foreground">Avoid · {request.brief.avoid.join(" · ")}</p> : null}
        </div>
      ) : null}
      {request.feedback ? <p className="mt-1 text-xs text-warning">Feedback · {request.feedback}</p> : null}
      {request.error ? <p className="mt-1 text-xs text-destructive">Last attempt failed · {request.error}</p> : null}

      {request.candidates.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {request.candidates.map((c) => {
            const approved = request.approvedAssetId === c.id;
            return (
              <div key={c.id} className={cn("overflow-hidden rounded-lg border", approved ? "border-success ring-1 ring-success" : "border-border")}>
                <div className="aspect-video bg-black">
                  <AssetPreview asset={c} />
                </div>
                <div className="flex items-center gap-1 p-1.5">
                  {approved ? (
                    <span className="flex items-center gap-1 text-[11px] text-success">
                      <Check className="size-3" /> Approved
                    </span>
                  ) : (
                    <Button size="xs" variant="outline" disabled={act.isPending || !["generated", "approved"].includes(request.status)} onClick={() => act.mutate({ action: "approve", assetId: c.id })}>
                      <Check /> Approve
                    </Button>
                  )}
                  <span className="ml-auto truncate font-mono text-[9px] text-muted-foreground">{c.id}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {request.status === "requested" || request.status === "rejected" ? (
          <Button size="sm" variant="outline" onClick={() => claude.mutate()} disabled={claude.isPending}>
            {claude.isPending ? <Loader2 className="animate-spin" /> : <Sparkles className="text-primary" />} Generate with Claude
          </Button>
        ) : null}
        {open ? (
          <Button size="sm" variant="ghost" onClick={() => uploadInput.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Upload result
          </Button>
        ) : null}
        {request.status === "generated" ? (
          <Button size="sm" variant="ghost" onClick={() => setFeedbackFor("reject")}>
            <X /> Reject
          </Button>
        ) : null}
        {["generated", "rejected", "approved", "cancelled"].includes(request.status) ? (
          <Button size="sm" variant="ghost" onClick={() => setFeedbackFor("regenerate")}>
            <RefreshCcw /> Regenerate
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(request.prompt).then(() => toast.success("Prompt copied"))}>
          <Copy /> Copy prompt
        </Button>
        {open ? (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => act.mutate({ action: "cancel" })} disabled={act.isPending}>
            Cancel request
          </Button>
        ) : null}
      </div>

      {feedbackFor ? (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/20 p-2.5">
          <Textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={feedbackFor === "reject" ? "What's wrong with these results? (optional)" : "What should change in the next attempt? (optional)"} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => act.mutate({ action: feedbackFor, feedback })} disabled={act.isPending}>
              {feedbackFor === "reject" ? "Reject results" : "Request a new attempt"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFeedbackFor(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <input
        ref={uploadInput}
        type="file"
        multiple
        accept={request.kind === "video" ? ACCEPT_BY_KIND.video : ACCEPT_BY_KIND.image}
        className="hidden"
        onChange={(e) => {
          void uploadResult(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function NewRequestDialog({ projectId, kind, open, onOpenChange }: { projectId: string; kind: "image" | "video"; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { project } = useWorkspace();
  const queryClient = useQueryClient();
  const scenes = useProjectScenes(projectId);
  const projectAspect = project ? aspectRatioLabel(project.width, project.height) : "16:9";
  const defaultAspect = /^\d{1,2}:\d{1,2}$/.test(projectAspect) ? projectAspect : "16:9";
  const empty = { prompt: "", aspectRatio: defaultAspect, styleNotes: project?.brand.imageStyle ?? "", purpose: "", sceneId: "none", count: 1, durationSec: 5, sendToClaude: true, composition: "", negativeSpace: "none", lighting: "", palette: "", avoid: "" };
  const [form, setForm] = useState(empty);
  useEffect(() => {
    if (open) setForm(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const palette = form.palette.split(/[,\s]+/).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
      const avoid = form.avoid.split("\n").map((s) => s.trim()).filter(Boolean);
      const hasBrief = !!(form.composition.trim() || form.negativeSpace !== "none" || form.lighting.trim() || palette.length || avoid.length);
      const brief = hasBrief
        ? {
            purpose: form.purpose.trim() || "Scene asset",
            subject: form.prompt.trim(),
            ...(form.composition.trim() ? { composition: form.composition.trim() } : {}),
            ...(form.negativeSpace !== "none" ? { negativeSpace: form.negativeSpace } : {}),
            ...(form.lighting.trim() ? { lighting: form.lighting.trim() } : {}),
            ...(form.styleNotes.trim() ? { style: form.styleNotes.trim() } : {}),
            palette,
            avoid,
          }
        : undefined;
      const { request } = await http.post<{ request: AssetRequestDto }>(`/api/projects/${projectId}/asset-requests`, {
        kind,
        prompt: form.prompt,
        aspectRatio: form.aspectRatio,
        styleNotes: form.styleNotes,
        purpose: form.purpose,
        sceneId: form.sceneId === "none" ? null : form.sceneId,
        count: form.count,
        ...(brief ? { brief } : {}),
        ...(kind === "video" ? { durationSec: form.durationSec } : {}),
      });
      if (form.sendToClaude) await http.post(`/api/projects/${projectId}/tasks`, { type: "generate_assets", instruction: `Fulfil asset request ${request.id}.` });
      return request;
    },
    onSuccess: (request) => {
      toast.success(form.sendToClaude ? "Request sent to Claude Code" : "Request created", { description: request.id });
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: fail,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New AI {kind} request</DialogTitle>
          <DialogDescription>Claude Code generates {kind === "video" ? "videos" : "images"} with its native generation when it works on the request. Results arrive here for your approval.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="req-prompt">Prompt</Label>
            <Textarea id="req-prompt" rows={4} value={form.prompt} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))} placeholder="Describe the subject, composition, lighting and mood…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Aspect ratio</Label>
              <Select value={form.aspectRatio} onValueChange={(v) => setForm((f) => ({ ...f, aspectRatio: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(new Set([defaultAspect, ...ASPECTS])).map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                      {a === defaultAspect ? " (project)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>For scene</Label>
              <Select value={form.sceneId} onValueChange={(v) => setForm((f) => ({ ...f, sceneId: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No specific scene</SelectItem>
                  {(scenes.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.key} · {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-style">Style notes</Label>
            <Input id="req-style" value={form.styleNotes} onChange={(e) => setForm((f) => ({ ...f, styleNotes: e.target.value }))} placeholder="e.g. cinematic, soft light, brand purple accents" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-purpose">Purpose</Label>
            <Input id="req-purpose" value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} placeholder="How the scene will use it" />
          </div>
          <details className="rounded-lg border border-border p-2.5">
            <summary className="cursor-pointer text-sm">
              Composition brief <span className="text-xs text-muted-foreground">— design the frame before generating</span>
            </summary>
            <div className="mt-2.5 space-y-2.5">
              <Input value={form.composition} onChange={(e) => setForm((f) => ({ ...f, composition: e.target.value }))} placeholder="Composition, e.g. subject in the right third, calm left side" />
              <div className="grid grid-cols-2 gap-2">
                <Select value={form.negativeSpace} onValueChange={(v) => setForm((f) => ({ ...f, negativeSpace: v }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Negative space: any</SelectItem>
                    {REGIONS.filter((r) => r !== "none" && r !== "full").map((r) => (
                      <SelectItem key={r} value={r}>
                        Negative space: {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={form.lighting} onChange={(e) => setForm((f) => ({ ...f, lighting: e.target.value }))} placeholder="Lighting" />
              </div>
              <Input value={form.palette} onChange={(e) => setForm((f) => ({ ...f, palette: e.target.value }))} placeholder="Palette, e.g. #237DD8 #3FE7EF #F5F5F5" />
              <Textarea rows={2} value={form.avoid} onChange={(e) => setForm((f) => ({ ...f, avoid: e.target.value }))} placeholder={"Avoid (one per line), e.g.\nexcessive glow"} />
              <p className="text-[11px] text-muted-foreground">Generation also inherits the project's asset consistency from the creative direction.</p>
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Variations</span>
              {[1, 2, 3, 4].map((n) => (
                <button key={n} type="button" onClick={() => setForm((f) => ({ ...f, count: n }))} className={cn("size-7 rounded-md border text-xs", form.count === n ? "border-primary/60 bg-primary/15" : "border-border text-muted-foreground")}>
                  {n}
                </button>
              ))}
            </div>
            {kind === "video" ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Duration</span>
                <Input className="h-8 w-16" inputMode="decimal" value={form.durationSec} onChange={(e) => setForm((f) => ({ ...f, durationSec: Number(e.target.value) || 5 }))} />s
              </label>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.sendToClaude} onCheckedChange={(v) => setForm((f) => ({ ...f, sendToClaude: v }))} /> Send to Claude Code now
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || form.prompt.trim().length < 3}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Create request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssetRequestsPanel({ projectId, kind }: { projectId: string; kind: "image" | "video" }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const requestsQ = useQuery({
    queryKey: ["project", projectId, "asset-requests"],
    queryFn: async () => (await http.get<{ requests: AssetRequestDto[] }>(`/api/projects/${projectId}/asset-requests`)).requests,
    refetchInterval: 8000,
  });
  const requests = (requestsQ.data ?? []).filter((r) => r.kind === kind);
  const pending = requests.filter((r) => r.status === "requested" || r.status === "generating");
  const review = requests.filter((r) => r.status === "generated");
  const approved = requests.filter((r) => r.status === "approved");
  const closed = requests.filter((r) => r.status === "rejected" || r.status === "cancelled");
  const generateAll = useMutation({
    mutationFn: () => http.post(`/api/projects/${projectId}/tasks`, { type: "generate_assets", instruction: `Fulfil these asset requests: ${pending.filter((r) => r.status === "requested").map((r) => r.id).join(", ")}.` }),
    onSuccess: () => {
      toast.success("Sent to Claude Code");
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: fail,
  });

  const section = (title: string, items: AssetRequestDto[]) =>
    items.length ? (
      <div className="space-y-2">
        <h4 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          {title} ({items.length})
        </h4>
        {items.map((r) => (
          <RequestCard key={r.id} projectId={projectId} request={r} />
        ))}
      </div>
    ) : null;

  return (
    <Panel
      title={`AI ${kind === "video" ? "videos" : "images"}`}
      description="Explicit requests that Claude Code fulfils with its native generation. You decide which result is used — nothing is placed in a scene automatically."
      actions={
        <div className="flex gap-2">
          {pending.some((r) => r.status === "requested") ? (
            <Button size="sm" variant="outline" onClick={() => generateAll.mutate()} disabled={generateAll.isPending}>
              <Sparkles className="text-primary" /> Generate {pending.filter((r) => r.status === "requested").length} with Claude
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> New request
          </Button>
        </div>
      }
    >
      {!requestsQ.data ? (
        <Skeleton className="h-24" />
      ) : requests.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">No {kind} requests yet. Create one, or ask Claude to suggest the {kind === "video" ? "videos" : "images"} your storyboard needs.</p>
      ) : (
        <div className="space-y-5">
          {section("Ready for review", review)}
          {section("Waiting for generation", pending)}
          {section("Approved", approved)}
          {closed.length ? (
            <div>
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowClosed(!showClosed)}>
                {showClosed ? "Hide" : "Show"} rejected & cancelled ({closed.length})
              </button>
              {showClosed ? <div className="mt-2 space-y-2">{closed.map((r) => <RequestCard key={r.id} projectId={projectId} request={r} />)}</div> : null}
            </div>
          ) : null}
        </div>
      )}
      <NewRequestDialog projectId={projectId} kind={kind} open={open} onOpenChange={setOpen} />
    </Panel>
  );
}
