"use client";

import { ArrowRight, FolderOpen, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Workflow } from "@/core/spec/enums";
import { PRODUCTION_STATUSES, STATUS_LABELS } from "@/core/status/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDebouncedValue, useProjects, type ProjectsQuery } from "@/lib/hooks";
import { AppHeader } from "../app-header";
import { EmptyState, ErrorState } from "../common";
import { WorkflowChooser } from "../workflow-chooser";
import { ImportPackageDialog } from "./import-package-dialog";
import { ProjectCard } from "./project-card";

function FirstRun() {
  const router = useRouter();
  const [choice, setChoice] = useState<Workflow | null>("script_only");
  const [importOpen, setImportOpen] = useState(false);
  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <p className="text-xs font-medium tracking-wider text-primary uppercase">Welcome to Motion Studio</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Create your first project</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Motion Studio builds animated videos on the real timing of your voice-over — you stay the creative director, Claude Code does the heavy lifting.
        Start from whatever you already have.
      </p>
      <h2 className="mt-10 mb-4 text-sm font-medium">What do you have?</h2>
      <WorkflowChooser value={choice} onChange={setChoice} />
      <div className="mt-8 flex items-center gap-3">
        <Button
          size="lg"
          disabled={!choice}
          onClick={() => {
            if (choice === "imported") setImportOpen(true);
            else if (choice) router.push(`/new?workflow=${choice}`);
          }}
        >
          Continue <ArrowRight />
        </Button>
        <Button size="lg" variant="ghost" asChild>
          <Link href="/new?workflow=blank">Start blank</Link>
        </Button>
      </div>
      <ImportPackageDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

export function Dashboard() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<NonNullable<ProjectsQuery["filter"]>>("active");
  const [sort, setSort] = useState<NonNullable<ProjectsQuery["sort"]>>("updated");
  const [status, setStatus] = useState<string>("all");
  const [importOpen, setImportOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 250);
  const { data, isLoading, error, refetch, isFetching } = useProjects({ search: debouncedSearch || undefined, filter, sort, status: status === "all" ? undefined : status });

  const firstRun = data && data.counts.total === 0;
  const filtersActive = !!debouncedSearch || status !== "all" || filter !== "active";

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      {firstRun ? (
        <FirstRun />
      ) : (
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {data ? `${data.counts.active} active · ${data.counts.archived} archived` : "Loading…"}
                {isFetching && data ? <span className="ml-2 text-muted-foreground/60">Refreshing…</span> : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <FolderOpen /> Import package
              </Button>
              <Button size="sm" asChild>
                <Link href="/new">
                  <Plus /> New project
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects" className="pl-8" aria-label="Search projects" />
              {search ? (
                <button type="button" onClick={() => setSearch("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as typeof filter)} variant="outline" size="sm">
              <ToggleGroupItem value="active">Active</ToggleGroupItem>
              <ToggleGroupItem value="archived">Archived</ToggleGroupItem>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
            </ToggleGroup>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger size="sm" className="w-44" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {PRODUCTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger size="sm" className="ml-auto w-44" aria-label="Sort projects">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">Last modified</SelectItem>
                <SelectItem value="created">Date created</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-6">
            {error ? (
              <ErrorState error={error} title="Could not load projects" onRetry={() => void refetch()} />
            ) : isLoading ? (
              <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(270px,1fr))]">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-[300px] rounded-xl" />
                ))}
              </div>
            ) : data && data.projects.length === 0 ? (
              <EmptyState
                icon={<Search />}
                title={filtersActive ? "No projects match these filters" : "No active projects"}
                description={filtersActive ? "Try a different search or filter." : "Archived projects are hidden. Create a new project to get started."}
                action={
                  filtersActive ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearch("");
                        setStatus("all");
                        setFilter("active");
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : (
                    <Button size="sm" asChild>
                      <Link href="/new">New project</Link>
                    </Button>
                  )
                }
              />
            ) : (
              <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(270px,1fr))]">
                {data?.projects.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            )}
          </div>
        </main>
      )}
      <ImportPackageDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
