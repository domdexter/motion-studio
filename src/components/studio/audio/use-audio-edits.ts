"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AudioClipPatch, VoiceCut, VoiceMix } from "@/core/timeline/audio-clips";
import { ApiError, errorMessage, http } from "@/lib/api-client";
import type { AudioTrackDto } from "@/server/services/audio-tracks";

/** Timeline audio editing: music/SFX clips and muted sections of the voice-over. */

export interface VoiceMixView {
  mix: VoiceMix;
  voiceDurationSec: number | null;
}

const tracksKey = (projectId: string) => ["project", projectId, "audio-tracks"];
const mixKey = (projectId: string) => ["project", projectId, "voice-mix"];
const fail = (e: unknown) => toast.error(errorMessage(e), { description: e instanceof ApiError ? e.hint : undefined });

export function useAudioTracks(projectId: string) {
  return useQuery({ queryKey: tracksKey(projectId), queryFn: async () => (await http.get<{ tracks: AudioTrackDto[] }>(`/api/projects/${projectId}/audio-tracks`)).tracks });
}

/** Updates apply optimistically so timeline drags don't jump back. */
export function useAudioTrackMutations(projectId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<AudioClipPatch> }) => (await http.patch<{ track: AudioTrackDto }>(`/api/projects/${projectId}/audio-tracks/${id}`, patch)).track,
    onMutate: ({ id, patch }) => {
      queryClient.setQueryData<AudioTrackDto[]>(tracksKey(projectId), (list) => list?.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    },
    onError: (e) => {
      fail(e);
      invalidate();
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => http.delete(`/api/projects/${projectId}/audio-tracks/${id}`),
    onSuccess: () => {
      toast.success("Audio clip removed", { description: "Press Ctrl+Z to undo." });
      invalidate();
    },
    onError: fail,
  });
  return { update, remove };
}

export function useVoiceMix(projectId: string) {
  return useQuery({ queryKey: mixKey(projectId), queryFn: () => http.get<VoiceMixView>(`/api/projects/${projectId}/voice/mix`) });
}

export function useVoiceCutsMutation(projectId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  return useMutation({
    mutationFn: async (cuts: VoiceCut[]) => (await http.patch<{ mix: VoiceMix }>(`/api/projects/${projectId}/voice/mix`, { cuts })).mix,
    onMutate: (cuts) => {
      queryClient.setQueryData<VoiceMixView>(mixKey(projectId), (d) => (d ? { ...d, mix: { ...d.mix, cuts } } : d));
    },
    onError: (e) => {
      fail(e);
      invalidate();
    },
    onSuccess: invalidate,
  });
}
