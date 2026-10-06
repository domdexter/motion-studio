"use client";

import { AlertTriangle, RotateCw, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, description, actions, children, className, bodyClassName }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      {title || actions ? (
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-medium">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div> : null}
      <h3 className="text-sm font-medium">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, title = "Something went wrong", onRetry, className }: { error: unknown; title?: string; onRetry?: () => void; className?: string }) {
  const apiError = error instanceof ApiError ? error : null;
  return (
    <div className={cn("rounded-xl border border-destructive/30 bg-destructive/5 p-4", className)} role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive">{title}</p>
          <p className="mt-1 text-sm text-foreground/90">{errorMessage(error)}</p>
          {apiError?.hint ? <p className="mt-1 text-xs text-muted-foreground">{apiError.hint}</p> : null}
          {apiError?.details ? (
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Error details</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] whitespace-pre-wrap">
                {typeof apiError.details === "string" ? apiError.details : JSON.stringify(apiError.details, null, 2)}
              </pre>
            </details>
          ) : null}
          {onRetry || apiError?.action ? (
            <div className="mt-3 flex gap-2">
              {onRetry ? (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  <RotateCw /> Retry
                </Button>
              ) : null}
              {apiError?.action ? (
                <Button size="sm" variant="secondary" asChild>
                  <Link href={apiError.action.href}>{apiError.action.label}</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

export function Dropzone({
  accept,
  multiple,
  onFiles,
  label,
  hint,
  className,
  disabled,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const handle = useCallback(
    (list: FileList | null) => {
      if (!list || disabled) return;
      const files = Array.from(list);
      onFiles(multiple ? files : files.slice(0, 1));
    },
    [disabled, multiple, onFiles],
  );
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/5",
        over && "border-primary bg-primary/10",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <Upload className="size-4 text-muted-foreground" />
      <div className="text-sm">{label}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      <input ref={input} type="file" className="hidden" accept={accept} multiple={multiple} onChange={(e) => handle(e.target.files)} />
    </div>
  );
}

/** A frame with the project's aspect ratio, letterboxed inside its container. */
export function FormatFrame({ width, height, className, children, style }: { width: number; height: number; className?: string; children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className={cn("relative flex size-full items-center justify-center", className)}>
      <div className="relative max-h-full max-w-full overflow-hidden rounded-[3px] shadow-lg shadow-black/40" style={{ aspectRatio: `${width} / ${height}`, height: width >= height ? "auto" : "100%", width: width >= height ? "100%" : "auto", ...style }}>
        {/* Absolutely placed so a picture's own size never stretches the frame (tall 9:16 thumbnails). */}
        <div className="absolute inset-0">{children}</div>
      </div>
    </div>
  );
}
