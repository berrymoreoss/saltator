/**
 * What the interpreter needs to know about a module before it runs it (HDL-1): the order of its
 * combinational cells, its flip-flops, and what it can't run — a bit driven twice, a clock or an
 * asynchronous reset made inside the module, a combinational loop — or runs differently from a
 * Verilog simulator (an inferred latch, an `init` value). Spec: docs/components.md#verilog-modules.
 */
import {
  HDL_CELLS,
  type HdlBit,
  type HdlCellSpec,
  type HdlMessage,
  type HdlModule,
} from '../../core';

export interface HdlAnalysis {
  /** The combinational cells (latches among them) in evaluation order: each after those it reads. */
  readonly order: readonly number[];
  /** The flip-flops, in cell order. */
  readonly flipFlops: readonly number[];
  /** Errors (it can't run) first, then warnings. */
  readonly messages: readonly HdlMessage[];
}

const INPUT = -1;

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
function outputName(module: HdlModule, bits: readonly HdlBit[]): string {
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

  // Who drives each bit: an input (INPUT), a cell (its index), or nothing (−2).
  const driver = new Int32Array(module.bitCount).fill(-2);
  for (const port of module.ports) {
    if (port.dir !== 'in') continue;
    for (const bit of port.bits) driver[bit as number] = INPUT;
  }
  const { cells } = module;
  for (const [index, cell] of cells.entries()) {
    const spec: HdlCellSpec = HDL_CELLS[cell.type];
    for (const bit of cell.ports[spec.output]!) {
      const b = bit as number;
      if (driver[b] !== -2) {
        error(`${bitName(module, b)} is driven twice`, cell.src);
        continue;
      }
      driver[b] = index;
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
    const q = outputName(module, cell.ports.Q!);
    const fromInput = (port: string) => {
      const bit = cell.ports[port]?.[0];
      return bit === undefined || typeof bit !== 'number' || driver[bit] === INPUT;
    };
    if (!fromInput('CLK'))
      error(`the clock of ${q} is made inside the module — not supported yet (HDL-9)`, cell.src);
    if (!fromInput('ARST'))
      error(
        `the asynchronous reset of ${q} is made inside the module — not supported yet (HDL-9)`,
        cell.src,
      );
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

  for (const signal of [...module.ports, ...module.signals]) {
    if (signal.init?.some((bit) => bit !== 'x')) {
      warning(
        `${signal.name} has an initial value, not simulated yet (HDL-9): it starts unknown`,
        signal.src,
      );
    }
  }

  return { order, flipFlops, messages: [...errors, ...warnings] };
}
