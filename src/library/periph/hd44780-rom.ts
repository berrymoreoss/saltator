/**
 * The HD44780U's character generator ROM (CGROM): the 5 × 8 and 5 × 10 dot patterns of the
 * character codes 0x10–0xFF, in the two ROM codes sold as standard parts. The patterns come from
 * the data sheet's Table 4 (`hd44780-font.ts`, generated). Spec: docs/components.md#hd44780.
 */
import { HD44780_A00, HD44780_A02 } from './hd44780-font';

/** ROM codes: A00 (Japanese standard: ASCII, katakana, Greek), A02 (European standard). */
export const HD44780_ROMS = ['A00', 'A02'] as const;
export type Hd44780Rom = (typeof HD44780_ROMS)[number];

/** Rows kept per pattern: a 5 × 10 pattern's 10 rows and its cursor row. */
export const PATTERN_ROWS = 11;

function decode(table: readonly string[]): Uint8Array {
  const rows = new Uint8Array(256 * PATTERN_ROWS);
  for (let code = 0; code < 256; code++) {
    const hex = table[code] ?? '';
    for (let row = 0; row * 2 < hex.length; row++) {
      rows[code * PATTERN_ROWS + row] = Number.parseInt(hex.slice(row * 2, row * 2 + 2), 16);
    }
  }
  return rows;
}

const PATTERNS: Readonly<Record<Hd44780Rom, Uint8Array>> = {
  A00: decode(HD44780_A00),
  A02: decode(HD44780_A02),
};

const TABLES: Readonly<Record<Hd44780Rom, readonly string[]>> = {
  A00: HD44780_A00,
  A02: HD44780_A02,
};

/**
 * Row `row` (0 = top) of the ROM pattern of `code`: 5 bits, bit 4 the leftmost dot. 0 for rows
 * a pattern doesn't have and for the CGRAM codes 0x00–0x0F (the RAM holds those).
 */
export function romRow(rom: Hd44780Rom, code: number, row: number): number {
  if (row < 0 || row >= PATTERN_ROWS) return 0;
  return PATTERNS[rom][(code & 0xff) * PATTERN_ROWS + row]!;
}

/** Whether the ROM's pattern for `code` is 5 × 10 dots (A00's 0xE0–0xFF). */
export function isTallPattern(rom: Hd44780Rom, code: number): boolean {
  return (TABLES[rom][code & 0xff]?.length ?? 0) > 16;
}
