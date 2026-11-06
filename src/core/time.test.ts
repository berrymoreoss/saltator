import { describe, expect, it } from 'vitest';
import { formatTime, ms, ns, ps, TIME_MAX, us } from './time';

describe('time units', () => {
  it('converts to integer picoseconds', () => {
    expect(ps(5)).toBe(5);
    expect(ns(7)).toBe(7_000);
    expect(us(1)).toBe(1_000_000);
    expect(ms(2)).toBe(2_000_000_000);
  });

  it('rounds fractional values to whole picoseconds', () => {
    expect(ns(0.3)).toBe(300);
    expect(ns(1.5)).toBe(1_500);
    expect(ps(0.4)).toBe(0);
    expect(Number.isInteger(us(0.123_456_7))).toBe(true);
  });

  it('TIME_MAX is a safe integer', () => {
    expect(Number.isSafeInteger(TIME_MAX)).toBe(true);
  });
});

describe('formatTime', () => {
  it.each([
    [0, '0 ps'],
    [999, '999 ps'],
    [1_000, '1 ns'],
    [1_500, '1.5 ns'],
    [ns(7.25), '7.25 ns'],
    [us(1), '1 µs'],
    [us(2.5), '2.5 µs'],
    [ms(16), '16 ms'],
    [ms(1_500), '1.5 s'],
    [1_234_567, '1.235 µs'],
    [-ns(2), '-2 ns'],
  ])('%d ps → %s', (t, text) => {
    expect(formatTime(t)).toBe(text);
  });
});
