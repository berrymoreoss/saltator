import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../core';
import {
  add,
  bitOf,
  compare,
  divide,
  isZero,
  limbCount,
  lowestSet,
  mul,
  negate,
  readWord,
  setFrom,
  sub,
  truncate,
  writeWord,
} from './words';

const toLimbs = (value: bigint, limbs: number): Uint32Array =>
  Uint32Array.from({ length: limbs }, (_, k) => Number((value >> BigInt(32 * k)) & 0xffffffffn));
const fromLimbs = (a: Uint32Array): bigint =>
  a.reduceRight((acc, limb) => (acc << 32n) | BigInt(limb), 0n);

/** A seeded value of `width` bits, often with long runs of 0s or 1s (carries, borrows). */
function value(random: SeededRandom, width: number): bigint {
  let v = 0n;
  for (let i = 0; i < width; i += 32) v = (v << 32n) | BigInt(random.nextUint32());
  const pick = random.nextUint32() % 5;
  if (pick === 0) v = 0n;
  if (pick === 1) v = -1n;
  if (pick === 2) v >>= BigInt(random.nextUint32() % (width + 1));
  return BigInt.asUintN(width, v);
}

const WIDTHS = [1, 7, 31, 32, 33, 63, 64, 65, 80, 128];

describe('words', () => {
  it('limbCount', () => {
    expect([0, 1, 32, 33, 64, 65].map(limbCount)).toEqual([1, 1, 1, 2, 2, 3]);
  });

  it('add, sub, negate and mul match BigInt modulo 2^width', () => {
    const random = new SeededRandom(19);
    for (const width of WIDTHS) {
      const n = limbCount(width);
      const r = new Uint32Array(n);
      const acc = new Float64Array(2 * n);
      for (let t = 0; t < 60; t++) {
        const a = value(random, width);
        const b = value(random, width);
        const at = toLimbs(a, n);
        const bt = toLimbs(b, n);
        const check = (op: string, want: bigint) => {
          truncate(r, width);
          expect(fromLimbs(r), `${op} ${width}: ${a} ${b}`).toBe(BigInt.asUintN(width, want));
        };
        add(r, at, bt);
        check('add', a + b);
        sub(r, at, bt);
        check('sub', a - b);
        negate(r, at);
        check('negate', -a);
        mul(r, at, bt, acc);
        check('mul', a * b);
        expect(compare(at, bt)).toBe(a < b ? -1 : a > b ? 1 : 0);
      }
    }
  });

  it('mul and add may write over an operand', () => {
    const a = toLimbs(0x1_2345_6789n, 2);
    const acc = new Float64Array(4);
    mul(a, a, a, acc);
    expect(fromLimbs(a)).toBe(BigInt.asUintN(64, 0x1_2345_6789n * 0x1_2345_6789n));
    add(a, a, a);
    expect(fromLimbs(a)).toBe(BigInt.asUintN(64, 2n * 0x1_2345_6789n * 0x1_2345_6789n));
  });

  it('divide matches BigInt', () => {
    const random = new SeededRandom(23);
    for (const width of WIDTHS) {
      const n = limbCount(width + 1);
      const q = new Uint32Array(n);
      const r = new Uint32Array(n);
      for (let t = 0; t < 60; t++) {
        const a = value(random, width);
        let b = value(random, width);
        if (t % 7 === 0) b = BigInt.asUintN(width, a >> BigInt(t % width));
        if (b === 0n) b = 1n;
        divide(q, r, toLimbs(a, n), toLimbs(b, n), width);
        expect(fromLimbs(q), `${a} / ${b}`).toBe(a / b);
        expect(fromLimbs(r), `${a} % ${b}`).toBe(a % b);
      }
    }
  });

  it('bits: bitOf, isZero, lowestSet, setFrom, truncate', () => {
    const a = toLimbs(1n << 40n, 2);
    expect([bitOf(a, 40), bitOf(a, 39), isZero(a), lowestSet(a)]).toEqual([1, 0, false, 40]);
    expect([isZero(new Uint32Array(3)), lowestSet(new Uint32Array(3))]).toEqual([true, -1]);
    const b = new Uint32Array(3);
    setFrom(b, 35);
    expect(fromLimbs(b)).toBe(BigInt.asUintN(96, -1n << 35n));
    truncate(b, 70);
    expect(fromLimbs(b)).toBe((1n << 70n) - (1n << 35n));
    setFrom(b, 0);
    truncate(b, 64);
    expect(fromLimbs(b)).toBe((1n << 64n) - 1n);
  });

  it('readWord and writeWord carry values and unknown bits through the planes', () => {
    const val = new Uint8Array(40);
    const unk = new Uint8Array(40);
    const idx = Int32Array.from({ length: 36 }, (_, i) => 39 - i);
    const v = toLimbs(0xa_5a5a_5a5an, 2);
    const u = toLimbs(1n << 33n, 2);
    writeWord(val, unk, idx, v, u);
    expect([unk[39 - 33], val[39 - 1], val[39 - 0]]).toEqual([1, 1, 0]);
    const v2 = new Uint32Array(2);
    const u2 = new Uint32Array(2);
    readWord(val, unk, idx, v2, u2);
    expect(fromLimbs(v2)).toBe(0xa_5a5a_5a5an & ~(1n << 33n));
    expect(fromLimbs(u2)).toBe(1n << 33n);
  });
});
