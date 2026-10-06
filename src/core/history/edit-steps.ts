import { stableStringify } from "../util/hash";

/**
 * Undo/redo for editing (scenes, overlay clips, audio tracks, timeline markers, the voice-over mix).
 * An edit step stores the before/after state of just the entities the edit changed. Undo writes
 * `before` back, redo writes `after` — but only while those entities still look exactly like the
 * other side, so an undo never silently overwrites a later change (by Claude, a file import or
 * another tab).
 */

export const HISTORY_SCOPES = ["scenes", "overlays", "audioTracks", "markers", "mix"] as const;
export type HistoryScope = (typeof HISTORY_SCOPES)[number];
/** Scopes captured entity by entity. */
export type EntityKind = "scenes" | "overlays" | "audioTracks";
/** Scopes captured as one whole value. */
export type ValueScope = "markers" | "mix";
export type EntityState = Record<string, unknown>;

const ENTITY_KINDS = ["scenes", "overlays", "audioTracks"] as const satisfies readonly EntityKind[];
const VALUE_SCOPES = ["markers", "mix"] as const satisfies readonly ValueScope[];

/** Captured editable state. Only the scopes an edit can touch are captured. */
export interface EditState {
  scenes?: Record<string, EntityState>;
  overlays?: Record<string, EntityState>;
  audioTracks?: Record<string, EntityState>;
  markers?: unknown;
  mix?: unknown;
}

export interface EntityChange {
  id: string;
  /** null = the entity didn't exist before the edit (created). */
  before: EntityState | null;
  /** null = the edit deleted the entity. */
  after: EntityState | null;
}

export interface ValueChange {
  before: unknown;
  after: unknown;
}

export interface EditChanges {
  scenes?: EntityChange[];
  overlays?: EntityChange[];
  audioTracks?: EntityChange[];
  markers?: ValueChange;
  mix?: ValueChange;
}

export type HistoryDirection = "undo" | "redo";

/** Bookkeeping fields that never count as an edit (versions bump on every write; locking is not undoable). */
const IGNORED: Record<EntityKind, readonly string[]> = {
  scenes: ["version", "source", "locked"],
  overlays: [],
  audioTracks: [],
};

const VALUE_LABELS: Record<ValueScope, string> = { markers: "the timeline markers", mix: "the voice-over mix" };

function comparable(kind: EntityKind, state: EntityState | null): string {
  if (!state) return "null";
  const rest = { ...state };
  for (const field of IGNORED[kind]) delete rest[field];
  return stableStringify(rest);
}

export function sameEntity(kind: EntityKind, a: EntityState | null | undefined, b: EntityState | null | undefined): boolean {
  return comparable(kind, a ?? null) === comparable(kind, b ?? null);
}

const sameValue = (a: unknown, b: unknown) => stableStringify(a ?? null) === stableStringify(b ?? null);

function diffKind(kind: EntityKind, before: Record<string, EntityState>, after: Record<string, EntityState>): EntityChange[] {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: EntityChange[] = [];
  for (const id of ids) {
    const b = before[id] ?? null;
    const a = after[id] ?? null;
    if (!sameEntity(kind, b, a)) changes.push({ id, before: b, after: a });
  }
  return changes;
}

export function diffEditState(before: EditState, after: EditState): EditChanges {
  const out: EditChanges = {};
  for (const kind of ENTITY_KINDS) {
    const b = before[kind];
    const a = after[kind];
    if (!b || !a) continue;
    const changes = diffKind(kind, b, a);
    if (changes.length) out[kind] = changes;
  }
  for (const scope of VALUE_SCOPES) {
    if (scope in before && scope in after && !sameValue(before[scope], after[scope])) out[scope] = { before: before[scope] ?? null, after: after[scope] ?? null };
  }
  return out;
}

export function isEmptyChanges(c: EditChanges): boolean {
  return ENTITY_KINDS.every((kind) => !c[kind]?.length) && VALUE_SCOPES.every((scope) => !c[scope]);
}

export function scopesOf(c: EditChanges): HistoryScope[] {
  return [...ENTITY_KINDS.filter((kind) => c[kind]?.length), ...VALUE_SCOPES.filter((scope) => c[scope])];
}

function mergeKind(kind: EntityKind, older: EntityChange[] = [], newer: EntityChange[] = []): EntityChange[] {
  const byId = new Map(older.map((c) => [c.id, { ...c }]));
  for (const c of newer) {
    const prev = byId.get(c.id);
    byId.set(c.id, prev ? { id: c.id, before: prev.before, after: c.after } : { ...c });
  }
  return [...byId.values()].filter((c) => !sameEntity(kind, c.before, c.after));
}

/** Folds a newer step into an older one: the older `before`, the newer `after`. */
export function mergeChanges(older: EditChanges, newer: EditChanges): EditChanges {
  const out: EditChanges = {};
  for (const kind of ENTITY_KINDS) {
    const merged = mergeKind(kind, older[kind], newer[kind]);
    if (merged.length) out[kind] = merged;
  }
  for (const scope of VALUE_SCOPES) {
    const o = older[scope];
    const n = newer[scope];
    if (!o && !n) continue;
    const before = o ? o.before : n?.before;
    const after = n ? n.after : o?.after;
    if (!sameValue(before, after)) out[scope] = { before, after };
  }
  return out;
}

export interface HistoryConflict {
  kind: EntityKind | ValueScope;
  id: string;
  /** Human name: "scene_03", "overlay “Intro clip”", "audio track “Bed”", "the timeline markers". */
  label: string;
}

export function entityLabel(kind: EntityKind, change: EntityChange, current?: EntityState | null): string {
  const pick = (field: string) => [current, change.after, change.before].map((s) => s?.[field]).find((v) => typeof v === "string" && v) as string | undefined;
  if (kind === "scenes") return pick("key") ?? "a scene";
  return kind === "overlays" ? `overlay “${pick("name") ?? "clip"}”` : `audio track “${pick("name") ?? "track"}”`;
}

/** Entities that no longer look like the side this undo/redo starts from. */
export function findConflicts(changes: EditChanges, current: EditState, direction: HistoryDirection): HistoryConflict[] {
  const expected = (c: { before: unknown; after: unknown }) => (direction === "undo" ? c.after : c.before);
  const conflicts: HistoryConflict[] = [];
  for (const kind of ENTITY_KINDS) {
    for (const change of changes[kind] ?? []) {
      const now = current[kind]?.[change.id] ?? null;
      if (!sameEntity(kind, now, expected(change) as EntityState | null)) conflicts.push({ kind, id: change.id, label: entityLabel(kind, change, now) });
    }
  }
  for (const scope of VALUE_SCOPES) {
    const change = changes[scope];
    if (change && !sameValue(current[scope], expected(change))) conflicts.push({ kind: scope, id: scope, label: VALUE_LABELS[scope] });
  }
  return conflicts;
}

/** The state an undo/redo writes for each changed entity. */
export function targetOf(change: EntityChange, direction: HistoryDirection): EntityState | null {
  return direction === "undo" ? change.before : change.after;
}

export function describeConflicts(conflicts: HistoryConflict[]): string {
  const names = [...new Set(conflicts.map((c) => c.label))];
  const list = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ").replace(/, ([^,]*)$/, " and $1");
  return `${list} ${names.length === 1 ? "has" : "have"} changed since`;
}
