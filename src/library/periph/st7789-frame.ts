/**
 * What the glass of an ST7789 module shows, from the controller's state: pure, for the drawer
 * and tests. The display modes act here, never on the memory: sleep and display off show the
 * blank page, partial mode blanks the lines outside the partial area, vertical scrolling maps
 * display lines to memory rows, idle mode keeps each channel's top bit, MADCTL's RGB bit swaps
 * red and blue on the way to the panel, and the panels — all "normally black" IPS — show the
 * memory's colors inverted unless inversion is on (every vendor initialization sends INVON and
 * then expects FFFFh to be white). Spec: docs/components.md#st7789.
 */
import { type Controller, PIXEL_X, SHOWN, Unknown } from './st7789-controller';
import { GRAM_HEIGHT, GRAM_WIDTH, type St7789Panel, st7789Glass } from './st7789-panels';

/** The memory doesn't know this pixel ("set randomly" at power-on, an unknown write). */
export const FRAME_UNKNOWN = 1 << 24;
/** The pixel is known, but how it shows isn't (a display mode is unknown): drawn under a veil. */
export const FRAME_UNCERTAIN = 1 << 25;

export interface St7789Frame {
  readonly width: number;
  readonly height: number;
  /** Row by row: `0xRRGGBB` (8 bits a channel) or'ed with `FRAME_UNKNOWN`/`FRAME_UNCERTAIN`. */
  readonly pixels: Uint32Array;
}

/** A 6-bit channel as 8 bits. */
const to8 = (v: number) => (v << 2) | (v >> 4);

/**
 * The memory row each display line shows (vertical scrolling, §8.14, VSCRDEF/VSCSAD), and
 * whether it is undefined there (TFA + VSA + BFA ≠ 320, or the start in a fixed area). With
 * ML = 1 the fixed areas are exchanged (§8.14 Example 2). The defaults (0, 320, 0, start 0) map
 * every line to its own row.
 */
function lineRows(c: Controller): { rows: Int32Array; undefinedScroll: boolean } {
  const rows = new Int32Array(GRAM_HEIGHT);
  let tfa = c.tfa;
  let bfa = c.bfa;
  if (c.madctl & 0x10) [tfa, bfa] = [bfa, tfa];
  const { vsa, vsp } = c;
  const defined = tfa + vsa + bfa === GRAM_HEIGHT && vsa > 0 && vsp >= tfa && vsp < tfa + vsa;
  for (let line = 0; line < GRAM_HEIGHT; line++) {
    rows[line] =
      defined && line >= tfa && line < tfa + vsa ? tfa + ((line - tfa + vsp - tfa) % vsa) : line;
  }
  return { rows, undefinedScroll: !defined };
}

/** Is display `line` inside the partial area (PTLAR; a start past the end wraps around)? */
const inPartial = (c: Controller, line: number) =>
  c.psl <= c.pel ? line >= c.psl && line <= c.pel : line >= c.psl || line <= c.pel;

export function st7789Frame(c: Controller, panel: St7789Panel): St7789Frame {
  const glass = st7789Glass(panel);
  const pixels = new Uint32Array(glass.width * glass.height);
  const uncertainModes = (c.unknown & SHOWN) !== 0;
  const blank = (c.sleep || !c.display) && !(c.unknown & (Unknown.SLEEP | Unknown.DISPLAY));
  if (blank) return { width: glass.width, height: glass.height, pixels };

  const { rows, undefinedScroll } = lineRows(c);
  const swap = (c.madctl & 0x08) !== 0;
  const invert = c.inversion ? 0 : 0x3ffff;
  let i = 0;
  for (let gy = 0; gy < glass.height; gy++) {
    const line = glass.row + gy;
    const shown = !c.partial || inPartial(c, line);
    const rowBase = rows[line]! * GRAM_WIDTH + glass.column;
    const flags = uncertainModes || undefinedScroll ? FRAME_UNCERTAIN : 0;
    for (let gx = 0; gx < glass.width; gx++, i++) {
      if (!shown) {
        pixels[i] = flags;
        continue;
      }
      const word = c.gram[rowBase + gx]!;
      if (word & PIXEL_X) {
        pixels[i] = FRAME_UNKNOWN;
        continue;
      }
      let r = (word >> 12) & 0x3f;
      let g = (word >> 6) & 0x3f;
      let b = word & 0x3f;
      if (c.idle) {
        r = r & 0x20 ? 0x3f : 0;
        g = g & 0x20 ? 0x3f : 0;
        b = b & 0x20 ? 0x3f : 0;
      }
      if (swap) [r, b] = [b, r];
      const out = ((r << 12) | (g << 6) | b) ^ invert;
      pixels[i] =
        (to8((out >> 12) & 0x3f) << 16) | (to8((out >> 6) & 0x3f) << 8) | to8(out & 0x3f) | flags;
    }
  }
  return { width: glass.width, height: glass.height, pixels };
}
