/**
 * Circuits drawn as documents (geometry, wires) compile to netlists that simulate exactly like
 * the same circuits written with `NetlistBuilder`.
 */
import { describe, expect, it } from 'vitest';
import {
  CircuitBuilder,
  compileCircuit,
  compileDocument,
  parseDocument,
  serializeDocument,
} from '../../src/circuit';
import { NetlistBuilder, ns, Simulator } from '../../src/core';
import { Trace } from '../../src/core/testing';
import { levels, scenarioRegistry, set } from './support';

const registry = scenarioRegistry();

// Pin positions of parts placed at (x, y) — generic box layout:
//   test/driver: Y (x+5, y+1)
//   prim/nand:   A (x, y+1), B (x, y+2), Y (x+5, y+1)
//   prim/not:    A (x, y+1), Y (x+5, y+1)

/**
 * S̄R̄ latch from two NANDs. The two feedback wires cross at (17, 4) without connecting — if they
 * connected, Q and Q̄ would be shorted.
 */
function drawnLatch() {
  return new CircuitBuilder(registry)
    .add('S', 'test/driver', { at: [0, 0] })
    .add('R', 'test/driver', { at: [0, 10] })
    .add('U1', 'prim/nand', { at: [10, 0] })
    .add('U2', 'prim/nand', { at: [10, 10] })
    .connect('S.Y', 'U1.A')
    .connect('R.Y', 'U2.A')
    .connect('U1.Y', 'U2.B', [17, 1], [17, 6], [8, 6], [8, 12])
    .connect('U2.Y', 'U1.B', [18, 11], [18, 4], [7, 4], [7, 2])
    .document();
}

/** The same latch in code; net ids follow the compiler's naming (first driver pin). */
const codedLatch = () =>
  new NetlistBuilder()
    .add('S', 'test/driver')
    .add('R', 'test/driver')
    .add('U1', 'prim/nand')
    .add('U2', 'prim/nand')
    .connect('S.Y', 'U1.A')
    .connect('R.Y', 'U2.A')
    .connect('U1.Y', 'U2.B')
    .connect('U2.Y', 'U1.B')
    .build();

/** Reset, set, hold, reset again; returns the full trace. */
function exerciseLatch(sim: Simulator): string[] {
  const trace = new Trace(sim);
  for (const [s, r] of [
    [1, 0],
    [1, 1],
    [0, 1],
    [1, 1],
    [1, 0],
  ] as const) {
    set(sim, 'S', s);
    set(sim, 'R', r);
    sim.runFor(ns(10));
  }
  return trace.lines();
}

describe('circuit documents → netlist → simulation', () => {
  it('a drawn SR latch compiles cleanly, with crossing wires kept apart', () => {
    const result = compileDocument(drawnLatch(), registry);
    expect(result.issues).toEqual([]);
    expect(result.junctions).toEqual([]);
    expect(
      result.netlist.nets.map((n) => [n.id, n.pins.map((p) => `${p.component}.${p.pin}`)]),
    ).toEqual([
      ['S.Y', ['S.Y', 'U1.A']],
      ['R.Y', ['R.Y', 'U2.A']],
      ['U2.Y', ['U1.B', 'U2.Y']],
      ['U1.Y', ['U1.Y', 'U2.B']],
    ]);
  });

  it('a drawn SR latch behaves exactly like the coded one', () => {
    const drawn = new Simulator(compileDocument(drawnLatch(), registry).netlist, registry);
    const coded = new Simulator(codedLatch(), registry);
    const trace = exerciseLatch(drawn);
    expect(trace).toEqual(exerciseLatch(coded));
    expect(levels(drawn, 'U1.Y', 'U2.Y')).toBe('01'); // reset at the end
    expect(trace).toContain(`${ns(20) + ns(1)} U1.Y=1`); // set: Q rises one gate delay later
    expect(drawn.diagnostics.entries).toEqual([]);
  });

  it('a T-junction fan-out drives every branch, like the coded net', () => {
    // D.Y (5, 1) feeds a bus along y = 1; drops at x = 10 and 20 are T-junctions, x = 30 a corner.
    const document = new CircuitBuilder(registry)
      .add('D', 'test/driver', { at: [0, 0] })
      .add('N1', 'prim/not', { at: [10, 5] })
      .add('N2', 'prim/not', { at: [20, 5] })
      .add('N3', 'prim/not', { at: [30, 5] })
      .wire('D.Y', [30, 1], 'N3.A')
      .wire([10, 1], 'N1.A')
      .wire([20, 1], 'N2.A')
      .document();
    const result = compileDocument(document, registry);
    expect(result.issues).toEqual([]);
    expect(result.junctions).toEqual([
      [10, 1],
      [20, 1],
    ]);
    const coded = new NetlistBuilder()
      .add('D', 'test/driver')
      .add('N1', 'prim/not')
      .add('N2', 'prim/not')
      .add('N3', 'prim/not')
      .connect('D.Y', 'N3.A', 'N1.A', 'N2.A')
      .build();
    const run = (sim: Simulator) => {
      const trace = new Trace(sim);
      for (const value of [0, 1, 0] as const) {
        set(sim, 'D', value);
        sim.runFor(ns(5));
      }
      return trace.lines();
    };
    const drawn = new Simulator(result.netlist, registry);
    const lines = run(drawn);
    expect(lines).toEqual(run(new Simulator(coded, registry)));
    expect(levels(drawn, 'N1.Y', 'N2.Y', 'N3.Y')).toBe('111');
  });

  it('save → load → compile gives the same netlist', () => {
    const document = drawnLatch();
    const reloaded = parseDocument(serializeDocument(document));
    expect(reloaded).toEqual(document);
    expect(compileDocument(reloaded, registry).netlist).toEqual(
      compileDocument(document, registry).netlist,
    );
  });

  it('design checks know pull resistors from push-pull outputs', () => {
    const b = new CircuitBuilder(registry)
      .add('K1', 'prim/constant', { at: [0, 0] })
      .add('R1', 'prim/pull', { at: [0, 5] })
      .add('K2', 'prim/constant', { at: [0, 10], props: { value: '0' } })
      .wire('K1.Y', 'R1.Y');
    expect(compileCircuit(b.build(), registry).issues).toEqual([]);
    b.wire('R1.Y', 'K2.Y');
    expect(compileCircuit(b.build(), registry).issues.map((i) => i.message)).toEqual([
      'outputs shorted together on net "K1.Y": K1.Y, K2.Y',
    ]);
  });
});
