/**
 * Yosys's JSON netlist → the IR of a module (HDL-1, ADR-0030). Accepts what the command
 * (`yosysScript`) makes; refuses, with the reason and the source location, what the interpreter
 * can't run yet and what another command made (a hierarchy not flattened, a ROM `proc` made of a
 * `case`, a gate-level netlist, a tri-state left a `$mux`). Spec: docs/components.md#verilog-modules-hdl.
 */
import {
  formatHdlMemoryInit,
  HDL_CELLS,
  HDL_FORMAT,
  type HdlBit,
  type HdlCell,
  type HdlCellSpec,
  type HdlMemory,
  type HdlMessage,
  type HdlModule,
  type HdlPort,
  type HdlPortBit,
  type HdlSignal,
  hdlCellOutput,
  hdlModuleProblems,
  hdlPortProblem,
  isHdlCellType,
  unknownHdlMemoryWords,
} from '../../core';
import { analyzeHdlModule } from './analyze';

/** What a conversion gave: the module when nothing was an error, and every message. */
export interface YosysConversion {
  readonly module?: HdlModule;
  /** Errors first, then warnings. */
  readonly messages: readonly HdlMessage[];
}

type YosysBit = number | string;
type Attributes = Readonly<Record<string, unknown>>;

interface YosysPort {
  readonly direction?: unknown;
  readonly bits?: unknown;
  readonly offset?: unknown;
  readonly upto?: unknown;
}

interface YosysCell {
  readonly type?: unknown;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly attributes?: Attributes;
  readonly connections?: Readonly<Record<string, unknown>>;
}

interface YosysNet {
  readonly bits?: unknown;
  readonly hide_name?: unknown;
  readonly offset?: unknown;
  readonly upto?: unknown;
  readonly attributes?: Attributes;
}

interface YosysModule {
  readonly attributes?: Attributes;
  readonly ports?: Readonly<Record<string, YosysPort>>;
  readonly cells?: Readonly<Record<string, YosysCell>>;
  readonly netnames?: Readonly<Record<string, YosysNet>>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The first of Yosys's source locations (`fsm.v:9.29-9.29|fsm.v:8.7-12.14` → the first). */
function srcOf(attributes: Attributes | undefined): string {
  const src = attributes?.src;
  return typeof src === 'string' ? (src.split('|')[0] ?? '') : '';
}

/** A Yosys constant (a binary string, most significant first) as a number. */
function flag(value: unknown): number | undefined {
  return typeof value === 'string' && /^[01]+$/.test(value) ? Number.parseInt(value, 2) : undefined;
}

/**
 * An integer parameter: a 32-bit binary string (two's complement, as `write_json` writes them),
 * or a number (`write_json -compat-int`).
 */
function intParam(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) ? value : undefined;
  const n = flag(value);
  if (n === undefined) return undefined;
  return (value as string).length === 32 && (value as string)[0] === '1' ? n - 2 ** 32 : n;
}

/**
 * A bit-vector parameter as `width` bits, least significant first: a binary string (most
 * significant first; `x` and `z` kept) extended with `fill`, or a number.
 */
function bitsParam(value: unknown, width: number, fill: string): string[] | undefined {
  let bits: string[];
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    bits = [...value.toString(2)].reverse();
  } else if (typeof value === 'string' && /^[01xz]*$/.test(value)) {
    bits = [...value].reverse();
  } else return undefined;
  if (bits.length > width) bits = bits.slice(0, width);
  while (bits.length < width) bits.push(fill);
  return bits;
}

/** A net's `init` attribute (most significant first) as bits, least significant first. */
function initOf(net: YosysNet | undefined, width: number): HdlBit[] | undefined {
  const init = net?.attributes?.init;
  if (typeof init !== 'string' || !/^[01x]+$/.test(init) || init.length !== width) return undefined;
  return [...init].reverse() as HdlBit[];
}

/** The module with its bits numbered again without gaps (bits that became `x` leave some). */
function compact(module: HdlModule): HdlModule {
  const index = new Map<number, number>();
  const map = <B extends HdlPortBit>(bits: readonly B[]): (B | number)[] =>
    bits.map((b) => {
      if (typeof b !== 'number') return b;
      let i = index.get(b);
      if (i === undefined) {
        i = index.size;
        index.set(b, i);
      }
      return i;
    });
  const ports = module.ports.map((p) => ({ ...p, bits: map(p.bits) }));
  const cells = module.cells.map((c) => ({
    ...c,
    ports: Object.fromEntries(Object.entries(c.ports).map(([k, bits]) => [k, map(bits)])),
  }));
  // A signal keeps its name only while all of its bits are still there.
  const signals = module.signals
    .filter((s) => s.bits.every((b) => typeof b !== 'number' || index.has(b)))
    .map((s) => ({ ...s, bits: map(s.bits) }));
  return { ...module, bitCount: index.size, ports, signals, cells };
}

/**
 * A memory write's address and data where it doesn't write: `proc` gives them `x` (`we ? a : x`),
 * a don't-care, which with an unknown enable would make the address unknown and the write hit
 * every word. Each write port's `ADDR` and `DATA` bits are taken through such multiplexers
 * (`proc`'s, one input all `x`) to their other input, so an unknown enable makes `X` only the word
 * it addresses (HDL-6). The multiplexers stay for whatever else reads them.
 */
function dropWriteDontCares(cells: HdlCell[], procMuxes: readonly number[]): void {
  const through = new Map<number, HdlBit>();
  for (const index of procMuxes) {
    const { A, B, Y } = cells[index]!.ports;
    for (const [i, y] of Y!.entries()) {
      if (typeof y !== 'number') continue;
      if (A![i] === 'x') through.set(y, B![i]!);
      else if (B![i] === 'x') through.set(y, A![i]!);
    }
  }
  if (through.size === 0) return;
  const resolve = (bit: HdlBit): HdlBit => {
    let b = bit;
    // Nested ifs chain them; a chain is no longer than the multiplexers.
    for (let n = 0; typeof b === 'number' && through.has(b) && n <= procMuxes.length; n++) {
      b = through.get(b)!;
    }
    return b;
  };
  for (const [index, cell] of cells.entries()) {
    if (cell.type !== '$memwr') continue;
    const { ADDR, DATA } = cell.ports;
    cells[index] = {
      ...cell,
      ports: { ...cell.ports, ADDR: ADDR!.map(resolve), DATA: DATA!.map(resolve) },
    };
  }
}

/** Cells that only carry information: dropped without a word. */
const SILENT = new Set(['$scopeinfo']);
/** Cells of simulation-only statements: dropped with a warning. */
const IGNORED: Readonly<Record<string, string>> = {
  $print: '$display and $write are not shown (yet): ignored',
  $check: 'assertions are not checked (yet): ignored',
  $assert: 'assertions are not checked (yet): ignored',
  $assume: 'assumptions are not checked (yet): ignored',
  $cover: 'cover statements are ignored',
};
/** Cells of synthesis passes the command doesn't run: such a JSON was made by another command. */
const SYNTHESIS = new Set(['$alu', '$macc', '$macc_v2', '$fa', '$lcu', '$lut', '$sop', '$fsm']);
/** Cells of formal verification: they mean nothing to a simulation. */
const FORMAL = new Set([
  '$ff',
  '$anyconst',
  '$anyseq',
  '$allconst',
  '$allseq',
  '$anyinit',
  '$initstate',
  '$equiv',
  '$live',
  '$fair',
]);
/** Yosys's port directions as the IR's. */
const DIRECTIONS: Readonly<Record<string, HdlPort['dir']>> = {
  input: 'in',
  output: 'out',
  inout: 'inout',
};

/**
 * Converts Yosys's JSON (its text or the parsed value) into a module. Every problem found is a
 * message; the module comes only when none is an error.
 */
export function fromYosys(json: unknown): YosysConversion {
  const errors: HdlMessage[] = [];
  const warnings: HdlMessage[] = [];
  const error = (message: string, src?: string) => {
    // One message per problem and place: a tri-state is found in every bit of a mux.
    if (errors.some((e) => e.message === message && e.src === src)) return;
    errors.push({ severity: 'error', message, ...(src ? { src } : {}) });
  };
  const warning = (message: string, src?: string) =>
    warnings.push({ severity: 'warning', message, ...(src ? { src } : {}) });
  const done = (module?: HdlModule): YosysConversion => ({
    ...(module && errors.length === 0 ? { module } : {}),
    messages: [...errors, ...warnings],
  });

  let value = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json);
    } catch (e) {
      error(`not JSON: ${(e as Error).message}`);
      return done();
    }
  }
  if (!isObject(value) || !isObject(value.modules)) {
    error("not Yosys's JSON netlist: it has no modules (make it with write_json)");
    return done();
  }
  const modules = Object.entries(value.modules) as [string, YosysModule][];
  const tops = modules.filter(([, m]) => flag(m.attributes?.top) === 1);
  const top = tops.length === 1 ? tops[0] : modules.length === 1 ? modules[0] : undefined;
  if (!top) {
    error(
      modules.length === 0
        ? 'the netlist has no module'
        : 'no top module is marked: make the JSON with the command (hierarchy -auto-top)',
    );
    return done();
  }
  const [topName, mod] = top;
  const creator = typeof value.creator === 'string' ? value.creator : '';

  // Bits are renumbered from 0 in order of first appearance; Yosys's start at 2.
  const renumber = new Map<number, number>();
  let bad = false;
  /**
   * The bits of a connection. A constant `z` stays `z` in an output's or inout's bits (never
   * driven); read by a cell it reads `x`, as a released net does (`readsZ` is told).
   */
  function bitsOf(raw: unknown, where: string, src: string | undefined): HdlBit[];
  function bitsOf(raw: unknown, where: string, src: string | undefined, z: 'keep'): HdlPortBit[];
  function bitsOf(raw: unknown, where: string, src: string | undefined, z: () => void): HdlBit[];
  function bitsOf(
    raw: unknown,
    where: string,
    src: string | undefined,
    z?: 'keep' | (() => void),
  ): HdlPortBit[] {
    if (!Array.isArray(raw)) {
      error(`${where}: expected bits`, src);
      bad = true;
      return [];
    }
    return raw.map((bit: YosysBit): HdlPortBit => {
      if (typeof bit === 'number') {
        let index = renumber.get(bit);
        if (index === undefined) {
          index = renumber.size;
          renumber.set(bit, index);
        }
        return index;
      }
      if (bit === '0' || bit === '1' || bit === 'x') return bit;
      if (bit === 'z' && z === 'keep') return 'z';
      if (bit === 'z' && typeof z === 'function') {
        z();
        return 'x';
      }
      error(`${where}: unknown bit ${JSON.stringify(bit)}`, src);
      bad = true;
      return 'x';
    });
  }

  const netnames = mod.netnames ?? {};
  const ports: HdlPort[] = [];
  for (const [name, port] of Object.entries(mod.ports ?? {})) {
    const src = srcOf(netnames[name]?.attributes) || undefined;
    const direction = String(port.direction);
    const dir = Object.hasOwn(DIRECTIONS, direction) ? DIRECTIONS[direction] : undefined;
    if (!dir) {
      error(`port ${name}: unknown direction ${JSON.stringify(port.direction)}`, src);
      continue;
    }
    const where = `port ${name}`;
    const bits =
      dir === 'in' ? bitsOf(port.bits, where, src) : bitsOf(port.bits, where, src, 'keep');
    if (bits.length > 1 && port.upto === 1) {
      const msb = (typeof port.offset === 'number' ? port.offset : 0) + bits.length - 1;
      error(
        `port ${name} is declared [${typeof port.offset === 'number' ? port.offset : 0}:${msb}]: declare it [${msb}:${typeof port.offset === 'number' ? port.offset : 0}] (bit 0 is the least significant in the app's buses)`,
        src,
      );
      continue;
    }
    const lsb = typeof port.offset === 'number' ? port.offset : 0;
    const init = initOf(netnames[name], bits.length);
    const shape: HdlPort = {
      name,
      dir,
      lsb,
      bits,
      ...(init ? { init } : {}),
      ...(src ? { src } : {}),
    };
    const problem = hdlPortProblem(shape);
    if (problem) {
      error(problem, src);
      continue;
    }
    ports.push(shape);
  }

  const cells: HdlCell[] = [];
  const reported = new Set<string>();
  const once = (key: string, report: () => void) => {
    if (reported.has(key)) return;
    reported.add(key);
    report();
  };
  const memories: HdlMemory[] = [];

  /**
   * A memory (HDL-6): `memory_collect`'s `$mem_v2` becomes the memory and a `$memrd` per read
   * port and a `$memwr` per write port. A wide port's words come as ports of their own, their low
   * address bits constant, so they need nothing more.
   */
  function memory(cellName: string, cell: YosysCell, src: string | undefined): void {
    const p = cell.parameters ?? {};
    const c = cell.connections ?? {};
    const name = String(p.MEMID ?? cellName)
      .trim()
      .replace(/^\\/, '');
    const [size, width, abits, offset, rdPorts, wrPorts] = [
      p.SIZE,
      p.WIDTH,
      p.ABITS,
      p.OFFSET,
      p.RD_PORTS,
      p.WR_PORTS,
    ].map(intParam);
    const where = `memory ${name}`;
    if (
      size === undefined ||
      width === undefined ||
      abits === undefined ||
      offset === undefined ||
      rdPorts === undefined ||
      wrPorts === undefined ||
      size < 1 ||
      width < 1 ||
      abits < 0 ||
      rdPorts < 0 ||
      wrPorts < 0
    ) {
      error(`${where}: its parameters are not a $mem_v2's`, src);
      bad = true;
      return;
    }
    if (offset < 0) {
      error(`${where} has negative addresses (from ${offset}): declare it from 0 up`, src);
      return;
    }
    const rdClock = bitsParam(p.RD_CLK_ENABLE, rdPorts, '0');
    const wrClock = bitsParam(p.WR_CLK_ENABLE, wrPorts, '0');
    const wrPolarity = bitsParam(p.WR_CLK_POLARITY, wrPorts, '0');
    const priority = bitsParam(p.WR_PRIORITY_MASK, wrPorts * wrPorts, '0');
    const init = bitsParam(p.INIT ?? '', size * width, 'x');
    if (!rdClock || !wrClock || !wrPolarity || !priority || !init) {
      error(`${where}: its parameters are not a $mem_v2's`, src);
      bad = true;
      return;
    }
    if (rdClock.includes('1')) {
      error(
        `${where} has a synchronous read port (memory_dff merged its register): make the JSON with the command, which leaves the register a flip-flop`,
        src,
      );
      return;
    }
    if (wrClock.includes('0')) {
      error(`${where} is written without a clock: write it in a clocked always block`, src);
      return;
    }

    const words = unknownHdlMemoryWords({ width, size });
    for (const [k, bit] of init.entries()) {
      if (bit !== '0' && bit !== '1') continue;
      const w = Math.floor(k / width);
      const b = k % width;
      const at = w * words.limbs + Math.floor(b / 32);
      const mask = 2 ** (b % 32);
      words.unk[at] = words.unk[at]! - mask;
      if (bit === '1') words.val[at] = words.val[at]! + mask;
    }
    const text = formatHdlMemoryInit({ width, size, offset }, words);
    const index = memories.length;
    memories.push({
      name,
      width,
      size,
      offset,
      ...(text ? { init: text } : {}),
      ...(src ? { src } : {}),
    });

    let readsZ = false;
    const inputs = (port: string, count: number) => {
      const bits = bitsOf(c[port], `${where} port ${port}`, src, () => {
        readsZ = true;
      });
      if (bits.length !== count) {
        error(`${where} port ${port}: expected ${count} bits, got ${bits.length}`, src);
        bad = true;
      }
      return bits;
    };
    const rdAddr = inputs('RD_ADDR', rdPorts * abits);
    const rdData = bitsOf(c.RD_DATA, `${where} port RD_DATA`, src);
    const wrClk = inputs('WR_CLK', wrPorts);
    const wrEn = inputs('WR_EN', wrPorts * width);
    const wrAddr = inputs('WR_ADDR', wrPorts * abits);
    const wrData = inputs('WR_DATA', wrPorts * width);
    if (bad || rdData.length !== rdPorts * width) {
      if (!bad) error(`${where} port RD_DATA: expected ${rdPorts * width} bits`, src);
      bad = true;
      return;
    }
    // A memory of one word may have no address bits; the IR's ports have at least one.
    const address = (bits: HdlBit[], i: number) =>
      abits === 0 ? (['0'] as HdlBit[]) : bits.slice(i * abits, (i + 1) * abits);
    for (let i = 0; i < rdPorts; i++) {
      cells.push({
        type: '$memrd',
        src: src ?? '',
        ports: { ADDR: address(rdAddr, i), DATA: rdData.slice(i * width, (i + 1) * width) },
        params: { MEMORY: index },
      });
    }
    for (let i = 0; i < wrPorts; i++) {
      // Bit i·WR_PORTS + j of the mask: port i wins over port j (only earlier ones matter).
      const wins = Array.from(
        { length: i },
        (_, j): HdlBit => (priority[i * wrPorts + j] === '1' ? '1' : '0'),
      );
      cells.push({
        type: '$memwr',
        src: src ?? '',
        ports: {
          CLK: wrClk.slice(i, i + 1),
          EN: wrEn.slice(i * width, (i + 1) * width),
          ADDR: address(wrAddr, i),
          DATA: wrData.slice(i * width, (i + 1) * width),
        },
        params: { MEMORY: index, CLK_POLARITY: wrPolarity[i] === '1' ? 1 : 0, PRIORITY: wins },
      });
    }
    if (readsZ) {
      warning('a constant z is read by a memory port here, which reads X', src);
    }
  }

  /** The `$mux` cells `proc` made (`$procmux$…`), by index in `cells`. */
  const procMuxes: number[] = [];
  const allCells = Object.entries(mod.cells ?? {});
  for (const [cellName, cell] of allCells) {
    const type = String(cell.type);
    const src = srcOf(cell.attributes) || undefined;
    if (SILENT.has(type)) continue;
    const ignored = IGNORED[type];
    if (ignored) {
      once(type, () => warning(ignored, src));
      continue;
    }
    if (!type.startsWith('$')) {
      once(`places ${type}`, () =>
        error(
          `the module places module ${type} (${cellName.replace(/^\\/, '')}): make the JSON with the command, which flattens`,
          src,
        ),
      );
      continue;
    }
    if (type.startsWith('$_')) {
      once('gates', () =>
        error(
          `a gate-level netlist (${type}): make the JSON with the command — without synth or techmap`,
          src,
        ),
      );
      continue;
    }
    if (type === '$mem_v2') {
      memory(cellName, cell, src);
      continue;
    }
    if (type === '$mem') {
      once('mem v1', () =>
        error("$mem is an older Yosys's memory cell: make the JSON with a newer Yosys", src),
      );
      continue;
    }
    if (type.startsWith('$mem')) {
      // $memrd, $memwr, $meminit (and their _v2): a memory's ports, not collected into one cell.
      const name = String(cell.parameters?.MEMID ?? '').replace(/^\\/, '');
      once(`mem ${name}`, () =>
        error(
          `a memory${name ? ` (${name})` : ''} whose ports are separate cells: make the JSON with the command (memory_collect)`,
          src,
        ),
      );
      continue;
    }
    if (!isHdlCellType(type)) {
      if (SYNTHESIS.has(type)) {
        once(`synthesis ${type}`, () =>
          error(
            `${type} comes from synthesis passes the command doesn't run (synth, alumacc, fsm): make the JSON with the command`,
            src,
          ),
        );
      } else if (FORMAL.has(type)) {
        error(`${type} is a formal verification cell, which a simulation can't run`, src);
      } else error(`${type} cells are not supported`, src);
      continue;
    }
    const spec: HdlCellSpec = HDL_CELLS[type];
    const parameters = cell.parameters ?? {};
    const connections = cell.connections ?? {};
    const cellPorts: Record<string, HdlBit[]> = {};
    let readsZ = false;
    for (const port of spec.inputs) {
      cellPorts[port] = bitsOf(connections[port], `${type} port ${port}`, src, () => {
        readsZ = true;
      });
    }
    if (spec.output !== undefined) {
      cellPorts[spec.output] = bitsOf(connections[spec.output], `${type} port ${spec.output}`, src);
    }
    if (readsZ && (type === '$mux' || type === '$pmux')) {
      once('no tribuf', () =>
        error(
          'a tri-state left a multiplexer with z inputs: make the JSON with the command (tribuf -logic)',
          src,
        ),
      );
      continue;
    }
    if (type === '$pow') {
      // Yosys's synth leaves $pow unmapped (only 2 ** n becomes logic, a shift): test before fab.
      warning(
        "a ** b (a power not of 2): Yosys's synth makes no logic of it — it runs here, but a board's flow can't build it",
        src,
      );
    }
    if (readsZ) {
      warning(
        'a constant z is read here, which reads X: an inout assigned z reads X inside the module, not its pin (leave it unassigned to read the pin)',
        src,
      );
    }
    const params: Record<string, number | HdlBit[]> = {};
    for (const name of spec.flags) {
      const v = flag(parameters[name]);
      if (v === undefined || v > 1) {
        error(`${type}: parameter ${name} is ${JSON.stringify(parameters[name])}`, src);
        bad = true;
      } else params[name] = v;
    }
    // Signedness is kept only where an operand is signed: absent means unsigned.
    for (const name of spec.signedness) if (flag(parameters[name]) === 1) params[name] = 1;
    for (const name of spec.values) {
      const raw = parameters[name];
      if (typeof raw !== 'string' || !/^[01xz]+$/.test(raw)) {
        error(`${type}: parameter ${name} is ${JSON.stringify(raw)}`, src);
        bad = true;
        continue;
      }
      params[name] = bitsOf([...raw].reverse(), `${type} ${name}`, src, () => {});
    }
    if (type === '$mux' && cellName.startsWith('$procmux$')) procMuxes.push(cells.length);
    cells.push({ type, src: src ?? '', ports: cellPorts, params });
  }

  dropWriteDontCares(cells, procMuxes);

  // Bits nothing drives (an output never assigned) read X: they become the constant x.
  const driven = new Set<number>();
  // An input's bits come from its pin, and so do an inout's that no logic drives.
  for (const port of ports) {
    if (port.dir === 'out') continue;
    for (const b of port.bits) if (typeof b === 'number') driven.add(b);
  }
  for (const cell of cells) {
    for (const b of hdlCellOutput(cell)) driven.add(b as number);
  }
  const floating = new Set<number>();
  const settle = <B extends HdlPortBit>(bits: readonly B[]): (B | 'x')[] =>
    bits.map((b) => {
      if (typeof b !== 'number' || driven.has(b)) return b;
      floating.add(b);
      return 'x';
    });
  const settledPorts = ports.map((p) => (p.dir === 'out' ? { ...p, bits: settle(p.bits) } : p));
  const settledCells = cells.map((cell) => {
    const spec: HdlCellSpec = HDL_CELLS[cell.type];
    const settled: Record<string, readonly HdlBit[]> = { ...cell.ports };
    for (const port of spec.inputs) settled[port] = settle(cell.ports[port]!);
    return { ...cell, ports: settled };
  });

  const signals: HdlSignal[] = [];
  const portNames = new Set(Object.keys(mod.ports ?? {}));
  for (const [name, net] of Object.entries(netnames)) {
    if (portNames.has(name) || net.hide_name === 1) continue;
    const src = srcOf(net.attributes) || undefined;
    const rawBits = Array.isArray(net.bits) ? net.bits : [];
    // Signals keep only bits the module has (a name may be left over a removed wire).
    if (rawBits.some((b) => typeof b === 'number' && !renumber.has(b))) continue;
    const bits = settle(bitsOf(rawBits, `signal ${name}`, src, () => {}));
    const init = initOf(net, bits.length);
    signals.push({
      name,
      lsb: typeof net.offset === 'number' ? net.offset : 0,
      bits,
      ...(init ? { init } : {}),
      ...(src ? { src } : {}),
    });
  }
  // Bits left without a driver by a refused cell are no news: only a module that runs says so.
  for (const [name, net] of errors.length > 0 ? [] : Object.entries(netnames)) {
    const bits = Array.isArray(net.bits) ? net.bits : [];
    const lost = bits.some((b) => typeof b === 'number' && floating.has(renumber.get(b) ?? -1));
    if (lost && net.hide_name !== 1) {
      warning(`${name} has no driver: it reads unknown`, srcOf(net.attributes) || undefined);
    }
  }

  if (errors.length > 0 || bad) return done();
  const module = compact({
    format: HDL_FORMAT,
    top: topName,
    creator,
    bitCount: renumber.size,
    ports: settledPorts,
    signals,
    memories,
    cells: settledCells,
  });
  const shape = hdlModuleProblems(module);
  if (shape.length > 0) {
    for (const problem of shape) error(problem);
    return done();
  }
  for (const message of analyzeHdlModule(module).messages) {
    (message.severity === 'error' ? errors : warnings).push(message);
  }
  return done(module);
}
