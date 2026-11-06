import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit';
import { createDefaultRegistry } from '../library';
import {
  deleteSelection,
  flipSelection,
  moveSelection,
  rotateSelection,
  selectionBounds,
  selectionCenter,
} from './operations';
import { buildScene } from './scene';
import { EMPTY_SELECTION, selectionOf } from './selection';

const registry = createDefaultRegistry();
const circuit = new CircuitBuilder(registry)
  .add('SW1', 'io/switch', { at: [0, 0] })
  .add('U1', 'prim/nand', { at: [10, 0] })
  .connect('SW1.Y', 'U1.A')
  .build();
const scene = buildScene(circuit, registry);

describe('selection operations', () => {
  it('measures the selection and finds its grid center', () => {
    expect(selectionBounds(scene, EMPTY_SELECTION)).toBeUndefined();
    expect(selectionBounds(scene, selectionOf(['U1']))).toEqual({
      x: 10,
      y: 0,
      width: 6,
      height: 4,
    });
    expect(selectionCenter(scene, selectionOf(['U1']))).toEqual([13, 2]);
    expect(selectionBounds(scene, selectionOf([], ['w1']))).toEqual({
      x: 4,
      y: 1,
      width: 6,
      height: 0,
    });
    expect(selectionCenter(scene, selectionOf(['nope']))).toBeUndefined();
  });

  it('deletes parts and wires', () => {
    const next = deleteSelection(circuit, selectionOf(['U1'], ['w1']));
    expect(next.components.map((c) => c.id)).toEqual(['SW1']);
    expect(next.wires).toEqual([]);
  });

  it('rotates a part about its center, both ways, and four turns return it', () => {
    const cw = rotateSelection(scene, selectionOf(['U1']), true);
    expect(cw.components[1]).toMatchObject({ x: 15, y: -1, rotation: 90 });
    const ccw = rotateSelection(scene, selectionOf(['U1']), false);
    expect(ccw.components[1]).toMatchObject({ rotation: 270 });
    let c = circuit;
    for (let i = 0; i < 4; i++)
      c = rotateSelection(buildScene(c, registry), selectionOf(['U1']), true);
    expect(c.components[1]).toMatchObject({ x: 10, y: 0, rotation: 0, flip: false });
  });

  it('flips a part in place; flipping twice returns it', () => {
    const once = flipSelection(scene, selectionOf(['U1']), 'horizontal');
    expect(once.components[1]).toMatchObject({ x: 16, y: 0, rotation: 0, flip: true });
    const twice = flipSelection(buildScene(once, registry), selectionOf(['U1']), 'horizontal');
    expect(twice.components[1]).toMatchObject({ x: 10, y: 0, rotation: 0, flip: false });
    const vertical = flipSelection(scene, selectionOf(['U1']), 'vertical');
    expect(vertical.components[1]).toMatchObject({ rotation: 180, flip: true });
  });

  it('moves the selection, and does nothing without one', () => {
    expect(moveSelection(scene, selectionOf(['SW1']), 0, -1).components[0]).toMatchObject({
      x: 0,
      y: -1,
    });
    expect(moveSelection(scene, EMPTY_SELECTION, 1, 0)).toBe(circuit);
    expect(moveSelection(scene, selectionOf(['SW1']), 0, 0)).toBe(circuit);
    expect(rotateSelection(scene, EMPTY_SELECTION, true)).toBe(circuit);
    expect(flipSelection(scene, EMPTY_SELECTION, 'vertical')).toBe(circuit);
  });
});
