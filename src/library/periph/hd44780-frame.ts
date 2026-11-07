/**
 * What the glass of an HD44780 module shows: per character its 8 rows of 5 dots, from the
 * controller's DDRAM through the character generator (ROM, or CGRAM for codes 0x00–0x0F), with
 * the cursor and the blink — for the drawer, and as text for tests. Pure: no simulator.
 * Spec: docs/components.md#hd44780.
 */
import { type Controller, ddramCell, Unknown } from './hd44780-controller';
import { type Hd44780Size, hd44780Glass, shownCell } from './hd44780-modules';
import { type Hd44780Rom, romRow } from './hd44780-rom';

/** Dot rows per glass character (every module here has 5 × 8 glass). */
export const GLASS_ROWS = 8;

/** One picture of the glass. */
export interface Hd44780Frame {
  readonly columns: number;
  readonly lines: number;
  /** Per character, line by line, `GLASS_ROWS` rows of 5 bits (bit 4 = the leftmost dot). */
  readonly rows: Uint8Array;
  /** Per character: 1 when the controller doesn't know what it shows. */
  readonly unknown: Uint8Array;
}

/**
 * Blink period in ps: the data sheet switches "between all blank dots and displayed characters
 * at 409.6-ms intervals" at 250 kHz (102 400 clocks a phase), so a period is two intervals.
 */
export function blinkPeriod(oscillatorHz: number): number {
  return Math.round((204_800 / oscillatorHz) * 1e12);
}

/** Whether the blinking character shows as all dots on at `time` (the first half of a period). */
export function blinkOn(time: number, oscillatorHz: number): boolean {
  const period = blinkPeriod(oscillatorHz);
  return time % period < period / 2;
}

/** Registers that change what every character shows: unknown → the whole glass unknown. */
const WHOLE_GLASS = Unknown.D | Unknown.N | Unknown.F | Unknown.SHIFT;

/**
 * The glass of a module of `size` driven by `c`. `blink`: the blink's all-on phase. A character
 * is unknown when its code or (CGRAM codes) its pattern has unknown bits, or a register every
 * character depends on is unknown; the cursor's character when the cursor may or may not be on.
 */
export function hd44780Frame(
  c: Controller,
  size: Hd44780Size,
  rom: Hd44780Rom,
  blink: boolean,
): Hd44780Frame {
  const { columns, lines, wiring } = hd44780Glass(size);
  const count = columns * lines;
  const rows = new Uint8Array(count * GLASS_ROWS);
  const unknown = new Uint8Array(count);
  if (c.unknown & WHOLE_GLASS) {
    unknown.fill(1);
    return { columns, lines, rows, unknown };
  }
  if (!c.d) return { columns, lines, rows, unknown };
  // 5 × 10 mode (one line only): CGRAM characters are 16 rows apart; the cursor sits in row 11.
  const tall = c.f && !c.n;
  const cursorCell = c.cg || c.unknown & (Unknown.AC | Unknown.CG) ? -2 : ddramCell(c.ac, c.n);
  const cursorKnown = !(c.unknown & (Unknown.C | Unknown.B));
  for (let i = 0; i < count; i++) {
    const cell = shownCell(wiring[2 * i]!, wiring[2 * i + 1]!, c.n === 1, c.shift);
    if (cell < 0) continue;
    if (c.ddramX[cell]) {
      unknown[i] = 1;
      continue;
    }
    const code = c.ddram[cell]!;
    const at = i * GLASS_ROWS;
    if (code < 0x10) {
      const base = tall ? ((code >> 1) & 3) * 16 : (code & 7) * 8;
      for (let row = 0; row < GLASS_ROWS; row++) {
        if (c.cgramX[base + row]! & 0x1f) unknown[i] = 1;
        rows[at + row] = c.cgram[base + row]! & 0x1f;
      }
    } else {
      for (let row = 0; row < GLASS_ROWS; row++) rows[at + row] = romRow(rom, code, row);
    }
    if (cell !== cursorCell) continue;
    if (!cursorKnown) {
      unknown[i] = 1;
      continue;
    }
    if (c.b && blink) {
      rows.fill(0x1f, at, at + GLASS_ROWS);
    } else if (c.c && !tall) {
      rows[at + GLASS_ROWS - 1] = 0x1f;
    }
  }
  return { columns, lines, rows, unknown };
}

/** Text of the A00 and A02 codes that have one (ASCII range; A00's ¥, arrows, katakana). */
function charText(code: number, rom: Hd44780Rom): string {
  if (code >= 0x20 && code < 0x7e && !(rom === 'A00' && code === 0x5c)) {
    return String.fromCharCode(code);
  }
  if (rom === 'A00') {
    if (code === 0x5c) return '¥';
    if (code === 0x7e) return '→';
    if (code === 0x7f) return '←';
    if (code >= 0xa1 && code <= 0xdf) return String.fromCharCode(0xff61 + code - 0xa1);
  } else if (code === 0x7e) {
    return '~';
  }
  return '·';
}

/**
 * The glass as text, one string per line: what the characters are, not how they look (no
 * cursor or blink). A blank glass (display off, a line not driven) shows spaces, an unknown
 * character `?`, a CGRAM character or one without a text equivalent `·`.
 */
export function hd44780Text(c: Controller, size: Hd44780Size, rom: Hd44780Rom): string[] {
  const { columns, lines, wiring } = hd44780Glass(size);
  const text: string[] = [];
  for (let line = 0; line < lines; line++) {
    let s = '';
    for (let column = 0; column < columns; column++) {
      const i = line * columns + column;
      if (c.unknown & WHOLE_GLASS) {
        s += '?';
        continue;
      }
      const cell = shownCell(wiring[2 * i]!, wiring[2 * i + 1]!, c.n === 1, c.shift);
      if (!c.d || cell < 0) s += ' ';
      else if (c.ddramX[cell]) s += '?';
      else s += c.ddram[cell]! < 0x10 ? '·' : charText(c.ddram[cell]!, rom);
    }
    text.push(s);
  }
  return text;
}
