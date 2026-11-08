import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit';
import { createDefaultRegistry } from '../library';
import { boxHits, hitTest, rectFromPoints, segmentDistance2 } from './hit-test';
import { buildScene } from './scene';

const registry = createDefaultRegistry();

// SW1 body (0,0)–(3,2), pin Y tip (4,1); U1 body (11,0)–(15,4), pins A (10,1), B (10,3), Y (16,2);
// wire w1 (4,1)–(10,1); wire w2 (20,0)–(20,5).
const scene = buildScene(
  new CircuitBuilder(registry)
    .add('SW1', 'io/switch', { at: [0, 0] })
    .add('U1', 'prim/nand', { at: [10, 0] })
    .connect('SW1.Y', 'U1.A')
    .wire([20, 0], [20, 5])
    .build(),
  registry,
);

describe('segmentDistance2', () => {
  it('measures to the nearest point of the segment', () => {
    expect(segmentDistance2([5, 3], [0, 0], [10, 0])).toBe(9);
    expect(segmentDistance2([-3, 4], [0, 0], [10, 0])).toBe(25);
    expect(segmentDistance2([1, 1], [0, 0], [0, 0])).toBe(2);
  });
});

describe('hitTest', () => {
  it('hits part bodies', () => {
    expect(hitTest(scene, [12.5, 2], 0.2)).toEqual({ kind: 'part', id: 'U1' });
    expect(hitTest(scene, [1, 1], 0.2)).toEqual({ kind: 'part', id: 'SW1' });
  });

  it('hits a pin stub', () => {
    expect(hitTest(scene, [15.6, 2.1], 0.2)).toEqual({ kind: 'part', id: 'U1' });
  });

  it('hits wires within the tolerance only', () => {
    expect(hitTest(scene, [7, 1.15], 0.2)).toEqual({ kind: 'wire', id: 'w1' });
    expect(hitTest(scene, [20.1, 3], 0.2)).toEqual({ kind: 'wire', id: 'w2' });
    expect(hitTest(scene, [7, 1.5], 0.2)).toBeUndefined();
    expect(hitTest(scene, [30, 30], 0.2)).toBeUndefined();
  });

  it('prefers the nearer of a stub and a wire', () => {
    // Near U1.A's tip: the wire ends there, the stub starts there; the point is over the stub.
    expect(hitTest(scene, [10.5, 1], 0.2)).toEqual({ kind: 'part', id: 'U1' });
    expect(hitTest(scene, [9.5, 1], 0.2)).toEqual({ kind: 'wire', id: 'w1' });
  });
});

describe('hitTest on graphics', () => {
  // A text across U1 and the wire w1: 12 × 2 cells from (2, 0).
  const noted = buildScene(
    new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('U1', 'prim/nand', { at: [10, 0] })
      .connect('SW1.Y', 'U1.A')
      .add('TXT1', 'draw/text', { at: [2, 0], props: { text: 'A note over U1\nand its wire' } })
      .build(),
    registry,
  );

  it('hits a text where nothing else is', () => {
    expect(noted.partById.get('TXT1')!.body).toMatchObject({ x: 2, y: 0, height: 2 });
    expect(hitTest(noted, [6, 1.6], 0.2)).toEqual({ kind: 'part', id: 'TXT1' });
  });

  it('lets parts, pins and wires under a text take the click', () => {
    expect(hitTest(noted, [12, 1], 0.2)).toEqual({ kind: 'part', id: 'U1' });
    expect(hitTest(noted, [7, 1.1], 0.2)).toEqual({ kind: 'wire', id: 'w1' });
    expect(hitTest(noted, [1, 1], 0.2)).toEqual({ kind: 'part', id: 'SW1' });
  });
});

describe('boxHits', () => {
  it('selects only items entirely inside in inside mode', () => {
    expect(boxHits(scene, { x: -1, y: -1, width: 12, height: 4 }, 'inside')).toEqual({
      parts: ['SW1'],
      wires: ['w1'],
    });
  });

  it('selects everything touched in touching mode', () => {
    expect(boxHits(scene, { x: 7, y: 0, width: 5, height: 1 }, 'touching')).toEqual({
      parts: ['U1'],
      wires: ['w1'],
    });
    expect(boxHits(scene, { x: 19, y: 2, width: 2, height: 1 }, 'touching')).toEqual({
      parts: [],
      wires: ['w2'],
    });
  });

  it('normalizes boxes dragged in any direction', () => {
    expect(rectFromPoints([5, 1], [2, 4])).toEqual({ x: 2, y: 1, width: 3, height: 3 });
  });
});
