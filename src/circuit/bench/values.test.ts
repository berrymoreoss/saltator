import { describe, expect, it } from 'vitest';
import { Level } from '../../core';
import {
  BenchError,
  bitsMatch,
  bitsValue,
  expectedBits,
  formatExpected,
  formatLevels,
  inputBits,
} from './values';

const { L0, L1, X, Z } = Level;
/** Levels from text written most significant first: `'1X0Z'` → [Z, 0, X, 1]. */
const levels = (text: string) =>
  [...text].reverse().map((c) => ({ '0': L0, '1': L1, X, Z })[c as '0' | '1' | 'X' | 'Z']);

describe('inputBits', () => {
  it('reads numbers, BigInts and booleans within the width, bit 0 first', () => {
    expect(inputBits(5, 4, 'Q')).toEqual(levels('0101'));
    expect(inputBits(0xa5n, 8, 'D')).toEqual(levels('10100101'));
    expect(inputBits(1, 1, 'A')).toEqual([L1]);
    expect(inputBits(true, 1, 'A')).toEqual([L1]);
    expect(inputBits(false, 1, 'A')).toEqual([L0]);
    expect(inputBits(2n ** 40n, 41, 'W')[40]).toBe(L1);
  });

  it('reads text: decimal, hex with 0x or $, binary, with _ between digits', () => {
    expect(inputBits('42', 8, 'D')).toEqual(levels('00101010'));
    expect(inputBits('0x2A', 8, 'D')).toEqual(levels('00101010'));
    expect(inputBits('$2a', 8, 'D')).toEqual(levels('00101010'));
    expect(inputBits('0b10_1010', 8, 'D')).toEqual(levels('00101010'));
    expect(inputBits(' 0x0F ', 4, 'Q')).toEqual(levels('1111'));
  });

  it('drives X or Z on every bit, or per digit', () => {
    expect(inputBits('X', 3, 'D')).toEqual([X, X, X]);
    expect(inputBits('Z', 2, 'D')).toEqual([Z, Z]);
    expect(inputBits('0xZ5', 8, 'D')).toEqual(levels('ZZZZ0101'));
    expect(inputBits('0b1X0z', 4, 'D')).toEqual(levels('1X0Z'));
  });

  it('refuses what doesn’t fit or can’t be driven, naming the signal', () => {
    expect(() => inputBits(16, 4, 'Q[0..3]')).toThrow('Q[0..3]: expected 0…15, got 16');
    expect(() => inputBits(-1, 4, 'Q[0..3]')).toThrow('Q[0..3]: expected 0…15, got -1');
    expect(() => inputBits(2, 1, 'A')).toThrow('A: expected 0 or 1, got 2');
    expect(() => inputBits(1.5, 4, 'Q')).toThrow('Q: expected 0…15, got 1.5');
    expect(() => inputBits('0x1F', 4, 'Q')).toThrow('Q: 0x1F has more than 4 bits');
    expect(() => inputBits('0b11', 1, 'A')).toThrow('A: 0b11 has more than 1 bit');
    expect(() => inputBits('high', 1, 'A')).toThrow(`A: can't read "high"`);
    expect(() => inputBits('0x', 1, 'A')).toThrow(`A: can't read "0x"`);
    expect(() => inputBits(undefined, 1, 'A')).toThrow('A: expected a number or text');
    expect(() => inputBits([1], 1, 'A')).toThrow('got [1]');
    expect(() => inputBits('unknown', 1, 'A')).toThrow(`A: drive 'X' to make it unknown`);
    expect(() => inputBits(1, 1, 'A')).not.toThrow();
    expect(new BenchError('x')).toBeInstanceOf(Error);
  });
});

describe('expectedBits and bitsMatch', () => {
  it('takes X as don’t care, whole or per digit', () => {
    expect(expectedBits('X', 2, 'D')).toEqual([undefined, undefined]);
    expect(expectedBits('0xX5', 8, 'D')).toEqual([
      L1,
      L0,
      L1,
      L0,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(bitsMatch(expectedBits('0xX5', 8, 'D'), levels('1XZ00101'))).toBe(true);
    expect(bitsMatch(expectedBits('0xX5', 8, 'D'), levels('00000100'))).toBe(false);
  });

  it('expects unknown and floating levels exactly', () => {
    expect(bitsMatch(expectedBits('unknown', 2, 'D'), [X, X])).toBe(true);
    expect(bitsMatch(expectedBits('unknown', 2, 'D'), [X, Z])).toBe(false);
    expect(bitsMatch(expectedBits('Z', 1, 'D'), [Z])).toBe(true);
    expect(bitsMatch(expectedBits('Z', 1, 'D'), [X])).toBe(false);
    expect(bitsMatch(expectedBits(1, 1, 'D'), [X])).toBe(false);
    expect(bitsMatch(expectedBits(0, 1, 'D'), [L0])).toBe(true);
  });
});

describe('bitsValue', () => {
  it('is the number of known bits, else undefined', () => {
    expect(bitsValue(levels('0101'))).toBe(5n);
    expect(bitsValue(levels('0X01'))).toBeUndefined();
    expect(bitsValue(levels('Z'))).toBeUndefined();
  });
});

describe('formatLevels', () => {
  it('writes a bit as its letter and buses in hex', () => {
    expect(formatLevels([L1])).toBe('1');
    expect(formatLevels([Z])).toBe('Z');
    expect(formatLevels(levels('0101'))).toBe('0x5');
    expect(formatLevels(levels('00101010'))).toBe('0x2A');
    expect(formatLevels(levels('100101010'))).toBe('0x12A');
  });

  it('writes unknown nibbles as X or Z, and the bits when a nibble is partly known', () => {
    expect(formatLevels(levels('XXXX0101'))).toBe('0xX5');
    expect(formatLevels(levels('ZZZZ0101'))).toBe('0xZ5');
    expect(formatLevels(levels('1X000101'))).toBe('0xX5 (0b1X00_0101)');
    expect(formatLevels(levels('XZXZ0101'))).toBe('0xX5 (0bXZXZ_0101)');
    const wide = levels(`1X${'0'.repeat(16)}`);
    expect(formatLevels(wide)).toBe('0xX0000');
  });
});

describe('formatExpected', () => {
  it('writes values as the actual ones are, don’t care as X', () => {
    expect(formatExpected(expectedBits(1, 1, 'A'))).toBe('1');
    expect(formatExpected(expectedBits('X', 1, 'A'))).toBe('X');
    expect(formatExpected(expectedBits(0x2a, 8, 'D'))).toBe('0x2A');
    expect(formatExpected(expectedBits('0xX5', 8, 'D'))).toBe('0xX5');
    expect(formatExpected(expectedBits('0xZ5', 8, 'D'))).toBe('0xZ5');
    expect(formatExpected(expectedBits('0b1X01', 4, 'D'))).toBe('0b1X01');
    expect(formatExpected(expectedBits('unknown', 8, 'D'))).toBe('unknown');
  });
});
