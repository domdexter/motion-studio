import os from "node:os";
import { getSettings } from "../services/settings";

/**
 * How many browser tabs render frames in parallel. OffthreadVideo extracts video frames in the
 * compositor with a memory-bounded cache; with many tabs and little free RAM frames are evicted before
 * they are used ("No frame found at position …"), so compositions with video default to at most 3.
 * A render can ask for its own number; otherwise Settings → Render applies, else the automatic value.
 */

export const MAX_RENDER_CONCURRENCY = 32;

export function renderMachineInfo(hasVideo: boolean) {
  const cpuCount = os.cpus().length;
  const configured = getSettings().render.concurrency;
  const base = Math.max(1, Math.min(8, Math.floor(cpuCount / 2)));
  const automatic = hasVideo ? Math.min(base, 3) : base;
  return {
    cpuCount,
    freeMemoryGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    hasVideo,
    /** The value used when neither the render nor Settings sets one. */
    automatic,
    /** Settings → Render → concurrency (null = automatic). */
    configured,
    /** What a render without its own value uses. */
    defaultConcurrency: configured ?? automatic,
    max: Math.min(MAX_RENDER_CONCURRENCY, Math.max(4, cpuCount)),
  };
}

export function renderConcurrency(requested: number | null | undefined, hasVideo: boolean): number {
  const value = requested ?? renderMachineInfo(hasVideo).defaultConcurrency;
  return Math.max(1, Math.min(MAX_RENDER_CONCURRENCY, Math.round(value)));
}
