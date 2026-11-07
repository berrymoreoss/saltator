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

/** A column of a register's function table for bit `n`: a control's pin number, or by role. */
type Column = number | 'D' | 'Q' | 'QN' | null;

interface RegisterCase {
  readonly number: string;
  readonly bits: number;
  /** Per bit: D and Q (and Q̅) pin numbers, from the pinning figure. */
  readonly d: readonly number[];
  readonly q: readonly number[];
  readonly qn?: readonly number[];
  /** The function table's columns (`null`: display only, the 374's Internal register bit). */
  readonly columns: readonly Column[];
  readonly rows: number;
  /** Controls for plain operation: loading, outputs enabled, not in reset. */
  readonly idle: BenchValues;
  /** The master reset's active level and its pulse width and recovery minima. */
  readonly reset?: { readonly on: 0 | 1; readonly tW: number; readonly trec: number };
  /** The table has previous-state rows (`qn`). */
  readonly states?: boolean;
  readonly tpd: number;
  readonly tsu: number;
  readonly th: number;
}

const D8_PINS = [3, 4, 7, 8, 13, 14, 17, 18];
const Q8_PINS = [2, 5, 6, 9, 12, 15, 16, 19];

const CASES: readonly RegisterCase[] = [
  {
    number: '173',
    bits: 4,
    d: [14, 13, 12, 11],
    q: [3, 4, 5, 6],
    columns: [15, 7, 9, 10, 'D', 1, 2, 'Q'], // MR, CP, E1, E2, Dn, OE1, OE2 | Qn
    rows: 178, // reset 16 + loads 2 + holds 2 × 8 × 2 + disabled 2 × 64
    idle: { MR: 0, E1: 0, E2: 0, OE1: 0, OE2: 0 },
    reset: { on: 1, tW: 16, trec: 12 },
    states: true,
    tpd: 20,
    tsu: 12,
    th: 1,
  },
  {
    number: '175',
    bits: 4,
    d: [4, 5, 12, 13],
    q: [2, 7, 10, 15],
    qn: [3, 6, 11, 14],
    columns: [1, 9, 'D', 'Q', 'QN'], // MR, CP, Dn | Qn, Q̅n
    rows: 6,
    idle: { MR: 1 },
    reset: { on: 0, tW: 16, trec: 5 },
    tpd: 20,
    tsu: 16,
    th: 5,
  },
  {
    number: '273',
    bits: 8,
    d: D8_PINS,
    q: Q8_PINS,
    columns: [1, 11, 'D', 'Q'],
    rows: 6,
    idle: { MR: 1 },
    reset: { on: 0, tW: 12, trec: 10 },
    tpd: 15,
    tsu: 12,
    th: 3,
  },
  {
    number: '374',
    bits: 8,
    d: D8_PINS,
    q: Q8_PINS,
    columns: [1, 11, 'D', null, 'Q'], // OE, CP, Dn | Internal, Qn
    rows: 4,
    idle: { OE: 0 },
    tpd: 18,
    tsu: 12,
    th: 5,
  },
  {
    number: '377',
    bits: 8,
    d: D8_PINS,
    q: Q8_PINS,
    columns: [11, 1, 'D', 'Q'], // CP, E, Dn | Qn
    rows: 14, // two loads + hold rows from two states (2 × 2 + 4 × 2)
    idle: { E: 0 },
    states: true,
    tpd: 16,
    tsu: 12,
    th: 3,
  },
  {
    number: '574',
    bits: 8,
    d: [2, 3, 4, 5, 6, 7, 8, 9],
    q: [19, 18, 17, 16, 15, 14, 13, 12],
    columns: [1, 11, 'D', null, 'Q'],
    rows: 4,
    idle: { OE: 0 },
    tpd: 17,
    tsu: 12,
    th: 5,
  },
];

describe.each(CASES)('74HC$number', (c) => {
  const d = chip(c.number);
  const mask = (1 << c.bits) - 1;
  const resetOn: BenchValues = c.reset ? { MR: c.reset.on } : {};
  const resetOff: BenchValues = c.reset ? { MR: c.reset.on === 1 ? 0 : 1 } : {};

  /** Cleared (reset, or 0 loaded) long ago; CP low, D = 0, controls idle. */
  function bench(): Bench {
    const b = new Bench(d);
    b.set({ ...c.idle, CP: 0, ...word('D', c.bits, 0), ...resetOn }).run(us(1));
    if (c.reset) b.set(resetOff);
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
      const role = { D: c.d[n]!, Q: c.q[n]!, QN: c.qn?.[n] ?? -1 };
      const columns = c.columns.map((col) =>
        col === null ? null : names(d, [typeof col === 'number' ? col : role[col]])[0]!,
      );
      const table = d.functionTable!;
      // Each pin is the column of that name, or of its generic name (D3 → Dn).
      [...table.inputs, ...table.outputs].forEach((name, i) => {
        const pin = columns[i];
        if (pin !== null) expect([pin, pin!.replace(/\d+/, 'n')]).toContain(name);
      });
      const D = `D${n}`;
      const states = ([0, 1] as const).map((v): BenchValues[] => [
        { ...c.idle, [D]: v, CP: 0 },
        { CP: 1 },
        { CP: 0 },
      ]);
      expect(functionTable(b, table, columns, c.states ? { states } : {})).toBe(c.rows);
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
    b.set({ ...c.idle, CP: 0, ...word('D', c.bits, 1), ...resetOff });
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
      expect(b.measure(resetOn, 'Q0')).toBe(tPHL);
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
        b.set(resetOn).run(ns(width));
        b.set(resetOff).run(us(1));
        return b;
      };
      expect(timing(pulse(c.reset!.tW))).toEqual([]);
      pulse(c.reset!.tW).expect({ Q0: 0 });
      const short = pulse(c.reset!.tW - 1);
      expect(timing(short).map((x) => `${x.kind} ${x.pin}`)).toEqual(['pulse-width-violation MR']);
      short.expect({ Q0: 'X', Q1: 0 }); // only the bit the reset changed

      const recover = (after: number) => {
        const b = bench();
        b.set({ D0: 1, ...resetOn }).run(us(1));
        b.set(resetOff).run(ns(after));
        b.set({ CP: 1 }).run(us(1));
        return b;
      };
      expect(timing(recover(c.reset!.trec))).toEqual([]);
      recover(c.reset!.trec).expect({ Q0: 1 });
      const early = recover(c.reset!.trec - 1);
      expect(timing(early).map((x) => `${x.kind} ${x.pin}`)).toEqual(['recovery-violation MR']);
      early.expect({ Q0: 'X', Q1: 0 });
    });

    it('clears asynchronously; an unknown reset makes X the bits that are 1', () => {
      const b = bench();
      b.set({ D0: 1 }).run(us(1));
      clock(b);
      b.set({ MR: 'X' }).run(us(1));
      b.expect({ Q0: 'X', Q1: 0 });
      b.set(resetOn).run(us(1));
      b.expect({ Q0: 0 });
      b.set({ CP: 1 }).run(us(1)); // a clock held in reset loads nothing, checks nothing
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

const THREE_STATE: readonly {
  number: string;
  oe: readonly string[];
  idle: BenchValues;
  ten: number;
  tdis: number;
}[] = [
  { number: '173', oe: ['OE1', 'OE2'], idle: { MR: 0, E1: 0, E2: 0 }, ten: 19, tdis: 19 },
  { number: '374', oe: ['OE'], idle: {}, ten: 15, tdis: 18 },
  { number: '574', oe: ['OE'], idle: {}, ten: 16, tdis: 14 },
];

describe.each(THREE_STATE)('74HC$number 3-state outputs', ({ number, oe, idle, ten, tdis }) => {
  const d = chip(number);
  const enable = (level: 0 | 1 | 'X' | 'Z') => Object.fromEntries(oe.map((p) => [p, level]));

  it('loads while disabled; enabling shows the register after ten, disabling releases after tdis', () => {
    const b = new Bench(d);
    b.set({ ...idle, ...enable(1), CP: 0, D0: 1, D1: 0 }).run(us(1));
    b.set({ CP: 1 }).run(us(1));
    b.expect({ Q0: 'Z', Q1: 'Z' });
    expect(b.measure(enable(0), 'Q0')).toBe(ns(ten));
    b.expect({ Q0: 1, Q1: 0 });
    expect(b.measure(enable(1), 'Q0')).toBe(ns(tdis));
    b.expect({ Q0: 'Z' });
    expect(timing(b)).toEqual([]);
  });

  it('drives X while an output enable is unknown or floating (it might be driving)', () => {
    const b = new Bench(d);
    b.set({ ...idle, ...enable(0), CP: 0, D0: 1 }).run(us(1));
    b.set({ CP: 1 }).run(us(1));
    b.set({ [oe[0]!]: 'X' }).run(us(1));
    b.expect({ Q0: 'X' });
    b.set({ [oe[0]!]: 'Z' }).run(us(1));
    b.expect({ Q0: 'X' });
    expect(b.diagnostics.map((x) => `${x.kind} ${x.net}`)).toContain(
      `${KernelDiagnosticKind.FLOATING_INPUT} ${oe[0]}`,
    );
    if (oe.length > 1) {
      b.set({ OE2: 1 }).run(us(1)); // the other one decides: disabled
      b.expect({ Q0: 'Z' });
    }
  });
});

describe('74HC173 data enables', () => {
  const hc173 = chip('173');
  function bench(): Bench {
    const b = new Bench(hc173);
    b.set({ OE1: 0, OE2: 0, E1: 0, E2: 0, CP: 0, MR: 1, ...word('D', 4, 0) }).run(us(1));
    b.set({ MR: 0 }).run(us(1));
    return b;
  }

  it.each([
    [{ E1: 1, E2: 0 }, 0],
    [{ E1: 0, E2: 1 }, 0],
    [{ E1: 1, E2: 1 }, 0],
    [{ E1: 0, E2: 0 }, 1],
    [{ E1: 'X', E2: 0 }, 'X'],
    [{ E1: 'X', E2: 1 }, 0], // E2 decides: hold
  ] as const)('loads only with both enables LOW: %o → Q0 = %s', (enables, q0) => {
    const b = bench();
    b.set({ ...enables, D0: 1 }).run(us(1));
    b.set({ CP: 1 }).run(us(1));
    b.expect({ Q0: q0, Q1: 0 });
  });

  it('checks the enables: set-up 20 ns; their hold minimum is 0', () => {
    const setup = (before: number) => {
      const b = bench();
      b.set({ E1: 1, D0: 1 }).run(us(1));
      b.set({ E1: 0 }).run(ns(before));
      b.set({ CP: 1 }).run(ns(0));
      b.set({ E2: 1 }).run(us(1)); // right at the edge: th = 0 allows it
      return b;
    };
    expect(timing(setup(20))).toEqual([]);
    setup(20).expect({ Q0: 1 });
    const late = setup(19);
    expect(timing(late).map((x) => `${x.kind} ${x.pin}`)).toEqual(['setup-violation E1']);
    late.expect({ Q0: 'X', Q1: 0 });
  });

  it('is cleared by MR HIGH, asynchronously, after tPHL', () => {
    const b = bench();
    b.set({ D0: 1 }).run(us(1));
    b.set({ CP: 1 }).run(us(1));
    b.expect({ Q0: 1 });
    expect(b.measure({ MR: 1 }, 'Q0')).toBe(ns(16));
  });
});
