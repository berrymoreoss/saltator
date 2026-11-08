/**
 * The program of the TFT Color Bars example: SMPTE color bars on an ST7789 240 × 320 module used
 * in landscape, from two EEPROMs a counter steps through, bit by bit, at 500 kHz. Not a test
 * file: the example's generator and its tests share it.
 *
 * The streamer counts SPI bits with two 74HC4040s (b0–b23). A byte is bits b3 and up, so a
 * 74HC165 shifts each EEPROM byte out MSB first. The pixel EEPROM (AT28C256) is addressed
 * A0–A9 = b3–b12 (the byte in a row) and A10–A14 = b16–b20 (a block of 8 rows). Rows are
 * 1024 bytes because CASET opens columns 0–511 and the columns past 319 are "out of range…
 * ignored", so every row of a block reads the same 1 KB. The control EEPROM (AT28C64B, A0–A12 =
 * b3–b15) gives D/CX (D0) and CS̅ (D1) for the bytes of block 0, the initialization. Every
 * other block is pixel data: D/CX = 1, CS̅ = 0.
 *
 * The waits are counted in bytes at the clock: the program is clean at 500 kHz and slower. Run
 * it faster and the module reports the waits broken.
 */

/** The clock the waits are counted for. */
export const TFT_CLOCK_HZ = 500_000;
/** Bytes of a row, the rows of a block, the blocks of a pass (b21 wraps). */
export const ROW_BYTES = 1024;
export const BLOCK_ROWS = 8;
export const BLOCKS = 32;
export const BLOCK_BYTES = ROW_BYTES * BLOCK_ROWS;
export const PASS_BYTES = BLOCK_BYTES * BLOCKS;
export const PIXEL_ROM_BYTES = ROW_BYTES * BLOCKS;
export const CONTROL_ROM_BYTES = BLOCK_BYTES;

/** The picture: 320 × 240 (landscape). */
export const WIDTH = 320;
export const HEIGHT = 240;
/** MADCTL: MX and MV, so logical (column, row) is the picture's (x, y) with the module turned 90° counterclockwise. */
export const MADCTL = 0x60;

/** Control EEPROM bits. */
export const DC_BIT = 0x01;
export const CS_BIT = 0x02;

/**
 * SMPTE EG 1-1990 color bars (4:3): seven 75 % bars over the top two thirds, the reverse
 * "castellations" under them, then −I, 100 % white, +Q, black and the PLUGE (−4 %, 0 %, +4 %
 * around a 7.5 % black). RGB values of the common rendition (Wikimedia Commons,
 * SMPTE_Color_Bars.svg). The bands end on 8-row steps here: rows 0–159, 160–183, 184–239
 * (the standard's 160, 20, 60).
 */
const BARS = [0xc0c0c0, 0xc0c000, 0x00c0c0, 0x00c000, 0xc000c0, 0xc00000, 0x0000c0];
const CASTELLATIONS = [0x0000c0, 0x131313, 0xc000c0, 0x131313, 0x00c0c0, 0x131313, 0xc0c0c0];
const BLACK = 0x131313;
export const BAND_ROWS = { castellations: 160, bottom: 184 } as const;

/** The x where bar `i` starts (bar 7 ends at the width). */
const barStart = (i: number) => Math.round((i * WIDTH) / 7);

/** The bottom band's segments: [start x, color]. */
function bottomSegments(): [number, number][] {
  const w = WIDTH / 7;
  const at = (x: number) => Math.round(x);
  return [
    [0, 0x00214c], // −I
    [at(1.25 * w), 0xffffff],
    [at(2.5 * w), 0x32006a], // +Q
    [at(3.75 * w), BLACK],
    [at(5 * w), 0x090909], // PLUGE −4 %
    [at(5 * w + w / 3), BLACK], // 0 %
    [at(5 * w + (2 * w) / 3), 0x1d1d1d], // +4 %
    [at(6 * w), BLACK],
  ];
}

/** The color of the picture at (x, y), `0xRRGGBB`. */
export function smpte(x: number, y: number): number {
  if (y < BAND_ROWS.bottom) {
    const colors = y < BAND_ROWS.castellations ? BARS : CASTELLATIONS;
    let bar = 6;
    while (bar > 0 && x < barStart(bar)) bar--;
    return colors[bar]!;
  }
  const segments = bottomSegments();
  let i = segments.length - 1;
  while (i > 0 && x < segments[i]![0]) i--;
  return segments[i]![1];
}

/** An `0xRRGGBB` color as RGB 5-6-5. */
export const rgb565 = (c: number) =>
  ((c >> 19) << 11) | (((c >> 10) & 0x3f) << 5) | ((c >> 3) & 0x1f);

/** One step of the initialization: a command and its parameters at a byte of block 0. */
interface Step {
  readonly at: number;
  readonly command: number;
  readonly params: readonly number[];
}

const byteTime = (bytes: number) => (bytes * 8 * 1e12) / TFT_CLOCK_HZ; // ps
const bytesIn = (ps: number) => Math.ceil((ps * TFT_CLOCK_HZ) / (8 * 1e12));

/** SLPOUT 120 ms after RESX rises (Table 9 Note 7), with a margin of about a millisecond. */
export const SLPOUT_AT = bytesIn(121e9);
/** The rest 5 ms after it (SLPOUT restriction), with a margin; RAMWR is block 0's last byte. */
const AFTER_SLPOUT = SLPOUT_AT + 1 + bytesIn(5.2e9);

export function initSteps(): Step[] {
  const steps: Omit<Step, 'at'>[] = [
    { command: 0x3a, params: [0x55] }, // COLMOD: 16 bits a pixel
    { command: 0x36, params: [MADCTL] },
    { command: 0x21, params: [] }, // INVON: these normally black panels need it
    { command: 0x2a, params: [0x00, 0x00, 0x01, 0xff] }, // CASET 0–511 (320–511 ignored)
    { command: 0x2b, params: [0x00, 0x00, 0x00, HEIGHT - 1] }, // RASET 0–239
    { command: 0x29, params: [] }, // DISPON
    { command: 0x2c, params: [] }, // RAMWR: the pixels start with block 1
  ];
  const length = steps.reduce((n, s) => n + 1 + s.params.length, 0);
  let at = BLOCK_BYTES - length;
  if (at < AFTER_SLPOUT)
    throw new Error('tft-program: block 0 is too short for the initialization');
  const placed: Step[] = [{ at: SLPOUT_AT, command: 0x11, params: [] }];
  for (const step of steps) {
    placed.push({ ...step, at });
    at += 1 + step.params.length;
  }
  return placed;
}

/** The two EEPROM images. */
export function colorBarsRoms(): { pixels: Uint8Array; control: Uint8Array } {
  const pixels = new Uint8Array(PIXEL_ROM_BYTES);
  // Deselected unless a step says otherwise.
  const control = new Uint8Array(CONTROL_ROM_BYTES).fill(CS_BIT | DC_BIT);
  for (const step of initSteps()) {
    const bytes = [step.command, ...step.params];
    bytes.forEach((value, i) => {
      const at = step.at + i;
      pixels[at % ROW_BYTES] = value; // block 0: every row reads the same 1 KB
      control[at] = i === 0 ? 0 : DC_BIT;
    });
  }
  // Blocks 1–30 are rows 0–239; block 31 wraps onto rows 0–7 again, so it holds them too.
  for (let block = 1; block < BLOCKS; block++) {
    const row = ((block - 1) * BLOCK_ROWS) % HEIGHT;
    for (let x = 0; x < WIDTH; x++) {
      const word = rgb565(smpte(x, row));
      pixels[block * ROW_BYTES + 2 * x] = word >> 8;
      pixels[block * ROW_BYTES + 2 * x + 1] = word & 0xff;
    }
  }
  // The initialization bytes in block 0's 1 KB must not land where a step reads another.
  for (const step of initSteps()) {
    const offset = step.at % ROW_BYTES;
    if (pixels[offset] !== step.command) throw new Error('tft-program: init bytes overlap');
  }
  return { pixels, control };
}

/** A byte the streamer sends: its value, D/CX, CS̅, in the order of a pass. */
export interface StreamByte {
  readonly value: number;
  readonly dc: 0 | 1;
  readonly cs: 0 | 1;
}

/** The bytes of one pass as the hardware addresses the two EEPROMs. */
export function* streamBytes(roms = colorBarsRoms()): Generator<StreamByte> {
  for (let i = 0; i < PASS_BYTES; i++) {
    const block = Math.floor(i / BLOCK_BYTES);
    const value = roms.pixels[block * ROW_BYTES + (i % ROW_BYTES)]!;
    if (block === 0) {
      const ctl = roms.control[i]!;
      yield { value, dc: ctl & DC_BIT ? 1 : 0, cs: ctl & CS_BIT ? 1 : 0 };
    } else {
      yield { value, dc: 1, cs: 0 };
    }
  }
}

/** When byte `i` of a pass completes (its 8th rising edge), after the counter started. */
export const streamTime = (i: number) => byteTime(i + 1);
