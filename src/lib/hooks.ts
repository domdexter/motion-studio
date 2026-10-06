"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectCard, ProjectDetail } from "@/server/services/projects";
import type { Settings, SecretStatus } from "@/server/services/settings";
import type { SystemHealth } from "@/server/services/system";
import { http } from "./api-client";

export interface ProjectsQuery {
  search?: string;
  filter?: "active" | "archived" | "all";
  sort?: "updated" | "created" | "name";
  status?: string;
}

export function useProjects(query: ProjectsQuery) {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({
    queryKey: ["projects", query],
    queryFn: () => http.get<{ projects: ProjectCard[]; counts: { total: number; active: number; archived: number } }>(`/api/projects${qs ? `?${qs}` : ""}`),
    placeholderData: keepPreviousData,
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => (await http.get<{ project: ProjectDetail }>(`/api/projects/${projectId}`)).project,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => http.get<{ settings: Settings; secrets: { elevenlabsApiKey: SecretStatus } }>("/api/settings"),
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async () => (await http.get<{ health: SystemHealth }>("/api/system/health")).health,
    refetchInterval: 10_000,
  });
}

export interface LiveJob {
  id: string;
  type: string;
  status: string;
  progress: number;
  stage: string | null;
}

export interface LiveRender {
  id: string;
  status: string;
  progress: number;
  stage: string | null;
  renderedFrames: number | null;
  totalFrames: number | null;
}

/**
 * Subscribes to project events (SSE). Any mutation — from this GUI, Claude Code's CLI, file
 * imports or the worker — bumps the revision and every project query refetches.
 */
export function useProjectEvents(projectId: string) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [progress, setProgress] = useState<{ jobs: LiveJob[]; renders: LiveRender[] }>({ jobs: [], renders: [] });
  const lastRevision = useRef<number | null>(null);

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events`);
    source.addEventListener("hello", () => setConnected(true));
    source.addEventListener("revision", (e) => {
      const { revision } = JSON.parse((e as MessageEvent).data) as { revision: number };
      if (lastRevision.current !== null && lastRevision.current !== revision) {
        void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
      }
      lastRevision.current = revision;
    });
    source.addEventListener("progress", (e) => setProgress(JSON.parse((e as MessageEvent).data)));
    source.addEventListener("deleted", () => {
      source.close();
      window.location.href = "/";
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [projectId, queryClient]);

  // One object per change: every workspace consumer re-renders when this identity changes.
  return useMemo(() => ({ connected, ...progress }), [connected, progress]);
}

export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
