import { describe, expect, it } from 'vitest';
import { Level } from '../../core';
import { Bench } from '../../core/testing';
import { hexDigit, hexDisplay } from './hex-display';

const bits = (value: number) => [0, 1, 2, 3].map((i) => ((value >> i) & 1) as Level);

describe('hexDigit', () => {
  it.each(Array.from({ length: 16 }, (_, v) => v))('reads %i from D0…D3', (value) => {
    expect(hexDigit(bits(value))).toBe(value);
  });

  it.each([
    ['X', Level.X],
    ['Z', Level.Z],
  ] as const)('is undefined if any input is %s', (_, level) => {
    for (let i = 0; i < 4; i++) {
      const levels = bits(0b1010);
      levels[i] = level;
      expect(hexDigit(levels)).toBeUndefined();
    }
  });
});

describe('io/hex-display', () => {
  it('has inputs D0…D3 that only observe their nets', () => {
    const bench = new Bench(hexDisplay);
    expect(bench.pins).toEqual(
      ['D0', 'D1', 'D2', 'D3'].map((name) => ({ name, dir: 'in', sense: true })),
    );
    bench.settle();
    bench.expectNoDiagnostics();
  });

  it('shows the value of its pins (read by the renderer)', () => {
    const bench = new Bench(hexDisplay);
    bench.set({ D0: 1, D1: 0, D2: 1, D3: 1 }).settle();
    expect(hexDigit(['D0', 'D1', 'D2', 'D3'].map((p) => bench.get(p)))).toBe(0xd);
  });
});
