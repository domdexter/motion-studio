import { startContextWatcher } from "./file-watcher";

/** Long-running background services owned by the worker. */

type Stopper = () => Promise<void> | void;
const stoppers: Stopper[] = [];

export async function startBackgroundServices(): Promise<void> {
  try {
    const watcher = startContextWatcher();
    stoppers.push(() => watcher.close());
  } catch (err) {
    console.error("[worker] could not start the .project watcher:", err instanceof Error ? err.message : err);
  }
}

export function registerStopper(fn: Stopper): void {
  stoppers.push(fn);
}

export async function stopBackgroundServices(): Promise<void> {
  await Promise.allSettled(stoppers.map((fn) => fn()));
}
