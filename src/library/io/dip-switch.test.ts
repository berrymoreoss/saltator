import { describe, expect, it } from 'vitest';
import { ns } from '../../core';
import { Bench, Trace } from '../../core/testing';
import { dipSwitch, MAX_DIP_SWITCHES } from './dip-switch';

describe('io/dip-switch', () => {
  it('has `count` switches S1…Sn, SPST to VCC and all off by default', () => {
    const bench = new Bench(dipSwitch);
    expect(bench.pins.map((p) => p.name)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    expect(bench.pins.every((p) => p.dir === 'tristate')).toBe(true);
    bench.settle();
    expect(Object.values(bench.levels()).join('')).toBe('ZZZZZZZZ');
    bench.expectNoDiagnostics();
  });

  it.each([
    ['spdt', '1010'],
    ['spst-vcc', '1Z1Z'],
    ['spst-gnd', '0Z0Z'],
  ] as const)('%s: power-on positions from the bitmask (bit 0 = S1)', (contact, levels) => {
    const bench = new Bench(dipSwitch, { count: 4, contact, on: 0b0101 });
    bench.settle();
    expect(Object.values(bench.levels()).join('')).toBe(levels);
    expect(bench.sim.stateOf('DUT')).toEqual({ on: [true, false, true, false] });
  });

  it('ignores bits above `count`', () => {
    const bench = new Bench(dipSwitch, { count: 2, contact: 'spdt', on: 0b1110 });
    bench.settle();
    expect(bench.levels()).toEqual({ S1: '0', S2: '1' });
  });

  it('toggles and sets one switch at the time of the action', () => {
    const bench = new Bench(dipSwitch, { count: 3, contact: 'spdt' });
    const trace = new Trace(bench.sim);
    bench.settle();
    bench.run(ns(1));
    bench.action({ type: 'toggle', index: 2 });
    bench.run(ns(1));
    bench.action({ type: 'set', index: 0, on: true });
    bench.action({ type: 'set', index: 2, on: false });
    bench.settle();
    expect(trace.lines()).toEqual([
      '0 S1=0',
      '0 S2=0',
      '0 S3=0',
      '1000 S3=1',
      '2000 S1=1',
      '2000 S3=0',
    ]);
    expect(bench.sim.stateOf('DUT')).toEqual({ on: [true, false, false] });
  });

  it('allows 1 to 12 switches', () => {
    expect(new Bench(dipSwitch, { count: 1 }).pins).toHaveLength(1);
    expect(new Bench(dipSwitch, { count: MAX_DIP_SWITCHES }).pins).toHaveLength(12);
    expect(() => new Bench(dipSwitch, { count: 13 })).toThrow('prop "count" must be ≤ 12');
    expect(() => new Bench(dipSwitch, { on: 4096 })).toThrow('prop "on" must be ≤ 4095');
  });

  it('rejects unknown actions and switch indices out of range', () => {
    const bench = new Bench(dipSwitch, { count: 4 });
    expect(() => bench.action({ type: 'toggle', index: 4 })).toThrow(
      'DUT: unknown action {"type":"toggle","index":4}',
    );
    expect(() => bench.action({ type: 'toggle' })).toThrow('unknown action');
    expect(() => bench.action({ type: 'toggle', index: 1.5 })).toThrow('unknown action');
    expect(() => bench.action({ type: 'set', index: 0 })).toThrow('unknown action');
    expect(() => bench.action({ type: 'flip', index: 0 })).toThrow('unknown action');
  });
});
