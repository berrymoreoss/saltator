import { describe, expect, it } from 'vitest';
import {
  type AnyComponentDefinition,
  isTimingViolation,
  KernelDiagnosticKind,
  levelChar,
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

interface JkCase {
  readonly number: string;
  readonly edge: 'rise' | 'fall';
  /** Per flip-flop, pin numbers in the unit's order (the function table's columns). */
  readonly unitPins: readonly (readonly number[])[];
  /** Function table combinations checked per flip-flop. */
  readonly rows: number;
  /** K̅ (109): the K level that means "K active". */
  readonly kOn: 0 | 1;
  readonly set: boolean;
  /** Generic pin name of the reset input. */
  readonly reset: 'nR' | 'nRD';
  readonly tsu: number;
  readonly th: number;
  readonly trec: number;
}

const JK_CASES: readonly JkCase[] = [
  {
    number: '107',
    edge: 'fall',
    // R, CP, J, K, Q, Q̅ from the pinning figure.
    unitPins: [
      [13, 12, 1, 4, 3, 2],
      [10, 9, 8, 11, 5, 6],
    ],
    rows: 14, // reset 8 + toggle and hold from two states 4 + loads 2
    kOn: 1,
    set: false,
    reset: 'nR',
    tsu: 20,
    th: 3,
    trec: 12,
  },
  {
    number: '109',
    edge: 'rise',
    // SD, RD, CP, J, K̅, Q, Q̅.
    unitPins: [
      [5, 1, 4, 2, 3, 6, 7],
      [11, 15, 12, 14, 13, 10, 9],
    ],
    rows: 30, // 3 asynchronous rows × 8 + toggle and hold 4 + loads 2
    kOn: 0,
    set: true,
    reset: 'nRD',
    tsu: 14,
    th: 5,
    trec: 14,
  },
  {
    number: '112',
    edge: 'fall',
    unitPins: [
      [4, 15, 1, 3, 2, 5, 6],
      [10, 14, 13, 11, 12, 9, 7],
    ],
    rows: 30,
    kOn: 1,
    set: true,
    reset: 'nRD',
    tsu: 16,
    th: 0,
    trec: 16,
  },
];

describe.each(JK_CASES)('74HC$number', (c) => {
  const d = chip(c.number);
  const idle = c.edge === 'rise' ? 0 : 1;
  const active = c.edge === 'rise' ? 1 : 0;
  const kOff = c.kOn === 1 ? 0 : 1;
  const async = (n: 1 | 2, value: 0 | 1) =>
    of(n, c.set ? { nSD: 1, [c.reset]: value } : { [c.reset]: value });

  /** Both flip-flops idle and reset to 0 long ago; J = K inactive (hold). */
  function bench(): Bench {
    const b = new Bench(d);
    for (const n of [1, 2] as const) {
      b.set({ ...async(n, 0), ...of(n, { nCP: idle, nJ: 0, nK: kOff }) });
    }
    b.run(us(1));
    for (const n of [1, 2] as const) b.set(async(n, 1));
    b.run(us(1));
    return b;
  }
  /** One clean active edge (and back), with the inputs stable for a microsecond. */
  const clock = (b: Bench, n: 1 | 2 = 1) => {
    b.set(of(n, { nCP: active })).run(us(1));
    b.set(of(n, { nCP: idle })).run(us(1));
  };

  it.each([1, 2] as const)('follows its function table, by pin number (flip-flop %s)', (n) => {
    const b = bench();
    const unit = names(d, c.unitPins[n - 1]!);
    expect(unit).toEqual(d.units![n - 1]!.pins);
    const load1 = c.set
      ? [of(n, { nSD: 0, nRD: 1 }), of(n, { nSD: 1 })]
      : [of(n, { nR: 1, nJ: 1, nK: 0, nCP: idle }), of(n, { nCP: active }), of(n, { nCP: idle })];
    const states = [[async(n, 0), async(n, 1)], load1];
    expect(functionTable(b, d.functionTable!, unit, { states })).toBe(c.rows);
    expect(b.diagnostics).toEqual([]);
  });

  it('toggles with J and K both active, on the active edge only', () => {
    const b = bench();
    b.set({ '1J': 1, '1K': c.kOn }).run(us(1));
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      b.set({ '1CP': active }).run(us(1));
      seen.push(levelChar(b.get('1Q')));
      b.set({ '1CP': idle }).run(us(1)); // the other edge does nothing
      seen.push(levelChar(b.get('1Q')));
    }
    expect(seen.join('')).toBe('11001100');
    b.expect({ '2Q': 0 });
    expect(b.diagnostics).toEqual([]);
  });

  it('makes X only what an uncertain clock edge could change', () => {
    const b = bench();
    b.set({ '1CP': 'X' }).run(us(1)); // J = K inactive: holding, nothing could change
    b.expect({ '1Q': 0 });
    b.set({ '1CP': idle }).run(us(1));
    b.set({ '1J': 1, '1K': c.kOn }).run(us(1)); // toggle
    b.set({ '1CP': 'X' }).run(us(1));
    b.expect({ '1Q': 'X', '1QN': 'X' });
  });

  it('merges toggling from an unknown state and unknown J or K', () => {
    const b = bench();
    b.set({ '1J': 'X', '1K': kOff }).run(us(1)); // set or hold: from 0 unknown
    clock(b);
    b.expect({ '1Q': 'X' });
    b.set({ '1J': 1 }).run(us(1)); // set
    clock(b);
    b.expect({ '1Q': 1 });
    b.set({ '1J': 0, '1K': 'X' }).run(us(1)); // reset or hold: from 1 unknown
    clock(b);
    b.expect({ '1Q': 'X' });
  });

  it('switches after the delay of each path', () => {
    const t = d.timing!.typical;
    const b = bench();
    b.set({ '1J': 1, '1K': kOff }).run(us(1));
    expect(b.measure({ '1CP': active }, '1Q')).toBe(t['tpd(nCP to nQ, nQN)']);
    b.set({ '1CP': idle, '1J': 0, '1K': c.kOn }).run(us(1));
    expect(b.measure({ '1CP': active }, '1QN')).toBe(t['tpd(nCP to nQ, nQN)']);
    b.set({ '1CP': idle }).run(us(1));
    if (c.number === '109') {
      expect(b.measure({ '1SD': 0 }, '1Q')).toBe(ns(11)); // tPLH(nSD to nQ)
      b.set({ '1SD': 1 }).run(us(1));
      b.set({ '1SD': 0 }).run(us(1));
      b.set({ '1SD': 1, '1RD': 1 }).run(us(1));
      expect(b.measure({ '1RD': 0 }, '1Q')).toBe(ns(15)); // tPHL(nRD to nQ)
      b.set({ '1RD': 1 }).run(us(1));
      b.set({ '1SD': 0 }).run(us(1));
      b.set({ '1SD': 1 }).run(us(1));
      expect(b.measure({ '1RD': 0 }, '1QN')).toBe(ns(14)); // tPLH(nRD to nQ̅)
      b.set({ '1RD': 1 }).run(us(1));
      expect(b.measure({ '1SD': 0 }, '1QN')).toBe(ns(15)); // tPHL(nSD to nQ̅)
    } else {
      const reset = c.reset === 'nR' ? '1R' : '1RD';
      b.set({ '1J': 1, '1K': kOff }).run(us(1));
      clock(b);
      expect(b.measure({ [reset]: 0 }, '1Q')).toBe(t[`tpd(${c.reset} to nQ, nQN)`]);
      if (c.set) {
        b.set({ [reset]: 1 }).run(us(1));
        expect(b.measure({ '1SD': 0 }, '1Q')).toBe(t['tpd(nSD to nQ, nQN)']);
      }
    }
  });

  it('checks set-up time against its minimum', () => {
    const setup = (before: number) => {
      const b = bench();
      b.set({ '1J': 1 }).run(ns(before));
      b.set({ '1CP': active }).run(us(1));
      return b;
    };
    setup(c.tsu).expect({ '1Q': 1 });
    expect(timing(setup(c.tsu))).toEqual([]);
    const b = setup(c.tsu - 1);
    expect(timing(b).map((x) => x.message)).toEqual([
      `1J changed ${c.tsu - 1} ns before 1CP ${c.edge === 'rise' ? 'rose' : 'fell'} (setup time ≥ ${c.tsu} ns)`,
    ]);
    b.expect({ '1Q': 'X' });
  });

  it('checks hold time against its minimum (none when it is 0)', () => {
    const hold = (after: number) => {
      const b = bench();
      b.set({ '1J': 1 }).run(us(1));
      b.set({ '1CP': active }).run(ns(after));
      b.set({ '1J': 0 }).run(us(1));
      return b;
    };
    expect(timing(hold(c.th))).toEqual([]);
    hold(c.th).expect({ '1Q': 1 });
    if (c.th === 0) return;
    const b = hold(c.th - 1);
    expect(timing(b).map((x) => x.kind)).toEqual([TimingViolation.HOLD]);
    b.expect({ '1Q': 'X' });
  });

  it('checks the recovery time after reset', () => {
    const reset = c.reset === 'nR' ? '1R' : '1RD';
    const recover = (after: number) => {
      const b = bench();
      b.set({ '1J': 1, [reset]: 0 }).run(us(1));
      b.set({ [reset]: 1 }).run(ns(after));
      b.set({ '1CP': active }).run(us(1));
      return b;
    };
    expect(timing(recover(c.trec))).toEqual([]);
    recover(c.trec).expect({ '1Q': 1 });
    const b = recover(c.trec - 1);
    expect(timing(b).map((x) => `${x.kind} ${x.pin}`)).toEqual([`recovery-violation ${reset}`]);
    b.expect({ '1Q': 'X' });
  });

  it('checks the clock pulse width (16 ns)', () => {
    const pulse = (width: number) => {
      const b = bench();
      b.set({ '1J': 1 }).run(us(1));
      b.set({ '1CP': active }).run(us(1));
      b.set({ '1CP': idle }).run(ns(width));
      b.set({ '1CP': active }).run(us(1));
      return b;
    };
    expect(timing(pulse(16))).toEqual([]);
    expect(timing(pulse(15)).map((x) => x.kind)).toEqual([TimingViolation.PULSE_WIDTH]);
  });

  it('checks the reset pulse width (16 ns): a short LOW pulse leaves the bit unknown', () => {
    const reset = c.reset === 'nR' ? '1R' : '1RD';
    const pulse = (width: number) => {
      const b = bench();
      b.set({ '1J': 1 }).run(us(1));
      clock(b); // Q = 1
      b.set({ '1J': 0 }).run(us(1));
      b.set({ [reset]: 0 }).run(ns(width));
      b.set({ [reset]: 1 }).run(us(1));
      return b;
    };
    expect(timing(pulse(16))).toEqual([]);
    pulse(16).expect({ '1Q': 0 });
    const short = pulse(15);
    expect(timing(short).map((x) => `${x.kind} ${x.pin}: ${x.message}`)).toEqual([
      `pulse-width-violation ${reset}: ${reset} was LOW for only 15 ns (pulse width ≥ 16 ns)`,
    ]);
    short.expect({ '1Q': 'X' });
  });

  it('checks the set/reset HIGH phase only where the data sheet says HIGH or LOW', () => {
    const reset = c.reset === 'nR' ? '1R' : '1RD';
    const b = bench();
    b.set({ [reset]: 0 }).run(us(1));
    b.set({ [reset]: 1 }).run(ns(15)); // released for 15 ns between two resets
    b.set({ [reset]: 0 }).run(us(1));
    // 107 and 109: "HIGH or LOW"; 112: "LOW" only.
    expect(timing(b).map((x) => x.kind)).toEqual(
      c.number === '112' ? [] : [TimingViolation.PULSE_WIDTH],
    );
  });

  it('reports floating inputs: the clock always, J and K when an edge reads them', () => {
    const b = new Bench(d);
    b.set({ ...async(1, 1), ...async(2, 1), ...of(2, { nCP: idle, nJ: 0, nK: kOff }) });
    b.run(us(1));
    const floating = () =>
      b.diagnostics
        .filter((x) => x.kind === KernelDiagnosticKind.FLOATING_INPUT)
        .map((x) => x.net)
        .sort();
    expect(floating()).toEqual(['1CP']);
    b.set({ '1CP': idle }).run(us(1));
    b.set({ '1CP': active }).run(us(1));
    expect(floating()).toEqual(['1CP', '1J', '1K']);
    b.expect({ '1Q': 'X' });
  });

  if (c.number === '112') {
    it('checks the recovery time after set separately (16 ns)', () => {
      const recover = (after: number) => {
        const b = bench(); // Q = 0, J = K inactive
        b.set({ '1SD': 0, '1J': 0, '1K': 1 }).run(us(1)); // J, K: reset on the edge
        b.set({ '1SD': 1 }).run(ns(after));
        b.set({ '1CP': active }).run(us(1));
        return b;
      };
      expect(timing(recover(16))).toEqual([]);
      recover(16).expect({ '1Q': 0 });
      const early = recover(15);
      expect(timing(early).map((x) => `${x.kind} ${x.pin}`)).toEqual(['recovery-violation 1SD']);
      early.expect({ '1Q': 'X' });
    });
  }
});

describe('74HC112 set and reset together', () => {
  it('gives Q = H, Q̅ = L as its data sheet says, and X when both are released at once', () => {
    const b = new Bench(chip('112'));
    b.set({ '1CP': 1, '1J': 0, '1K': 0, '1SD': 0, '1RD': 0 }).run(us(1));
    b.expect({ '1Q': 1, '1QN': 0 });
    b.set({ '1SD': 1, '1RD': 1 }).run(us(1));
    b.expect({ '1Q': 'X', '1QN': 'X' });
  });
});

describe('74HC109 K̅ input', () => {
  it('loads 1 with J = H, K̅ = H and 0 with J = L, K̅ = L (the data sheet rows)', () => {
    const b = new Bench(chip('109'));
    b.set({ '1SD': 1, '1RD': 1, '1CP': 0, '1J': 1, '1K': 1 }).run(us(1));
    b.set({ '1CP': 1 }).run(us(1));
    b.expect({ '1Q': 1 });
    b.set({ '1CP': 0, '1J': 0, '1K': 0 }).run(us(1));
    b.set({ '1CP': 1 }).run(us(1));
    b.expect({ '1Q': 0 });
  });
});
