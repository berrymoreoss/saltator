import { describe, expect, it } from 'vitest';
import {
  isTimingViolation,
  KernelDiagnosticKind,
  Level,
  ns,
  pinsOf,
  type Time,
  TimingViolation,
  us,
} from '../../core';
import { Bench, type BenchValues, checkableRows, functionTable } from '../../core/testing';
import { hcRippleCounters } from './ripple-counter';

const d = hcRippleCounters.find((c) => c.name === '74HC4040')!;
const timing = (b: Bench) => b.diagnostics.filter((x) => isTimingViolation(x.kind));
const messages = (b: Bench) => timing(b).map((x) => x.message);
const STAGES = 12;
/** `{ Q0: …, Q1: … }` for the low `bits` bits of `value`. */
const word = (value: number, bits = STAGES): BenchValues =>
  Object.fromEntries(Array.from({ length: bits }, (_, n) => [`Q${n}`, (value >> n) & 1 ? 1 : 0]));

/** Cleared long ago, CP HIGH (the next falling edge counts). */
function bench(): Bench {
  const b = new Bench(d);
  b.set({ CP: 1, MR: 1 }).run(us(1));
  b.set({ MR: 0 }).run(us(1));
  return b;
}
/** One count: CP falls (and rises again). */
const tick = (b: Bench, period: Time = us(2)) => {
  b.set({ CP: 0 }).run(period / 2);
  b.set({ CP: 1 }).run(period / 2);
};
/** Counts `n` times, fast (a 32 ns period: the minimum pulse widths). */
const count = (b: Bench, n: number) => {
  for (let i = 0; i < n; i++) tick(b, ns(32));
  b.run(us(1));
};

describe('74HC4040', () => {
  it('follows its function table, by pin number', () => {
    const b = bench();
    const pinNames = pinsOf(d, {}).map((p) => p.name);
    expect([10, 11, 9].map((n) => pinNames[n - 1])).toEqual(['CP', 'MR', 'Q0']);
    // Both end with CP LOW, so the row's ↑ starts from LOW without a falling edge (a count).
    const states: BenchValues[][] = [
      [{ CP: 0, MR: 1 }, { MR: 0 }],
      [{ CP: 1, MR: 1 }, { MR: 0 }, { CP: 0 }],
    ];
    // No change from both states, reset; "count" is checked below.
    expect(functionTable(b, checkableRows(d.functionTable!), ['CP', 'MR', 'Q0'], { states })).toBe(
      4,
    );
    expect(b.diagnostics).toEqual([]);
  });

  it('counts on the falling edge through all 4096 states and wraps', () => {
    const b = bench();
    b.set({ CP: 0 }).run(us(1));
    b.expect(word(1));
    b.set({ CP: 1 }).run(us(1));
    b.expect(word(1));
    count(b, 1000);
    b.expect(word(1001));
    count(b, 3094);
    b.expect(word(4095));
    count(b, 1);
    b.expect(word(0));
    expect(b.diagnostics).toEqual([]);
  });

  it('ripples: output n changes 17 + 10·n ns after the clock', () => {
    const b = bench();
    count(b, 2047);
    b.expect(word(2047));
    const changes: [string, Time][] = [];
    const nets = Array.from({ length: STAGES }, (_, n) => b.sim.netIndex(`Q${n}`));
    const start = b.now;
    const off = b.sim.onNetChange((t, net) => {
      const n = nets.indexOf(net);
      if (n >= 0) changes.push([`Q${n}`, t - start]);
    });
    b.set({ CP: 0 }).run(us(1));
    off();
    expect(changes).toEqual(Array.from({ length: STAGES }, (_, n) => [`Q${n}`, ns(17 + 10 * n)]));
    b.expect(word(2048));
  });

  it('passes through the intermediate counts, as decoding gates would see', () => {
    const b = bench();
    count(b, 7);
    const seen: number[] = [];
    const nets = [0, 1, 2, 3].map((n) => b.sim.netIndex(`Q${n}`));
    const off = b.sim.onNetChange((_, net) => {
      if (!nets.includes(net)) return;
      seen.push(nets.reduce((v, id, n) => v | (b.sim.level(id) === Level.L1 ? 1 << n : 0), 0));
    });
    b.set({ CP: 0 }).run(us(1));
    off();
    expect(seen).toEqual([0b0110, 0b0100, 0b0000, 0b1000]);
  });

  it('clears at once while MR is HIGH, ignoring the clock', () => {
    const b = bench();
    count(b, 5);
    expect(b.measure({ MR: 1 }, 'Q0')).toBe(ns(22));
    b.expect(word(0));
    tick(b);
    b.expect(word(0)).expectNoDiagnostics();
  });

  it('is unknown from power-on until reset; counting keeps it unknown', () => {
    const b = new Bench(d);
    b.set({ CP: 1, MR: 0 }).run(us(1));
    b.expect({ Q0: 'X', Q11: 'X' });
    tick(b);
    b.expect({ Q0: 'X', Q11: 'X' });
    b.set({ MR: 1 }).run(us(1));
    b.expect(word(0));
  });

  it('makes X only the bits an uncertain clock edge could change', () => {
    const b = bench();
    count(b, 5); // 0101 → 0110
    b.set({ CP: 'X' }).run(us(1));
    b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0, Q4: 0 });
  });

  it('merges an unknown MR, and reports it floating', () => {
    const b = bench();
    count(b, 5);
    b.set({ MR: 'Z' }).run(us(1));
    b.expect({ Q0: 'X', Q1: 0, Q2: 'X', Q3: 0 });
    expect(b.diagnostics.map((x) => `${x.kind} ${x.net}`)).toEqual([
      `${KernelDiagnosticKind.FLOATING_INPUT} MR`,
    ]);
  });

  describe('timing checks', () => {
    it('clock pulse width, both phases', () => {
      const b = bench();
      count(b, 5);
      b.set({ CP: 0 }).run(ns(15)); // 6
      b.set({ CP: 1 }).run(us(1));
      expect(messages(b)).toEqual(['CP was LOW for only 15 ns (pulse width ≥ 16 ns)']);
      b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
      const c = bench();
      count(c, 5);
      c.set({ CP: 0 }).run(us(1)); // 6
      c.set({ CP: 1 }).run(ns(15));
      c.set({ CP: 0 }).run(us(1));
      expect(messages(c)).toEqual(['CP was HIGH for only 15 ns (pulse width ≥ 16 ns)']);
      c.expect({ Q0: 'X', Q1: 1, Q2: 1, Q3: 0 }); // 0110 or 0111
    });

    it('MR pulse width: a short pulse makes X the bits it cleared', () => {
      const pulse = (width: number) => {
        const b = bench();
        count(b, 5);
        b.set({ MR: 1 }).run(ns(width));
        b.set({ MR: 0 }).run(us(1));
        return b;
      };
      expect(timing(pulse(16))).toEqual([]);
      const b = pulse(15);
      expect(messages(b)).toEqual(['MR was HIGH for only 15 ns (pulse width ≥ 16 ns)']);
      b.expect({ Q0: 'X', Q1: 0, Q2: 'X', Q3: 0 });
    });

    it('recovery: an edge too soon after MR is released counts X', () => {
      const recover = (after: number) => {
        const b = bench();
        b.set({ MR: 1 }).run(us(1));
        b.set({ MR: 0 }).run(ns(after));
        b.set({ CP: 0 }).run(us(1));
        return b;
      };
      expect(timing(recover(10))).toEqual([]);
      recover(10).expect(word(1));
      const b = recover(9);
      expect(messages(b)).toEqual(['CP fell 9 ns after MR was released (recovery time ≥ 10 ns)']);
      b.expect({ Q0: 'X', Q1: 0 });
      expect(timing(b)[0]!.kind).toBe(TimingViolation.RECOVERY);
    });

    it('checks nothing on a clock running while MR holds it cleared', () => {
      const b = bench();
      b.set({ MR: 1 }).run(us(1));
      for (let i = 0; i < 4; i++) tick(b, ns(10));
      expect(timing(b)).toEqual([]);
    });
  });
});
