import { describe, expect, it } from 'vitest';
import { Level, Simulator } from '../core';
import { CircuitBuilder } from './builder';
import { compileCircuit } from './compile';
import { parseDocument } from './schema';
import { serializeDocument } from './serialize';
import { testRegistry } from './test-parts';

const registry = testRegistry();
const builder = () => new CircuitBuilder(registry);

describe('CircuitBuilder', () => {
  it('places parts with defaults and options', () => {
    const circuit = builder()
      .add('H1', 'test/high', { at: [0, 0] })
      .add('U1', 'test/and', {
        at: [10, 4],
        rotation: 90,
        flip: true,
        props: { inputs: 3 },
        label: 'GATE',
      })
      .build();
    expect(circuit).toEqual({
      id: 'main',
      name: 'Main',
      components: [
        { id: 'H1', type: 'test/high', x: 0, y: 0, rotation: 0, flip: false, props: {} },
        {
          id: 'U1',
          type: 'test/and',
          x: 10,
          y: 4,
          rotation: 90,
          flip: true,
          props: { inputs: 3 },
          label: 'GATE',
        },
      ],
      wires: [],
      probes: [],
    });
  });

  it('knows where every pin is, after rotation and with prop-dependent pins', () => {
    const b = builder()
      .add('U1', 'test/and', { at: [10, 20] })
      .add('U2', 'test/and', { at: [0, 0], rotation: 90, props: { inputs: 3 } });
    expect(b.pin('U1.A')).toEqual([10, 21]);
    expect(b.pin('U1.Y')).toEqual([15, 21]);
    expect(b.pin('U2.C')).toEqual([-3, 0]);
  });

  it('draws polylines through points and pins, one wire per segment', () => {
    const circuit = builder()
      .add('H1', 'test/high', { at: [0, 0] })
      .wire('H1.Y', [8, 1], [8, 1], [8, 6])
      .build();
    expect(circuit.wires).toEqual([
      { id: 'w1', from: [5, 1], to: [8, 1] },
      { id: 'w2', from: [8, 1], to: [8, 6] },
    ]);
  });

  it('draws bus lines through points and bus pins', () => {
    const circuit = builder()
      .add('BE1', 'test/bus-entry', { at: [0, 0], props: { name: 'D1' } })
      .bus('BE1.B', [3, 6], [8, 6])
      .wire([0, 0], [-2, 0])
      .build();
    expect(circuit.wires).toEqual([
      { id: 'w1', from: [3, 1], to: [3, 6], bus: true },
      { id: 'w2', from: [3, 6], to: [8, 6], bus: true },
      { id: 'w3', from: [0, 0], to: [-2, 0] },
    ]);
    expect(() => builder().bus([0, 0], [1, 1])).toThrow('diagonal');
  });

  it('routes connections with an L-shape, horizontal first, through via points', () => {
    const b = builder()
      .add('H1', 'test/high', { at: [0, 0] }) // Y (5, 1)
      .add('U1', 'test/and', { at: [10, 6] }) // A (10, 7), B (10, 8)
      .connect('H1.Y', 'U1.A')
      .connect('H1.Y', 'U1.B', [7, 1], [7, 12], [9, 12]);
    expect(b.build().wires).toEqual([
      { id: 'w1', from: [5, 1], to: [10, 1] },
      { id: 'w2', from: [10, 1], to: [10, 7] },
      { id: 'w3', from: [5, 1], to: [7, 1] },
      { id: 'w4', from: [7, 1], to: [7, 12] },
      { id: 'w5', from: [7, 12], to: [9, 12] },
      { id: 'w6', from: [9, 12], to: [10, 12] },
      { id: 'w7', from: [10, 12], to: [10, 8] },
    ]);
  });

  it('does not draw a wire between pins that already touch', () => {
    const b = builder()
      .add('H1', 'test/high', { at: [0, 0] }) // Y (5, 1)
      .add('U1', 'test/and', { at: [5, 0] }) // A (5, 1)
      .connect('H1.Y', 'U1.A');
    expect(b.build().wires).toEqual([]);
  });

  it('skips wire ids taken by components', () => {
    const circuit = builder()
      .add('w1', 'test/high', { at: [0, 0] })
      .wire([0, 5], [3, 5])
      .build();
    expect(circuit.wires.map((w) => w.id)).toEqual(['w2']);
  });

  it('builds documents that load, compile and simulate', () => {
    const b = builder()
      .add('H1', 'test/high', { at: [0, 0] })
      .add('U1', 'test/and', { at: [10, 0] })
      .connect('H1.Y', 'U1.A')
      .connect('H1.Y', 'U1.B', [7, 1]);
    const document = b.document();
    expect(parseDocument(serializeDocument(document))).toEqual(document);
    const result = compileCircuit(document.circuits[0]!, registry);
    expect(result.issues).toEqual([]);
    const sim = new Simulator(result.netlist, registry);
    sim.settle();
    expect(sim.pinLevel('U1', 'Y')).toBe(Level.L1);
  });

  it('takes a circuit id and name, and returns snapshots', () => {
    const b = new CircuitBuilder(registry, { id: 'clock', name: 'Clock module' });
    const before = b.build();
    b.add('H1', 'test/high', { at: [0, 0] });
    expect(before.components).toEqual([]);
    expect(b.build()).toMatchObject({ id: 'clock', name: 'Clock module' });
  });

  it('throws on programming mistakes', () => {
    const b = builder().add('U1', 'test/and', { at: [0, 0] });
    expect(() => b.add('U1', 'test/and', { at: [5, 5] })).toThrow('duplicate id "U1"');
    expect(() => b.add('U.2', 'test/and', { at: [5, 5] })).toThrow('bad id "U.2"');
    expect(() => b.add('U3', 'test/nope', { at: [5, 5] })).toThrow('unknown part type "test/nope"');
    expect(() => b.add('U4', 'test/and', { at: [5, 5], props: { inputs: 7 } })).toThrow(
      'U4: prop "inputs" must be ≤ 4, got 7',
    );
    expect(() => b.pin('U9.A')).toThrow('no component "U9" (in pin "U9.A")');
    expect(() => b.pin('U1.Q')).toThrow('component "U1" has no pin "Q" (pins: A, B, Y)');
    expect(() => b.wire([0, 0], [3, 3])).toThrow('wire segment (0,0) → (3,3) is diagonal');
    expect(() => b.wire([0, 0])).toThrow('a wire needs at least two points');
  });
});
