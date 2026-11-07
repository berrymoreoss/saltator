/**
 * Test helpers for memory chips (used by the `mem` tests only): addresses and bytes as bench
 * values, the byte on the data pins, and the changes a stimulus makes on a pin over time.
 */
import { type Level, levelChar, type Time } from '../../core';
import type { Bench, BenchValues } from '../../core/testing';

const DATA = [0, 1, 2, 3, 4, 5, 6, 7];

/** Address pins `A0`… set to `value`. */
export function address(value: number, bits: number): BenchValues {
  return Object.fromEntries(
    Array.from({ length: bits }, (_, i) => [`A${i}`, (value >> i) & 1 ? 1 : 0] as const),
  );
}

/** Data pins `IO0`…`IO7` (or `DQ0`…) driven with `value`, or released (`'Z'`). */
export function dataBus(value: number | 'Z', pins: 'IO' | 'DQ' = 'IO'): BenchValues {
  return Object.fromEntries(
    DATA.map((i) => [`${pins}${i}`, value === 'Z' ? 'Z' : (value >> i) & 1 ? 1 : 0] as const),
  );
}

/** The data pins as text, I/O7 first: `10100101`, `XXXXXXXX`, `ZZZZZZZZ`. */
export function dataText(bench: Bench, pins: 'IO' | 'DQ' = 'IO'): string {
  return DATA.map((i) => levelChar(bench.get(`${pins}${7 - i}`))).join('');
}

/** The data pins as a byte; throws unless every bit is 0 or 1. */
export function dataByte(bench: Bench, pins: 'IO' | 'DQ' = 'IO'): number {
  const text = dataText(bench, pins);
  if (!/^[01]{8}$/.test(text)) throw new Error(`data pins are ${text}`);
  return Number.parseInt(text, 2);
}

/**
 * Applies `stimulus` now and settles; returns every change of `pin` as `[ns after the stimulus,
 * level]`. Several changes at one instant (delta cycles) are all listed.
 */
export function changes(bench: Bench, stimulus: BenchValues, pin: string): [number, string][] {
  const net = bench.sim.netIndex(pin);
  const start: Time = bench.now;
  const seen: [number, string][] = [];
  const off = bench.sim.onNetChange((t: Time, n: number, level: Level) => {
    if (n === net) seen.push([(t - start) / 1000, levelChar(level)]);
  });
  try {
    bench.set(stimulus);
    bench.settle();
  } finally {
    off();
  }
  return seen;
}
