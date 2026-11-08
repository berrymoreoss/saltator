import { describe, expect, it } from 'vitest';
import { Level } from '../logic';
import { testDriver } from '../test-driver';
import { ns } from '../time';
import { Bench } from './bench';
import { Trace } from './trace';

const build = () => {
  const bench = new Bench(testDriver);
  return { bench, trace: new Trace(bench.sim) };
};

describe('Trace', () => {
  it('records net changes in order', () => {
    const { bench, trace } = build();
    bench.action(8).run(ns(1)); // STRONG_0
    bench.action(9).run(ns(1)); // STRONG_1
    expect(trace.length).toBe(2);
    expect(trace.lines()).toEqual(['0 Y=0', '1000 Y=1']);
    expect(trace.of('Y')).toEqual([
      [0, Level.L0],
      [ns(1), Level.L1],
    ]);
    trace.stop();
    bench.action(8).run(ns(1));
    expect(trace.length).toBe(2);
  });

  it('hashes equal traces equally and different traces differently', () => {
    const run = (drives: number[]) => {
      const { bench, trace } = build();
      for (const d of drives) bench.action(d).run(ns(1) * 2 ** 33); // times beyond 32 bits
      return trace.hash();
    };
    expect(run([8, 9, 8])).toBe(run([8, 9, 8]));
    expect(run([8, 9, 8])).not.toBe(run([8, 9, 9]));
    expect(run([])).toBe(0x811c9dc5);
  });
});
