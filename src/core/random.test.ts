import { describe, expect, it } from 'vitest';
import { hashString, SeededRandom } from './random';

describe('hashString', () => {
  it('is 32-bit FNV-1a', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });

  it('tells designators apart', () => {
    expect(hashString('U1')).not.toBe(hashString('U2'));
  });
});

describe('SeededRandom', () => {
  const draw = (seed: number, n: number) => {
    const random = new SeededRandom(seed);
    return Array.from({ length: n }, () => random.nextUint32());
  };

  it('gives the same numbers for the same seed', () => {
    expect(draw(42, 20)).toEqual(draw(42, 20));
  });

  it('gives other numbers for another seed', () => {
    expect(draw(42, 20)).not.toEqual(draw(43, 20));
  });

  it('draws unsigned 32-bit integers', () => {
    for (const n of draw(7, 1000)) {
      expect(Number.isInteger(n) && n >= 0 && n < 2 ** 32).toBe(true);
    }
  });

  it('fills bytes four per draw, every value turning up', () => {
    const bytes = new Uint8Array(10);
    new SeededRandom(5).fill(bytes);
    const [first, second] = draw(5, 2) as [number, number];
    expect([...bytes.subarray(0, 4)]).toEqual([0, 8, 16, 24].map((s) => (first >>> s) & 0xff));
    expect(bytes[4]).toBe(second & 0xff);

    const many = new Uint8Array(1 << 16);
    new SeededRandom(9).fill(many);
    const seen = new Set(many);
    expect(seen.size).toBe(256);
    const mean = many.reduce((sum, b) => sum + b, 0) / many.length;
    expect(Math.abs(mean - 127.5)).toBeLessThan(2);
  });
});
