import { describe, expect, it } from 'vitest';
import {
  type AnyComponentDefinition,
  HDL_DEFAULT_DELAY,
  type HdlModule,
  innerReader,
  Level,
  levelChar,
  ns,
  pinsOf,
  us,
} from '../../core';
import { Bench, type BenchValues } from '../../core/testing';
import { YOSYS_FIXTURES } from './fixtures';
import { fromYosys } from './from-yosys';
import { hdlPart } from './module-part';

function moduleOf(name: string): HdlModule {
  const { module, messages } = fromYosys(YOSYS_FIXTURES[name]);
  if (!module) throw new Error(`${name}: ${messages.map((m) => m.message).join('; ')}`);
  return module;
}

function part(name: string): AnyComponentDefinition {
  const { definition } = hdlPart(`hdl/${name.replaceAll('_', '-')}`, name, moduleOf(name));
  if (!definition) throw new Error(`${name}: no definition`);
  return definition;
}

/** Pin values for a word: `word('addr', 12, 4, 0xa)` → `{ addr12: 0, addr13: 1, … }`. */
function word(name: string, lsb: number, width: number, value: number): BenchValues {
  return Object.fromEntries(
    Array.from({ length: width }, (_, i) => [`${name}${lsb + i}`, ((value >> i) & 1) as 0 | 1]),
  );
}

/** A word's pins as text, most significant first (`'1X01'`). */
function read(bench: Bench, name: string, lsb: number, width: number): string {
  return Array.from({ length: width }, (_, i) => levelChar(bench.get(`${name}${lsb + i}`)))
    .reverse()
    .join('');
}

/** One rising edge of `clk` (held low first), then time for the outputs. */
function tick(bench: Bench, clk = 'clk'): void {
  bench.set({ [clk]: 0 });
  bench.run(us(1));
  bench.set({ [clk]: 1 });
  bench.run(us(1));
}

describe('hdlPart', () => {
  it('gives a pin per port bit in declaration order, with what they are', () => {
    const pins = pinsOf(part('decoder'), {});
    expect(pins.map((p) => `${p.name}:${p.dir}`)).toEqual([
      'addr12:in',
      'addr13:in',
      'addr14:in',
      'addr15:in',
      'phi2:in',
      'ram_cs_n:out',
      'via_cs_n:out',
      'rom_cs_n:out',
      'page0:out',
      'page1:out',
    ]);
    expect(pins[3]?.description).toBe('input addr[15..12], bit 15');
    expect(pins[5]?.description).toBe('output ram_cs_n');
  });

  it('has a delay property, 15 ns by default', () => {
    expect(part('decoder').props?.map((p) => [p.key, p.default])).toEqual([
      ['delay', HDL_DEFAULT_DELAY],
    ]);
    expect(HDL_DEFAULT_DELAY).toBe(ns(15));
  });

  it('makes no part of a module with errors, and says why', () => {
    const module = moduleOf('counter');
    const looped: HdlModule = {
      ...module,
      cells: [
        ...module.cells,
        { type: '$not', src: 'x.v:1', ports: { A: [7], Y: [7] }, params: {} },
      ],
    };
    const result = hdlPart('hdl/x', 'x', looped);
    expect(result.definition).toBeUndefined();
    expect(result.messages.map((m) => m.severity)).toContain('error');
    expect(
      hdlPart('hdl/x', 'x', { ...module, format: 2 } as unknown as HdlModule).messages[0]?.message,
    ).toBe('module.format: expected 1');
  });

  it('passes the warnings on with the definition', () => {
    const result = hdlPart('hdl/latches', 'latches', moduleOf('latches'));
    expect(result.definition).toBeDefined();
    expect(result.messages.map((m) => m.message)).toEqual([
      'a latch is inferred for r',
      'a latch is inferred for q',
    ]);
  });
});

describe('a combinational module (the address decoder)', () => {
  it('follows its function table', () => {
    const bench = new Bench(part('decoder'));
    for (let addr = 0; addr < 16; addr++) {
      for (const phi2 of [0, 1] as const) {
        bench.set({ ...word('addr', 12, 4, addr), phi2 });
        bench.run(us(1));
        const ram = addr < 4 && phi2 === 1 ? 0 : 1;
        const via = addr === 6 || addr === 7 ? 0 : 1;
        const rom = addr >= 8 ? 0 : 1;
        bench.expect({ ram_cs_n: ram, via_cs_n: via, rom_cs_n: rom });
        expect(read(bench, 'page', 0, 2)).toBe((addr & 3).toString(2).padStart(2, '0'));
      }
    }
    bench.expectNoDiagnostics();
  });

  it('drives its outputs after its delay', () => {
    const bench = new Bench(part('decoder'));
    bench.set({ ...word('addr', 12, 4, 0), phi2: 1 });
    bench.settle();
    expect(bench.measure({ addr15: 1 }, 'rom_cs_n')).toBe(ns(15));
    const fast = new Bench(part('decoder'), { delay: ns(4) });
    fast.set({ ...word('addr', 12, 4, 0), phi2: 1 });
    fast.settle();
    expect(fast.measure({ addr15: 1 }, 'rom_cs_n')).toBe(ns(4));
  });

  it('is unknown only where an unknown input reaches', () => {
    const bench = new Bench(part('decoder'));
    bench.set({ ...word('addr', 12, 4, 0b1000), phi2: 'X' });
    bench.run(us(1));
    // A15 = 1: RAM is deselected whatever PHI2 is.
    bench.expect({ ram_cs_n: 1, rom_cs_n: 0 });
    bench.set({ addr15: 0 });
    bench.run(us(1));
    bench.expect({ ram_cs_n: 'X', rom_cs_n: 1 });
  });
});

describe('a sequential module (the decade counter)', () => {
  function counter(): Bench {
    const bench = new Bench(part('counter'));
    bench.set({ clk: 0, rst: 1, en: 1 });
    bench.run(us(1));
    bench.set({ rst: 0 });
    bench.run(us(1));
    return bench;
  }

  it('starts unknown until reset', () => {
    const bench = new Bench(part('counter'));
    bench.set({ clk: 0, rst: 0, en: 1 });
    bench.run(us(1));
    expect(read(bench, 'q', 0, 4)).toBe('XXXX');
  });

  it('counts to 9, carries, wraps, and holds while disabled', () => {
    const bench = counter();
    const seen: string[] = [];
    for (let n = 0; n < 11; n++) {
      seen.push(`${Number.parseInt(read(bench, 'q', 0, 4), 2)}${levelChar(bench.get('co'))}`);
      tick(bench);
    }
    expect(seen).toEqual(['00', '10', '20', '30', '40', '50', '60', '70', '80', '91', '00']);
    bench.set({ en: 0 });
    tick(bench);
    tick(bench);
    expect(read(bench, 'q', 0, 4)).toBe('0001');
    bench.expectNoDiagnostics();
  });

  it('resets asynchronously, without a clock, after its delay', () => {
    const bench = counter();
    tick(bench);
    tick(bench);
    bench.settle();
    expect(bench.measure({ rst: 1 }, 'q1')).toBe(ns(15));
    expect(read(bench, 'q', 0, 4)).toBe('0000');
  });

  it('makes unknown only the bits an uncertain edge would change', () => {
    const bench = counter();
    tick(bench); // q = 1
    bench.set({ clk: 0 });
    bench.run(us(1));
    bench.set({ clk: 'X' });
    bench.run(us(1));
    bench.set({ clk: 0 });
    bench.run(us(1));
    // 0 → X might have been a rising edge, 1 → 2: bits 0 and 1 unknown, 2 and 3 stay 0.
    expect(read(bench, 'q', 0, 4)).toBe('00XX');
    // 0 → X → 1 is two transitions that might each be the edge: as the library's chips do.
    bench.set({ clk: 'X' });
    bench.run(us(1));
    bench.set({ clk: 1 });
    bench.run(us(1));
    expect(read(bench, 'q', 0, 4)).toBe('XXXX');
  });

  it('runs on to the same values after a snapshot is restored', () => {
    const bench = counter();
    tick(bench);
    const snapshot = bench.sim.snapshot();
    const run = () => {
      const values: string[] = [];
      for (let n = 0; n < 5; n++) {
        tick(bench);
        values.push(read(bench, 'q', 0, 4));
      }
      return values;
    };
    const first = run();
    bench.sim.restore(snapshot);
    expect(run()).toEqual(first);
  });
});

describe('a state machine (the traffic light)', () => {
  it('resets synchronously and steps RED → GREEN → YELLOW → RED on ticks', () => {
    const bench = new Bench(part('traffic'));
    bench.set({ clk: 0, rst_n: 0, tick: 0 });
    tick(bench);
    expect(read(bench, 'lights', 0, 3)).toBe('100');
    bench.set({ rst_n: 1 });
    const seen: string[] = [];
    for (const t of [0, 1, 1, 0, 1, 1] as const) {
      bench.set({ tick: t });
      tick(bench);
      seen.push(read(bench, 'lights', 0, 3));
    }
    expect(seen).toEqual(['100', '001', '010', '010', '100', '001']);
    expect(read(bench, 'st', 0, 2)).toBe('01');
  });

  it('shows unknown lights until it is reset', () => {
    const bench = new Bench(part('traffic'));
    bench.set({ clk: 0, rst_n: 1, tick: 1 });
    tick(bench);
    expect(read(bench, 'lights', 0, 3)).toBe('XXX');
  });
});

describe('flip-flop flavours (ops)', () => {
  function ops(): Bench {
    const bench = new Bench(part('ops'));
    bench.set({ clk: 0, rst: 0, en: 1, ...word('a', 0, 8, 0x3c), ...word('b', 0, 8, 0x5a) });
    bench.set(word('n', 0, 3, 0));
    bench.run(us(1));
    return bench;
  }

  it('$sdff: a synchronous reset to 0 on the edge', () => {
    const bench = ops();
    tick(bench);
    expect(read(bench, 'r_sdff', 0, 8)).toBe('00111100');
    bench.set({ rst: 1 });
    bench.run(us(1));
    expect(read(bench, 'r_sdff', 0, 8)).toBe('00111100');
    tick(bench);
    expect(read(bench, 'r_sdff', 0, 8)).toBe('00000000');
  });

  it('$dffe: loads only while enabled', () => {
    const bench = ops();
    tick(bench);
    bench.set({ en: 0, ...word('b', 0, 8, 0xff) });
    tick(bench);
    expect(read(bench, 'r_dffe', 0, 8)).toBe('01011010');
  });

  it('$dff on the falling edge', () => {
    const bench = ops();
    bench.set({ clk: 1 });
    bench.run(us(1));
    expect(read(bench, 'r_neg', 0, 8)).toBe('XXXXXXXX');
    bench.set({ clk: 0 });
    bench.run(us(1));
    expect(read(bench, 'r_neg', 0, 8)).toBe('00011000');
  });

  it('$sdffe resets whatever the enable; $sdffce only while enabled', () => {
    const bench = ops();
    tick(bench);
    bench.set({ rst: 1, en: 0 });
    tick(bench);
    expect(read(bench, 'r_sdffe', 0, 8)).toBe('01011010'); // its reset value is 5a too
    bench.set({ rst: 0, en: 1, ...word('b', 0, 8, 0x0f) });
    tick(bench);
    expect(read(bench, 'r_sdffe', 0, 8)).toBe('00001111');
    bench.set({ rst: 1, en: 0 });
    tick(bench);
    expect(read(bench, 'r_sdffe', 0, 8)).toBe('01011010');
    // r_sdffce <= en ? (rst ? 1 : a[3]) : r_sdffce; a[3] = 1 for 0x3c.
    bench.set({ rst: 0, en: 1, ...word('a', 0, 8, 0x30) });
    tick(bench);
    bench.expect({ r_sdffce: 0 });
    bench.set({ rst: 1, en: 0 });
    tick(bench);
    bench.expect({ r_sdffce: 0 });
    bench.set({ en: 1 });
    tick(bench);
    bench.expect({ r_sdffce: 1 });
  });

  it('$adff: an asynchronous reset, active LOW, to its value', () => {
    const bench = ops();
    bench.set({ en: 0 });
    bench.run(us(1));
    expect(read(bench, 'r_adff', 0, 4)).toBe('1010');
    bench.set({ en: 1, clk: 1 });
    bench.run(us(1));
    bench.set({ clk: 0 });
    bench.run(us(1));
    expect(read(bench, 'r_adff', 0, 4)).toBe('1100');
  });

  it('computes the combinational outputs', () => {
    const bench = ops();
    bench.set({ ...word('a', 0, 8, 200), ...word('b', 0, 8, 100), ...word('n', 0, 3, 2) });
    bench.run(us(1));
    const a = 200;
    const b = 100;
    const arith = ((a - b) ^ ~(a | b) ^ ~(a ^ b) ^ (a & b)) & 0xff;
    expect(read(bench, 'arith', 0, 8)).toBe(arith.toString(2).padStart(8, '0'));
    expect(read(bench, 'negsum', 0, 8)).toBe(((-a + b) & 0xff).toString(2).padStart(8, '0'));
    expect(read(bench, 'shr', 0, 8)).toBe((a >> 2).toString(2).padStart(8, '0'));
    // logic = (a != b) && (a <= b) || !(a > b) || (a < b) = 0; pick = a[0] ? b[1] : b[2] = 1.
    bench.expect({ ge: 1, any_b: 1, logic: 0, pick: 1, dc: 0 });
  });
});

describe('latches', () => {
  it('pass D while enabled, hold it while not, and reset asynchronously', () => {
    const bench = new Bench(part('latches'));
    bench.set({ en: 1, rst: 0, ...word('d', 0, 2, 2) });
    bench.run(us(1));
    expect(read(bench, 'q', 0, 2)).toBe('10');
    bench.set({ en: 0 });
    bench.run(us(1));
    bench.set(word('d', 0, 2, 1));
    bench.run(us(1));
    expect(read(bench, 'q', 0, 2)).toBe('10');
    bench.expect({ r: 0 });
    bench.set({ rst: 1 });
    bench.run(us(1));
    bench.expect({ r: 0 });
    bench.set({ en: 'X', rst: 0 });
    bench.run(us(1));
    // Enabled or not: q = 10 or 01, so both bits unknown; r = 0 or d0 = 1.
    expect(read(bench, 'q', 0, 2)).toBe('XX');
    bench.expect({ r: 'X' });
  });
});

describe('outputs wired straight', () => {
  it('pass inputs through, drive constants, and drive X where nothing does', () => {
    const bench = new Bench(part('wires'));
    bench.set({ a: 1, ...word('b', 0, 2, 1) });
    bench.run(us(1));
    bench.expect({ y: 1, twin: 1, one: 1, unknown: 'X', floating: 'X' });
    expect(read(bench, 'z', 0, 2)).toBe('10');
    expect(read(bench, 'k', 0, 2)).toBe('10');
  });
});

describe('variable selects (shifts)', () => {
  it('select bits and shift by an input', () => {
    const bench = new Bench(part('shifts'));
    bench.set({ ...word('v', 0, 8, 0b10010110), ...word('i', 0, 3, 1) });
    bench.run(us(1));
    bench.expect({ bit_i: 1 });
    expect(read(bench, 'pair', 0, 2)).toBe('11');
    expect(read(bench, 'shl', 0, 8)).toBe('00101100');
    bench.set(word('i', 0, 3, 7));
    bench.run(us(1));
    expect(read(bench, 'pair', 0, 2)).toBe('X1');
  });
});

describe('signed and wide words (HDL-9)', () => {
  it('compares signed operands', () => {
    const bench = new Bench(part('signed'));
    // −2 < 3, 3 < −2 is false, −8 < 7.
    for (const [a, b, lt] of [
      [0b1110, 0b0011, 1],
      [0b0011, 0b1110, 0],
      [0b1000, 0b0111, 1],
    ] as const) {
      bench.set({ ...word('a', 0, 4, a), ...word('b', 0, 4, b) });
      bench.run(us(1));
      bench.expect({ lt });
    }
  });

  it('multiplies, divides, raises to a power and compares with === (arith)', () => {
    const bench = new Bench(part('arith'));
    bench.set({ ...word('a', 0, 8, 200), ...word('b', 0, 8, 7), ...word('n', 0, 3, 3) });
    bench.run(us(1));
    expect(read(bench, 'mul', 0, 16)).toBe((1400).toString(2).padStart(16, '0'));
    expect(read(bench, 'div', 0, 8)).toBe((28).toString(2).padStart(8, '0'));
    expect(read(bench, 'mod', 0, 8)).toBe((4).toString(2).padStart(8, '0'));
    expect(read(bench, 'pow', 0, 8)).toBe((200 ** 3 % 256).toString(2).padStart(8, '0'));
    expect(read(bench, 'pow2', 0, 8)).toBe('00001000');
    bench.expect({ eqx: 0, nex: 1 });
    bench.set(word('b', 0, 8, 0));
    bench.run(us(1));
    expect(read(bench, 'div', 0, 8)).toBe('XXXXXXXX');
  });

  it('adds 33-bit words', () => {
    const bench = new Bench(part('wide'));
    const bits = (value: bigint) =>
      Object.fromEntries(
        Array.from({ length: 33 }, (_, i) => [`a${i}`, Number((value >> BigInt(i)) & 1n) as 0 | 1]),
      );
    bench.set(bits(2n ** 32n - 1n));
    bench.run(us(1));
    expect(read(bench, 'y', 0, 33)).toBe(`1${'0'.repeat(32)}`);
    bench.set(bits(2n ** 33n - 1n));
    bench.run(us(1));
    expect(read(bench, 'y', 0, 33)).toBe('0'.repeat(33));
  });
});

describe('power-up values (HDL-9)', () => {
  it('start each register at its init and drive it from t = 0; without one it is unknown', () => {
    const bench = new Bench(part('inits'));
    bench.run(us(1));
    bench.expect({ q: 1 });
    expect(read(bench, 'count', 0, 4)).toBe('0101');
    expect(read(bench, 'o', 0, 8)).toBe('10100101');
    expect(read(bench, 'none', 0, 4)).toBe('XXXX');
    // Driven by the forced evaluation at t = 0, after the module's delay.
    const fresh = new Bench(part('inits'));
    fresh.run(ns(14));
    expect(fresh.get('q')).toBe(Level.X);
    fresh.run(ns(2));
    expect(fresh.get('q')).toBe(Level.L1);
    tick(bench);
    bench.expect({ q: 0 });
    expect(read(bench, 'count', 0, 4)).toBe('0110');
    expect(read(bench, 'o', 0, 8)).toBe('01001011');
    expect(read(bench, 'none', 0, 4)).toBe('XXXX');
  });
});

describe('clocks made inside the module (HDL-9)', () => {
  const value = (bench: Bench, name: string) => Number.parseInt(read(bench, name, 0, 4), 2);

  it('a divider clocks its counter and a shift chain; ripple and self-clearing counters count', () => {
    const bench = new Bench(part('clocks'));
    bench.set({ clk: 0, ...word('d', 0, 4, 0) });
    bench.run(us(1));
    expect(['slow', 'ripple', 'decade'].map((n) => read(bench, n, 0, 4))).toEqual([
      '0000',
      '0000',
      '0000',
    ]);
    for (let n = 1; n <= 23; n++) {
      bench.set(word('d', 0, 4, n % 16));
      bench.run(us(1));
      tick(bench);
      // The divided clock rises on odd edges of clk: slow counts them, s1 takes d, s2 takes s1.
      expect(value(bench, 'slow'), `slow after ${n}`).toBe(Math.ceil(n / 2) % 16);
      expect(value(bench, 'ripple'), `ripple after ${n}`).toBe(n % 16);
      expect(value(bench, 'decade'), `decade after ${n}`).toBe(n % 10);
      if (n % 2 === 1) expect(value(bench, 's1'), `s1 after ${n}`).toBe(n % 16);
      if (n % 2 === 1 && n > 1) expect(value(bench, 's2'), `s2 after ${n}`).toBe((n - 2) % 16);
    }
    bench.expectNoDiagnostics();
  });

  it('runs on to the same values after a snapshot is restored', () => {
    const bench = new Bench(part('clocks'));
    bench.set({ clk: 0, ...word('d', 0, 4, 9) });
    bench.run(us(1));
    tick(bench);
    const snapshot = bench.sim.snapshot();
    const run = () =>
      Array.from({ length: 5 }, () => {
        tick(bench);
        return ['slow', 'ripple', 'decade'].map((n) => read(bench, n, 0, 4)).join(' ');
      });
    const first = run();
    bench.sim.restore(snapshot);
    expect(run()).toEqual(first);
  });

  it('a clock made from a register with a power-up value makes no edge at power-on', () => {
    // q <= 1 on the rising edges of ~d; d is 0 from power-up and never clocked (its clock is 0).
    const module: HdlModule = {
      format: 1,
      top: 'derived',
      creator: '',
      bitCount: 4,
      ports: [{ name: 'q', dir: 'out', lsb: 0, bits: [3], init: ['0'] }],
      signals: [{ name: 'd', lsb: 0, bits: [1], init: ['0'] }],
      memories: [],
      cells: [
        {
          type: '$dff',
          src: '',
          ports: { CLK: ['0'], D: ['1'], Q: [1] },
          params: { CLK_POLARITY: 1 },
        },
        { type: '$not', src: '', ports: { A: [1], Y: [2] }, params: {} },
        {
          type: '$dff',
          src: '',
          ports: { CLK: [2], D: ['1'], Q: [3] },
          params: { CLK_POLARITY: 1 },
        },
      ],
    };
    const bench = new Bench(hdlPart('hdl/derived', 'Derived', module).definition!);
    bench.run(us(1));
    bench.expect({ q: 0 });
    bench.expectNoDiagnostics();
  });

  it('a gated clock and a divided clock sampling a register clk changes race: X, reported', () => {
    const bench = new Bench(part('races'));
    bench.set({ clk: 0, en: 1, ...word('d', 0, 4, 5) });
    bench.run(us(1));
    tick(bench); // q: X → 5 at the edge g and div rise on
    tick(bench); // q stays 5: g's edge samples it surely; div falls
    expect(read(bench, 'q', 0, 4)).toBe('0101');
    expect(read(bench, 'gated', 0, 4)).toBe('0101');
    bench.set(word('d', 0, 4, 6));
    bench.run(us(1));
    tick(bench); // q: 5 → 6 at the edge g and div rise on: X where 5 and 6 differ
    expect(read(bench, 'gated', 0, 4)).toBe('01XX');
    expect(read(bench, 'divided', 0, 4)).toBe('01XX');
    const race = bench.diagnostics.find((d) => d.kind === 'race-violation');
    expect(race?.message).toMatch(/clocked by logic, and its data changed at the same instant/);
    expect(bench.diagnostics.map((d) => d.kind)).not.toContain('setup-violation');
  });

  it('a data pin changing in the same delta as its clock loads X where it matters', () => {
    const bench = new Bench(part('races'));
    bench.set({ clk: 0, en: 0, ...word('d', 0, 4, 5) });
    bench.run(us(1));
    tick(bench);
    bench.set({ clk: 0 });
    bench.run(us(1));
    expect(bench.diagnostics.map((d) => d.kind)).not.toContain('setup-violation');
    bench.set({ clk: 1, ...word('d', 0, 4, 6) });
    bench.run(us(1));
    expect(read(bench, 'q', 0, 4)).toBe('01XX');
    const setup = bench.diagnostics.find((d) => d.kind === 'setup-violation');
    expect(setup?.message).toMatch(/^d\d changed at the clock edge of q: it loads X/);
    expect(setup?.pin).toMatch(/^d\d$/);
  });

  it('a flip-flop clocked again in the same instant goes X, reported: no endless loop', () => {
    // x1 toggles on c's rising edges, x2 on its falling ones (both reset by r); c = ~(x1 ^ x2 ^ k):
    // every edge of c flips x1 ^ x2, which flips c again — once k moves, it would never settle.
    // x2's second edge in one instant finds its own data changed: a glitching clock, X.
    const toggle = (q: number, nq: number, rising: number): HdlModule['cells'] => [
      { type: '$not', src: '', ports: { A: [q], Y: [nq] }, params: {} },
      {
        type: '$adff',
        src: `t.v:${q}`,
        ports: { CLK: [4], ARST: [7], D: [nq], Q: [q] },
        params: { CLK_POLARITY: rising, ARST_POLARITY: 1, ARST_VALUE: ['0'] },
      },
    ];
    const module: HdlModule = {
      format: 1,
      top: 'ring',
      creator: '',
      bitCount: 8,
      ports: [
        { name: 'k', dir: 'in', lsb: 0, bits: [0] },
        { name: 'r', dir: 'in', lsb: 0, bits: [7] },
        { name: 'o', dir: 'out', lsb: 0, bits: [5] },
      ],
      signals: [
        { name: 'x1', lsb: 0, bits: [1] },
        { name: 'x2', lsb: 0, bits: [2] },
      ],
      memories: [],
      cells: [
        ...toggle(1, 3, 1),
        ...toggle(2, 6, 0),
        { type: '$xor', src: '', ports: { A: [1], B: [2], Y: [5] }, params: {} },
        { type: '$xnor', src: '', ports: { A: [5], B: [0], Y: [4] }, params: {} },
      ],
    };
    const { definition } = hdlPart('hdl/ring', 'Ring', module);
    const bench = new Bench(definition!);
    bench.set({ k: 0, r: 1 });
    bench.run(us(1));
    bench.set({ r: 0 });
    bench.run(us(1));
    bench.expect({ o: 0 });
    bench.expectNoDiagnostics();
    bench.set({ k: 1 });
    bench.run(us(1));
    bench.expect({ o: 'X' });
    expect(bench.diagnostics.map((d) => d.message)).toContainEqual(
      expect.stringMatching(/^x2 is clocked again in the same instant/),
    );
  });
});

describe('combinational loops (HDL-9)', () => {
  it('an SR latch of two NANDs starts unknown, sets, holds and resets', () => {
    const bench = new Bench(part('loops'));
    bench.set({ s_n: 1, r_n: 1, en: 0 });
    bench.run(us(1));
    bench.expect({ q: 'X', q_n: 'X' });
    const steps: [0 | 1, 0 | 1, string][] = [
      [0, 1, '10'],
      [1, 1, '10'],
      [1, 0, '01'],
      [1, 1, '01'],
      [0, 1, '10'],
    ];
    for (const [s_n, r_n, q] of steps) {
      bench.set({ s_n, r_n });
      bench.run(us(1));
      expect(`${levelChar(bench.get('q'))}${levelChar(bench.get('q_n'))}`, `${s_n}${r_n}`).toBe(q);
    }
    bench.expectNoDiagnostics();
  });

  it("a loop that doesn't settle goes X and reports an oscillation; the simulation goes on", () => {
    const bench = new Bench(part('loops'));
    bench.set({ s_n: 1, r_n: 1, en: 0 });
    bench.run(us(1));
    bench.expect({ ring: 1 });
    bench.expectNoDiagnostics();
    bench.set({ en: 1 });
    bench.run(us(1));
    bench.expect({ ring: 'X' });
    const oscillation = bench.diagnostics.find((d) => d.kind === 'oscillation');
    expect(oscillation?.message).toMatch(/^the combinational loop through r\d doesn't settle: X$/);
    // The rest of the module runs on: the latch still sets.
    bench.set({ s_n: 0 });
    bench.run(us(1));
    bench.expect({ q: 1, q_n: 0 });
    expect(bench.sim.halted).toBe(false);
  });
});

describe('flip-flop and latch flavours of HDL-9 (ff_flavours, by_name)', () => {
  it('$dffsr and $dffsre: clear wins over set, both asynchronous; the edge loads D', () => {
    const bench = new Bench(part('ff_flavours'));
    const both = () => [read(bench, 'q_sr', 0, 4), read(bench, 'q_sre', 0, 4)];
    bench.set({ clk: 0, rst: 1, set: 0, en: 0, load: 0, g: 0, ...word('d', 0, 4, 3) });
    bench.run(us(1));
    expect(both()).toEqual(['0000', '0000']);
    bench.set({ rst: 0, set: 1 });
    bench.run(us(1));
    expect(both()).toEqual(['1111', '1111']);
    bench.set({ rst: 1 });
    bench.run(us(1));
    expect(both()).toEqual(['0000', '0000']);
    bench.set({ rst: 0, set: 0 });
    bench.run(us(1));
    tick(bench);
    expect(both()).toEqual(['0011', '0000']);
    bench.set({ en: 1 });
    tick(bench);
    expect(both()).toEqual(['0011', '0011']);
  });

  it('$aldff and $aldffe follow AD while loading, load D on edges otherwise', () => {
    const bench = new Bench(part('ff_flavours'));
    bench.set({ clk: 0, rst: 0, set: 0, en: 0, load: 1, g: 0, ...word('ad', 0, 4, 10) });
    bench.set(word('d', 0, 4, 3));
    bench.run(us(1));
    expect(read(bench, 'q_ald', 0, 4)).toBe('1010');
    expect(read(bench, 'q_alde', 0, 4)).toBe('1010');
    bench.set(word('ad', 0, 4, 5));
    bench.run(us(1));
    expect(read(bench, 'q_ald', 0, 4)).toBe('0101');
    bench.set({ load: 0 });
    tick(bench);
    expect(read(bench, 'q_ald', 0, 4)).toBe('0011');
    expect(read(bench, 'q_alde', 0, 4)).toBe('0101');
    bench.set({ en: 1 });
    tick(bench);
    expect(read(bench, 'q_alde', 0, 4)).toBe('0011');
  });

  it('a reset value with an x bit; a latch with set and reset', () => {
    const bench = new Bench(part('ff_flavours'));
    bench.set({ clk: 0, rst: 0, set: 0, en: 0, load: 0, g: 1, ...word('d', 0, 4, 6) });
    bench.run(us(1));
    expect(read(bench, 'q_x', 0, 4)).toBe('10X1');
    expect(read(bench, 'lat_sr', 0, 4)).toBe('0110');
    bench.set({ g: 0, ...word('d', 0, 4, 9) });
    bench.run(us(1));
    expect(read(bench, 'lat_sr', 0, 4)).toBe('0110');
    bench.set({ set: 1 });
    bench.run(us(1));
    expect(read(bench, 'lat_sr', 0, 4)).toBe('1111');
  });

  it('$sr and $dlatchsr per bit, clear first; $bmux $demux $bwmux $divfloor $modfloor', () => {
    const bench = new Bench(part('by_name'));
    bench.set({ set: 0, clr: 0, en: 1, ...word('w', 0, 4, 6) });
    bench.set({ ...word('a', 0, 16, 0x8421), ...word('s', 0, 2, 2), ...word('m', 0, 4, 3) });
    bench.set({ ...word('n', 0, 8, 0xf9), ...word('d', 0, 8, 2) });
    bench.run(us(1));
    // $sr: CLR is active LOW here, so clr = 0 clears.
    expect(read(bench, 'sr', 0, 4)).toBe('0000');
    expect(read(bench, 'lsr', 0, 4)).toBe('0110');
    bench.set({ set: 1, clr: 1 });
    bench.run(us(1));
    expect(read(bench, 'sr', 0, 4)).toBe('1111');
    // $dlatchsr: SET reaches bit 3, CLR bit 0 (both active HIGH).
    expect(read(bench, 'lsr', 0, 4)).toBe('1110');
    bench.set({ set: 0 });
    bench.run(us(1));
    expect(read(bench, 'sr', 0, 4)).toBe('1111');
    expect(read(bench, 'bmux', 0, 4)).toBe('0100');
    expect(read(bench, 'demux', 0, 16)).toBe('0000011000000000');
    expect(read(bench, 'bwmux', 0, 4)).toBe('0101');
    // −7 / 2 floors to −4, −7 mod 2 to 1.
    expect(read(bench, 'dfloor', 0, 8)).toBe('11111100');
    expect(read(bench, 'mfloor', 0, 8)).toBe('00000001');
  });
});

describe('clock edges', () => {
  it('load every flip-flop from the values before the edge (a shift chain)', () => {
    // q1 <= d; q2 <= q1, on one clock.
    const module: HdlModule = {
      format: 1,
      top: 'chain',
      creator: '',
      bitCount: 4,
      ports: [
        { name: 'clk', dir: 'in', lsb: 0, bits: [0] },
        { name: 'd', dir: 'in', lsb: 0, bits: [1] },
        { name: 'q1', dir: 'out', lsb: 0, bits: [2] },
        { name: 'q2', dir: 'out', lsb: 0, bits: [3] },
      ],
      signals: [],
      memories: [],
      cells: [
        { type: '$dff', src: '', ports: { CLK: [0], D: [2], Q: [3] }, params: { CLK_POLARITY: 1 } },
        { type: '$dff', src: '', ports: { CLK: [0], D: [1], Q: [2] }, params: { CLK_POLARITY: 1 } },
      ],
    };
    const bench = new Bench(hdlPart('hdl/chain', 'chain', module).definition!);
    bench.set({ clk: 0, d: 1 });
    tick(bench);
    bench.expect({ q1: 1, q2: 'X' });
    bench.set({ d: 0 });
    tick(bench);
    bench.expect({ q1: 0, q2: 1 });
    expect(bench.get('q2')).toBe(Level.L1);
  });
});

describe('tri-states and inout ports (HDL-8)', () => {
  /** Kinds and pins of the diagnostics so far: `floating-input d3`. */
  const reported = (bench: Bench) => bench.diagnostics.map((d) => `${d.kind} ${d.pin}`);

  it('gives tri-state outputs tristate pins and inouts bidir pins', () => {
    const dirs = (name: string) => pinsOf(part(name), {}).map((p) => `${p.name}:${p.dir}`);
    expect(dirs('tristate').slice(5)).toEqual([
      'y0:tristate',
      'y1:tristate',
      'y2:tristate',
      'y3:tristate',
      't0:out',
      't1:out',
      't2:out',
      't3:out',
    ]);
    expect(dirs('inout').slice(5)).toEqual([
      'd0:bidir',
      'd1:bidir',
      'd2:bidir',
      'd3:bidir',
      'r0:out',
      'r1:out',
      'r2:out',
      'r3:out',
    ]);
    expect(dirs('open_drain')).toEqual(['irq:in', 'irq_n:tristate', 'nc:tristate']);
    expect(pinsOf(part('inout'), {})[5]?.description).toBe('inout d[3..0], bit 0');
  });

  it('releases a tri-state output while disabled, drives it while enabled, X while unknown', () => {
    const bench = new Bench(part('tristate'));
    bench.set({ oe: 0, ...word('a', 0, 4, 0b1010) });
    bench.run(us(1));
    // Released, it reads X inside the module: t = ~y.
    expect(read(bench, 'y', 0, 4)).toBe('ZZZZ');
    expect(read(bench, 't', 0, 4)).toBe('XXXX');
    expect(bench.measure({ oe: 1 }, 'y1')).toBe(ns(15));
    bench.settle();
    expect(read(bench, 'y', 0, 4)).toBe('1010');
    expect(read(bench, 't', 0, 4)).toBe('0101');
    expect(bench.measure({ oe: 0 }, 'y1')).toBe(ns(15));
    bench.set({ oe: 'X' });
    bench.run(us(1));
    expect(read(bench, 'y', 0, 4)).toBe('XXXX');
    bench.expectNoDiagnostics();
  });

  it('reads an inout back from its pins, whoever drives them', () => {
    const bench = new Bench(part('inout'));
    bench.set({ oe: 0, ...word('q', 0, 4, 0b1001), ...word('d', 0, 4, 0b0110) });
    bench.run(us(1));
    expect(read(bench, 'r', 0, 4)).toBe('0110');
    bench.expectNoDiagnostics();
    // Handed over at once, the bus floats for the module's delay, and r passes that on.
    bench.set({ d0: 'Z', d1: 'Z', d2: 'Z', d3: 'Z', oe: 1 });
    bench.run(ns(10));
    expect(read(bench, 'd', 0, 4)).toBe('ZZZZ');
    bench.run(us(1));
    expect(read(bench, 'd', 0, 4)).toBe('1001');
    expect(read(bench, 'r', 0, 4)).toBe('1001');
    expect(bench.diagnostics.map((d) => `${d.kind} ${d.pin}`)).toEqual(
      ['d0', 'd1', 'd2', 'd3'].map((d) => `floating-input ${d}`),
    );
  });

  it('fights another driver of its inout: contention, and it reads X back', () => {
    const bench = new Bench(part('inout'));
    bench.set({ oe: 1, ...word('q', 0, 4, 0b1001), ...word('d', 0, 4, 0b1001) });
    bench.run(us(1));
    expect(reported(bench)).toEqual([]);
    bench.set(word('d', 0, 4, 0b0011));
    bench.run(us(1));
    expect(read(bench, 'd', 0, 4)).toBe('X0X1');
    expect(read(bench, 'r', 0, 4)).toBe('X0X1');
    expect(bench.diagnostics.map((d) => [d.kind, d.net])).toEqual([
      ['contention', 'd1'],
      ['contention', 'd3'],
    ]);
  });

  it('is written and read through its data bus (an I/O port)', () => {
    const bench = new Bench(part('io_port'));
    const bus = (value: number | 'Z'): BenchValues =>
      value === 'Z'
        ? Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`d${i}`, 'Z' as const]))
        : word('d', 0, 8, value);
    bench.set({ strobe: 0, cs_n: 1, rw: 1, ...word('pins', 0, 8, 0x3c), ...bus('Z') });
    bench.run(us(1));
    // A write: the data on the bus while the strobe is HIGH, loaded when it falls.
    bench.set({ cs_n: 0, rw: 0, ...bus(0xa5) });
    bench.run(us(1));
    bench.set({ strobe: 1 });
    bench.run(us(1));
    bench.set({ strobe: 0 });
    bench.run(us(1));
    expect(read(bench, 'q', 0, 8)).toBe('10100101');
    // A read: the bus released, the port drives its pins onto it while the strobe is HIGH.
    bench.set({ rw: 1, ...bus('Z') });
    bench.run(us(1));
    expect(read(bench, 'd', 0, 8)).toBe('ZZZZZZZZ');
    bench.set({ strobe: 1 });
    bench.run(us(1));
    expect(read(bench, 'd', 0, 8)).toBe('00111100');
    expect(bench.measure({ strobe: 0 }, 'd2')).toBe(ns(15));
    expect(read(bench, 'd', 0, 8)).toBe('ZZZZZZZZ');
    expect(read(bench, 'q', 0, 8)).toBe('10100101');
    bench.expectNoDiagnostics();
  });

  it('drives an open drain low or releases it; never drives a z output', () => {
    const bench = new Bench(part('open_drain'));
    bench.set({ irq: 1 });
    bench.run(us(1));
    bench.expect({ irq_n: 0, nc: 'Z' });
    bench.set({ irq: 0 });
    bench.run(us(1));
    bench.expect({ irq_n: 'Z', nc: 'Z' });
  });

  it('runs a 74HC574 written in Verilog: a register behind 3-state outputs', () => {
    const bench = new Bench(part('tri_register'));
    bench.set({ cp: 0, oe_n: 1, ...word('d', 0, 4, 0b0110) });
    tick(bench, 'cp');
    expect(read(bench, 'q', 0, 4)).toBe('ZZZZ');
    bench.set({ oe_n: 0 });
    bench.run(us(1));
    expect(read(bench, 'q', 0, 4)).toBe('0110');
    expect(read(bench, 'p', 0, 4)).toBe('0110');
  });

  it('merges two drivers of one inout: both enabled drive X', () => {
    const bench = new Bench(part('tri_merged'));
    bench.set({ oe1: 0, oe2: 0, ...word('a', 0, 4, 0b0011), ...word('b', 0, 4, 0b0101) });
    bench.run(us(1));
    expect(read(bench, 'y', 0, 4)).toBe('ZZZZ');
    bench.set({ oe1: 1 });
    bench.run(us(1));
    expect(read(bench, 'y', 0, 4)).toBe('0011');
    expect(read(bench, 'r', 0, 4)).toBe('0011');
    bench.set({ oe2: 1 });
    bench.run(us(1));
    expect(read(bench, 'y', 0, 4)).toBe('XXXX');
  });

  it('runs tri-states inside the module as logic', () => {
    const bench = new Bench(part('tri_internal'));
    bench.set({ s: 1, ...word('a', 0, 4, 0b0011), ...word('b', 0, 4, 0b1100) });
    bench.run(us(1));
    expect(read(bench, 'n', 0, 4)).toBe('1100');
    expect(read(bench, 'y', 0, 4)).toBe('0110');
    bench.set({ s: 0 });
    bench.run(us(1));
    expect(read(bench, 'n', 0, 4)).toBe('0011');
    expect(read(bench, 'y', 0, 4)).toBe('1001');
  });

  it('drives what logic gives an inout, reads one only read, and clocks from one', () => {
    const bench = new Bench(part('inout_shapes'));
    bench.set({ ...word('a', 0, 2, 0b01), ...word('r', 0, 2, 0b10), c: 0, z: 'Z' });
    bench.run(us(1));
    expect(read(bench, 'w', 0, 2)).toBe('01');
    expect(read(bench, 'rr', 0, 2)).toBe('10');
    bench.expect({ z: 'Z', zr: 0 });
    tick(bench, 'c');
    bench.expect({ q: 1 });
  });

  describe('floating pins: reported where their X is used', () => {
    it('an idle bus reports nothing, a write that samples it does', () => {
      const bench = new Bench(part('io_port'));
      bench.set({ strobe: 0, cs_n: 1, rw: 0, ...word('pins', 0, 8, 0) });
      bench.run(us(1));
      for (const cs_n of [0, 1, 0] as const) {
        bench.set({ cs_n });
        bench.run(us(1));
      }
      bench.set({ strobe: 1 });
      bench.run(us(1));
      expect(reported(bench)).toEqual([]);
      bench.set({ strobe: 0 });
      bench.run(us(1));
      expect(read(bench, 'q', 0, 8)).toBe('XXXXXXXX');
      expect(reported(bench)).toEqual(Array.from({ length: 8 }, (_, i) => `floating-input d${i}`));
    });

    it('an input is reported when an output it reaches comes out X, not before', () => {
      const bench = new Bench(part('decoder'));
      // A15 = 1: the RAM is deselected whatever PHI2 is, so a floating PHI2 isn't used.
      bench.set({ ...word('addr', 12, 4, 0b1000), phi2: 'Z' });
      bench.run(us(1));
      bench.expect({ ram_cs_n: 1 });
      expect(reported(bench)).toEqual([]);
      bench.set({ addr15: 0 });
      bench.run(us(1));
      bench.expect({ ram_cs_n: 'X' });
      expect(reported(bench)).toEqual(['floating-input phi2']);
    });

    it('an enable and an asynchronous reset are used whatever they reach', () => {
      const register = new Bench(part('tri_register'));
      register.set({ cp: 0, oe_n: 'Z', ...word('d', 0, 4, 0) });
      register.run(us(1));
      expect(read(register, 'q', 0, 4)).toBe('XXXX');
      expect(reported(register)).toEqual(['floating-input oe_n']);
      const counter = new Bench(part('counter'));
      counter.set({ clk: 0, rst: 'Z', en: 0 });
      counter.run(us(1));
      expect(reported(counter)).toEqual(['floating-input rst']);
    });

    it('a latch storing it while open, though nothing shows it yet', () => {
      // q3 = en ? d : q3; y = q3 & sel.
      const module: HdlModule = {
        format: 1,
        top: 'held',
        creator: '',
        bitCount: 5,
        ports: [
          { name: 'en', dir: 'in', lsb: 0, bits: [0] },
          { name: 'd', dir: 'in', lsb: 0, bits: [1] },
          { name: 'sel', dir: 'in', lsb: 0, bits: [2] },
          { name: 'y', dir: 'out', lsb: 0, bits: [4] },
        ],
        signals: [],
        memories: [],
        cells: [
          {
            type: '$dlatch',
            src: '',
            ports: { EN: [0], D: [1], Q: [3] },
            params: { EN_POLARITY: 1 },
          },
          { type: '$and', src: '', ports: { A: [3], B: [2], Y: [4] }, params: {} },
        ],
      };
      const bench = new Bench(hdlPart('hdl/held', 'held', module).definition!);
      bench.set({ en: 0, d: 'Z', sel: 0 });
      bench.run(us(1));
      expect(reported(bench)).toEqual([]);
      bench.set({ en: 1 });
      bench.run(us(1));
      bench.expect({ y: 0 });
      expect(reported(bench)).toEqual(['floating-input d']);
    });

    it('not past a flip-flop: a register still X from power-on names no pin', () => {
      const bench = new Bench(part('tri_register'));
      // q is the register, X until a clock; the floating data reaches it only at an edge.
      bench.set({ cp: 0, oe_n: 0, d0: 'Z', d1: 'Z', d2: 'Z', d3: 'Z' });
      bench.run(us(1));
      expect(read(bench, 'q', 0, 4)).toBe('XXXX');
      expect(reported(bench)).toEqual([]);
      tick(bench, 'cp');
      expect(reported(bench)).toEqual(['d0', 'd1', 'd2', 'd3'].map((d) => `floating-input ${d}`));
    });
  });

  it('runs on to the same values after a snapshot is restored', () => {
    const bench = new Bench(part('io_port'));
    bench.set({ strobe: 0, cs_n: 0, rw: 1, ...word('pins', 0, 8, 0x5a) });
    bench.run(us(1));
    const snapshot = bench.sim.snapshot();
    const run = () => {
      bench.set({ strobe: 1 });
      bench.run(us(1));
      const driven = read(bench, 'd', 0, 8);
      bench.set({ strobe: 0 });
      bench.run(us(1));
      return [driven, read(bench, 'd', 0, 8), bench.sim.now];
    };
    const first = run();
    bench.sim.restore(snapshot);
    expect(run()).toEqual(first);
    expect(first.slice(0, 2)).toEqual(['01011010', 'ZZZZZZZZ']);
  });
});

describe('inner signals (HDL-4)', () => {
  /** An inner signal's bits now, most significant first (`'01'`), through the part's view. */
  function inner(bench: Bench, name: string): string {
    const view = bench.sim.definitionOf('DUT')?.signals;
    const index = view?.list.findIndex((s) => s.name === name) ?? -1;
    if (!view || index < 0) throw new Error(`no inner signal ${name}`);
    const state = bench.sim.stateOf('DUT');
    const { width } = view.list[index]!;
    return Array.from({ length: width }, (_, bit) => levelChar(view.level(state, index, bit)))
      .reverse()
      .join('');
  }

  it('lists the named signals that are not ports, with their indices and sources', () => {
    const view = part('traffic').signals;
    expect(view?.list).toEqual([
      { name: 'state', lsb: 0, width: 2, src: expect.stringMatching(/^traffic\.v:\d+/) },
    ]);
    expect(part('clocks').signals?.list.map((s) => `${s.name}:${s.width}`)).toEqual([
      'div:1',
      'rip:4',
      'ten:1',
    ]);
    // A flattened submodule's names keep their dots.
    expect(part('flattened').signals?.list.map((s) => s.name)).toEqual(['u1.a', 'u2.y']);
  });

  it("reads a state machine's register as it steps, X until reset", () => {
    const bench = new Bench(part('traffic'));
    bench.set({ clk: 0, rst_n: 1, tick: 1 });
    tick(bench);
    expect(inner(bench, 'state')).toBe('XX');
    bench.set({ rst_n: 0 });
    tick(bench);
    expect(inner(bench, 'state')).toBe('00');
    bench.set({ rst_n: 1 });
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      tick(bench);
      seen.push(inner(bench, 'state'));
    }
    expect(seen).toEqual(['01', '10', '00', '01']);
  });

  it('changes at the clock edge, before the pins that follow it after the delay', () => {
    const bench = new Bench(part('traffic'));
    bench.set({ clk: 0, rst_n: 0, tick: 0 });
    tick(bench);
    bench.set({ rst_n: 1, tick: 1, clk: 0 });
    bench.run(us(1));
    bench.set({ clk: 1 });
    bench.run(ns(1));
    expect(inner(bench, 'state')).toBe('01');
    expect(read(bench, 'st', 0, 2)).toBe('00');
    bench.run(HDL_DEFAULT_DELAY);
    expect(read(bench, 'st', 0, 2)).toBe('01');
  });

  it('reads power-up values, a ripple chain, and bits shared with a port', () => {
    const bench = new Bench(part('clocks'));
    bench.set({ clk: 0, d0: 0, d1: 0, d2: 0, d3: 0 });
    bench.settle();
    expect(inner(bench, 'div')).toBe('0');
    expect(inner(bench, 'rip')).toBe('0000');
    for (let i = 0; i < 3; i++) tick(bench);
    expect(inner(bench, 'div')).toBe('1');
    expect(inner(bench, 'rip')).toBe('0011');
    expect(read(bench, 'ripple', 0, 4)).toBe('0011');
    const twice = new Bench(part('flattened'));
    twice.set({ a: 1 });
    twice.settle();
    expect(inner(twice, 'u1.a')).toBe('1');
  });

  it('reads one bit through innerReader, and nothing for a bit or part that is not there', () => {
    const bench = new Bench(part('traffic'));
    bench.set({ clk: 0, rst_n: 0, tick: 0 });
    tick(bench);
    bench.set({ rst_n: 1, tick: 1 });
    tick(bench);
    expect(innerReader(bench.sim, { part: 'DUT', signal: 0, bit: 0 })?.()).toBe(Level.L1);
    expect(innerReader(bench.sim, { part: 'DUT', signal: 0, bit: 1 })?.()).toBe(Level.L0);
    expect(innerReader(bench.sim, { part: 'DUT', signal: 0, bit: 2 })).toBeUndefined();
    expect(innerReader(bench.sim, { part: 'DUT', signal: 1, bit: 0 })).toBeUndefined();
    expect(innerReader(bench.sim, { part: 'U9', signal: 0, bit: 0 })).toBeUndefined();
  });

  it('reads the same values after a snapshot is restored', () => {
    const bench = new Bench(part('traffic'));
    bench.set({ clk: 0, rst_n: 0, tick: 0 });
    tick(bench);
    bench.set({ rst_n: 1, tick: 1 });
    const snapshot = bench.sim.snapshot();
    tick(bench);
    tick(bench);
    expect(inner(bench, 'state')).toBe('10');
    bench.sim.restore(snapshot);
    expect(inner(bench, 'state')).toBe('00');
  });
});

describe('pin-to-pin delays from specify (HDL-2)', () => {
  /** The bench settled with `values`. */
  const settled = (name: string, values: BenchValues) => {
    const bench = new Bench(part(name));
    bench.set(values);
    bench.run(us(1));
    return bench;
  };

  it('drives an output with the delay of the path that changed, rise or fall', () => {
    const b = settled('spec_paths', { a: 1, b: 1, s0: 0, s1: 0, clk: 0, d: 0, en: 0 });
    expect(b.measure({ a: 0 }, 'y')).toBe(ns(9)); // y rises: (a => y)'s rise
    expect(b.measure({ a: 1 }, 'y')).toBe(ns(8)); // and falls
    expect(b.measure({ b: 0 }, 'y')).toBe(ns(9.5)); // (b => y) = (9.5, 10)
    expect(b.measure({ b: 1 }, 'y')).toBe(ns(10));
    // Both at once: the output settles after its slowest cause.
    expect(b.measure({ a: 0, b: 0 }, 'y')).toBe(ns(9.5));
  });

  it('takes parallel paths bit by bit and full paths from every bit', () => {
    const b = settled('spec_paths', { a: 0, b: 0, s0: 0, s1: 0, clk: 0, d: 0, en: 0 });
    expect(b.measure({ s0: 1 }, 'p0')).toBe(ns(5));
    b.set({ s0: 0 });
    b.run(us(1));
    // f = s + 1: s0 carries into f1, a path only (s *> f) has.
    expect(b.measure({ s0: 1 }, 'f1')).toBe(ns(7));
  });

  it('times an edge-sensitive path from its edge only', () => {
    const b = settled('spec_paths', { a: 0, b: 0, s0: 0, s1: 0, clk: 0, d: 1, en: 0 });
    expect(b.measure({ clk: 1 }, 'q')).toBe(ns(17)); // rising q: 17
    b.set({ clk: 0, d: 0 });
    b.run(us(1));
    expect(b.measure({ clk: 1 }, 'q')).toBe(ns(18)); // falling q: 18
  });

  it('takes a conditional path while its condition holds', () => {
    const b = settled('spec_paths', { a: 0, b: 0, s0: 0, s1: 0, clk: 0, d: 0, en: 1 });
    expect(b.measure({ a: 1 }, 'g')).toBe(ns(12)); // if (en) (a => g) = 12
    expect(b.measure({ en: 0 }, 'g')).toBe(ns(11)); // (en => g) = 11
    expect(b.measure({ en: 1 }, 'g')).toBe(ns(11));
  });

  it('drives a 3-state output it may drive X from power-on, then what it computes', () => {
    const b = new Bench(part('spec_tristate'));
    b.set({ clk: 0, oen: 1, d0: 1, d1: 0, d2: 1, d3: 0 });
    b.run(0);
    expect(levelChar(b.get('q0'))).toBe('X'); // at t = 0: nobody knows yet
    b.run(us(1));
    expect(levelChar(b.get('q0'))).toBe('Z'); // released after its delay
    expect(b.diagnostics).toEqual([]);
  });

  it("enables and releases a 3-state output with the enable's two conditional paths", () => {
    const b = settled('spec_tristate', { clk: 0, oen: 0, d0: 1, d1: 0, d2: 1, d3: 0 });
    expect(b.measure({ clk: 1 }, 'q0')).toBe(ns(17));
    expect(b.measure({ oen: 1 }, 'q0')).toBe(ns(14)); // if (oen): released after tdis
    expect(b.get('q0')).toBe(Level.Z);
    expect(b.measure({ oen: 0 }, 'q0')).toBe(ns(16)); // if (!oen): driven again after ten
    expect(b.get('q0')).toBe(Level.L1);
  });

  it("times a chip's sections by their submodule's paths; an output no path reaches by the delay", () => {
    const b = settled('spec_flattened', { a0: 1, a1: 1, b0: 1, b1: 1, c: 0 });
    expect(b.measure({ a1: 0 }, 'y1')).toBe(ns(9));
    expect(b.measure({ c: 1 }, 'z')).toBe(HDL_DEFAULT_DELAY); // its inner paths were dropped
    const fast = new Bench(part('spec_flattened'), { delay: ns(4) });
    fast.set({ a0: 1, a1: 1, b0: 1, b1: 1, c: 0 });
    fast.run(us(1));
    expect(fast.measure({ c: 1 }, 'z')).toBe(ns(4));
    expect(fast.measure({ b0: 0 }, 'y0')).toBe(ns(9));
  });

  it("shows a change X from its path's minimum to its typical delay (spec_window)", () => {
    const b = settled('spec_window', { clk: 0, d: 0, oe: 0 });
    b.set({ clk: 1 }).run(us(1));
    b.set({ clk: 0 }).run(us(1)); // q is 0
    const changes = (values: BenchValues, pin: string) => {
      const net = b.sim.netIndex(pin);
      const start = b.now;
      const seen: [number, string][] = [];
      const off = b.sim.onNetChange((t, n, level) => {
        if (n === net) seen.push([(t - start) / 1000, levelChar(level)]);
      });
      b.set(values).run(us(1));
      off();
      return seen;
    };
    changes({ d: 1 }, 'q');
    expect(changes({ clk: 1 }, 'q')).toEqual([
      [4, 'X'],
      [10, '1'],
    ]);
    changes({ clk: 0 }, 'q');
    expect(changes({ clk: 1 }, 'q')).toEqual([]); // the same level: nothing moves
    expect(changes({ oe: 1 }, 'y')).toEqual([
      [0, 'X'],
      [6, '1'],
    ]);
    expect(changes({ oe: 0 }, 'y')).toEqual([[6, 'Z']]);
    // A level that changes again inside the window: X stays until the last one is valid.
    b.set({ clk: 0, d: 0 }).run(us(1));
    const net = b.sim.netIndex('q');
    const start = b.now;
    const seen: [number, string][] = [];
    const off = b.sim.onNetChange((t, n, level) => {
      if (n === net) seen.push([(t - start) / 1000, levelChar(level)]);
    });
    b.set({ clk: 1 }).run(ns(5));
    b.set({ clk: 0, d: 1 }).run(ns(1));
    b.set({ clk: 1 }).run(us(1));
    off();
    expect(seen).toEqual([
      [4, 'X'],
      [16, '1'],
    ]);
  });

  it('times asynchronous controls by their paths', () => {
    const b = settled('spec_checks', { cp: 0, d: 0, sdn: 1, rdn: 1 });
    expect(b.measure({ sdn: 0 }, 'q')).toBe(ns(18));
    b.set({ sdn: 1 });
    b.run(us(1));
    expect(b.measure({ rdn: 0 }, 'q')).toBe(ns(19));
  });
});

describe('timing checks from specify (HDL-2)', () => {
  const messages = (b: Bench) =>
    b.diagnostics
      .filter((d) => d.kind.endsWith('-violation'))
      .map((d) => `${d.kind} ${d.pin}: ${d.message}`);

  /** spec_checks: a D flip-flop reset to 0 long ago, cp low, d low, neither set nor reset. */
  function flop(): Bench {
    const b = new Bench(part('spec_checks'));
    b.set({ cp: 0, d: 0, sdn: 1, rdn: 0 });
    b.run(us(1));
    b.set({ rdn: 1 });
    b.run(us(1));
    return b;
  }

  it('set-up: 15 ns is enough; 14 ns reports and loads X', () => {
    const setup = (before: number) => {
      const b = flop();
      b.set({ d: 1 }).run(ns(before));
      b.set({ cp: 1 }).run(us(1));
      return b;
    };
    expect(messages(setup(15))).toEqual([]);
    setup(15).expect({ q: 1 });
    const b = setup(14);
    expect(messages(b)).toEqual([
      'setup-violation d: d changed 14 ns before cp rose (setup time ≥ 15 ns)',
    ]);
    b.expect({ q: 'X' });
  });

  it('hold: 4 ns is enough for both checks; 2 ns reports (the two merged) and makes the bit X', () => {
    const hold = (after: number) => {
      const b = flop();
      b.set({ d: 1 }).run(us(1));
      b.set({ cp: 1 }).run(ns(after));
      b.set({ d: 0 }).run(us(1));
      return b;
    };
    expect(messages(hold(4))).toEqual([]);
    hold(4).expect({ q: 1 });
    const b = hold(2);
    // Repeats of one kind on one pin are one diagnostic (counted): the first check's message.
    expect(messages(b).map((m) => m.split(': ')[1])).toEqual([
      'd changed 2 ns after cp rose (hold time ≥ 3 ns)',
    ]);
    expect(b.diagnostics.find((d) => d.kind === 'hold-violation')?.count).toBe(2);
    b.expect({ q: 'X' });
  });

  it('hold: redoes the edge that loaded from the words before it (a state machine moved on)', () => {
    const run = (after: number) => {
      const b = new Bench(part('spec_hold_fsm'));
      b.set({ clk: 0, rst: 1, d: 1 }).run(us(1));
      b.set({ clk: 1 }).run(us(1));
      b.set({ clk: 0, rst: 0 }).run(us(1)); // en = 1: the next edge loads d
      b.set({ clk: 1 }).run(ns(after));
      b.set({ d: 0 }).run(us(1));
      return b;
    };
    run(3).expect({ q: 1, en: 0 });
    const b = run(2);
    expect(messages(b)).toEqual([
      'hold-violation d: d changed 2 ns after clk rose (hold time ≥ 3 ns)',
    ]);
    // What that edge loaded is unknown; en, which doesn't read d, is not.
    b.expect({ q: 'X', en: 0 });
  });

  it('a short LOW clock phase makes the edge unreliable', () => {
    const pulse = (low: number) => {
      const b = flop();
      b.set({ cp: 1 }).run(us(1));
      b.set({ d: 1 }).run(us(1));
      b.set({ cp: 0 }).run(ns(low));
      b.set({ cp: 1 }).run(us(1));
      return b;
    };
    expect(messages(pulse(20))).toEqual([]);
    pulse(20).expect({ q: 1 });
    const b = pulse(19);
    expect(messages(b)).toEqual([
      'pulse-width-violation cp: cp was LOW for only 19 ns (pulse width ≥ 20 ns)',
    ]);
    b.expect({ q: 'X' });
  });

  it('a short HIGH clock phase makes X what the edge before it changed', () => {
    const b = flop();
    b.set({ d: 1 }).run(us(1));
    b.set({ cp: 1 }).run(ns(19));
    b.set({ cp: 0 }).run(us(1));
    expect(messages(b).map((m) => m.split(': ')[1])).toEqual([
      'cp was HIGH for only 19 ns (pulse width ≥ 20 ns)',
    ]);
    b.expect({ q: 'X' });
    const same = flop();
    same.set({ cp: 1 }).run(ns(19));
    same.set({ cp: 0 }).run(us(1));
    same.expect({ q: 0 });
  });

  it('a short cycle (spec_cycle, armed while counting) makes X what its edge changed', () => {
    const counter = (cycle: number, en: 0 | 1 = 1) => {
      const b = new Bench(part('spec_cycle'));
      b.set({ clk: 0, rst: 1, en }).run(us(1));
      b.set({ clk: 1 }).run(us(1));
      b.set({ clk: 0, rst: 0 }).run(us(1));
      b.set({ clk: 1 }).run(ns(cycle / 2)); // q: 0 → 1
      b.set({ clk: 0 }).run(ns(cycle / 2));
      b.set({ clk: 1 }).run(us(1)); // 1 → 2: bit 0 falls, bit 1 rises
      return b;
    };
    expect(messages(counter(50))).toEqual([]);
    counter(50).expect({ q0: 0, q1: 1 });
    const b = counter(48);
    expect(messages(b)).toEqual([
      'cycle-violation clk: clk rose again 48 ns after it last rose (cycle time ≥ 50 ns)',
    ]);
    b.expect({ q0: 'X', q1: 'X' });
    // Not counting: not armed, nothing changes.
    expect(messages(counter(48, 0))).toEqual([]);
    counter(48, 0).expect({ q0: 0, q1: 0 });
  });

  it('a short set pulse leaves the bit unknown', () => {
    const pulse = (width: number) => {
      const b = flop();
      b.set({ sdn: 0 }).run(ns(width));
      b.set({ sdn: 1 }).run(us(1));
      return b;
    };
    pulse(20).expect({ q: 1 });
    expect(messages(pulse(20))).toEqual([]);
    const b = pulse(19);
    expect(messages(b).map((m) => m.split(': ')[1])).toEqual([
      'sdn was LOW for only 19 ns (pulse width ≥ 20 ns)',
    ]);
    b.expect({ q: 'X' });
  });

  it('recovery: 8 ns after reset is enough; 7 ns makes the edge unreliable', () => {
    const recover = (after: number) => {
      const b = flop();
      b.set({ d: 1, rdn: 0 }).run(us(1));
      b.set({ rdn: 1 }).run(ns(after));
      b.set({ cp: 1 }).run(us(1));
      return b;
    };
    expect(messages(recover(8))).toEqual([]);
    recover(8).expect({ q: 1 });
    const b = recover(7);
    expect(messages(b)).toEqual([
      'recovery-violation rdn: cp rose 7 ns after rdn was released (recovery time ≥ 8 ns)',
    ]);
    b.expect({ q: 'X' });
  });

  it('removal: a set released 1 ns after the edge reports a hold of its release', () => {
    const b = flop();
    b.set({ sdn: 0 }).run(us(1));
    b.set({ cp: 1 }).run(ns(1));
    b.set({ sdn: 1 }).run(us(1));
    expect(messages(b).map((m) => m.split(': ')[1])).toEqual([
      'sdn rose 1 ns after cp rose (hold time ≥ 2 ns)',
    ]);
  });

  it('checks the clock only while armed: not while reset holds the flip-flop', () => {
    const b = flop();
    b.set({ rdn: 0 }).run(us(1));
    b.set({ d: 1 }).run(ns(13)); // passes the unarmed 12 ns set-up, not the armed 15 ns one
    b.set({ cp: 1 }).run(ns(10)); // a HIGH phase of 10 ns
    b.set({ cp: 0 }).run(us(1));
    expect(messages(b)).toEqual([]);
    b.expect({ q: 0 });
  });

  it('makes X only the bits whose data was late or early (a vector)', () => {
    const b = settled4();
    b.set({ d0: 1 }).run(ns(11));
    b.set({ clk: 1 }).run(us(1));
    expect(messages(b)).toEqual([
      'setup-violation d0: d0 changed 11 ns before clk rose (setup time ≥ 12 ns)',
    ]);
    expect(['q0', 'q1', 'q2', 'q3'].map((q) => levelChar(b.get(q))).join('')).toBe('X111');
    b.set({ clk: 0, d0: 0 }).run(us(1));
    b.set({ clk: 1 }).run(ns(4));
    b.set({ d2: 0 }).run(us(1));
    expect(messages(b).slice(1)).toEqual([
      'hold-violation d2: d2 changed 4 ns after clk rose (hold time ≥ 5 ns)',
    ]);
    expect(['q0', 'q1', 'q2', 'q3'].map((q) => levelChar(b.get(q))).join('')).toBe('01X1');
  });

  it('reports data changing with the clock once, as a set-up violation', () => {
    const b = settled4();
    b.set({ d0: 1, clk: 1 }).run(us(1));
    expect(messages(b)).toEqual([
      'setup-violation d0: d0 changed at the same time as clk rose (setup time ≥ 12 ns)',
    ]);
    expect(levelChar(b.get('q0'))).toBe('X');
    expect(levelChar(b.get('q1'))).toBe('1');
    expect(b.diagnostics.find((d) => d.kind === 'setup-violation')?.count).toBe(1);
  });

  /** spec_tristate enabled, d = 1110 (d0 = 0) loaded long ago. */
  function settled4(): Bench {
    const b = new Bench(part('spec_tristate'));
    b.set({ clk: 0, oen: 0, d0: 0, d1: 1, d2: 1, d3: 1 });
    b.run(us(1));
    b.set({ clk: 1 }).run(us(1));
    b.set({ clk: 0 }).run(us(1));
    return b;
  }
});

describe('a module with specify in the Part tab (HDL-2)', () => {
  it('shows its paths and checks as its timing', () => {
    const timed = part('spec_tristate');
    expect(timed.timing).toMatchObject({
      typical: {
        'tpd(clk↑ to q)': ns(17),
        'tpd(oen to q, if !oen)': ns(16),
        'tpd(oen to q, if oen)': ns(14),
      },
      min: { 'tsu(d to clk↑)': ns(12), 'th(d to clk↑)': ns(5) },
      source: 'the specify block of module spec_tristate',
    });
    expect(part('decoder').timing).toBeUndefined();
  });
});
