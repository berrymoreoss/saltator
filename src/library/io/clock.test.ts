import { describe, expect, it } from 'vitest';
import { ms, ns, us } from '../../core';
import { Bench, Trace } from '../../core/testing';
import { clock, clockPhases } from './clock';

/** Edges of Y as `time=level` up to and including `until`. */
function edges(props: Record<string, unknown>, until: number): string[] {
  const bench = new Bench(clock, props);
  const trace = new Trace(bench.sim);
  bench.run(until);
  return trace.of('Y').map(([t, level]) => `${t}=${level}`);
}

describe('clockPhases', () => {
  it('rounds the period and the high time to whole picoseconds', () => {
    expect(clockPhases(1, 50)).toEqual({ high: 5e11, low: 5e11 });
    expect(clockPhases(1e6, 25)).toEqual({ high: 250_000, low: 750_000 });
    expect(clockPhases(3e6, 50)).toEqual({ high: 166_667, low: 166_666 }); // period 333 333 ps
    expect(clockPhases(1e9, 1)).toEqual({ high: 10, low: 990 }); // the extremes of the limits
    expect(clockPhases(0.001, 99)).toEqual({ high: 99e13, low: 1e13 });
  });
});

describe('io/clock', () => {
  it('starts low, rises after the low time and keeps the period and duty exactly', () => {
    // 1 MHz, 25 %: high 250 ns, low 750 ns.
    expect(edges({ frequency: 1e6, duty: 25 }, ns(2900))).toEqual([
      '0=0',
      '750000=1',
      '1000000=0',
      '1750000=1',
      '2000000=0',
      '2750000=1',
    ]);
  });

  it('defaults to 1 Hz, 50 %, free-running', () => {
    expect(edges({}, ms(2400))).toEqual([
      '0=0',
      '500000000000=1',
      '1000000000000=0',
      '1500000000000=1',
      '2000000000000=0',
    ]);
  });

  it('in manual mode, stays low and emits one pulse of the high time per step', () => {
    const bench = new Bench(clock, { frequency: 1e6, mode: 'manual' }); // high 500 ns
    const trace = new Trace(bench.sim);
    bench.run(us(2));
    bench.action({ type: 'step' });
    expect(bench.sim.stateOf('DUT')).toEqual({ high: true });
    bench.run(ns(100));
    bench.action({ type: 'step' }); // during the pulse: ignored
    bench.run(us(1));
    bench.action({ type: 'step' });
    bench.run(us(1));
    expect(trace.of('Y').map(([t, level]) => `${t}=${level}`)).toEqual([
      '0=0',
      '2000000=1',
      '2500000=0',
      '3100000=1',
      '3600000=0',
    ]);
    expect(bench.sim.stateOf('DUT')).toEqual({ high: false });
  });

  it('ignores steps while free-running', () => {
    const bench = new Bench(clock, { frequency: 1e6 });
    const trace = new Trace(bench.sim);
    bench.run(ns(100));
    bench.action({ type: 'step' });
    bench.run(ns(899));
    expect(trace.lines()).toEqual(['0 Y=0', '500000 Y=1']);
  });

  it('rejects unknown actions and out-of-range props', () => {
    expect(() => new Bench(clock).action({ type: 'tick' })).toThrow(
      'DUT: unknown action {"type":"tick"}',
    );
    expect(() => new Bench(clock, { frequency: 0 })).toThrow('prop "frequency" must be ≥ 0.001');
    expect(() => new Bench(clock, { frequency: 2e9 })).toThrow('must be ≤ 1000000000');
    expect(() => new Bench(clock, { duty: 100 })).toThrow('prop "duty" must be ≤ 99');
    expect(() => new Bench(clock, { mode: 'step' })).toThrow('prop "mode" must be one of');
  });
});
