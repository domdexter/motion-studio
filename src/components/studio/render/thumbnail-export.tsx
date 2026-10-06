"use client";

import { useMutation } from "@tanstack/react-query";
import { Download, ImagePlus, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import type { PublicJob } from "@/server/jobs/queue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useJob } from "../workspace/use-job";

/** YouTube thumbnail builder: pick a moment of the video, write a title and a tag, render a 1280×720 JPEG. */
export function ThumbnailExport({ projectId, durationSec, disabled }: { projectId: string; durationSec: number; disabled?: boolean }) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [sec, setSec] = useState("");
  const [layout, setLayout] = useState<"left" | "center" | "bottom">("left");
  const [darken, setDarken] = useState(0.55);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; downloadUrl: string } | null>(null);
  const job = useJob(jobId, (j) => {
    if (j.status === "succeeded") {
      setResult(j.result as { url: string; downloadUrl: string });
      toast.success("Thumbnail ready");
    } else if (j.status === "failed") toast.error(j.error?.message ?? "Thumbnail failed");
  });
  const start = useMutation({
    mutationFn: () => {
      const at = sec.trim() === "" ? undefined : Number(sec);
      return http.post<{ job: PublicJob }>(`/api/projects/${projectId}/exports/thumbnail`, { title: title.trim(), ...(subtitle.trim() ? { subtitle: subtitle.trim() } : {}), ...(at !== undefined && Number.isFinite(at) ? { sec: at } : {}), layout, darken });
    },
    onSuccess: (d) => {
      setResult(null);
      setJobId(d.job.id);
    },
    onError: (e) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined }),
  });
  const busy = start.isPending || job.active;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ImagePlus className="size-4 text-muted-foreground" /> YouTube thumbnail
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Title (keep it short)</Label>
          <Input value={title} maxLength={60} placeholder="Stop typing." onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Tag (optional)</Label>
          <Input value={subtitle} maxLength={40} placeholder="FREE AI DICTATION" onChange={(e) => setSubtitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Frame at (s)</Label>
          <Input value={sec} inputMode="decimal" className="font-mono" placeholder={`${(durationSec * 0.35).toFixed(1)} (35%)`} onChange={(e) => setSec(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Text position</Label>
          <Select value={layout} onValueChange={(v) => setLayout(v as typeof layout)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="center">Centre</SelectItem>
              <SelectItem value="bottom">Bottom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Darken behind the text {Math.round(darken * 100)}%</Label>
          <Slider className="py-2" min={0} max={0.85} step={0.05} value={[darken]} onValueChange={([v]) => setDarken(v)} aria-label="Darken" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => start.mutate()} disabled={disabled || busy || !title.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />} {busy ? "Rendering…" : "Make thumbnail"}
        </Button>
        {result ? (
          <Button size="sm" variant="outline" asChild>
            <a href={result.downloadUrl}>
              <Download /> Save JPEG
            </a>
          </Button>
        ) : null}
      </div>
      {result ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={result.url} alt="Thumbnail preview" className="w-full rounded-md border border-border" />
      ) : (
        <p className="text-[11px] text-muted-foreground">Uses the design&apos;s heading font and accent colour. A face or a clear subject in the frame makes it stronger.</p>
      )}
    </div>
  );
}
