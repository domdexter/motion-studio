"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import type { EditHistoryDto } from "@/server/services/edit-history";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Direction = "undo" | "redo";
const historyKey = (projectId: string) => ["project", projectId, "history"];

/** Undo/redo of scene, timing, overlay and marker edits (the server keeps the history). */
export function useEditHistory(projectId: string) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: historyKey(projectId), queryFn: async () => (await http.get<{ history: EditHistoryDto }>(`/api/projects/${projectId}/history`)).history });
  const step = useMutation({
    mutationKey: ["history", projectId],
    mutationFn: async (direction: Direction) => {
      // Let an edit that is still saving (a drag just released) land first, so it is the one undone.
      const deadline = Date.now() + 5000;
      while (queryClient.isMutating({ predicate: (m) => m.options.mutationKey?.[0] !== "history" }) > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 40));
      }
      return http.post<{ result: { label: string }; history: EditHistoryDto }>(`/api/projects/${projectId}/history/${direction}`);
    },
    onSuccess: ({ result, history }, direction) => {
      queryClient.setQueryData(historyKey(projectId), history);
      toast(`${direction === "undo" ? "Undid" : "Redid"} ${result.label}`, { id: "edit-history", duration: 2500 });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => {
      toast.error(errorMessage(e), { id: "edit-history", description: e instanceof ApiError ? e.hint : undefined });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
  const { mutate, isPending } = step;
  const run = useCallback((direction: Direction) => !isPending && mutate(direction), [mutate, isPending]);
  return { history: q.data ?? null, undo: useCallback(() => run("undo"), [run]), redo: useCallback(() => run("redo"), [run]), pending: isPending };
}

function isTextField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/** Undo/redo buttons plus Ctrl/⌘+Z, Ctrl+Shift+Z and Ctrl+Y (text fields keep their own undo). */
export function EditHistoryControls({ projectId }: { projectId: string }) {
  const { history, undo, redo, pending } = useEditHistory(projectId);
  const [mod, setMod] = useState("Ctrl+");
  useEffect(() => setMod(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      const direction: Direction | null = key === "z" ? (e.shiftKey ? "redo" : "undo") : key === "y" && !e.shiftKey ? "redo" : null;
      if (!direction || isTextField(e.target as Element) || document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      e.preventDefault();
      if (direction === "undo") undo();
      else redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const item = (direction: Direction) => {
    const next = direction === "undo" ? history?.undo : history?.redo;
    const Icon = direction === "undo" ? Undo2 : Redo2;
    const shortcut = direction === "undo" ? `${mod}Z` : mod === "⌘" ? "⇧⌘Z" : "Ctrl+Y";
    const verb = direction === "undo" ? "Undo" : "Redo";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={next ? undefined : 0} className="inline-flex">
            <Button size="icon-sm" variant="ghost" disabled={!next || pending} onClick={direction === "undo" ? undo : redo} aria-label={next ? `${verb} ${next.label}` : verb}>
              <Icon />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {next ? `${verb} ${next.label}` : `Nothing to ${direction}`} <span className="ml-1 opacity-60">{shortcut}</span>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="flex items-center" role="group" aria-label="Undo and redo">
      {item("undo")}
      {item("redo")}
    </div>
  );
}
