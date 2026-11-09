import { describe, expect, it } from 'vitest';
import {
  type AnyComponentDefinition,
  HDL_DEFAULT_DELAY,
  type HdlModule,
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
  const { definition } = hdlPart(`hdl/${name}`, name, moduleOf(name));
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
