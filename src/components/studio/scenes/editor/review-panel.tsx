"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { SceneMetrics } from "@/core/creative/metrics";
import type { StoryAct } from "@/core/creative/schema";
import { VISUAL_TYPE_LABELS, VISUAL_TYPES, type VisualType } from "@/core/spec/enums";
import { validateSceneSpec } from "@/core/spec/scene";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SceneDto } from "@/server/services/scenes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "../../common";
import { SceneIntentPanel } from "../../creative/scene-intent-panel";

/**
 * The review side of the scene editor: creative intent with the measured Creative QA findings, the
 * storyboard fields, the raw scene spec and the scene's versions. Reviewing never changes the video;
 * each tab saves only what you edit in it.
 */

export type ReviewTab = "intent" | "storyboard" | "spec" | "versions";

const TABS: { id: ReviewTab; label: string }[] = [
  { id: "intent", label: "Intent & QA" },
  { id: "storyboard", label: "Storyboard" },
  { id: "spec", label: "Spec" },
  { id: "versions", label: "Versions" },
];

interface SceneVersion {
  version: number;
  source: string;
  message: string;
  createdAt: string;
  name: string;
  onScreenText: string;
  visualConcept: string;
  elements: number;
  startSec: number;
}

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

function useInvalidate(projectId: string) {
  const queryClient = useQueryClient();
  return useCallback(() => void queryClient.invalidateQueries({ queryKey: ["project", projectId] }), [queryClient, projectId]);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function CreativeForm({ projectId, scene }: { projectId: string; scene: SceneDto }) {
  const invalidate = useInvalidate(projectId);
  const initial = useCallback(
    () => ({ name: scene.name, visualType: scene.visualType as VisualType, visualConcept: scene.visualConcept, onScreenText: scene.onScreenText, notes: scene.notes, animationNotes: scene.animationNotes.join("\n") }),
    [scene],
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial()), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial());
  const save = useMutation({
    mutationFn: () =>
      http.patch(`/api/projects/${projectId}/scenes/${scene.id}`, {
        name: form.name.trim(),
        visualType: form.visualType,
        visualConcept: form.visualConcept,
        onScreenText: form.onScreenText,
        notes: form.notes,
        animationNotes: form.animationNotes
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success(`${scene.key} saved`);
      invalidate();
    },
    onError: fail,
  });
  const locked = scene.locked;
  return (
    <div className="space-y-3">
      <Field label="Name">
        <Input disabled={locked} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="Voice-over (from the audio — read-only)">
        <div className="rounded-md border border-border bg-muted/30 p-2.5 text-sm">
          “{scene.voiceText}”
          <div className="mt-1.5 font-mono text-[10px] text-muted-foreground">
            {scene.wordStart !== null && scene.wordEnd !== null ? `words ${scene.wordStart}–${scene.wordEnd - 1}` : "no word anchors"} · {scene.timingMode === "audio_locked" ? "audio-locked" : "user-adjusted"}
          </div>
        </div>
      </Field>
      <Field label="Visual type">
        <Select value={form.visualType} onValueChange={(v) => setForm((f) => ({ ...f, visualType: v as VisualType }))} disabled={locked}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VISUAL_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {VISUAL_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Visual concept">
        <Textarea rows={4} disabled={locked} value={form.visualConcept} onChange={(e) => setForm((f) => ({ ...f, visualConcept: e.target.value }))} />
      </Field>
      <Field label="On-screen text">
        <Input disabled={locked} value={form.onScreenText} onChange={(e) => setForm((f) => ({ ...f, onScreenText: e.target.value }))} />
      </Field>
      <Field label="Animation notes (one per line)">
        <Textarea rows={3} disabled={locked} value={form.animationNotes} onChange={(e) => setForm((f) => ({ ...f, animationNotes: e.target.value }))} />
      </Field>
      <Field label="Notes">
        <Textarea rows={3} disabled={locked} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </Field>
      {scene.assetsRequired.length ? (
        <Field label="Assets required">
          <ul className="space-y-1 text-xs">
            {scene.assetsRequired.map((a, i) => (
              <li key={i} className="flex items-center gap-2 rounded border border-border px-2 py-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {a.kind}
                </Badge>
                <span className="truncate">{a.description}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{a.assetId ? "linked" : a.requestId ? "requested" : "missing"}</span>
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" disabled={!dirty || locked || save.isPending || !form.name.trim()} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="animate-spin" /> : null} Save
        </Button>
        <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setForm(initial())}>
          Reset
        </Button>
        {scene.status === "approved" ? <span className="text-[11px] text-muted-foreground">Saving resets approval.</span> : null}
      </div>
    </div>
  );
}

function SpecEditor({ projectId, scene, text, onText }: { projectId: string; scene: SceneDto; text: string | null; onText: (text: string | null) => void }) {
  const invalidate = useInvalidate(projectId);
  const saved = useMemo(() => JSON.stringify(scene.spec, null, 2), [scene.spec]);
  const value = text ?? saved;
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, json: JSON.parse(value) as unknown };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [value]);
  const validation = useMemo(() => (parsed.ok ? validateSceneSpec(parsed.json) : null), [parsed]);
  const dirty = text !== null && text !== saved;
  const apply = useMutation({
    mutationFn: () => http.patch(`/api/projects/${projectId}/scenes/${scene.id}`, { spec: parsed.ok ? parsed.json : null }),
    onSuccess: () => {
      toast.success(`${scene.key} spec applied`, { description: "A new scene version was saved." });
      onText(null);
      invalidate();
    },
    onError: fail,
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        {!parsed.ok ? (
          <span className="truncate text-destructive">JSON error: {parsed.error}</span>
        ) : validation && !validation.ok ? (
          <span className="text-destructive">
            {validation.issues.length} spec issue{validation.issues.length === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-success">
            Valid · {validation?.ok ? validation.spec.elements.length : 0} elements{dirty ? " · previewing unsaved changes" : ""}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <Button size="xs" variant="ghost" disabled={!parsed.ok || scene.locked} onClick={() => parsed.ok && onText(JSON.stringify(parsed.json, null, 2))}>
            Format
          </Button>
          <Button size="xs" variant="ghost" disabled={!dirty} onClick={() => onText(null)}>
            Revert
          </Button>
        </div>
      </div>
      <Textarea
        spellCheck={false}
        disabled={scene.locked}
        value={value}
        onChange={(e) => onText(e.target.value)}
        className="field-sizing-fixed min-h-[240px] flex-1 resize-none font-mono text-[11.5px] leading-relaxed"
        aria-label="Scene spec JSON"
      />
      {validation && !validation.ok ? (
        <ul className="scrollbar-thin max-h-28 space-y-0.5 overflow-auto text-[11px] text-destructive">
          {validation.issues.slice(0, 12).map((issue, k) => (
            <li key={k}>
              <span className="font-mono">{issue.path || "(root)"}</span> {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!dirty || !validation?.ok || scene.locked || apply.isPending} onClick={() => apply.mutate()}>
          {apply.isPending ? <Loader2 className="animate-spin" /> : null} Apply spec
        </Button>
        <span className="text-[11px] text-muted-foreground">x/y: % of frame · sizes: u (px at a 1080 short edge) · reference in REMOTION.md</span>
      </div>
    </div>
  );
}

function VersionsPanel({ projectId, scene }: { projectId: string; scene: SceneDto }) {
  const invalidate = useInvalidate(projectId);
  const q = useQuery({
    queryKey: ["project", projectId, "scene-versions", scene.id],
    queryFn: async () => (await http.get<{ versions: SceneVersion[] }>(`/api/projects/${projectId}/scenes/${scene.id}/versions`)).versions,
  });
  const restore = useMutation({
    mutationFn: (version: number) => http.post(`/api/projects/${projectId}/scenes/${scene.id}/versions/${version}/restore`, { keepTiming: true }),
    onSuccess: (_d, version) => {
      toast.success(`Restored ${scene.key} v${version}`, { description: "Timing was kept; the restore is itself a new version." });
      invalidate();
    },
    onError: fail,
  });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Skeleton className="h-40" />;
  return (
    <ul className="space-y-2">
      {q.data.map((v) => (
        <li key={v.version} className={cn("rounded-lg border px-3 py-2 text-sm", v.version === scene.version ? "border-primary/50 bg-primary/5" : "border-border bg-card")}>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs">v{v.version}</span>
            <Badge variant="outline" className="text-[10px] capitalize">
              {v.source}
            </Badge>
            <span className="ml-auto text-xs text-muted-foreground">{relativeTime(v.createdAt)}</span>
          </div>
          <p className="mt-1 truncate">{v.name}</p>
          {v.message ? <p className="text-xs text-muted-foreground">{v.message}</p> : null}
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{v.elements} elements</span>
            {v.version === scene.version ? (
              <span className="ml-auto text-primary">Current</span>
            ) : (
              <Button size="xs" variant="outline" className="ml-auto" disabled={scene.locked || restore.isPending} onClick={() => restore.mutate(v.version)}>
                Restore
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReviewPanel({
  projectId,
  scene,
  metrics,
  acts,
  onAskClaude,
  tab,
  onTab,
  specText,
  onSpecText,
}: {
  projectId: string;
  scene: SceneDto;
  metrics: SceneMetrics | undefined;
  acts: StoryAct[];
  onAskClaude: () => void;
  tab: ReviewTab;
  onTab: (tab: ReviewTab) => void;
  /** Unsaved spec text for this scene (previewed in the player), or null. */
  specText: string | null;
  onSpecText: (text: string | null) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Review" className="flex shrink-0 items-center gap-0.5 border-b border-border px-2 py-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
            className={cn("rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors", tab === t.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {t.label}
            {t.id === "intent" && metrics?.findings.length ? <span className="ml-1 rounded-full bg-warning/20 px-1.5 text-[10px] text-warning">{metrics.findings.length}</span> : null}
            {t.id === "spec" && specText !== null ? <span className="ml-1 text-warning">•</span> : null}
          </button>
        ))}
      </div>
      {tab === "intent" ? (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
          <SceneIntentPanel projectId={projectId} scene={scene} metrics={metrics} acts={acts} onAskClaude={onAskClaude} />
        </div>
      ) : tab === "storyboard" ? (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
          <CreativeForm projectId={projectId} scene={scene} />
        </div>
      ) : tab === "spec" ? (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <SpecEditor projectId={projectId} scene={scene} text={specText} onText={onSpecText} />
        </div>
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
          <VersionsPanel projectId={projectId} scene={scene} />
        </div>
      )}
    </div>
  );
}
