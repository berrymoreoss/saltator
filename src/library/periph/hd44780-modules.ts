/**
 * Character LCD modules built on one HD44780U: their sizes and how the glass is wired to the
 * controller. The controller drives two lines (common groups) of up to 40 characters; a module
 * puts its glass characters on those lines' segment columns. Spec: docs/components.md#hd44780.
 */

/** Module sizes, columns × lines as the industry names them (`16x2` = 1602). */
export const HD44780_SIZES = [
  '8x1',
  '8x2',
  '16x1',
  '16x1-8x2',
  '16x2',
  '16x4',
  '20x1',
  '20x2',
  '20x4',
  '24x1',
  '24x2',
  '40x1',
  '40x2',
] as const;
export type Hd44780Size = (typeof HD44780_SIZES)[number];

/** Option labels for the `size` prop. */
export const HD44780_SIZE_LABELS: Readonly<Record<Hd44780Size, string>> = {
  '8x1': '8 × 1',
  '8x2': '8 × 2',
  '16x1': '16 × 1',
  '16x1-8x2': '16 × 1 (addressed as 8 × 2)',
  '16x2': '16 × 2',
  '16x4': '16 × 4',
  '20x1': '20 × 1',
  '20x2': '20 × 2',
  '20x4': '20 × 4',
  '24x1': '24 × 1',
  '24x2': '24 × 2',
  '40x1': '40 × 1',
  '40x2': '40 × 2',
};

/** The glass of a module: its characters and the controller line and segment column of each. */
export interface Hd44780Glass {
  readonly columns: number;
  readonly lines: number;
  /**
   * Per glass character, line by line: the controller line it is on (0: COM1–8, 1: COM9–16) at
   * `2 · i` and its segment column (0 …) at `2 · i + 1`.
   */
  readonly wiring: Uint8Array;
}

function glassOf(size: Hd44780Size): Hd44780Glass {
  const [columns, lines] = size.split('-')[0]!.split('x').map(Number) as [number, number];
  const wiring = new Uint8Array(columns * lines * 2);
  for (let line = 0; line < lines; line++) {
    for (let column = 0; column < columns; column++) {
      const i = line * columns + column;
      let com: number;
      let segment: number;
      if (size === '16x1-8x2') {
        // One line of glass on both controller lines: the right half is the second line.
        com = column < 8 ? 0 : 1;
        segment = column % 8;
      } else if (lines === 4) {
        // Lines 3 and 4 continue lines 1 and 2 (DDRAM 0x14, 0x54 on a 20 × 4).
        com = line & 1;
        segment = (line >> 1) * columns + column;
      } else {
        com = line;
        segment = column;
      }
      wiring[2 * i] = com;
      wiring[2 * i + 1] = segment;
    }
  }
  return { columns, lines, wiring };
}

const GLASSES = new Map<Hd44780Size, Hd44780Glass>(HD44780_SIZES.map((s) => [s, glassOf(s)]));

/** The glass of a module size. */
export function hd44780Glass(size: Hd44780Size): Hd44780Glass {
  return GLASSES.get(size)!;
}

/**
 * The DDRAM cell (0–79) a glass character shows, or -1 when its line isn't driven: with two
 * lines (`N = 1`) each line is 40 cells from DDRAM 0x00 and 0x40, with one line (`N = 0`) line 1
 * is 80 cells from 0x00 and line 2 stays blank. The display shift moves every line together.
 */
export function shownCell(com: number, segment: number, twoLines: boolean, shift: number): number {
  if (twoLines) return com * 40 + ((((shift + segment) % 40) + 40) % 40);
  if (com !== 0) return -1;
  return (((shift + segment) % 80) + 80) % 80;
}
