import { describe, expect, it } from 'vitest';
import { compileCircuit } from './compile';
import type { Circuit, ComponentInstance, Wire } from './document';
import { compareDesignators, Resolver } from './resolve';
import { testRegistry } from './test-parts';

const registry = testRegistry();

// Pin positions at (x, y): test/high Y (x+5, y+1); test/and A (x, y+1), B (x, y+2), Y (x+5, y+1);
// test/rom A0 (x, y+1), A1 (x, y+2), Y (x+5, y+1); test/label N (x, y).
const part = (id: string, type: string, x: number, y: number, props = {}): ComponentInstance => ({
  id,
  type,
  x,
  y,
  rotation: 0,
  flip: false,
  props,
});
const wire = (id: string, x1: number, y1: number, x2: number, y2: number): Wire => ({
  id,
  from: [x1, y1],
  to: [x2, y2],
});

// H1.Y ─ U1.A, named CLK and TICK by labels; U1.Y labelled D1; ROMs U10 and U2 (A0 on D0 by a label).
const circuit: Circuit = {
  id: 'main',
  name: 'Main',
  components: [
    part('H1', 'test/high', 0, 0),
    part('U1', 'test/and', 10, 0),
    part('NL1', 'test/label', 7, 1, { name: 'CLK' }),
    part('NL4', 'test/label', 8, 1, { name: 'TICK' }), // a second name: the net is called CLK
    part('NL2', 'test/label', 18, 1, { name: 'D1' }),
    part('U10', 'test/rom', 30, 0),
    part('U2', 'test/rom', 30, 10),
    part('NL3', 'test/label', 27, 11, { name: 'D0' }),
  ],
  wires: [
    wire('w1', 5, 1, 10, 1),
    wire('w2', 15, 1, 18, 1),
    wire('w3', 27, 11, 30, 11),
    wire('w4', 40, 20, 42, 20),
  ],
};

const resolver = new Resolver(compileCircuit(circuit, registry), registry);

describe('Resolver', () => {
  it('resolves parts and their pins, with the net each pin is on', () => {
    expect(resolver.resolve('U1')).toEqual({ kind: 'part', part: 'U1', type: 'test/and' });
    expect(resolver.resolve(' U1 ')).toEqual({ kind: 'part', part: 'U1', type: 'test/and' });
    expect(resolver.resolve('U1.A')).toEqual({ kind: 'pin', part: 'U1', pin: 'A', net: 'CLK' });
    expect(resolver.resolve('U1.B')).toEqual({ kind: 'pin', part: 'U1', pin: 'B', net: 'U1.B' });
  });

  it('resolves nets by name or by id', () => {
    expect(resolver.resolve('CLK')).toEqual({ kind: 'net', net: 'CLK' });
    expect(resolver.resolve('TICK')).toEqual({ kind: 'net', net: 'CLK' });
    expect(resolver.resolve('D1')).toEqual({ kind: 'net', net: 'D1' });
    expect(resolver.resolve('w4')).toEqual({ kind: 'net', net: 'w4' });
  });

  it('resolves a bus to its members bit 0 first, unnamed members undefined', () => {
    expect(resolver.resolve('D[0..3]')).toEqual({
      kind: 'bus',
      bus: 'D[0..3]',
      members: ['D0', 'D1', undefined, undefined],
    });
    expect(resolver.resolve('D[1..0]')).toMatchObject({ members: ['D0', 'D1'] });
  });

  it.each([
    ['', 'empty reference'],
    ['U9', 'no part or net named U9'],
    ['U9.A', 'no part U9'],
    ['U1.Q', 'U1 has no pin Q'],
    ['NL1', 'no part or net named NL1'], // net labels are not simulated
    ['Q[0..7]', 'no net of Q[0..7] is named on this circuit'],
    ['U5/D0', '"U5/D0": paths into subcircuits come with R11'],
  ])('explains %j: %s', (reference, message) => {
    expect(resolver.resolve(reference)).toBe(message);
  });

  it('lists the simulated parts and, in designator order, the memories', () => {
    expect(resolver.parts.map((p) => p.id)).toEqual(['H1', 'U1', 'U10', 'U2']);
    const memories = resolver.memories();
    expect(memories.map((m) => [m.id, m.type, m.memory.words])).toEqual([
      ['U2', 'test/rom', 4],
      ['U10', 'test/rom', 4],
    ]);
    expect(memories[0]!.definition).toBe(registry.get('test/rom'));
  });
});

describe('compareDesignators', () => {
  it('counts the numbers in designators', () => {
    expect(['U10', 'U2', 'SW1', 'U1', 'U1A'].sort(compareDesignators)).toEqual([
      'SW1',
      'U1',
      'U1A',
      'U2',
      'U10',
    ]);
  });
});
