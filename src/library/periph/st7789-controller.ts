/**
 * The ST7789V controller at command level, as plain data and functions on it (the simulator
 * snapshots the state; the drawer and tests read it): the command decoder with every command's
 * parameter count (Sitronix ST7789V V1.3, §9.1 and §9.2), the registers that change what the
 * glass shows, the frame memory, the resets. The serial interface that delivers the bytes lives
 * in `st7789.ts`. Spec: docs/components.md#st7789.
 */
import { formatTime, type Time } from '../../core';
import { GRAM_HEIGHT, GRAM_WIDTH } from './st7789-panels';

export const St7789Diagnostic = {
  /** A command the data sheet doesn't define (`D6h`): ignored with its parameters. */
  UNKNOWN_COMMAND: 'unknown-command',
  /** A read command: the module would drive SDA now, which the simulator doesn't model. */
  READ: 'read-not-simulated',
  /** A data byte no command takes (after a command's last parameter, or before any command). */
  STRAY_DATA: 'stray-data',
  /** A memory write with XS > XE or YS > YE ("XS must always be equal to or less than XE"). */
  BAD_WINDOW: 'bad-window',
  /** COLMOD's interface format is none of 12, 16 or 18 bits per pixel: what a write does is unknown. */
  BAD_FORMAT: 'bad-format',
  /** CS rose in the middle of a byte: the bits so far are dropped (§8.5). */
  PARTIAL_BYTE: 'partial-byte',
} as const;

export type Reporter = (kind: string, message: string) => void;

/** Commands (§9.1 System Function Command Table 1, §9.2 Table 2). */
export const Cmd = {
  NOP: 0x00,
  SWRESET: 0x01,
  SLPIN: 0x10,
  SLPOUT: 0x11,
  PTLON: 0x12,
  NORON: 0x13,
  INVOFF: 0x20,
  INVON: 0x21,
  DISPOFF: 0x28,
  DISPON: 0x29,
  CASET: 0x2a,
  RASET: 0x2b,
  RAMWR: 0x2c,
  PTLAR: 0x30,
  VSCRDEF: 0x33,
  MADCTL: 0x36,
  VSCSAD: 0x37,
  IDMOFF: 0x38,
  IDMON: 0x39,
  COLMOD: 0x3a,
  WRMEMC: 0x3c,
  RAMCTRL: 0xb0,
} as const;

/** A parameter count for a command whose data runs until the next command (memory writes). */
export const STREAM = -1;

interface CommandInfo {
  readonly name: string;
  /** Parameters it takes (write commands), or `STREAM`. */
  readonly params: number;
  /** A read: the module answers on SDA. */
  readonly read?: true;
}

const write = (name: string, params: number): CommandInfo => ({ name, params });
const read = (name: string): CommandInfo => ({ name, params: 0, read: true });

/**
 * Every command of the data sheet with the number of parameter rows its table shows. The ones
 * without an effect on the glass (porches, gate and power settings, gamma, CABC, NVM) are
 * accepted and their parameters counted, so the bytes after them are taken as theirs.
 */
export const COMMANDS: ReadonlyMap<number, CommandInfo> = new Map<number, CommandInfo>([
  [0x00, write('NOP', 0)],
  [0x01, write('SWRESET', 0)],
  [0x04, read('RDDID')],
  [0x09, read('RDDST')],
  [0x0a, read('RDDPM')],
  [0x0b, read('RDDMADCTL')],
  [0x0c, read('RDDCOLMOD')],
  [0x0d, read('RDDIM')],
  [0x0e, read('RDDSM')],
  [0x0f, read('RDDSDR')],
  [0x10, write('SLPIN', 0)],
  [0x11, write('SLPOUT', 0)],
  [0x12, write('PTLON', 0)],
  [0x13, write('NORON', 0)],
  [0x20, write('INVOFF', 0)],
  [0x21, write('INVON', 0)],
  [0x26, write('GAMSET', 1)],
  [0x28, write('DISPOFF', 0)],
  [0x29, write('DISPON', 0)],
  [0x2a, write('CASET', 4)],
  [0x2b, write('RASET', 4)],
  [0x2c, write('RAMWR', STREAM)],
  [0x2e, read('RAMRD')],
  [0x30, write('PTLAR', 4)],
  [0x33, write('VSCRDEF', 6)],
  [0x34, write('TEOFF', 0)],
  [0x35, write('TEON', 1)],
  [0x36, write('MADCTL', 1)],
  [0x37, write('VSCSAD', 2)],
  [0x38, write('IDMOFF', 0)],
  [0x39, write('IDMON', 0)],
  [0x3a, write('COLMOD', 1)],
  [0x3c, write('WRMEMC', STREAM)],
  [0x3e, read('RDMEMC')],
  [0x44, write('STE', 2)],
  [0x45, read('GSCAN')],
  [0x51, write('WRDISBV', 1)],
  [0x52, read('RDDISBV')],
  [0x53, write('WRCTRLD', 1)],
  [0x54, read('RDCTRLD')],
  [0x55, write('WRCACE', 1)],
  [0x56, read('RDCABC')],
  [0x5e, write('WRCABCMB', 1)],
  [0x5f, read('RDCABCMB')],
  [0x68, read('RDABCSDR')],
  [0xb0, write('RAMCTRL', 2)],
  [0xb1, write('RGBCTRL', 3)],
  [0xb2, write('PORCTRL', 5)],
  [0xb3, write('FRCTRL1', 3)],
  [0xb5, write('PARCTRL', 1)],
  [0xb7, write('GCTRL', 1)],
  [0xb8, write('GTADJ', 4)],
  [0xba, write('DGMEN', 1)],
  [0xbb, write('VCOMS', 1)],
  [0xc0, write('LCMCTRL', 1)],
  [0xc1, write('IDSET', 3)],
  [0xc2, write('VDVVRHEN', 2)],
  [0xc3, write('VRHS', 1)],
  [0xc4, write('VDVS', 1)],
  [0xc5, write('VCMOFSET', 1)],
  [0xc6, write('FRCTRL2', 1)],
  [0xc7, write('CABCCTRL', 1)],
  [0xc8, write('REGSEL1', 1)],
  [0xca, write('REGSEL2', 1)],
  [0xcc, write('PWMFRSEL', 1)],
  [0xd0, write('PWCTRL1', 2)],
  [0xd2, write('VAPVANEN', 1)],
  [0xda, read('RDID1')],
  [0xdb, read('RDID2')],
  [0xdc, read('RDID3')],
  [0xdf, write('CMD2EN', 4)],
  [0xe0, write('PVGAMCTRL', 14)],
  [0xe1, write('NVGAMCTRL', 14)],
  [0xe2, write('DGMLUTR', 64)],
  [0xe3, write('DGMLUTB', 64)],
  [0xe4, write('GATECTRL', 3)],
  [0xe7, write('SPI2EN', 1)],
  [0xe8, write('PWCTRL2', 1)],
  [0xe9, write('EQCTRL', 3)],
  [0xec, write('PROMCTRL', 1)],
  [0xfa, write('PROMEN', 4)],
  [0xfc, write('NVMSET', 2)],
  [0xfe, write('PROMACT', 2)],
]);

/** No command is taking data (after a reset, a read, an unknown command's bytes run out). */
const NONE = -1;

/** A frame memory word: R6 G6 B6 in bits 17–0 and this flag when the pixel is unknown. */
export const PIXEL_X = 1 << 18;

/** The controller's state: plain data (snapshots copy it), typed arrays for the memory. */
export interface Controller {
  /** 1 in sleep-in mode (SLPIN), 0 after SLPOUT. */
  sleep: number;
  /** 1 after DISPON. */
  display: number;
  /** 1 after INVON. */
  inversion: number;
  /** 1 after IDMON (8 colors). */
  idle: number;
  /** 1 after PTLON, 0 after NORON. */
  partial: number;
  /** COLMOD's parameter. */
  colmod: number;
  /** MADCTL's parameter: MY MX MV ML RGB MH – –. */
  madctl: number;
  /** The column window (CASET). */
  xs: number;
  xe: number;
  /** The row window (RASET). */
  ys: number;
  ye: number;
  /** The partial area (PTLAR). */
  psl: number;
  pel: number;
  /** The scroll areas (VSCRDEF) and the scroll start (VSCSAD). */
  tfa: number;
  vsa: number;
  bfa: number;
  vsp: number;
  /** RAMCTRL's two parameters. */
  ramctrl1: number;
  ramctrl2: number;
  /** The command taking the data bytes, `NONE`, or a read/unknown command swallowing them. */
  cmd: number;
  /** Index of the next parameter of `cmd`. */
  param: number;
  /** 1 while the bytes are a read's or an unknown command's: ignored until the next command. */
  ignore: number;
  /** The column and row counters of a memory write (logical: before MADCTL's mapping). */
  col: number;
  row: number;
  /** Bytes of the pixel (or pixel pair, 12-bit) collected so far, and their bits. */
  phase: number;
  acc: number;
  /** Frame memory, `GRAM_WIDTH × GRAM_HEIGHT` words row by row (see `PIXEL_X`). */
  gram: Uint32Array;
  /** Counts every change the glass could show, so a drawer can cache its frame. */
  version: number;
}

/** The registers at power-on and after a hardware reset (each command's "Default" table). */
function setHardwareDefaults(c: Controller): void {
  c.colmod = 0x06; // "18 bit/pixel" (RDDCOLMOD: 0000 0110)
  c.madctl = 0x00;
  setSoftwareDefaults(c);
}

/** What `SWRESET` sets: COLMOD and MADCTL keep their values ("No change"). */
function setSoftwareDefaults(c: Controller): void {
  c.sleep = 1;
  c.display = 0;
  c.inversion = 0;
  c.idle = 0;
  c.partial = 0;
  // The window's ends follow MV: with rows and columns exchanged it is 320 wide (CASET, RASET).
  const mv = (c.madctl & 0x20) !== 0;
  c.xs = 0;
  c.xe = (mv ? GRAM_HEIGHT : GRAM_WIDTH) - 1;
  c.ys = 0;
  c.ye = (mv ? GRAM_WIDTH : GRAM_HEIGHT) - 1;
  c.psl = 0;
  c.pel = GRAM_HEIGHT - 1;
  c.tfa = 0;
  c.vsa = GRAM_HEIGHT;
  c.bfa = 0;
  c.vsp = 0;
  c.ramctrl1 = 0x00;
  c.ramctrl2 = 0xf0;
  c.cmd = NONE;
  c.param = 0;
  c.ignore = 0;
  c.col = 0;
  c.row = 0;
  c.phase = 0;
  c.acc = 0;
  c.version++;
}

/** The controller at power-on: the defaults, the frame memory "set randomly" (unknown). */
export function createController(): Controller {
  const c: Controller = {
    sleep: 1,
    display: 0,
    inversion: 0,
    idle: 0,
    partial: 0,
    colmod: 0,
    madctl: 0,
    xs: 0,
    xe: 0,
    ys: 0,
    ye: 0,
    psl: 0,
    pel: 0,
    tfa: 0,
    vsa: 0,
    bfa: 0,
    vsp: 0,
    ramctrl1: 0,
    ramctrl2: 0,
    cmd: NONE,
    param: 0,
    ignore: 0,
    col: 0,
    row: 0,
    phase: 0,
    acc: 0,
    gram: new Uint32Array(GRAM_WIDTH * GRAM_HEIGHT).fill(PIXEL_X),
    version: 0,
  };
  setHardwareDefaults(c);
  return c;
}

/** RESX held LOW long enough: the registers' hardware defaults; the memory is "not cleared". */
export function hardwareReset(c: Controller): void {
  setHardwareDefaults(c);
}

/** One byte off the serial interface. `dc`: 0 a command, 1 a parameter or memory data. */
export function receiveByte(
  c: Controller,
  now: Time,
  dc: 0 | 1,
  value: number,
  report: Reporter,
): void {
  if (dc === 0) command(c, now, value, report);
  else data(c, value, report);
}

function command(c: Controller, now: Time, code: number, report: Reporter): void {
  const info = COMMANDS.get(code);
  c.cmd = code;
  c.param = 0;
  c.ignore = 0;
  if (info === undefined) {
    report(
      St7789Diagnostic.UNKNOWN_COMMAND,
      `command ${hex(code)} at ${formatTime(now)} is not in the ST7789V data sheet: ignored with its parameters`,
    );
    c.ignore = 1;
    return;
  }
  if (info.read) {
    report(
      St7789Diagnostic.READ,
      `${info.name} (${hex(code)}) is a read: the module would drive SDA now (reads are not simulated)`,
    );
    c.ignore = 1;
    return;
  }
  switch (code) {
    case Cmd.SWRESET:
      setSoftwareDefaults(c);
      break;
    case Cmd.SLPIN:
      set(c, 'sleep', 1);
      break;
    case Cmd.SLPOUT:
      set(c, 'sleep', 0);
      break;
    case Cmd.PTLON:
      set(c, 'partial', 1);
      break;
    case Cmd.NORON:
      set(c, 'partial', 0);
      break;
    case Cmd.INVOFF:
      set(c, 'inversion', 0);
      break;
    case Cmd.INVON:
      set(c, 'inversion', 1);
      break;
    case Cmd.DISPOFF:
      set(c, 'display', 0);
      break;
    case Cmd.DISPON:
      set(c, 'display', 1);
      break;
    case Cmd.IDMOFF:
      set(c, 'idle', 0);
      break;
    case Cmd.IDMON:
      set(c, 'idle', 1);
      break;
    case Cmd.RAMWR:
      // "The column and the page register are reset to the start column/start page."
      c.col = c.xs;
      c.row = c.ys;
      c.phase = 0;
      checkWindow(c, now, report);
      break;
    case Cmd.WRMEMC:
      // Continues from where the last write left the counters; a pixel begins afresh.
      c.phase = 0;
      checkWindow(c, now, report);
      break;
  }
  if (info.params === 0) c.cmd = NONE;
}

type Flag = 'sleep' | 'display' | 'inversion' | 'idle' | 'partial';

function set(c: Controller, flag: Flag, value: number): void {
  if (c[flag] === value) return;
  c[flag] = value;
  c.version++;
}

function data(c: Controller, value: number, report: Reporter): void {
  if (c.ignore) return;
  const info = c.cmd === NONE ? undefined : COMMANDS.get(c.cmd);
  if (info === undefined || (info.params !== STREAM && c.param >= info.params)) {
    report(
      St7789Diagnostic.STRAY_DATA,
      info === undefined
        ? `data byte ${hex(value)} with no command before it: ignored`
        : `data byte ${hex(value)} after the last parameter of ${info.name}: ignored`,
    );
    return;
  }
  const index = c.param++;
  if (info.params === STREAM) memoryByte(c, value, index, report);
  else parameter(c, index, value);
}

/** Stores parameter `index` of the current command as it arrives (§8.5: sent ones stand). */
function parameter(c: Controller, index: number, value: number): void {
  switch (c.cmd) {
    case Cmd.CASET:
      if (index < 2) c.xs = word(c.xs, index, value);
      else c.xe = word(c.xe, index - 2, value);
      break;
    case Cmd.RASET:
      if (index < 2) c.ys = word(c.ys, index, value);
      else c.ye = word(c.ye, index - 2, value);
      break;
    case Cmd.PTLAR:
      if (index < 2) c.psl = word(c.psl, index, value);
      else c.pel = word(c.pel, index - 2, value);
      break;
    case Cmd.VSCRDEF:
      if (index < 2) c.tfa = word(c.tfa, index, value);
      else if (index < 4) c.vsa = word(c.vsa, index - 2, value);
      else c.bfa = word(c.bfa, index - 4, value);
      break;
    case Cmd.VSCSAD:
      c.vsp = word(c.vsp, index, value);
      break;
    case Cmd.MADCTL:
      c.madctl = value;
      break;
    case Cmd.COLMOD:
      c.colmod = value;
      break;
    case Cmd.RAMCTRL:
      if (index === 0) c.ramctrl1 = value;
      else c.ramctrl2 = value;
      break;
    default:
      return; // accepted, no effect on the glass
  }
  c.version++;
}

function checkWindow(c: Controller, now: Time, report: Reporter): void {
  if (c.xs <= c.xe && c.ys <= c.ye) return;
  report(
    St7789Diagnostic.BAD_WINDOW,
    `memory write at ${formatTime(now)} with columns ${c.xs}–${c.xe}, rows ${c.ys}–${c.ye}: the start must not be past the end`,
  );
}

/** COLMOD's control interface format (D2–D0). */
export const Format = {
  RGB444: 0b011,
  RGB565: 0b101,
  RGB666: 0b110,
  /** "16M truncated": 3 bytes, each truncated to 6 bits, as RGB666. */
  RGB888: 0b111,
} as const;

/** A 4-bit channel as 6 bits: the data sheet's 4K look-up table isn't given (our choice). */
const from4 = (v: number) => (v << 2) | (v >> 2);

const rgb444 = (r: number, g: number, b: number) => (from4(r) << 12) | (from4(g) << 6) | from4(b);

/** An RGB 5-6-5 word as R6 G6 B6: R0 and B0 from RAMCTRL's EPF (p. 259). */
function rgb565(c: Controller, word: number): number {
  const r5 = word >> 11;
  const g6 = (word >> 5) & 0x3f;
  const b5 = word & 0x1f;
  let r0: number;
  let b0: number;
  switch ((c.ramctrl2 >> 4) & 3) {
    case 0:
      r0 = 0;
      b0 = 0;
      break;
    case 1:
      r0 = 1;
      b0 = 1;
      break;
    case 2:
      r0 = r5 >> 4;
      b0 = b5 >> 4;
      break;
    default:
      r0 = g6 & 1;
      b0 = g6 & 1;
  }
  return (((r5 << 1) | r0) << 12) | (g6 << 6) | ((b5 << 1) | b0);
}

/** One byte of memory data after RAMWR/WRMEMC (`index`: its position in the stream). */
function memoryByte(c: Controller, value: number, index: number, report: Reporter): void {
  switch (c.colmod & 7) {
    case Format.RGB444:
      // R1 G1 | B1 R2 | G2 B2: the first pixel is complete with the second byte's high nibble.
      if (c.phase === 0) {
        c.acc = value;
        c.phase = 1;
      } else if (c.phase === 1) {
        writePixel(c, rgb444(c.acc >> 4, c.acc & 0xf, value >> 4));
        c.acc = value & 0xf;
        c.phase = 2;
      } else {
        writePixel(c, rgb444(c.acc, value >> 4, value & 0xf));
        c.phase = 0;
      }
      return;
    case Format.RGB565:
      if (c.phase === 0) {
        c.acc = value;
        c.phase = 1;
      } else {
        writePixel(c, rgb565(c, (c.acc << 8) | value));
        c.phase = 0;
      }
      return;
    case Format.RGB666:
    case Format.RGB888:
      c.acc = (c.acc << 6) | (value >> 2);
      if (++c.phase < 3) return;
      writePixel(c, c.acc & 0x3ffff);
      c.acc = 0;
      c.phase = 0;
      return;
    default:
      // How many bytes make a pixel is unknown: anything in the window may have been written.
      if (index === 0) {
        report(
          St7789Diagnostic.BAD_FORMAT,
          `COLMOD ${hex(c.colmod)} has no 12-, 16- or 18-bit interface format: the window's pixels become unknown`,
        );
        unknownWindow(c);
      }
  }
}

/** Where a logical (column, row) lands in the frame memory, or -1 outside it (ignored). */
export function gramIndex(madctl: number, col: number, row: number): number {
  const mv = (madctl & 0x20) !== 0;
  // MV exchanges the counters: the column counter then runs down the memory's rows (§8.12).
  let x = mv ? row : col;
  let y = mv ? col : row;
  if (x >= GRAM_WIDTH || y >= GRAM_HEIGHT) return -1;
  // MX and MY mirror the memory's columns and rows whatever MV is (checked against the vendor
  // offsets of the 135 × 240 and 240 × 240 panels in all four orientations).
  if (madctl & 0x40) x = GRAM_WIDTH - 1 - x;
  if (madctl & 0x80) y = GRAM_HEIGHT - 1 - y;
  return y * GRAM_WIDTH + x;
}

/** Writes a pixel where the counters point, then moves them (§8.12's counter table). */
function writePixel(c: Controller, word: number): void {
  const at = gramIndex(c.madctl, c.col, c.row);
  if (at >= 0) c.gram[at] = word;
  c.version++;
  // "Larger than XE": a start past the end (XS > XE) wraps after every pixel, as the table says.
  if (++c.col > c.xe) {
    c.col = c.xs;
    if (++c.row > c.ye) c.row = c.ys;
  }
}

/** Every pixel of the window becomes unknown (clipped to the memory). */
function unknownWindow(c: Controller): void {
  // Either counter reaches 319 at most (with MV); anything past that is ignored anyway.
  const cols = Math.min(c.xe, GRAM_HEIGHT - 1);
  const rows = Math.min(c.ye, GRAM_HEIGHT - 1);
  for (let row = c.ys; row <= rows; row++) {
    for (let col = c.xs; col <= cols; col++) {
      const at = gramIndex(c.madctl, col, row);
      if (at >= 0) c.gram[at] = PIXEL_X;
    }
  }
  c.version++;
}

/** A 16-bit register with its high (`half` 0) or low byte replaced. */
const word = (old: number, half: number, value: number) =>
  half === 0 ? ((value << 8) | (old & 0xff)) & 0xffff : (old & 0xff00) | value;

const hex = (byte: number) => `${byte.toString(16).toUpperCase().padStart(2, '0')}h`;
