"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { toast } from "sonner";
import type { ScriptBeat } from "@/core/spec/analysis";
import { VISUAL_TYPE_LABELS } from "@/core/spec/enums";
import type { Segment } from "@/core/spec/timing";
import { formatClock } from "@/core/timing/frames";
import { normalizeWord, splitSentences, tokenize } from "@/core/util/text";
import type { getScriptOverview } from "@/server/services/script";
import type { getTimelineView } from "@/server/services/timeline";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, http } from "@/lib/api-client";
import { EmptyState, ErrorState } from "../common";

type ScriptOverview = Awaited<ReturnType<typeof getScriptOverview>>;
type TimelineView = Awaited<ReturnType<typeof getTimelineView>>;

const norm = (text: string) =>
  tokenize(text)
    .map((t) => t.norm)
    .join(" ");

/** Finds the actual timeline span of a beat by matching its sentences to timeline segments. */
function actualSpan(beat: ScriptBeat, sentences: Segment[]): { start: number; end: number } | null {
  const beatSentences = splitSentences(beat.text).map(norm).filter(Boolean);
  if (!beatSentences.length || !sentences.length) return null;
  const normalized = sentences.map((s) => norm(s.text));
  const firstWords = beatSentences[0].split(" ").slice(0, 5).join(" ");
  const lastWords = beatSentences[beatSentences.length - 1].split(" ").slice(-5).join(" ");
  const first = normalized.findIndex((s) => s.includes(firstWords) || firstWords.includes(s.split(" ").slice(0, 5).join(" ")));
  if (first < 0) return null;
  let last = first;
  for (let i = first; i < normalized.length && i < first + beatSentences.length + 2; i++) {
    if (normalized[i].includes(lastWords)) {
      last = i;
      break;
    }
  }
  return { start: sentences[first].start, end: sentences[last].end };
}

export function BeatsPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const script = useQuery({
    queryKey: ["project", projectId, "script"],
    queryFn: async () => (await http.get<{ script: ScriptOverview }>(`/api/projects/${projectId}/script`)).script,
  });
  const timeline = useQuery({
    queryKey: ["project", projectId, "timeline"],
    queryFn: async () => (await http.get<{ timeline: TimelineView }>(`/api/projects/${projectId}/timeline`)).timeline,
  });
  const analyze = useMutation({
    mutationFn: () => http.post(`/api/projects/${projectId}/script/analyze`),
    onSuccess: () => {
      toast.success("Script analyzed");
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => toast.error("Analysis failed", { description: errorMessage(e) }),
  });

  const analysis = script.data?.current?.analysis ?? null;
  const sentences = timeline.data?.timeline?.data.sentences ?? [];
  const spans = useMemo(() => (analysis ? analysis.beats.map((b) => actualSpan(b, sentences)) : []), [analysis, sentences]);

  if (script.error) return <div className="p-6"><ErrorState error={script.error} onRetry={() => void script.refetch()} /></div>;
  if (!script.data || timeline.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Beats</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Narrative beats from the script. <span className="text-warning">Estimated</span> timing comes from word counts; <span className="text-success">Actual</span> timing comes from the aligned voice-over.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => analyze.mutate()} disabled={analyze.isPending || !script.data.current}>
            {analyze.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} {analysis ? "Re-run quick analysis" : "Quick analysis"}
          </Button>
        </div>
      </div>

      {!script.data.current ? (
        <EmptyState title="No script yet" description="Beats are derived from the script." action={<Button size="sm" asChild><Link href={`/projects/${projectId}/script`}>Open Script</Link></Button>} />
      ) : !analysis ? (
        <EmptyState icon={<Sparkles />} title="Not analyzed yet" description="Run the quick analysis, or ask Claude for a deeper creative analysis (Ask Claude → “Analyze the script”)." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-normal">Beat</th>
                <th className="px-4 py-2.5 font-normal">Visual opportunity</th>
                <th className="w-32 px-4 py-2.5 font-normal text-warning">Estimated</th>
                <th className="w-32 px-4 py-2.5 font-normal text-success">Actual</th>
              </tr>
            </thead>
            <tbody>
              {analysis.beats.map((beat, i) => {
                const span = spans[i];
                return (
                  <tr key={beat.id} className="border-t border-border align-top">
                    <td className="max-w-md px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{beat.kind}</span>
                        <span className="font-medium">{beat.title}</span>
                      </div>
                      <p className="mt-1.5 text-muted-foreground">{beat.text}</p>
                      {beat.emphasis.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {beat.emphasis.map((e) => (
                            <span key={e} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                              {e}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-muted-foreground">{VISUAL_TYPE_LABELS[beat.suggestedVisualType]}</p>
                      <p className="mt-0.5">{beat.visualOpportunity}</p>
                      {beat.suggestedAnimation.length ? <p className="mt-1 text-xs text-muted-foreground">{beat.suggestedAnimation.join(" · ")}</p> : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-warning">
                      ~{formatClock(beat.estimatedStart, 1)}–{formatClock(beat.estimatedEnd, 1)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {span ? (
                        <span className="text-success">
                          {formatClock(span.start, 2)}–{formatClock(span.end, 2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{sentences.length ? "not matched" : "no timeline"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {analysis && !sentences.length ? (
        <p className="text-xs text-muted-foreground">
          Actual timing appears once the voice-over is aligned.{" "}
          <Link href={`/projects/${projectId}/voice`} className="text-primary hover:underline">
            Open Voice
          </Link>
        </p>
      ) : null}
      {normalizeWord("") ? null : null}
    </div>
  );
}
