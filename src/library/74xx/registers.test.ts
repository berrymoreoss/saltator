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
import { hcRegisters } from './registers';

const chip = (number: string) => hcRegisters.find((d) => d.name === `74HC${number}`)!;
const names = (d: AnyComponentDefinition, numbers: readonly number[]) =>
  numbers.map((n) => pinsOf(d, {}).find((p) => p.number === n)!.name);
const timing = (b: Bench) => b.diagnostics.filter((d) => isTimingViolation(d.kind));
/** `{ D0: …, D1: … }` for the low `bits` bits of `value`. */
const word = (prefix: string, bits: number, value: number): BenchValues =>
  Object.fromEntries(
    Array.from({ length: bits }, (_, n) => [`${prefix}${n}`, (value >> n) & 1 ? 1 : 0]),
  );

interface RegisterCase {
  readonly number: string;
  readonly bits: number;
  /** Per bit: D and Q (and Q̅) pin numbers, from the pinning figure. */
  readonly d: readonly number[];
  readonly q: readonly number[];
  readonly qn?: readonly number[];
  /** Pin numbers of the controls in the function table's order before D. */
  readonly controls: readonly number[];
  readonly rows: number;
  readonly reset: boolean;
  readonly enable: boolean;
  readonly tpd: number;
  readonly tsu: number;
  readonly th: number;
  readonly tWReset?: number;
  readonly trec?: number;
}

const CASES: readonly RegisterCase[] = [
  {
    number: '175',
    bits: 4,
    d: [4, 5, 12, 13],
    q: [2, 7, 10, 15],
    qn: [3, 6, 11, 14],
    controls: [1, 9], // MR, CP
    rows: 6,
    reset: true,
    enable: false,
    tpd: 20,
    tsu: 16,
    th: 5,
    tWReset: 16,
    trec: 5,
  },
  {
    number: '273',
    bits: 8,
    d: [3, 4, 7, 8, 13, 14, 17, 18],
    q: [2, 5, 6, 9, 12, 15, 16, 19],
    controls: [1, 11],
    rows: 6,
    reset: true,
    enable: false,
    tpd: 15,
    tsu: 12,
    th: 3,
    tWReset: 12,
    trec: 10,
  },
  {
    number: '377',
    bits: 8,
    d: [3, 4, 7, 8, 13, 14, 17, 18],
    q: [2, 5, 6, 9, 12, 15, 16, 19],
    controls: [11, 1], // CP, E
    rows: 14, // two loads + hold rows from two states (2 × 2 + 4 × 2)
    reset: false,
    enable: true,
    tpd: 16,
    tsu: 12,
    th: 3,
  },
];

describe.each(CASES)('74HC$number', (c) => {
  const d = chip(c.number);
  const mask = (1 << c.bits) - 1;

  /** Cleared (reset, or 0 loaded) long ago; CP low, D = 0, loading enabled. */
  function bench(): Bench {
    const b = new Bench(d);
    b.set({ CP: 0, ...word('D', c.bits, 0), ...(c.enable ? { E: 0 } : {}) });
    if (c.reset) b.set({ MR: 0 });
    b.run(us(1));
    if (c.reset) b.set({ MR: 1 });
    else b.set({ CP: 1 });
    b.run(us(1));
    b.set({ CP: 0 }).run(us(1));
    return b;
  }
  const clock = (b: Bench) => {
    b.set({ CP: 1 }).run(us(1));
    b.set({ CP: 0 }).run(us(1));
  };
  /** Q0… hold `value`, and Q̅0… (175) its complement. */
  const expectWord = (b: Bench, value: number) => {
    b.expect(word('Q', c.bits, value));
    if (!c.qn) return;
    b.expect(
      Object.fromEntries(
        Array.from({ length: c.bits }, (_, n) => [`Q${n}N`, (value >> n) & 1 ? 0 : 1]),
      ),
    );
  };

  it.each(Array.from({ length: c.bits }, (_, n) => n))(
    'follows its function table, by pin number (bit %s)',
    (n) => {
      const b = bench();
      const columns = names(d, [...c.controls, c.d[n]!, c.q[n]!, ...(c.qn ? [c.qn[n]!] : [])]);
      const table = d.functionTable!;
      expect(columns.map((name) => name.replace(/\d+/, 'n'))).toEqual([
        ...table.inputs,
        ...table.outputs,
      ]);
      const D = `D${n}`;
      const states: BenchValues[][] = [
        [{ E: 0, [D]: 0, CP: 0 }, { CP: 1 }, { CP: 0 }],
        [{ E: 0, [D]: 1, CP: 0 }, { CP: 1 }, { CP: 0 }],
      ];
      expect(functionTable(b, table, columns, c.enable ? { states } : {})).toBe(c.rows);
      expect(b.diagnostics).toEqual([]);
    },
  );

  it('loads every bit on the rising edge, and only then', () => {
    const b = bench();
    const value = 0b1010_0110 & mask;
    b.set(word('D', c.bits, value)).run(us(1));
    expectWord(b, 0);
    b.set({ CP: 1 }).run(us(1));
    expectWord(b, value);
    b.set(word('D', c.bits, ~value & mask)).run(us(1));
    b.set({ CP: 0 }).run(us(1)); // falling edge: nothing
    expectWord(b, value);
    expect(b.diagnostics).toEqual([]);
  });

  it('is unknown from power-on until it is reset or loaded', () => {
    const b = new Bench(d);
    b.set({
      CP: 0,
      ...word('D', c.bits, 1),
      ...(c.enable ? { E: 0 } : {}),
      ...(c.reset ? { MR: 1 } : {}),
    });
    b.run(us(1));
    b.expect({ Q0: 'X', Q1: 'X' });
    clock(b);
    b.expect({ Q0: 1, Q1: 0 });
  });

  it('makes X only the bits an uncertain clock edge could change', () => {
    const b = bench();
    b.set({ D1: 1 }).run(us(1));
    b.set({ CP: 'X' }).run(us(1));
    b.expect({ Q0: 0, Q1: 'X', Q2: 0 });
  });

  it('reports a floating data input when an edge reads it', () => {
    const b = bench();
    b.set({ D2: 'Z' }).run(us(1));
    expect(b.diagnostics).toEqual([]);
    clock(b);
    expect(b.diagnostics.map((x) => `${x.kind} ${x.net}`)).toEqual([
      `${KernelDiagnosticKind.FLOATING_INPUT} D2`,
    ]);
    b.expect({ Q2: 'X', Q1: 0 });
  });

  it('switches after the delay of each path', () => {
    const b = bench();
    b.set({ D0: 1 }).run(us(1));
    expect(b.measure({ CP: 1 }, 'Q0')).toBe(ns(c.tpd));
    if (c.qn) {
      b.set({ CP: 0, D0: 0 }).run(us(1));
      expect(b.measure({ CP: 1 }, 'Q0N')).toBe(ns(c.tpd));
    }
    if (c.reset) {
      b.set({ CP: 0, D0: 1 }).run(us(1));
      clock(b);
      const tPHL =
        d.timing!.typical[Object.keys(d.timing!.typical).find((k) => k.startsWith('tPHL'))!];
      expect(b.measure({ MR: 0 }, 'Q0')).toBe(tPHL);
    }
  });

  it('checks set-up time: a late data bit loads X, the others load', () => {
    const setup = (before: number) => {
      const b = bench();
      b.set({ D1: 1 }).run(us(1));
      b.set({ D0: 1 }).run(ns(before));
      b.set({ CP: 1 }).run(us(1));
      return b;
    };
    expect(timing(setup(c.tsu))).toEqual([]);
    const b = setup(c.tsu - 1);
    expect(timing(b)).toMatchObject([
      {
        kind: TimingViolation.SETUP,
        pin: 'D0',
        message: `D0 changed ${c.tsu - 1} ns before CP rose (setup time ≥ ${c.tsu} ns)`,
      },
    ]);
    b.expect({ Q0: 'X', Q1: 1, Q2: 0 });
  });

  it('checks hold time: a bit whose data changes too soon after the edge goes X', () => {
    const hold = (after: number) => {
      const b = bench();
      b.set({ D0: 1 }).run(us(1));
      b.set({ CP: 1 }).run(ns(after));
      b.set({ D0: 0, D1: 0 }).run(us(1)); // D1 didn't change
      return b;
    };
    expect(timing(hold(c.th))).toEqual([]);
    const b = hold(c.th - 1);
    expect(timing(b).map((x) => `${x.kind} ${x.pin}`)).toEqual(['hold-violation D0']);
    b.expect({ Q0: 'X', Q1: 0 });
  });

  it('checks the clock pulse width (16 ns)', () => {
    const pulse = (width: number) => {
      const b = bench();
      b.set({ D0: 1 }).run(us(1));
      b.set({ CP: 1 }).run(ns(width));
      b.set({ CP: 0 }).run(us(1));
      return b;
    };
    expect(timing(pulse(16))).toEqual([]);
    const b = pulse(15);
    expect(timing(b).map((x) => x.message)).toEqual([
      'CP was HIGH for only 15 ns (pulse width ≥ 16 ns)',
    ]);
    b.expect({ Q0: 'X', Q1: 0 }); // only the bit the edge changed
  });

  it('a short LOW clock phase makes X the bits the next edge would change', () => {
    const b = bench();
    b.set({ CP: 1 }).run(us(1));
    b.set({ D0: 1 }).run(us(1));
    b.set({ CP: 0 }).run(ns(15));
    b.set({ CP: 1 }).run(us(1));
    expect(timing(b).map((x) => x.message)).toEqual([
      'CP was LOW for only 15 ns (pulse width ≥ 16 ns)',
    ]);
    b.expect({ Q0: 'X', Q1: 0 });
  });

  if (c.reset) {
    it('checks the reset pulse width and the recovery time', () => {
      const pulse = (width: number) => {
        const b = bench();
        b.set({ D0: 1 }).run(us(1));
        clock(b);
        b.set({ MR: 0 }).run(ns(width));
        b.set({ MR: 1 }).run(us(1));
        return b;
      };
      expect(timing(pulse(c.tWReset!))).toEqual([]);
      pulse(c.tWReset!).expect({ Q0: 0 });
      const short = pulse(c.tWReset! - 1);
      expect(timing(short).map((x) => `${x.kind} ${x.pin}`)).toEqual(['pulse-width-violation MR']);
      short.expect({ Q0: 'X', Q1: 0 }); // only the bit the reset changed

      const recover = (after: number) => {
        const b = bench();
        b.set({ D0: 1, MR: 0 }).run(us(1));
        b.set({ MR: 1 }).run(ns(after));
        b.set({ CP: 1 }).run(us(1));
        return b;
      };
      expect(timing(recover(c.trec!))).toEqual([]);
      recover(c.trec!).expect({ Q0: 1 });
      const early = recover(c.trec! - 1);
      expect(timing(early).map((x) => `${x.kind} ${x.pin}`)).toEqual(['recovery-violation MR']);
      early.expect({ Q0: 'X', Q1: 0 });
    });

    it('clears asynchronously; an unknown reset makes X the bits that are 1', () => {
      const b = bench();
      b.set({ D0: 1 }).run(us(1));
      clock(b);
      b.set({ MR: 'X' }).run(us(1));
      b.expect({ Q0: 'X', Q1: 0 });
      b.set({ MR: 0 }).run(us(1));
      b.expect({ Q0: 0 });
      b.set({ CP: 1, MR: 0 }).run(us(1)); // a clock held in reset loads nothing, checks nothing
      b.set({ D1: 1 }).run(ns(1));
      b.set({ CP: 0 }).run(ns(1));
      b.expect({ Q0: 0, Q1: 0 });
      expect(timing(b)).toEqual([]);
    });
  }
});

describe('74HC377 data enable', () => {
  const hc377 = chip('377');
  function bench(): Bench {
    const b = new Bench(hc377);
    b.set({ CP: 0, E: 0, ...word('D', 8, 0) }).run(us(1));
    b.set({ CP: 1 }).run(us(1));
    b.set({ CP: 0 }).run(us(1));
    return b;
  }

  it('holds while E is HIGH; data changing then is not checked', () => {
    const b = bench();
    b.set({ E: 1 }).run(us(1));
    b.set({ D0: 1, CP: 1 }).run(us(1)); // with the edge, but not loading
    b.expect({ Q0: 0 });
    expect(timing(b)).toEqual([]);
  });

  it('loads X where D differs from the stored bit while E is unknown', () => {
    const b = bench();
    b.set({ E: 'X', D0: 1 }).run(us(1));
    b.set({ CP: 1 }).run(us(1));
    b.expect({ Q0: 'X', Q1: 0 });
  });

  it('checks E: set-up 12 ns, hold 4 ns; a late E makes X where loading or not differ', () => {
    const setup = (before: number) => {
      const b = bench();
      b.set({ E: 1 }).run(us(1));
      b.set({ D0: 1 }).run(us(1));
      b.set({ E: 0 }).run(ns(before));
      b.set({ CP: 1 }).run(us(1));
      return b;
    };
    expect(timing(setup(12))).toEqual([]);
    setup(12).expect({ Q0: 1 });
    const late = setup(11);
    expect(timing(late).map((x) => `${x.kind} ${x.pin}`)).toEqual(['setup-violation E']);
    late.expect({ Q0: 'X', Q1: 0 });

    const hold = (after: number) => {
      const b = bench();
      b.set({ D0: 1 }).run(us(1));
      b.set({ CP: 1 }).run(ns(after));
      b.set({ E: 1 }).run(us(1));
      return b;
    };
    expect(timing(hold(4))).toEqual([]);
    const early = hold(3);
    expect(timing(early).map((x) => `${x.kind} ${x.pin}`)).toEqual(['hold-violation E']);
    early.expect({ Q0: 'X', Q1: 0 });
  });

  it('a late E that ends disabled may still have loaded', () => {
    const b = bench();
    b.set({ D0: 1 }).run(us(1));
    b.set({ E: 1 }).run(ns(5)); // disabled 5 ns before the edge
    b.set({ CP: 1 }).run(us(1));
    b.expect({ Q0: 'X', Q1: 0 });
  });
});
