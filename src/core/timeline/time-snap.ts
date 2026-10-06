/**
 * Snapping and grouping on the timeline. An edge dragged near a meaningful moment — its scene or shot
 * edges, the playhead, other elements, spoken words, markers, cues — lands exactly on it; markers too
 * close to click one by one are grouped. Pure, so every lane snaps the same way: a lane passes the
 * moments that make sense for what is being dragged, preferred kinds first.
 */

export type SnapKind = "scene" | "shot" | "playhead" | "element" | "word" | "marker" | "cue";

export interface SnapTarget {
  time: number;
  kind: SnapKind;
  /** Shown while dragging: "scene end", "“platform”"… */
  label: string;
  /** A spoken word: its transcript index and which edge of the word this is. */
  word?: { index: number; edge: "start" | "end" };
}

export interface SnapResult {
  /** Seconds to add to the dragged edges so the snapped edge lands on its target (0 without one). */
  shift: number;
  target: SnapTarget | null;
  /** Index into `edges` of the edge that snapped (-1 without a target). */
  edge: number;
}

/** The target nearest to any of the dragged `edges` (seconds), within `thresholdSec`. On a tie the earlier target wins. */
export function snapEdges(edges: readonly number[], targets: readonly SnapTarget[], thresholdSec: number): SnapResult {
  let best: SnapResult = { shift: 0, target: null, edge: -1 };
  let bestDist = thresholdSec;
  edges.forEach((edge, e) => {
    for (const target of targets) {
      const d = Math.abs(target.time - edge);
      if (d < bestDist - 1e-9) {
        bestDist = d;
        best = { shift: target.time - edge, target, edge: e };
      }
    }
  });
  return best;
}

/** Items left to right, grouped while each is closer than `minPx` to the previous one at `pxPerSec` (markers that can't be clicked one by one). */
export function clusterByDistance<T extends { time: number }>(items: readonly T[], pxPerSec: number, minPx: number): { time: number; items: T[] }[] {
  const groups: { time: number; items: T[] }[] = [];
  for (const item of [...items].sort((a, b) => a.time - b.time)) {
    const last = groups[groups.length - 1];
    if (last && (item.time - last.items[last.items.length - 1].time) * pxPerSec < minPx) last.items.push(item);
    else groups.push({ time: item.time, items: [item] });
  }
  return groups;
}
