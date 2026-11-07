import { describe, expect, it } from 'vitest';
import {
  type AnyComponentDefinition,
  isTimingViolation,
  KernelDiagnosticKind,
  Level,
  ns,
  pinsOf,
  TimingViolation,
  us,
} from '../../core';
import { Bench, type BenchValues, checkableRows, functionTable } from '../../core/testing';
import { hcShiftRegisters } from './shift-registers';

const chip = (number: string) => hcShiftRegisters.find((d) => d.name === `74HC${number}`)!;
const names = (d: AnyComponentDefinition, numbers: readonly (number | null)[]) =>
  numbers.map((n) => (n === null ? null : pinsOf(d, {}).find((p) => p.number === n)!.name));
const timing = (b: Bench) => b.diagnostics.filter((x) => isTimingViolation(x.kind));
const messages = (b: Bench) => timing(b).map((x) => x.message);
/** `{ Q0: …, Q1: … }` (or another prefix) for the eight bits of `value`. */
const byte = (value: number, prefix = 'Q'): BenchValues =>
  Object.fromEntries(
    Array.from({ length: 8 }, (_, n) => [`${prefix}${n}`, (value >> n) & 1 ? 1 : 0]),
  );

describe('74HC164', () => {
  const d = chip('164');

  /** Cleared long ago; CP LOW, DSB HIGH (DSA is the data), DSA LOW. */
  function bench(): Bench {
    const b = new Bench(d);
    b.set({ CP: 0, DSA: 0, DSB: 1, MR: 0 }).run(us(1));
    b.set({ MR: 1 }).run(us(1));
    return b;
  }
  const shiftIn = (b: Bench, bit: 0 | 1) => {
    b.set({ DSA: bit }).run(us(1));
    b.set({ CP: 1 }).run(us(1));
    b.set({ CP: 0 }).run(us(1));
  };
  /** Shifts in `value`'s bits, bit 7 first, so Q0…Q7 end up holding bit 0…7. */
  function load(b: Bench, value: number) {
    for (let n = 7; n >= 0; n--) shiftIn(b, ((value >> n) & 1) as 0 | 1);
  }

  it('follows its function table, by pin number', () => {
    const b = bench();
    const columns = names(d, [9, 8, 1, 2, 3, null]);
    expect(columns.slice(0, 5)).toEqual(['MR', 'CP', 'DSA', 'DSB', 'Q0']);
    // Reset 8, the four shifts; Q1–Q7 (q0–q6) are checked below.
    expect(functionTable(b, checkableRows(d.functionTable!, ['Q1–Q7']), columns)).toBe(12);
    expect(b.diagnostics).toEqual([]);
  });

  it('shifts DSA · DSB into Q0 and every stage into the next on the rising edge', () => {
    const b = bench();
    load(b, 0b1011_0010);
    b.expect(byte(0b1011_0010));
    shiftIn(b, 1);
    b.expect(byte(0b0110_0101));
    b.set({ DSB: 0, DSA: 1 }).run(us(1)); // DSB gates DSA
    b.set({ CP: 1 }).run(us(1));
    b.expect(byte(0b1100_1010));
    b.set({ CP: 0 }).run(us(1)); // a falling edge: nothing
    b.expect(byte(0b1100_1010));
    expect(b.diagnostics).toEqual([]);
  });

  it('clears at once while MR̅ is LOW, ignoring the clock', () => {
    const b = bench();
    load(b, 0xff);
    expect(b.measure({ MR: 0 }, 'Q5')).toBe(ns(14));
    b.expect(byte(0));
    shiftIn(b, 1);
    b.expect(byte(0)).expectNoDiagnostics();
  });

  it('switches after tpd(CP to Qn)', () => {
    const b = bench();
    b.set({ DSA: 1 }).run(us(1));
    expect(b.measure({ CP: 1 }, 'Q0')).toBe(ns(15));
  });

  it('is unknown from power-on until cleared; shifting moves known bits in', () => {
    const b = new Bench(d);
    b.set({ CP: 0, DSA: 1, DSB: 1, MR: 1 }).run(us(1));
    b.expect({ Q0: 'X', Q7: 'X' });
    b.set({ CP: 1 }).run(us(1));
    b.expect({ Q0: 1, Q1: 'X' });
  });

  it('makes X only the stages an uncertain clock edge could change', () => {
    const b = bench();
    load(b, 0b0000_0110);
    b.set({ DSA: 0 }).run(us(1));
    b.set({ CP: 'X' }).run(us(1)); // would give 0000 1100
    b.expect({ Q0: 0, Q1: 'X', Q2: 1, Q3: 'X', Q4: 0 });
  });

  it('shifts in what an unknown serial input allows, and reports it floating', () => {
    const b = bench();
    b.set({ DSA: 'X', DSB: 0 }).run(us(1));
    b.set({ CP: 1 }).run(us(1));
    b.expect({ Q0: 0 }); // DSB LOW decides
    b.set({ CP: 0, DSA: 'Z', DSB: 1 }).run(us(1));
    b.set({ CP: 1 }).run(us(1));
    b.expect({ Q0: 'X', Q1: 0 });
    expect(b.diagnostics.map((x) => `${x.kind} ${x.net}`)).toEqual([
      `${KernelDiagnosticKind.FLOATING_INPUT} DSA`,
    ]);
  });

  describe('timing checks', () => {
    it('set-up of DSA and DSB: a late input shifts in X where it matters', () => {
      const late = (before: number, setup: BenchValues = {}) => {
        const b = bench();
        b.set(setup).run(us(1));
        b.set({ DSA: 1 }).run(ns(before));
        b.set({ CP: 1 }).run(us(1));
        return b;
      };
      expect(timing(late(12))).toEqual([]);
      const b = late(11);
      expect(messages(b)).toEqual(['DSA changed 11 ns before CP rose (setup time ≥ 12 ns)']);
      b.expect({ Q0: 'X', Q1: 0 });
      late(11, { DSB: 0 }).expect({ Q0: 0 }); // reported, but DSB LOW decides
    });

    it('hold of DSA and DSB: a change right after the edge makes Q0 X if it differs', () => {
      const early = (after: number, to: 0 | 1) => {
        const b = bench();
        b.set({ CP: 1 }).run(ns(after));
        b.set({ DSA: to }).run(us(1));
        return b;
      };
      expect(timing(early(4, 1))).toEqual([]);
      early(4, 1).expect({ Q0: 0 });
      const b = early(3, 1);
      expect(messages(b)).toEqual(['DSA changed 3 ns after CP rose (hold time ≥ 4 ns)']);
      expect(timing(b)[0]!.kind).toBe(TimingViolation.HOLD);
      b.expect({ Q0: 'X' });
    });

    it('clock pulse width, both phases', () => {
      const ok = bench();
      load(ok, 0b10);
      ok.set({ CP: 1 }).run(ns(16));
      ok.set({ CP: 0 }).run(ns(16));
      ok.set({ CP: 1 }).run(us(1));
      expect(timing(ok)).toEqual([]);
      ok.expect({ Q1: 0, Q2: 0, Q3: 1 });
      const b = bench();
      load(b, 0b10);
      b.set({ CP: 1 }).run(ns(15)); // 0100
      b.set({ CP: 0 }).run(us(1));
      expect(messages(b)).toEqual(['CP was HIGH for only 15 ns (pulse width ≥ 16 ns)']);
      b.expect({ Q0: 0, Q1: 'X', Q2: 'X', Q3: 0 });
      const c = bench();
      load(c, 0b10);
      c.set({ CP: 1 }).run(us(1));
      c.set({ CP: 0 }).run(ns(15));
      c.set({ CP: 1 }).run(us(1)); // 0100 → 1000
      expect(messages(c)).toEqual(['CP was LOW for only 15 ns (pulse width ≥ 16 ns)']);
      c.expect({ Q0: 0, Q1: 0, Q2: 'X', Q3: 'X' });
    });

    it('MR̅ pulse width and recovery', () => {
      const ok = bench();
      load(ok, 0b101);
      ok.set({ MR: 0 }).run(ns(12));
      ok.set({ MR: 1 }).run(us(1));
      expect(timing(ok)).toEqual([]);
      ok.expect(byte(0));
      const b = bench();
      load(b, 0b101);
      b.set({ MR: 0 }).run(ns(11));
      b.set({ MR: 1 }).run(us(1));
      expect(messages(b)).toEqual(['MR was LOW for only 11 ns (pulse width ≥ 12 ns)']);
      b.expect({ Q0: 'X', Q1: 0, Q2: 'X', Q3: 0 });
      const recover = (after: number) => {
        const c = bench();
        c.set({ DSA: 1 }).run(us(1));
        c.set({ MR: 0 }).run(us(1));
        c.set({ MR: 1 }).run(ns(after));
        c.set({ CP: 1 }).run(us(1));
        return c;
      };
      expect(timing(recover(12))).toEqual([]);
      const c = recover(11);
      expect(messages(c)).toEqual(['CP rose 11 ns after MR was released (recovery time ≥ 12 ns)']);
      c.expect({ Q0: 'X', Q1: 0 });
    });

    it('checks nothing on a clock running while MR̅ holds it cleared', () => {
      const b = bench();
      b.set({ MR: 0 }).run(us(1));
      for (let i = 0; i < 4; i++) {
        b.set({ DSA: i & 1 ? 1 : 0, CP: 1 }).run(ns(5));
        b.set({ CP: 0 }).run(ns(5));
      }
      expect(timing(b)).toEqual([]);
    });
  });
});

describe('74HC165', () => {
  const d = chip('165');

  /** Loaded with `value` long ago; CP LOW, CE̅ LOW, DS LOW. */
  function bench(value = 0): Bench {
    const b = new Bench(d);
    b.set({ CP: 0, CE: 0, DS: 0, PL: 0, ...byte(value, 'D') }).run(us(1));
    b.set({ PL: 1 }).run(us(1));
    return b;
  }
  const clock = (b: Bench, pin: 'CP' | 'CE' = 'CP') => {
    b.set({ [pin]: 1 }).run(us(1));
    b.set({ [pin]: 0 }).run(us(1));
  };
  /** Q7 after each of `n` shifts, Q7 now first. */
  const shiftOut = (b: Bench, n: number, pin: 'CP' | 'CE' = 'CP') => {
    const bits = [b.get('Q7')];
    for (let i = 0; i < n; i++) {
      clock(b, pin);
      bits.push(b.get('Q7'));
    }
    return bits;
  };

  it('follows its function table, by pin number', () => {
    const b = bench();
    const columns = names(d, [1, 15, 2, 10, 6, null, null, 9, 7]);
    expect(columns).toEqual(['PL', 'CE', 'CP', 'DS', 'D7', null, null, 'Q7', 'Q7N']);
    const states = ([0, 1] as const).map((v): BenchValues[] => [
      { PL: 0, D7: v, CP: 1, CE: 1 },
      { PL: 1 },
    ]);
    // Loads 2 × 8, holds 2 × 8 × 2 states; the shifts (q6) are checked below.
    const table = checkableRows(d.functionTable!, ['Q0', 'Q1–Q6']);
    expect(functionTable(b, table, columns, { states })).toBe(48);
    expect(b.diagnostics).toEqual([]);
  });

  it('shifts the loaded byte out of Q7, D7 first, DS filling in', () => {
    const b = bench(0b1011_0010);
    b.set({ DS: 1 }).run(us(1));
    expect(shiftOut(b, 9)).toEqual([1, 0, 1, 1, 0, 0, 1, 0, 1, 1]);
    b.expect({ Q7N: 0 });
    expect(b.diagnostics).toEqual([]);
  });

  it('shifts on CE̅ rising while CP is LOW: the two pins are interchangeable', () => {
    const b = bench(0b0100_0000);
    b.set({ CE: 1 }).run(us(1)); // rising while CP is LOW: one shift
    b.expect({ Q7: 1 });
    b.set({ CE: 0 }).run(us(1));
    expect(shiftOut(b, 2, 'CE')).toEqual([1, 0, 0]);
    expect(b.diagnostics).toEqual([]);
  });

  it('holds while CE̅ or CP is HIGH', () => {
    const b = bench(0b1000_0000);
    b.set({ CP: 1 }).run(us(1)); // one shift: Q7 = 0
    clock(b, 'CE'); // CP HIGH: the internal clock stays HIGH
    b.expect({ Q7: 0 });
    b.set({ CP: 0 }).run(us(1));
    b.set({ CE: 1 }).run(us(1)); // a shift
    clock(b, 'CP'); // CE̅ HIGH
    b.expect({ Q7: 0 });
    expect(b.diagnostics).toEqual([]);
  });

  it('loads asynchronously: Q7 follows D7 while PL̅ is LOW', () => {
    const b = bench(0);
    expect(b.measure({ PL: 0, D7: 1 }, 'Q7')).toBe(ns(18));
    expect(b.measure({ D7: 0 }, 'Q7N')).toBe(ns(13));
    clock(b);
    b.expect({ Q7: 0 });
  });

  it('switches after tpd(CP, CE to Q7, Q7N)', () => {
    const b = bench(0b0100_0000);
    expect(b.measure({ CP: 1 }, 'Q7')).toBe(ns(19));
    b.set({ CP: 0 }).run(us(1));
    expect(b.measure({ CP: 1 }, 'Q7N')).toBe(ns(19));
  });

  it('is unknown from power-on until loaded', () => {
    const b = new Bench(d);
    b.set({ CP: 0, CE: 0, DS: 1, PL: 1 }).run(us(1));
    b.expect({ Q7: 'X', Q7N: 'X' });
    b.set({ PL: 0, ...byte(0x80, 'D') }).run(us(1));
    b.expect({ Q7: 1, Q7N: 0 });
  });

  it('makes X only the stages an uncertain internal clock edge could change', () => {
    const b = bench(0b1100_0000);
    b.set({ CP: 'X' }).run(us(1));
    b.expect({ Q7: 1 }); // 1 shifted onto 1
    const c = bench(0b0100_0000);
    c.set({ CE: 'X' }).run(us(1));
    c.expect({ Q7: 'X' });
  });

  it('merges an unknown PL̅, and reports a floating serial input when it shifts', () => {
    const b = bench(0x80);
    b.set({ PL: 'X', D7: 0 }).run(us(1));
    b.expect({ Q7: 'X' });
    const c = bench(0);
    c.set({ DS: 'Z' }).run(us(1));
    expect(c.diagnostics).toEqual([]);
    clock(c);
    expect(c.diagnostics.map((x) => `${x.kind} ${x.net}`)).toEqual([
      `${KernelDiagnosticKind.FLOATING_INPUT} DS`,
    ]);
  });

  describe('timing checks', () => {
    it('set-up and hold of D to PL̅ rising', () => {
      const late = (before: number) => {
        const b = bench(0);
        b.set({ PL: 0 }).run(us(1));
        b.set({ D7: 1 }).run(ns(before));
        b.set({ PL: 1 }).run(us(1));
        return b;
      };
      expect(timing(late(16))).toEqual([]);
      const b = late(15);
      expect(messages(b)).toEqual(['D7 changed 15 ns before PL rose (setup time ≥ 16 ns)']);
      b.expect({ Q7: 'X' });
      const early = (after: number) => {
        const c = bench(0);
        c.set({ PL: 0 }).run(us(1));
        c.set({ PL: 1 }).run(ns(after));
        c.set({ D7: 1 }).run(us(1));
        return c;
      };
      expect(timing(early(5))).toEqual([]);
      early(5).expect({ Q7: 0 });
      const c = early(4);
      expect(messages(c)).toEqual(['D7 changed 4 ns after PL rose (hold time ≥ 5 ns)']);
      c.expect({ Q7: 'X' });
    });

    it('set-up and hold of DS to the clock', () => {
      const late = (before: number) => {
        const b = bench(0);
        b.set({ DS: 1 }).run(ns(before));
        b.set({ CP: 1 }).run(us(1));
        b.set({ CP: 0 }).run(us(1));
        return b;
      };
      expect(timing(late(16))).toEqual([]);
      const b = late(15);
      expect(messages(b)).toEqual(['DS changed 15 ns before CP rose (setup time ≥ 16 ns)']);
      expect(shiftOut(b, 7).at(-1)).toBe(Level.X); // the X shifted in, seven stages later
      const early = (after: number) => {
        const c = bench(0);
        c.set({ CP: 1 }).run(ns(after));
        c.set({ DS: 1 }).run(us(1));
        c.set({ CP: 0 }).run(us(1));
        return c;
      };
      expect(timing(early(5))).toEqual([]);
      expect(messages(early(4))).toEqual(['DS changed 4 ns after CP rose (hold time ≥ 5 ns)']);
      expect(shiftOut(early(4), 7).at(-1)).toBe(Level.X);
      expect(shiftOut(early(5), 7).at(-1)).toBe(Level.L0);
    });

    it('set-up and hold of CE̅ to CP: the shift may or may not have happened', () => {
      const late = (before: number) => {
        const b = bench(0b0100_0000);
        b.set({ CE: 1 }).run(us(1)); // shifts: Q7 = 1, Q6 = 0
        b.set({ CE: 0 }).run(ns(before)); // CP LOW: the internal clock falls
        b.set({ CP: 1 }).run(us(1));
        return b;
      };
      expect(timing(late(16))).toEqual([]);
      late(16).expect({ Q7: 0 });
      const b = late(15);
      expect(messages(b)).toEqual(['CE changed 15 ns before CP rose (setup time ≥ 16 ns)']);
      b.expect({ Q7: 'X' });
      const early = (after: number) => {
        const c = bench(0b0100_0000);
        c.set({ CP: 1 }).run(ns(after)); // Q7 = 1
        c.set({ CE: 1 }).run(us(1));
        return c;
      };
      expect(timing(early(5))).toEqual([]);
      const c = early(4);
      expect(messages(c)).toEqual(['CE changed 4 ns after CP rose (hold time ≥ 5 ns)']);
      c.expect({ Q7: 'X' });
    });

    it('checks nothing on CP while CE̅ is HIGH or PL̅ is LOW', () => {
      const holds: BenchValues[] = [{ CE: 1 }, { PL: 0 }];
      for (const hold of holds) {
        const b = bench(0);
        b.set(hold).run(us(1));
        // PL̅ released (or not) 5 ns before CP rises: no recovery time while CP doesn't clock.
        b.set({ PL: 0 }).run(us(1));
        b.set({ PL: 1, ...hold }).run(ns(5));
        for (let i = 0; i < 4; i++) {
          b.set({ DS: i & 1 ? 1 : 0, CE: 'CE' in hold ? 1 : 0 });
          b.set({ CP: 1 }).run(ns(5));
          b.set({ CP: 0 }).run(ns(5));
        }
        expect(timing(b)).toEqual([]);
      }
    });

    it('clock pulse width, PL̅ pulse width and recovery', () => {
      const ok = bench(0b0100_0000);
      ok.set({ CP: 1 }).run(ns(16));
      ok.set({ CP: 0 }).run(us(1));
      ok.set({ D7: 1, PL: 0 }).run(ns(16));
      ok.set({ PL: 1 }).run(us(1));
      expect(timing(ok)).toEqual([]);
      ok.expect({ Q7: 1 });
      const b = bench(0b0100_0000);
      b.set({ CP: 1 }).run(ns(15));
      b.set({ CP: 0 }).run(us(1));
      expect(messages(b)).toEqual(['CP was HIGH for only 15 ns (pulse width ≥ 16 ns)']);
      b.expect({ Q7: 'X' });
      const c = bench(0);
      c.set({ D7: 1 }).run(us(1));
      c.set({ PL: 0 }).run(ns(15));
      c.set({ PL: 1 }).run(us(1));
      expect(messages(c)).toEqual(['PL was LOW for only 15 ns (pulse width ≥ 16 ns)']);
      c.expect({ Q7: 'X' });
      const recover = (pin: 'CP' | 'CE', after: number) => {
        const e = bench(0b0100_0000);
        e.set({ PL: 0 }).run(us(1));
        e.set({ PL: 1 }).run(ns(after));
        e.set({ [pin]: 1 }).run(us(1));
        return e;
      };
      expect(timing(recover('CP', 20))).toEqual([]);
      expect(messages(recover('CE', 19))).toEqual([
        'CE rose 19 ns after PL was released (recovery time ≥ 20 ns)',
      ]);
      recover('CP', 19).expect({ Q7: 'X' });
    });
  });
});

describe('74HC595', () => {
  const d = chip('595');
  const Q_PINS = [15, 1, 2, 3, 4, 5, 6, 7];

  /** Both registers cleared long ago; clocks LOW, outputs enabled, DS LOW. */
  function bench(): Bench {
    const b = new Bench(d);
    b.set({ SHCP: 0, STCP: 0, OE: 0, DS: 0, MR: 0 }).run(us(1));
    b.set({ STCP: 1 }).run(us(1));
    b.set({ STCP: 0, MR: 1 }).run(us(1));
    return b;
  }
  const pulse = (b: Bench, pin: 'SHCP' | 'STCP') => {
    b.set({ [pin]: 1 }).run(us(1));
    b.set({ [pin]: 0 }).run(us(1));
  };
  /** Shifts in `value`, bit 7 first, so stages 0…7 end up holding bit 0…7. */
  function shiftIn(b: Bench, value: number) {
    for (let n = 7; n >= 0; n--) {
      b.set({ DS: (value >> n) & 1 ? 1 : 0 }).run(us(1));
      pulse(b, 'SHCP');
    }
  }

  it.each([0, 3, 7])('follows its function table, by pin number (output %s)', (n) => {
    const b = bench();
    const columns = names(d, [11, 12, 13, 10, 14, 9, Q_PINS[n]!]);
    expect(columns.slice(0, 6)).toEqual(['SHCP', 'STCP', 'OE', 'MR', 'DS', 'Q7S']);
    // Store the cleared register 4, outputs off 8; NC and the shifting rows are tested below.
    expect(functionTable(b, checkableRows(d.functionTable!), columns)).toBe(12);
    expect(b.diagnostics).toEqual([]);
  });

  it('shifts on SHCP and shows the byte only when STCP stores it', () => {
    const b = bench();
    shiftIn(b, 0b1011_0010);
    b.expect({ ...byte(0), Q7S: 1 });
    pulse(b, 'STCP');
    b.expect({ ...byte(0b1011_0010), Q7S: 1 });
    shiftIn(b, 0x0f);
    b.expect({ ...byte(0b1011_0010), Q7S: 0 });
    expect(b.diagnostics).toEqual([]);
  });

  it('MR̅ clears the shift register only', () => {
    const b = bench();
    shiftIn(b, 0xff);
    pulse(b, 'STCP');
    expect(b.measure({ MR: 0 }, 'Q7S')).toBe(ns(17));
    b.expect(byte(0xff));
    pulse(b, 'STCP');
    b.expect(byte(0));
  });

  it('OE̅ HIGH floats the outputs; storing goes on meanwhile', () => {
    const b = bench();
    shiftIn(b, 0x81);
    expect(b.measure({ OE: 1 }, 'Q0')).toBe(ns(15));
    b.expect({ Q0: 'Z', Q7: 'Z', Q7S: 1 });
    pulse(b, 'STCP');
    expect(b.measure({ OE: 0 }, 'Q0')).toBe(ns(17));
    b.expect(byte(0x81));
    b.set({ OE: 'X' }).run(us(1));
    b.expect({ Q0: 'X', Q1: 'X' });
  });

  it('switches after the delay of each path', () => {
    const b = bench();
    b.set({ DS: 1 }).run(us(1));
    pulse(b, 'SHCP');
    expect(b.measure({ STCP: 1 }, 'Q0')).toBe(ns(20));
    b.set({ SHCP: 0 }).run(us(1));
    shiftIn(b, 0x7f);
    expect(b.measure({ SHCP: 1 }, 'Q7S')).toBe(ns(19));
  });

  describe('SHCP and STCP tied together', () => {
    it('stores the shift register from before the shift: one clock pulse behind', () => {
      const b = bench();
      b.set({ DS: 1 }).run(us(1));
      for (let i = 1; i <= 8; i++) {
        b.set({ SHCP: 1, STCP: 1 }).run(us(1));
        b.set({ SHCP: 0, STCP: 0 }).run(us(1));
        b.expect({ ...byte((1 << (i - 1)) - 1), Q7S: i === 8 ? 1 : 0 });
      }
      expect(b.diagnostics).toEqual([]);
    });

    it('also when STCP rises in a later delta of the same instant', () => {
      const b = bench();
      b.set({ DS: 1 }).run(us(1));
      b.set({ SHCP: 1 }).run(0); // the shift happens now…
      b.set({ STCP: 1 }).run(us(1)); // …and STCP rises at the same time
      b.expect({ Q0: 0 });
      expect(b.diagnostics).toEqual([]);
    });

    it('STCP within tsu(SHCP to STCP) after SHCP stores X where old and new differ', () => {
      const store = (after: number) => {
        const b = bench();
        shiftIn(b, 0b0000_0101);
        b.set({ DS: 1 }).run(us(1));
        b.set({ SHCP: 1 }).run(ns(after)); // → 0000 1011
        b.set({ STCP: 1 }).run(us(1));
        return b;
      };
      expect(timing(store(15))).toEqual([]);
      store(15).expect(byte(0b0000_1011));
      const b = store(14);
      expect(messages(b)).toEqual(['SHCP rose 14 ns before STCP rose (setup time ≥ 15 ns)']);
      expect(timing(b)[0]!.kind).toBe(TimingViolation.SETUP);
      b.expect({ Q0: 1, Q1: 'X', Q2: 'X', Q3: 'X', Q4: 0 }); // 0000 0101 or 0000 1011
    });
  });

  it('is unknown from power-on until cleared and stored', () => {
    const b = new Bench(d);
    b.set({ SHCP: 0, STCP: 0, OE: 0, DS: 1, MR: 1 }).run(us(1));
    b.expect({ Q0: 'X', Q7: 'X', Q7S: 'X' });
    pulse(b, 'STCP');
    b.expect({ Q0: 'X' });
    pulse(b, 'SHCP');
    pulse(b, 'STCP');
    b.expect({ Q0: 1, Q1: 'X' });
  });

  it('shifts X only where an uncertain SHCP edge could change, and merges an unknown MR̅', () => {
    const b = bench();
    shiftIn(b, 0b0000_0011);
    b.set({ DS: 1, SHCP: 'X' }).run(us(1)); // would give 0000 0111
    pulse(b, 'STCP');
    b.expect({ Q0: 1, Q1: 1, Q2: 'X', Q3: 0 });
    const c = bench();
    shiftIn(c, 0b0000_0101);
    c.set({ MR: 'X' }).run(us(1));
    pulse(c, 'STCP');
    c.expect({ Q0: 'X', Q1: 0, Q2: 'X', Q3: 0 });
  });

  it('stores X only where an uncertain STCP edge could change the storage register', () => {
    const b = bench();
    shiftIn(b, 0b0000_0011);
    b.set({ STCP: 'X' }).run(us(1));
    b.expect({ Q0: 'X', Q1: 'X', Q2: 0 });
  });

  it('reports a floating serial input when it shifts', () => {
    const b = bench();
    b.set({ DS: 'Z' }).run(us(1));
    expect(b.diagnostics).toEqual([]);
    pulse(b, 'SHCP');
    pulse(b, 'STCP');
    expect(b.diagnostics.map((x) => `${x.kind} ${x.net}`)).toEqual([
      `${KernelDiagnosticKind.FLOATING_INPUT} DS`,
    ]);
    b.expect({ Q0: 'X', Q1: 0 });
  });

  describe('timing checks', () => {
    it('set-up and hold of DS to SHCP', () => {
      const late = (before: number) => {
        const b = bench();
        b.set({ DS: 1 }).run(ns(before));
        pulse(b, 'SHCP');
        pulse(b, 'STCP');
        return b;
      };
      expect(timing(late(10))).toEqual([]);
      const b = late(9);
      expect(messages(b)).toEqual(['DS changed 9 ns before SHCP rose (setup time ≥ 10 ns)']);
      b.expect({ Q0: 'X' });
      const early = (after: number) => {
        const c = bench();
        c.set({ SHCP: 1 }).run(ns(after));
        c.set({ DS: 1 }).run(us(1));
        c.set({ SHCP: 0 }).run(us(1));
        pulse(c, 'STCP');
        return c;
      };
      expect(timing(early(3))).toEqual([]);
      const c = early(2);
      expect(messages(c)).toEqual(['DS changed 2 ns after SHCP rose (hold time ≥ 3 ns)']);
      c.expect({ Q0: 'X' });
    });

    it('pulse widths of SHCP, STCP and MR̅', () => {
      const ok = bench();
      ok.set({ DS: 1 }).run(us(1));
      ok.set({ SHCP: 1 }).run(ns(15));
      ok.set({ SHCP: 0 }).run(us(1));
      ok.set({ STCP: 1 }).run(ns(15));
      ok.set({ STCP: 0 }).run(us(1));
      ok.set({ MR: 0 }).run(ns(15));
      ok.set({ MR: 1 }).run(us(1));
      expect(timing(ok)).toEqual([]);
      ok.expect({ Q0: 1, Q1: 0, Q7S: 0 });
      const b = bench();
      b.set({ DS: 1 }).run(us(1));
      b.set({ SHCP: 1 }).run(ns(14));
      b.set({ SHCP: 0 }).run(us(1));
      pulse(b, 'STCP');
      expect(messages(b)).toEqual(['SHCP was HIGH for only 14 ns (pulse width ≥ 15 ns)']);
      b.expect({ Q0: 'X', Q1: 0 });
      const c = bench();
      c.set({ DS: 1 }).run(us(1));
      pulse(c, 'SHCP');
      c.set({ STCP: 1 }).run(ns(14));
      c.set({ STCP: 0 }).run(us(1));
      expect(messages(c)).toEqual(['STCP was HIGH for only 14 ns (pulse width ≥ 15 ns)']);
      c.expect({ Q0: 'X', Q1: 0 });
      const e = bench();
      e.set({ DS: 1 }).run(us(1));
      pulse(e, 'SHCP');
      e.set({ MR: 0 }).run(ns(14));
      e.set({ MR: 1 }).run(us(1));
      pulse(e, 'STCP');
      expect(messages(e)).toEqual(['MR was LOW for only 14 ns (pulse width ≥ 15 ns)']);
      e.expect({ Q0: 'X', Q1: 0 });
    });

    it('recovery of MR̅ before SHCP', () => {
      const recover = (after: number) => {
        const b = bench();
        b.set({ DS: 1, MR: 0 }).run(us(1));
        b.set({ MR: 1 }).run(ns(after));
        pulse(b, 'SHCP');
        pulse(b, 'STCP');
        return b;
      };
      expect(timing(recover(10))).toEqual([]);
      recover(10).expect({ Q0: 1 });
      const b = recover(9);
      expect(messages(b)).toEqual(['SHCP rose 9 ns after MR was released (recovery time ≥ 10 ns)']);
      b.expect({ Q0: 'X', Q1: 0 });
    });

    it('checks nothing on SHCP while MR̅ holds the shift register cleared', () => {
      const b = bench();
      b.set({ MR: 0 }).run(us(1));
      for (let i = 0; i < 4; i++) {
        b.set({ DS: i & 1 ? 1 : 0, SHCP: 1 }).run(ns(5));
        b.set({ SHCP: 0 }).run(ns(5));
      }
      b.set({ STCP: 1 }).run(ns(5)); // SHCP rose 10 ns before: nothing shifted, no set-up
      expect(timing(b)).toEqual([]);
    });
  });
});
