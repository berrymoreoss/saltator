import { describe, expect, it } from 'vitest';
import { type CircuitDocument, emptyDocument } from '../circuit';
import {
  composeRenames,
  EMPTY_HISTORY,
  type HistoryEntry,
  invertRenames,
  pushEntry,
  redoEntry,
  sealHistory,
  undoEntry,
} from './history';
import { EMPTY_SELECTION, selectionOf } from './selection';

const circuits: CircuitDocument[] = Array.from({ length: 6 }, (_, i) => emptyDocument(`C${i}`));
const step = (from: number, to: number, label = 'Edit', coalesce?: string): HistoryEntry => ({
  label,
  before: { document: circuits[from]!, open: 'main', selection: EMPTY_SELECTION },
  after: { document: circuits[to]!, open: 'main', selection: selectionOf([`U${to}`]) },
  ...(coalesce !== undefined && { coalesce }),
});

describe('history', () => {
  it('undoes and redoes in order', () => {
    let h = pushEntry(pushEntry(EMPTY_HISTORY, step(0, 1, 'Place')), step(1, 2, 'Move'));
    expect(h.past.map((e) => e.label)).toEqual(['Place', 'Move']);
    const undone = undoEntry(h)!;
    expect(undone.entry.label).toBe('Move');
    expect(undone.entry.before.document).toBe(circuits[1]);
    h = undone.history;
    expect(h.future.map((e) => e.label)).toEqual(['Move']);
    const redone = redoEntry(h)!;
    expect(redone.entry.after.document).toBe(circuits[2]);
    expect(redone.history.past.map((e) => e.label)).toEqual(['Place', 'Move']);
    expect(redone.history.future).toEqual([]);
  });

  it('has nothing to undo or redo when empty', () => {
    expect(undoEntry(EMPTY_HISTORY)).toBeUndefined();
    expect(redoEntry(EMPTY_HISTORY)).toBeUndefined();
  });

  it('clears the redo stack on a new action', () => {
    const h = undoEntry(pushEntry(EMPTY_HISTORY, step(0, 1)))!.history;
    expect(h.future).toHaveLength(1);
    expect(pushEntry(h, step(0, 3)).future).toEqual([]);
  });

  it('merges consecutive entries with the same coalesce key', () => {
    let h = pushEntry(EMPTY_HISTORY, step(0, 1, 'Nudge', 'nudge U1'));
    h = pushEntry(h, step(1, 2, 'Nudge', 'nudge U1'));
    h = pushEntry(h, step(2, 3, 'Nudge', 'nudge U1'));
    expect(h.past).toHaveLength(1);
    expect(h.past[0]!.before.document).toBe(circuits[0]);
    expect(h.past[0]!.after.document).toBe(circuits[3]);
    // A different key, or a key after a seal, starts a new step.
    expect(pushEntry(h, step(3, 4, 'Nudge', 'nudge U2')).past).toHaveLength(2);
    expect(pushEntry(sealHistory(h), step(3, 4, 'Nudge', 'nudge U1')).past).toHaveLength(2);
    // Something else in between (the circuit changed under it) also starts a new step.
    expect(pushEntry(h, step(4, 5, 'Nudge', 'nudge U1')).past).toHaveLength(2);
  });

  it('keeps at most the limit, dropping the oldest', () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < 5; i++) h = pushEntry(h, step(i, i + 1, `E${i}`), 3);
    expect(h.past.map((e) => e.label)).toEqual(['E2', 'E3', 'E4']);
  });

  it('composes and inverts renames', () => {
    const ab = new Map([['U1', 'U2']]);
    expect(composeRenames(ab, new Map([['U2', 'U3']]))).toEqual(new Map([['U1', 'U3']]));
    expect(composeRenames(ab, new Map([['U2', 'U1']]))).toEqual(new Map());
    expect(composeRenames(ab, new Map([['D1', 'LED']]))).toEqual(
      new Map([
        ['U1', 'U2'],
        ['D1', 'LED'],
      ]),
    );
    expect(composeRenames(undefined, ab)).toBe(ab);
    expect(composeRenames(ab, undefined)).toBe(ab);
    expect(invertRenames(ab)).toEqual(new Map([['U2', 'U1']]));
    expect(invertRenames(undefined)).toBeUndefined();
  });
});
