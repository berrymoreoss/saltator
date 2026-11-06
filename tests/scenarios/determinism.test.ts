import { describe, expect, it } from 'vitest';
import { ns, us } from '../../src/core';
import { Trace } from '../../src/core/testing';
import { set, simulate } from './support';

/**
 * A busy little circuit: a 5-stage ring oscillator whose phases feed XOR/XNOR gates (one with
 * zero delay, so same-time delta cycles happen) and a NAND latch.
 */
function busy() {
  const sim = simulate((b) => {
    b.add('EN', 'test/driver')
      .add('N0', 'prim/nand', { delay: ns(1) })
      .connect('EN.Y', 'N0.A');
    let previous = 'N0.Y';
    for (let i = 1; i < 5; i++) {
      b.add(`I${i}`, 'prim/not', { delay: ns(1) }).connect(previous, `I${i}.A`);
      previous = `I${i}.Y`;
    }
    return b
      .connect(previous, 'N0.B')
      .add('X1', 'prim/xor', { delay: 0 })
      .add('X2', 'prim/xor', { delay: ns(2) })
      .add('X3', 'prim/xnor', { inputs: 3, delay: ns(3) })
      .connect(previous, 'X1.A', 'X3.A')
      .connect('I2.Y', 'X1.B')
      .connect('X1.Y', 'X2.A', 'X3.B')
      .connect('I1.Y', 'X2.B')
      .connect('X2.Y', 'X3.C')
      .add('L1', 'prim/nand')
      .add('L2', 'prim/nand')
      .connect('X3.Y', 'L1.A')
      .connect('X1.Y', 'L2.A')
      .connect('L1.Y', 'L2.B')
      .connect('L2.Y', 'L1.B');
  });
  const trace = new Trace(sim);
  set(sim, 'EN', 0);
  sim.runFor(ns(5));
  set(sim, 'EN', 1);
  sim.runFor(us(1));
  set(sim, 'EN', 0);
  sim.runFor(us(1));
  return { sim, trace };
}

describe('determinism', () => {
  it('two runs of the same netlist and stimulus produce identical traces', () => {
    const a = busy();
    const b = busy();
    expect(a.trace.length).toBeGreaterThan(500);
    expect(a.trace.lines().some((l) => /L1\.Y=[01]$/.test(l))).toBe(true); // the latch resolves
    expect(b.trace.lines()).toEqual(a.trace.lines());
    expect(b.trace.hash()).toBe(a.trace.hash());
    expect(b.sim.stats).toEqual(a.sim.stats);
    expect(b.sim.diagnostics.entries).toEqual(a.sim.diagnostics.entries);
  });
});
