/**
 * Values in test benches (R15a): what a script drives onto a signal and what it expects there,
 * as bits (bit 0 first), and the actual value written back for a report. Spec:
 * docs/circuit.md#test-benches.
 */
import { Level } from '../../core';

/** A problem with what a script asked for: a bad reference, value or call. Ends the bench. */
export class BenchError extends Error {
  /** The script line at fault when it isn't the one running (a row of a table). */
  readonly line?: number;

  constructor(message: string, line?: number) {
    super(message);
    this.name = 'BenchError';
    if (line !== undefined) this.line = line;
  }
}

/** Expected bits, bit 0 first: a level each, or `undefined` where any level will do. */
export type ExpectedBits = readonly (Level | undefined)[];

/**
 * Bits a script drives, bit 0 first. A number or BigInt (`0x2A`, `42n`) within the width,
 * `0`/`1`, `'X'` or `'Z'` for every bit, or text: decimal, `0x2A`, `$2A`, `0b101` (`_` between
 * digits), whose hex and binary digits may be `X` or `Z`.
 */
export function inputBits(value: unknown, width: number, ref: string): Level[] {
  const bits = parseBits(value, width, ref, false);
  return bits.map((bit) => {
    if (bit === undefined) throw new BenchError(`${ref}: can't drive a "don't care"`);
    return bit;
  });
}

/**
 * Bits a script expects, bit 0 first: as `inputBits`, except that `'X'` (and an `X` digit) means
 * don't care, as in data sheets, and `'unknown'` means every bit is `X`.
 */
export function expectedBits(value: unknown, width: number, ref: string): ExpectedBits {
  return parseBits(value, width, ref, true);
}

/** Whether actual levels meet the expected bits. */
export function bitsMatch(expected: ExpectedBits, actual: readonly Level[]): boolean {
  return expected.every((bit, i) => bit === undefined || bit === actual[i]);
}

/** A known value of bits (all 0 or 1), else undefined. */
export function bitsValue(bits: readonly Level[]): bigint | undefined {
  let value = 0n;
  for (let i = bits.length - 1; i >= 0; i--) {
    const bit = bits[i];
    if (bit !== Level.L0 && bit !== Level.L1) return undefined;
    value = (value << 1n) | BigInt(bit);
  }
  return value;
}

/**
 * Levels as a report writes them: one bit as `0`, `1`, `X`, `Z`; more as hex (`0x2A`), a nibble
 * that is all `Z` as `Z` and one with any other unknown bit as `X` (`0xX5`); when a nibble mixes
 * unknown and known bits, the bits follow, as long as they are few (`0xX5 (0b1X00_0101)`).
 */
export function formatLevels(bits: readonly Level[]): string {
  if (bits.length === 1) return char(bits[0]);
  const hex = `0x${hexDigits(bits)}`;
  const unclear = nibbles(bits).some(
    (nibble) => nibble.some(unknown) && !nibble.every((b) => b === nibble[0]),
  );
  return unclear && bits.length <= 16 ? `${hex} (0b${binaryDigits(bits)})` : hex;
}

/**
 * Expected bits as a report writes them: like `formatLevels`, a don't-care nibble or bit as `X`;
 * `unknown` when every bit is expected to be `X`; bits when nibbles mix don't care and levels.
 */
export function formatExpected(bits: ExpectedBits): string {
  if (bits.every((bit) => bit === Level.X)) return 'unknown';
  if (bits.length === 1) return char(bits[0]);
  const whole = nibbles(bits).every(
    (nibble) =>
      nibble.every((b) => b === undefined) ||
      nibble.every((b) => b === Level.Z) ||
      nibble.every((b) => b === Level.L0 || b === Level.L1),
  );
  // A don't-care nibble reads `X` either way; an expected `X` level only comes whole (above).
  const levels = bits.map((bit) => bit ?? Level.X);
  return whole ? `0x${hexDigits(levels)}` : `0b${binaryDigits(levels)}`;
}

// ── Parsing ────────────────────────────────────────────────────────────────────────────────

function parseBits(value: unknown, width: number, ref: string, expected: boolean) {
  const range = width === 1 ? '0 or 1' : `0…${(1n << BigInt(width)) - 1n}`;
  const whole = (level: Level | undefined) => Array.from({ length: width }, () => level);
  if (value === 'X' || value === 'x') return whole(expected ? undefined : Level.X);
  if (value === 'Z' || value === 'z') return whole(Level.Z);
  if (value === 'unknown') {
    if (!expected) throw new BenchError(`${ref}: drive 'X' to make it unknown`);
    return whole(Level.X);
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new BenchError(`${ref}: expected ${range}, got ${value}`);
    }
    return numberBits(BigInt(value), width, () => `${ref}: expected ${range}, got ${value}`);
  }
  if (typeof value === 'boolean') return numberBits(value ? 1n : 0n, width, () => '');
  if (typeof value !== 'string') {
    throw new BenchError(`${ref}: expected a number or text such as '0x2A', got ${show(value)}`);
  }
  const text = value.trim();
  const bad = () =>
    new BenchError(
      `${ref}: can't read ${JSON.stringify(value)} (a number, '0x2A', '$2A', '0b101', 'X', 'Z')`,
    );
  if (/^\d[\d_]*$/.test(text)) {
    return numberBits(
      BigInt(text.replaceAll('_', '')),
      width,
      () => `${ref}: expected ${range}, got ${text}`,
    );
  }
  const hex = /^(?:0x|\$)([0-9a-fxz_]+)$/i.exec(text);
  const binary = /^0b([01xz_]+)$/i.exec(text);
  const digits = (hex ?? binary)?.[1]?.replaceAll('_', '');
  if (!digits) throw bad();
  const bitsPerDigit = hex ? 4 : 1;
  const bits: (Level | undefined)[] = [];
  for (let i = digits.length - 1; i >= 0; i--) {
    const digit = digits[i]!.toUpperCase();
    if (digit === 'X' || digit === 'Z') {
      const level = digit === 'Z' ? Level.Z : expected ? undefined : Level.X;
      for (let b = 0; b < bitsPerDigit; b++) bits.push(level);
    } else {
      const n = Number.parseInt(digit, 16);
      for (let b = 0; b < bitsPerDigit; b++) bits.push(((n >> b) & 1) as Level);
    }
  }
  // Digits beyond the width must be zeros: a value that doesn't fit is a mistake.
  if (bits.slice(width).some((bit) => bit !== Level.L0)) {
    throw new BenchError(`${ref}: ${text} has more than ${width} bit${width === 1 ? '' : 's'}`);
  }
  while (bits.length < width) bits.push(Level.L0);
  return bits.slice(0, width);
}

function numberBits(value: bigint, width: number, error: () => string): Level[] {
  if (value < 0n || value >= 1n << BigInt(width)) throw new BenchError(error());
  return Array.from({ length: width }, (_, i) => Number((value >> BigInt(i)) & 1n) as Level);
}

// ── Formatting ─────────────────────────────────────────────────────────────────────────────

const unknown = (bit: Level | undefined) => bit !== Level.L0 && bit !== Level.L1;
const char = (bit: Level | undefined) =>
  bit === undefined ? 'X' : (['0', '1', 'X', 'Z'] as const)[bit];

/** Groups of four bits from bit 0 (the last one may be shorter). */
function nibbles<T>(bits: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < bits.length; i += 4) groups.push(bits.slice(i, i + 4));
  return groups;
}

function hexDigits(bits: readonly Level[]): string {
  return nibbles(bits)
    .map((nibble) => {
      if (nibble.every((b) => b === Level.Z)) return 'Z';
      if (nibble.some(unknown)) return 'X';
      return nibble
        .reduce<number>((n, b, i) => n | (b << i), 0)
        .toString(16)
        .toUpperCase();
    })
    .reverse()
    .join('');
}

/** Bits most significant first, `_` every four from bit 0. */
function binaryDigits(bits: readonly Level[]): string {
  return nibbles(bits.map(char))
    .map((nibble) => nibble.reverse().join(''))
    .reverse()
    .join('_');
}

function show(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (typeof value === 'function') return 'a function';
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}
