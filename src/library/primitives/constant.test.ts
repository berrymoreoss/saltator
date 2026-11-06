import { describe, expect, it } from 'vitest';
import { Drive, Level } from '../../core';
import { Bench, Trace } from '../../core/testing';
import { constant } from './constant';

describe('prim/constant', () => {
  it.each([
    ['0', Level.L0],
    ['1', Level.L1],
    ['X', Level.X],
  ] as const)('drives %s strongly from t = 0', (value, level) => {
    const bench = new Bench(constant, { value });
    const trace = new Trace(bench.sim);
    bench.settle();
    expect(bench.get('Y')).toBe(level);
    expect(bench.sim.drives[bench.sim.netIndex('Y')]).toBe(
      level === Level.X ? Drive.STRONG_X : 8 | level,
    );
    // Timing: the level is there at t = 0 (an X constant never changes from power-on X).
    expect(trace.lines()).toEqual(value === 'X' ? [] : [`0 Y=${value}`]);
  });

  it('marks a 0 or 1 output constant (a rail for design checks), but not X', () => {
    expect(new Bench(constant, { value: '0' }).pins).toEqual([
      { name: 'Y', dir: 'out', constant: 0 },
    ]);
    expect(new Bench(constant, { value: '1' }).pins[0]?.constant).toBe(1);
    expect(new Bench(constant, { value: 'X' }).pins).toEqual([{ name: 'Y', dir: 'out' }]);
  });

  it('defaults to 1 and rejects other values', () => {
    const bench = new Bench(constant);
    bench.settle();
    bench.expect({ Y: 1 });
    expect(() => new Bench(constant, { value: 'Z' })).toThrow(
      'prop "value" must be one of "0", "1", "X"',
    );
  });
});
