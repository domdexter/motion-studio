"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { AI_TASK_TYPES } from "@/core/spec/enums";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { TaskDto } from "@/server/services/tasks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export type TaskType = (typeof AI_TASK_TYPES)[number];

const TASK_OPTIONS: { type: TaskType; label: string; description: string; needsScenes: boolean; anyScope?: boolean; placeholder: string }[] = [
  { type: "edit_scene", label: "Refine", description: "Improve the selected scene(s) following your instruction.", needsScenes: true, placeholder: "e.g. Make this feel more premium, slow the card entrance, and emphasize “payments”." },
  { type: "regenerate_scenes", label: "Regenerate", description: "Re-imagine the selected scene(s) from scratch — timing and voice stay intact.", needsScenes: true, placeholder: "Optional direction, e.g. use a dashboard UI instead of cards." },
  { type: "scene_alternatives", label: "Alternatives", description: "Create alternative versions of the scene(s) to compare.", needsScenes: true, placeholder: "Optional direction for the alternatives." },
  { type: "generate_storyboard", label: "Storyboard", description: "Plan every unlocked scene from the audio timeline.", needsScenes: false, placeholder: "Optional creative direction, e.g. bold kinetic typography, fewer UI mockups." },
  { type: "generate_assets", label: "Assets", description: "Create the AI images or videos the scenes need.", needsScenes: false, placeholder: "Optional style notes for the images." },
  { type: "analyze_script", label: "Analyze script", description: "Narrative beats, emphasis and visual opportunities.", needsScenes: false, placeholder: "Optional focus for the analysis." },
  { type: "plan_creative", label: "Plan direction", description: "Creative direction, story arc, visual language and asset strategy for the whole video.", needsScenes: false, placeholder: "Optional direction, e.g. premium and restrained, strong contrast between problem and solution." },
  { type: "creative_review", label: "Creative review", description: "Claude reviews like a senior motion designer and writes issues and recommendations — nothing changes.", needsScenes: false, anyScope: true, placeholder: "e.g. Find the three weakest scenes." },
  { type: "refine_creative", label: "Creative refinement", description: "Raise the creative quality inside the existing timing: pacing, restraint, cohesion, contrast.", needsScenes: false, anyScope: true, placeholder: "e.g. Make the animation more restrained." },
  { type: "command", label: "Anything else", description: "A free-form request for Claude Code.", needsScenes: false, placeholder: "e.g. Make scene 3 more cinematic and apply our brand colors everywhere." },
];

export function AskClaudeDialog({
  projectId,
  open,
  onOpenChange,
  scenes = [],
  defaultType,
  defaultInstruction = "",
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenes?: { id: string; key: string }[];
  defaultType?: TaskType;
  defaultInstruction?: string;
}) {
  const queryClient = useQueryClient();
  const fallbackType: TaskType = defaultType ?? (scenes.length ? "edit_scene" : "command");
  const [type, setType] = useState<TaskType>(fallbackType);
  const [instruction, setInstruction] = useState(defaultInstruction);
  const [keepTiming, setKeepTiming] = useState(true);
  const [keepVoice, setKeepVoice] = useState(true);
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (open) {
      setType(fallbackType);
      setInstruction(defaultInstruction);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const options = TASK_OPTIONS.filter((o) => (scenes.length ? o.needsScenes || o.anyScope || o.type === "command" : !o.needsScenes));
  const option = TASK_OPTIONS.find((o) => o.type === type) ?? TASK_OPTIONS[TASK_OPTIONS.length - 1];
  const needsInstruction = type === "edit_scene" || type === "command" || type === "refine_creative";

  const create = useMutation({
    mutationFn: () =>
      http.post<{ task: TaskDto }>(`/api/projects/${projectId}/tasks`, {
        type,
        instruction: instruction.trim(),
        scope: {
          ...(scenes.length ? { sceneIds: scenes.map((s) => s.id) } : {}),
          keepTiming,
          keepVoice,
          ...(type === "scene_alternatives" ? { count } : {}),
        },
      }),
    onSuccess: ({ task }) => {
      toast.success("Sent to Claude Code", {
        description: task.executor === "headless" ? `“${task.title}” is running in the background.` : `“${task.title}” is waiting for Claude Code (run: npm run studio -- tasks).`,
      });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Ask Claude
          </DialogTitle>
          <DialogDescription>
            {scenes.length ? `Scope: ${scenes.map((s) => s.key).join(", ")}. ` : "Project-wide request. "}
            Claude Code works through the studio CLI, so every change is validated, versioned, respects locked scenes and appears here live.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => (
              <button
                key={o.type}
                type="button"
                onClick={() => setType(o.type)}
                className={cn("rounded-full border px-3 py-1 text-xs transition-colors", type === o.type ? "border-primary/60 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{option.description}</p>
          <Textarea autoFocus rows={4} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={option.placeholder} />
          {type === "scene_alternatives" ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Alternatives</span>
              {[2, 3, 4].map((n) => (
                <button key={n} type="button" onClick={() => setCount(n)} className={cn("size-7 rounded-md border text-xs", count === n ? "border-primary/60 bg-primary/15" : "border-border text-muted-foreground")}>
                  {n}
                </button>
              ))}
            </div>
          ) : null}
          {scenes.length ? (
            <div className="flex flex-wrap gap-6 text-sm">
              <label className="flex items-center gap-2">
                <Switch checked={keepTiming} onCheckedChange={setKeepTiming} /> Keep timing
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={keepVoice} onCheckedChange={setKeepVoice} /> Keep voice-over
              </label>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || (needsInstruction && !instruction.trim())}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Send to Claude
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
