/**
 * Signal model: 4-state levels, drive strengths, net resolution and 4-state level operators.
 * Spec: docs/simulation.md#signal-values.
 */

/** Resolved value of a net as seen by readers. `X` = unknown, `Z` = high impedance (floating). */
export const Level = {
  L0: 0,
  L1: 1,
  X: 2,
  Z: 3,
} as const;
export type Level = (typeof Level)[keyof typeof Level];

/** How hard a driver pushes its level onto a net. */
export const Strength = {
  NONE: 0,
  WEAK: 1,
  STRONG: 2,
} as const;
export type Strength = (typeof Strength)[keyof typeof Strength];

/**
 * What a driver contributes to a net: a level plus a strength, packed as `strength << 2 | level`
 * so `levelOf` and `strengthOf` are a mask and a shift.
 */
export const Drive = {
  Z: 3,
  WEAK_0: 4,
  WEAK_1: 5,
  WEAK_X: 6,
  STRONG_0: 8,
  STRONG_1: 9,
  STRONG_X: 10,
} as const;
export type Drive = (typeof Drive)[keyof typeof Drive];

/** All drive values, in encoding order. */
export const DRIVES: readonly Drive[] = Object.values(Drive);

/** All level values, in encoding order. */
export const LEVELS: readonly Level[] = Object.values(Level);

/** The level a drive puts on a net (`Z` for an inactive driver). */
export function levelOf(drive: Drive): Level {
  return (drive & 3) as Level;
}

/** The strength of a drive. */
export function strengthOf(drive: Drive): Strength {
  return (drive >> 2) as Strength;
}

/** Push-pull output driving `level` (`Z` → released). */
export function strong(level: Level): Drive {
  return level === Level.Z ? Drive.Z : ((8 | level) as Drive);
}

/** Pull resistor towards `level` (`Z` → released). */
export function weak(level: Level): Drive {
  return level === Level.Z ? Drive.Z : ((4 | level) as Drive);
}

/** One-character name of a level: `'0' | '1' | 'X' | 'Z'`. */
export function levelChar(level: Level): '0' | '1' | 'X' | 'Z' {
  return LEVEL_CHARS[level]!;
}

const LEVEL_CHARS = ['0', '1', 'X', 'Z'] as const;

/** Readable name of a drive, e.g. `'strong 1'`, `'weak X'`, `'Z'`. */
export function driveName(drive: Drive): string {
  if (drive === Drive.Z) return 'Z';
  const strength = strengthOf(drive) === Strength.STRONG ? 'strong' : 'weak';
  return `${strength} ${levelChar(levelOf(drive))}`;
}

// --- Resolution -------------------------------------------------------------------------------
//
// The simulator accumulates drivers of a net into a small bit set, then resolves the set once:
// bits 0–2 = weak 0/1/X seen, bits 3–5 = strong 0/1/X seen. This keeps resolution branch-light
// and allocation-free; `resolve()` below is the convenience form over a list.

/** Bit-set contribution of one drive (0 for `Z`). */
export function driveBits(drive: Drive): number {
  const strength = drive >> 2;
  return strength === 0 ? 0 : 1 << ((strength - 1) * 3 + (drive & 3));
}

/** Resolved drive of a net from the OR of its drivers' `driveBits`. */
export function resolveBits(bits: number): Drive {
  const strongBits = bits >> 3;
  if (strongBits !== 0) {
    return strongBits === 1 ? Drive.STRONG_0 : strongBits === 2 ? Drive.STRONG_1 : Drive.STRONG_X;
  }
  if (bits !== 0) {
    return bits === 1 ? Drive.WEAK_0 : bits === 2 ? Drive.WEAK_1 : Drive.WEAK_X;
  }
  return Drive.Z;
}

/** True when the bit set has strong drivers with opposite known levels (a short circuit). */
export function isContentionBits(bits: number): boolean {
  return (bits & 0b011_000) === 0b011_000;
}

/**
 * Resolves several drivers on one net: the strongest strength wins; if its drivers disagree the
 * net is `X` at that strength; no drivers (all `Z`) → `Z`.
 */
export function resolve(drives: Iterable<Drive>): Drive {
  return resolveBits(accumulate(drives));
}

/** True when strong drivers on the net force opposite known levels (strong 0 vs strong 1). */
export function isContention(drives: Iterable<Drive>): boolean {
  return isContentionBits(accumulate(drives));
}

function accumulate(drives: Iterable<Drive>): number {
  let bits = 0;
  for (const drive of drives) bits |= driveBits(drive);
  return bits;
}

// --- Level operators --------------------------------------------------------------------------
//
// 4-state semantics (CMOS inputs treat Z as unknown): AND is 0 if any input is 0, 1 if all are 1,
// otherwise X; OR is the dual; XOR is X if any input is X/Z; NOT maps X/Z to X. Lookup tables are
// indexed by `a << 2 | b`.

function table(op: (a: Level, b: Level) => Level): Uint8Array {
  const t = new Uint8Array(16);
  for (const a of LEVELS) for (const b of LEVELS) t[(a << 2) | b] = op(a, b);
  return t;
}

const isKnown = (l: Level): l is 0 | 1 => l === Level.L0 || l === Level.L1;

const AND = table((a, b) =>
  a === Level.L0 || b === Level.L0
    ? Level.L0
    : a === Level.L1 && b === Level.L1
      ? Level.L1
      : Level.X,
);
const OR = table((a, b) =>
  a === Level.L1 || b === Level.L1
    ? Level.L1
    : a === Level.L0 && b === Level.L0
      ? Level.L0
      : Level.X,
);
const XOR = table((a, b) => (isKnown(a) && isKnown(b) ? ((a ^ b) as Level) : Level.X));
const NOT = Uint8Array.of(Level.L1, Level.L0, Level.X, Level.X);

/** 4-state AND. */
export function and(a: Level, b: Level): Level {
  return AND[(a << 2) | b] as Level;
}

/** 4-state OR. */
export function or(a: Level, b: Level): Level {
  return OR[(a << 2) | b] as Level;
}

/** 4-state XOR. */
export function xor(a: Level, b: Level): Level {
  return XOR[(a << 2) | b] as Level;
}

/** 4-state NOT (`X`/`Z` → `X`). */
export function not(a: Level): Level {
  return NOT[a] as Level;
}

/** Converts `Z` to `X` (how a CMOS input sees a floating net); other levels pass through. */
export function toInput(a: Level): Level {
  return a === Level.Z ? Level.X : a;
}
