"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutTemplate, Loader2, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SceneTemplateDto } from "@/server/services/scene-templates";
import type { SceneDto } from "@/server/services/scenes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Scene templates: apply a title card, end screen or lower third (or a template you saved) to the
 * current scene, and save this scene, or some of its elements, as a template for any project.
 */

const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

export function SceneTemplatesButton({ projectId, scene, getSceneSec, compact = false }: { projectId: string; scene: SceneDto; getSceneSec: () => number; /** Icon only (narrow toolbars). */ compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={compact ? "icon-sm" : "sm"} variant="outline" disabled={scene.locked} onClick={() => setOpen(true)} aria-label="Scene templates" title="Insert a title card, lower third or end screen, or save this scene as a template">
        <LayoutTemplate />
        {compact ? null : "Templates"}
      </Button>
      {open ? <SceneTemplatesDialog projectId={projectId} scene={scene} getSceneSec={getSceneSec} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SceneTemplatesDialog({ projectId, scene, getSceneSec, onClose }: { projectId: string; scene: SceneDto; getSceneSec: () => number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: ["scene-templates"], queryFn: async () => (await http.get<{ templates: SceneTemplateDto[] }>("/api/scene-templates")).templates });
  const [tab, setTab] = useState<"apply" | "save">("apply");
  const [selectedId, setSelectedId] = useState<string>("builtin:lower-third");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [atSec, setAtSec] = useState(() => Math.max(0, Math.min(scene.durationSec - 1, Math.round(getSceneSec() * 10) / 10)).toString());
  const [lengthSec, setLengthSec] = useState("4");
  const [side, setSide] = useState<"left" | "right">("left");
  const selected = templates.data?.find((t) => t.id === selectedId) ?? null;

  const apply = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a template");
      const at = Number(atSec);
      const length = Number(lengthSec);
      return http.put(`/api/projects/${projectId}/scenes/${scene.id}/template`, {
        templateId: selected.id,
        fields,
        ...(selected.kind === "elements" ? { ...(Number.isFinite(at) ? { atSec: Math.max(0, at) } : {}), ...(Number.isFinite(length) && length >= 1 ? { durationSec: length } : {}), side } : {}),
      });
    },
    onSuccess: () => {
      toast.success(selected?.kind === "elements" ? `Added ${selected.name} to ${scene.key}` : `${scene.key} now uses ${selected?.name}`, { description: "Press Ctrl+Z to undo." });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      onClose();
    },
    onError: fail,
  });

  const [name, setName] = useState(scene.name);
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const elements = scene.spec?.elements ?? [];
  const save = useMutation({
    mutationFn: () => http.post<{ template: SceneTemplateDto }>(`/api/projects/${projectId}/scenes/${scene.id}/template`, { name, description, ...(picked.size ? { elementIds: [...picked] } : {}) }),
    onSuccess: (res) => {
      toast.success(`Saved template “${res.template.name}”`, { description: res.template.fileCount ? `${res.template.fileCount} media file(s) saved with it.` : undefined });
      void queryClient.invalidateQueries({ queryKey: ["scene-templates"] });
      setTab("apply");
      setSelectedId(res.template.id);
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => http.delete(`/api/scene-templates/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["scene-templates"] }),
    onError: fail,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Scene templates</DialogTitle>
          <DialogDescription>Use a ready-made design on {scene.key}, or save this scene to reuse in any project.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1.5">
          <Button size="xs" variant={tab === "apply" ? "secondary" : "ghost"} onClick={() => setTab("apply")}>
            Use a template
          </Button>
          <Button size="xs" variant={tab === "save" ? "secondary" : "ghost"} onClick={() => setTab("save")}>
            Save this scene
          </Button>
        </div>

        {tab === "apply" ? (
          <div className="space-y-3">
            {templates.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.data?.map((t) => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedId(t.id);
                    setFields({});
                  }}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedId(t.id)}
                  className={cn("rounded-md border border-border p-2.5 text-left text-xs hover:bg-muted/50", t.id === selectedId && "border-primary ring-1 ring-primary")}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{t.name}</span>
                    <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{t.builtin ? "Built-in" : t.kind === "elements" ? `${t.elementCount} element(s)` : "Scene"}</span>
                    {!t.builtin ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="ml-auto"
                        aria-label={`Delete ${t.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete the template “${t.name}”? Scenes that used it keep their design.`)) remove.mutate(t.id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-muted-foreground">{t.description || (t.sourceSceneKey ? `Saved from ${t.sourceSceneKey}` : "")}</p>
                </div>
              ))}
            </div>

            {selected ? (
              <div className="space-y-2.5 rounded-md border border-border p-3">
                {selected.fields.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">{f.label}</Label>
                    <Input className="h-8 text-xs" placeholder={f.placeholder} value={fields[f.key] ?? ""} onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))} />
                  </div>
                ))}
                {selected.kind === "elements" ? (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Appears at (s into scene)</Label>
                      <Input className="h-8 font-mono text-xs" inputMode="decimal" value={atSec} onChange={(e) => setAtSec(e.target.value)} />
                    </div>
                    {selected.builtin ? (
                      <>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">On screen for (s)</Label>
                          <Input className="h-8 font-mono text-xs" inputMode="decimal" value={lengthSec} onChange={(e) => setLengthSec(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">Side</Label>
                          <Select value={side} onValueChange={(v) => setSide(v as "left" | "right")}>
                            <SelectTrigger size="sm" className="h-8 w-full text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="left">Left</SelectItem>
                              <SelectItem value="right">Right</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">This replaces the design of {scene.key} (its timing stays). The previous design stays in the scene&apos;s version history.</p>
                )}
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => apply.mutate()} disabled={apply.isPending || scene.locked}>
                    {apply.isPending ? <Loader2 className="animate-spin" /> : <LayoutTemplate />} {selected.kind === "elements" ? `Add to ${scene.key}` : `Use on ${scene.key}`}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Name</Label>
              <Input className="h-8 text-xs" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Description (optional)</Label>
              <Input className="h-8 text-xs" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Save only some elements (leave empty to save the whole scene)</Label>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {elements.filter((el) => el.id).map((el) => {
                  const id = el.id!;
                  const on = picked.has(id);
                  return (
                    <Button
                      key={id}
                      size="xs"
                      variant={on ? "secondary" : "outline"}
                      className={cn(on && "ring-1 ring-primary")}
                      onClick={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(id);
                          else next.add(id);
                          return next;
                        })
                      }
                    >
                      {id} <span className="text-[10px] text-muted-foreground">{el.type}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
                {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {picked.size ? `Save ${picked.size} element(s)` : "Save scene as template"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
