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
import { Bench, type BenchValues, checkableRows, functionTable } from '../../core/testing';
import { hcCounters } from './counters';

const chip = (number: string) => hcCounters.find((d) => d.name === `74HC${number}`)!;
const names = (d: AnyComponentDefinition, numbers: readonly number[]) =>
  numbers.map((n) => pinsOf(d, {}).find((p) => p.number === n)!.name);
const timing = (b: Bench) => b.diagnostics.filter((d) => isTimingViolation(d.kind));
/** `{ D0: …, D1: … }` for the four bits of `value`. */
const word = (prefix: string, value: number): BenchValues =>
  Object.fromEntries([0, 1, 2, 3].map((n) => [`${prefix}${n}`, (value >> n) & 1 ? 1 : 0]));

interface CounterCase {
  readonly number: string;
  readonly asyncReset: boolean;
  /** Rows the function table checker runs (the rest have text outputs: by hand below). */
  readonly rows: number;
  readonly tpd: { readonly q: number; readonly tc: number; readonly cet: number };
  readonly tsu: { readonly d: number; readonly pe: number; readonly enables: number };
}

const CASES: readonly CounterCase[] = [
  {
    number: '161',
    asyncReset: true,
    rows: 52, // reset 32 + load 4 + hold 8 × 2 states
    tpd: { q: 22, tc: 25, cet: 12 },
    tsu: { d: 16, pe: 20, enables: 34 },
  },
  {
    number: '163',
    asyncReset: false,
    rows: 36, // reset 16 + load 4 + hold 8 × 2 states
    tpd: { q: 20, tc: 25, cet: 13 },
    tsu: { d: 16, pe: 16, enables: 35 },
  },
];

describe.each(CASES)('74HC$number', (c) => {
  const d = chip(c.number);
  const IDLE: BenchValues = { MR: 1, PE: 1, CEP: 1, CET: 1 };

  const clock = (b: Bench) => {
    b.set({ CP: 1 }).run(us(1));
    b.set({ CP: 0 }).run(us(1));
  };
  /** Clears the counter the chip's way: MR alone (161), MR and a clock edge (163). */
  const clear = (b: Bench) => {
    b.set({ MR: 0 }).run(us(1));
    if (!c.asyncReset) clock(b);
    b.set({ MR: 1 }).run(us(1));
  };
  /** Loads `value` with a clock edge, then goes back to the idle controls (counting). */
  const load = (b: Bench, value: number) => {
    b.set({ PE: 0, ...word('D', value) }).run(us(1));
    clock(b);
    b.set({ PE: 1 }).run(us(1));
  };
  /** Cleared long ago; CP low, D = 0, counting enabled. */
  function bench(value = 0): Bench {
    const b = new Bench(d);
    b.set({ ...IDLE, CP: 0, ...word('D', 0) }).run(us(1));
    clear(b);
    if (value !== 0) load(b, value);
    return b;
  }

  it.each([0, 1, 2, 3])('follows its function table, by pin number (bit %s)', (n) => {
    const b = bench();
    const columns = names(d, [1, 2, 7, 10, 9, 3 + n, 14 - n, 15]);
    const table = d.functionTable!;
    expect(columns.map((pin) => pin.replace(/\d$/, 'n'))).toEqual([
      ...table.inputs,
      ...table.outputs,
    ]);
    const D = `D${n}`;
    const states = ([0, 1] as const).map((v): BenchValues[] => [
      { MR: 1, PE: 0, [D]: v, CP: 0 },
      { CP: 1 },
      { CP: 0 },
    ]);
    expect(functionTable(b, checkableRows(table), columns, { states })).toBe(c.rows);
    expect(b.diagnostics).toEqual([]);
  });

  it('counts 0 to 15 and wraps; TC is HIGH at 15 while CET is HIGH', () => {
    const b = bench();
    for (let count = 1; count <= 17; count++) {
      clock(b);
      b.expect({ ...word('Q', count & 15), TC: (count & 15) === 15 ? 1 : 0 });
    }
    b.set({ CEP: 0 }).run(us(1));
    load(b, 15);
    b.expect({ TC: 1 });
    b.set({ CET: 0 }).run(us(1));
    b.expect({ ...word('Q', 15), TC: 0 });
    expect(b.diagnostics).toEqual([]);
  });

  it('loads on the clock edge while PE is LOW, whatever CEP and CET', () => {
    const b = bench(3);
    b.set({ PE: 0, CEP: 0, CET: 0, ...word('D', 10) }).run(us(1));
    b.expect(word('Q', 3));
    clock(b);
    b.expect(word('Q', 10));
    clock(b);
    b.expect(word('Q', 10));
  });

  it('holds while CEP or CET is LOW', () => {
    const b = bench(5);
    b.set({ CEP: 0 }).run(us(1));
    clock(b);
    b.expect(word('Q', 5));
    b.set({ CEP: 1, CET: 0 }).run(us(1));
    clock(b);
    b.expect(word('Q', 5));
    b.set({ CET: 1 }).run(us(1));
    clock(b);
    b.expect(word('Q', 6));
  });

  if (c.asyncReset) {
    it('clears at once while MR is LOW, ignoring the clock', () => {
      const b = bench(9);
      expect(b.measure({ MR: 0 }, 'Q0')).toBe(ns(23));
      b.expect(word('Q', 0));
      clock(b);
      b.set({ PE: 0, ...word('D', 7) }).run(us(1));
      clock(b);
      b.expect(word('Q', 0)).expectNoDiagnostics();
    });
  } else {
    it('clears on the clock edge while MR is LOW, before loading', () => {
      const b = bench(9);
      b.set({ MR: 0, PE: 0, ...word('D', 7) }).run(us(1));
      b.expect(word('Q', 9));
      expect(b.measure({ CP: 1 }, 'Q0')).toBe(ns(c.tpd.q));
      b.expect(word('Q', 0)).expectNoDiagnostics();
    });

    it('makes a modulo-N counter with one gate: MR from the count', () => {
      // MR = NOT(Q3 · Q1) by hand: clear at 10 makes a decade counter (0 to 10, then 0).
      const b = bench(8);
      clock(b);
      b.expect(word('Q', 9));
      clock(b);
      b.expect(word('Q', 10));
      b.set({ MR: 0 }).run(us(1));
      clock(b);
      b.expect(word('Q', 0));
    });
  }

  it('is unknown from power-on until it is reset or loaded; counting keeps it unknown', () => {
    const b = new Bench(d);
    b.set({ ...IDLE, CP: 0, ...word('D', 6) }).run(us(1));
    b.expect({ Q0: 'X', Q3: 'X', TC: 'X' });
    clock(b);
    b.expect({ Q0: 'X', Q3: 'X' });
    b.set({ CET: 0 }).run(us(1));
    b.expect({ TC: 0 });
    load(b, 6);
    b.expect(word('Q', 6));
  });

  it('makes X only the bits an uncertain clock edge could change', () => {
    const b = bench(5); // 0101 + 1 = 0110: bits 0 and 1 differ
    b.set({ CP: 'X' }).run(us(1));
    b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
  });

  it('merges the modes an unknown control allows', () => {
    const at5 = (controls: BenchValues, data = 5) => {
      const b = bench(5);
      b.set({ ...controls, ...word('D', data) }).run(us(1));
      clock(b);
      return b;
    };
    at5({ PE: 'X' }).expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 }); // load 0101 or count 0110
    at5({ PE: 'X' }, 6).expect(word('Q', 6)); // both give 6
    at5({ CEP: 'X' }).expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 }); // count or hold
    at5({ CET: 'X' }).expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0, TC: 0 });
    if (c.asyncReset) {
      const b = bench(5);
      b.set({ MR: 'X' }).run(us(1));
      b.expect({ Q0: 'X', Q1: 0, Q2: 'X', Q3: 0 }); // 0101 or cleared
    } else {
      at5({ MR: 'X' }).expect({ Q0: 0, Q1: 'X', Q2: 'X', Q3: 0 }); // 0110 or 0000
      at5({ MR: 'X', PE: 0 }, 13).expect({ Q0: 'X', Q1: 0, Q2: 'X', Q3: 'X' }); // 1101 or 0000
    }
  });

  it('reports a floating input when the counter uses it', () => {
    const b = bench(5);
    b.set({ D2: 'Z' }).run(us(1));
    clock(b); // counting: D isn't read
    expect(b.diagnostics).toEqual([]);
    b.set({ CEP: 'Z' }).run(us(1));
    clock(b);
    expect(b.diagnostics.map((x) => `${x.kind} ${x.net}`)).toEqual([
      `${KernelDiagnosticKind.FLOATING_INPUT} CEP`,
    ]);
    b.expect({ Q0: 'X', Q1: 1, Q2: 1, Q3: 0 }); // 6 + 1 = 0111 or hold 0110
  });

  it('switches after the delay of each path', () => {
    const b = bench();
    expect(b.measure({ CP: 1 }, 'Q0')).toBe(ns(c.tpd.q));
    b.set({ CP: 0, CEP: 0 }).run(us(1));
    load(b, 14);
    b.set({ CEP: 1 }).run(us(1));
    expect(b.measure({ CP: 1 }, 'TC')).toBe(ns(c.tpd.tc));
    expect(b.measure({ CET: 0 }, 'TC')).toBe(ns(c.tpd.cet));
    expect(b.measure({ CET: 1 }, 'TC')).toBe(ns(c.tpd.cet));
    if (c.asyncReset) expect(b.measure({ MR: 0 }, 'TC')).toBe(ns(23));
  });

  describe('timing checks', () => {
    /** At 5, `change` comes `before` the rising clock edge. */
    const late = (change: BenchValues, before: number, setup: BenchValues = {}) => {
      const b = bench(5);
      b.set(setup).run(us(1));
      b.set(change).run(ns(before));
      b.set({ CP: 1 }).run(us(1));
      return b;
    };

    it('set-up of the data: a late bit loads X', () => {
      expect(timing(late({ D1: 1 }, c.tsu.d, { PE: 0, ...word('D', 9) }))).toEqual([]);
      const b = late({ D1: 1 }, c.tsu.d - 1, { PE: 0, ...word('D', 9) });
      expect(timing(b)).toMatchObject([
        {
          kind: TimingViolation.SETUP,
          pin: 'D1',
          message: `D1 changed ${c.tsu.d - 1} ns before CP rose (setup time ≥ ${c.tsu.d} ns)`,
        },
      ]);
      b.expect({ Q0: 1, Q1: 'X', Q2: 0, Q3: 1 });
    });

    it('set-up of PE: load or count where they differ', () => {
      // Load 0111 or count to 0110: only bit 0 differs.
      const setup = { ...word('D', 7) };
      expect(timing(late({ PE: 0 }, c.tsu.pe, setup))).toEqual([]);
      const b = late({ PE: 0 }, c.tsu.pe - 1, setup);
      expect(timing(b)).toMatchObject([{ kind: TimingViolation.SETUP, pin: 'PE' }]);
      b.expect({ Q0: 'X', Q1: 1, Q2: 1, Q3: 0 });
    });

    it('set-up of CEP and CET: count or hold where they differ', () => {
      for (const pin of ['CEP', 'CET']) {
        expect(timing(late({ [pin]: 1 }, c.tsu.enables, { [pin]: 0 }))).toEqual([]);
        const b = late({ [pin]: 1 }, c.tsu.enables - 1, { [pin]: 0 });
        expect(timing(b)).toMatchObject([{ kind: TimingViolation.SETUP, pin }]);
        b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
      }
    });

    if (!c.asyncReset) {
      it('set-up of the synchronous MR: reset or count where they differ', () => {
        expect(timing(late({ MR: 0 }, 16))).toEqual([]);
        const b = late({ MR: 0 }, 15);
        expect(timing(b)).toMatchObject([{ kind: TimingViolation.SETUP, pin: 'MR' }]);
        b.expect({ Q0: 0, Q1: 'X', Q2: 'X', Q3: 0 }); // 0000 or 0110
      });
    }

    it('accepts inputs changing right after the edge (hold time 0)', () => {
      const b = bench(5);
      b.set({ PE: 0, ...word('D', 5) }).run(us(1));
      b.set({ CP: 1 }).run(ns(1));
      b.set({ PE: 1, CEP: 0, ...word('D', 10) }).run(us(1));
      b.expect(word('Q', 5));
      expect(timing(b)).toEqual([]);
    });

    it('clock pulse width: a short LOW phase makes X the bits the edge would change', () => {
      const b = bench(5);
      b.set({ CP: 1 }).run(us(1)); // 6
      b.set({ CP: 0 }).run(ns(15));
      b.set({ CP: 1 }).run(us(1));
      expect(timing(b)).toMatchObject([
        {
          kind: TimingViolation.PULSE_WIDTH,
          message: 'CP was LOW for only 15 ns (pulse width ≥ 16 ns)',
        },
      ]);
      b.expect({ Q0: 'X', Q1: 1, Q2: 1, Q3: 0 }); // 0110 or 0111
      const ok = bench(5);
      ok.set({ CP: 1 }).run(us(1));
      ok.set({ CP: 0 }).run(ns(16));
      ok.set({ CP: 1 }).run(us(1));
      ok.expect(word('Q', 7));
      expect(timing(ok)).toEqual([]);
    });

    it('clock pulse width: a short HIGH phase makes X the bits its edge changed', () => {
      const b = bench(5);
      b.set({ CP: 1 }).run(ns(15));
      b.set({ CP: 0 }).run(us(1));
      expect(timing(b)).toMatchObject([
        { message: 'CP was HIGH for only 15 ns (pulse width ≥ 16 ns)' },
      ]);
      b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 }); // 0101 or 0110
    });

    if (c.asyncReset) {
      it('MR pulse width: a short pulse makes X the bits it cleared', () => {
        const pulse = (width: number) => {
          const b = bench(5);
          b.set({ MR: 0 }).run(ns(width));
          b.set({ MR: 1 }).run(us(1));
          return b;
        };
        expect(timing(pulse(16))).toEqual([]);
        pulse(16).expect(word('Q', 0));
        const b = pulse(15);
        expect(timing(b)).toMatchObject([
          { message: 'MR was LOW for only 15 ns (pulse width ≥ 16 ns)' },
        ]);
        b.expect({ Q0: 'X', Q1: 0, Q2: 'X', Q3: 0 });
      });

      it('recovery: an edge too soon after MR is released counts X', () => {
        const recover = (after: number) => {
          const b = bench(5);
          b.set({ MR: 0 }).run(us(1));
          b.set({ MR: 1 }).run(ns(after));
          b.set({ CP: 1 }).run(us(1));
          return b;
        };
        expect(timing(recover(20))).toEqual([]);
        recover(20).expect(word('Q', 1));
        const b = recover(19);
        expect(timing(b)).toMatchObject([
          {
            kind: TimingViolation.RECOVERY,
            message: 'CP rose 19 ns after MR was released (recovery time ≥ 20 ns)',
          },
        ]);
        b.expect({ Q0: 'X', Q1: 0, Q2: 0, Q3: 0 });
      });

      it('checks nothing on a clock running while MR holds it cleared', () => {
        const b = bench(5);
        b.set({ MR: 0 }).run(us(1));
        for (let i = 0; i < 4; i++) {
          b.set({ D0: i & 1 ? 1 : 0, PE: i & 1 ? 0 : 1, CEP: i & 1 ? 0 : 1 });
          b.set({ CP: 1 }).run(ns(5));
          b.set({ CP: 0 }).run(ns(5));
        }
        expect(timing(b)).toEqual([]);
        b.expect(word('Q', 0));
      });
    }
  });
});
