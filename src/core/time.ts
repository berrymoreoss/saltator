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

const PARSE_UNITS: Readonly<Record<string, number>> = {
  ps: 1,
  ns: PS_PER_NS,
  us: PS_PER_US,
  µs: PS_PER_US,
  μs: PS_PER_US,
  ms: PS_PER_MS,
  s: PS_PER_S,
};

/**
 * Reads a time typed by a user: a number with an optional unit (`10 ns`, `1.5us`, `2 µs`,
 * `500ps`); a bare number is nanoseconds. Returns integer picoseconds, or undefined for anything
 * else (negative, not a number, unknown unit). `parseTime(formatTime(t))` is `t` up to the
 * 3 decimals `formatTime` keeps.
 */
export function parseTime(text: string): Time | undefined {
  const match = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*([a-zµμ]*)\s*$/i.exec(text);
  if (!match) return undefined;
  const unit = match[2]!.toLowerCase() || 'ns';
  const scale = PARSE_UNITS[unit];
  if (scale === undefined) return undefined;
  return Math.round(Number(match[1]) * scale);
}
