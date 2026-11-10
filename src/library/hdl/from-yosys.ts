/**
 * Yosys's JSON netlist → the IR of a module (HDL-1, ADR-0030). Accepts what the command
 * (`yosysScript`) makes; refuses, with the reason and the source location, what the interpreter
 * can't run yet and what another command made (a hierarchy not flattened, a ROM `proc` made of a
 * `case`, a gate-level netlist, a tri-state left a `$mux`). Spec: docs/components.md#verilog-modules-hdl.
 */
import {
  HDL_CELLS,
  HDL_FORMAT,
  type HdlBit,
  type HdlCell,
  type HdlCellSpec,
  type HdlMessage,
  type HdlModule,
  type HdlPort,
  type HdlPortBit,
  type HdlSignal,
  hdlModuleProblems,
  hdlPortProblem,
  isHdlCellType,
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
  const allCells = Object.entries(mod.cells ?? {});
  const hasRomInit = allCells.some(([, c]) => c.type === '$meminit' || c.type === '$meminit_v2');
  const hasMemWrite = allCells.some(([, c]) => String(c.type).startsWith('$memwr'));
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
    if (type.startsWith('$mem')) {
      if (hasRomInit && !hasMemWrite) {
        once('rom', () =>
          error('a case statement became a ROM: make the JSON with the command (proc -norom)', src),
        );
      } else {
        const memory = String(cell.parameters?.MEMID ?? '').replace(/^\\/, '');
        once(`mem ${memory}`, () =>
          error(`a memory${memory ? ` (${memory})` : ''} — not supported yet (HDL-6)`, src),
        );
      }
      continue;
    }
    if (!isHdlCellType(type)) {
      error(`${type} cells are not supported yet (HDL-9)`, src);
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
    cellPorts[spec.output] = bitsOf(connections[spec.output], `${type} port ${spec.output}`, src);
    if (readsZ && (type === '$mux' || type === '$pmux')) {
      once('no tribuf', () =>
        error(
          'a tri-state left a multiplexer with z inputs: make the JSON with the command (tribuf -logic)',
          src,
        ),
      );
      continue;
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
    cells.push({ type, src: src ?? '', ports: cellPorts, params });
  }

  // Bits nothing drives (an output never assigned) read X: they become the constant x.
  const driven = new Set<number>();
  // An input's bits come from its pin, and so do an inout's that no logic drives.
  for (const port of ports) {
    if (port.dir === 'out') continue;
    for (const b of port.bits) if (typeof b === 'number') driven.add(b);
  }
  for (const cell of cells) {
    for (const b of cell.ports[HDL_CELLS[cell.type].output]!) driven.add(b as number);
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
