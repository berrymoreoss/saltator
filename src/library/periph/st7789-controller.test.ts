import { describe, expect, it } from 'vitest';
import { Cmd, gramIndex, PIXEL_X, St7789Diagnostic } from './st7789-controller';
import { GRAM_WIDTH, type St7789Panel, st7789Glass } from './st7789-panels';
import { Fed } from './st7789-test-helpers';

const RED = 0xf800;
const GREEN = 0x07e0;
const BLUE = 0x001f;
const WHITE = 0xffff;
/** R6 G6 B6 of the four with the default EPF (11: R0 = B0 = G0). */
const RED18 = 0x3e << 12;
// G0 = 1 lands in R0 and B0 too: green on an EPF 11 panel isn't quite pure.
const GREEN18 = (1 << 12) | (0x3f << 6) | 1;
const BLUE18 = 0x3e;
const WHITE18 = 0x3ffff;

describe('ST7789 memory writes', () => {
  it('fills the window row by row from RAMWR, then wraps to its start (§8.12)', () => {
    const f = new Fed().command(Cmd.COLMOD, 0x55).window(10, 11, 20, 21);
    f.pixels565(RED, GREEN, BLUE, WHITE, GREEN);
    expect([f.at(10, 20), f.at(11, 20), f.at(10, 21), f.at(11, 21)]).toEqual([
      GREEN18, // the 5th pixel wrapped onto the first
      GREEN18,
      BLUE18,
      WHITE18,
    ]);
    expect(f.at(12, 20)).toBe(PIXEL_X);
    expect(f.warnings).toEqual([]);
  });

  it('WRMEMC continues where the last write stopped; RAMWR starts over', () => {
    const f = new Fed().command(Cmd.COLMOD, 0x55).window(0, 3, 0, 0);
    f.pixels565(RED, RED);
    f.command(Cmd.WRMEMC, BLUE >> 8, BLUE & 0xff);
    expect([f.at(0, 0), f.at(1, 0), f.at(2, 0)]).toEqual([RED18, RED18, BLUE18]);
    f.pixels565(GREEN);
    expect(f.at(0, 0)).toBe(GREEN18);
  });

  it('ignores pixels past the memory but still counts them (CASET restriction)', () => {
    // A 512-wide window: columns 240–511 are out of range, so every row is 1024 bytes.
    const f = new Fed().command(Cmd.COLMOD, 0x55).window(0, 511, 0, 1);
    const row = Array.from({ length: 512 }, (_, i) => (i < 240 ? RED : WHITE));
    f.pixels565(...row, ...row.map(() => BLUE));
    expect(f.at(239, 0)).toBe(RED18);
    expect(f.at(0, 1)).toBe(BLUE18);
    expect(f.at(239, 1)).toBe(BLUE18);
    expect(f.c.gram.filter((w) => w === WHITE18)).toHaveLength(0);
  });

  it('warns about a window that starts past its end and wraps after every pixel', () => {
    const f = new Fed().command(Cmd.COLMOD, 0x55).window(5, 4, 0, 9);
    f.pixels565(RED, GREEN);
    expect(f.warnings).toEqual([St7789Diagnostic.BAD_WINDOW]);
    expect([f.at(5, 0), f.at(5, 1), f.at(6, 0)]).toEqual([RED18, GREEN18, PIXEL_X]);
  });
});

describe('ST7789 address mapping (MADCTL MY MX MV, §8.12 Figure 33)', () => {
  // The host's first pixels (0, 0) and (1, 0) of a 2 × 2 window, where §8.12 draws them.
  it.each([
    ['normal', 0x00, [0, 0], [1, 0]],
    ['Y-mirror', 0x80, [0, 319], [1, 319]],
    ['X-mirror', 0x40, [239, 0], [238, 0]],
    ['X-mirror Y-mirror', 0xc0, [239, 319], [238, 319]],
    ['X-Y exchange', 0x20, [0, 0], [0, 1]],
    ['X-Y exchange Y-mirror', 0xa0, [0, 319], [0, 318]],
    ['X-Y exchange X-mirror', 0x60, [239, 0], [239, 1]],
    ['X-Y exchange X-mirror Y-mirror', 0xe0, [239, 319], [239, 318]],
  ] as const)('%s (%i)', (_, madctl, first, second) => {
    const f = new Fed().command(Cmd.COLMOD, 0x55).command(Cmd.MADCTL, madctl);
    f.window(0, 1, 0, 1).pixels565(RED, GREEN);
    expect(f.at(first[0], first[1])).toBe(RED18);
    expect(f.at(second[0], second[1])).toBe(GREEN18);
  });

  // The vendor programs' offsets per orientation (MSP1141, MSP1308 LCD_direction): with them,
  // the logical screen covers exactly the panel's glass.
  it.each([
    ['135x240', 0x00, 52, 40, 135, 240],
    ['135x240', 0x60, 40, 53, 240, 135],
    ['135x240', 0xc0, 53, 40, 135, 240],
    ['135x240', 0xa0, 40, 52, 240, 135],
    ['240x240', 0x00, 0, 0, 240, 240],
    ['240x240', 0x60, 0, 0, 240, 240],
    ['240x240', 0xc0, 0, 80, 240, 240],
    ['240x240', 0xa0, 80, 0, 240, 240],
  ] as const)(
    '%s MADCTL %i with offsets (%i, %i) lands on the glass',
    (panel, madctl, x0, y0, w, h) => {
      const glass = st7789Glass(panel as St7789Panel);
      for (let row = y0; row < y0 + h; row++) {
        for (let col = x0; col < x0 + w; col++) {
          const at = gramIndex(madctl, col, row);
          const x = at % GRAM_WIDTH;
          const y = Math.floor(at / GRAM_WIDTH);
          const inside =
            x >= glass.column &&
            x < glass.column + glass.width &&
            y >= glass.row &&
            y < glass.row + glass.height;
          if (!inside) throw new Error(`(${col}, ${row}) → (${x}, ${y}) is off the glass`);
        }
      }
    },
  );
});

describe('ST7789 color formats (§8.8.40–43, RAMCTRL EPF)', () => {
  it('16-bit: R0 and B0 follow EPF (default 11: G0)', () => {
    const cases: [number, number][] = [
      [0x00, 0], // EPF 00: 0
      [0x10, 1], // EPF 01: 1
      [0x20, 2], // EPF 10: the channel's MSB
      [0x30, 3], // EPF 11: G0
    ];
    for (const [epf] of cases) {
      const f = new Fed().command(Cmd.COLMOD, 0x55).command(Cmd.RAMCTRL, 0x00, 0xc0 | epf);
      // R = 10000, G = 000001, B = 00001.
      f.window(0, 0, 0, 0).pixels565(0b10000_000001_00001);
      const r = f.at(0, 0) >> 12;
      const b = f.at(0, 0) & 0x3f;
      const lsb = [0, 1, 1, 1][epf >> 4]!; // 00: 0, 01: 1, 10: MSBs (1, 0), 11: G0 = 1
      expect(r & 1, `EPF ${epf >> 4} R0`).toBe(lsb);
      expect(b & 1, `EPF ${epf >> 4} B0`).toBe(epf >> 4 === 2 ? 0 : lsb);
      expect((f.at(0, 0) >> 6) & 0x3f).toBe(1);
    }
  });

  it('12-bit: two pixels in three bytes, each 4-bit channel repeated into 6', () => {
    const f = new Fed().command(Cmd.COLMOD, 0x53).window(0, 1, 0, 0);
    f.command(Cmd.RAMWR, 0xf0, 0x0a, 0x5f); // (F, 0, 0) then (A, 5, F)
    expect(f.at(0, 0)).toBe(0x3f << 12);
    expect(f.at(1, 0)).toBe((0b101010 << 12) | (0b010101 << 6) | 0x3f);
  });

  it('18-bit and 16M truncated: three bytes, the top 6 bits of each', () => {
    for (const colmod of [0x66, 0x67]) {
      const f = new Fed().command(Cmd.COLMOD, colmod).window(0, 0, 0, 0);
      f.command(Cmd.RAMWR, 0xfc, 0x83, 0x07);
      expect(f.at(0, 0), `COLMOD ${colmod}`).toBe((0x3f << 12) | (0x20 << 6) | 0x01);
    }
  });

  it('an undefined format makes the window unknown, with a warning', () => {
    const f = new Fed().command(Cmd.COLMOD, 0x55).window(0, 1, 0, 0).pixels565(RED, RED);
    f.command(Cmd.COLMOD, 0x51).command(Cmd.RAMWR, 0x12);
    expect([f.at(0, 0), f.at(1, 0)]).toEqual([PIXEL_X, PIXEL_X]);
    expect(f.warnings).toEqual([St7789Diagnostic.BAD_FORMAT]);
  });
});
