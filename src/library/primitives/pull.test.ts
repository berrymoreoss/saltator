import { describe, expect, it } from 'vitest';
import { Drive, NetlistBuilder, Registry, Simulator } from '../../core';
import { Bench, Trace } from '../../core/testing';
import { primitives } from './index';
import { pull } from './pull';

const registry = new Registry(primitives);

describe('prim/pull', () => {
  it.each([
    ['up', Drive.WEAK_1],
    ['down', Drive.WEAK_0],
  ] as const)('pull-%s drives weakly from t = 0', (direction, drive) => {
    const bench = new Bench(pull, { direction });
    const trace = new Trace(bench.sim);
    bench.settle();
    expect(bench.sim.drives[bench.sim.netIndex('Y')]).toBe(drive);
    expect(trace.lines()).toEqual([`0 Y=${drive & 1}`]);
  });

  it('declares its pin weak, so design checks do not count it as a push-pull output', () => {
    expect(pull.pins).toEqual([{ name: 'Y', dir: 'out', weak: true }]);
  });

  it('defaults to pull-up', () => {
    const bench = new Bench(pull);
    bench.settle();
    bench.expect({ Y: 1 });
  });

  it('is overridden by a strong driver; two opposite pulls give weak X', () => {
    const netlist = new NetlistBuilder()
      .add('R1', 'prim/pull', { direction: 'up' })
      .add('R2', 'prim/pull', { direction: 'down' })
      .add('K', 'prim/constant', { value: '0' })
      .net('weak', 'R1.Y', 'R2.Y')
      .add('R3', 'prim/pull', { direction: 'up' })
      .net('pressed', 'R3.Y', 'K.Y')
      .build();
    const sim = new Simulator(netlist, registry);
    sim.settle();
    expect(sim.drives[sim.netIndex('weak')]).toBe(Drive.WEAK_X);
    expect(sim.drives[sim.netIndex('pressed')]).toBe(Drive.STRONG_0);
    expect(sim.diagnostics.entries).toEqual([]);
  });
});
