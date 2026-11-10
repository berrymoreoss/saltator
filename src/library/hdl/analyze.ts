/**
 * What the interpreter needs to know about a module before it runs it (HDL-1): who drives each
 * bit (a pin, a cell), the order of its combinational cells, its flip-flops, the pins each cell
 * depends on (HDL-8: a floating pin is reported where it is used), and what it can't run — a bit
 * driven twice, two inout ports joined, a combinational loop — or runs differently from a Verilog
 * simulator (an inferred latch). Clocks and asynchronous controls may come from anywhere (HDL-9).
 * Spec: docs/components.md#verilog-modules-hdl.
 */
import {
  HDL_CELLS,
  type HdlBit,
  type HdlCellSpec,
  type HdlMessage,
  type HdlModule,
} from '../../core';

export interface HdlAnalysis {
  /**
   * Who gives each bit its value: `PIN` (an input's, or an inout's that no logic drives: read
   * from the pin), a cell (its index), or `NO_DRIVER`. A `$tribuf` driving an inout's bit drives
   * the pin, not the bit: the module reads that bit back from the pin.
   */
  readonly driver: Int32Array;
  /** The combinational cells (latches among them) in evaluation order: each after those it reads. */
  readonly order: readonly number[];
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
  /** Errors (it can't run) first, then warnings. */
  readonly messages: readonly HdlMessage[];
}

/** A flip-flop's ports an edge samples. */
const SAMPLED = ['D', 'EN', 'SRST'];
/** A flip-flop's asynchronous (level-sensitive) ports. */
const ASYNC = ['ARST', 'SET', 'CLR', 'ALOAD', 'AD'];

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
    for (const bit of cell.ports[spec.output]!) {
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

  const flipFlops: number[] = [];
  const combinational: number[] = [];
  for (const [index, cell] of cells.entries()) {
    const spec: HdlCellSpec = HDL_CELLS[cell.type];
    if (spec.kind !== 'flip-flop') {
      combinational.push(index);
      if (spec.kind === 'latch')
        warning(`a latch is inferred for ${outputName(module, cell.ports.Q!)}`, cell.src);
      continue;
    }
    flipFlops.push(index);
  }

  // Kahn's algorithm over the combinational cells, in cell order where the order is free.
  const isCombinational = new Uint8Array(cells.length);
  for (const index of combinational) isCombinational[index] = 1;
  const waiting = new Int32Array(cells.length);
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
    waiting[index] = sources.size;
  }
  const order: number[] = [];
  let ready = combinational.filter((index) => waiting[index] === 0);
  while (ready.length > 0) {
    const next: number[] = [];
    for (const index of ready) {
      order.push(index);
      for (const reader of readers[index]!) if (--waiting[reader]! === 0) next.push(reader);
    }
    ready = next.sort((a, b) => a - b);
  }
  if (order.length < combinational.length) {
    // Name the loop by a signal on it, if one of its cells drives a named one.
    const stuck = combinational.filter((index) => waiting[index]! > 0);
    const outputOf = (index: number) => cells[index]!.ports[HDL_CELLS[cells[index]!.type].output]!;
    const named =
      stuck.find((index) => !outputName(module, outputOf(index)).startsWith('bit ')) ?? stuck[0]!;
    error(
      `a combinational loop through ${outputName(module, outputOf(named))} — not supported yet (HDL-9)`,
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
  for (const index of [...order, ...flipFlops]) {
    const cell = cells[index]!;
    cones[index] = coneOf(cell, HDL_CELLS[cell.type].inputs);
  }
  // A flip-flop's data — what an edge samples — and its asynchronous controls, apart.
  const dataCones = flipFlops.map((index) => coneOf(cells[index]!, SAMPLED));
  const asyncCones = flipFlops.map((index) => coneOf(cells[index]!, ASYNC));

  return {
    driver,
    order,
    flipFlops,
    cones,
    dataCones,
    asyncCones,
    messages: [...errors, ...warnings],
  };
}

/** Whether `bit` is an input port's. */
function isInputBit(module: HdlModule, bit: number): boolean {
  return module.ports.some((port) => port.dir === 'in' && port.bits.includes(bit));
}
