"use client";

import { useEffect, useRef } from "react";
import type { ArrangeAction } from "@/core/timeline/element-ops";

/**
 * Editor keyboard shortcuts for the Scenes and Timeline pages. They are ignored while typing in a
 * field, inside dialogs, menus and on sliders. With Ctrl/Cmd only duplicate (D) and layer order ([ ])
 * are handled here — undo and redo have their own handler; nothing fires with Alt.
 */

export interface PlaybackShortcutOptions {
  getTime: () => number;
  seek: (timeSec: number) => void;
  /** Space or K: play or pause. */
  toggle?: () => void;
  fps: number;
  durationSec: number;
  /** I and O: set the loop range's in and out points at the playhead. */
  onSetIn?: (timeSec: number) => void;
  onSetOut?: (timeSec: number) => void;
  /** Escape: clear the selection first — return false when there was none, then the loop range clears. */
  onEscape?: () => boolean;
  /** Escape: clear the loop range. */
  onClearRange?: () => void;
  /** S: split at the playhead (the selected clip, or the scene). */
  onSplit?: (timeSec: number) => void;
  /** M: add a marker at the playhead. */
  onMarker?: (timeSec: number) => void;
  /** Delete or Backspace: delete the selection. */
  onDelete?: () => void;
  /** Arrow keys: nudge the selected elements by pixels (Shift: large). Return true when handled; otherwise ← and → step frames. */
  onNudge?: (dx: number, dy: number, large: boolean) => boolean;
  /** Ctrl/⌘+D: duplicate the selection. Return true when handled. */
  onDuplicate?: () => boolean;
  /** Ctrl/⌘+G (Shift: ungroup): group the selection. Return true when handled. */
  onGroup?: (ungroup: boolean) => boolean;
  /** Ctrl/⌘+] or [ (Shift: to the front or back): layer order of the selection. Return true when handled. */
  onArrange?: (action: ArrangeAction) => boolean;
  /** [ or ] (no modifier): the playhead to the selected element's previous or next keyframe. Return true when handled. */
  onKeyframeStep?: (direction: -1 | 1) => boolean;
  enabled?: boolean;
}

export const PLAYBACK_SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Space or K", action: "Play or pause" },
  { keys: "J / L", action: "Back or forward 1 s (Shift: 5 s)" },
  { keys: "← / →", action: "Nudge the selected elements 1 px (Shift: 10 px); with none selected, back or forward 1 frame (Shift: 1 s)" },
  { keys: "↑ / ↓", action: "Nudge the selected elements up or down (Scenes page)" },
  { keys: ", / .", action: "Back or forward 1 frame (Shift: 1 s)" },
  { keys: "Home / End", action: "Go to the start or end" },
  { keys: "I / O", action: "Set the loop range in or out point" },
  { keys: "S", action: "Split the selected clip at the playhead (otherwise the scene)" },
  { keys: "Delete", action: "Delete the selected elements or clip" },
  { keys: "Ctrl+D", action: "Duplicate the selected elements (Scenes page)" },
  { keys: "Ctrl+G / Ctrl+Shift+G", action: "Group the selected elements, or ungroup the selected group (Scenes page)" },
  { keys: "Ctrl+] / Ctrl+[", action: "Bring forward or send backward (Shift: to the front or back)" },
  { keys: "[ / ]", action: "Previous or next keyframe of the selected element (of the selected keyframe's property)" },
  { keys: "Shift+click", action: "Add an element to the selection; drag on empty picture to select several" },
  { keys: "Esc", action: "Clear the selection, then the loop range" },
  { keys: "M", action: "Add a marker (Timeline page)" },
  { keys: "Ctrl+Z / Ctrl+Y", action: "Undo or redo" },
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  // Controls that use arrow keys or Space themselves (sliders, segmented choices, the anchor grid, switches).
  return !!el.closest("[role='dialog'], [role='slider'], [role='combobox'], [role='listbox'], [role='menu'], [role='tablist'], [role='radiogroup'], [role='switch'], [data-slot='toggle-group']");
}

export function usePlaybackShortcuts(options: PlaybackShortcutOptions) {
  const ref = useRef(options);
  useEffect(() => {
    ref.current = options;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const o = ref.current;
      if (o.enabled === false || e.defaultPrevented || e.altKey || isTyping(e.target)) return;
      // Physical keys first (Shift+] is "}" on some layouts); the character when a key event has no code.
      const is = (code: string, ...keys: string[]) => e.code === code || (!e.code && keys.includes(e.key.toLowerCase()));
      if (e.ctrlKey || e.metaKey) {
        if (is("KeyD", "d") && !e.shiftKey && o.onDuplicate?.()) e.preventDefault();
        if (is("KeyG", "g") && o.onGroup?.(e.shiftKey)) e.preventDefault();
        const forward = is("BracketRight", "]", "}");
        if ((forward || is("BracketLeft", "[", "{")) && o.onArrange?.(forward ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward")) e.preventDefault();
        return;
      }
      const t = o.getTime();
      const clamp = (v: number) => Math.max(0, Math.min(o.durationSec, v));
      const run = (fn: (() => void) | undefined) => {
        if (!fn) return;
        e.preventDefault();
        fn();
      };
      const frameStep = (direction: number) => run(() => o.seek(clamp(t + direction * (e.shiftKey ? 1 : 1 / o.fps))));
      if (is("Comma", ",", "<") || is("Period", ".", ">")) return frameStep(is("Comma", ",", "<") ? -1 : 1);
      if (!e.shiftKey && (is("BracketLeft", "[") || is("BracketRight", "]"))) {
        if (o.onKeyframeStep?.(is("BracketLeft", "[") ? -1 : 1)) e.preventDefault();
        return;
      }
      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          return run(o.toggle);
        case "j":
          return run(() => o.seek(clamp(t - (e.shiftKey ? 5 : 1))));
        case "l":
          return run(() => o.seek(clamp(t + (e.shiftKey ? 5 : 1))));
        case "arrowleft":
        case "arrowright":
        case "arrowup":
        case "arrowdown": {
          const key = e.key.toLowerCase();
          const dx = key === "arrowleft" ? -1 : key === "arrowright" ? 1 : 0;
          const dy = key === "arrowup" ? -1 : key === "arrowdown" ? 1 : 0;
          if (o.onNudge?.(dx, dy, e.shiftKey)) {
            e.preventDefault();
            return;
          }
          return dx ? frameStep(dx) : undefined;
        }
        case "home":
          return run(() => o.seek(0));
        case "end":
          return run(() => o.seek(o.durationSec));
        case "i":
          return run(o.onSetIn && (() => o.onSetIn!(t)));
        case "o":
          return run(o.onSetOut && (() => o.onSetOut!(t)));
        case "escape":
          if (o.onEscape?.()) {
            e.preventDefault();
            return;
          }
          return run(o.onClearRange);
        case "s":
          return run(o.onSplit && (() => o.onSplit!(t)));
        case "m":
          return run(o.onMarker && (() => o.onMarker!(t)));
        case "delete":
        case "backspace":
          return run(o.onDelete);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
