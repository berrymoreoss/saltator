/**
 * Where an instance keeps each bit of a module (HDL-10): 32-bit words in two planes, values and
 * unknowns (`v`, `u`, a bit of `u` 1 where unknown and `v`'s bit 0 there) — what the byte planes
 * held, 32 bits at a time. Each cell's output gets its own words from bit 0 (limbs past 32 bits),
 * each port's bits read from pins theirs, the bits nothing drives theirs (unknown unless `init`
 * says otherwise, never written). What a cell reads — a list of bits, extended to a width — is
 * found once as an operand: per 32-bit limb, runs of a word's bits shifted into place, a bit
 * repeated (a signed operand's extension), and constant ones and unknowns.
 * Spec: docs/components.md#verilog-modules-hdl.
 */
import { type HdlBit, type HdlModule, hdlCellOutput } from '../../core';
import { type HdlAnalysis, PIN } from './analyze';

/** Where a module's bits live. */
export interface Layout {
  /** The number of words in each plane. */
  readonly words: number;
  /** Per signal bit, its word and its position in it (0–31). */
  readonly word: Int32Array;
  readonly pos: Uint8Array;
  /** Per cell, its output's first word (its limbs follow); −1 for a cell without an output. */
  readonly cellWord: Int32Array;
  /** Per cell, how many words its output has. */
  readonly cellWords: Int32Array;
}

/** `length` bits of `word` from position `from`, placed at `to` up in the limb. */
export interface BitsRun {
  readonly kind: 'bits';
  readonly word: number;
  readonly from: number;
  readonly to: number;
  readonly length: number;
}

/** Bit `from` of `word` repeated over positions `to`…`to + length − 1` of the limb. */
export interface FillRun {
  readonly kind: 'fill';
  readonly word: number;
  readonly from: number;
  readonly to: number;
  readonly length: number;
}

export type Run = BitsRun | FillRun;

/** 32 bits of an operand: its runs, its constant ones and its constant unknown bits. */
export interface Limb {
  readonly runs: readonly Run[];
  readonly ones: number;
  readonly unknown: number;
  /** How many of its bits the operand has (32 but in its last limb). */
  readonly width: number;
}

/** An operand's limbs, least significant first. */
export type Operand = readonly Limb[];

/** Bits 0…width−1 set, as an unsigned number (width ≤ 32). */
export const maskOf = (width: number): number => (width >= 32 ? 0xffffffff : 2 ** width - 1);

/** The number of 32-bit limbs `width` bits take (at least one). */
export const limbsOf = (width: number): number => Math.max(1, Math.ceil(width / 32));

/**
 * The layout of a module the analysis accepted: the input ports' bits first, then the inouts'
 * that pins drive, then each cell's output in evaluation order (combinational cells, then
 * flip-flops, then the rest), then the bits nothing drives.
 */
export function layoutModule(module: HdlModule, analysis: HdlAnalysis): Layout {
  const { bitCount, cells } = module;
  const { driver } = analysis;
  const word = new Int32Array(bitCount).fill(-1);
  const pos = new Uint8Array(bitCount);
  const cellWord = new Int32Array(cells.length).fill(-1);
  const cellWords = new Int32Array(cells.length);
  let words = 0;
  /** Gives `bits` (an index each, −1 to skip) words of their own, bit i at position i. */
  const place = (bits: readonly number[]): number => {
    const first = words;
    let used = false;
    for (const [i, b] of bits.entries()) {
      if (b < 0 || word[b]! >= 0) continue;
      word[b] = first + (i >>> 5);
      pos[b] = i & 31;
      used = true;
    }
    if (used) words += limbsOf(bits.length);
    return used ? first : -1;
  };
  const pinBits = (dir: 'in' | 'inout') => {
    for (const port of module.ports) {
      if (port.dir !== dir) continue;
      place(port.bits.map((bit) => (typeof bit === 'number' && driver[bit] === PIN ? bit : -1)));
    }
  };
  pinBits('in');
  pinBits('inout');
  const placeCell = (index: number) => {
    if (cellWord[index]! >= 0) return;
    const output = hdlCellOutput(cells[index]!);
    if (output.length === 0) return;
    const first = place(
      output.map((bit) => (typeof bit === 'number' && driver[bit] === index ? bit : -1)),
    );
    if (first < 0) return;
    cellWord[index] = first;
    cellWords[index] = limbsOf(output.length);
  };
  for (const index of analysis.order) placeCell(index);
  for (const index of analysis.flipFlops) placeCell(index);
  for (let index = 0; index < cells.length; index++) placeCell(index);
  const undriven: number[] = [];
  for (let b = 0; b < bitCount; b++) if (word[b]! < 0) undriven.push(b);
  for (let i = 0; i < undriven.length; i += 32) place(undriven.slice(i, i + 32));
  return { words, word, pos, cellWord, cellWords };
}

/** `bits` cut or extended to `width`: by the top bit when `signed`, else by the constant 0. */
export function extendBits(
  bits: readonly HdlBit[],
  width: number,
  signed = false,
): readonly HdlBit[] {
  if (bits.length === width) return bits;
  if (bits.length > width) return bits.slice(0, width);
  const fill: HdlBit = signed && bits.length > 0 ? bits[bits.length - 1]! : '0';
  return [...bits, ...Array.from({ length: width - bits.length }, () => fill)];
}

/** The operand `bits` (least significant first) read through `layout`. */
export function operand(layout: Layout, bits: readonly HdlBit[]): Operand {
  const limbs: Limb[] = [];
  for (let base = 0; base < Math.max(1, bits.length); base += 32) {
    const width = Math.min(32, bits.length - base);
    const runs: Run[] = [];
    let ones = 0;
    let unknown = 0;
    for (let k = 0; k < width; k++) {
      const bit = bits[base + k]!;
      if (bit === '0') continue;
      if (bit === '1' || bit === 'x') {
        if (bit === '1') ones |= 1 << k;
        else unknown |= 1 << k;
        continue;
      }
      const w = layout.word[bit]!;
      const p = layout.pos[bit]!;
      const last = runs[runs.length - 1];
      const prev = k > 0 ? bits[base + k - 1] : undefined;
      if (last && last.to + last.length === k && last.word === w) {
        if (prev === bit && (last.kind === 'fill' || last.length === 1)) {
          // The same bit again: a fill.
          runs[runs.length - 1] = { ...last, kind: 'fill', length: last.length + 1 };
          continue;
        }
        if (last.kind === 'bits' && p === last.from + last.length) {
          runs[runs.length - 1] = { ...last, length: last.length + 1 };
          continue;
        }
      }
      runs.push({ kind: 'bits', word: w, from: p, to: k, length: 1 });
    }
    limbs.push({ runs, ones: ones >>> 0, unknown: unknown >>> 0, width: Math.max(0, width) });
  }
  return limbs;
}

/** A run's bits of `plane` (values or unknowns) in their place in the limb, unsigned. */
export function runBits(plane: Int32Array, run: Run): number {
  const bit = plane[run.word]! >>> run.from;
  if (run.kind === 'fill') return bit & 1 ? (maskOf(run.length) * 2 ** run.to) >>> 0 : 0;
  return ((bit & maskOf(run.length)) * 2 ** run.to) >>> 0;
}

/**
 * Reads `op` from the planes into `v` and `u` (a limb each): what generated code does inline,
 * for tests and the helpers of uncommon cells.
 */
export function readOperand(
  planeV: Int32Array,
  planeU: Int32Array,
  op: Operand,
  v: Uint32Array,
  u: Uint32Array,
): void {
  for (let k = 0; k < op.length; k++) {
    const limb = op[k]!;
    let lv = limb.ones;
    let lu = limb.unknown;
    for (const run of limb.runs) {
      lv |= runBits(planeV, run);
      lu |= runBits(planeU, run);
    }
    v[k] = lv;
    u[k] = lu;
  }
}

/** A bit of the planes: 0, 1, or 2 (`X`); constants as they are. */
export function bitLevel(layout: Layout, v: Int32Array, u: Int32Array, bit: HdlBit): number {
  if (bit === '0') return 0;
  if (bit === '1') return 1;
  if (bit === 'x') return 2;
  const w = layout.word[bit]!;
  const p = layout.pos[bit]!;
  return (u[w]! >>> p) & 1 ? 2 : (v[w]! >>> p) & 1;
}

/** Sets a signal bit of the planes to 0, 1, or 2 (`X`). */
export function setBit(layout: Layout, v: Int32Array, u: Int32Array, bit: number, t: number): void {
  const w = layout.word[bit]!;
  const m = 1 << layout.pos[bit]!;
  if (t === 2) {
    u[w] = u[w]! | m;
    v[w] = v[w]! & ~m;
  } else {
    u[w] = u[w]! & ~m;
    v[w] = t === 1 ? v[w]! | m : v[w]! & ~m;
  }
}

/**
 * Per word, the bits that hold a signal bit. The others stay 0 in both planes (every write is
 * masked to its bits), so comparing whole words says whether a bit changed.
 */
export function usedBits(layout: Layout): Int32Array {
  const used = new Int32Array(layout.words);
  for (let b = 0; b < layout.word.length; b++) {
    const w = layout.word[b]!;
    used[w] = used[w]! | (1 << layout.pos[b]!);
  }
  return used;
}
