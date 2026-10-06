"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { trimmedLengthSec } from "@/core/timeline/overlays";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import type { OverlayClipDto } from "@/server/services/overlay-clips";

export type OverlayPatch = Partial<
  Pick<
    OverlayClipDto,
    "name" | "placement" | "fit" | "startSec" | "durationSec" | "trimStartSec" | "trimEndSec" | "playbackRate" | "endBehavior" | "volume" | "duckUnderVoice" | "dim" | "opacity" | "fadeInSec" | "fadeOutSec" | "hidden" | "zooms" | "crop" | "speedSegments" | "annotations"
  >
>;

export interface AddOverlayBody {
  assetId: string;
  startSec?: number;
  durationSec?: number;
  placement?: OverlayClipDto["placement"];
  trimStartSec?: number;
  trimEndSec?: number | null;
  dim?: number;
  volume?: number;
}

const overlaysKey = (projectId: string) => ["project", projectId, "overlays"];
const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function useOverlayClips(projectId: string) {
  return useQuery({ queryKey: overlaysKey(projectId), queryFn: async () => (await http.get<{ overlays: OverlayClipDto[] }>(`/api/projects/${projectId}/overlays`)).overlays });
}

/** Add / update / split / remove overlay clips. Updates apply optimistically so timeline drags don't jump back. */
export function useOverlayMutations(projectId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  const add = useMutation({
    mutationFn: async (body: AddOverlayBody) => (await http.post<{ overlay: OverlayClipDto }>(`/api/projects/${projectId}/overlays`, body)).overlay,
    onSuccess: invalidate,
    onError: fail,
  });
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: OverlayPatch }) => (await http.patch<{ overlay: OverlayClipDto }>(`/api/projects/${projectId}/overlays/${id}`, patch)).overlay,
    onMutate: ({ id, patch }) => {
      queryClient.setQueryData<OverlayClipDto[]>(overlaysKey(projectId), (list) =>
        list?.map((c) => {
          if (c.id !== id) return c;
          const next = { ...c, ...patch };
          return { ...next, endSec: r3(next.startSec + next.durationSec), trimmedLengthSec: next.speedSegments?.length ? c.trimmedLengthSec : trimmedLengthSec(next) };
        }),
      );
    },
    onError: (e) => {
      fail(e);
      invalidate();
    },
    onSuccess: invalidate,
  });
  const split = useMutation({
    mutationFn: async ({ id, atSec, removeUntilSec }: { id: string; atSec: number; removeUntilSec?: number }) =>
      (await http.post<{ overlays: OverlayClipDto[] }>(`/api/projects/${projectId}/overlays/${id}/split`, { atSec, ...(removeUntilSec !== undefined ? { removeUntilSec } : {}) })).overlays,
    onSuccess: (_d, v) => {
      toast.success(v.removeUntilSec !== undefined ? "Section cut out" : "Overlay split in two", { description: "Press Ctrl+Z to undo." });
      invalidate();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => http.delete(`/api/projects/${projectId}/overlays/${id}`),
    onSuccess: () => {
      toast.success("Overlay removed");
      invalidate();
    },
    onError: fail,
  });
  return { add, update, split, remove };
}
