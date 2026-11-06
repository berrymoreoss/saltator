import { describe, expect, it } from 'vitest';
import {
  and,
  DRIVES,
  Drive,
  driveName,
  isContention,
  LEVELS,
  Level,
  levelChar,
  levelOf,
  not,
  or,
  resolve,
  Strength,
  strengthOf,
  strong,
  toInput,
  weak,
  xor,
} from './logic';

const L = (c: string): Level => {
  const level = { '0': Level.L0, '1': Level.L1, X: Level.X, Z: Level.Z }[c];
  if (level === undefined) throw new Error(`bad level ${c}`);
  return level;
};

/** Truth table as rows a = 0,1,X,Z; columns b = 0,1,X,Z. */
function checkTable(op: (a: Level, b: Level) => Level, rows: string[]) {
  for (const a of LEVELS) {
    for (const b of LEVELS) {
      const expected = L(rows[a]![b]!);
      expect(op(a, b), `${levelChar(a)} op ${levelChar(b)}`).toBe(expected);
    }
  }
}

describe('level operators', () => {
  it('AND: any 0 → 0, all 1 → 1, else X', () => {
    checkTable(and, ['0000', '01XX', '0XXX', '0XXX']);
  });

  it('OR: any 1 → 1, all 0 → 0, else X', () => {
    checkTable(or, ['01XX', '1111', 'X1XX', 'X1XX']);
  });

  it('XOR: any X/Z → X', () => {
    checkTable(xor, ['01XX', '10XX', 'XXXX', 'XXXX']);
  });

  it('NOT: X and Z → X', () => {
    expect(LEVELS.map(not).map(levelChar).join('')).toBe('10XX');
  });

  it('toInput reads Z as X', () => {
    expect(LEVELS.map(toInput).map(levelChar).join('')).toBe('01XX');
  });

  it('AND/OR fold correctly over many inputs (associative with X)', () => {
    for (const a of LEVELS) {
      for (const b of LEVELS) {
        for (const c of LEVELS) {
          expect(and(and(a, b), c)).toBe(and(a, and(b, c)));
          expect(or(or(a, b), c)).toBe(or(a, or(b, c)));
          expect(xor(xor(a, b), c)).toBe(xor(a, xor(b, c)));
        }
      }
    }
  });
});

describe('drives', () => {
  it('packs level and strength', () => {
    expect(DRIVES.map((d) => [levelChar(levelOf(d)), strengthOf(d)])).toEqual([
      ['Z', Strength.NONE],
      ['0', Strength.WEAK],
      ['1', Strength.WEAK],
      ['X', Strength.WEAK],
      ['0', Strength.STRONG],
      ['1', Strength.STRONG],
      ['X', Strength.STRONG],
    ]);
  });

  it('strong() and weak() build drives from levels; Z releases', () => {
    expect(LEVELS.map(strong)).toEqual([Drive.STRONG_0, Drive.STRONG_1, Drive.STRONG_X, Drive.Z]);
    expect(LEVELS.map(weak)).toEqual([Drive.WEAK_0, Drive.WEAK_1, Drive.WEAK_X, Drive.Z]);
  });

  it('has readable names', () => {
    expect(DRIVES.map(driveName)).toEqual([
      'Z',
      'weak 0',
      'weak 1',
      'weak X',
      'strong 0',
      'strong 1',
      'strong X',
    ]);
  });
});

/** The resolution rules of docs/simulation.md, written as literally as possible. */
function referenceResolve(drives: Drive[]): Drive {
  const active = drives.filter((d) => d !== Drive.Z);
  if (active.length === 0) return Drive.Z;
  const max = Math.max(...active.map(strengthOf));
  const levels = new Set(active.filter((d) => strengthOf(d) === max).map(levelOf));
  const level = levels.size === 1 ? [...levels][0]! : Level.X;
  return max === Strength.STRONG ? strong(level) : weak(level);
}

function referenceContention(drives: Drive[]): boolean {
  return drives.includes(Drive.STRONG_0) && drives.includes(Drive.STRONG_1);
}

function lists(n: number): Drive[][] {
  if (n === 0) return [[]];
  return lists(n - 1).flatMap((rest) => DRIVES.map((d) => [...rest, d]));
}

describe('resolve', () => {
  it('matches the spec for every combination of up to 4 drivers', () => {
    let count = 0;
    for (let n = 0; n <= 4; n++) {
      for (const drives of lists(n)) {
        count++;
        const label = drives.map(driveName).join(', ');
        expect(resolve(drives), label).toBe(referenceResolve(drives));
        expect(isContention(drives), label).toBe(referenceContention(drives));
      }
    }
    expect(count).toBe(1 + 7 + 49 + 343 + 2401);
  });

  it('covers the cases called out in the spec', () => {
    // A strong 0 overrides a pull-up (pressed button).
    expect(resolve([Drive.WEAK_1, Drive.STRONG_0])).toBe(Drive.STRONG_0);
    // Opposite pulls → weak X, no contention.
    expect(resolve([Drive.WEAK_0, Drive.WEAK_1])).toBe(Drive.WEAK_X);
    expect(isContention([Drive.WEAK_0, Drive.WEAK_1])).toBe(false);
    // Strong 0 vs strong 1 → strong X + contention.
    expect(resolve([Drive.STRONG_0, Drive.STRONG_1])).toBe(Drive.STRONG_X);
    expect(isContention([Drive.STRONG_0, Drive.STRONG_1])).toBe(true);
    // Strong X meeting strong 0 → X without contention.
    expect(resolve([Drive.STRONG_X, Drive.STRONG_0])).toBe(Drive.STRONG_X);
    expect(isContention([Drive.STRONG_X, Drive.STRONG_0])).toBe(false);
    // Nothing drives → Z.
    expect(resolve([Drive.Z, Drive.Z])).toBe(Drive.Z);
    expect(resolve([])).toBe(Drive.Z);
  });
});
