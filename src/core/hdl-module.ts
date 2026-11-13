/**
 * The IR of a Verilog module (HDL-1, ADR-0030): what the library's converter makes of Yosys's
 * JSON netlist, what a document keeps as a module, and what the library's interpreter runs.
 * Plain JSON-serializable data. Here: its types, the cells modules run, the pins a port gives and
 * the shape check documents are loaded with; the semantic checks (one driver per bit, what the
 * interpreter can't run) are the analysis's. Spec: docs/components.md#verilog-modules-hdl.
 */
import type { AnyComponentDefinition, PinDir, PropDef } from './component';
import { readHdlMemoryInit } from './hdl-memory';
import { BUS_NAME } from './net-names';
import { ns } from './time';
import type { Edge } from './timing-checks';

/** The IR's format; a change gets a document migration. */
export const HDL_FORMAT = 1;

/** The family of the parts modules run as: `hdl/<circuit id>` (reserved, like `sub`). */
export const HDL_FAMILY = 'hdl';

/** The part type a document's module runs as. */
export function hdlPartType(circuitId: string): string {
  return `${HDL_FAMILY}/${circuitId}`;
}

/** The output delay of a module without timing: an ATF22V10C-15's tPD (HDL-1's Q4). */
export const HDL_DEFAULT_DELAY = ns(15);

/** A module part's one property, also its instances': the delay of every output. */
export const hdlDelayProp: PropDef = {
  key: 'delay',
  label: 'Delay',
  type: 'time',
  default: HDL_DEFAULT_DELAY,
  min: 0,
};

/**
 * One bit of a connection: a signal bit (an index below `bitCount`) or a constant. Yosys's `z`
 * reaches only port bits (`HdlPortBit`): inside the module a released net reads `x`.
 */
export type HdlBit = number | '0' | '1' | 'x';

/** A port's bit: a connection's, or `z` where the module never drives an output or inout bit. */
export type HdlPortBit = HdlBit | 'z';

/**
 * A port of the module. An `inout` (HDL-8) is a pin that drives and reads: where a `$tribuf`
 * drives its bit, or nothing does, the module reads the pin's level there; where other logic
 * does, the pin always drives it.
 */
export interface HdlPort {
  /** Its Verilog name: `addr`. */
  readonly name: string;
  readonly dir: 'in' | 'out' | 'inout';
  /** The Verilog index of `bits[0]`: `addr[15:12]` has `lsb` 12. */
  readonly lsb: number;
  /**
   * Least significant first. An input's are distinct signal bits; an output's or an inout's may
   * be any, `z` too (never driven).
   */
  readonly bits: readonly HdlPortBit[];
  /** An output register's power-up value (`output reg q = 1`), as a signal's `init`. */
  readonly init?: readonly HdlBit[];
  /** Where it is declared: `decoder.v:3.18-3.22`. */
  readonly src?: string;
}

/** A named signal inside the module (not a port), kept through synthesis (HDL-4). */
export interface HdlSignal {
  readonly name: string;
  readonly lsb: number;
  readonly bits: readonly HdlBit[];
  /** Its power-up value (`reg q = 1`), least significant first: the bits start at it (HDL-9). */
  readonly init?: readonly HdlBit[];
  readonly src?: string;
}

/**
 * A memory of the module (HDL-6): a Verilog array Yosys kept as one (`reg [7:0] m[0:255]`), read
 * by `$memrd` cells and written by `$memwr` cells. Its words are addressed as in the source: from
 * `offset` to `offset + size − 1`.
 */
export interface HdlMemory {
  /** Its Verilog name: `rom`, a flattened submodule's `u_fifo.mem`. */
  readonly name: string;
  /** Bits per word. */
  readonly width: number;
  /** The number of words. */
  readonly size: number;
  /** The Verilog address of its first word: `reg [7:0] m[16:25]` has 16. */
  readonly offset: number;
  /**
   * Its power-up contents (`initial`, `$readmemh`, read by Yosys): runs `ADDR:WORDS` in hex,
   * `x` digits unknown (`readHdlMemoryInit`). Words no run gives, and all without it, start `X`.
   */
  readonly init?: string;
  readonly src?: string;
}

/** A cell: one of `HDL_CELLS`, its ports' bits and its parameters. */
export interface HdlCell {
  readonly type: HdlCellType;
  /** Where it comes from: `counter.v:9.3-11.53` (the first of Yosys's locations); `''` if none. */
  readonly src: string;
  /** Yosys's port names (`A`, `B`, `Y`, `CLK`, `D`, `Q`, …), each least significant bit first. */
  readonly ports: Readonly<Record<string, readonly HdlBit[]>>;
  /**
   * Polarities (0 or 1), the operands' signedness (`A_SIGNED`, `B_SIGNED`: 1, or absent for
   * unsigned), reset values (bits, least significant first), a memory port's memory (`MEMORY`, an
   * index into `memories`) and a write port's priority (`PRIORITY`, bits, HDL-6).
   */
  readonly params: Readonly<Record<string, number | readonly HdlBit[]>>;
}

/** What a module's conversion or check says, with the source location it is about. */
export interface HdlMessage {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  /** `decoder.v:12.3-12.20`, when there is one. */
  readonly src?: string;
}

/** The part a module runs as (`ComponentRegistry.hdlPart`): none when it has errors. */
export interface HdlPartResult {
  readonly definition?: AnyComponentDefinition;
  /** Its errors (it can't run) and warnings (latches, `init` values), errors first. */
  readonly messages: readonly HdlMessage[];
}

/** A module: Yosys's top module, flattened, as the interpreter runs it. */
export interface HdlModule {
  readonly format: typeof HDL_FORMAT;
  /** The Verilog name of the top module. */
  readonly top: string;
  /** What made the JSON: `Yosys 0.70+post (git sha1 …)`. */
  readonly creator: string;
  /** The number of signal bits; bits are numbered from 0. */
  readonly bitCount: number;
  /** Inputs, outputs and inouts in declaration order. */
  readonly ports: readonly HdlPort[];
  readonly signals: readonly HdlSignal[];
  /** Its memories (HDL-6), which `$memrd` and `$memwr` cells name by index. */
  readonly memories: readonly HdlMemory[];
  readonly cells: readonly HdlCell[];
  /** Its pin-to-pin timing, from a `specify` block (HDL-2); absent without one. */
  readonly specify?: HdlSpecify;
}

/**
 * A module's `specify` block (HDL-2): its pin-to-pin delays and its timing checks, as Yosys's
 * `read_verilog -specify` reads them. Times are in picoseconds (the source's numbers are
 * nanoseconds).
 */
export interface HdlSpecify {
  readonly paths: readonly HdlPath[];
  readonly checks: readonly HdlCheck[];
}

/** A delay at the three corners of a `min:typ:max` triple, in picoseconds. */
export interface HdlDelay {
  readonly min: number;
  readonly typ: number;
  readonly max: number;
}

/**
 * A pin-to-pin delay: a change of a `from` bit reaches the `to` bits after `rise` (an output
 * going to 1) or `fall` (to 0). Its bits are signal bits of the module's ports — inputs or
 * inouts at `from`, outputs or inouts at `to`.
 */
export interface HdlPath {
  readonly from: readonly number[];
  readonly to: readonly number[];
  /** `*>`: every `from` bit reaches every `to` bit; `=>` (false): bit n reaches bit n. */
  readonly full: boolean;
  /** An edge-sensitive path (`posedge CP => …`): only this edge of a `from` bit. */
  readonly edge?: Edge;
  /** A conditional path (`if (en) …`): the bit that enables it, read after the change. */
  readonly when?: HdlBit;
  readonly rise: HdlDelay;
  readonly fall: HdlDelay;
  readonly src: string;
}

/** What a timing check measures (HDL-2, ADR-0014; `cycle`, feat/hdl-timing). */
export type HdlCheckKind = 'setup' | 'hold' | 'recovery' | 'removal' | 'width' | 'cycle';

/** One side of a timing check: bits, the edge that counts (any change without one), its arming. */
export interface HdlCheckEvent {
  readonly bits: readonly number[];
  readonly edge?: Edge;
  /** `&&&`: the bit that arms the check; absent, always armed. */
  readonly when?: HdlBit;
}

/**
 * A timing check, measured from `clock`'s edge: `data` may not change `limit` before it (`setup`)
 * or after it (`hold`); a control's release (`data`, its edge) may not come `limit` before the
 * edge (`recovery`) or after it (`removal`); for `width`, `clock` is the edge that starts a pulse
 * and `data` the same pin's opposite edge, which may not come `limit` after it; for `cycle`,
 * `clock` and `data` are the same pin's same edge, which may not come again `limit` after it.
 * `limit` is the data sheet's guaranteed minimum, in picoseconds.
 */
export interface HdlCheck {
  readonly kind: HdlCheckKind;
  readonly clock: HdlCheckEvent;
  readonly data: HdlCheckEvent;
  readonly limit: number;
  readonly src: string;
}

/** How a cell type is evaluated. */
export type HdlCellKind =
  | 'unary' // A → Y
  | 'binary' // A, B → Y
  | 'mux' // A, B, S → Y
  | 'pmux' // A, B, S → Y (one-hot S)
  | 'bmux' // A, S → Y (A holds 2^S words of Y's width; S picks one)
  | 'demux' // A, S → Y (Y holds 2^S words of A's width; S picks the one that is A)
  | 'bwmux' // A, B, S → Y (a multiplexer per bit: S as wide as Y)
  | 'flip-flop' // CLK (EN, ARST, SRST, SET, CLR, ALOAD, AD), D → Q
  | 'latch' // EN (ARST, SET, CLR), D → Q
  | 'sr' // SET, CLR → Q (no clock: set and cleared per bit)
  | 'tribuf' // A, EN → Y (released while EN is 0)
  | 'memrd' // ADDR → DATA (a memory's word, asynchronously)
  | 'memwr'; // CLK, EN, ADDR, DATA → a memory's word (on CLK's edge; no output)

/** A cell type's shape: its input and output ports and its parameters. */
export interface HdlCellSpec {
  readonly kind: HdlCellKind;
  readonly inputs: readonly string[];
  /** The port it drives; none for a memory's write port, which drives its memory. */
  readonly output?: string;
  /** Parameters that are a polarity (0 or 1). */
  readonly flags: readonly string[];
  /**
   * Flags that may be absent, meaning 0: the operands' signedness (`A_SIGNED`, `B_SIGNED`; HDL-9),
   * so modules saved before they mattered load unchanged.
   */
  readonly signedness: readonly string[];
  /** Parameters that are a value as wide as the output. */
  readonly values: readonly string[];
  /** Whether its operands are words (numbers of any width) rather than bits side by side. */
  readonly word: boolean;
  /** Parameters that are an index into the module's memories (`MEMORY`, HDL-6). */
  readonly indices?: readonly string[];
}

const unary = (word: boolean): HdlCellSpec => ({
  kind: 'unary',
  inputs: ['A'],
  output: 'Y',
  flags: [],
  signedness: ['A_SIGNED'],
  values: [],
  word,
});
const binary = (word: boolean): HdlCellSpec => ({
  kind: 'binary',
  inputs: ['A', 'B'],
  output: 'Y',
  flags: [],
  signedness: ['A_SIGNED', 'B_SIGNED'],
  values: [],
  word,
});
const select = (kind: 'mux' | 'pmux' | 'bmux' | 'demux' | 'bwmux'): HdlCellSpec => ({
  kind,
  inputs: kind === 'bmux' || kind === 'demux' ? ['A', 'S'] : ['A', 'B', 'S'],
  output: 'Y',
  flags: [],
  signedness: [],
  values: [],
  word: false,
});
const stateful = (
  kind: 'flip-flop' | 'latch' | 'sr',
  inputs: readonly string[],
  flags: string[],
  values: string[] = [],
) => ({ kind, inputs, output: 'Q', flags, signedness: [], values, word: false }) as const;
const flipFlop = (inputs: readonly string[], flags: string[], values: string[] = []) =>
  stateful('flip-flop', inputs, flags, values);
const latch = (inputs: readonly string[], flags: string[], values: string[] = []) =>
  stateful('latch', inputs, flags, values);

/**
 * The cells modules run: what the command leaves of a decoder, a counter, a state machine
 * (HDL-1), of tri-states (`$tribuf`, HDL-8), and of the rest of synthesizable Verilog —
 * multiplication, division, powers, `===`, every flip-flop and latch flavour — plus the
 * multiplexers and floor divisions other front ends' RTLIL holds (HDL-9).
 */
export const HDL_CELLS = {
  $not: unary(false),
  $pos: unary(false),
  $neg: unary(true),
  $reduce_and: unary(false),
  $reduce_or: unary(false),
  $reduce_xor: unary(false),
  $reduce_xnor: unary(false),
  $reduce_bool: unary(false),
  $logic_not: unary(false),
  $and: binary(false),
  $or: binary(false),
  $xor: binary(false),
  $xnor: binary(false),
  $logic_and: binary(false),
  $logic_or: binary(false),
  $add: binary(true),
  $sub: binary(true),
  $mul: binary(true),
  $div: binary(true),
  $mod: binary(true),
  $divfloor: binary(true),
  $modfloor: binary(true),
  $pow: binary(true),
  $eq: binary(true),
  $ne: binary(true),
  $eqx: binary(true),
  $nex: binary(true),
  $lt: binary(true),
  $le: binary(true),
  $gt: binary(true),
  $ge: binary(true),
  $shl: binary(true),
  $shr: binary(true),
  $sshl: binary(true),
  $sshr: binary(true),
  $shift: binary(true),
  $shiftx: binary(true),
  $mux: select('mux'),
  $pmux: select('pmux'),
  $bmux: select('bmux'),
  $demux: select('demux'),
  $bwmux: select('bwmux'),
  $dff: flipFlop(['CLK', 'D'], ['CLK_POLARITY']),
  $dffe: flipFlop(['CLK', 'EN', 'D'], ['CLK_POLARITY', 'EN_POLARITY']),
  $adff: flipFlop(['CLK', 'ARST', 'D'], ['CLK_POLARITY', 'ARST_POLARITY'], ['ARST_VALUE']),
  $adffe: flipFlop(
    ['CLK', 'ARST', 'EN', 'D'],
    ['CLK_POLARITY', 'ARST_POLARITY', 'EN_POLARITY'],
    ['ARST_VALUE'],
  ),
  $sdff: flipFlop(['CLK', 'SRST', 'D'], ['CLK_POLARITY', 'SRST_POLARITY'], ['SRST_VALUE']),
  $sdffe: flipFlop(
    ['CLK', 'SRST', 'EN', 'D'],
    ['CLK_POLARITY', 'SRST_POLARITY', 'EN_POLARITY'],
    ['SRST_VALUE'],
  ),
  $sdffce: flipFlop(
    ['CLK', 'SRST', 'EN', 'D'],
    ['CLK_POLARITY', 'SRST_POLARITY', 'EN_POLARITY'],
    ['SRST_VALUE'],
  ),
  $dffsr: flipFlop(['CLK', 'SET', 'CLR', 'D'], ['CLK_POLARITY', 'SET_POLARITY', 'CLR_POLARITY']),
  $dffsre: flipFlop(
    ['CLK', 'SET', 'CLR', 'EN', 'D'],
    ['CLK_POLARITY', 'SET_POLARITY', 'CLR_POLARITY', 'EN_POLARITY'],
  ),
  $aldff: flipFlop(['CLK', 'ALOAD', 'AD', 'D'], ['CLK_POLARITY', 'ALOAD_POLARITY']),
  $aldffe: flipFlop(
    ['CLK', 'ALOAD', 'AD', 'EN', 'D'],
    ['CLK_POLARITY', 'ALOAD_POLARITY', 'EN_POLARITY'],
  ),
  $dlatch: latch(['EN', 'D'], ['EN_POLARITY']),
  $adlatch: latch(['EN', 'ARST', 'D'], ['EN_POLARITY', 'ARST_POLARITY'], ['ARST_VALUE']),
  $dlatchsr: latch(['EN', 'SET', 'CLR', 'D'], ['EN_POLARITY', 'SET_POLARITY', 'CLR_POLARITY']),
  $sr: stateful('sr', ['SET', 'CLR'], ['SET_POLARITY', 'CLR_POLARITY']),
  $tribuf: {
    kind: 'tribuf',
    inputs: ['A', 'EN'],
    output: 'Y',
    flags: [],
    signedness: [],
    values: [],
    word: false,
  },
  // A memory's ports (HDL-6), from Yosys's `$mem_v2`: reads are asynchronous (a registered read
  // stays a flip-flop after one), writes happen on a clock edge, `EN` per bit; `PRIORITY` holds a
  // bit per earlier write port of the memory, set where this one wins when both write a bit.
  $memrd: {
    kind: 'memrd',
    inputs: ['ADDR'],
    output: 'DATA',
    flags: [],
    signedness: [],
    values: [],
    word: false,
    indices: ['MEMORY'],
  },
  $memwr: {
    kind: 'memwr',
    inputs: ['CLK', 'EN', 'ADDR', 'DATA'],
    flags: ['CLK_POLARITY'],
    signedness: [],
    values: [],
    word: false,
    indices: ['MEMORY'],
  },
} as const satisfies Record<string, HdlCellSpec>;

export type HdlCellType = keyof typeof HDL_CELLS;

export function isHdlCellType(type: string): type is HdlCellType {
  return Object.hasOwn(HDL_CELLS, type);
}

/** The bits a cell drives: its output port's; none for a memory's write port. */
export function hdlCellOutput(cell: Pick<HdlCell, 'type' | 'ports'>): readonly HdlBit[] {
  const spec: HdlCellSpec = HDL_CELLS[cell.type];
  const output = spec.output;
  return output === undefined ? [] : (cell.ports[output] ?? []);
}

/** Ports whose bits are each one control signal, whatever the cell's width. */
const ONE_BIT = new Set(['CLK', 'EN', 'ARST', 'SRST', 'ALOAD']);

/** Ports as wide as the output: data, and controls per bit (`SET`, `CLR` of `$dffsr`, `$sr`). */
const AS_WIDE_AS_Q = ['D', 'AD', 'SET', 'CLR'];

// --- Pins ---------------------------------------------------------------------------------------

/**
 * The name a port gives the instance's pin: its own for one bit (`phi2`), a bus for several
 * (`addr[15..12]`, the Verilog indices, most significant first).
 */
export function hdlPortName(port: Pick<HdlPort, 'name' | 'lsb' | 'bits'>): string {
  const width = port.bits.length;
  return width === 1 ? port.name : `${port.name}[${port.lsb + width - 1}..${port.lsb}]`;
}

/** The kernel pins of a port, least significant first: `phi2`; `addr12`…`addr15`. */
export function hdlPortPins(port: Pick<HdlPort, 'name' | 'lsb' | 'bits'>): string[] {
  const width = port.bits.length;
  return width === 1
    ? [port.name]
    : Array.from({ length: width }, (_, i) => `${port.name}${port.lsb + i}`);
}

/**
 * The direction of each of a module's pins, in pin order (each port's bits, least significant
 * first): an input's `in`, an inout's `bidir`, an output's `tristate` where a `$tribuf` drives
 * the bit or it is `z` (never driven), else `out` (HDL-8).
 */
export function hdlPinDirs(module: Pick<HdlModule, 'ports' | 'cells'>): PinDir[] {
  // A buffer driving an inout's bit drives the inout's pin; an output reading that bit back
  // drives what the pin reads, push-pull.
  const inout = new Set<number>();
  for (const port of module.ports) {
    if (port.dir !== 'inout') continue;
    for (const bit of port.bits) if (typeof bit === 'number') inout.add(bit);
  }
  const buffered = new Set<number>();
  for (const cell of module.cells) {
    if (cell.type !== '$tribuf') continue;
    for (const bit of cell.ports.Y ?? []) {
      if (typeof bit === 'number' && !inout.has(bit)) buffered.add(bit);
    }
  }
  return module.ports.flatMap((port) =>
    port.bits.map((bit): PinDir => {
      if (port.dir === 'in') return 'in';
      if (port.dir === 'inout') return 'bidir';
      return bit === 'z' || (typeof bit === 'number' && buffered.has(bit)) ? 'tristate' : 'out';
    }),
  );
}

/** A port name the app's pins can take: a plain Verilog identifier without `$`, ≤ 32 characters. */
const PORT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

/**
 * Why a port can't be a pin of the app's parts, or undefined: its name must be a plain
 * identifier (pin and net names), a vector's indices at most 99 (bus names).
 */
export function hdlPortProblem(port: Pick<HdlPort, 'name' | 'lsb' | 'bits'>): string | undefined {
  if (!PORT_NAME.test(port.name)) {
    return `port ${port.name}: its name must be letters, digits and _, at most 32 characters`;
  }
  if (port.bits.length > 1 && !BUS_NAME.test(hdlPortName(port))) {
    return `port ${port.name}: a vector's indices must be 0 to 99, its bus name at most 32 characters`;
  }
  return undefined;
}

// --- Shape --------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

/** A shape problem at a path relative to what is checked (`ports.A`). */
interface Problem {
  readonly at: string;
  readonly message: string;
}

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Every problem with `value` as an `HdlModule`, each prefixed with its path under `path`
 * (`circuits[1].module.cells[3].ports.A: …`); empty when it is one. Checks the shape, the cells'
 * ports and parameters, bit indices, widths and the ports' pin names — not what the interpreter
 * checks (drivers, loops, clocks).
 */
export function hdlModuleProblems(value: unknown, path = 'module'): string[] {
  const problems: string[] = [];
  const at = (where: string, message: string) => problems.push(`${where}: ${message}`);
  if (!isObject(value)) {
    at(path, 'expected an object');
    return problems;
  }
  const known = [
    'format',
    'top',
    'creator',
    'bitCount',
    'ports',
    'signals',
    'memories',
    'cells',
    'specify',
  ];
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) at(`${path}.${key}`, 'unknown field');
  }
  if (value.format !== HDL_FORMAT) at(`${path}.format`, `expected ${HDL_FORMAT}`);
  if (typeof value.top !== 'string' || value.top === '') at(`${path}.top`, 'expected a name');
  if (typeof value.creator !== 'string') at(`${path}.creator`, 'expected a string');
  const bitCount = value.bitCount;
  if (!isIndex(bitCount)) {
    at(`${path}.bitCount`, 'expected an integer ≥ 0');
    return problems;
  }

  /** `signals`: signal bits only; `constants`: or 0, 1, x; `released`: or z too (port bits). */
  const bitsProblem = (
    bits: unknown,
    allowed: 'signals' | 'constants' | 'released',
  ): string | undefined => {
    if (!Array.isArray(bits)) return 'expected an array of bits';
    for (const bit of bits) {
      if (isIndex(bit)) {
        if (bit >= bitCount) return `bit ${bit} is not below bitCount ${bitCount}`;
        continue;
      }
      const constant = bit === '0' || bit === '1' || bit === 'x';
      if (allowed === 'constants' && constant) continue;
      if (allowed === 'released' && (constant || bit === 'z')) continue;
      const expected = {
        signals: 'signal bits',
        constants: 'signal bits or "0", "1", "x"',
        released: 'signal bits or "0", "1", "x", "z"',
      }[allowed];
      return `expected ${expected}, got ${JSON.stringify(bit)}`;
    }
    return undefined;
  };
  const initProblem = (where: string, init: unknown, bits: unknown) => {
    if (init === undefined) return;
    if (bitsProblem(init, 'constants') || (init as unknown[]).some(isIndex))
      at(`${where}.init`, 'expected constant bits');
    else if (Array.isArray(bits) && (init as unknown[]).length !== bits.length)
      at(`${where}.init`, 'expected as many bits as its bits');
  };
  const optionalSrc = (where: string, src: unknown) => {
    if (src !== undefined && typeof src !== 'string') at(`${where}.src`, 'expected a string');
  };

  const pins = new Set<string>();
  const inputBits = new Set<number>();
  /** The bits a `specify` path or check may start at (inputs, inouts) and end at (outputs, inouts). */
  const sourceBits = new Set<number>();
  const targetBits = new Set<number>();
  if (!Array.isArray(value.ports)) at(`${path}.ports`, 'expected an array');
  else {
    for (const [i, port] of (value.ports as unknown[]).entries()) {
      const where = `${path}.ports[${i}]`;
      if (!isObject(port)) {
        at(where, 'expected an object');
        continue;
      }
      for (const key of Object.keys(port)) {
        if (!['name', 'dir', 'lsb', 'bits', 'init', 'src'].includes(key))
          at(`${where}.${key}`, 'unknown field');
      }
      if (port.dir !== 'in' && port.dir !== 'out' && port.dir !== 'inout')
        at(`${where}.dir`, 'expected "in", "out" or "inout"');
      initProblem(where, port.init, port.bits);
      if (!isIndex(port.lsb)) at(`${where}.lsb`, 'expected an integer ≥ 0');
      optionalSrc(where, port.src);
      const problem = bitsProblem(port.bits, port.dir === 'in' ? 'signals' : 'released');
      if (problem) {
        at(`${where}.bits`, problem);
        continue;
      }
      const bits = port.bits as HdlPortBit[];
      if (bits.length === 0) {
        at(`${where}.bits`, 'expected at least one bit');
        continue;
      }
      if (typeof port.name !== 'string') {
        at(`${where}.name`, 'expected a string');
        continue;
      }
      if (!isIndex(port.lsb)) continue;
      const shape = { name: port.name, lsb: port.lsb, bits };
      const nameProblem = hdlPortProblem(shape);
      if (nameProblem) {
        at(`${where}.name`, nameProblem);
        continue;
      }
      for (const pin of hdlPortPins(shape)) {
        if (pins.has(pin)) at(`${where}.name`, `pin ${pin} is given by an earlier port`);
        pins.add(pin);
      }
      if (port.dir === 'in') {
        for (const bit of bits as number[]) {
          if (inputBits.has(bit)) at(`${where}.bits`, `bit ${bit} is another input's`);
          inputBits.add(bit);
        }
      }
      for (const bit of bits) {
        if (!isIndex(bit)) continue;
        if (port.dir !== 'out') sourceBits.add(bit);
        if (port.dir !== 'in') targetBits.add(bit);
      }
    }
  }

  if (!Array.isArray(value.signals)) at(`${path}.signals`, 'expected an array');
  else {
    for (const [i, signal] of (value.signals as unknown[]).entries()) {
      const where = `${path}.signals[${i}]`;
      if (!isObject(signal)) {
        at(where, 'expected an object');
        continue;
      }
      for (const key of Object.keys(signal)) {
        if (!['name', 'lsb', 'bits', 'init', 'src'].includes(key))
          at(`${where}.${key}`, 'unknown field');
      }
      if (typeof signal.name !== 'string') at(`${where}.name`, 'expected a string');
      if (!isIndex(signal.lsb)) at(`${where}.lsb`, 'expected an integer ≥ 0');
      optionalSrc(where, signal.src);
      const problem = bitsProblem(signal.bits, 'constants');
      if (problem) at(`${where}.bits`, problem);
      initProblem(where, signal.init, signal.bits);
    }
  }

  /** Per memory, its width when its shape is right (ports are checked against it). */
  const memoryWidths: (number | undefined)[] = [];
  if (!Array.isArray(value.memories)) at(`${path}.memories`, 'expected an array');
  else {
    const names = new Set<string>();
    for (const [i, memory] of (value.memories as unknown[]).entries()) {
      const where = `${path}.memories[${i}]`;
      memoryWidths.push(undefined);
      if (!isObject(memory)) {
        at(where, 'expected an object');
        continue;
      }
      const before = problems.length;
      for (const key of Object.keys(memory)) {
        if (!['name', 'width', 'size', 'offset', 'init', 'src'].includes(key))
          at(`${where}.${key}`, 'unknown field');
      }
      if (typeof memory.name !== 'string' || memory.name === '')
        at(`${where}.name`, 'expected a name');
      else if (names.has(memory.name)) at(`${where}.name`, `${memory.name} is an earlier memory's`);
      else names.add(memory.name);
      for (const key of ['width', 'size'] as const) {
        if (!isIndex(memory[key]) || memory[key] === 0)
          at(`${where}.${key}`, 'expected an integer ≥ 1');
      }
      if (!isIndex(memory.offset)) at(`${where}.offset`, 'expected an integer ≥ 0');
      optionalSrc(where, memory.src);
      if (memory.init !== undefined && typeof memory.init !== 'string') {
        at(`${where}.init`, 'expected a string');
      }
      if (problems.length > before) continue;
      const shape = memory as unknown as HdlMemory;
      const init = readHdlMemoryInit(shape);
      if (typeof init === 'string') at(`${where}.init`, init);
      memoryWidths[i] = shape.width;
    }
  }

  if (!Array.isArray(value.cells)) at(`${path}.cells`, 'expected an array');
  else {
    /** Per memory, how many write ports came before (a write port's `PRIORITY` has a bit each). */
    const writePorts = memoryWidths.map(() => 0);
    for (const [i, cell] of (value.cells as unknown[]).entries()) {
      const where = `${path}.cells[${i}]`;
      if (!isObject(cell)) {
        at(where, 'expected an object');
        continue;
      }
      for (const key of Object.keys(cell)) {
        if (!['type', 'src', 'ports', 'params'].includes(key))
          at(`${where}.${key}`, 'unknown field');
      }
      if (typeof cell.src !== 'string') at(`${where}.src`, 'expected a string');
      if (typeof cell.type !== 'string' || !isHdlCellType(cell.type)) {
        at(`${where}.type`, `not a cell modules run: ${JSON.stringify(cell.type)}`);
        continue;
      }
      const spec: HdlCellSpec = HDL_CELLS[cell.type];
      const memory = memoryOf(spec, cell.params, memoryWidths);
      if (typeof memory === 'string') at(`${where}.params.MEMORY`, memory);
      const port =
        typeof memory === 'number'
          ? { memory, width: memoryWidths[memory]!, writePorts }
          : undefined;
      for (const problem of cellShapeProblems(spec, cell.ports, cell.params, bitsProblem, port)) {
        at(`${where}.${problem.at}`, problem.message);
      }
      if (typeof memory === 'number' && spec.kind === 'memwr') writePorts[memory]!++;
    }
  }
  if (value.specify !== undefined) {
    const context = { bitsProblem, sourceBits, targetBits };
    for (const problem of specifyProblems(value.specify, context)) {
      at(`${path}.specify${problem.at === '' ? '' : `.${problem.at}`}`, problem.message);
    }
  }
  return problems;
}

interface SpecifyContext {
  readonly bitsProblem: (bits: unknown, allowed: 'signals' | 'constants') => string | undefined;
  /** Bits of inputs and inouts: where paths and checks start. */
  readonly sourceBits: ReadonlySet<number>;
  /** Bits of outputs and inouts: where paths end. */
  readonly targetBits: ReadonlySet<number>;
}

/** The problems of a module's `specify` (HDL-2), each at its path under `specify`. */
function specifyProblems(value: unknown, context: SpecifyContext): Problem[] {
  const problems: Problem[] = [];
  const at = (where: string, message: string) => problems.push({ at: where, message });
  if (!isObject(value)) {
    at('', 'expected an object');
    return problems;
  }
  for (const key of Object.keys(value)) {
    if (key !== 'paths' && key !== 'checks') at(key, 'unknown field');
  }
  const { bitsProblem, sourceBits, targetBits } = context;
  /** Signal bits, at least one, each a bit of the ports in `among` (`kind` names them). */
  const portBits = (where: string, bits: unknown, among: ReadonlySet<number>, kind: string) => {
    const problem = bitsProblem(bits, 'signals');
    if (problem) at(where, problem);
    else if ((bits as number[]).length === 0) at(where, 'expected at least one bit');
    else {
      const stray = (bits as number[]).find((bit) => !among.has(bit));
      if (stray !== undefined) at(where, `bit ${stray} is no ${kind}'s`);
    }
  };
  const edgeProblem = (where: string, edge: unknown) => {
    if (edge !== undefined && edge !== 'rise' && edge !== 'fall')
      at(where, 'expected "rise" or "fall"');
  };
  const whenProblem = (where: string, when: unknown) => {
    if (when === undefined) return;
    const problem = bitsProblem([when], 'constants');
    if (problem) at(where, problem);
  };
  const time = (where: string, t: unknown) => {
    if (!isIndex(t)) at(where, 'expected a time in ps, an integer ≥ 0');
  };

  if (!Array.isArray(value.paths)) at('paths', 'expected an array');
  else {
    for (const [i, path] of (value.paths as unknown[]).entries()) {
      const where = `paths[${i}]`;
      if (!isObject(path)) {
        at(where, 'expected an object');
        continue;
      }
      for (const key of Object.keys(path)) {
        if (!['from', 'to', 'full', 'edge', 'when', 'rise', 'fall', 'src'].includes(key))
          at(`${where}.${key}`, 'unknown field');
      }
      portBits(`${where}.from`, path.from, sourceBits, 'input or inout');
      portBits(`${where}.to`, path.to, targetBits, 'output or inout');
      if (typeof path.full !== 'boolean') at(`${where}.full`, 'expected a boolean');
      else if (
        !path.full &&
        Array.isArray(path.from) &&
        Array.isArray(path.to) &&
        path.from.length !== path.to.length
      )
        at(`${where}.to`, 'expected as many bits as from (a parallel path)');
      edgeProblem(`${where}.edge`, path.edge);
      whenProblem(`${where}.when`, path.when);
      for (const corner of ['rise', 'fall'] as const) {
        const delay = path[corner];
        if (!isObject(delay)) {
          at(`${where}.${corner}`, 'expected { min, typ, max }');
          continue;
        }
        for (const key of Object.keys(delay)) {
          if (!['min', 'typ', 'max'].includes(key))
            at(`${where}.${corner}.${key}`, 'unknown field');
        }
        for (const key of ['min', 'typ', 'max'] as const)
          time(`${where}.${corner}.${key}`, delay[key]);
      }
      if (typeof path.src !== 'string') at(`${where}.src`, 'expected a string');
    }
  }

  if (!Array.isArray(value.checks)) at('checks', 'expected an array');
  else {
    const kinds: readonly string[] = ['setup', 'hold', 'recovery', 'removal', 'width', 'cycle'];
    for (const [i, check] of (value.checks as unknown[]).entries()) {
      const where = `checks[${i}]`;
      if (!isObject(check)) {
        at(where, 'expected an object');
        continue;
      }
      for (const key of Object.keys(check)) {
        if (!['kind', 'clock', 'data', 'limit', 'src'].includes(key))
          at(`${where}.${key}`, 'unknown field');
      }
      const kind = check.kind;
      if (typeof kind !== 'string' || !kinds.includes(kind))
        at(`${where}.kind`, `expected one of ${kinds.join(', ')}`);
      const events: Obj[] = [];
      for (const side of ['clock', 'data'] as const) {
        const event = check[side];
        if (!isObject(event)) {
          at(`${where}.${side}`, 'expected { bits, edge?, when? }');
          continue;
        }
        for (const key of Object.keys(event)) {
          if (!['bits', 'edge', 'when'].includes(key))
            at(`${where}.${side}.${key}`, 'unknown field');
        }
        portBits(`${where}.${side}.bits`, event.bits, sourceBits, 'input or inout');
        edgeProblem(`${where}.${side}.edge`, event.edge);
        whenProblem(`${where}.${side}.when`, event.when);
        events.push(event);
      }
      time(`${where}.limit`, check.limit);
      if (typeof check.src !== 'string') at(`${where}.src`, 'expected a string');
      const [clock, data] = events;
      if (!clock || !data || !kinds.includes(kind as string)) continue;
      // What the simulator measures: one clock pin's edge; a control's release; one pin's pulse.
      if (!Array.isArray(clock.bits) || clock.bits.length !== 1)
        at(`${where}.clock.bits`, 'expected one bit');
      if (clock.edge === undefined) at(`${where}.clock.edge`, 'expected an edge');
      if (kind === 'recovery' || kind === 'removal' || kind === 'width' || kind === 'cycle') {
        if (!Array.isArray(data.bits) || data.bits.length !== 1)
          at(`${where}.data.bits`, 'expected one bit');
        if (data.edge === undefined) at(`${where}.data.edge`, 'expected an edge');
      }
      if (kind === 'width') {
        const same =
          Array.isArray(clock.bits) && Array.isArray(data.bits) && clock.bits[0] === data.bits[0];
        if (!same) at(`${where}.data.bits`, "expected the clock's bit (a pulse of one pin)");
        if (clock.edge !== undefined && clock.edge === data.edge)
          at(`${where}.data.edge`, "expected the edge opposite the clock's");
        if (data.when !== undefined)
          at(`${where}.data.when`, 'expected none (the pulse is armed at its start)');
      }
      if (kind === 'cycle') {
        const same =
          Array.isArray(clock.bits) && Array.isArray(data.bits) && clock.bits[0] === data.bits[0];
        if (!same) at(`${where}.data.bits`, "expected the clock's bit (a cycle of one pin)");
        if (clock.edge !== undefined && data.edge !== clock.edge)
          at(`${where}.data.edge`, "expected the clock's edge");
        if (data.when !== undefined)
          at(`${where}.data.when`, 'expected none (the cycle is armed at its edge)');
      }
    }
  }
  return problems;
}

/**
 * The memory a port names (`MEMORY`), or why it names none; `undefined` for other cells and for
 * a memory whose own shape is wrong (reported there).
 */
function memoryOf(
  spec: HdlCellSpec,
  params: unknown,
  widths: readonly (number | undefined)[],
): number | string | undefined {
  if (!spec.indices || !isObject(params)) return undefined;
  const index = params.MEMORY;
  if (!isIndex(index) || index >= widths.length) {
    return `expected the index of one of the ${widths.length} memories`;
  }
  return widths[index] === undefined ? undefined : index;
}

/** A memory port's memory, its width, and the write ports each memory had before it. */
interface PortContext {
  readonly memory: number;
  readonly width: number;
  readonly writePorts: readonly number[];
}

function cellShapeProblems(
  spec: HdlCellSpec,
  ports: unknown,
  params: unknown,
  bitsProblem: (bits: unknown, allowed: 'signals' | 'constants') => string | undefined,
  port: PortContext | undefined,
): Problem[] {
  const problems: Problem[] = [];
  if (!isObject(ports)) return [{ at: 'ports', message: 'expected an object' }];
  const names = spec.output === undefined ? spec.inputs : [...spec.inputs, spec.output];
  for (const key of Object.keys(ports)) {
    if (!names.includes(key)) problems.push({ at: `ports.${key}`, message: 'not a port of it' });
  }
  const width: Record<string, number> = {};
  for (const name of names) {
    const problem = bitsProblem(ports[name], name === spec.output ? 'signals' : 'constants');
    if (problem) {
      problems.push({ at: `ports.${name}`, message: problem });
      continue;
    }
    width[name] = (ports[name] as unknown[]).length;
    if (width[name] === 0) problems.push({ at: `ports.${name}`, message: 'expected bits' });
    // A write port's EN is per bit, as wide as its data.
    if (ONE_BIT.has(name) && width[name] !== 1 && !(spec.kind === 'memwr' && name === 'EN'))
      problems.push({ at: `ports.${name}`, message: 'expected one bit' });
  }
  if (problems.length > 0) return problems;
  if (spec.kind === 'memrd' || spec.kind === 'memwr') {
    return [...problems, ...memoryPortProblems(spec, width, params, port)];
  }
  const y = width[spec.output!]!;
  const sameAsY = (name: string) => {
    if (width[name] !== y)
      problems.push({ at: `ports.${name}`, message: `expected ${y} bits, as ${spec.output}` });
  };
  if (spec.kind === 'mux') {
    sameAsY('A');
    sameAsY('B');
    if (width.S !== 1) problems.push({ at: 'ports.S', message: 'expected one bit' });
  } else if (spec.kind === 'pmux') {
    sameAsY('A');
    if (width.B !== y * width.S!)
      problems.push({ at: 'ports.B', message: `expected ${y * width.S!} bits (Y × S)` });
  } else if (spec.kind === 'bmux') {
    // A holds a word of Y's width for each value of S.
    if (width.A !== y * 2 ** width.S!)
      problems.push({ at: 'ports.A', message: `expected ${y * 2 ** width.S!} bits (Y × 2^S)` });
  } else if (spec.kind === 'demux') {
    if (y !== width.A! * 2 ** width.S!)
      problems.push({
        at: 'ports.Y',
        message: `expected ${width.A! * 2 ** width.S!} bits (A × 2^S)`,
      });
  } else if (spec.kind === 'bwmux') {
    sameAsY('A');
    sameAsY('B');
    sameAsY('S');
  } else if (spec.kind === 'flip-flop' || spec.kind === 'latch' || spec.kind === 'sr') {
    for (const name of AS_WIDE_AS_Q) if (width[name] !== undefined) sameAsY(name);
  } else if (spec.kind === 'tribuf') {
    sameAsY('A');
  }

  if (!isObject(params)) return [...problems, { at: 'params', message: 'expected an object' }];
  for (const key of Object.keys(params)) {
    if (!spec.flags.includes(key) && !spec.signedness.includes(key) && !spec.values.includes(key))
      problems.push({ at: `params.${key}`, message: 'not a parameter of it' });
  }
  for (const flag of spec.flags) {
    if (params[flag] !== 0 && params[flag] !== 1)
      problems.push({ at: `params.${flag}`, message: 'expected 0 or 1' });
  }
  for (const flag of spec.signedness) {
    if (params[flag] !== undefined && params[flag] !== 0 && params[flag] !== 1)
      problems.push({ at: `params.${flag}`, message: 'expected 0 or 1' });
  }
  for (const name of spec.values) {
    const problem = bitsProblem(params[name], 'constants');
    if (problem || (params[name] as unknown[]).some(isIndex))
      problems.push({ at: `params.${name}`, message: 'expected constant bits' });
    else if ((params[name] as unknown[]).length !== y)
      problems.push({ at: `params.${name}`, message: `expected ${y} bits, as ${spec.output}` });
  }
  return problems;
}

/** A memory port's widths (its data and enables as wide as the memory) and parameters. */
function memoryPortProblems(
  spec: HdlCellSpec,
  width: Readonly<Record<string, number>>,
  params: unknown,
  port: PortContext | undefined,
): { at: string; message: string }[] {
  if (!isObject(params)) return [{ at: 'params', message: 'expected an object' }];
  const problems: { at: string; message: string }[] = [];
  const priority = spec.kind === 'memwr' ? ['PRIORITY'] : [];
  const allowed = [...spec.flags, ...(spec.indices ?? []), ...priority];
  for (const key of Object.keys(params)) {
    if (!allowed.includes(key))
      problems.push({ at: `params.${key}`, message: 'not a parameter of it' });
  }
  for (const flag of spec.flags) {
    if (params[flag] !== 0 && params[flag] !== 1)
      problems.push({ at: `params.${flag}`, message: 'expected 0 or 1' });
  }
  // Without a memory of the right shape there is nothing to check the widths against.
  if (!port) return problems;
  for (const name of spec.kind === 'memrd' ? ['DATA'] : ['EN', 'DATA']) {
    if (width[name] !== port.width)
      problems.push({
        at: `ports.${name}`,
        message: `expected ${port.width} bits, as its memory's words`,
      });
  }
  if (spec.kind === 'memwr') {
    // A bit per earlier write port of the memory, set where this one wins.
    const earlier = port.writePorts[port.memory]!;
    const bits = params.PRIORITY;
    if (
      !Array.isArray(bits) ||
      bits.length !== earlier ||
      bits.some((b) => b !== '0' && b !== '1')
    ) {
      problems.push({
        at: 'params.PRIORITY',
        message: `expected ${earlier} bits "0" or "1", one per earlier write port of its memory`,
      });
    }
  }
  return problems;
}
