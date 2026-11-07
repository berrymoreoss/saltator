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
import { hcUpDownCounters } from './up-down-counters';

const chip = (number: string) => hcUpDownCounters.find((d) => d.name === `74HC${number}`)!;
const names = (d: AnyComponentDefinition, numbers: readonly number[]) =>
  numbers.map((n) => pinsOf(d, {}).find((p) => p.number === n)!.name);
const timing = (b: Bench) => b.diagnostics.filter((d) => isTimingViolation(d.kind));
const messages = (b: Bench) => timing(b).map((d) => d.message);
/** `{ D0: …, D1: … }` for the four bits of `value`. */
const word = (prefix: string, value: number): BenchValues =>
  Object.fromEntries([0, 1, 2, 3].map((n) => [`${prefix}${n}`, (value >> n) & 1 ? 1 : 0]));
const D_PINS = [15, 1, 10, 9];
const Q_PINS = [3, 2, 6, 7];

describe('74HC191', () => {
  const d = chip('191');

  /** Loaded with `value` long ago; CP LOW, counting up (CE̅ LOW, U̅/D LOW). */
  function bench(value = 0): Bench {
    const b = new Bench(d);
    b.set({ CP: 0, CE: 0, UD: 0, PL: 0, ...word('D', value) }).run(us(1));
    b.set({ PL: 1 }).run(us(1));
    return b;
  }
  const clock = (b: Bench) => {
    b.set({ CP: 1 }).run(us(1));
    b.set({ CP: 0 }).run(us(1));
  };

  it.each([0, 1, 2, 3])('follows its function table, by pin number (bit %s)', (n) => {
    const b = bench();
    const columns = names(d, [11, 5, 4, 14, D_PINS[n]!, Q_PINS[n]!]);
    const table = d.functionTable!;
    expect(columns.map((pin) => pin.replace(/\d$/, 'n'))).toEqual([
      ...table.inputs,
      ...table.outputs,
    ]);
    const states = ([0, 1] as const).map((v): BenchValues[] => [
      { PL: 0, [`D${n}`]: v, CE: 1, CP: 1 },
      { PL: 1 },
    ]);
    // Loads 2 × 8, hold 8 × 2 states; count up and down have text outputs: tested below.
    expect(functionTable(b, checkableRows(table), columns, { states })).toBe(32);
    expect(b.diagnostics).toEqual([]);
  });

  it('counts up with U̅/D LOW and down with it HIGH, wrapping; TC at the end, RC̅ follows CP', () => {
    const b = bench();
    for (let count = 1; count <= 16; count++) {
      clock(b);
      const end = (count & 15) === 15;
      b.expect({ ...word('Q', count & 15), TC: end ? 1 : 0, RC: end ? 0 : 1 });
    }
    b.set({ CP: 1 }).run(us(1)); // 1
    b.set({ UD: 1 }).run(us(1)); // while CP is HIGH: allowed
    b.set({ CP: 0 }).run(us(1));
    b.expect({ ...word('Q', 1), TC: 0 });
    clock(b);
    b.expect({ ...word('Q', 0), TC: 1, RC: 0 });
    clock(b);
    b.expect({ ...word('Q', 15), TC: 0, RC: 1 });
    expect(b.diagnostics).toEqual([]);
  });

  it('holds while CE̅ is HIGH, with RC̅ HIGH', () => {
    const b = bench(14);
    b.set({ CP: 1 }).run(us(1)); // 15
    b.set({ CE: 1 }).run(us(1));
    b.set({ CP: 0 }).run(us(1));
    b.expect({ ...word('Q', 15), TC: 1, RC: 1 });
    clock(b);
    b.expect(word('Q', 15));
    expect(b.diagnostics).toEqual([]);
  });

  it('loads asynchronously: Q follows D while PL̅ is LOW', () => {
    const b = bench(3);
    expect(b.measure({ ...word('D', 9), PL: 0 }, 'Q1')).toBe(ns(22));
    b.expect(word('Q', 9));
    expect(b.measure(word('D', 8), 'Q0')).toBe(ns(22));
    b.set({ PL: 1 }).run(us(1));
    b.set(word('D', 0)).run(us(1));
    b.expect(word('Q', 8));
  });

  it('switches after the delay of each path', () => {
    const b = bench(14);
    expect(b.measure({ CP: 1 }, 'TC')).toBe(ns(30)); // 15
    b.set({ CE: 1 }).run(us(1)); // CE̅ rises while CP is HIGH
    b.set({ CP: 0 }).run(us(1));
    expect(b.measure({ CE: 0 }, 'RC')).toBe(ns(12));
    b.run(us(1)); // CE̅'s set-up time
    expect(b.measure({ CP: 1 }, 'RC')).toBe(ns(17)); // 0
    expect(b.measure({ UD: 1 }, 'TC')).toBe(ns(16));
    b.set({ CP: 0 }).run(us(1));
    expect(b.measure({ UD: 0 }, 'RC')).toBe(ns(18)); // while CE̅ and CP are LOW: breaks a rule
    const c = bench(5);
    expect(c.measure({ CP: 1 }, 'Q0')).toBe(ns(26));
    expect(c.measure({ PL: 0, ...word('D', 15) }, 'TC')).toBe(ns(22));
  });

  it('is unknown from power-on until loaded; counting keeps it unknown', () => {
    const b = new Bench(d);
    b.set({ CP: 0, CE: 0, UD: 0, PL: 1, ...word('D', 6) }).run(us(1));
    b.expect({ Q0: 'X', Q3: 'X', TC: 'X' });
    clock(b);
    b.expect({ Q0: 'X', Q3: 'X' });
    b.set({ PL: 0 }).run(us(1));
    b.expect({ ...word('Q', 6), TC: 0, RC: 1 });
  });

  it('makes X only the bits an uncertain clock edge could change', () => {
    const b = bench(5);
    b.set({ CP: 'X' }).run(us(1));
    b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
  });

  it('merges the outcomes an unknown input allows', () => {
    /** At 5 with CP HIGH, `values` (no rule broken), then a clock edge. */
    const at5 = (values: BenchValues) => {
      const b = bench(4);
      b.set({ CP: 1 }).run(us(1));
      b.set(values).run(us(1));
      b.set({ CP: 0 }).run(us(1));
      b.set({ CP: 1 }).run(us(1));
      return b;
    };
    at5({ CE: 'X' }).expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 }); // 0110 or 0101
    at5({ UD: 'X' }).expect({ Q0: 0, Q1: 'X', Q2: 1, Q3: 0 }); // 0110 or 0100
    const b = bench(5);
    b.set({ PL: 'X', ...word('D', 4) }).run(us(1));
    b.expect({ Q0: 'X', Q1: 0, Q2: 1, Q3: 0 });
    const c = bench(5);
    c.set({ UD: 'X' }).run(us(1));
    c.expect({ TC: 0 }); // neither 15 nor 0
  });

  it('reports a floating input when the counter uses it', () => {
    const b = bench(5);
    b.set({ CP: 1 }).run(us(1));
    b.set({ CE: 'Z' }).run(us(1));
    b.set({ CP: 0 }).run(us(1));
    expect(b.diagnostics.map((x) => `${x.kind} ${x.net}`)).toEqual([
      `${KernelDiagnosticKind.FLOATING_INPUT} CE`,
    ]);
    clock(b);
    b.expect({ Q0: 'X', Q1: 1, Q2: 1, Q3: 0 }); // 0111 or 0110
  });

  describe('usage rules', () => {
    it('CE̅ rising while CP is LOW is reported and may have counted', () => {
      const b = bench(5);
      b.set({ CE: 1 }).run(us(1));
      expect(timing(b)).toMatchObject([
        {
          kind: TimingViolation.SETUP,
          pin: 'CE',
          message: 'CE rose while CP was LOW (CE may rise only while CP is HIGH)',
        },
      ]);
      b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
      const ok = bench(5);
      ok.set({ CP: 1 }).run(us(1)); // 6
      ok.set({ CE: 1 }).run(us(1));
      ok.set({ CP: 0 }).run(us(1));
      ok.set({ CE: 0 }).run(us(1)); // falling while CP is LOW: allowed
      ok.expect(word('Q', 6));
      expect(timing(ok)).toEqual([]);
    });

    it('U̅/D changing while CE̅ and CP are LOW is reported; the next count goes either way', () => {
      const b = bench(5);
      b.set({ UD: 1 }).run(us(1));
      expect(messages(b)).toEqual([
        'UD changed while CE and CP were LOW (it may change only while either is HIGH)',
      ]);
      b.expect(word('Q', 5));
      clock(b);
      b.expect({ Q0: 0, Q1: 'X', Q2: 1, Q3: 0 }); // 0110 or 0100
      clock(b); // the direction is known again: down from 01X0
      b.expect({ Q0: 1, Q1: 'X', Q2: 'X', Q3: 0 });
      b.set({ PL: 0, ...word('D', 5) }).run(us(1));
      b.set({ PL: 1 }).run(us(1));
      clock(b);
      b.expect(word('Q', 4));
      const ok = bench(5);
      ok.set({ CP: 1 }).run(us(1));
      ok.set({ CE: 1 }).run(us(1));
      ok.set({ CP: 0 }).run(us(1));
      ok.set({ UD: 1 }).run(us(1)); // CE̅ HIGH: allowed
      expect(timing(ok)).toEqual([]);
    });
  });

  describe('timing checks', () => {
    it('set-up of D to PL̅ rising: a late bit is X', () => {
      const load = (before: number) => {
        const b = bench(5);
        b.set({ PL: 0, ...word('D', 9) }).run(us(1));
        b.set({ D1: 1 }).run(ns(before));
        b.set({ PL: 1 }).run(us(1));
        return b;
      };
      expect(timing(load(20))).toEqual([]);
      load(20).expect(word('Q', 11));
      const b = load(19);
      expect(messages(b)).toEqual(['D1 changed 19 ns before PL rose (setup time ≥ 20 ns)']);
      b.expect({ Q0: 1, Q1: 'X', Q2: 0, Q3: 1 });
    });

    it('set-up of CE̅: count or hold where they differ', () => {
      const late = (before: number) => {
        const b = bench(5);
        b.set({ CP: 1 }).run(us(1)); // 6
        b.set({ CE: 1 }).run(us(1));
        b.set({ CP: 0 }).run(us(1));
        b.set({ CE: 0 }).run(ns(before));
        b.set({ CP: 1 }).run(us(1));
        return b;
      };
      expect(timing(late(28))).toEqual([]);
      late(28).expect(word('Q', 7));
      const b = late(27);
      expect(messages(b)).toEqual(['CE changed 27 ns before CP rose (setup time ≥ 28 ns)']);
      b.expect({ Q0: 'X', Q1: 1, Q2: 1, Q3: 0 }); // 0111 or 0110
    });

    it('set-up of U̅/D: up or down where they differ', () => {
      const late = (before: number) => {
        const b = bench(5);
        b.set({ CP: 1 }).run(us(1)); // 6
        b.set({ UD: 1 }).run(ns(before - 30));
        b.set({ CP: 0 }).run(ns(30));
        b.set({ CP: 1 }).run(us(1));
        return b;
      };
      expect(timing(late(41))).toEqual([]);
      late(41).expect(word('Q', 5));
      const b = late(40);
      expect(messages(b)).toEqual(['UD changed 40 ns before CP rose (setup time ≥ 41 ns)']);
      b.expect({ Q0: 1, Q1: 'X', Q2: 1, Q3: 0 }); // 0111 or 0101
    });

    it('accepts inputs changing right after the edge (hold time 0)', () => {
      const b = bench(5);
      b.set({ CP: 1 }).run(ns(1));
      b.set({ UD: 1 }).run(ns(1));
      b.set({ CE: 1 }).run(us(1));
      b.expect(word('Q', 6));
      expect(timing(b)).toEqual([]);
    });

    it('clock pulse width, both phases', () => {
      const b = bench(5);
      b.set({ CP: 1 }).run(us(1)); // 6
      b.set({ CP: 0 }).run(ns(24));
      b.set({ CP: 1 }).run(us(1));
      expect(messages(b)).toEqual(['CP was LOW for only 24 ns (pulse width ≥ 25 ns)']);
      b.expect({ Q0: 'X', Q1: 1, Q2: 1, Q3: 0 });
      const c = bench(5);
      c.set({ CP: 1 }).run(ns(24));
      c.set({ CP: 0 }).run(us(1));
      expect(messages(c)).toEqual(['CP was HIGH for only 24 ns (pulse width ≥ 25 ns)']);
      c.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
    });

    it('PL̅ pulse width: a short load makes X the bits it changed', () => {
      const pulse = (width: number) => {
        const b = bench(5);
        b.set(word('D', 6)).run(us(1));
        b.set({ PL: 0 }).run(ns(width));
        b.set({ PL: 1 }).run(us(1));
        return b;
      };
      expect(timing(pulse(20))).toEqual([]);
      const b = pulse(19);
      expect(messages(b)).toEqual(['PL was LOW for only 19 ns (pulse width ≥ 20 ns)']);
      b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
    });

    it('recovery: an edge too soon after PL̅ is released counts X', () => {
      const recover = (after: number) => {
        const b = bench(5);
        b.set({ PL: 0 }).run(us(1));
        b.set({ PL: 1 }).run(ns(after));
        b.set({ CP: 1 }).run(us(1));
        return b;
      };
      expect(timing(recover(7))).toEqual([]);
      recover(7).expect(word('Q', 6));
      const b = recover(6);
      expect(messages(b)).toEqual(['CP rose 6 ns after PL was released (recovery time ≥ 7 ns)']);
      b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
    });

    it('checks nothing on a clock running while PL̅ is LOW', () => {
      const b = bench(5);
      b.set({ PL: 0 }).run(us(1));
      for (let i = 0; i < 4; i++) {
        b.set({ CE: i & 1 ? 1 : 0, UD: i & 1 ? 1 : 0 });
        b.set({ CP: 1 }).run(ns(5));
        b.set({ CP: 0 }).run(ns(5));
      }
      expect(timing(b)).toEqual([]);
    });
  });
});

describe('74HC193', () => {
  const d = chip('193');

  /** Loaded with `value` long ago; both clocks HIGH, MR LOW. */
  function bench(value = 0): Bench {
    const b = new Bench(d);
    b.set({ CPU: 1, CPD: 1, MR: 0, PL: 0, ...word('D', value) }).run(us(1));
    b.set({ PL: 1 }).run(us(1));
    return b;
  }
  const pulse = (b: Bench, clock: 'CPU' | 'CPD') => {
    b.set({ [clock]: 0 }).run(us(1));
    b.set({ [clock]: 1 }).run(us(1));
  };

  it('follows its function table, by pin number', () => {
    const b = bench();
    const columns = names(d, [14, 11, 5, 4, ...D_PINS, ...Q_PINS, 12, 13]);
    const table = d.functionTable!;
    expect(columns).toEqual([...table.inputs, ...table.outputs]);
    // Reset 2 × 64, load 4 × 2; the count rows have text outputs: tested below.
    expect(functionTable(b, checkableRows(table), columns)).toBe(136);
    expect(b.diagnostics).toEqual([]);
  });

  it('counts up on CPU and down on CPD, wrapping; TC̅U and TC̅D duplicate the clock at the end', () => {
    const b = bench();
    for (let count = 1; count <= 16; count++) {
      b.set({ CPU: 0 }).run(us(1));
      b.expect({ TCU: (count & 15) === 0 ? 0 : 1, TCD: 1 });
      b.set({ CPU: 1 }).run(us(1));
      b.expect({ ...word('Q', count & 15), TCU: 1 });
    }
    for (let count = 15; count >= 0; count--) {
      b.set({ CPD: 0 }).run(us(1));
      b.expect({ TCD: count === 15 ? 0 : 1, TCU: 1 });
      b.set({ CPD: 1 }).run(us(1));
      b.expect(word('Q', count));
    }
    expect(b.diagnostics).toEqual([]);
  });

  it('clears at once with MR, over a parallel load; loads asynchronously with PL̅', () => {
    const b = bench(9);
    expect(b.measure({ MR: 1 }, 'Q0')).toBe(ns(21));
    b.set({ PL: 0, ...word('D', 6) }).run(us(1));
    b.expect(word('Q', 0));
    expect(b.measure({ MR: 0 }, 'Q1')).toBe(ns(21)); // PL̅ still LOW: loads 6
    b.expect(word('Q', 6));
    expect(b.measure({ D3: 1 }, 'Q3')).toBe(ns(25));
    b.set({ PL: 1 }).run(us(1));
    pulse(b, 'CPU');
    b.expect(word('Q', 15));
  });

  it('switches after the delay of each path', () => {
    const b = bench(14);
    b.set({ CPU: 0 }).run(us(1));
    expect(b.measure({ CPU: 1 }, 'Q0')).toBe(ns(23));
    expect(b.measure({ CPU: 0 }, 'TCU')).toBe(ns(14));
    const c = bench(0);
    expect(c.measure({ CPD: 0 }, 'TCD')).toBe(ns(14));
    c.set({ CPD: 1, CPU: 0 }).run(us(1));
    expect(c.measure({ PL: 0, ...word('D', 15) }, 'TCU')).toBe(ns(29));
    const e = bench(5);
    e.set({ CPD: 0 }).run(us(1));
    expect(e.measure({ MR: 1 }, 'TCD')).toBe(ns(27));
    const f = bench(5);
    f.set(word('D', 4)).run(us(1));
    expect(f.measure({ PL: 0 }, 'Q0')).toBe(ns(25));
  });

  it('reports a floating input it uses, and merges what it allows', () => {
    const b = bench(5);
    b.set({ PL: 'Z', ...word('D', 4) }).run(us(1));
    expect(b.diagnostics.map((x) => `${x.kind} ${x.net}`)).toEqual([
      `${KernelDiagnosticKind.FLOATING_INPUT} PL`,
    ]);
    b.expect({ Q0: 'X', Q1: 0, Q2: 1, Q3: 0 });
  });

  it('is unknown from power-on until reset or loaded', () => {
    const b = new Bench(d);
    b.set({ CPU: 1, CPD: 1, MR: 0, PL: 1, ...word('D', 6) }).run(us(1));
    b.expect({ Q0: 'X', Q3: 'X', TCU: 1, TCD: 1 });
    b.set({ CPU: 0 }).run(us(1));
    b.expect({ TCU: 'X' });
    b.set({ MR: 1 }).run(us(1));
    b.expect({ ...word('Q', 0), TCU: 1 });
  });

  it('makes X only the bits an uncertain clock edge could change', () => {
    const b = bench(5);
    b.set({ CPU: 0 }).run(us(1));
    b.set({ CPU: 'X' }).run(us(1));
    b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
  });

  it("doesn't use D while MR holds it cleared, even with PL̅ LOW", () => {
    const b = bench(5);
    b.set({ MR: 1, PL: 0, D2: 'Z' }).run(us(1));
    b.expect(word('Q', 0));
    expect(b.diagnostics).toEqual([]);
  });

  it('merges the outcomes an unknown MR or PL̅ allows', () => {
    const b = bench(5);
    b.set({ MR: 'X' }).run(us(1));
    b.expect({ Q0: 'X', Q1: 0, Q2: 'X', Q3: 0 });
    const c = bench(5);
    c.set({ PL: 'X', ...word('D', 4) }).run(us(1));
    c.expect({ Q0: 'X', Q1: 0, Q2: 1, Q3: 0 });
  });

  describe('the other clock', () => {
    it('a clock rising while the other is LOW is a hold violation and may have counted', () => {
      const b = bench(5);
      b.set({ CPD: 0 }).run(us(1));
      b.set({ CPU: 0 }).run(us(1));
      b.set({ CPU: 1 }).run(us(1));
      expect(timing(b)).toMatchObject([
        {
          kind: TimingViolation.HOLD,
          pin: 'CPD',
          message: 'CPU rose while CPD was LOW (CPD must stay HIGH while CPU counts)',
        },
      ]);
      b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 }); // 0101 or 0110
      b.set({ CPD: 1 }).run(us(1)); // CPU HIGH: a proper count down
      expect(timing(b)).toHaveLength(1);
    });

    it('both clocks rising together count up or down', () => {
      const b = bench(5);
      b.set({ CPU: 0, CPD: 0 }).run(us(1));
      b.set({ CPU: 1, CPD: 1 }).run(us(1));
      expect(messages(b)).toEqual([
        'CPU and CPD rose at the same time (one clock must stay HIGH while the other counts)',
      ]);
      b.expect({ Q0: 0, Q1: 'X', Q2: 1, Q3: 0 }); // 0110 or 0100
    });

    it('the other clock must stay HIGH th after the counting edge', () => {
      const early = (after: number) => {
        const b = bench(5);
        b.set({ CPU: 0 }).run(us(1));
        b.set({ CPU: 1 }).run(ns(after));
        b.set({ CPD: 0 }).run(us(1));
        return b;
      };
      expect(timing(early(16))).toEqual([]);
      early(16).expect(word('Q', 6));
      const b = early(15);
      expect(messages(b)).toEqual(['CPD fell 15 ns after CPU rose (hold time ≥ 16 ns)']);
      b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
    });
  });

  describe('timing checks', () => {
    it('clock pulse width, both clocks and phases', () => {
      const b = bench(5);
      b.set({ CPU: 0 }).run(ns(19));
      b.set({ CPU: 1 }).run(us(1));
      expect(messages(b)).toEqual(['CPU was LOW for only 19 ns (pulse width ≥ 20 ns)']);
      b.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
      const c = bench(5);
      c.set({ CPD: 0 }).run(us(1));
      c.set({ CPD: 1 }).run(ns(19)); // 4
      c.set({ CPD: 0 }).run(us(1));
      expect(messages(c)).toEqual(['CPD was HIGH for only 19 ns (pulse width ≥ 20 ns)']);
      c.expect({ Q0: 'X', Q1: 0, Q2: 1, Q3: 0 });
      const ok = bench(5);
      ok.set({ CPU: 0 }).run(ns(20));
      ok.set({ CPU: 1 }).run(ns(20));
      ok.set({ CPU: 0 }).run(us(1));
      expect(timing(ok)).toEqual([]);
    });

    it('MR and PL̅ pulse widths', () => {
      const ok = bench(5);
      ok.set({ MR: 1 }).run(ns(20));
      ok.set({ MR: 0 }).run(us(1));
      ok.set(word('D', 6)).run(us(1));
      ok.set({ PL: 0 }).run(ns(20));
      ok.set({ PL: 1 }).run(us(1));
      expect(timing(ok)).toEqual([]);
      ok.expect(word('Q', 6));
      const b = bench(5);
      b.set({ MR: 1 }).run(ns(19));
      b.set({ MR: 0 }).run(us(1));
      expect(messages(b)).toEqual(['MR was HIGH for only 19 ns (pulse width ≥ 20 ns)']);
      b.expect({ Q0: 'X', Q1: 0, Q2: 'X', Q3: 0 });
      const c = bench(5);
      c.set(word('D', 6)).run(us(1));
      c.set({ PL: 0 }).run(ns(19));
      c.set({ PL: 1 }).run(us(1));
      expect(messages(c)).toEqual(['PL was LOW for only 19 ns (pulse width ≥ 20 ns)']);
      c.expect({ Q0: 'X', Q1: 'X', Q2: 1, Q3: 0 });
    });

    it('recovery of MR and PL̅ before either clock', () => {
      const recover = (pin: 'MR' | 'PL', clock: 'CPU' | 'CPD', after: number) => {
        const b = bench(5);
        b.set({ [clock]: 0 }).run(us(1));
        b.set({ [pin]: pin === 'MR' ? 1 : 0 }).run(us(1));
        b.set({ [pin]: pin === 'MR' ? 0 : 1 }).run(ns(after));
        b.set({ [clock]: 1 }).run(us(1));
        return b;
      };
      expect(timing(recover('MR', 'CPU', 10))).toEqual([]);
      expect(messages(recover('MR', 'CPD', 9))).toEqual([
        'CPD rose 9 ns after MR was released (recovery time ≥ 10 ns)',
      ]);
      recover('MR', 'CPD', 9).expect({ Q0: 'X', Q1: 'X', Q2: 'X', Q3: 'X' }); // 0 or 15
      expect(messages(recover('PL', 'CPU', 9))).toEqual([
        'CPU rose 9 ns after PL was released (recovery time ≥ 10 ns)',
      ]);
      expect(timing(recover('PL', 'CPD', 10))).toEqual([]);
    });

    it('set-up of D to PL̅ rising: a late bit is X', () => {
      const ok = bench(5);
      ok.set({ PL: 0, ...word('D', 9) }).run(us(1));
      ok.set({ D1: 1 }).run(ns(16));
      ok.set({ PL: 1 }).run(us(1));
      expect(timing(ok)).toEqual([]);
      ok.expect(word('Q', 11));
      const b = bench(5);
      b.set({ PL: 0, ...word('D', 9) }).run(us(1));
      b.set({ D1: 1 }).run(ns(15));
      b.set({ PL: 1 }).run(us(1));
      expect(messages(b)).toEqual(['D1 changed 15 ns before PL rose (setup time ≥ 16 ns)']);
      b.expect({ Q0: 1, Q1: 'X', Q2: 0, Q3: 1 });
    });
  });
});
