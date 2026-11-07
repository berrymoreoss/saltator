import { describe, expect, it } from 'vitest';
import {
  type AnyComponentDefinition,
  isTimingViolation,
  KernelDiagnosticKind,
  ns,
  pinsOf,
  TimingViolation,
  us,
} from '../../core';
import { Bench, type BenchValues, functionTable } from '../../core/testing';
import { hcFlipFlops } from './flip-flops';

const chip = (number: string) => hcFlipFlops.find((d) => d.name === `74HC${number}`)!;
const names = (d: AnyComponentDefinition, numbers: readonly number[]) =>
  numbers.map((n) => pinsOf(d, {}).find((p) => p.number === n)!.name);
const timing = (b: Bench) => b.diagnostics.filter((d) => isTimingViolation(d.kind));

/** Generic names (`nD`) of flip-flop `n`, for `Bench.set`. */
const of = (n: 1 | 2, values: Record<string, 0 | 1 | 'X' | 'Z'>): BenchValues =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k.replace(/^n/, String(n)), v]));

describe('74HC74', () => {
  const hc74 = chip('74');
  // From the pinning figure, per flip-flop: SD, RD, CP, D, Q, Q̅.
  const UNIT_PINS = [
    [4, 1, 3, 2, 5, 6],
    [10, 13, 11, 12, 9, 8],
  ] as const;

  /** Both flip-flops idle (no set/reset, CP low, D low) and reset to 0, long ago. */
  function bench(): Bench {
    const b = new Bench(hc74);
    for (const n of [1, 2] as const) b.set(of(n, { nSD: 1, nRD: 0, nCP: 0, nD: 0 }));
    b.run(us(1));
    for (const n of [1, 2] as const) b.set(of(n, { nRD: 1 }));
    b.run(us(1));
    return b;
  }

  it.each([1, 2] as const)('follows its function tables, by pin number (flip-flop %s)', (n) => {
    const b = bench();
    const unit = names(hc74, UNIT_PINS[n - 1]!);
    expect(unit).toEqual(hc74.units![n - 1]!.pins);
    const states = [
      [of(n, { nSD: 1, nRD: 0 }), of(n, { nRD: 1 })],
      [of(n, { nSD: 0, nRD: 1 }), of(n, { nSD: 1 })],
    ];
    // Three asynchronous rows × 4 don't-care combinations + two clocked rows.
    expect(functionTable(b, hc74.functionTable!, unit, { states })).toBe(14);
    expect(b.diagnostics).toEqual([]);
  });

  it('loads D on the rising edge only', () => {
    const b = bench();
    b.set({ '1D': 1 }).run(us(1));
    b.expect({ '1Q': 0, '1QN': 1 });
    b.set({ '1CP': 1 }).run(us(1));
    b.expect({ '1Q': 1, '1QN': 0 });
    b.set({ '1D': 0 }).run(us(1));
    b.set({ '1CP': 0 }).run(us(1)); // falling edge: nothing
    b.expect({ '1Q': 1, '2Q': 0 });
    expect(b.diagnostics).toEqual([]);
  });

  it('is unknown from power-on until it is set, reset or clocked', () => {
    const b = new Bench(hc74);
    b.set({ '1SD': 1, '1RD': 1, '1CP': 0, '1D': 1 }).run(us(1));
    b.expect({ '1Q': 'X', '1QN': 'X' });
    b.set({ '1CP': 1 }).run(us(1));
    b.expect({ '1Q': 1, '1QN': 0 });
  });

  it('gives Q = Q̅ = H with set and reset both active, and X when both are released at once', () => {
    const b = bench();
    b.set({ '1SD': 0, '1RD': 0 }).run(us(1));
    b.expect({ '1Q': 1, '1QN': 1 });
    b.set({ '1SD': 1, '1RD': 1 }).run(us(1));
    b.expect({ '1Q': 'X', '1QN': 'X' });
    // Released one after the other, the one still active decides.
    b.set({ '1SD': 0, '1RD': 0 }).run(us(1));
    b.set({ '1SD': 1 }).run(us(1));
    b.expect({ '1Q': 0, '1QN': 1 });
    b.set({ '1RD': 1 }).run(us(1));
    b.expect({ '1Q': 0, '1QN': 1 });
    expect(b.diagnostics).toEqual([]);
  });

  it('makes X only what an uncertain clock edge could change', () => {
    const b = bench();
    b.set({ '1CP': 'X' }).run(us(1)); // 0 → X with D = Q = 0: nothing could change
    b.expect({ '1Q': 0 });
    b.set({ '1CP': 0 }).run(us(1));
    b.set({ '1D': 1 }).run(us(1));
    b.set({ '1CP': 'X' }).run(us(1)); // might have loaded the 1
    b.expect({ '1Q': 'X', '1QN': 'X' });
    b.set({ '1CP': 1 }).run(us(1)); // X → 1 is not a clean edge either: still X
    b.expect({ '1Q': 'X' });
    b.set({ '1CP': 0 }).run(us(1));
    b.set({ '1CP': 1 }).run(us(1)); // a clean edge loads again
    b.expect({ '1Q': 1 });
  });

  it('merges what unknown set and reset inputs allow', () => {
    const b = bench(); // Q = 0
    b.set({ '1RD': 'X' }).run(us(1)); // reset or not: Q stays 0
    b.expect({ '1Q': 0, '1QN': 1 });
    b.set({ '1RD': 1, '1SD': 'X' }).run(us(1)); // set or not: unknown
    b.expect({ '1Q': 'X', '1QN': 'X' });
    b.set({ '1SD': 0 }).run(us(1));
    b.set({ '1SD': 'X' }).run(us(1)); // Q = 1 already: stays
    b.expect({ '1Q': 1, '1QN': 0 });
  });

  it('reports floating inputs: the clock always, D when an edge reads it', () => {
    const b = new Bench(hc74);
    b.set({ '1SD': 1, '1RD': 1, '2SD': 1, '2RD': 1, '2CP': 0, '2D': 0 }).run(us(1));
    const floating = () =>
      b.diagnostics.filter((d) => d.kind === KernelDiagnosticKind.FLOATING_INPUT).map((d) => d.net);
    expect(floating()).toEqual(['1CP']);
    b.set({ '1CP': 0 }).run(us(1));
    b.set({ '1CP': 1 }).run(us(1));
    expect(floating()).toEqual(['1CP', '1D']);
    b.expect({ '1Q': 'X' });
  });

  it('switches after the delay of each path', () => {
    const b = bench();
    b.set({ '1D': 1 }).run(us(1));
    expect(b.measure({ '1CP': 1 }, '1Q')).toBe(ns(17)); // nCP to nQ, nQ̅
    b.set({ '1CP': 0, '1D': 0 }).run(us(1));
    expect(b.measure({ '1CP': 1 }, '1QN')).toBe(ns(17));
    b.run(us(1));
    expect(b.measure({ '1SD': 0 }, '1Q')).toBe(ns(18)); // nSD to nQ, nQ̅
    b.set({ '1SD': 1 }).run(us(1));
    expect(b.measure({ '1RD': 0 }, '1QN')).toBe(ns(19)); // nRD to nQ, nQ̅
  });

  describe('timing checks', () => {
    /** A bench with D changed `before` ns before the rising edge (Q was 0, D becomes 1). */
    function setup(before: number) {
      const b = bench();
      b.set({ '1D': 1 }).run(ns(before));
      b.set({ '1CP': 1 }).run(us(1));
      return b;
    }

    it('set-up: 15 ns is enough; 14 ns reports and loads X', () => {
      setup(15).expect({ '1Q': 1 });
      const b = setup(14);
      expect(timing(b)).toMatchObject([
        {
          kind: TimingViolation.SETUP,
          component: 'DUT',
          pin: '1D',
          message: '1D changed 14 ns before 1CP rose (setup time ≥ 15 ns)',
        },
      ]);
      b.expect({ '1Q': 'X', '1QN': 'X', '2Q': 0 });
    });

    it('hold: 3 ns is enough; 2 ns reports and makes the bit X if the new D differs', () => {
      const hold = (after: number) => {
        const b = bench();
        b.set({ '1D': 1 }).run(us(1));
        b.set({ '1CP': 1 }).run(ns(after));
        b.set({ '1D': 0 }).run(us(1));
        return b;
      };
      expect(timing(hold(3))).toEqual([]);
      hold(3).expect({ '1Q': 1 });
      const b = hold(2);
      expect(timing(b).map((d) => d.message)).toEqual([
        '1D changed 2 ns after 1CP rose (hold time ≥ 3 ns)',
      ]);
      b.expect({ '1Q': 'X' });
    });

    it('clock pulse width: 20 ns is enough; a short LOW phase makes the edge unreliable', () => {
      const pulse = (low: number) => {
        const b = bench();
        b.set({ '1CP': 1 }).run(us(1));
        b.set({ '1D': 1 }).run(us(1));
        b.set({ '1CP': 0 }).run(ns(low));
        b.set({ '1CP': 1 }).run(us(1));
        return b;
      };
      pulse(20).expect({ '1Q': 1 });
      expect(timing(pulse(20))).toEqual([]);
      const b = pulse(19);
      expect(timing(b)).toMatchObject([
        {
          kind: TimingViolation.PULSE_WIDTH,
          pin: '1CP',
          message: '1CP was LOW for only 19 ns (pulse width ≥ 20 ns)',
        },
      ]);
      b.expect({ '1Q': 'X' });
    });

    it('a short HIGH clock phase makes X what the edge before it changed', () => {
      const b = bench();
      b.set({ '1D': 1 }).run(us(1));
      b.set({ '1CP': 1 }).run(ns(19));
      b.set({ '1CP': 0 }).run(us(1));
      expect(timing(b).map((d) => d.message)).toEqual([
        '1CP was HIGH for only 19 ns (pulse width ≥ 20 ns)',
      ]);
      b.expect({ '1Q': 'X' });
      // An edge that changed nothing stays known.
      const same = bench();
      same.set({ '1CP': 1 }).run(ns(19));
      same.set({ '1CP': 0 }).run(us(1));
      same.expect({ '1Q': 0 });
    });

    it('set/reset pulse width: 20 ns is enough; a short pulse leaves the bit unknown', () => {
      const pulse = (width: number) => {
        const b = bench(); // Q = 0
        b.set({ '1SD': 0 }).run(ns(width));
        b.set({ '1SD': 1 }).run(us(1));
        return b;
      };
      pulse(20).expect({ '1Q': 1 });
      const b = pulse(19);
      expect(timing(b).map((d) => d.message)).toEqual([
        '1SD was LOW for only 19 ns (pulse width ≥ 20 ns)',
      ]);
      b.expect({ '1Q': 'X' });
    });

    it('recovery: 8 ns after reset is enough; 7 ns makes the edge unreliable', () => {
      const recover = (after: number) => {
        const b = bench();
        b.set({ '1D': 1, '1RD': 0 }).run(us(1));
        b.set({ '1RD': 1 }).run(ns(after));
        b.set({ '1CP': 1 }).run(us(1));
        return b;
      };
      recover(8).expect({ '1Q': 1 });
      expect(timing(recover(8))).toEqual([]);
      const b = recover(7);
      expect(timing(b).map((d) => `${d.kind} ${d.pin}: ${d.message}`)).toEqual([
        'recovery-violation 1RD: 1CP rose 7 ns after 1RD was released (recovery time ≥ 8 ns)',
      ]);
      b.expect({ '1Q': 'X' });
    });
  });
});
