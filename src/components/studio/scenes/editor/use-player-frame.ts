"use client";

import type { PlayerRef } from "@remotion/player";
import { useEffect, useState } from "react";

/** The player's current frame and whether it plays. Only the component calling this re-renders on every frame. */
export function usePlayerFrame(player: PlayerRef | null): { frame: number; playing: boolean } {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!player) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("seeked", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    setFrame(player.getCurrentFrame());
    setPlaying(player.isPlaying());
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("seeked", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [player]);
  return { frame, playing };
}
