/**
 * The W65C02S between two falling edges of PHI2: a pure, cycle-level model of the processor,
 * testable without a bench. The part (`w65c02s.ts`) puts each cycle on the pins with the data
 * sheet's timing; this file decides what each cycle does.
 *
 * - The state is plain data (snapshots and carry-over copy it): registers with a mask of unknown
 *   bits each (a set bit is `X`; its bit in the value is kept 0), the instruction register and
 *   cycle counter, latches, the mode.
 * - Each cycle is described by the bus fields (`addr`, `uaddr`, `write`, `wdata`, `uwdata`,
 *   `sync`, `vpb`, `mlb`); `endCycle(core, data, unknown)` ends it with the byte read (ignored
 *   for a write) and sets up the next one.
 * - Bus cycles follow SingleStepTests 65x02 `wdc65c02` (the 2022 data sheet has no per-cycle
 *   table), except where the data sheet says otherwise (`5C`: 8 cycles, Table 7-1); reset and
 *   interrupt sequences follow the W65C816S data sheet's Table 5-7 (emulation mode).
 * - Unknown bits flow through the ALU (logic exact per bit, arithmetic unknown from the lowest
 *   unknown bit up); when what the CPU does next depends on them it is lost (`lose`) until reset.
 *
 * Spec: docs/components.md#w65c02s; decision: docs/adr/0028-cpu-model.md.
 */
import { type AddressingMode, W65C02S_OPCODES } from './w65c02s-opcodes';

/** What the CPU is doing (`Core.mode`). */
export const Mode = {
  running: 0,
  /** RESB is held LOW. */
  reset: 1,
  /** `WAI`: waiting for IRQB or NMIB. */
  waiting: 2,
  /** `STP`: stopped until reset. */
  stopped: 3,
  /** Nobody knows: power-on before a reset, or lost after acting on unknown bits. */
  unknown: 4,
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

/** Why a CPU was lost (`Core.lostReason`), for the diagnostic. */
export const LostReason = {
  none: 0,
  /** An opcode fetched with unknown bits. */
  opcode: 1,
  /** A branch (or `BBR`/`BBS`) on an unknown bit. */
  branch: 2,
  /** The program counter got unknown bits (a jump, a return, a vector). */
  pc: 3,
  /** Whether indexing crossed a page — and so the cycle count — is unknown. */
  page: 4,
  /** `ADC`/`SBC` with an unknown D flag (decimal mode takes an extra cycle). */
  decimal: 5,
  /** An interrupt may or may not be taken (IRQB or the I flag unknown). */
  interrupt: 6,
  /** The part lost it: a clock violation, an unknown clock or control input. */
  external: 7,
} as const;
export type LostReason = (typeof LostReason)[keyof typeof LostReason];

/** Sequences that aren't instructions (`Core.seq`). */
const Seq = { instruction: 0, reset: 1, irq: 2, nmi: 3, brk: 4 } as const;

/** Status register bits. */
export const Flag = {
  C: 0x01,
  Z: 0x02,
  I: 0x04,
  D: 0x08,
  B: 0x10,
  U: 0x20,
  V: 0x40,
  N: 0x80,
} as const;

export interface W65C02SCore {
  a: number;
  ua: number;
  x: number;
  ux: number;
  y: number;
  uy: number;
  s: number;
  us: number;
  /** Status register; bit 5 always 1, B (bit 4) kept 0 (it exists only when P is pushed). */
  p: number;
  up: number;
  /** Program counter; known while running (unknown bits lose the CPU), unknown after a loss. */
  pc: number;
  upc: number;
  /** Instruction register and the cycle in the instruction (0: the opcode fetch). */
  ir: number;
  t: number;
  seq: number;
  mode: Mode;
  /** Where the current instruction's opcode was fetched. */
  opAddr: number;
  /** Effective address and its unknown bits. */
  ea: number;
  uea: number;
  /** Base address or pointer while forming an effective address. */
  base: number;
  ubase: number;
  /** Operand (and the result of a read-modify-write). */
  val: number;
  uval: number;
  /** Whether an indexed address crossed a page: 0 no, 1 yes. */
  crossed: number;
  /** ADC/SBC in decimal mode: one more cycle before the next fetch. */
  extra: number;
  /** I as an interrupt poll sees it after `CLI`, `SEI`, `PLP` (−1: the current I). */
  pollI: number;
  /** IRQB as sampled: 0 high, 1 low, 2 unknown. */
  irq: number;
  /** An NMIB falling edge waits to be taken. */
  nmi: number;
  lostReason: LostReason;
  /** Where the CPU was lost (the opcode's address or the bus address). */
  lostAt: number;
  /** The cycle on the bus. */
  addr: number;
  uaddr: number;
  write: number;
  wdata: number;
  uwdata: number;
  sync: number;
  /** Vector pull and memory lock, 1 = HIGH (inactive). */
  vpb: number;
  mlb: number;
}

/** A CPU at power-on: every register unknown, outputs unknown until a reset. */
export function createCore(): W65C02SCore {
  return {
    a: 0,
    ua: 0xff,
    x: 0,
    ux: 0xff,
    y: 0,
    uy: 0xff,
    s: 0,
    us: 0xff,
    p: Flag.U,
    up: 0xff & ~(Flag.U | Flag.B),
    pc: 0,
    upc: 0xffff,
    ir: 0,
    t: 0,
    seq: Seq.instruction,
    mode: Mode.unknown,
    opAddr: 0,
    ea: 0,
    uea: 0,
    base: 0,
    ubase: 0,
    val: 0,
    uval: 0,
    crossed: 0,
    extra: 0,
    pollI: -1,
    irq: 0,
    nmi: 0,
    lostReason: LostReason.none,
    lostAt: 0,
    addr: 0,
    uaddr: 0xffff,
    write: 0,
    wdata: 0,
    uwdata: 0,
    sync: 0,
    vpb: 1,
    mlb: 1,
  };
}

/** Known registers, as a test or a debugger sets them. */
export interface Registers {
  readonly a: number;
  readonly x: number;
  readonly y: number;
  readonly s: number;
  readonly p: number;
  readonly pc: number;
}

/** Sets every register (all known) and puts the CPU at the opcode fetch at `pc`. */
export function loadRegisters(core: W65C02SCore, registers: Registers): void {
  core.a = registers.a & 0xff;
  core.x = registers.x & 0xff;
  core.y = registers.y & 0xff;
  core.s = registers.s & 0xff;
  core.p = (registers.p | Flag.U) & ~Flag.B & 0xff;
  core.pc = registers.pc & 0xffff;
  core.ua = core.ux = core.uy = core.us = core.up = core.upc = 0;
  core.mode = Mode.running;
  core.lostReason = LostReason.none;
  core.pollI = -1;
  core.extra = 0;
  fetch(core);
}

/** The instruction under way (undefined while fetching an opcode, in a reset or interrupt). */
export function currentInstruction(
  c: W65C02SCore,
): { address: number; opcode: number; cycle: number } | undefined {
  if (c.mode !== Mode.running || c.seq !== Seq.instruction || c.t === 0) return undefined;
  return { address: c.opAddr, opcode: c.ir, cycle: c.t };
}

// ---------------------------------------------------------------------------------------------
// Decoding: what kind of cycle sequence each opcode runs, and which operation.

const K = {
  implied: 0,
  nop1: 1,
  immediate: 2,
  zpRead: 3,
  zpWrite: 4,
  zpModify: 5,
  zpxRead: 6,
  zpxWrite: 7,
  zpxModify: 8,
  absRead: 9,
  absWrite: 10,
  absModify: 11,
  absxRead: 12,
  absxWrite: 13,
  absxModify: 14,
  izxRead: 15,
  izxWrite: 16,
  izyRead: 17,
  izyWrite: 18,
  izRead: 19,
  izWrite: 20,
  jmpAbs: 21,
  jmpInd: 22,
  jmpIndX: 23,
  jsr: 24,
  rts: 25,
  rti: 26,
  brk: 27,
  branch: 28,
  bbx: 29,
  push: 30,
  pull: 31,
  wai: 32,
  stp: 33,
  nopAbs: 34,
} as const;

const STORES = new Set(['STA', 'STX', 'STY', 'STZ']);
const MODIFIES = new Set(['ASL', 'LSR', 'ROL', 'ROR', 'INC', 'DEC', 'TSB', 'TRB']);

function kindOf(mnemonic: string, mode: AddressingMode, reserved: boolean): number {
  const op = mnemonic.replace(/\d$/, '');
  if (reserved) {
    if (mode === 'i') return K.nop1;
    if (mode === '#') return K.immediate;
    if (mode === 'zp') return K.zpRead;
    if (mode === 'zp,x') return K.zpxRead;
    return K.nopAbs;
  }
  switch (mnemonic) {
    case 'JMP':
      return mode === 'a' ? K.jmpAbs : mode === '(a)' ? K.jmpInd : K.jmpIndX;
    case 'JSR':
      return K.jsr;
    case 'RTS':
      return K.rts;
    case 'RTI':
      return K.rti;
    case 'BRK':
      return K.brk;
    case 'WAI':
      return K.wai;
    case 'STP':
      return K.stp;
    case 'PHA':
    case 'PHP':
    case 'PHX':
    case 'PHY':
      return K.push;
    case 'PLA':
    case 'PLP':
    case 'PLX':
    case 'PLY':
      return K.pull;
  }
  if (op === 'BBR' || op === 'BBS') return K.bbx;
  if (op === 'RMB' || op === 'SMB') return K.zpModify;
  const access = STORES.has(op) ? 'w' : MODIFIES.has(op) ? 'm' : 'r';
  switch (mode) {
    case 'i':
    case 'A':
      return K.implied;
    case '#':
      return K.immediate;
    case 'r':
      return K.branch;
    case 'zp':
      return access === 'w' ? K.zpWrite : access === 'm' ? K.zpModify : K.zpRead;
    case 'zp,x':
    case 'zp,y':
      return access === 'w' ? K.zpxWrite : access === 'm' ? K.zpxModify : K.zpxRead;
    case 'a':
      return access === 'w' ? K.absWrite : access === 'm' ? K.absModify : K.absRead;
    case 'a,x':
    case 'a,y':
      return access === 'w' ? K.absxWrite : access === 'm' ? K.absxModify : K.absxRead;
    case '(zp,x)':
      return access === 'w' ? K.izxWrite : K.izxRead;
    case '(zp),y':
      return access === 'w' ? K.izyWrite : K.izyRead;
    case '(zp)':
      return access === 'w' ? K.izWrite : K.izRead;
    default:
      throw new Error(`no cycle sequence for ${mnemonic} ${mode}`);
  }
}

/** Operations, by number, for the ALU switch. */
const O = {
  none: 0,
  LDA: 1,
  LDX: 2,
  LDY: 3,
  ADC: 4,
  SBC: 5,
  AND: 6,
  ORA: 7,
  EOR: 8,
  CMP: 9,
  CPX: 10,
  CPY: 11,
  BIT: 12,
  STA: 13,
  STX: 14,
  STY: 15,
  STZ: 16,
  ASL: 17,
  LSR: 18,
  ROL: 19,
  ROR: 20,
  INC: 21,
  DEC: 22,
  TSB: 23,
  TRB: 24,
  RMB: 25,
  SMB: 26,
} as const;

const KIND = new Uint8Array(256);
const OPER = new Uint8Array(256);
/** Index register of an indexed mode: 1 X, 2 Y. */
const INDEX = new Uint8Array(256);

for (const { opcode, mnemonic, mode, reserved } of W65C02S_OPCODES) {
  KIND[opcode] = kindOf(mnemonic, mode, reserved);
  const op = mnemonic.replace(/\d$/, '');
  OPER[opcode] = reserved ? O.none : ((O as Record<string, number>)[op] ?? O.none);
  INDEX[opcode] = mode === 'a,y' || mode === 'zp,y' || mode === '(zp),y' ? 2 : 1;
}

// ---------------------------------------------------------------------------------------------
// Bus cycles.

function read(c: W65C02SCore, addr: number, uaddr = 0): void {
  c.addr = addr & 0xffff & ~uaddr;
  c.uaddr = uaddr & 0xffff;
  c.write = 0;
  c.wdata = 0;
  c.uwdata = 0;
  c.sync = 0;
  c.vpb = 1;
  c.mlb = 1;
}

function write(c: W65C02SCore, addr: number, uaddr: number, data: number, udata: number): void {
  read(c, addr, uaddr);
  c.write = 1;
  c.wdata = data & 0xff & ~udata;
  c.uwdata = udata & 0xff;
}

function stackAddress(c: W65C02SCore): number {
  return 0x0100 | c.s;
}

function push(c: W65C02SCore, data: number, udata: number): void {
  write(c, stackAddress(c), c.us, data, udata);
  c.s = (c.s - 1) & 0xff;
}

/** Ends a cycle whose data is pulled from the stack: S moves up first. */
function readPull(c: W65C02SCore): void {
  c.s = (c.s + 1) & 0xff;
  read(c, stackAddress(c), c.us);
}

/** The next cycle is the opcode fetch at PC. */
function fetch(c: W65C02SCore): void {
  read(c, c.pc);
  c.sync = 1;
  c.t = 0;
  c.seq = Seq.instruction;
}

/** The CPU no longer knows what it is doing; only a reset brings it back. */
export function lose(c: W65C02SCore, reason: LostReason, at = c.opAddr): void {
  c.mode = Mode.unknown;
  c.upc = 0xffff;
  c.lostReason = reason;
  c.lostAt = at;
  c.sync = 0;
}

/** The end of an instruction: an interrupt sequence or the next opcode fetch. */
function next(c: W65C02SCore): void {
  const i = c.pollI >= 0 ? c.pollI : (c.up & Flag.I) !== 0 ? 2 : (c.p & Flag.I) !== 0 ? 1 : 0;
  c.pollI = -1;
  fetch(c);
  if (c.nmi) {
    c.nmi = 0;
    c.seq = Seq.nmi;
    return;
  }
  if (c.irq === 0 || i === 1) return;
  if (c.irq === 2 || i === 2) {
    lose(c, LostReason.interrupt, c.pc);
    return;
  }
  c.seq = Seq.irq;
}

// ---------------------------------------------------------------------------------------------
// Flags and the ALU, with unknown bits.

function setFlag(c: W65C02SCore, flag: number, on: boolean, unknown: boolean): void {
  if (unknown) {
    c.p &= ~flag;
    c.up |= flag;
  } else {
    c.p = on ? c.p | flag : c.p & ~flag;
    c.up &= ~flag;
  }
}

function setNZ(c: W65C02SCore, v: number, uv: number): void {
  setFlag(c, Flag.N, (v & 0x80) !== 0, (uv & 0x80) !== 0);
  // Z is known 0 when a known bit is 1, known 1 when every bit is known 0.
  if ((v & ~uv & 0xff) !== 0) setFlag(c, Flag.Z, false, false);
  else setFlag(c, Flag.Z, true, uv !== 0);
}

/** Unknown bits of a sum: every bit from the lowest unknown one up. */
function sumUnknown(u: number): number {
  return u === 0 ? 0 : 0xff & ~((u & -u) - 1);
}

function carry(c: W65C02SCore): number {
  return c.p & Flag.C;
}

function carryUnknown(c: W65C02SCore): number {
  return c.up & Flag.C;
}

function adc(c: W65C02SCore, b: number, ub: number): void {
  const a = c.a;
  const ua = c.ua;
  const cin = carry(c);
  const ucin = carryUnknown(c);
  if ((c.p & Flag.D) !== 0) {
    if (ua | ub | ucin) {
      c.a = 0;
      c.ua = 0xff;
      c.p &= ~(Flag.N | Flag.V | Flag.Z | Flag.C);
      c.up |= Flag.N | Flag.V | Flag.Z | Flag.C;
      return;
    }
    // Bruce Clark, "Decimal Mode" (6502.org), appendix A, sequences 1 and 2 (65C02).
    let low = (a & 0x0f) + (b & 0x0f) + cin;
    if (low >= 0x0a) low = ((low + 0x06) & 0x0f) + 0x10;
    let sum = (a & 0xf0) + (b & 0xf0) + low;
    const signed = (((a & 0xf0) << 24) >> 24) + (((b & 0xf0) << 24) >> 24) + low;
    setFlag(c, Flag.V, signed < -128 || signed > 127, false);
    if (sum >= 0xa0) sum += 0x60;
    setFlag(c, Flag.C, sum >= 0x100, false);
    c.a = sum & 0xff;
    c.ua = 0;
    setNZ(c, c.a, 0);
    return;
  }
  const sum = a + b + cin;
  const u = sumUnknown(ua | ub | ucin);
  c.a = sum & 0xff & ~u;
  c.ua = u;
  setFlag(c, Flag.C, sum > 0xff, u !== 0);
  setFlag(c, Flag.V, (~(a ^ b) & (a ^ sum) & 0x80) !== 0, u !== 0);
  setNZ(c, c.a, u);
}

function sbc(c: W65C02SCore, b: number, ub: number): void {
  if ((c.p & Flag.D) === 0) {
    adc(c, ~b & 0xff & ~ub, ub);
    return;
  }
  const a = c.a;
  const cin = carry(c);
  if (c.ua | ub | carryUnknown(c)) {
    c.a = 0;
    c.ua = 0xff;
    c.p &= ~(Flag.N | Flag.V | Flag.Z | Flag.C);
    c.up |= Flag.N | Flag.V | Flag.Z | Flag.C;
    return;
  }
  // Bruce Clark, "Decimal Mode", appendix A, sequence 3; C and V as in binary.
  const binary = a + (~b & 0xff) + cin;
  setFlag(c, Flag.C, binary > 0xff, false);
  setFlag(c, Flag.V, ((a ^ b) & (a ^ binary) & 0x80) !== 0, false);
  const low = (a & 0x0f) - (b & 0x0f) + cin - 1;
  let result = a - b + cin - 1;
  if (result < 0) result -= 0x60;
  if (low < 0) result -= 0x06;
  c.a = result & 0xff;
  c.ua = 0;
  setNZ(c, c.a, 0);
}

function compare(c: W65C02SCore, r: number, ur: number, b: number, ub: number): void {
  const diff = r + (~b & 0xff) + 1;
  const u = sumUnknown(ur | ub);
  setFlag(c, Flag.C, diff > 0xff, u !== 0);
  setNZ(c, diff & 0xff & ~u, u);
}

/** AND with unknown bits: a bit is known where either side is a known 0, or both are known. */
function andUnknown(a: number, ua: number, b: number, ub: number): number {
  const knownZero = (~a & ~ua) | (~b & ~ub);
  return (ua | ub) & ~knownZero & 0xff;
}

function orUnknown(a: number, ua: number, b: number, ub: number): number {
  const knownOne = (a & ~ua) | (b & ~ub);
  return (ua | ub) & ~knownOne & 0xff;
}

/** A read instruction's operation on the operand. */
function operate(c: W65C02SCore, op: number, v: number, uv: number): void {
  switch (op) {
    case O.LDA:
      c.a = v;
      c.ua = uv;
      setNZ(c, v, uv);
      return;
    case O.LDX:
      c.x = v;
      c.ux = uv;
      setNZ(c, v, uv);
      return;
    case O.LDY:
      c.y = v;
      c.uy = uv;
      setNZ(c, v, uv);
      return;
    case O.ADC:
    case O.SBC:
      if ((c.up & Flag.D) !== 0) {
        lose(c, LostReason.decimal);
        return;
      }
      if ((c.p & Flag.D) !== 0) c.extra = 1;
      if (op === O.ADC) adc(c, v, uv);
      else sbc(c, v, uv);
      return;
    case O.AND: {
      const u = andUnknown(c.a, c.ua, v, uv);
      c.a = c.a & v & ~u;
      c.ua = u;
      setNZ(c, c.a, u);
      return;
    }
    case O.ORA: {
      const u = orUnknown(c.a, c.ua, v, uv);
      c.a = (c.a | v) & ~u;
      c.ua = u;
      setNZ(c, c.a, u);
      return;
    }
    case O.EOR: {
      const u = (c.ua | uv) & 0xff;
      c.a = (c.a ^ v) & ~u;
      c.ua = u;
      setNZ(c, c.a, u);
      return;
    }
    case O.CMP:
      compare(c, c.a, c.ua, v, uv);
      return;
    case O.CPX:
      compare(c, c.x, c.ux, v, uv);
      return;
    case O.CPY:
      compare(c, c.y, c.uy, v, uv);
      return;
    case O.BIT: {
      const u = andUnknown(c.a, c.ua, v, uv);
      const and = c.a & v & ~u;
      if ((and & ~u & 0xff) !== 0) setFlag(c, Flag.Z, false, false);
      else setFlag(c, Flag.Z, true, u !== 0);
      if (c.ir !== 0x89) {
        // BIT # sets Z only (Table 6-4).
        setFlag(c, Flag.N, (v & 0x80) !== 0, (uv & 0x80) !== 0);
        setFlag(c, Flag.V, (v & 0x40) !== 0, (uv & 0x40) !== 0);
      }
      return;
    }
  }
}

/** What a store writes (into `val`, `uval`). */
function storeValue(c: W65C02SCore, op: number): void {
  switch (op) {
    case O.STA:
      c.val = c.a;
      c.uval = c.ua;
      return;
    case O.STX:
      c.val = c.x;
      c.uval = c.ux;
      return;
    case O.STY:
      c.val = c.y;
      c.uval = c.uy;
      return;
    default:
      c.val = 0;
      c.uval = 0;
  }
}

/** A read-modify-write's operation on `val`/`uval` (and on A for the accumulator forms). */
function modify(c: W65C02SCore, op: number, v: number, uv: number): void {
  let r = v;
  let ur = uv;
  switch (op) {
    case O.ASL:
      setFlag(c, Flag.C, (v & 0x80) !== 0, (uv & 0x80) !== 0);
      r = (v << 1) & 0xff;
      ur = (uv << 1) & 0xff;
      break;
    case O.LSR:
      setFlag(c, Flag.C, (v & 1) !== 0, (uv & 1) !== 0);
      r = v >> 1;
      ur = uv >> 1;
      break;
    case O.ROL: {
      const cin = carry(c);
      const ucin = carryUnknown(c);
      setFlag(c, Flag.C, (v & 0x80) !== 0, (uv & 0x80) !== 0);
      r = ((v << 1) | cin) & 0xff;
      ur = ((uv << 1) | ucin) & 0xff;
      break;
    }
    case O.ROR: {
      const cin = carry(c);
      const ucin = carryUnknown(c);
      setFlag(c, Flag.C, (v & 1) !== 0, (uv & 1) !== 0);
      r = (v >> 1) | (cin << 7);
      ur = (uv >> 1) | (ucin << 7);
      break;
    }
    case O.INC:
      ur = sumUnknown(uv);
      r = (v + 1) & 0xff & ~ur;
      break;
    case O.DEC:
      ur = sumUnknown(uv);
      r = (v - 1) & 0xff & ~ur;
      break;
    case O.TSB:
    case O.TRB: {
      const u = andUnknown(c.a, c.ua, v, uv);
      if ((c.a & v & ~u & 0xff) !== 0) setFlag(c, Flag.Z, false, false);
      else setFlag(c, Flag.Z, true, u !== 0);
      if (op === O.TSB) {
        ur = orUnknown(v, uv, c.a, c.ua);
        r = (v | c.a) & ~ur;
      } else {
        ur = andUnknown(v, uv, ~c.a & 0xff, c.ua);
        r = v & ~c.a & ~ur;
      }
      c.val = r & 0xff;
      c.uval = ur;
      return;
    }
    case O.RMB:
    case O.SMB: {
      const bit = 1 << ((c.ir >> 4) & 7);
      ur = uv & ~bit;
      r = op === O.SMB ? v | bit : v & ~bit;
      c.val = r & 0xff & ~ur;
      c.uval = ur;
      return;
    }
  }
  c.val = r & ~ur;
  c.uval = ur;
  setNZ(c, c.val, ur);
}

// ---------------------------------------------------------------------------------------------
// Addresses.

/**
 * Adds an index to a base (`base`/`ubase`, 16 bits) into `ea`/`uea` and decides whether it
 * crossed a page: 0 no, 1 yes, 2 unknown.
 */
function indexAddress(c: W65C02SCore, index: number, uindex: number): number {
  const low = c.base & 0xff;
  const ulow = c.ubase & 0xff;
  const lowUnknown = sumUnknown(ulow | uindex);
  const minSum = low + index;
  const maxSum = (low | ulow) + (index | uindex);
  const crossed = minSum > 0xff ? 1 : maxSum > 0xff ? 2 : 0;
  const high = (c.base >> 8) & 0xff;
  const uhigh = (c.ubase >> 8) & 0xff;
  const highUnknown = crossed === 2 ? sumUnknown(uhigh | 1) : sumUnknown(uhigh) | 0;
  const highSum = (high + (crossed === 1 ? 1 : 0)) & 0xff;
  c.uea = (highUnknown << 8) | lowUnknown;
  c.ea = ((highSum << 8) | ((low + index) & 0xff)) & ~c.uea & 0xffff;
  return crossed;
}

/** A zero-page address plus an index, wrapping in page 0, into `ea`/`uea`. */
function zeroPageIndexed(c: W65C02SCore, index: number, uindex: number): void {
  c.uea = sumUnknown((c.ubase & 0xff) | uindex);
  c.ea = (c.base + index) & 0xff & ~c.uea;
}

function indexRegister(c: W65C02SCore): number {
  return INDEX[c.ir] === 2 ? c.y : c.x;
}

function indexUnknown(c: W65C02SCore): number {
  return INDEX[c.ir] === 2 ? c.uy : c.ux;
}

/** The next byte of the instruction: a read at PC, which then moves on. */
function readOperand(c: W65C02SCore): void {
  read(c, c.pc);
  c.pc = (c.pc + 1) & 0xffff;
}

/** A dummy read of the instruction's last byte (page fix-ups, indexed stores). */
function readLastByte(c: W65C02SCore): void {
  read(c, (c.pc - 1) & 0xffff);
}

/** Sets PC to a 16-bit value read from the bus; unknown bits lose the CPU. */
function jump(c: W65C02SCore, value: number, unknown: number): boolean {
  if (unknown) {
    lose(c, LostReason.pc);
    return false;
  }
  c.pc = value & 0xffff;
  c.upc = 0;
  return true;
}

// ---------------------------------------------------------------------------------------------
// The cycle step.

/**
 * Ends the cycle on the bus: `data` is the byte read and `unknown` its unknown bits (both
 * ignored for a write cycle). Sets up the next cycle. Nothing happens unless running (the part
 * handles reset, `WAI`, `STP` and a lost CPU).
 */
export function endCycle(c: W65C02SCore, data: number, unknown: number): void {
  if (c.mode === Mode.waiting) {
    wakeFromWait(c);
    return;
  }
  if (c.mode !== Mode.running) return;
  const d = data & 0xff & ~unknown;
  const ud = unknown & 0xff;
  if (c.seq !== Seq.instruction) {
    interruptCycle(c, d);
    return;
  }
  if (c.t === 0xfe) {
    next(c);
    return;
  }
  if (c.t === 0) {
    if (ud) {
      lose(c, LostReason.opcode, c.addr);
      return;
    }
    c.ir = d;
    c.opAddr = c.pc;
    c.pc = (c.pc + 1) & 0xffff;
    c.t = 1;
    firstCycle(c);
    return;
  }
  const t = c.t;
  c.t = t + 1;
  step(c, t, d, ud);
}

/** Sets up cycle 1 of the instruction just fetched. */
function firstCycle(c: W65C02SCore): void {
  switch (KIND[c.ir]) {
    case K.nop1:
      next(c);
      return;
    case K.implied:
    case K.push:
    case K.pull:
    case K.rts:
    case K.rti:
    case K.wai:
    case K.stp:
      read(c, c.pc);
      return;
    default:
      // Every other instruction reads its first operand byte.
      readOperand(c);
  }
}

/** Ends cycle `t` (≥ 1) of an instruction with the data read, and sets up the next cycle. */
function step(c: W65C02SCore, t: number, d: number, ud: number): void {
  const op = OPER[c.ir] ?? O.none;
  switch (KIND[c.ir]) {
    case K.implied:
      implied(c);
      next(c);
      return;
    case K.immediate:
      if (op !== O.none) operate(c, op, d, ud);
      if (c.mode !== Mode.running) return;
      if (c.extra) {
        // The decimal-mode cycle: an internal one, at PC like the 65C02's other internal
        // cycles (SingleStepTests reads an address with no physical meaning there).
        c.extra = 0;
        read(c, c.pc);
        c.t = 0xfe;
        return;
      }
      next(c);
      return;
    case K.zpRead:
    case K.zpWrite:
    case K.zpModify:
      zeroPage(c, t, d, ud, op);
      return;
    case K.zpxRead:
    case K.zpxWrite:
    case K.zpxModify:
      zeroPageX(c, t, d, ud, op);
      return;
    case K.absRead:
    case K.absWrite:
    case K.absModify:
      absolute(c, t, d, ud, op);
      return;
    case K.absxRead:
    case K.absxWrite:
    case K.absxModify:
      absoluteX(c, t, d, ud, op);
      return;
    case K.izxRead:
    case K.izxWrite:
      indexedIndirect(c, t, d, ud, op);
      return;
    case K.izyRead:
    case K.izyWrite:
      indirectIndexed(c, t, d, ud, op);
      return;
    case K.izRead:
    case K.izWrite:
      zeroPageIndirect(c, t, d, ud, op);
      return;
    case K.jmpAbs:
      if (t === 1) {
        c.base = d;
        c.ubase = ud;
        readOperand(c);
      } else if (jump(c, (d << 8) | c.base, (ud << 8) | c.ubase)) next(c);
      return;
    case K.jmpInd:
      jumpIndirect(c, t, d, ud);
      return;
    case K.jmpIndX:
      jumpIndexedIndirect(c, t, d, ud);
      return;
    case K.jsr:
      jumpSubroutine(c, t, d, ud);
      return;
    case K.rts:
      returnFromSubroutine(c, t, d, ud);
      return;
    case K.rti:
      returnFromInterrupt(c, t, d, ud);
      return;
    case K.brk:
      // Cycle 1 read the signature byte; the rest is the interrupt sequence's.
      c.seq = Seq.brk;
      c.t = 2;
      pushPCH(c);
      return;
    case K.branch:
      branch(c, t, d, ud);
      return;
    case K.bbx:
      branchOnBit(c, t, d, ud);
      return;
    case K.push:
      pushRegister(c, t);
      return;
    case K.pull:
      pullRegister(c, t, d, ud);
      return;
    case K.wai:
    case K.stp:
      if (t === 1) {
        read(c, c.pc);
        return;
      }
      c.mode = KIND[c.ir] === K.wai ? Mode.waiting : Mode.stopped;
      c.t = 0;
      return;
    case K.nopAbs:
      // `DC`, `FC`: 4 cycles, `5C`: 8 (Table 7-1); after the operand, reads of its last byte.
      if (t === 1) readOperand(c);
      else if (t < (W65C02S_OPCODES[c.ir]?.cycles ?? 4) - 1) readLastByte(c);
      else next(c);
      return;
  }
}

/** The second cycle of a two-cycle implied or accumulator instruction. */
function implied(c: W65C02SCore): void {
  switch (c.ir) {
    case 0x18:
      setFlag(c, Flag.C, false, false);
      return;
    case 0x38:
      setFlag(c, Flag.C, true, false);
      return;
    case 0x58:
      c.pollI = iState(c);
      setFlag(c, Flag.I, false, false);
      return;
    case 0x78:
      c.pollI = iState(c);
      setFlag(c, Flag.I, true, false);
      return;
    case 0xb8:
      setFlag(c, Flag.V, false, false);
      return;
    case 0xd8:
      setFlag(c, Flag.D, false, false);
      return;
    case 0xf8:
      setFlag(c, Flag.D, true, false);
      return;
    case 0xaa:
      c.x = c.a;
      c.ux = c.ua;
      setNZ(c, c.x, c.ux);
      return;
    case 0xa8:
      c.y = c.a;
      c.uy = c.ua;
      setNZ(c, c.y, c.uy);
      return;
    case 0x8a:
      c.a = c.x;
      c.ua = c.ux;
      setNZ(c, c.a, c.ua);
      return;
    case 0x98:
      c.a = c.y;
      c.ua = c.uy;
      setNZ(c, c.a, c.ua);
      return;
    case 0xba:
      c.x = c.s;
      c.ux = c.us;
      setNZ(c, c.x, c.ux);
      return;
    case 0x9a:
      c.s = c.x;
      c.us = c.ux;
      return;
    case 0xe8:
    case 0xc8:
    case 0xca:
    case 0x88: {
      const isX = c.ir === 0xe8 || c.ir === 0xca;
      const v = isX ? c.x : c.y;
      const u = sumUnknown(isX ? c.ux : c.uy);
      const r = (v + (c.ir === 0xe8 || c.ir === 0xc8 ? 1 : -1)) & 0xff & ~u;
      if (isX) {
        c.x = r;
        c.ux = u;
      } else {
        c.y = r;
        c.uy = u;
      }
      setNZ(c, r, u);
      return;
    }
    case 0xea:
      return;
    default: {
      // Accumulator forms of the read-modify-write instructions.
      const op = OPER[c.ir] ?? O.none;
      if (op === O.none) return;
      modify(c, op, c.a, c.ua);
      c.a = c.val;
      c.ua = c.uval;
    }
  }
}

/** I for the interrupt poll: 0 clear, 1 set, 2 unknown. */
function iState(c: W65C02SCore): number {
  return (c.up & Flag.I) !== 0 ? 2 : (c.p & Flag.I) !== 0 ? 1 : 0;
}

/** The last cycles of a memory instruction once its effective address is in `ea`. */
function access(c: W65C02SCore, op: number): void {
  const kind = KIND[c.ir];
  if (isWrite(kind)) {
    storeValue(c, op);
    write(c, c.ea, c.uea, c.val, c.uval);
  } else {
    read(c, c.ea, c.uea);
  }
}

function isWrite(kind: number | undefined): boolean {
  return (
    kind === K.zpWrite ||
    kind === K.zpxWrite ||
    kind === K.absWrite ||
    kind === K.absxWrite ||
    kind === K.izxWrite ||
    kind === K.izyWrite ||
    kind === K.izWrite
  );
}

function isModify(kind: number | undefined): boolean {
  return (
    kind === K.zpModify || kind === K.zpxModify || kind === K.absModify || kind === K.absxModify
  );
}

/**
 * The cycles after the effective address went on the bus at cycle `at`: a read operates and
 * ends (decimal mode: once more at the address); a write ends; a read-modify-write reads it
 * again (modify, MLB LOW) and writes it (MLB LOW).
 */
function finish(c: W65C02SCore, t: number, at: number, d: number, ud: number, op: number): void {
  const kind = KIND[c.ir];
  if (isModify(kind)) {
    if (t === at) {
      c.val = d;
      c.uval = ud;
      read(c, c.ea, c.uea);
      c.mlb = 0;
    } else if (t === at + 1) {
      modify(c, op, c.val, c.uval);
      write(c, c.ea, c.uea, c.val, c.uval);
      c.mlb = 0;
    } else next(c);
    return;
  }
  if (isWrite(kind)) {
    next(c);
    return;
  }
  if (t === at) {
    if (op !== O.none) operate(c, op, d, ud);
    if (c.mode !== Mode.running) return;
    if (c.extra) {
      c.extra = 0;
      read(c, c.ea, c.uea);
      c.t = 0xfe;
      return;
    }
  }
  next(c);
}

function zeroPage(c: W65C02SCore, t: number, d: number, ud: number, op: number): void {
  if (t === 1) {
    c.ea = d;
    c.uea = ud;
    access(c, op);
    return;
  }
  finish(c, t, 2, d, ud, op);
}

function zeroPageX(c: W65C02SCore, t: number, d: number, ud: number, op: number): void {
  if (t === 1) {
    c.base = d;
    c.ubase = ud;
    read(c, d, ud); // the 65C02 reads the base address while it adds the index
    return;
  }
  if (t === 2) {
    zeroPageIndexed(c, indexRegister(c), indexUnknown(c));
    access(c, op);
    return;
  }
  finish(c, t, 3, d, ud, op);
}

function absolute(c: W65C02SCore, t: number, d: number, ud: number, op: number): void {
  if (t === 1) {
    c.base = d;
    c.ubase = ud;
    readOperand(c);
    return;
  }
  if (t === 2) {
    c.ea = (d << 8) | c.base;
    c.uea = (ud << 8) | c.ubase;
    access(c, op);
    return;
  }
  finish(c, t, 3, d, ud, op);
}

function absoluteX(c: W65C02SCore, t: number, d: number, ud: number, op: number): void {
  const kind = KIND[c.ir];
  if (t === 1) {
    c.base = d;
    c.ubase = ud;
    readOperand(c);
    return;
  }
  if (t === 2) {
    c.base |= d << 8;
    c.ubase |= ud << 8;
    c.crossed = indexAddress(c, indexRegister(c), indexUnknown(c));
    // Stores and INC/DEC always take the fix-up cycle; reads and shifts when a page is crossed.
    const always = kind === K.absxWrite || op === O.INC || op === O.DEC;
    if (!always && c.crossed === 2) {
      lose(c, LostReason.page);
      return;
    }
    if (always || c.crossed === 1) {
      c.crossed = 1;
      readLastByte(c);
      return;
    }
    access(c, op);
    return;
  }
  const at = c.crossed === 1 ? 4 : 3;
  if (t === 3 && at === 4) {
    access(c, op);
    return;
  }
  finish(c, t, at, d, ud, op);
}

function indexedIndirect(c: W65C02SCore, t: number, d: number, ud: number, op: number): void {
  switch (t) {
    case 1:
      c.base = d;
      c.ubase = ud;
      read(c, d, ud);
      return;
    case 2:
      zeroPageIndexed(c, c.x, c.ux);
      c.base = c.ea;
      c.ubase = c.uea;
      read(c, c.base, c.ubase);
      return;
    case 3:
      c.val = d;
      c.uval = ud;
      read(c, (c.base + 1) & 0xff & ~sumUnknown(c.ubase), sumUnknown(c.ubase));
      return;
    case 4:
      c.ea = (d << 8) | c.val;
      c.uea = (ud << 8) | c.uval;
      access(c, op);
      return;
    default:
      finish(c, t, 5, d, ud, op);
  }
}

function indirectIndexed(c: W65C02SCore, t: number, d: number, ud: number, op: number): void {
  const kind = KIND[c.ir];
  switch (t) {
    case 1:
      c.val = d;
      c.uval = ud;
      read(c, d, ud);
      return;
    case 2: {
      c.base = d;
      c.ubase = ud;
      const u = sumUnknown(c.uval);
      read(c, (c.val + 1) & 0xff & ~u, u);
      return;
    }
    case 3: {
      c.base |= d << 8;
      c.ubase |= ud << 8;
      c.crossed = indexAddress(c, c.y, c.uy);
      const always = kind === K.izyWrite;
      if (!always && c.crossed === 2) {
        lose(c, LostReason.page);
        return;
      }
      if (always || c.crossed === 1) {
        c.crossed = 1;
        readLastByte(c);
        return;
      }
      access(c, op);
      return;
    }
    default: {
      const at = c.crossed === 1 ? 5 : 4;
      if (t === 4 && at === 5) {
        access(c, op);
        return;
      }
      finish(c, t, at, d, ud, op);
    }
  }
}

function zeroPageIndirect(c: W65C02SCore, t: number, d: number, ud: number, op: number): void {
  switch (t) {
    case 1:
      c.val = d;
      c.uval = ud;
      read(c, d, ud);
      return;
    case 2: {
      c.base = d;
      c.ubase = ud;
      const u = sumUnknown(c.uval);
      read(c, (c.val + 1) & 0xff & ~u, u);
      return;
    }
    case 3:
      c.ea = (d << 8) | c.base;
      c.uea = (ud << 8) | c.ubase;
      access(c, op);
      return;
    default:
      finish(c, t, 4, d, ud, op);
  }
}

function jumpIndirect(c: W65C02SCore, t: number, d: number, ud: number): void {
  switch (t) {
    case 1:
      c.base = d;
      c.ubase = ud;
      readOperand(c);
      return;
    case 2:
      c.base |= d << 8;
      c.ubase |= ud << 8;
      if (c.ubase) {
        lose(c, LostReason.pc);
        return;
      }
      read(c, c.base);
      return;
    case 3:
      c.val = d;
      c.uval = ud;
      // First the high byte's address without the carry (where the NMOS 6502 stops), …
      read(c, (c.base & 0xff00) | ((c.base + 1) & 0xff));
      return;
    case 4:
      // … then with it: "page address increments, one additional cycle" (Table 7-1).
      read(c, (c.base + 1) & 0xffff);
      return;
    default:
      if (jump(c, (d << 8) | c.val, (ud << 8) | c.uval)) next(c);
  }
}

function jumpIndexedIndirect(c: W65C02SCore, t: number, d: number, ud: number): void {
  switch (t) {
    case 1:
      c.base = d;
      c.ubase = ud;
      readOperand(c);
      return;
    case 2:
      c.base |= d << 8;
      c.ubase |= ud << 8;
      read(c, (c.pc - 2) & 0xffff); // the operand's first byte again, while X is added
      return;
    case 3: {
      const u = (c.ubase | c.ux) !== 0;
      if (u) {
        lose(c, LostReason.pc);
        return;
      }
      c.base = (c.base + c.x) & 0xffff;
      read(c, c.base);
      return;
    }
    case 4:
      c.val = d;
      c.uval = ud;
      read(c, (c.base + 1) & 0xffff);
      return;
    default:
      if (jump(c, (d << 8) | c.val, (ud << 8) | c.uval)) next(c);
  }
}

function jumpSubroutine(c: W65C02SCore, t: number, d: number, ud: number): void {
  switch (t) {
    case 1:
      c.val = d;
      c.uval = ud;
      read(c, stackAddress(c), c.us);
      return;
    case 2:
      push(c, c.pc >> 8, 0);
      return;
    case 3:
      push(c, c.pc & 0xff, 0);
      return;
    case 4:
      read(c, c.pc);
      return;
    default:
      if (jump(c, (d << 8) | c.val, (ud << 8) | c.uval)) next(c);
  }
}

function returnFromSubroutine(c: W65C02SCore, t: number, d: number, ud: number): void {
  switch (t) {
    case 1:
      read(c, stackAddress(c), c.us);
      return;
    case 2:
      readPull(c);
      return;
    case 3:
      c.val = d;
      c.uval = ud;
      readPull(c);
      return;
    case 4:
      if (!jump(c, (d << 8) | c.val, (ud << 8) | c.uval)) return;
      read(c, c.pc);
      return;
    default:
      c.pc = (c.pc + 1) & 0xffff;
      next(c);
  }
}

function returnFromInterrupt(c: W65C02SCore, t: number, d: number, ud: number): void {
  switch (t) {
    case 1:
      read(c, stackAddress(c), c.us);
      return;
    case 2:
      readPull(c);
      return;
    case 3:
      c.p = (d | Flag.U) & ~Flag.B;
      c.up = ud & ~(Flag.U | Flag.B);
      readPull(c);
      return;
    case 4:
      c.val = d;
      c.uval = ud;
      readPull(c);
      return;
    default:
      if (jump(c, (d << 8) | c.val, (ud << 8) | c.uval)) next(c);
  }
}

/** Branch condition of a relative branch: 0 no, 1 yes, 2 unknown. */
function condition(c: W65C02SCore): number {
  if (c.ir === 0x80) return 1;
  const flag = [Flag.N, Flag.V, Flag.C, Flag.Z][c.ir >> 6] ?? Flag.N;
  if ((c.up & flag) !== 0) return 2;
  const set = (c.p & flag) !== 0;
  return set === ((c.ir & 0x20) !== 0) ? 1 : 0;
}

/** Ends cycle 1 of a branch with its displacement and sets up the next cycles. */
function takeBranch(c: W65C02SCore, taken: number, d: number, ud: number, dummyAt: number): void {
  if (taken === 2 || (taken === 1 && ud !== 0)) {
    lose(c, LostReason.branch);
    return;
  }
  if (taken === 0) {
    next(c);
    return;
  }
  const target = (c.pc + ((d << 24) >> 24)) & 0xffff;
  c.ea = target;
  c.crossed = (target & 0xff00) !== (c.pc & 0xff00) ? 1 : 0;
  read(c, dummyAt);
}

function branch(c: W65C02SCore, t: number, d: number, ud: number): void {
  if (t === 1) {
    takeBranch(c, condition(c), d, ud, c.pc);
    return;
  }
  if (t === 2 && c.crossed) {
    // The fix-up cycle reads the old page at the new offset.
    read(c, (c.pc & 0xff00) | (c.ea & 0xff));
    return;
  }
  c.pc = c.ea;
  next(c);
}

function branchOnBit(c: W65C02SCore, t: number, d: number, ud: number): void {
  switch (t) {
    case 1:
      c.base = d;
      c.ubase = ud;
      read(c, d, ud);
      return;
    case 2:
      c.val = d;
      c.uval = ud;
      read(c, c.base, c.ubase);
      return;
    case 3:
      readOperand(c);
      return;
    case 4: {
      const bit = 1 << ((c.ir >> 4) & 7);
      const wantSet = (c.ir & 0x80) !== 0;
      const taken = (c.uval & bit) !== 0 ? 2 : ((c.val & bit) !== 0) === wantSet ? 1 : 0;
      takeBranch(c, taken, d, ud, c.pc);
      return;
    }
    case 5:
      if (c.crossed) {
        read(c, c.pc);
        return;
      }
      c.pc = c.ea;
      next(c);
      return;
    default:
      c.pc = c.ea;
      next(c);
  }
}

function pushRegister(c: W65C02SCore, t: number): void {
  if (t === 1) {
    switch (c.ir) {
      case 0x48:
        push(c, c.a, c.ua);
        return;
      case 0x08:
        push(c, c.p | Flag.B | Flag.U, c.up);
        return;
      case 0xda:
        push(c, c.x, c.ux);
        return;
      default:
        push(c, c.y, c.uy);
        return;
    }
  }
  next(c);
}

function pullRegister(c: W65C02SCore, t: number, d: number, ud: number): void {
  if (t === 1) {
    read(c, stackAddress(c), c.us);
    return;
  }
  if (t === 2) {
    readPull(c);
    return;
  }
  switch (c.ir) {
    case 0x68:
      c.a = d;
      c.ua = ud;
      setNZ(c, d, ud);
      break;
    case 0x28:
      c.pollI = iState(c);
      c.p = (d | Flag.U) & ~Flag.B;
      c.up = ud & ~(Flag.U | Flag.B);
      break;
    case 0xfa:
      c.x = d;
      c.ux = ud;
      setNZ(c, d, ud);
      break;
    default:
      c.y = d;
      c.uy = ud;
      setNZ(c, d, ud);
  }
  next(c);
}

// ---------------------------------------------------------------------------------------------
// Interrupt and reset sequences.

function pushPCH(c: W65C02SCore): void {
  push(c, c.pc >> 8, 0);
}

/**
 * IRQ, NMI and BRK (from cycle 2), and reset: seven cycles ending with the vector read (VPB
 * LOW). The hardware interrupts' first cycle is the opcode fetch, its byte ignored; a reset
 * reads where an interrupt pushes (W65C816S Table 5-7, emulation mode).
 */
function interruptCycle(c: W65C02SCore, d: number): void {
  const t = c.t;
  c.t = t + 1;
  const reset = c.seq === Seq.reset;
  switch (t) {
    case 0:
      // The cycle after the opcode fetch the interrupt replaced, or reset's second: PC stays.
      if (!reset) c.opAddr = c.pc;
      read(c, c.pc, c.upc);
      return;
    case 1:
    case 2:
    case 3:
      if (reset) {
        read(c, stackAddress(c), c.us);
        c.s = (c.s - 1) & 0xff;
      } else if (t === 1) pushPCH(c);
      else if (t === 2) push(c, c.pc & 0xff, 0);
      else push(c, c.p | Flag.U | (c.seq === Seq.brk ? Flag.B : 0), c.up);
      return;
    case 4:
      vectorRead(c, reset ? 0xfffc : c.seq === Seq.nmi ? 0xfffa : 0xfffe);
      return;
    case 5:
      c.val = d;
      vectorRead(c, c.addr + 1);
      return;
    default:
      if (jump(c, (d << 8) | c.val, 0)) next(c);
  }
}

/** RESB sampled LOW: the CPU stops what it does and reads (RWB HIGH) until RESB rises. */
export function holdReset(c: W65C02SCore): void {
  c.mode = Mode.reset;
  c.lostReason = LostReason.none;
  c.extra = 0;
  read(c, c.pc, c.upc);
}

/** RESB rose: the seven-cycle reset sequence starts with the next cycle (§3.11). */
export function startReset(c: W65C02SCore): void {
  c.mode = Mode.running;
  c.seq = Seq.reset;
  c.t = 0;
  c.pollI = -1;
  c.nmi = 0;
  read(c, c.pc, c.upc);
}

/** SOB fell: V is set (§3.12). */
export function setOverflow(c: W65C02SCore): void {
  setFlag(c, Flag.V, true, false);
}

/** `WAI` ends on IRQB LOW (with I set the program goes on without the interrupt) or NMIB. */
function wakeFromWait(c: W65C02SCore): void {
  if (c.nmi || c.irq === 1) {
    c.mode = Mode.running;
    next(c);
  } else if (c.irq === 2) {
    lose(c, LostReason.interrupt, c.pc);
  }
}

function vectorRead(c: W65C02SCore, address: number): void {
  read(c, address);
  c.vpb = 0;
  // An interrupt or reset sets I and clears D as the vector is read (Table 7-1).
  setFlag(c, Flag.I, true, false);
  setFlag(c, Flag.D, false, false);
}
