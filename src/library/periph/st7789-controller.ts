/**
 * The ST7789V controller at command level, as plain data and functions on it (the simulator
 * snapshots the state; the drawer and tests read it): the command decoder with every command's
 * parameter count (Sitronix ST7789V V1.3, §9.1 and §9.2), the registers that change what the
 * glass shows, the frame memory, the resets. The serial interface that delivers the bytes lives
 * in `st7789.ts`. Spec: docs/components.md#st7789.
 */
import { formatTime, ms, type Time } from '../../core';
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
  /**
   * A command within a wait the data sheet asks for (5 ms after RESX↑, SWRESET, SLPOUT, SLPIN;
   * 120 ms before SLPOUT after a reset, before SLPIN after SLPOUT): its effect is uncertain.
   */
  WAIT: 'wait-violation',
  /** A RESX LOW pulse shorter than 5 µs: "Reset Rejected" as a spike (Table 9). */
  RESET_REJECTED: 'reset-rejected',
  /** RESX, CS, SCL or D/CX unknown or floating: what the interface received is uncertain. */
  UNCERTAIN: 'uncertain-interface',
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

/** No command is taking data (after a reset, or after a command without parameters). */
const NONE = -1;
/** Something unknown came in (a lost interface, an unknown command byte): data is ignored. */
const ANY = -2;

/**
 * Registers whose value is unknown (`Controller.unknown`). A command whose effect is uncertain
 * (a wait violated, unknown bits) sets what it sets, as the outcome shown, and marks it here
 * where its outcomes differ; the glass then shows that outcome under a veil. A later command
 * sent in time makes it known again.
 */
export const Unknown = {
  SLEEP: 1 << 0,
  DISPLAY: 1 << 1,
  INVERSION: 1 << 2,
  IDLE: 1 << 3,
  PARTIAL: 1 << 4,
  MADCTL: 1 << 5,
  PTLAR: 1 << 6,
  SCROLL_AREA: 1 << 7,
  SCROLL_START: 1 << 8,
  COLMOD: 1 << 9,
  COLUMNS: 1 << 10,
  ROWS: 1 << 11,
  RAMCTRL: 1 << 12,
  /** The memory write counters and whether the data is memory data. */
  WRITE: 1 << 13,
} as const;

const ALL_UNKNOWN = (1 << 14) - 1;

/** The modes that change how the memory shows (`st7789Frame`). */
export const SHOWN =
  Unknown.SLEEP |
  Unknown.DISPLAY |
  Unknown.INVERSION |
  Unknown.IDLE |
  Unknown.PARTIAL |
  Unknown.MADCTL |
  Unknown.PTLAR |
  Unknown.SCROLL_AREA |
  Unknown.SCROLL_START;

/** What makes a pixel write land uncertainly (where, or in what color). */
const WRITE_DEPENDS =
  Unknown.MADCTL |
  Unknown.COLMOD |
  Unknown.COLUMNS |
  Unknown.ROWS |
  Unknown.RAMCTRL |
  Unknown.WRITE;

/** A frame memory word: R6 G6 B6 in bits 17–0, and these flags. */
export const PIXEL_X = 1 << 18;
/** The pixel holds this color only if an uncertain write happened (drawn under a veil). */
export const PIXEL_UNCERTAIN = 1 << 19;

/** The waits (Table 9 Note 7, SWRESET, SLPIN, SLPOUT restrictions). */
export const WAIT_COMMAND = ms(5);
export const WAIT_SLEEP = ms(120);

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
  /** Registers whose value is unknown (`Unknown` bits). */
  unknown: number;
  /** The command taking the data bytes, `NONE` or `ANY`. */
  cmd: number;
  /** Index of the next parameter of `cmd`. */
  param: number;
  /** 1 while the bytes are a read's or an unknown command's: ignored until the next command. */
  ignore: number;
  /** 1 while the current command's effect is uncertain (sent within a wait). */
  uncertain: number;
  /** The column and row counters of a memory write (logical: before MADCTL's mapping). */
  col: number;
  row: number;
  /** Bytes of the pixel (or pixel pair, 12-bit) collected so far, their bits and unknown bits. */
  phase: number;
  acc: number;
  accX: number;
  /** No command before this time; no SLPOUT before `slpoutAt`; no SLPIN before `slpinAt`. */
  quietUntil: Time;
  slpoutAt: Time;
  slpinAt: Time;
  /** 1 while every known pixel is marked uncertain (a repeat can skip the pass). */
  veiled: number;
  /** Frame memory, `GRAM_WIDTH × GRAM_HEIGHT` words row by row (see `PIXEL_X`). */
  gram: Uint32Array;
  /** Counts every change the glass could show, so a drawer can cache its frame. */
  version: number;
}

type Register =
  | 'sleep'
  | 'display'
  | 'inversion'
  | 'idle'
  | 'partial'
  | 'colmod'
  | 'madctl'
  | 'xs'
  | 'xe'
  | 'ys'
  | 'ye'
  | 'psl'
  | 'pel'
  | 'tfa'
  | 'vsa'
  | 'bfa'
  | 'vsp'
  | 'ramctrl1'
  | 'ramctrl2';

/** Which `Unknown` bit covers a register. */
const BIT: Readonly<Record<Register, number>> = {
  sleep: Unknown.SLEEP,
  display: Unknown.DISPLAY,
  inversion: Unknown.INVERSION,
  idle: Unknown.IDLE,
  partial: Unknown.PARTIAL,
  colmod: Unknown.COLMOD,
  madctl: Unknown.MADCTL,
  xs: Unknown.COLUMNS,
  xe: Unknown.COLUMNS,
  ys: Unknown.ROWS,
  ye: Unknown.ROWS,
  psl: Unknown.PTLAR,
  pel: Unknown.PTLAR,
  tfa: Unknown.SCROLL_AREA,
  vsa: Unknown.SCROLL_AREA,
  bfa: Unknown.SCROLL_AREA,
  vsp: Unknown.SCROLL_START,
  ramctrl1: Unknown.RAMCTRL,
  ramctrl2: Unknown.RAMCTRL,
};

/**
 * Sets a register. Certain: it is known from now on (`known`: once its command's last part
 * arrived). Uncertain: the new value is the outcome shown, unknown where it differs.
 */
function setRegister(c: Controller, key: Register, value: number, known = true): void {
  if (c.uncertain) {
    if (c[key] !== value) c.unknown |= BIT[key];
  } else if (known) {
    c.unknown &= ~BIT[key];
  }
  if (c[key] !== value) c.version++;
  c[key] = value;
}

/** The registers' defaults (each command's "Default" table); `software`: SWRESET's. */
function defaults(c: Controller, software: boolean): void {
  if (!software) {
    setRegister(c, 'colmod', 0x06); // "18 bit/pixel" (RDDCOLMOD: 0000 0110)
    setRegister(c, 'madctl', 0x00);
  }
  // COLMOD and MADCTL keep their values at SWRESET ("No change").
  setRegister(c, 'sleep', 1);
  setRegister(c, 'display', 0);
  setRegister(c, 'inversion', 0);
  setRegister(c, 'idle', 0);
  setRegister(c, 'partial', 0);
  // The window's ends follow MV: with rows and columns exchanged it is 320 wide (CASET, RASET).
  const mv = (c.madctl & 0x20) !== 0;
  const mvKnown = !(c.unknown & Unknown.MADCTL);
  setRegister(c, 'xs', 0);
  setRegister(c, 'xe', (mv ? GRAM_HEIGHT : GRAM_WIDTH) - 1, mvKnown);
  setRegister(c, 'ys', 0);
  setRegister(c, 'ye', (mv ? GRAM_WIDTH : GRAM_HEIGHT) - 1, mvKnown);
  if (!mvKnown) c.unknown |= Unknown.COLUMNS | Unknown.ROWS;
  setRegister(c, 'psl', 0);
  setRegister(c, 'pel', GRAM_HEIGHT - 1);
  setRegister(c, 'tfa', 0);
  setRegister(c, 'vsa', GRAM_HEIGHT);
  setRegister(c, 'bfa', 0);
  setRegister(c, 'vsp', 0);
  setRegister(c, 'ramctrl1', 0x00);
  setRegister(c, 'ramctrl2', 0xf0);
  c.cmd = NONE;
  c.param = 0;
  c.ignore = 0;
  c.col = 0;
  c.row = 0;
  c.phase = 0;
  c.acc = 0;
  c.accX = 0;
  if (c.uncertain) c.unknown |= Unknown.WRITE;
  else c.unknown &= ~Unknown.WRITE;
}

/**
 * The controller at power-on: the defaults, the frame memory "set randomly" (unknown). Power-on
 * counts as a reset released at time 0, so its waits apply too.
 */
export function createController(): Controller {
  const c: Controller = {
    sleep: 1,
    display: 0,
    inversion: 0,
    idle: 0,
    partial: 0,
    colmod: 0x06,
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
    unknown: 0,
    cmd: NONE,
    param: 0,
    ignore: 0,
    uncertain: 0,
    col: 0,
    row: 0,
    phase: 0,
    acc: 0,
    accX: 0,
    quietUntil: 0,
    slpoutAt: 0,
    slpinAt: 0,
    veiled: 0,
    gram: new Uint32Array(GRAM_WIDTH * GRAM_HEIGHT).fill(PIXEL_X),
    version: 0,
  };
  defaults(c, false);
  resetReleased(c, 0);
  return c;
}

/** RESX held LOW long enough: the registers' hardware defaults; the memory is "not cleared". */
export function hardwareReset(c: Controller): void {
  c.uncertain = 0;
  defaults(c, false);
}

/**
 * A reset that may or may not have happened (a 5–9 µs pulse: "Reset starts"; RESX unknown):
 * the defaults are the outcome shown, unknown where they differ.
 */
export function uncertainReset(c: Controller, now: Time): void {
  c.uncertain = 1;
  defaults(c, false);
  c.uncertain = 0;
  c.cmd = ANY;
  resetReleased(c, now);
}

/** RESX rose after a reset: no command for 5 ms, no SLPOUT for 120 ms (Table 9 Note 7). */
export function resetReleased(c: Controller, now: Time): void {
  c.quietUntil = now + WAIT_COMMAND;
  c.slpoutAt = now + WAIT_SLEEP;
  c.slpinAt = 0;
}

/**
 * One byte off the serial interface. `dc`: 0 a command, 1 a parameter or memory data, -1
 * unknown; `x`: its unknown bits.
 */
export function receiveByte(
  c: Controller,
  now: Time,
  dc: number,
  value: number,
  x: number,
  report: Reporter,
): void {
  if (dc === 0 && x === 0) command(c, now, value, report);
  else if (dc === 0) uncertainCommand(c, now, value, x, report);
  else if (dc === 1) data(c, value, x, report);
  else lost(c);
}

/**
 * Something unknown arrived — a byte that may be a command or data, a lost interface: any
 * register may have changed and any pixel may have been written. Everything is unknown and the
 * memory is veiled; the data that follows is ignored until a command comes in (D/CX = 0 makes
 * every command recognizable, so the interface finds its way back).
 */
export function lost(c: Controller): void {
  c.unknown = ALL_UNKNOWN;
  c.cmd = ANY;
  c.param = 0;
  c.ignore = 0;
  c.uncertain = 0;
  if (!c.veiled) {
    const { gram } = c;
    for (let i = 0; i < gram.length; i++) {
      if (!(gram[i]! & PIXEL_X)) gram[i] = gram[i]! | PIXEL_UNCERTAIN;
    }
    c.veiled = 1;
  }
  c.version++;
}

function command(c: Controller, now: Time, code: number, report: Reporter): void {
  const info = COMMANDS.get(code);
  c.cmd = code;
  c.param = 0;
  c.ignore = 0;
  c.uncertain = 0;
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
  checkWaits(c, now, code, info.name, report);
  execute(c, now, code, report);
  if (info.params === 0) c.cmd = NONE;
}

/** A command sent within a wait: reported, and its effect becomes uncertain (Q5). */
function checkWaits(c: Controller, now: Time, code: number, name: string, report: Reporter): void {
  let until = c.quietUntil;
  let why = '5 ms after a reset, SWRESET, SLPOUT or SLPIN';
  if (code === Cmd.SLPOUT && c.slpoutAt > until) {
    until = c.slpoutAt;
    why = '120 ms after a reset before SLPOUT';
  }
  if (code === Cmd.SLPIN && c.slpinAt > until) {
    until = c.slpinAt;
    why = '120 ms after SLPOUT before SLPIN';
  }
  if (now >= until) return;
  report(
    St7789Diagnostic.WAIT,
    `${name} at ${formatTime(now)}, ${formatTime(until - now)} too early: the data sheet asks for ${why}; what it does is uncertain`,
  );
  c.uncertain = 1;
}

/** What a (write) command does when it is accepted. */
function execute(c: Controller, now: Time, code: number, report: Reporter): void {
  switch (code) {
    case Cmd.SWRESET: {
      const asleep = c.sleep === 1;
      defaults(c, true);
      c.quietUntil = now + WAIT_COMMAND;
      // "If software reset is sent during sleep in mode, … 120msec before sending sleep out."
      if (asleep) c.slpoutAt = Math.max(c.slpoutAt, now + WAIT_SLEEP);
      break;
    }
    case Cmd.SLPIN:
      if (c.sleep !== 1 || c.unknown & Unknown.SLEEP) c.quietUntil = now + WAIT_COMMAND;
      setRegister(c, 'sleep', 1);
      break;
    case Cmd.SLPOUT:
      // "This command has no effect when module is already in sleep out mode."
      if (c.sleep !== 0 || c.unknown & Unknown.SLEEP) {
        c.quietUntil = now + WAIT_COMMAND;
        c.slpinAt = now + WAIT_SLEEP;
      }
      setRegister(c, 'sleep', 0);
      break;
    case Cmd.PTLON:
      setRegister(c, 'partial', 1);
      break;
    case Cmd.NORON:
      setRegister(c, 'partial', 0);
      break;
    case Cmd.INVOFF:
      setRegister(c, 'inversion', 0);
      break;
    case Cmd.INVON:
      setRegister(c, 'inversion', 1);
      break;
    case Cmd.DISPOFF:
      setRegister(c, 'display', 0);
      break;
    case Cmd.DISPON:
      setRegister(c, 'display', 1);
      break;
    case Cmd.IDMOFF:
      setRegister(c, 'idle', 0);
      break;
    case Cmd.IDMON:
      setRegister(c, 'idle', 1);
      break;
    case Cmd.RAMWR:
      // "The column and the page register are reset to the start column/start page."
      c.col = c.xs;
      c.row = c.ys;
      startWrite(c, now, report);
      break;
    case Cmd.WRMEMC:
      // Continues from where the last write left the counters.
      startWrite(c, now, report);
      break;
  }
}

function startWrite(c: Controller, now: Time, report: Reporter): void {
  c.phase = 0;
  c.acc = 0;
  c.accX = 0;
  if (!c.uncertain) c.unknown &= ~Unknown.WRITE;
  if (c.xs <= c.xe && c.ys <= c.ye) return;
  report(
    St7789Diagnostic.BAD_WINDOW,
    `memory write at ${formatTime(now)} with columns ${c.xs}–${c.xe}, rows ${c.ys}–${c.ye}: the start must not be past the end`,
  );
}

/** Commands that can't be told apart by more than this many unknown bits run one by one. */
const MAX_UNKNOWN_BITS = 3;

/**
 * A command byte with unknown bits. When every value it may be is a command without parameters,
 * each runs uncertainly (what any of them sets becomes unknown); otherwise what follows can't be
 * placed, and the interface counts as lost.
 */
function uncertainCommand(
  c: Controller,
  now: Time,
  value: number,
  x: number,
  report: Reporter,
): void {
  const candidates: number[] = [];
  if (popcount(x) <= MAX_UNKNOWN_BITS) {
    for (let v = 0; v < 256; v++) if ((v & ~x) === (value & ~x)) candidates.push(v);
  }
  const simple =
    candidates.length > 0 &&
    candidates.every((code) => {
      const info = COMMANDS.get(code);
      return info !== undefined && !info.read && info.params === 0 && code !== Cmd.SWRESET;
    });
  if (!simple) {
    lost(c);
    return;
  }
  for (const code of candidates) {
    c.uncertain = 1;
    execute(c, now, code, report);
  }
  c.uncertain = 0;
  c.cmd = NONE;
}

function data(c: Controller, value: number, x: number, report: Reporter): void {
  if (c.ignore || c.cmd === ANY) return;
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
  if (info.params === STREAM) memoryByte(c, value, x, index, report);
  else parameter(c, index, value, x, info.params);
}

/**
 * Stores parameter `index` of the current command as it arrives (§8.5: the ones sent stand). A
 * register becomes known once its command's last parameter came in certain and whole.
 */
function parameter(c: Controller, index: number, value: number, x: number, count: number): void {
  const last = index === count - 1;
  const put = (key: Register, v: number) => {
    setRegister(c, key, v, last);
    if (x) c.unknown |= BIT[key];
  };
  switch (c.cmd) {
    case Cmd.CASET:
      if (index < 2) put('xs', word(c.xs, index, value));
      else put('xe', word(c.xe, index - 2, value));
      break;
    case Cmd.RASET:
      if (index < 2) put('ys', word(c.ys, index, value));
      else put('ye', word(c.ye, index - 2, value));
      break;
    case Cmd.PTLAR:
      if (index < 2) put('psl', word(c.psl, index, value));
      else put('pel', word(c.pel, index - 2, value));
      break;
    case Cmd.VSCRDEF:
      if (index < 2) put('tfa', word(c.tfa, index, value));
      else if (index < 4) put('vsa', word(c.vsa, index - 2, value));
      else put('bfa', word(c.bfa, index - 4, value));
      break;
    case Cmd.VSCSAD:
      put('vsp', word(c.vsp, index, value));
      break;
    case Cmd.MADCTL:
      put('madctl', value);
      break;
    case Cmd.COLMOD:
      put('colmod', value);
      break;
    case Cmd.RAMCTRL:
      put(index === 0 ? 'ramctrl1' : 'ramctrl2', value);
      break;
    // The rest are accepted with no effect on the glass.
  }
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
function memoryByte(
  c: Controller,
  value: number,
  x: number,
  index: number,
  report: Reporter,
): void {
  switch (c.colmod & 7) {
    case Format.RGB444:
      // R1 G1 | B1 R2 | G2 B2: the first pixel is complete with the second byte's high nibble.
      if (c.phase === 0) {
        c.acc = value;
        c.accX = x;
        c.phase = 1;
      } else if (c.phase === 1) {
        writePixel(
          c,
          rgb444(c.acc >> 4, c.acc & 0xf, value >> 4),
          c.accX !== 0 || (x & 0xf0) !== 0,
        );
        c.acc = value & 0xf;
        c.accX = x & 0xf;
        c.phase = 2;
      } else {
        writePixel(c, rgb444(c.acc, value >> 4, value & 0xf), c.accX !== 0 || x !== 0);
        c.phase = 0;
      }
      return;
    case Format.RGB565:
      if (c.phase === 0) {
        c.acc = value;
        c.accX = x;
        c.phase = 1;
      } else {
        writePixel(c, rgb565(c, (c.acc << 8) | value), c.accX !== 0 || x !== 0);
        c.phase = 0;
      }
      return;
    case Format.RGB666:
    case Format.RGB888:
      c.acc = (c.acc << 6) | (value >> 2);
      c.accX |= x >> 2;
      if (++c.phase < 3) return;
      writePixel(c, c.acc & 0x3ffff, c.accX !== 0);
      c.acc = 0;
      c.accX = 0;
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

/**
 * Writes a pixel where the counters point, then moves them (§8.12's counter table). Unknown data
 * bits make it unknown; an uncertain write (sent within a wait, through an unknown register)
 * leaves it uncertain.
 */
function writePixel(c: Controller, word: number, unknownBits: boolean): void {
  const at = gramIndex(c.madctl, c.col, c.row);
  if (at >= 0) {
    const old = c.gram[at]!;
    if (unknownBits) c.gram[at] = PIXEL_X;
    else if (c.uncertain || c.unknown & WRITE_DEPENDS) {
      if (old !== word) c.gram[at] = word | PIXEL_UNCERTAIN;
    } else {
      c.gram[at] = word;
      c.veiled = 0;
    }
  }
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

function popcount(v: number): number {
  let n = 0;
  for (let b = v; b; b &= b - 1) n++;
  return n;
}

/** A 16-bit register with its high (`half` 0) or low byte replaced. */
const word = (old: number, half: number, value: number) =>
  half === 0 ? ((value << 8) | (old & 0xff)) & 0xffff : (old & 0xff00) | value;

const hex = (byte: number) => `${byte.toString(16).toUpperCase().padStart(2, '0')}h`;
