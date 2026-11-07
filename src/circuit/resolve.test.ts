import { describe, expect, it } from 'vitest';
import { compileCircuit } from './compile';
import type { Circuit, ComponentInstance, Wire } from './document';
import { compareDesignators, parseAddress, Resolver } from './resolve';
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
  probes: [],
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

  it('resolves what a probe shows: a net, a pin, a bus, a group of single signals', () => {
    expect(resolver.signal('CLK')).toEqual({ nets: ['CLK'], vector: false });
    expect(resolver.signal('U1.B')).toEqual({ nets: ['U1.B'], vector: false });
    expect(resolver.signal('D[0..1]')).toEqual({ nets: ['D0', 'D1'], vector: true });
    expect(resolver.signal('U1')).toBe('U1 is a part: probe one of its pins');
    expect(resolver.signal('U9.A')).toBe('no part U9');
    expect(resolver.probe({ ref: 'TICK', name: 'tick' })).toEqual({ nets: ['CLK'], vector: false });
    expect(resolver.probe({ name: 'G', members: ['D0', 'U1.Y', 'CLK'] })).toEqual({
      nets: ['D0', 'D1', 'CLK'],
      vector: true,
    });
    expect(resolver.probe({ name: 'G', members: ['CLK', 'U9.Y'] })).toBe('U9.Y: no part U9');
    expect(resolver.probe({ name: 'G', members: ['D[0..1]'] })).toBe(
      "D[0..1] is a bus: a group's members are single signals",
    );
  });

  it('names a net to probe it by: its name, else a pin on it, a driving one first', () => {
    expect(resolver.netReference('CLK')).toBe('CLK');
    expect(resolver.netReference('U1.B')).toBe('U1.B');
    const unnamed = new Resolver(
      compileCircuit(
        {
          ...circuit,
          components: [part('U3', 'test/and', 20, 0), part('U1', 'test/and', 10, 0)],
          wires: [wire('w1', 15, 1, 18, 1), wire('w2', 18, 1, 18, 2), wire('w3', 18, 2, 20, 2)],
        },
        registry,
      ),
      registry,
    );
    // U3.B, an input, comes first on the net (U3 is first in the document); U1.Y drives it.
    const target = unnamed.resolve('U3.B');
    expect(target).toMatchObject({ kind: 'pin' });
    const net = (target as { net: string }).net;
    expect(unnamed.netReference(net)).toBe('U1.Y');
    expect(unnamed.netReference('nothing')).toBeUndefined();
    expect(resolver.netReference('w4')).toBeUndefined(); // a wire on no pin
  });

  it('resolves cells of a memory part: one address or a range, as the memory tools take them', () => {
    const rom = registry.get('test/rom')!.memory!;
    const cells = (from: number, to: number) => ({
      kind: 'cells',
      part: 'U2',
      type: 'test/rom',
      memory: rom,
      from,
      to,
    });
    expect(resolver.resolve('U2[3]')).toEqual(cells(3, 3));
    expect(resolver.resolve(' U2[ 0x1 .. $2 ] ')).toEqual(cells(1, 2));
    expect(resolver.resolve('U2[3h..1]')).toEqual(cells(1, 3)); // either way round
    expect(resolver.resolve('U2[0..1]')).toEqual(cells(0, 1)); // a memory wins over a bus name
    expect(resolver.resolve('U2[4]')).toBe('U2[4]: The last address is 3.');
    expect(resolver.resolve('U2[0..q]')).toBe('U2[q]: Type a hex address, 0 to 3.');
    expect(resolver.resolve('U1[0]')).toBe('U1 holds no memory');
    expect(resolver.resolve('U9[0]')).toBe('no part or net named U9[0]');
    expect(resolver.signal('U2[1]')).toBe('U2[1] is memory, not a signal');
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

describe('parseAddress', () => {
  it('reads hex with or without a prefix, within the memory', () => {
    expect(['7f0', '0x7F0', '$7f0', '7F0h', ' 7f0 '].map((t) => parseAddress(t, 2048))).toEqual([
      0x7f0, 0x7f0, 0x7f0, 0x7f0, 0x7f0,
    ]);
    expect(parseAddress('800', 2048)).toBe('The last address is 7FF.');
    expect(parseAddress('xyz', 2048)).toBe('Type a hex address, 0 to 7FF.');
    expect(parseAddress('', 2048)).toBe('Type a hex address, 0 to 7FF.');
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
