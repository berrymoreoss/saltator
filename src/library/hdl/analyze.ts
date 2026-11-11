/**
 * What the interpreter needs to know about a module before it runs it (HDL-1): who drives each
 * bit (a pin, a cell), the order of its combinational cells, its flip-flops, the pins each cell
 * depends on (HDL-8: a floating pin is reported where it is used), its combinational loops
 * (HDL-9), its memories' write ports (HDL-6), and what it can't run — a bit driven twice, two
 * inout ports joined, a memory too large — or runs differently from a Verilog simulator (an
 * inferred latch, a loop). Clocks and asynchronous controls may come from anywhere (HDL-9).
 * Spec: docs/components.md#verilog-modules-hdl.
 */
import {
  HDL_CELLS,
  type HdlBit,
  type HdlCellSpec,
  type HdlMessage,
  type HdlModule,
  hdlCellOutput,
} from '../../core';

export interface HdlAnalysis {
  /**
   * Who gives each bit its value: `PIN` (an input's, or an inout's that no logic drives: read
   * from the pin), a cell (its index), or `NO_DRIVER`. A `$tribuf` driving an inout's bit drives
   * the pin, not the bit: the module reads that bit back from the pin.
   */
  readonly driver: Int32Array;
  /**
   * The combinational cells (latches among them) in evaluation order: each after those it reads,
   * the cells of a loop together.
   */
  readonly order: readonly number[];
  /** The combinational loops (HDL-9), each its cells in `order`'s order, in the order they run. */
  readonly loops: readonly (readonly number[])[];
  /** The flip-flops, in cell order. */
  readonly flipFlops: readonly number[];
  /**
   * Per cell, the bits read from pins that its inputs depend on with no flip-flop between, least
   * first: the floating pins its value can come from.
   */
  readonly cones: readonly (readonly number[])[];
  /**
   * Per flip-flop (in `flipFlops` order), the bits read from pins that what its edges sample — D,
   * EN, SRST — depends on: a race where one changes with the clock (HDL-9).
   */
  readonly dataCones: readonly (readonly number[])[];
  /** Per flip-flop, the bits read from pins its asynchronous controls (and `AD`) depend on. */
  readonly asyncCones: readonly (readonly number[])[];
  /**
   * The memories' write ports (`$memwr`, HDL-6), in cell order: edge-triggered like flip-flops,
   * storing into their memory instead of driving bits.
   */
  readonly writePorts: readonly number[];
  /** Per write port, the bits read from pins what its edges sample — EN, ADDR, DATA — depend on. */
  readonly writeDataCones: readonly (readonly number[])[];
  /** Errors (it can't run) first, then warnings. */
  readonly messages: readonly HdlMessage[];
}

/** A flip-flop's ports an edge samples. */
const SAMPLED = ['D', 'EN', 'SRST'];
/** A flip-flop's asynchronous (level-sensitive) ports. */
const ASYNC = ['ARST', 'SET', 'CLR', 'ALOAD', 'AD'];
/** A memory's write port's ports an edge samples. */
const WRITTEN = ['EN', 'ADDR', 'DATA'];

/**
 * The most words and bits a module's memory may have: a 256K × 32 RAM. An instance keeps its
 * words and two access stamps per word (ADR-0018), copied by every snapshot.
 */
export const HDL_MEMORY_WORDS = 2 ** 18;
export const HDL_MEMORY_BITS = 2 ** 23;

/** A bit read from a pin (`HdlAnalysis.driver`). */
export const PIN = -1;
/** A bit nothing drives (`HdlAnalysis.driver`). */
export const NO_DRIVER = -2;

/** The name of the port or signal a bit belongs to (`q`, `state[1]`), for messages. */
export function bitName(module: HdlModule, bit: HdlBit): string {
  if (typeof bit !== 'number') return `constant ${bit}`;
  for (const named of [...module.ports, ...module.signals]) {
    const i = named.bits.indexOf(bit);
    if (i >= 0) return named.bits.length === 1 ? named.name : `${named.name}[${named.lsb + i}]`;
  }
  return `bit ${bit}`;
}

/** The name of the port or signal a cell output drives: `q`, `state` (by its first bit). */
export function outputName(module: HdlModule, bits: readonly HdlBit[]): string {
  const first = bits[0];
  if (first === undefined) return '?';
  for (const named of [...module.ports, ...module.signals]) {
    if (named.bits.includes(first)) return named.name;
  }
  return bitName(module, first);
}

/** Analyses a module whose shape is valid (`hdlModuleProblems` found nothing). */
export function analyzeHdlModule(module: HdlModule): HdlAnalysis {
  const errors: HdlMessage[] = [];
  const warnings: HdlMessage[] = [];
  const error = (message: string, src?: string) =>
    errors.push({ severity: 'error', message, ...(src ? { src } : {}) });
  const warning = (message: string, src?: string) =>
    warnings.push({ severity: 'warning', message, ...(src ? { src } : {}) });

  // Who drives each bit: an input's pin, a cell, or nothing; then the inouts' pins for the bits
  // no logic drives (a `$tribuf` drives the pin, which the module reads back).
  const driver = new Int32Array(module.bitCount).fill(NO_DRIVER);
  for (const port of module.ports) {
    if (port.dir !== 'in') continue;
    for (const bit of port.bits) driver[bit as number] = PIN;
  }
  const inoutOf = new Map<number, string>();
  for (const port of module.ports) {
    if (port.dir !== 'inout') continue;
    for (const bit of port.bits) if (typeof bit === 'number') inoutOf.set(bit, port.name);
  }
  const { cells } = module;
  for (const [index, cell] of cells.entries()) {
    const spec: HdlCellSpec = HDL_CELLS[cell.type];
    for (const bit of hdlCellOutput(cell)) {
      const b = bit as number;
      if (spec.kind === 'tribuf' && inoutOf.has(b)) continue;
      if (driver[b] !== NO_DRIVER) {
        error(`${bitName(module, b)} is driven twice`, cell.src);
        continue;
      }
      driver[b] = index;
    }
  }
  // Two inouts reading one bit would be a wire between two pins, which a part can't be.
  const readBy = new Map<number, string>();
  for (const port of module.ports) {
    if (port.dir !== 'inout') continue;
    for (const bit of port.bits) {
      if (typeof bit !== 'number') continue;
      const other = readBy.get(bit);
      if (other !== undefined && other !== port.name) {
        error(
          `inout ports ${other} and ${port.name} are joined inside the module — a part can't be a wire between two of its pins`,
          port.src,
        );
        break;
      }
      if (driver[bit] === NO_DRIVER) driver[bit] = PIN;
      if (driver[bit] === PIN && !isInputBit(module, bit)) readBy.set(bit, port.name);
    }
  }

  for (const memory of module.memories) {
    if (memory.size > HDL_MEMORY_WORDS || memory.size * memory.width > HDL_MEMORY_BITS) {
      error(
        `memory ${memory.name} (${memory.size} × ${memory.width}) is larger than a module's memory may be: ${HDL_MEMORY_WORDS / 1024}K words, ${HDL_MEMORY_BITS / 1024 / 1024} Mbit`,
        memory.src,
      );
    }
  }

  const flipFlops: number[] = [];
  const writePorts: number[] = [];
  const combinational: number[] = [];
  for (const [index, cell] of cells.entries()) {
    const spec: HdlCellSpec = HDL_CELLS[cell.type];
    if (spec.kind === 'memwr') {
      writePorts.push(index);
      continue;
    }
    if (spec.kind !== 'flip-flop') {
      combinational.push(index);
      if (spec.kind === 'latch')
        warning(`a latch is inferred for ${outputName(module, cell.ports.Q!)}`, cell.src);
      continue;
    }
    flipFlops.push(index);
  }

  // Who reads each combinational cell's outputs, among the combinational cells.
  const isCombinational = new Uint8Array(cells.length);
  for (const index of combinational) isCombinational[index] = 1;
  const readers: number[][] = cells.map(() => []);
  for (const index of combinational) {
    const cell = cells[index]!;
    const spec: HdlCellSpec = HDL_CELLS[cell.type];
    const sources = new Set<number>();
    for (const port of spec.inputs) {
      for (const bit of cell.ports[port]!) {
        if (typeof bit !== 'number') continue;
        const from = driver[bit]!;
        if (from >= 0 && isCombinational[from]) sources.add(from);
      }
    }
    for (const from of sources) readers[from]!.push(index);
  }

  // Loops are the strongly connected components (HDL-9): their cells are evaluated together
  // until they settle. The rest keep Kahn's order over the components, in cell order where the
  // order is free, so a module without loops is evaluated as before.
  const components = stronglyConnected(combinational, readers, cells.length);
  const component = new Int32Array(cells.length).fill(-1);
  for (const [c, members] of components.entries()) for (const m of members) component[m] = c;
  const waiting = new Int32Array(components.length);
  const next: Set<number>[] = components.map(() => new Set());
  for (const index of combinational) {
    for (const reader of readers[index]!) {
      const from = component[index]!;
      const to = component[reader]!;
      if (from !== to && !next[from]!.has(to)) {
        next[from]!.add(to);
        waiting[to]!++;
      }
    }
  }
  const first = (c: number) => components[c]![0]!;
  const order: number[] = [];
  const loops: number[][] = [];
  let ready = components.flatMap((_, c) => (waiting[c] === 0 ? [c] : []));
  ready.sort((a, b) => first(a) - first(b));
  while (ready.length > 0) {
    const following: number[] = [];
    for (const c of ready) {
      const members = components[c]!;
      order.push(...members);
      if (members.length > 1 || readers[members[0]!]!.includes(members[0]!)) loops.push(members);
      for (const to of next[c]!) if (--waiting[to]! === 0) following.push(to);
    }
    ready = following.sort((a, b) => first(a) - first(b));
  }
  const outputOf = (index: number) => hdlCellOutput(cells[index]!);
  for (const members of loops) {
    // Name the loop by a signal on it, if one of its cells drives a named one.
    const named =
      members.find((index) => !outputName(module, outputOf(index)).startsWith('bit ')) ??
      members[0]!;
    warning(
      `a combinational loop through ${outputName(module, outputOf(named))}: iterated until it settles, X where it doesn't`,
      cells[named]!.src,
    );
  }

  // The cones, in evaluation order so a driver's is ready before its readers'.
  const cones: (readonly number[])[] = cells.map(() => []);
  const coneOf = (cell: HdlModule['cells'][number], ports: readonly string[]): number[] => {
    const cone = new Set<number>();
    for (const port of ports) {
      for (const bit of cell.ports[port] ?? []) {
        if (typeof bit !== 'number') continue;
        const from = driver[bit]!;
        if (from === PIN) cone.add(bit);
        else if (from >= 0 && isCombinational[from]) for (const b of cones[from]!) cone.add(b);
      }
    }
    return [...cone].sort((a, b) => a - b);
  };
  const inLoop = new Int32Array(cells.length).fill(-1);
  for (const [l, members] of loops.entries()) for (const m of members) inLoop[m] = l;
  for (const index of [...order, ...flipFlops, ...writePorts]) {
    const l = inLoop[index]!;
    if (l >= 0) {
      // A loop's cells depend on each other: each has the cone of the whole loop.
      if (index !== loops[l]![0]) continue;
      const members = loops[l]!;
      const cone = new Set<number>();
      for (const m of members) {
        for (const port of HDL_CELLS[cells[m]!.type].inputs) {
          for (const bit of cells[m]!.ports[port]!) {
            if (typeof bit !== 'number') continue;
            const from = driver[bit]!;
            if (from === PIN) cone.add(bit);
            else if (from >= 0 && isCombinational[from] && inLoop[from] !== l)
              for (const b of cones[from]!) cone.add(b);
          }
        }
      }
      const sorted = [...cone].sort((a, b) => a - b);
      for (const m of members) cones[m] = sorted;
      continue;
    }
    const cell = cells[index]!;
    cones[index] = coneOf(cell, HDL_CELLS[cell.type].inputs);
  }
  // A flip-flop's data — what an edge samples — and its asynchronous controls, apart.
  const dataCones = flipFlops.map((index) => coneOf(cells[index]!, SAMPLED));
  const asyncCones = flipFlops.map((index) => coneOf(cells[index]!, ASYNC));
  const writeDataCones = writePorts.map((index) => coneOf(cells[index]!, WRITTEN));

  return {
    driver,
    order,
    loops,
    flipFlops,
    cones,
    dataCones,
    asyncCones,
    writePorts,
    writeDataCones,
    messages: [...errors, ...warnings],
  };
}

/** Whether `bit` is an input port's. */
function isInputBit(module: HdlModule, bit: number): boolean {
  return module.ports.some((port) => port.dir === 'in' && port.bits.includes(bit));
}

/**
 * The strongly connected components of the graph `readers` (an edge from a cell to each cell
 * reading it) over `nodes`, by Tarjan's algorithm without recursion (a soft core's netlist is
 * deep). Each component's cells in ascending order.
 */
function stronglyConnected(
  nodes: readonly number[],
  readers: readonly (readonly number[])[],
  size: number,
): number[][] {
  const index = new Int32Array(size).fill(-1);
  const low = new Int32Array(size);
  const onStack = new Uint8Array(size);
  const stack: number[] = [];
  const components: number[][] = [];
  let counter = 0;
  for (const root of nodes) {
    if (index[root]! >= 0) continue;
    // Each frame: a node and the position of the next reader to visit.
    const work: [number, number][] = [[root, 0]];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const v = frame[0];
      const out = readers[v]!;
      if (frame[1] < out.length) {
        const w = out[frame[1]++]!;
        if (index[w]! < 0) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v]!, index[w]!);
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low[parent[0]] = Math.min(low[parent[0]]!, low[v]!);
      if (low[v] !== index[v]) continue;
      const members: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack[w] = 0;
        members.push(w);
      } while (w !== v);
      components.push(members.sort((a, b) => a - b));
    }
  }
  return components;
}
