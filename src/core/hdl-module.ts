/**
 * The IR of a Verilog module (HDL-1, ADR-0030): what the library's converter makes of Yosys's
 * JSON netlist, what a document keeps as a module, and what the library's interpreter runs.
 * Plain JSON-serializable data. Here: its types, the cells HDL-1 runs, the pins a port gives and
 * the shape check documents are loaded with; the semantic checks (one driver per bit, no
 * combinational loop, clocks from inputs) are the interpreter's. Spec: docs/components.md#verilog-modules-hdl.
 */
import type { AnyComponentDefinition, PropDef } from './component';
import { BUS_NAME } from './net-names';
import { ns } from './time';

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
 * One bit of a connection: a signal bit (an index below `bitCount`) or a constant. Yosys's
 * `z` never reaches the IR (tri-states come with HDL-8).
 */
export type HdlBit = number | '0' | '1' | 'x';

/** A port of the module. */
export interface HdlPort {
  /** Its Verilog name: `addr`. */
  readonly name: string;
  readonly dir: 'in' | 'out';
  /** The Verilog index of `bits[0]`: `addr[15:12]` has `lsb` 12. */
  readonly lsb: number;
  /** Least significant first. An input's are distinct signal bits; an output's may be any. */
  readonly bits: readonly HdlBit[];
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
  /** Its power-up value (`reg q = 1`), least significant first; not simulated until HDL-9. */
  readonly init?: readonly HdlBit[];
  readonly src?: string;
}

/** A cell: one of `HDL_CELLS`, its ports' bits and its parameters. */
export interface HdlCell {
  readonly type: HdlCellType;
  /** Where it comes from: `counter.v:9.3-11.53` (the first of Yosys's locations); `''` if none. */
  readonly src: string;
  /** Yosys's port names (`A`, `B`, `Y`, `CLK`, `D`, `Q`, …), each least significant bit first. */
  readonly ports: Readonly<Record<string, readonly HdlBit[]>>;
  /** Polarities (0 or 1), `B_SIGNED` of shifts, and reset values (bits, least significant first). */
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
  /** Inputs and outputs in declaration order. */
  readonly ports: readonly HdlPort[];
  readonly signals: readonly HdlSignal[];
  readonly cells: readonly HdlCell[];
}

/** How a cell type is evaluated. */
export type HdlCellKind =
  | 'unary' // A → Y
  | 'binary' // A, B → Y
  | 'mux' // A, B, S → Y
  | 'pmux' // A, B, S → Y (one-hot S)
  | 'flip-flop' // CLK (EN, ARST, SRST), D → Q
  | 'latch'; // EN (ARST), D → Q

/** A cell type's shape: its input and output ports and its parameters. */
export interface HdlCellSpec {
  readonly kind: HdlCellKind;
  readonly inputs: readonly string[];
  readonly output: string;
  /** Parameters that are a polarity (0 or 1) or a flag. */
  readonly flags: readonly string[];
  /** Parameters that are a value as wide as the output. */
  readonly values: readonly string[];
  /** Whether its operands are words (at most `HDL_WORD` bits) rather than bits side by side. */
  readonly word: boolean;
}

/** The widest operand a word cell (arithmetic, comparison, shift) takes in HDL-1. */
export const HDL_WORD = 32;

const unary = (word: boolean): HdlCellSpec => ({
  kind: 'unary',
  inputs: ['A'],
  output: 'Y',
  flags: [],
  values: [],
  word,
});
const binary = (word: boolean, flags: readonly string[] = []): HdlCellSpec => ({
  kind: 'binary',
  inputs: ['A', 'B'],
  output: 'Y',
  flags,
  values: [],
  word,
});
const flipFlop = (inputs: readonly string[], flags: string[], values: string[] = []) =>
  ({ kind: 'flip-flop', inputs, output: 'Q', flags, values, word: false }) as const;
const latch = (inputs: readonly string[], flags: string[], values: string[] = []) =>
  ({ kind: 'latch', inputs, output: 'Q', flags, values, word: false }) as const;

/** The cells HDL-1 runs: what `proc -norom; flatten; opt -keepdc` leave of a decoder, a counter, a state machine. */
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
  $eq: binary(true),
  $ne: binary(true),
  $lt: binary(true),
  $le: binary(true),
  $gt: binary(true),
  $ge: binary(true),
  $shl: binary(true),
  $shr: binary(true),
  $sshl: binary(true),
  $sshr: binary(true),
  $shift: binary(true, ['B_SIGNED']),
  $shiftx: binary(true, ['B_SIGNED']),
  $mux: { kind: 'mux', inputs: ['A', 'B', 'S'], output: 'Y', flags: [], values: [], word: false },
  $pmux: { kind: 'pmux', inputs: ['A', 'B', 'S'], output: 'Y', flags: [], values: [], word: false },
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
  $dlatch: latch(['EN', 'D'], ['EN_POLARITY']),
  $adlatch: latch(['EN', 'ARST', 'D'], ['EN_POLARITY', 'ARST_POLARITY'], ['ARST_VALUE']),
} as const satisfies Record<string, HdlCellSpec>;

export type HdlCellType = keyof typeof HDL_CELLS;

export function isHdlCellType(type: string): type is HdlCellType {
  return Object.hasOwn(HDL_CELLS, type);
}

/** Ports whose bits are each one control signal, whatever the cell's width. */
const ONE_BIT = new Set(['CLK', 'EN', 'ARST', 'SRST']);

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
  const known = ['format', 'top', 'creator', 'bitCount', 'ports', 'signals', 'cells'];
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

  const bitsProblem = (bits: unknown, signalsOnly: boolean): string | undefined => {
    if (!Array.isArray(bits)) return 'expected an array of bits';
    for (const bit of bits) {
      if (isIndex(bit)) {
        if (bit >= bitCount) return `bit ${bit} is not below bitCount ${bitCount}`;
      } else if (signalsOnly || (bit !== '0' && bit !== '1' && bit !== 'x')) {
        return `expected ${signalsOnly ? 'signal bits' : 'signal bits or "0", "1", "x"'}, got ${JSON.stringify(bit)}`;
      }
    }
    return undefined;
  };
  const initProblem = (where: string, init: unknown, bits: unknown) => {
    if (init === undefined) return;
    if (bitsProblem(init, false) || (init as unknown[]).some(isIndex))
      at(`${where}.init`, 'expected constant bits');
    else if (Array.isArray(bits) && (init as unknown[]).length !== bits.length)
      at(`${where}.init`, 'expected as many bits as its bits');
  };
  const optionalSrc = (where: string, src: unknown) => {
    if (src !== undefined && typeof src !== 'string') at(`${where}.src`, 'expected a string');
  };

  const pins = new Set<string>();
  const inputBits = new Set<number>();
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
      if (port.dir !== 'in' && port.dir !== 'out') at(`${where}.dir`, 'expected "in" or "out"');
      initProblem(where, port.init, port.bits);
      if (!isIndex(port.lsb)) at(`${where}.lsb`, 'expected an integer ≥ 0');
      optionalSrc(where, port.src);
      const problem = bitsProblem(port.bits, port.dir === 'in');
      if (problem) {
        at(`${where}.bits`, problem);
        continue;
      }
      const bits = port.bits as HdlBit[];
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
      const problem = bitsProblem(signal.bits, false);
      if (problem) at(`${where}.bits`, problem);
      initProblem(where, signal.init, signal.bits);
    }
  }

  if (!Array.isArray(value.cells)) at(`${path}.cells`, 'expected an array');
  else {
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
        at(`${where}.type`, `not a cell HDL-1 runs: ${JSON.stringify(cell.type)}`);
        continue;
      }
      const spec: HdlCellSpec = HDL_CELLS[cell.type];
      for (const problem of cellShapeProblems(spec, cell.ports, cell.params, bitsProblem)) {
        at(`${where}.${problem.at}`, problem.message);
      }
    }
  }
  return problems;
}

function cellShapeProblems(
  spec: HdlCellSpec,
  ports: unknown,
  params: unknown,
  bitsProblem: (bits: unknown, signalsOnly: boolean) => string | undefined,
): { at: string; message: string }[] {
  const problems: { at: string; message: string }[] = [];
  if (!isObject(ports)) return [{ at: 'ports', message: 'expected an object' }];
  const names = [...spec.inputs, spec.output];
  for (const key of Object.keys(ports)) {
    if (!names.includes(key)) problems.push({ at: `ports.${key}`, message: 'not a port of it' });
  }
  const width: Record<string, number> = {};
  for (const name of names) {
    const problem = bitsProblem(ports[name], name === spec.output);
    if (problem) {
      problems.push({ at: `ports.${name}`, message: problem });
      continue;
    }
    width[name] = (ports[name] as unknown[]).length;
    if (width[name] === 0) problems.push({ at: `ports.${name}`, message: 'expected bits' });
    if (ONE_BIT.has(name) && width[name] !== 1)
      problems.push({ at: `ports.${name}`, message: 'expected one bit' });
    if (spec.word && width[name]! > HDL_WORD)
      problems.push({ at: `ports.${name}`, message: `wider than ${HDL_WORD} bits` });
  }
  if (problems.length > 0) return problems;
  const y = width[spec.output]!;
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
  } else if (spec.kind === 'flip-flop' || spec.kind === 'latch') {
    sameAsY('D');
  }

  if (!isObject(params)) return [...problems, { at: 'params', message: 'expected an object' }];
  for (const key of Object.keys(params)) {
    if (!spec.flags.includes(key) && !spec.values.includes(key))
      problems.push({ at: `params.${key}`, message: 'not a parameter of it' });
  }
  for (const flag of spec.flags) {
    if (params[flag] !== 0 && params[flag] !== 1)
      problems.push({ at: `params.${flag}`, message: 'expected 0 or 1' });
  }
  for (const name of spec.values) {
    const problem = bitsProblem(params[name], false);
    if (problem || (params[name] as unknown[]).some(isIndex))
      problems.push({ at: `params.${name}`, message: 'expected constant bits' });
    else if ((params[name] as unknown[]).length !== y)
      problems.push({ at: `params.${name}`, message: `expected ${y} bits, as ${spec.output}` });
  }
  return problems;
}
