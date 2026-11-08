import { describe, expect, it } from 'vitest';
import { HD44780_A00, HD44780_A02 } from './hd44780-font';
import type { Hd44780Rom } from './hd44780-rom';
import { isTallPattern, PATTERN_ROWS, romRow } from './hd44780-rom';

/** A pattern drawn as rows of `#` (dot) and `.`, top first. */
function pattern(rom: Hd44780Rom, code: number, rows = 8): string[] {
  return Array.from({ length: rows }, (_, row) => {
    const bits = romRow(rom, code, row);
    return Array.from({ length: 5 }, (_, i) => ((bits >> (4 - i)) & 1 ? '#' : '.')).join('');
  });
}

// Read off the rendered Table 4 of the data sheet (pages 17 and 18) by eye.
describe('HD44780U character generator ROM', () => {
  it('has the A00 digits and letters of Table 4 (slashed zero)', () => {
    expect(pattern('A00', 0x30)).toEqual([
      '.###.',
      '#...#',
      '#..##',
      '#.#.#',
      '##..#',
      '#...#',
      '.###.',
      '.....',
    ]);
    expect(pattern('A00', 0x41)).toEqual([
      '.###.',
      '#...#',
      '#...#',
      '#...#',
      '#####',
      '#...#',
      '#...#',
      '.....',
    ]);
  });

  it('has A00 symbols where ASCII has others: ¥ at 0x5C, arrows at 0x7E and 0x7F', () => {
    expect(pattern('A00', 0x5c)).toEqual([
      '#...#',
      '.#.#.',
      '#####',
      '..#..',
      '#####',
      '..#..',
      '..#..',
      '.....',
    ]);
    expect(pattern('A00', 0x7e)).toEqual([
      '.....',
      '..#..',
      '...#.',
      '#####',
      '...#.',
      '..#..',
      '.....',
      '.....',
    ]);
    expect(pattern('A00', 0x7f).slice(3, 4)).toEqual(['#####']);
  });

  it('has A00 katakana and the degree sign', () => {
    expect(pattern('A00', 0xb1)).toEqual([
      '#####',
      '....#',
      '..#.#',
      '..##.',
      '..#..',
      '..#..',
      '.#...',
      '.....',
    ]);
    expect(pattern('A00', 0xdf).slice(0, 3)).toEqual(['###..', '#.#..', '###..']);
  });

  it('has 5 × 10 patterns for A00 0xE0–0xFF only, with descenders below row 7', () => {
    for (let code = 0; code < 256; code++) {
      expect(isTallPattern('A00', code)).toBe(code >= 0xe0);
      expect(isTallPattern('A02', code)).toBe(false);
    }
    expect(pattern('A00', 0xe7, 10)).toEqual([
      '.....',
      '.....',
      '.####',
      '#...#',
      '#...#',
      '#...#',
      '.####',
      '....#',
      '....#',
      '.###.',
    ]);
    expect(pattern('A00', 0xff, 11)).toEqual([...Array<string>(10).fill('#####'), '.....']);
  });

  it('has the A02 Cyrillic and accented letters, which use the top row', () => {
    expect(pattern('A02', 0x80)).toEqual([
      '.....',
      '#####',
      '#...#',
      '#....',
      '####.',
      '#...#',
      '#...#',
      '####.',
    ]);
    expect(pattern('A02', 0x86)).toEqual([
      '.....',
      '.####',
      '..#.#',
      '..#.#',
      '..#.#',
      '..#.#',
      '#.#.#',
      '.#..#',
    ]);
    expect(pattern('A02', 0x41)[0]).toBe('.....');
  });

  it('leaves the CGRAM codes and the blank columns empty', () => {
    for (const rom of ['A00', 'A02'] as const) {
      for (let code = 0; code < 0x10; code++) {
        for (let row = 0; row < PATTERN_ROWS; row++) expect(romRow(rom, code, row)).toBe(0);
      }
    }
    expect(pattern('A00', 0x10).join('')).toBe('.'.repeat(40));
    expect(pattern('A00', 0x20).join('')).toBe('.'.repeat(40));
    expect(pattern('A00', 0x80).join('')).toBe('.'.repeat(40));
    expect(romRow('A00', 0x41, -1)).toBe(0);
    expect(romRow('A00', 0x41, PATTERN_ROWS)).toBe(0);
  });

  it('keeps every row within 5 bits and one entry per code', () => {
    for (const table of [HD44780_A00, HD44780_A02]) {
      expect(table).toHaveLength(256);
      for (const hex of table) {
        expect(hex).toMatch(/^(?:(?:[01][0-9A-F]){8}|(?:[01][0-9A-F]){11})?$/);
      }
    }
  });
});
