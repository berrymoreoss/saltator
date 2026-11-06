import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit';
import { createDefaultRegistry } from '../library';
import { buildScene } from './scene';
import {
  EMPTY_SELECTION,
  isSelected,
  pruneSelection,
  sameSelection,
  selectAll,
  selectHit,
  selectionOf,
  selectionSize,
  toggleHit,
  unionSelection,
} from './selection';

const registry = createDefaultRegistry();
const builder = () =>
  new CircuitBuilder(registry)
    .add('SW1', 'io/switch', { at: [0, 0] })
    .add('U1', 'prim/nand', { at: [10, 0] })
    .connect('SW1.Y', 'U1.A');

describe('selection', () => {
  it('selects a single hit', () => {
    const s = selectHit({ kind: 'wire', id: 'w1' });
    expect([...s.wires]).toEqual(['w1']);
    expect(selectionSize(s)).toBe(1);
    expect(isSelected(s, { kind: 'wire', id: 'w1' })).toBe(true);
    expect(isSelected(s, { kind: 'part', id: 'w1' })).toBe(false);
  });

  it('toggles items in and out', () => {
    const a = toggleHit(EMPTY_SELECTION, { kind: 'part', id: 'U1' });
    const b = toggleHit(a, { kind: 'part', id: 'SW1' });
    expect([...b.parts]).toEqual(['U1', 'SW1']);
    expect([...toggleHit(b, { kind: 'part', id: 'U1' }).parts]).toEqual(['SW1']);
  });

  it('unites selections, reusing an operand when the other is empty', () => {
    const a = selectionOf(['U1']);
    expect(unionSelection(a, EMPTY_SELECTION)).toBe(a);
    expect(unionSelection(EMPTY_SELECTION, a)).toBe(a);
    const both = unionSelection(a, selectionOf(['SW1'], ['w1']));
    expect([...both.parts]).toEqual(['U1', 'SW1']);
    expect([...both.wires]).toEqual(['w1']);
  });

  it('selects everything in the scene', () => {
    const s = selectAll(buildScene(builder().build(), registry));
    expect(selectionSize(s)).toBe(3);
  });

  it('drops ids that no longer exist and keeps identity otherwise', () => {
    const scene = buildScene(builder().build(), registry);
    const s = selectionOf(['U1', 'SW1'], ['w1']);
    expect(pruneSelection(s, scene)).toBe(s);
    const smaller = buildScene(
      new CircuitBuilder(registry).add('U1', 'prim/nand', { at: [10, 0] }).build(),
      registry,
    );
    const pruned = pruneSelection(s, smaller);
    expect([...pruned.parts]).toEqual(['U1']);
    expect(pruned.wires.size).toBe(0);
  });

  it('compares selections by content', () => {
    expect(sameSelection(selectionOf(['a', 'b']), selectionOf(['b', 'a']))).toBe(true);
    expect(sameSelection(selectionOf(['a']), selectionOf([], ['a']))).toBe(false);
  });
});
