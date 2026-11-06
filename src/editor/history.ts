/**
 * Undo/redo as document snapshots: an entry holds the circuit and selection before and after one
 * user action. Documents are immutable, so snapshots share every unchanged part and wire; nothing
 * has to be inverted and the history can't drift from the document. Pure values.
 * Spec: docs/editor.md#undo-and-redo.
 */
import type { Circuit } from '../circuit';
import type { Selection } from './selection';

export interface Snapshot {
  readonly circuit: Circuit;
  readonly selection: Selection;
}

export interface HistoryEntry {
  /** What the action was, for "Undo Move": `Move`, `Delete`, `Rename U1`. */
  readonly label: string;
  readonly before: Snapshot;
  readonly after: Snapshot;
  /** Consecutive entries with the same key merge into one (arrow-key nudges). */
  readonly coalesce?: string;
  /** Parts renamed by the action, old designator → new (R05 carries simulator state over). */
  readonly renames?: ReadonlyMap<string, string>;
}

export interface History {
  /** Oldest first; the last entry is undone next. */
  readonly past: readonly HistoryEntry[];
  /** The last entry is redone next. */
  readonly future: readonly HistoryEntry[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

/** Entries kept; older ones are dropped. */
export const HISTORY_LIMIT = 200;

/** Renames of `a` followed by `b`, as one map (`U1→U2`, `U2→U3` gives `U1→U3`). */
export function composeRenames(
  a: ReadonlyMap<string, string> | undefined,
  b: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string> | undefined {
  if (!a || a.size === 0) return b;
  if (!b || b.size === 0) return a;
  const out = new Map<string, string>();
  for (const [from, to] of a) out.set(from, b.get(to) ?? to);
  for (const [from, to] of b) if (![...a.values()].includes(from)) out.set(from, to);
  for (const [from, to] of out) if (from === to) out.delete(from);
  return out;
}

/** Inverse of a rename map (for undo). */
export function invertRenames(
  renames: ReadonlyMap<string, string> | undefined,
): ReadonlyMap<string, string> | undefined {
  return renames && new Map([...renames].map(([from, to]) => [to, from]));
}

/** Records an action; clears the redo stack; merges with the last entry when they coalesce. */
export function pushEntry(history: History, entry: HistoryEntry, limit = HISTORY_LIMIT): History {
  const last = history.past.at(-1);
  if (
    last &&
    entry.coalesce !== undefined &&
    last.coalesce === entry.coalesce &&
    last.after.circuit === entry.before.circuit
  ) {
    const renames = composeRenames(last.renames, entry.renames);
    const merged: HistoryEntry = {
      label: last.label,
      before: last.before,
      after: entry.after,
      coalesce: entry.coalesce,
      ...(renames && { renames }),
    };
    return { past: [...history.past.slice(0, -1), merged], future: [] };
  }
  const past = [...history.past, entry];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

/** Moves the last action to the redo stack; restore `entry.before`. */
export function undoEntry(history: History): { history: History; entry: HistoryEntry } | undefined {
  const entry = history.past.at(-1);
  if (!entry) return undefined;
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, entry] },
    entry,
  };
}

/** Moves the next undone action back; restore `entry.after`. */
export function redoEntry(history: History): { history: History; entry: HistoryEntry } | undefined {
  const entry = history.future.at(-1);
  if (!entry) return undefined;
  return {
    history: { past: [...history.past, entry], future: history.future.slice(0, -1) },
    entry,
  };
}

/** Breaks coalescing: the next entry starts a new undo step even with the same key. */
export function sealHistory(history: History): History {
  const last = history.past.at(-1);
  if (!last || last.coalesce === undefined) return history;
  const { coalesce: _, ...sealed } = last;
  return { ...history, past: [...history.past.slice(0, -1), sealed] };
}
