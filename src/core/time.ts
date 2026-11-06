/**
 * Simulation time: an integer number of picoseconds in a JS `number` (exact up to 2^53 ps, about
 * 2.5 hours of simulated time).
 */
export type Time = number;

/** Largest representable time; used as "no limit". */
export const TIME_MAX: Time = Number.MAX_SAFE_INTEGER;

const PS_PER_NS = 1_000;
const PS_PER_US = 1_000_000;
const PS_PER_MS = 1_000_000_000;
const PS_PER_S = 1_000_000_000_000;

// Rounding keeps time integral even for inputs like ns(0.3) (0.3 * 1000 = 300.00000000000006).

/** Picoseconds → Time (rounded to an integer). */
export function ps(n: number): Time {
  return Math.round(n);
}

/** Nanoseconds → Time. */
export function ns(n: number): Time {
  return Math.round(n * PS_PER_NS);
}

/** Microseconds → Time. */
export function us(n: number): Time {
  return Math.round(n * PS_PER_US);
}

/** Milliseconds → Time. */
export function ms(n: number): Time {
  return Math.round(n * PS_PER_MS);
}

const UNITS: readonly (readonly [number, string])[] = [
  [PS_PER_S, 's'],
  [PS_PER_MS, 'ms'],
  [PS_PER_US, 'µs'],
  [PS_PER_NS, 'ns'],
];

/**
 * Human-readable time with the largest unit that keeps the value ≥ 1, up to 3 decimals:
 * `formatTime(1500)` → `'1.5 ns'`, `formatTime(0)` → `'0 ps'`.
 */
export function formatTime(t: Time): string {
  const abs = Math.abs(t);
  for (const [scale, unit] of UNITS) {
    if (abs >= scale) return `${trim(t / scale)} ${unit}`;
  }
  return `${t} ps`;
}

function trim(value: number): string {
  return String(Number(value.toFixed(3)));
}
