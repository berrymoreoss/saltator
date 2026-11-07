/**
 * The HD44780U controller at instruction level, without the bus pins: DDRAM, CGRAM, the
 * registers, the 8- and 4-bit interface, the busy flag and the address counter. Data sheet:
 * Hitachi HD44780U, ADE-207-272(Z) Rev. 0.0 (Table 6, Figures 9, 10, 23, 24).
 *
 * Unknowns follow ADR-0014 — report, `X` where the outcome differs: a register the controller
 * can't know is marked in `unknown`, a cell's unknown bits in `ddramX`/`cgramX`. Uncertainty is
 * worked out by running every possible outcome exactly and merging them: an instruction byte
 * with unknown bits runs once per value it could have, a transfer that may or may not have
 * happened (a maybe-busy controller, an uncertain `E`) both ways, an interface whose mode is
 * unknown (power-on without the internal reset) once per mode it may be in. Spec:
 * docs/components.md#hd44780.
 */
import { formatTime, Level, type Time } from '../../core';

/** The interface modes the controller may be in (a set: several while unknown). */
export const Iface = {
  /** 8-bit: one transfer per byte. */
  EIGHT: 1,
  /** 4-bit, the next transfer is a byte's high nibble. */
  HIGH: 2,
  /** 4-bit, the next transfer is a byte's low nibble. */
  LOW: 4,
} as const;
const IFACE_MODES = [Iface.EIGHT, Iface.HIGH, Iface.LOW] as const;

/** Registers the controller may not know (bits of `Controller.unknown`). */
export const Unknown = {
  N: 1,
  F: 2,
  D: 4,
  C: 8,
  B: 16,
  ID: 32,
  S: 64,
  AC: 128,
  /** Whether the address counter points into CGRAM or DDRAM. */
  CG: 256,
  SHIFT: 512,
  /** The data register a data read gives out (or whether it is valid). */
  DR: 1024,
} as const;
export const ALL_UNKNOWN = 2047;

/** Diagnostic kinds the LCD reports. `*-violation` kinds are errors (`diagnosticSeverity`). */
export const Hd44780Diagnostic = {
  /** A write or data read while the busy flag is (or may be) 1: "not accepted". */
  BUSY: 'busy-violation',
  /** A write or data read less than 15 ms after power-on (Figures 23, 24). */
  POWER_ON: 'power-on-violation',
  /** `E` changed from or to `X`/`Z`: a transfer may or may not have happened. */
  UNCERTAIN_ENABLE: 'uncertain-enable',
  /** A DDRAM address the display mode doesn't have (0x28–0x3F in 2-line mode). */
  INVALID_ADDRESS: 'invalid-address',
  /** A data read after a write without an address set or cursor shift: invalid data. */
  INVALID_READ: 'invalid-read',
  /** The 5 × 10 dot font on a module whose glass has 5 × 8 dots. */
  FONT: 'unsupported-font',
} as const;

export type Reporter = (kind: string, message: string) => void;

/** Execution times at the instance's oscillator frequency (Table 6, scaled by 270 kHz / f). */
export interface ControllerTiming {
  /** Most instructions, data writes and reads (37 µs at 270 kHz). */
  readonly exec: Time;
  /** Clear display and Return home (1.52 ms at 270 kHz). */
  readonly long: Time;
  /** After a data write or read, the address counter shows its new value `tADD` after BF clears. */
  readonly tADD: Time;
}

/** The controller's state: plain data (part of the part's state, snapshotted and carried). */
export interface Controller {
  /** 80 cells; DDRAM address `a` is cell `a` in 1-line mode, `40 · line + column` in 2-line. */
  readonly ddram: Uint8Array;
  /** Unknown bits per DDRAM cell. */
  readonly ddramX: Uint8Array;
  /** 64 bytes: 8 characters of 8 rows (5 × 8), or 4 of 16 (5 × 10). */
  readonly cgram: Uint8Array;
  readonly cgramX: Uint8Array;
  /** Address counter, 7 bits. */
  ac: number;
  /** 1: the address counter points into CGRAM. */
  cg: number;
  /** Display shift: glass column 0 shows DDRAM column `shift` (mod the line length). */
  shift: number;
  /** Function set: 2 lines, 5 × 10 font. Display control: display, cursor, blink on. */
  n: number;
  f: number;
  d: number;
  c: number;
  b: number;
  /** Entry mode: increment, shift the display. */
  id: number;
  s: number;
  /** `Unknown` bits: registers whose value isn't known. */
  unknown: number;
  /** The interface modes it may be in (`Iface` bits); exactly one once known. */
  iface: number;
  /** 4-bit: the high nibble of the byte being written, and its unknown bits. */
  pending: number;
  pendingX: number;
  /** 4-bit: the byte being read (its low nibble comes with the second transfer). */
  latch: number;
  latchX: number;
  /** Data register: what a data read gives out; `drValid` 0 after a write (data sheet). */
  dr: number;
  drX: number;
  drValid: number;
  /** BF is 1 until `busyUntil`, and may be 1 until `maybeBusyUntil` (an unknown outcome). */
  busyUntil: Time;
  maybeBusyUntil: Time;
  /** A busy-flag read shows `acShown` (unknown bits `acShownX`) until `acShownUntil`. */
  acShown: number;
  acShownX: number;
  acShownUntil: Time;
}

/** Character code of a blank (space), what Clear display writes. */
export const SPACE = 0x20;

/**
 * A controller at power-on. `reset`: the internal reset ran (display clear, 8-bit, 1 line, 5 × 8,
 * display off, increment, no shift; busy for `resetBusy`). `unknown`: it didn't — every register
 * and cell unknown, the interface in any mode. CGRAM is unknown either way (RAM).
 */
export function createController(powerOn: 'reset' | 'unknown', resetBusy: Time): Controller {
  const reset = powerOn === 'reset';
  return {
    ddram: new Uint8Array(80).fill(SPACE),
    ddramX: new Uint8Array(80).fill(reset ? 0 : 0xff),
    cgram: new Uint8Array(64),
    cgramX: new Uint8Array(64).fill(0xff),
    ac: 0,
    cg: 0,
    shift: 0,
    n: 0,
    f: 0,
    d: 0,
    c: 0,
    b: 0,
    id: 1,
    s: 0,
    unknown: reset ? 0 : ALL_UNKNOWN,
    iface: reset ? Iface.EIGHT : Iface.EIGHT | Iface.HIGH | Iface.LOW,
    pending: 0,
    pendingX: 0xf,
    latch: 0,
    latchX: 0xff,
    dr: SPACE,
    drX: 0,
    drValid: 1,
    busyUntil: reset ? resetBusy : 0,
    maybeBusyUntil: resetBusy,
    acShown: 0,
    acShownX: 0,
    acShownUntil: -Infinity,
  };
}

function cloneController(c: Controller): Controller {
  return {
    ...c,
    ddram: c.ddram.slice(),
    ddramX: c.ddramX.slice(),
    cgram: c.cgram.slice(),
    cgramX: c.cgramX.slice(),
  };
}

/** Makes `into` equal to `from`, keeping `into`'s arrays (views onto the state stay valid). */
function assignController(into: Controller, from: Controller): void {
  const { ddram, ddramX, cgram, cgramX } = into;
  ddram.set(from.ddram);
  ddramX.set(from.ddramX);
  cgram.set(from.cgram);
  cgramX.set(from.cgramX);
  Object.assign(into, from, { ddram, ddramX, cgram, cgramX });
}

const REGISTERS = [
  ['n', Unknown.N],
  ['f', Unknown.F],
  ['d', Unknown.D],
  ['c', Unknown.C],
  ['b', Unknown.B],
  ['id', Unknown.ID],
  ['s', Unknown.S],
  ['ac', Unknown.AC],
  ['cg', Unknown.CG],
  ['shift', Unknown.SHIFT],
] as const;

/**
 * Merges another possible outcome into `into`: what they disagree on becomes unknown; the
 * controller is busy for sure until the earlier deadline and may be until the later one.
 */
function mergeController(into: Controller, other: Controller): void {
  let unknown = into.unknown | other.unknown;
  for (const [key, bit] of REGISTERS) if (into[key] !== other[key]) unknown |= bit;
  if (into.dr !== other.dr || into.drValid !== other.drValid) unknown |= Unknown.DR;
  into.unknown = unknown;
  into.drX |= other.drX | (into.dr ^ other.dr);
  for (let i = 0; i < 80; i++) {
    into.ddramX[i]! |= other.ddramX[i]! | (into.ddram[i]! ^ other.ddram[i]!);
  }
  for (let i = 0; i < 64; i++) {
    into.cgramX[i]! |= other.cgramX[i]! | (into.cgram[i]! ^ other.cgram[i]!);
  }
  into.iface |= other.iface;
  into.pendingX |= other.pendingX | (into.pending ^ other.pending);
  into.latchX |= other.latchX | (into.latch ^ other.latch);
  into.maybeBusyUntil = Math.max(
    into.maybeBusyUntil,
    other.maybeBusyUntil,
    into.busyUntil,
    other.busyUntil,
  );
  into.busyUntil = Math.min(into.busyUntil, other.busyUntil);
  into.acShownX |= other.acShownX | (into.acShown ^ other.acShown);
  into.acShownUntil = Math.max(into.acShownUntil, other.acShownUntil);
}

const has = (c: Controller, bit: number) => (c.unknown & bit) !== 0;

/**
 * The DDRAM cell of address `ac`, or -1 for an address the mode doesn't have: 1-line 0x00–0x4F,
 * 2-line 0x00–0x27 and 0x40–0x67.
 */
export function ddramCell(ac: number, twoLines: number): number {
  if (!twoLines) return ac < 80 ? ac : -1;
  const column = ac & 0x3f;
  return column < 40 ? (ac >> 6) * 40 + column : -1;
}

/** The address after `ac` moving one step up (`step` 1) or down (-1), with the wraps. */
function stepAddress(ac: number, cg: number, twoLines: number, step: number): number {
  if (cg) return (ac + step) & 0x3f;
  if (twoLines) {
    if (step > 0) return ac === 0x27 ? 0x40 : ac === 0x67 ? 0 : (ac + 1) & 0x7f;
    return ac === 0x40 ? 0x27 : ac === 0 ? 0x67 : (ac - 1) & 0x7f;
  }
  if (step > 0) return ac === 0x4f ? 0 : (ac + 1) & 0x7f;
  return ac === 0 ? 0x4f : (ac - 1) & 0x7f;
}

/** Moves the address counter one step (`I/D`, or `forward` for the cursor shift). */
function moveAddress(c: Controller, step: number): void {
  const next = stepAddress(c.ac, c.cg, c.n, step);
  // An unknown line count or target matters only where it changes the result.
  if (
    (has(c, Unknown.N) && next !== stepAddress(c.ac, c.cg, c.n ^ 1, step)) ||
    (has(c, Unknown.CG) && next !== stepAddress(c.ac, c.cg ^ 1, c.n, step))
  ) {
    c.unknown |= Unknown.AC;
  }
  c.ac = next;
}

/** Loads the data register from the RAM cell at the address counter (an address set). */
function loadDataRegister(c: Controller): void {
  c.drValid = 1;
  if (has(c, Unknown.AC | Unknown.CG | Unknown.N)) {
    c.unknown |= Unknown.DR;
    return;
  }
  c.unknown &= ~Unknown.DR;
  if (c.cg) {
    c.dr = c.cgram[c.ac & 0x3f]!;
    c.drX = c.cgramX[c.ac & 0x3f]!;
    return;
  }
  const cell = ddramCell(c.ac, c.n);
  c.dr = cell < 0 ? 0 : c.ddram[cell]!;
  c.drX = cell < 0 ? 0xff : c.ddramX[cell]!;
}

/** Sets the busy deadline and what a busy-flag read shows meanwhile (the old address). */
function startBusy(c: Controller, now: Time, duration: Time, tADD: Time, acBefore: number): void {
  c.busyUntil = now + duration;
  c.maybeBusyUntil = Math.max(c.maybeBusyUntil, c.busyUntil);
  c.acShown = acBefore;
  c.acShownUntil = now + duration + tADD;
}

/** Runs one instruction byte with every bit known (Table 6). Returns its interface bit DL. */
function runInstruction(
  c: Controller,
  now: Time,
  t: ControllerTiming,
  code: number,
  report: Reporter | undefined,
): number | undefined {
  const acBefore = c.ac;
  c.acShownX = has(c, Unknown.AC) ? 0x7f : 0;
  let duration = t.exec;
  let dl: number | undefined;
  if (code & 0x80) {
    // Set DDRAM address.
    c.ac = code & 0x7f;
    c.cg = 0;
    c.unknown &= ~(Unknown.AC | Unknown.CG);
    if (!has(c, Unknown.N) && ddramCell(c.ac, c.n) < 0) {
      report?.(
        Hd44780Diagnostic.INVALID_ADDRESS,
        `DDRAM address 0x${hex(c.ac)} doesn't exist in ${c.n ? '2' : '1'}-line mode (${c.n ? '0x00–0x27, 0x40–0x67' : '0x00–0x4F'})`,
      );
    }
    loadDataRegister(c);
  } else if (code & 0x40) {
    // Set CGRAM address.
    c.ac = code & 0x3f;
    c.cg = 1;
    c.unknown &= ~(Unknown.AC | Unknown.CG);
    loadDataRegister(c);
  } else if (code & 0x20) {
    // Function set: DL (the caller's), N, F.
    dl = (code >> 4) & 1;
    c.n = (code >> 3) & 1;
    c.f = (code >> 2) & 1;
    c.unknown &= ~(Unknown.N | Unknown.F);
    if (c.f && !c.n) {
      report?.(
        Hd44780Diagnostic.FONT,
        'function set chose the 5 × 10 dot font: the glass has 5 × 8 dots (the lower rows and the cursor are not shown)',
      );
    }
  } else if (code & 0x10) {
    // Cursor or display shift: S/C, R/L.
    const step = code & 0x04 ? 1 : -1;
    if (code & 0x08) {
      c.shift = (c.shift - step + 80) % 80;
    } else {
      moveAddress(c, step);
      loadDataRegister(c);
    }
  } else if (code & 0x08) {
    c.d = (code >> 2) & 1;
    c.c = (code >> 1) & 1;
    c.b = code & 1;
    c.unknown &= ~(Unknown.D | Unknown.C | Unknown.B);
  } else if (code & 0x04) {
    c.id = (code >> 1) & 1;
    c.s = code & 1;
    c.unknown &= ~(Unknown.ID | Unknown.S);
  } else if (code & 0x02) {
    // Return home.
    duration = t.long;
    c.ac = 0;
    c.cg = 0;
    c.shift = 0;
    c.unknown &= ~(Unknown.AC | Unknown.CG | Unknown.SHIFT);
    loadDataRegister(c);
  } else if (code & 0x01) {
    // Clear display: spaces everywhere, address 0, unshifted, I/D = 1 (S unchanged).
    duration = t.long;
    c.ddram.fill(SPACE);
    c.ddramX.fill(0);
    c.ac = 0;
    c.cg = 0;
    c.shift = 0;
    c.id = 1;
    c.unknown &= ~(Unknown.AC | Unknown.CG | Unknown.SHIFT | Unknown.ID);
    loadDataRegister(c);
  } else {
    // 0x00 is no instruction of Table 6: nothing happens.
    return undefined;
  }
  startBusy(c, now, duration, 0, acBefore);
  return dl;
}

/**
 * Runs an instruction byte whose bits may be unknown (`x`), sets the interface mode after it:
 * a function set's DL decides; otherwise a 4-bit controller awaits the next high nibble.
 */
function instruction(
  c: Controller,
  now: Time,
  t: ControllerTiming,
  value: number,
  x: number,
  fourBit: boolean,
  report: Reporter | undefined,
): void {
  const run = (target: Controller, code: number, why: Reporter | undefined) => {
    const dl = runInstruction(target, now, t, code, why);
    target.iface =
      dl === undefined ? (fourBit ? Iface.HIGH : Iface.EIGHT) : dl ? Iface.EIGHT : Iface.HIGH;
  };
  const unknownBits = x & 0xff;
  if (unknownBits === 0) {
    run(c, value & 0xff, report);
    return;
  }
  // Every value the byte could have, merged.
  const base = cloneController(c);
  const known = value & ~unknownBits & 0xff;
  run(c, known | unknownBits, undefined);
  for (let sub = (unknownBits - 1) & unknownBits; ; sub = (sub - 1) & unknownBits) {
    const outcome = cloneController(base);
    run(outcome, known | sub, undefined);
    mergeController(c, outcome);
    if (sub === 0) break;
  }
}

/** Writes a data byte (unknown bits `x`) to the RAM cell at the address counter, then moves it. */
function writeData(c: Controller, now: Time, t: ControllerTiming, value: number, x: number): void {
  const acBefore = c.ac;
  c.acShownX = has(c, Unknown.AC) ? 0x7f : 0;
  if (has(c, Unknown.AC | Unknown.CG | Unknown.N)) {
    // Any cell it could have gone to may now hold it.
    const ddram = !c.cg || has(c, Unknown.CG);
    const cgram = c.cg || has(c, Unknown.CG);
    for (let i = 0; ddram && i < 80; i++) c.ddramX[i]! |= (c.ddram[i]! ^ value) | x;
    for (let i = 0; cgram && i < 64; i++) c.cgramX[i]! |= (c.cgram[i]! ^ value) | x;
  } else if (c.cg) {
    c.cgram[c.ac & 0x3f] = value;
    c.cgramX[c.ac & 0x3f] = x;
  } else {
    const cell = ddramCell(c.ac, c.n);
    if (cell >= 0) {
      c.ddram[cell] = value;
      c.ddramX[cell] = x;
    }
  }
  c.drValid = 0;
  const step = c.id ? 1 : -1;
  // With S = 1 a DDRAM write shifts the display the way the cursor goes (I/D = 1: left).
  if ((!c.cg || has(c, Unknown.CG)) && (c.s || has(c, Unknown.S))) {
    if (has(c, Unknown.CG | Unknown.S | Unknown.ID)) c.unknown |= Unknown.SHIFT;
    else c.shift = (c.shift + step + 80) % 80;
  }
  moveAddress(c, step);
  if (has(c, Unknown.ID)) c.unknown |= Unknown.AC;
  startBusy(c, now, t.exec, t.tADD, acBefore);
}

/** After a data read: the address counter moves and the data register reloads (no shift). */
function readData(c: Controller, now: Time, t: ControllerTiming): void {
  const acBefore = c.ac;
  c.acShownX = has(c, Unknown.AC) ? 0x7f : 0;
  moveAddress(c, c.id ? 1 : -1);
  if (has(c, Unknown.ID)) c.unknown |= Unknown.AC;
  loadDataRegister(c);
  startBusy(c, now, t.exec, t.tADD, acBefore);
}

/** One bus transfer as the controller sees it when it completes (`E` fell). */
export interface Transfer {
  /** R/W̅ and RS, `X` when uncertain (a timing violation). */
  readonly rw: Level;
  readonly rs: Level;
  /** DB7–DB0 latched at `E` falling (writes), with unknown bits. */
  readonly bus: number;
  readonly busX: number;
  /** False when it may not have happened at all (an uncertain `E`). */
  readonly certain: boolean;
}

const levels = (level: Level): readonly number[] =>
  level === Level.L0 ? [0] : level === Level.L1 ? [1] : [0, 1];

/** Applies a transfer in one interface mode, one R/W̅ and RS; `execute` false: not accepted. */
function applyTransfer(
  c: Controller,
  now: Time,
  t: ControllerTiming,
  mode: number,
  rw: number,
  rs: number,
  bus: number,
  busX: number,
  execute: boolean,
  report: Reporter | undefined,
): void {
  const fourBit = mode !== Iface.EIGHT;
  if (mode === Iface.HIGH) {
    // The first nibble: kept for the second (a write's) or given out (a read's, at E rising).
    c.iface = Iface.LOW;
    c.pending = (bus >> 4) & 0xf;
    c.pendingX = rw ? 0xf : (busX >> 4) & 0xf;
    if (!rw) c.latchX = 0xff;
    return;
  }
  const value = fourBit ? (c.pending << 4) | ((bus >> 4) & 0xf) : bus & 0xff;
  const x = fourBit ? (c.pendingX << 4) | ((busX >> 4) & 0xf) : busX & 0xff;
  c.iface = fourBit ? Iface.HIGH : Iface.EIGHT;
  if (!execute) return;
  if (rw) {
    if (rs) readData(c, now, t);
  } else if (rs) {
    writeData(c, now, t, value, x);
  } else {
    instruction(c, now, t, value, x, fourBit, report);
  }
}

/**
 * Completes a transfer: every combination of what it may have been (R/W̅, RS, interface mode,
 * accepted or not while maybe busy, happened or not) applied and merged. Reports a write or data
 * read while busy; diagnostics of the instruction itself only when the outcome is certain.
 */
export function completeTransfer(
  c: Controller,
  now: Time,
  t: ControllerTiming,
  transfer: Transfer,
  report: Reporter,
): void {
  const rws = levels(transfer.rw);
  const rss = levels(transfer.rs);
  // A busy-flag read is the one transfer allowed while busy.
  const executes = rws.includes(0) || rss.includes(1);
  const busy = now < c.busyUntil;
  const maybeBusy = !busy && now < c.maybeBusyUntil;
  if (executes && (busy || maybeBusy)) {
    const until = busy ? c.busyUntil : c.maybeBusyUntil;
    report(
      Hd44780Diagnostic.BUSY,
      `${rws.includes(0) ? 'written' : 'read'} while the LCD ${busy ? 'is' : 'may be'} busy (for ${formatTime(until - now)} more): ${busy ? 'not accepted' : 'maybe not accepted'}`,
    );
  }
  const accepted = busy ? [false] : maybeBusy ? [true, false] : [true];
  const modes = IFACE_MODES.filter((mode) => c.iface & mode);
  const count = rws.length * rss.length * modes.length * accepted.length;
  if (count === 1 && transfer.certain) {
    applyTransfer(
      c,
      now,
      t,
      modes[0]!,
      rws[0]!,
      rss[0]!,
      transfer.bus,
      transfer.busX,
      accepted[0]!,
      report,
    );
    return;
  }
  const base = cloneController(c);
  let first = true;
  const add = (outcome: Controller) => {
    if (first) assignController(c, outcome);
    else mergeController(c, outcome);
    first = false;
  };
  for (const rw of rws) {
    for (const rs of rss) {
      for (const mode of modes) {
        for (const execute of accepted) {
          const outcome = cloneController(base);
          applyTransfer(
            outcome,
            now,
            t,
            mode,
            rw,
            rs,
            transfer.bus,
            transfer.busX,
            execute,
            undefined,
          );
          add(outcome);
        }
      }
    }
  }
  if (!transfer.certain) add(base);
}

/** What a read gives out on the bus: the pins it drives and their levels. */
export interface ReadOutput {
  /** DB pins driven (bit n = DBn): 0xFF in 8-bit mode, 0xF0 in 4-bit. */
  readonly pins: number;
  readonly value: number;
  /** Unknown bits among the driven pins. */
  readonly x: number;
}

/**
 * Starts a read (`E` rose with R/W̅ HIGH): the busy flag and address (RS 0) or the data register
 * (RS 1), as the interface mode gives it out; captures the byte for a 4-bit read's second nibble.
 * Reports a data read while busy and an invalid data read.
 */
export function startRead(c: Controller, now: Time, rs: Level, report: Reporter): ReadOutput {
  let value = 0;
  let x = 0;
  if (rs === Level.L0) {
    const bf = now < c.busyUntil ? 1 : 0;
    const bfX = !bf && now < c.maybeBusyUntil ? 1 : 0;
    const shown = now < c.acShownUntil;
    value = (bf << 7) | (shown ? c.acShown : c.ac);
    x = (bfX << 7) | (shown ? c.acShownX : has(c, Unknown.AC) ? 0x7f : 0);
  } else if (rs === Level.L1) {
    if (now < c.maybeBusyUntil) {
      const busy = now < c.busyUntil;
      report(
        Hd44780Diagnostic.BUSY,
        `data read while the LCD ${busy ? 'is' : 'may be'} busy (for ${formatTime((busy ? c.busyUntil : c.maybeBusyUntil) - now)} more): invalid data`,
      );
      x = 0xff;
    } else if (!c.drValid && !has(c, Unknown.DR)) {
      report(
        Hd44780Diagnostic.INVALID_READ,
        'data read after a write without an address set or cursor shift: the first read is invalid',
      );
      x = 0xff;
    } else {
      value = c.dr;
      x = has(c, Unknown.DR) ? 0xff : c.drX;
    }
  } else {
    x = 0xff;
  }
  if (c.iface === Iface.EIGHT) return { pins: 0xff, value, x };
  if (c.iface === Iface.HIGH) {
    c.latch = value;
    c.latchX = x;
    return { pins: 0xf0, value: value & 0xf0, x: x & 0xf0 };
  }
  if (c.iface === Iface.LOW) {
    return { pins: 0xf0, value: (c.latch & 0xf) << 4, x: (c.latchX & 0xf) << 4 };
  }
  // Unknown mode: the high nibble may be the new byte's.
  c.latch = value;
  c.latchX = x;
  return { pins: c.iface & Iface.EIGHT ? 0xff : 0xf0, value: 0, x: 0xff };
}

function hex(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0');
}
