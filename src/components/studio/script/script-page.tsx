"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { diffWords } from "diff";
import { AlertTriangle, ArrowRight, Bot, FileText, GitCompare, History, Import, Loader2, RotateCcw, Save, Sparkles, User, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ScriptAnalysis } from "@/core/spec/analysis";
import { VISUAL_TYPE_LABELS } from "@/core/spec/enums";
import { estimateTiming, parseScript } from "@/core/script/script";
import { formatClock } from "@/core/timing/frames";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { getScriptOverview } from "@/server/services/script";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState } from "../common";

type ScriptOverview = Awaited<ReturnType<typeof getScriptOverview>>;

const SOURCE_BADGE: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  user: { label: "You", icon: <User className="size-3" />, className: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300" },
  claude: { label: "Claude", icon: <Bot className="size-3" />, className: "bg-primary/15 text-primary" },
  file: { label: "File", icon: <FileText className="size-3" />, className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300" },
  import: { label: "Import", icon: <Import className="size-3" />, className: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300" },
  system: { label: "System", icon: <Wand2 className="size-3" />, className: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400" },
};

function SourceBadge({ source }: { source: string }) {
  const s = SOURCE_BADGE[source] ?? SOURCE_BADGE.system;
  return (
    <span className={cn("inline-flex h-4.5 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium", s.className)}>
      {s.icon}
      {s.label}
    </span>
  );
}

function WordDiff({ from, to }: { from: string; to: string }) {
  const parts = useMemo(() => diffWords(from, to), [from, to]);
  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-background/50 p-4 text-sm leading-relaxed whitespace-pre-wrap">
      {parts.map((p, i) => (
        <span key={i} className={cn(p.added && "rounded bg-success/15 text-success", p.removed && "rounded bg-destructive/15 text-destructive line-through")}>
          {p.value}
        </span>
      ))}
    </div>
  );
}

function CompareDialog({ projectId, overview, open, onOpenChange, initialFrom }: { projectId: string; overview: ScriptOverview; open: boolean; onOpenChange: (o: boolean) => void; initialFrom?: number }) {
  const latest = overview.current?.version ?? 1;
  const [from, setFrom] = useState(initialFrom ?? Math.max(1, latest - 1));
  const [to, setTo] = useState(latest);
  useEffect(() => {
    if (open) {
      setFrom(initialFrom ?? Math.max(1, latest - 1));
      setTo(latest);
    }
  }, [open, initialFrom, latest]);
  const fetchRev = (v: number) => http.get<{ revision: { content: string } }>(`/api/projects/${projectId}/script/revisions/${v}`);
  const a = useQuery({ queryKey: ["project", projectId, "script-rev", from], queryFn: () => fetchRev(from), enabled: open });
  const b = useQuery({ queryKey: ["project", projectId, "script-rev", to], queryFn: () => fetchRev(to), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare script revisions</DialogTitle>
          <DialogDescription>Word-level differences. Green was added, red was removed.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-sm">
          <Select value={String(from)} onValueChange={(v) => setFrom(Number(v))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {overview.revisions.map((r) => (
                <SelectItem key={r.version} value={String(r.version)}>
                  v{r.version} {r.note ? `· ${r.note.slice(0, 20)}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ArrowRight className="size-4 text-muted-foreground" />
          <Select value={String(to)} onValueChange={(v) => setTo(Number(v))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {overview.revisions.map((r) => (
                <SelectItem key={r.version} value={String(r.version)}>
                  v{r.version} {r.note ? `· ${r.note.slice(0, 20)}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {a.data && b.data ? <WordDiff from={a.data.revision.content} to={b.data.revision.content} /> : <Skeleton className="h-64" />}
      </DialogContent>
    </Dialog>
  );
}

function AnalysisView({ analysis }: { analysis: ScriptAnalysis }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {analysis.summary} · <span className="text-warning">timing estimated</span>
      </p>
      {analysis.beats.map((beat) => (
        <div key={beat.id} className="rounded-lg border border-border bg-background/40 p-3">
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{beat.kind}</span>
            <span className="truncate text-sm font-medium">{beat.title}</span>
            <span className="ml-auto font-mono text-[10px] text-warning" title="Estimated from word count — not actual timing">
              ~{formatClock(beat.estimatedStart, 1)}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">{beat.text}</p>
          {beat.emphasis.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {beat.emphasis.map((e) => (
                <span key={e} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                  {e}
                </span>
              ))}
            </div>
          ) : null}
          <p className="mt-2 text-xs">
            <span className="text-muted-foreground">Visual · {VISUAL_TYPE_LABELS[beat.suggestedVisualType]}: </span>
            {beat.visualOpportunity}
          </p>
          {beat.assetNeeds.length ? <p className="mt-1 text-xs text-muted-foreground">Assets: {beat.assetNeeds.map((a) => a.description).join("; ")}</p> : null}
        </div>
      ))}
    </div>
  );
}

function BeatsPreview({ content }: { content: string }) {
  const parsed = useMemo(() => parseScript(content), [content]);
  const estimate = useMemo(() => estimateTiming(parsed.spokenParagraphs), [parsed]);
  let spokenIndex = -1;
  return (
    <div className="mx-auto max-w-3xl space-y-3 py-2">
      {parsed.blocks.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to preview yet.</p> : null}
      {parsed.blocks.map((b, i) => {
        if (b.kind !== "spoken") {
          return (
            <div key={i} className={cn("px-3 text-sm", b.kind === "heading" ? "pt-2 font-semibold text-foreground/80" : "text-muted-foreground italic")}>
              {b.raw.replace(/^#+\s*/, "")} <span className="text-[10px] tracking-wide text-muted-foreground/60 uppercase">not spoken</span>
            </div>
          );
        }
        spokenIndex++;
        const p = estimate.paragraphs[spokenIndex];
        return (
          <div key={i} className="flex gap-3 rounded-lg border border-border bg-card p-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[11px] text-muted-foreground">{spokenIndex + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-relaxed">{b.spoken}</p>
              <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                {p?.words} words · <span className="text-warning">estimated</span> {formatClock(p?.start ?? 0, 1)}–{formatClock(p?.end ?? 0, 1)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ScriptPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["project", projectId, "script"],
    queryFn: async () => (await http.get<{ script: ScriptOverview }>(`/api/projects/${projectId}/script`)).script,
  });
  const [content, setContent] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [view, setView] = useState<"write" | "beats">("write");
  const [note, setNote] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareFrom, setCompareFrom] = useState<number | undefined>(undefined);
  const [conflict, setConflict] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const draftKey = `motion-studio:script-draft:${projectId}`;

  // Initialize editor from the server (or a local unsaved draft of the same base version).
  useEffect(() => {
    if (!data || content !== null) return;
    const serverContent = data.current?.content ?? "";
    const serverVersion = data.current?.version ?? 0;
    let initial = serverContent;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as { base: number; content: string };
        if (draft.base === serverVersion && draft.content !== serverContent) {
          initial = draft.content;
          toast.info("Restored your unsaved script draft");
        }
      }
    } catch {
      // ignore corrupt drafts
    }
    setContent(initial);
    setBaseVersion(serverVersion);
  }, [data, content, draftKey]);

  const serverContent = data?.current?.content ?? "";
  const dirty = content !== null && content !== serverContent;
  const remoteChanged = !!data?.current && baseVersion !== null && data.current.version !== baseVersion;

  useEffect(() => {
    if (content === null) return;
    try {
      if (dirty) localStorage.setItem(draftKey, JSON.stringify({ base: baseVersion ?? 0, content }));
      else localStorage.removeItem(draftKey);
    } catch {
      // storage unavailable
    }
  }, [content, dirty, baseVersion, draftKey]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // If the script changed elsewhere (e.g. Claude edited script.md) and we have no local edits, follow it.
  useEffect(() => {
    if (remoteChanged && !dirty && data?.current) {
      setContent(data.current.content);
      setBaseVersion(data.current.version);
      toast.info(`Script updated to v${data.current.version}`);
    }
  }, [remoteChanged, dirty, data]);

  const save = useMutation({
    mutationFn: () => http.post<{ result: { version: number; created: boolean; spokenChanged: boolean } }>(`/api/projects/${projectId}/script`, { content: content ?? "", note: note || undefined, baseVersion }),
    onSuccess: ({ result }) => {
      setNote("");
      setConflict(null);
      setBaseVersion(result.version);
      if (!result.created) toast.info("No changes to save");
      else {
        toast.success(`Saved script v${result.version}`, {
          description: result.spokenChanged && data?.voice ? "The generated voice-over no longer matches the script." : undefined,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "CONFLICT") setConflict(e);
      else toast.error("Could not save the script", { description: errorMessage(e) });
    },
  });

  const analyze = useMutation({
    mutationFn: () => http.post(`/api/projects/${projectId}/script/analyze`),
    onSuccess: () => {
      toast.success("Script analyzed");
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => toast.error("Analysis failed", { description: errorMessage(e) }),
  });

  const restore = useMutation({
    mutationFn: (version: number) => http.post<{ result: { version: number } }>(`/api/projects/${projectId}/script/revisions/${version}`),
    onSuccess: ({ result }, version) => {
      toast.success(`Restored v${version} as v${result.version}`);
      setContent(null);
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => toast.error("Restore failed", { description: errorMessage(e) }),
  });

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !save.isPending) save.mutate();
      }
    },
    [dirty, save],
  );

  const liveEstimate = useMemo(() => {
    if (content === null) return null;
    const parsed = parseScript(content);
    return { words: parsed.wordCount, chars: parsed.spokenText.length, ...estimateTiming(parsed.spokenParagraphs) };
  }, [content]);

  if (error) return <div className="p-6"><ErrorState error={error} onRetry={() => void refetch()} /></div>;
  if (isLoading || !data || content === null) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-[60vh]" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0" onKeyDown={onKeyDown}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
          <div>
            <h1 className="text-base font-semibold">Script</h1>
            <p className="text-xs text-muted-foreground">
              {data.current ? (
                <>
                  v{data.current.version} · saved {relativeTime(data.current.createdAt)} {dirty ? <span className="text-warning">· unsaved changes</span> : null}
                </>
              ) : (
                "Not saved yet"
              )}
            </p>
          </div>
          <ToggleGroup type="single" size="sm" variant="outline" value={view} onValueChange={(v) => v && setView(v as "write" | "beats")} className="ml-4">
            <ToggleGroupItem value="write">Write</ToggleGroupItem>
            <ToggleGroupItem value="beats">Beats preview</ToggleGroupItem>
          </ToggleGroup>
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.md"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (f.size > 2 * 1024 * 1024) return toast.error("Script files must be smaller than 2 MB");
                setContent(await f.text());
                setNote(`Imported ${f.name}`);
                toast.info(`Loaded ${f.name} — review and save to create a revision`);
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <Import /> Import .txt / .md
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)} disabled={data.revisions.length < 2}>
              <GitCompare /> Compare
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" disabled={!dirty || save.isPending}>
                  {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save revision
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate();
                  }}
                >
                  <p className="text-sm font-medium">Save as v{(data.current?.version ?? 0) + 1}</p>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (optional)" maxLength={500} autoFocus />
                  <Button type="submit" size="sm" className="w-full" disabled={save.isPending}>
                    Save revision <span className="ml-1 text-xs opacity-60">Ctrl S</span>
                  </Button>
                </form>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {data.voice?.stale || (dirty && data.voice && data.voice.source !== "import") ? (
          <div className="flex items-center gap-2 border-b border-stale/30 bg-stale/10 px-5 py-2 text-sm">
            <AlertTriangle className="size-4 text-stale" />
            {data.voice.stale
              ? `The voice-over (v${data.voice.version}) was generated from ${data.voice.generatedFromVersion ? `script v${data.voice.generatedFromVersion}` : "an earlier script"}. Regenerate it to match.`
              : "Saving spoken changes will make the generated voice-over out of date."}
            <Button size="xs" variant="outline" className="ml-auto" asChild>
              <Link href={`/projects/${projectId}/voice`}>Open Voice</Link>
            </Button>
          </div>
        ) : null}
        {conflict ? <ErrorState className="m-4" error={conflict} title="Save conflict" onRetry={() => { setContent(null); setConflict(null); void refetch(); }} /> : null}

        <div className="min-h-0 flex-1 overflow-auto">
          {view === "write" ? (
            <div className="mx-auto h-full max-w-3xl px-6 py-6">
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={"# Optional heading (not spoken)\n\nRunning a business shouldn't feel this complicated.\n\n[Music swells — stage directions in brackets are not spoken]\n\nMost teams juggle five different tools. That's why we built **one platform**."}
                className="min-h-[65vh] resize-none rounded-xl border border-border bg-card px-7 py-6 text-[15px] leading-7 shadow-none focus-visible:border-primary/40 focus-visible:ring-0 dark:bg-card"
                aria-label="Script editor"
              />
            </div>
          ) : (
            <div className="px-6 py-4">
              <BeatsPreview content={content} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-border px-5 py-2 text-xs text-muted-foreground">
          <span>{liveEstimate?.words ?? 0} words</span>
          <span>{liveEstimate?.chars ?? 0} spoken characters</span>
          <span>{liveEstimate?.paragraphs.length ?? 0} paragraphs</span>
          <span>
            <span className="text-warning">Estimated</span> {formatClock(liveEstimate?.duration ?? 0, 0)} at 150 wpm
          </span>
          <span className="ml-auto">Headings (#) and [directions] are not spoken · **bold** marks emphasis</span>
        </div>
      </div>

      <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-panel">
        <Tabs defaultValue="analysis" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="m-3 grid grid-cols-2">
            <TabsTrigger value="analysis">
              <Sparkles /> Analysis
            </TabsTrigger>
            <TabsTrigger value="revisions">
              <History /> Revisions
            </TabsTrigger>
          </TabsList>
          <TabsContent value="analysis" className="min-h-0 flex-1 overflow-auto px-3 pb-4">
            <div className="mb-3 flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => analyze.mutate()} disabled={analyze.isPending || !data.current || dirty}>
                {analyze.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} Quick analysis
              </Button>
              <span className="text-xs text-muted-foreground">{dirty ? "Save first" : data.current?.analysisSource ? `${data.current.analysisSource} · ${relativeTime(data.current.analyzedAt!)}` : "Rule-based, instant"}</span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              For deeper creative analysis, use <strong>Ask Claude</strong> (top right) — “Analyze the script”. All timing here is estimated; actual timing comes from the voice-over.
            </p>
            {data.current?.analysis ? (
              <AnalysisView analysis={data.current.analysis} />
            ) : (
              <EmptyState icon={<Sparkles />} title="No analysis yet" description="Identify beats, key statements, emphasis words and visual opportunities." />
            )}
          </TabsContent>
          <TabsContent value="revisions" className="min-h-0 flex-1 overflow-auto px-3 pb-4">
            {data.revisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No revisions yet.</p>
            ) : (
              <ol className="space-y-2">
                {data.revisions.map((r) => (
                  <li key={r.version} className="rounded-lg border border-border bg-background/40 p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">v{r.version}</span>
                      <SourceBadge source={r.source} />
                      {r.version === data.current?.version ? <span className="text-[10px] text-success">current</span> : null}
                      <span className="ml-auto text-[11px] text-muted-foreground">{relativeTime(r.createdAt)}</span>
                    </div>
                    {r.note ? <p className="mt-1 text-xs text-muted-foreground">{r.note}</p> : null}
                    <div className="mt-2 flex gap-1">
                      {r.version !== data.current?.version ? (
                        <>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                              setCompareFrom(r.version);
                              setCompareOpen(true);
                            }}
                          >
                            <GitCompare /> Diff
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => restore.mutate(r.version)} disabled={restore.isPending || dirty}>
                            <RotateCcw /> Restore
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>
        </Tabs>
      </aside>

      <CompareDialog projectId={projectId} overview={data} open={compareOpen} onOpenChange={(o) => { setCompareOpen(o); if (!o) setCompareFrom(undefined); }} initialFrom={compareFrom} />
      <DialogFooter className="hidden" />
    </div>
  );
}
