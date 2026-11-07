/**
 * MSI chips cascaded as their data sheets show: two 74HC85s compare 8-bit words (the low chip's
 * outputs feed the high chip's expansion inputs; the low chip's IA=B is tied high), and two
 * 74HC148s make a 16-to-4 priority encoder (the high chip's EO enables the low one; AND gates
 * merge their active-low codes, the high chip's GS is bit 3).
 */
import { describe, expect, it } from 'vitest';
import { ns, type Simulator } from '../../src/core';
import { levels, rng, set, simulate } from './support';

const BITS = [0, 1, 2, 3, 4, 5, 6, 7];

function comparator8(): Simulator {
  return simulate((b) => {
    b.add('LO', '74xx/74hc85').add('HI', '74xx/74hc85');
    for (const n of BITS) {
      const [part, bit] = n < 4 ? ['LO', n] : ['HI', n - 4];
      b.add(`A${n}`, 'test/driver').add(`B${n}`, 'test/driver');
      b.net(`a${n}`, `A${n}.Y`, `${part}.A${bit}`).net(`b${n}`, `B${n}.Y`, `${part}.B${bit}`);
    }
    b.add('V', 'io/vcc').add('G', 'io/gnd');
    b.net('vcc', 'V.Y', 'LO.IA=B').net('gnd', 'G.Y', 'LO.IA>B', 'LO.IA<B');
    b.net('gt', 'LO.QA>B', 'HI.IA>B')
      .net('lt', 'LO.QA<B', 'HI.IA<B')
      .net('eq', 'LO.QA=B', 'HI.IA=B');
    b.net('GT', 'HI.QA>B').net('LT', 'HI.QA<B').net('EQ', 'HI.QA=B');
    return b;
  });
}

function compare(sim: Simulator, a: number, b: number): string {
  for (const n of BITS) {
    set(sim, `A${n}`, ((a >> n) & 1) as 0 | 1);
    set(sim, `B${n}`, ((b >> n) & 1) as 0 | 1);
  }
  sim.settle();
  return levels(sim, 'GT', 'LT', 'EQ');
}

describe('two 74HC85s cascaded to 8 bits', () => {
  it('compare 8-bit words, the low nibbles deciding only when the high ones are equal', () => {
    const sim = comparator8();
    const random = rng(85);
    const pairs = [
      [0, 0],
      [255, 255],
      [0x12, 0x13],
      [0x21, 0x12],
      [0x80, 0x7f],
      ...Array.from({ length: 200 }, () => [random() * 256, random() * 256].map(Math.floor)),
    ];
    for (const [a, b] of pairs as [number, number][]) {
      const expected = a > b ? '100' : a < b ? '010' : '001';
      expect(compare(sim, a, b), `${a} vs ${b}`).toBe(expected);
    }
  });

  it('take the low chip’s delay plus an expansion path when the low nibble decides', () => {
    const sim = comparator8();
    compare(sim, 0x55, 0x55);
    const start = sim.now;
    set(sim, 'A0', 0); // 0x54 < 0x55
    let changed: number | undefined;
    const net = sim.netIndex('LT');
    const off = sim.onNetChange((t, n) => {
      if (n === net && changed === undefined) changed = t;
    });
    sim.settle();
    off();
    // LO's QA=B falls after 21 ns (An, Bn to QA=B); then HI's QA<B rises 18 ns later (IA=B to
    // QA<B). LO's QA<B, 2 ns after its QA=B, reaches HI's IA<B, which QA<B doesn't depend on.
    expect(changed! - start).toBe(ns(21 + 18));
    expect(levels(sim, 'GT', 'LT', 'EQ')).toBe('010');
  });
});

function encoder16(): Simulator {
  return simulate((b) => {
    b.add('HI', '74xx/74hc148').add('LO', '74xx/74hc148').add('U3', '74xx/74hc08');
    for (let n = 0; n < 16; n++) {
      b.add(`I${n}`, 'test/driver').net(`i${n}`, `I${n}.Y`, `${n < 8 ? 'LO' : 'HI'}.${n % 8}`);
    }
    b.add('G', 'io/gnd').net('gnd', 'G.Y', 'HI.EI', 'U3.4A', 'U3.4B');
    b.net('cascade', 'HI.EO', 'LO.EI');
    for (const [n, gate] of [
      [0, 1],
      [1, 2],
      [2, 3],
    ] as const) {
      b.net(`hi${n}`, `HI.A${n}`, `U3.${gate}A`).net(`lo${n}`, `LO.A${n}`, `U3.${gate}B`);
      b.net(`Q${n}`, `U3.${gate}Y`);
    }
    b.net('Q3', 'HI.GS').net('GS', 'LO.GS').net('EO', 'LO.EO');
    return b;
  });
}

describe('two 74HC148s cascaded to 16 inputs', () => {
  it('encode the highest active input, active low, the high chip first', () => {
    const sim = encoder16();
    const encode = (active: readonly number[]) => {
      for (let n = 0; n < 16; n++) set(sim, `I${n}`, active.includes(n) ? 0 : 1);
      sim.settle();
      return levels(sim, 'Q3', 'Q2', 'Q1', 'Q0');
    };
    const inverted = (n: number) =>
      [3, 2, 1, 0].map((bit) => ((n >> bit) & 1 ? '0' : '1')).join('');
    for (let n = 0; n < 16; n++) expect(encode([n]), `input ${n}`).toBe(inverted(n));
    expect(encode([3, 12, 7])).toBe(inverted(12));
    expect(encode([0, 5])).toBe(inverted(5));
    // Nothing active: the low chip's EO goes low (it would enable a third chip).
    expect(encode([])).toBe('1111');
    expect(levels(sim, 'EO')).toBe('0');
  });
});
