import { describe, expect, it } from 'vitest';
import { Level, type NetlistBuilder, ns, type Time } from '../../src/core';
import { Trace } from '../../src/core/testing';
import { kinds, levels, set, simulate } from './support';

/**
 * N inverting stages in a loop: NAND(EN, last) followed by N − 1 inverters, each with delay d.
 * A ring of plain inverters would start at X and stay X forever (not X = X), so the NAND's
 * enable is how a real ring oscillator is started too. Period = 2 · N · d.
 */
function ring(stages: number, delay: Time) {
  return (b: NetlistBuilder) => {
    b.add('EN', 'test/driver').add('N0', 'prim/nand', { delay }).net('en', 'EN.Y', 'N0.A');
    b.net('n0', 'N0.Y');
    let previous = 'N0.Y';
    for (let i = 1; i < stages; i++) {
      b.add(`I${i}`, 'prim/not', { delay }).net(`n${i}`, `I${i}.Y`).connect(previous, `I${i}.A`);
      previous = `I${i}.Y`;
    }
    return b.connect(previous, 'N0.B');
  };
}

function risingEdges(trace: Trace, net: string): Time[] {
  return trace
    .of(net)
    .flatMap(([t, level], i, all) =>
      level === Level.L1 && all[i - 1]?.[1] === Level.L0 ? [t] : [],
    );
}

describe('ring oscillator', () => {
  it.each([
    [5, ns(1)],
    [3, ns(2.5)],
    [7, ns(4)],
  ])('%i stages × %i ps oscillate with period 2·N·d', (stages, delay) => {
    const sim = simulate(ring(stages, delay));
    set(sim, 'EN', 0);
    expect(sim.settle()).toBe('idle'); // held: stable
    const trace = new Trace(sim);
    set(sim, 'EN', 1);
    const period = 2 * stages * delay;
    expect(sim.runFor(20 * period)).toBe('reached'); // never settles
    const edges = risingEdges(trace, 'n0');
    expect(edges.length).toBeGreaterThanOrEqual(18);
    const gaps = new Set(edges.slice(1).map((t, i) => t - edges[i]!));
    expect([...gaps]).toEqual([period]);
    // 50 % duty cycle: every stage has the same rise and fall delay.
    const changes = trace.of('n0').map(([t]) => t);
    const halves = new Set(changes.slice(1).map((t, i) => t - changes[i]!));
    expect([...halves]).toEqual([period / 2]);
    expect(kinds(sim)).toEqual([]);
  });

  it('stops when disabled and holds the stable state', () => {
    const sim = simulate(ring(5, ns(1)));
    set(sim, 'EN', 1);
    sim.runFor(ns(57));
    set(sim, 'EN', 0);
    expect(sim.settle()).toBe('idle');
    expect(levels(sim, 'n0')).toBe('1');
  });

  it('a plain inverter ring starts at X and stays X (4-state pessimism)', () => {
    const sim = simulate((b) =>
      b
        .add('I1', 'prim/not')
        .add('I2', 'prim/not')
        .add('I3', 'prim/not')
        .connect('I1.Y', 'I2.A')
        .connect('I2.Y', 'I3.A')
        .connect('I3.Y', 'I1.A'),
    );
    expect(sim.settle()).toBe('idle');
    expect(levels(sim, 'I1.Y', 'I2.Y', 'I3.Y')).toBe('XXX');
  });

  it('a zero-delay ring is an oscillation: the run halts with a diagnostic', () => {
    const sim = simulate(ring(5, 0));
    set(sim, 'EN', 0);
    sim.settle();
    set(sim, 'EN', 1);
    expect(sim.runFor(ns(1))).toBe('halted');
    expect(sim.halted).toBe(true);
    expect(kinds(sim)).toEqual(['oscillation']);
    expect(sim.diagnostics.entries[0]?.message).toContain('more than 1000 delta cycles at 0 ps');
  });
});
