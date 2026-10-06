"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHealth } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Wordmark } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export function HealthIndicator({ compact }: { compact?: boolean }) {
  const { data: health, isError } = useHealth();
  const dbOk = !!health?.database.ok && !isError;
  const workerOk = !!health?.worker.online;
  const ok = dbOk && workerOk;
  const label = !health && !isError ? "Checking…" : !dbOk ? "Database offline" : !workerOk ? "Worker offline" : "All systems ready";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href="/settings#system" className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <span className={cn("size-2 rounded-full", !health && !isError ? "bg-zinc-500" : ok ? "bg-success" : dbOk ? "bg-warning" : "bg-destructive")} />
          {compact ? null : label}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-1 text-xs">
          <div>Database: {dbOk ? "connected" : health?.database.error ?? "unreachable"}</div>
          <div>Worker: {workerOk ? "online" : "offline — jobs (voice, alignment, renders) will wait until it runs"}</div>
          <div>FFmpeg: {health?.ffmpeg.ok ? "ready" : "missing"}</div>
          <div>Claude Code CLI: {health?.claudeCli.found ? health.claudeCli.version ?? "found" : "not found"}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const nav = [
    { href: "/", label: "Projects", active: pathname === "/" },
    { href: "/settings", label: "Settings", active: pathname.startsWith("/settings") },
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-panel/90 backdrop-blur">
      <div className="mx-auto flex h-13 max-w-[1480px] items-center gap-6 px-6">
        <Link href="/" className="shrink-0">
          <Wordmark className="text-[15px]" />
        </Link>
        <nav className="flex items-center gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn("rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground", item.active && "bg-muted text-foreground")}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <HealthIndicator />
          <ThemeToggle />
          <Button asChild size="sm">
            <Link href="/new">
              <Plus /> New project
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
