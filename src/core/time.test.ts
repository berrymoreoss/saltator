import { describe, expect, it } from 'vitest';
import { formatTime, ms, ns, parseTime, ps, TIME_MAX, us } from './time';

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

describe('parseTime', () => {
  it.each([
    ['10 ns', ns(10)],
    ['10ns', ns(10)],
    ['10', ns(10)],
    ['1.5us', us(1.5)],
    ['1.5 µs', us(1.5)],
    ['2 μs', us(2)],
    ['2 MS', ms(2)],
    ['500ps', 500],
    ['0', 0],
    ['.5 ns', 500],
    ['  7 ns  ', ns(7)],
    ['1 s', 1_000_000_000_000],
  ])('%j → %i ps', (text, t) => {
    expect(parseTime(text)).toBe(t);
  });

  it.each(['', 'ns', '-1 ns', '1e3', '10 ks', 'ten', '1,5 ns', '1 2 ns'])('rejects %j', (text) => {
    expect(parseTime(text)).toBeUndefined();
  });

  it('reads back what formatTime writes', () => {
    for (const t of [0, 999, 1_000, 1_500, ns(7.25), us(2.5), ms(16), ms(1_500)]) {
      expect(parseTime(formatTime(t))).toBe(t);
    }
  });
});
