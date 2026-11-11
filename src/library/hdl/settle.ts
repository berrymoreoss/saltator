/**
 * A module's combinational cells as generated code with activity (HDL-10): its steps — a cell, or
 * a combinational loop's cells together — in topological order, each behind a mark. A step runs
 * only when marked, and marks the steps that read its output where that changed; pins, flip-flops
 * and memories mark the readers of what they change. A clock's edge that changes nothing but the
 * clock runs nothing. Marks only ever go to later steps (a loop is one step), so a settle leaves
 * none behind. The code is split into functions of moderate size, which V8 optimizes (it won't
 * optimize one of a whole core), each called only when one of its steps is marked.
 * Spec: docs/components.md#verilog-modules-hdl.
 */
import { HDL_CELLS, type HdlCellSpec, type HdlModule, hdlCellOutput } from '../../core';
import type { HdlAnalysis } from './analyze';
import { compileCells, Generator } from './codegen';
import type { Layout } from './layout';
import type { MemoryPlanes } from './planes';
import { generated, int, type WordClosure } from './source';

/** About this many characters of source a function of the settle holds. */
const CHUNK_SOURCE = 24_000;

/** The settle of a module, compiled once and shared by its instances. */
export interface Settle {
  /** The number of steps, and of 32-bit groups of marks. */
  readonly steps: number;
  readonly groups: number;
  /** Per cell, its step (−1: a flip-flop, a write port, a cell outside the order). */
  readonly stepOf: Int32Array;
  /** Per word, the steps reading it as (group, mask) pairs from `readerStart[w]` on. */
  readonly readerStart: Int32Array;
  readonly readerGroup: Int32Array;
  readonly readerMask: Int32Array;
  /** Per combinational loop, a step's cells and whether it failed to settle (scratch, set by runs). */
  readonly loopFailed: Uint8Array;
  /**
   * Runs the marked steps in order, clearing their marks (`marks` holds a bit per step); `M` is
   * the instance's memories.
   */
  run(V: Int32Array, U: Int32Array, marks: Int32Array, M: MemoryPlanes): void;
}

/** Marks every step that reads word `w`. */
export function markWord(settle: Settle, marks: Int32Array, w: number): void {
  const end = settle.readerStart[w + 1]!;
  for (let i = settle.readerStart[w]!; i < end; i++) {
    const g = settle.readerGroup[i]!;
    marks[g] = marks[g]! | settle.readerMask[i]!;
  }
}

/** Marks every step (power-up: everything is computed once). */
export function markAll(settle: Settle, marks: Int32Array): void {
  for (let g = 0; g < settle.groups; g++) {
    const last = Math.min(32, settle.steps - 32 * g);
    marks[g] = last === 32 ? -1 : (1 << last) - 1;
  }
}

/** The words a cell's inputs read: every port but its output. */
function inputWords(module: HdlModule, layout: Layout, index: number): number[] {
  const cell = module.cells[index]!;
  const spec: HdlCellSpec = HDL_CELLS[cell.type];
  const words = new Set<number>();
  for (const [port, bits] of Object.entries(cell.ports)) {
    if (port === spec.output) continue;
    for (const bit of bits) if (typeof bit === 'number') words.add(layout.word[bit]!);
  }
  return [...words];
}

/** A cell's output words. */
function outputWords(layout: Layout, index: number): number[] {
  const first = layout.cellWord[index]!;
  if (first < 0) return [];
  return Array.from({ length: layout.cellWords[index]! }, (_, k) => first + k);
}

/**
 * A loop's cells as one closure (HDL-9): passes until no output bit changes; past twice its cells
 * and two passes it oscillates, so the bits still changing become `X` until that settles, and
 * `failed[slot]` says so.
 */
function loopClosure(
  pass: WordClosure,
  outputs: readonly number[],
  size: number,
  failed: Uint8Array,
  slot: number,
): WordClosure {
  const limit = 2 * size + 2;
  const v0 = new Int32Array(outputs.length);
  const u0 = new Int32Array(outputs.length);
  const once = (V: Int32Array, U: Int32Array, M: MemoryPlanes): boolean => {
    for (let i = 0; i < outputs.length; i++) {
      v0[i] = V[outputs[i]!]!;
      u0[i] = U[outputs[i]!]!;
    }
    pass(V, U, M);
    for (let i = 0; i < outputs.length; i++) {
      if (V[outputs[i]!] !== v0[i] || U[outputs[i]!] !== u0[i]) return true;
    }
    return false;
  };
  const unknownWhereChanged = (V: Int32Array, U: Int32Array) => {
    for (let i = 0; i < outputs.length; i++) {
      const w = outputs[i]!;
      const changed = (V[w]! ^ v0[i]!) | (U[w]! ^ u0[i]!);
      U[w] = U[w]! | changed;
      V[w] = V[w]! & ~changed;
    }
  };
  return (V, U, M) => {
    for (let p = 0; p < limit; p++) if (!once(V, U, M)) return;
    failed[slot] = 1;
    for (let p = 0; p < limit; p++) {
      unknownWhereChanged(V, U);
      if (!once(V, U, M)) return;
    }
    unknownWhereChanged(V, U);
  };
}

/**
 * Compiles a module's combinational cells (`analysis.order`) into its settle. `readStep` makes
 * a memory read port's closure (HDL-6), which writes its `DATA` words.
 */
export function compileSettle(
  module: HdlModule,
  analysis: HdlAnalysis,
  layout: Layout,
  readStep?: (index: number) => WordClosure,
): Settle {
  const { cells } = module;
  const loopOf = new Int32Array(cells.length).fill(-1);
  for (const [l, members] of analysis.loops.entries()) for (const m of members) loopOf[m] = l;

  // Steps: a cell each, a loop's cells together.
  const stepCells: number[][] = [];
  const stepOf = new Int32Array(cells.length).fill(-1);
  for (const index of analysis.order) {
    const l = loopOf[index]!;
    if (l >= 0 && index !== analysis.loops[l]![0]) {
      stepOf[index] = stepOf[analysis.loops[l]![0]!]!;
      stepCells[stepOf[index]!]!.push(index);
      continue;
    }
    stepOf[index] = stepCells.length;
    stepCells.push([index]);
  }
  const steps = stepCells.length;
  const groups = Math.max(1, Math.ceil(steps / 32));

  // Who reads each word.
  const readers: number[][] = Array.from({ length: layout.words }, () => []);
  for (const [s, members] of stepCells.entries()) {
    for (const index of members) {
      for (const w of inputWords(module, layout, index)) {
        const list = readers[w]!;
        if (list[list.length - 1] !== s) list.push(s);
      }
    }
  }
  const readerStart = new Int32Array(layout.words + 1);
  const pairs: [number, number][] = [];
  for (let w = 0; w < layout.words; w++) {
    readerStart[w] = pairs.length;
    pairs.push(...groupMarks(readers[w]!));
  }
  readerStart[layout.words] = pairs.length;

  /** The marks a step makes when its output words change: their readers after it. */
  const marksOf = (s: number, words: readonly number[]): string => {
    const after = new Set<number>();
    for (const w of words) {
      for (const r of readers[w]!) {
        if (r === s) continue;
        if (r < s) throw new Error(`step ${s} would mark step ${r} before it`);
        after.add(r);
      }
    }
    return groupMarks([...after].sort((p, q) => p - q))
      .map(([g, m]) => `D[${int(g)}] |= ${int(m)};`)
      .join(' ');
  };

  const generator = new Generator(cells, layout);
  const loopFailed = new Uint8Array(analysis.loops.length);
  const sources: string[] = [];
  for (const [s, members] of stepCells.entries()) {
    const g = s >>> 5;
    const m = int((1 << (s & 31)) | 0);
    const words = members.flatMap((index) => outputWords(layout, index));
    const marks = marksOf(s, words);
    let block: string;
    if (members.length > 1 || loopOf[members[0]!]! >= 0) {
      const l = loopOf[members[0]!]!;
      const pass = compileCells(cells, layout, members);
      block = generator.call(loopClosure(pass, words, members.length, loopFailed, l), words, marks);
    } else if (cells[members[0]!]!.type === '$memrd') {
      if (!readStep) throw new Error('a memory read port needs its memory');
      block = generator.call(readStep(members[0]!), words, marks);
    } else block = generator.cell(members[0]!, marks);
    sources.push(`if ((D[${int(g)}] & ${m}) !== 0) {\nD[${int(g)}] &= ~${m};\n${block}}\n`);
  }

  // Functions of about CHUNK_SOURCE characters, each run when a group it covers is marked.
  const chunks: { body: string; first: number; last: number }[] = [];
  let current: { body: string[]; first: number; size: number } | undefined;
  const flush = (last: number) => {
    if (!current) return;
    chunks.push({ body: current.body.join(''), first: current.first, last });
    current = undefined;
  };
  for (const [s, source] of sources.entries()) {
    current ??= { body: [], first: s, size: 0 };
    current.body.push(source);
    current.size += source.length;
    if (current.size >= CHUNK_SOURCE) flush(s);
  }
  flush(steps - 1);
  type Chunk = (
    V: Int32Array,
    U: Int32Array,
    D: Int32Array,
    M: MemoryPlanes,
    C: readonly WordClosure[],
  ) => void;
  const functions = chunks.map((chunk, i) =>
    generated<Chunk>(`settle-${int(i)}`, ['V', 'U', 'D', 'M', 'C'], chunk.body),
  );
  const dispatch = chunks
    .map((chunk, i) => {
      const covered: string[] = [];
      for (let g = chunk.first >>> 5; g <= chunk.last >>> 5; g++)
        covered.push(`D[${int(g)}] !== 0`);
      return `if (${covered.join(' || ')}) F[${int(i)}](V, U, D, M, C);`;
    })
    .join('\n');
  const dispatcher = generated<
    (
      V: Int32Array,
      U: Int32Array,
      D: Int32Array,
      M: MemoryPlanes,
      C: readonly WordClosure[],
      F: readonly Chunk[],
    ) => void
  >('settle', ['V', 'U', 'D', 'M', 'C', 'F'], dispatch);
  const closures = generator.closures;
  return {
    steps,
    groups,
    stepOf,
    readerStart,
    readerGroup: Int32Array.from(pairs, ([g]) => g),
    readerMask: Int32Array.from(pairs, ([, m]) => m),
    loopFailed,
    run: (V, U, marks, M) => dispatcher(V, U, marks, M, closures, functions),
  };
}

/** Steps (ascending) as (group, mask) pairs: one per group they fall in. */
function groupMarks(steps: readonly number[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (const s of steps) {
    const g = s >>> 5;
    const bit = (1 << (s & 31)) | 0;
    const last = pairs[pairs.length - 1];
    if (last && last[0] === g) last[1] = last[1] | bit | 0;
    else pairs.push([g, bit]);
  }
  return pairs;
}

/** The output words of every step, for tests: which words a settle may write. */
export function settleOutputs(module: HdlModule, layout: Layout): number[] {
  return module.cells.flatMap((cell, index) =>
    hdlCellOutput(cell).length > 0 ? outputWords(layout, index) : [],
  );
}
