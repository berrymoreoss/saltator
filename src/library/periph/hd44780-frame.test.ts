import { describe, expect, it } from 'vitest';
import { ms } from '../../core';
import { createController, ddramCell, SPACE, Unknown } from './hd44780-controller';
import { blinkOn, blinkPeriod, hd44780Frame, hd44780Text } from './hd44780-frame';
import { HD44780_SIZES, type Hd44780Size } from './hd44780-modules';

/** The DDRAM address each glass line starts at, as module data sheets list them. */
const LINE_STARTS: Readonly<Record<Hd44780Size, readonly number[]>> = {
  '8x1': [0x00],
  '8x2': [0x00, 0x40],
  '16x1': [0x00],
  '16x1-8x2': [0x00], // and 0x40 from column 8 on
  '16x2': [0x00, 0x40],
  '16x4': [0x00, 0x40, 0x10, 0x50],
  '20x1': [0x00],
  '20x2': [0x00, 0x40],
  '20x4': [0x00, 0x40, 0x14, 0x54],
  '24x1': [0x00],
  '24x2': [0x00, 0x40],
  '40x1': [0x00],
  '40x2': [0x00, 0x40],
};

/** The address glass position (line, column) shows, unshifted. */
function addressOf(size: Hd44780Size, line: number, column: number): number {
  if (size === '16x1-8x2') return column < 8 ? column : 0x40 + column - 8;
  return LINE_STARTS[size][line]! + column;
}

/** A ready controller (display on) in the mode the module needs. */
function ready(twoLines: boolean) {
  const c = createController('reset', 0);
  c.d = 1;
  c.n = twoLines ? 1 : 0;
  return c;
}

const printable = (i: number) => String.fromCharCode(0x21 + i + (i >= 59 ? 1 : 0)); // skip ¥

describe('HD44780 glass wiring', () => {
  it.each(HD44780_SIZES)('%s shows the DDRAM addresses its data sheet lists', (size) => {
    const lines = LINE_STARTS[size].length === 1 && size !== '16x1-8x2' ? 1 : 2;
    const c = ready(lines === 2 || size === '16x1-8x2');
    const [columns, glassLines] = size.split('-')[0]!.split('x').map(Number) as [number, number];
    const expected: string[] = [];
    let n = 0;
    for (let line = 0; line < glassLines; line++) {
      let text = '';
      for (let column = 0; column < columns; column++) {
        const ch = printable(n++);
        c.ddram[ddramCell(addressOf(size, line, column), c.n)] = ch.charCodeAt(0);
        text += ch;
      }
      expected.push(text);
    }
    expect(hd44780Text(c, size, 'A00')).toEqual(expected);
  });

  it('shifts every line together, 40 cells round in 2-line mode', () => {
    const c = ready(true);
    for (let i = 0; i < 40; i++) {
      c.ddram[i] = 0x41 + (i % 26);
      c.ddram[40 + i] = 0x61 + (i % 26);
    }
    c.shift = 1;
    expect(hd44780Text(c, '16x2', 'A00')).toEqual(['BCDEFGHIJKLMNOPQ', 'bcdefghijklmnopq']);
    c.shift = 79; // one to the right: column 0 shows address 0x27
    expect(hd44780Text(c, '16x2', 'A00')[0]).toBe('NABCDEFGHIJKLMNO');
    c.shift = 1;
    // On a 20 × 4, line 3 is line 1 from column 20: cells 21–39, then round to 0.
    expect(hd44780Text(c, '20x4', 'A00')[2]).toBe('VWXYZABCDEFGHIJKLMNA');
  });

  it('runs one line of 80 in 1-line mode and leaves line 2 of the glass blank', () => {
    const c = ready(false);
    c.ddram[79] = 0x5a;
    c.ddram[0] = 0x41;
    c.shift = 79;
    expect(hd44780Text(c, '16x2', 'A00')).toEqual([`ZA${' '.repeat(14)}`, ' '.repeat(16)]);
    // The half-and-half 16 × 1 shows only its left half in 1-line mode.
    c.shift = 0;
    for (let i = 0; i < 16; i++) c.ddram[i] = 0x41 + i;
    expect(hd44780Text(c, '16x1-8x2', 'A00')).toEqual([`ABCDEFGH${' '.repeat(8)}`]);
  });
});

describe('HD44780 frame', () => {
  it('draws ROM patterns, CGRAM patterns, the cursor and the blink', () => {
    const c = ready(true);
    c.ddram[0] = 0x41;
    c.ddram[1] = 0x02;
    c.cgram.fill(0, 16, 24);
    c.cgramX.fill(0, 16, 24);
    c.cgram[16] = 0x1f;
    c.cgram[23] = 0xe1; // only the low 5 bits show
    c.ac = 1;
    c.c = 1;
    const f = hd44780Frame(c, '16x2', 'A00', false);
    expect([...f.rows.slice(0, 8)]).toEqual([0x0e, 0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x00]);
    expect([...f.rows.slice(8, 16)]).toEqual([0x1f, 0, 0, 0, 0, 0, 0, 0x1f]); // cursor in row 8
    c.b = 1;
    expect([...hd44780Frame(c, '16x2', 'A00', true).rows.slice(8, 16)]).toEqual(Array(8).fill(31));
    // At a CGRAM address the cursor is "meaningless": not drawn.
    c.cg = 1;
    expect(hd44780Frame(c, '16x2', 'A00', true).rows[15]).toBe(0x01);
  });

  it('marks unknown characters, unknown CGRAM rows and an unknown cursor', () => {
    const c = ready(true);
    c.ddramX[2] = 0x01;
    c.ddram[3] = 0x05; // CGRAM 5: unknown at power-on
    c.ac = 4;
    c.unknown |= Unknown.C;
    const f = hd44780Frame(c, '16x2', 'A00', false);
    expect([...f.unknown.slice(0, 6)]).toEqual([0, 0, 1, 1, 1, 0]);
    expect(hd44780Text(c, '16x2', 'A00')[0]!.slice(0, 5)).toBe('  ?· ');
    c.unknown |= Unknown.D;
    expect(hd44780Frame(c, '16x2', 'A00', false).unknown.every((u) => u === 1)).toBe(true);
    expect(hd44780Text(c, '8x1', 'A00')).toEqual(['????????']);
  });

  it('shows nothing with the display off, and spaces where the controller cleared', () => {
    const c = ready(true);
    c.ddram[0] = 0x41;
    c.d = 0;
    const f = hd44780Frame(c, '16x2', 'A00', false);
    expect(f.rows.every((r) => r === 0)).toBe(true);
    expect(c.ddram[1]).toBe(SPACE);
  });

  it('maps A00 text: ¥, arrows, katakana; A02 has a backslash', () => {
    const c = ready(true);
    [0x5c, 0x7e, 0x7f, 0xb1, 0xe0].forEach((code, i) => {
      c.ddram[i] = code;
    });
    expect(hd44780Text(c, '8x2', 'A00')[0]).toBe('¥→←ｱ·   ');
    expect(hd44780Text(c, '8x2', 'A02')[0]).toBe('\\~···   ');
  });

  it('blinks every 409.6 ms at 250 kHz (an 819.2 ms period)', () => {
    expect(blinkPeriod(250_000)).toBe(ms(819.2));
    expect(blinkOn(ms(400), 250_000)).toBe(true);
    expect(blinkOn(ms(410), 250_000)).toBe(false);
    expect(blinkOn(ms(820), 250_000)).toBe(true);
  });
});
