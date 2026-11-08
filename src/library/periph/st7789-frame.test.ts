import { describe, expect, it } from 'vitest';
import { Cmd, Unknown } from './st7789-controller';
import { FRAME_UNCERTAIN, FRAME_UNKNOWN, st7789Frame } from './st7789-frame';
import type { St7789Panel } from './st7789-panels';
import { Fed } from './st7789-test-helpers';

const WHITE = 0xffffff;

/** Awake, display on, 16-bit, the whole memory as the window. */
const awake = (...init: [number, ...number[]][]) => {
  const f = new Fed().command(Cmd.SLPOUT).command(Cmd.DISPON).command(Cmd.COLMOD, 0x55);
  for (const [code, ...params] of init) f.command(code, ...params);
  return f;
};

/** Fills a logical window with one 16-bit color. */
const fill = (f: Fed, xs: number, xe: number, ys: number, ye: number, word: number) => {
  f.window(xs, xe, ys, ye).command(Cmd.RAMWR);
  const count = (xe - xs + 1) * (ye - ys + 1);
  for (let i = 0; i < count; i++) f.data(word >> 8, word & 0xff);
  return f;
};

const frame = (f: Fed, panel: St7789Panel = '240x320') => st7789Frame(f.c, panel);
const at = (f: Fed, x: number, y: number, panel: St7789Panel = '240x320') => {
  const fr = frame(f, panel);
  return fr.pixels[y * fr.width + x]!;
};

describe('ST7789 frame: what the glass shows', () => {
  it('shows the blank page (black) asleep or with the display off, whatever the memory holds', () => {
    const f = new Fed();
    expect(frame(f).pixels.every((p) => p === 0)).toBe(true);
    f.command(Cmd.SLPOUT);
    expect(frame(f).pixels.every((p) => p === 0)).toBe(true); // display still off
  });

  it('shows the memory "set randomly" at power-on as unknown once the display is on', () => {
    const f = awake();
    expect(frame(f).pixels.every((p) => p === FRAME_UNKNOWN)).toBe(true);
  });

  it('inverts the colors on these normally black panels unless INVON was sent', () => {
    const f = fill(awake(), 0, 0, 0, 0, 0xffff);
    expect(at(f, 0, 0)).toBe(0x000000);
    f.command(Cmd.INVON);
    expect(at(f, 0, 0)).toBe(WHITE);
  });

  it('expands 6-bit channels to 8 bits', () => {
    const f = fill(awake([Cmd.INVON], [Cmd.RAMCTRL, 0x00, 0xc0]), 0, 0, 0, 0, 0b10000_100000_00001);
    // EPF 00: R = 100000, G = 100000, B = 000010.
    expect(at(f, 0, 0)).toBe(0x828208);
  });

  it('swaps red and blue with MADCTL RGB = 1, at display time', () => {
    const f = fill(awake([Cmd.INVON]), 0, 0, 0, 0, 0xf800);
    expect(at(f, 0, 0)).toBe(0xf80000 | 0x030000);
    f.command(Cmd.MADCTL, 0x08);
    expect(at(f, 0, 0)).toBe(0x0000fb);
  });

  it('keeps the top bit of each channel in idle mode (8 colors)', () => {
    const f = fill(awake([Cmd.INVON], [Cmd.IDMON]), 0, 0, 0, 0, 0b10000_011111_01111);
    expect(at(f, 0, 0)).toBe(0xff0000);
  });

  it('blanks the lines outside the partial area in partial mode', () => {
    const f = fill(awake([Cmd.INVON]), 0, 239, 0, 319, 0xffff);
    f.command(Cmd.PTLAR, 0, 10, 0, 19).command(Cmd.PTLON);
    expect([at(f, 0, 9), at(f, 0, 10), at(f, 0, 19), at(f, 0, 20)]).toEqual([0, WHITE, WHITE, 0]);
    f.command(Cmd.NORON);
    expect(at(f, 0, 9)).toBe(WHITE);
  });

  it('wraps a partial area that starts past its end', () => {
    const f = fill(awake([Cmd.INVON]), 0, 239, 0, 319, 0xffff);
    f.command(Cmd.PTLAR, 0x01, 0x3a, 0, 4).command(Cmd.PTLON); // 314 to 4
    expect([at(f, 0, 4), at(f, 0, 5), at(f, 0, 313), at(f, 0, 314)]).toEqual([WHITE, 0, 0, WHITE]);
  });

  it('scrolls: the line after the top fixed area shows the start row (§8.14)', () => {
    const f = awake([Cmd.INVON]);
    fill(f, 0, 0, 3, 3, 0xffff); // memory row 3 white
    f.command(Cmd.VSCRDEF, 0, 0, 0x01, 0x40, 0, 0).command(Cmd.VSCSAD, 0, 3);
    expect([at(f, 0, 0), at(f, 0, 317) & FRAME_UNKNOWN]).toEqual([WHITE, FRAME_UNKNOWN]);
    // Fixed areas keep their lines: TFA 3, VSA 315, BFA 2, start 4 (§8.14 Example 1).
    f.command(Cmd.VSCRDEF, 0, 3, 0x01, 0x3b, 0, 2).command(Cmd.VSCSAD, 0, 4);
    fill(f, 0, 0, 0, 0, 0xffff);
    expect(at(f, 0, 0)).toBe(WHITE);
    expect(at(f, 0, 317)).toBe(WHITE); // line 317 → row 3 + (314 + 1) mod 315 = 3
  });

  it('marks the glass uncertain when the scroll areas don’t add up to 320', () => {
    const f = fill(awake([Cmd.INVON]), 0, 0, 0, 0, 0xffff);
    f.command(Cmd.VSCRDEF, 0, 0, 0, 240, 0, 0);
    expect(at(f, 0, 0)).toBe(WHITE | FRAME_UNCERTAIN);
  });

  it('marks known pixels uncertain while a display mode is unknown', () => {
    const f = fill(awake([Cmd.INVON]), 0, 0, 0, 0, 0xffff);
    f.c.unknown |= Unknown.INVERSION;
    expect(at(f, 0, 0)).toBe(WHITE | FRAME_UNCERTAIN);
    expect(at(f, 1, 0)).toBe(FRAME_UNKNOWN);
    f.c.unknown = Unknown.DISPLAY;
    f.command(Cmd.DISPOFF);
    expect(at(f, 0, 0)).toBe(WHITE | FRAME_UNCERTAIN); // may be off, may be on
  });
});

describe('ST7789 frame: panels and their windows', () => {
  it('shows a 135 × 240 panel from columns 52–186, rows 40–279', () => {
    const f = awake([Cmd.INVON]);
    fill(f, 52, 186, 40, 40, 0xffff);
    const fr = frame(f, '135x240');
    expect([fr.width, fr.height]).toEqual([135, 240]);
    expect(fr.pixels.slice(0, 135).every((p) => p === WHITE)).toBe(true);
    expect(fr.pixels[135]).toBe(FRAME_UNKNOWN);
  });

  it('a 240 × 240 panel rotated 180° shows an unknown band without the row offset of 80', () => {
    const f = awake([Cmd.INVON], [Cmd.MADCTL, 0xc0]);
    fill(f, 0, 239, 0, 239, 0xffff); // rows 0–239 land on memory rows 319–80
    const band = frame(f, '240x240').pixels;
    expect(band[0]).toBe(FRAME_UNKNOWN); // glass row 0 = memory row 0: never written
    expect(band[80 * 240]).toBe(WHITE);
    fill(f, 0, 239, 80, 319, 0x001f); // with the offset: the whole glass
    expect(frame(f, '240x240').pixels.every((p) => p === 0x0000fb)).toBe(true);
  });
});
