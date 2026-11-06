import { describe, expect, it } from 'vitest';
import { ns } from '../../src/core';
import { Trace } from '../../src/core/testing';
import { kinds, levels, set, simulate } from './support';

/** S̄R̄ latch from two cross-coupled NANDs: Q = NAND(S̄, Q̄), Q̄ = NAND(R̄, Q). */
const latch = () =>
  simulate((b) =>
    b
      .add('S', 'test/driver')
      .add('R', 'test/driver')
      .add('U1', 'prim/nand')
      .add('U2', 'prim/nand')
      .net('sn', 'S.Y', 'U1.A')
      .net('rn', 'R.Y', 'U2.A')
      .net('Q', 'U1.Y', 'U2.B')
      .net('QN', 'U2.Y', 'U1.B'),
  );

describe('SR latch from two NANDs', () => {
  it('powers up unknown (X) while both inputs are inactive: it needs a set or reset', () => {
    const sim = latch();
    set(sim, 'S', 1);
    set(sim, 'R', 1);
    expect(sim.settle()).toBe('idle');
    expect(levels(sim, 'Q', 'QN')).toBe('XX');
  });

  it('sets, holds, resets and holds', () => {
    const sim = latch();
    set(sim, 'S', 1);
    set(sim, 'R', 1);
    sim.settle();

    set(sim, 'S', 0); // set
    sim.settle();
    expect(levels(sim, 'Q', 'QN')).toBe('10');
    set(sim, 'S', 1); // hold
    sim.settle();
    expect(levels(sim, 'Q', 'QN')).toBe('10');

    set(sim, 'R', 0); // reset
    sim.settle();
    expect(levels(sim, 'Q', 'QN')).toBe('01');
    set(sim, 'R', 1); // hold
    sim.settle();
    expect(levels(sim, 'Q', 'QN')).toBe('01');
    expect(kinds(sim)).toEqual([]);
  });

  it('sets with the expected timing: Q after one gate delay, Q̄ after two', () => {
    const sim = latch();
    set(sim, 'S', 1);
    set(sim, 'R', 0);
    sim.settle();
    const trace = new Trace(sim);
    const t0 = sim.now;
    set(sim, 'R', 1);
    set(sim, 'S', 0);
    sim.settle();
    expect(trace.lines().map((l) => l.replace(/^\d+/, (t) => String(Number(t) - t0)))).toEqual([
      '0 rn=1',
      '0 sn=0',
      `${ns(1)} Q=1`,
      `${ns(2)} QN=0`,
    ]);
  });

  it('both inputs active forces Q = Q̄ = 1; releasing both together races and oscillates', () => {
    const sim = latch();
    set(sim, 'S', 0);
    set(sim, 'R', 0);
    sim.settle();
    expect(levels(sim, 'Q', 'QN')).toBe('11');
    const trace = new Trace(sim);
    set(sim, 'S', 1);
    set(sim, 'R', 1);
    // Identical gate delays: both NANDs switch together forever (the "forbidden state" race).
    expect(sim.settle({ maxTime: ns(20) })).toBe('reached');
    expect(trace.of('Q').length).toBeGreaterThanOrEqual(10);
  });
});
