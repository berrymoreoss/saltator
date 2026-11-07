import { describe, expect, it } from 'vitest';
import { type AnyComponentDefinition, Level, ns, pinsOf } from '../../core';
import { Bench, functionTable } from '../../core/testing';
import { hcArithmetic } from './arithmetic';

const chip = (number: string) => hcArithmetic.find((d) => d.name === `74HC${number}`)!;
const nameAt = (d: AnyComponentDefinition, number: number) =>
  pinsOf(d, {}).find((p) => p.number === number)!.name;
const bit = (value: number, n: number) => ((value >> n) & 1 ? Level.L1 : Level.L0);

/** Drives a 4-bit word onto pins given by number, bit 0 first. */
const word = (d: AnyComponentDefinition, numbers: readonly number[], value: number) =>
  Object.fromEntries(numbers.map((number, n) => [nameAt(d, number), bit(value, n)]));

describe('74HC283', () => {
  const hc283 = chip('283');
  // From the TI pinning figure, bit 0 first.
  const A = [5, 3, 14, 12];
  const B = [6, 2, 15, 11];
  const S = [4, 1, 13, 10];
  const CIN = nameAt(hc283, 7);
  const COUT = nameAt(hc283, 9);

  it('has the Philips function table example in TI’s names', () => {
    expect(functionTable(new Bench(hc283), hc283.functionTable!)).toBe(1);
  });

  it('adds every pair of words with and without a carry in, by pin number', () => {
    const bench = new Bench(hc283);
    for (let carry = 0; carry < 2; carry++) {
      for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
          bench.set({ ...word(hc283, A, x), ...word(hc283, B, y), [CIN]: bit(carry, 0) }).settle();
          const sum = x + y + carry;
          bench.expect({ ...word(hc283, S, sum & 15), [COUT]: bit(sum, 4) });
        }
      }
    }
  });

  it('keeps the sum bits below an unknown input, and carries that cannot depend on it', () => {
    const bench = new Bench(hc283);
    bench.set({ ...word(hc283, A, 0b0011), ...word(hc283, B, 0b0001), CIN: 0 });
    bench.set({ A2: 'X' }).settle();
    // 0X11 + 0001: S0 = 0, S1 = 0, carry 1 into bit 2 → S2 = X, carry out of bit 2 = X·1 = X.
    bench.expect({ S0: 0, S1: 0, S2: 'X', S3: 'X', COUT: 0 }); // bit 3: 0 + 0 + X carries 0
    bench.set({ A3: 1, B3: 1 }).settle();
    bench.expect({ S2: 'X', S3: 'X', COUT: 1 }); // 1 + 1 + X carries 1
    bench.set({ CIN: 'Z' }).settle();
    bench.expect({ S0: 'X', COUT: 1 });
  });

  it('delays each output by its path: CIN to S0 … S3 and COUT, An/Bn to Sn and COUT', () => {
    const bench = new Bench(hc283);
    // A = 0111, B = 0: CIN ripples through S0 … S3.
    bench.set({ ...word(hc283, A, 0b0111), ...word(hc283, B, 0), CIN: 0 }).settle();
    expect(bench.measure({ CIN: 1 }, 'S0')).toBe(ns(19));
    expect(bench.measure({ CIN: 0 }, 'S1')).toBe(ns(21));
    expect(bench.measure({ CIN: 1 }, 'S2')).toBe(ns(23));
    expect(bench.measure({ CIN: 0 }, 'S3')).toBe(ns(27));
    bench.set({ A3: 1 }).settle(); // A = 1111
    expect(bench.measure({ CIN: 1 }, 'COUT')).toBe(ns(23));
    expect(bench.measure({ B0: 1 }, 'S0')).toBe(ns(25)); // 1111 + 0001 + 1 = 1 0001
    expect(bench.measure({ A0: 0, B0: 0 }, 'COUT')).toBe(ns(23)); // 1110 + 0 + 1 = 0 1111
    expect(bench.measure({ A0: 1 }, 'S0')).toBe(ns(25)); // 1111 + 0 + 1 = 1 0000
    expect(bench.measure({ A0: 0, CIN: 0 }, 'S1')).toBe(ns(25)); // 1110: A0 (25) and CIN (21) paths
  });
});

describe('74HC85', () => {
  const hc85 = chip('85');
  // From the pinning figure, bit 0 first; expansion inputs IA>B, IA<B, IA=B; outputs.
  const A = [10, 12, 13, 15];
  const B = [9, 11, 14, 1];
  const [IGT, ILT, IEQ] = [4, 2, 3].map((n) => nameAt(hc85, n)) as [string, string, string];
  const [QGT, QLT, QEQ] = [5, 7, 6].map((n) => nameAt(hc85, n)) as [string, string, string];

  it('names its pins as the data sheet does', () => {
    expect([IGT, ILT, IEQ, QGT, QLT, QEQ]).toEqual([
      'IA>B',
      'IA<B',
      'IA=B',
      'QA>B',
      'QA<B',
      'QA=B',
    ]);
  });

  /** The function table's last six rows (A = B): IA>B IA<B IA=B → QA>B QA<B QA=B. */
  const EQUAL_WORDS: Readonly<Record<string, readonly number[]>> = {
    '100': [1, 0, 0],
    '010': [0, 1, 0],
    '001': [0, 0, 1],
    '101': [0, 0, 1], // X X H
    '011': [0, 0, 1],
    '111': [0, 0, 1],
    '110': [0, 0, 0],
    '000': [1, 1, 0],
  };

  it('compares every pair of words for every expansion input, by pin number', () => {
    const bench = new Bench(hc85);
    for (const [expansion, equalWords] of Object.entries(EQUAL_WORDS)) {
      const [gt, lt, eq] = [...expansion].map((c) => (c === '1' ? Level.L1 : Level.L0)) as [
        Level,
        Level,
        Level,
      ];
      for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
          bench.set({ ...word(hc85, A, x), ...word(hc85, B, y), [IGT]: gt, [ILT]: lt, [IEQ]: eq });
          bench.settle();
          const out = x > y ? [1, 0, 0] : x < y ? [0, 1, 0] : equalWords;
          bench.expect({ [QGT]: out[0] as 0 | 1, [QLT]: out[1] as 0 | 1, [QEQ]: out[2] as 0 | 1 });
        }
      }
    }
  });

  it('decides on the higher bits whatever the lower ones are, X only where they matter', () => {
    const bench = new Bench(hc85);
    bench.set({ ...word(hc85, A, 0b1000), ...word(hc85, B, 0b0111), [IGT]: 0, [ILT]: 0, [IEQ]: 1 });
    bench.set({ A0: 'X', B1: 'Z' }).settle();
    bench.expect({ [QGT]: 1, [QLT]: 0, [QEQ]: 0 });
    bench.set({ A3: 0, B3: 0, A2: 1, B2: 1, A1: 1 }).settle(); // 011X vs 01Z1
    bench.expect({ [QGT]: 'X', [QLT]: 'X', [QEQ]: 'X' });
  });

  it('delays by path: words to the outputs, expansion inputs to the outputs', () => {
    const bench = new Bench(hc85);
    bench.set({ ...word(hc85, A, 5), ...word(hc85, B, 5), [IGT]: 0, [ILT]: 0, [IEQ]: 1 }).settle();
    expect(bench.measure({ A1: 1 }, QGT)).toBe(ns(23));
    expect(bench.measure({ A1: 0 }, QEQ)).toBe(ns(21));
    expect(bench.measure({ [IEQ]: 0 }, QEQ)).toBe(ns(14));
    // IA=B low: QA>B = not IA<B, QA<B = not IA>B (both now high).
    expect(bench.measure({ [ILT]: 1 }, QGT)).toBe(ns(18));
    expect(bench.measure({ [IGT]: 1 }, QLT)).toBe(ns(18));
    bench.expect({ [QGT]: 0, [QLT]: 0, [QEQ]: 0 });
  });
});
