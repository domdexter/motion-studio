"use client";

import { FileArchive } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { uploadForm } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import { Dropzone, ErrorState } from "../common";

export function ImportPackageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reset = () => {
    setFile(null);
    setProgress(null);
    setError(null);
  };

  const submit = async () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.append("package", file);
    try {
      const res = await uploadForm<{ id: string }>("/api/projects/import", form, setProgress);
      toast.success("Project imported");
      onOpenChange(false);
      reset();
      router.push(`/projects/${res.id}`);
    } catch (err) {
      setError(err);
      setProgress(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open an existing project</DialogTitle>
          <DialogDescription>Import a Motion Studio project package (.zip) exported from this or another machine. It becomes a new project in your library.</DialogDescription>
        </DialogHeader>
        {file ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <FileArchive className="size-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            {progress === null ? (
              <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
                Change
              </Button>
            ) : null}
          </div>
        ) : (
          <Dropzone accept=".zip" onFiles={(f) => setFile(f[0] ?? null)} label="Drop a project package here, or click to browse" hint=".zip exported from Motion Studio" />
        )}
        {progress !== null ? (
          <div className="space-y-1">
            <Progress value={Math.round(progress * 100)} />
            <p className="text-xs text-muted-foreground">{progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Unpacking and importing…"}</p>
          </div>
        ) : null}
        {error ? <ErrorState error={error} title="Import failed" /> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!file || progress !== null}>
            Import project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
