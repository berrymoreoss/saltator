/**
 * An instance's bit planes (HDL-1): a byte per bit for its value and one for "unknown", the
 * constants 0, 1 and x after the signal bits — and the small operations every cell is built from.
 * Spec: docs/components.md#verilog-modules-hdl.
 */
import type { HdlBit, HdlCell } from '../../core';

/** A bit's planes as one value: 0, 1, or `X` (2). */
export const TX = 2;

/** A combinational cell or a latch: computes its outputs in the planes from its inputs there. */
export type CellStep = (val: Uint8Array, unk: Uint8Array) => void;

/** The plane index of a bit: signal bits as numbered, the constants 0, 1, x after them. */
export function planeIndex(bit: HdlBit, bitCount: number): number {
  return typeof bit === 'number' ? bit : bitCount + (bit === '0' ? 0 : bit === '1' ? 1 : 2);
}

/** Planes for `bitCount` bits, every signal bit unknown, the constants set. */
export function newPlanes(bitCount: number): { val: Uint8Array; unk: Uint8Array } {
  const val = new Uint8Array(bitCount + 3);
  const unk = new Uint8Array(bitCount + 3).fill(1, 0, bitCount);
  val[bitCount + 1] = 1;
  unk[bitCount + 2] = 1;
  return { val, unk };
}

/** A bit of the planes as one value: 0, 1, or `X`. */
export const tri = (val: Uint8Array, unk: Uint8Array, b: number) => (unk[b] ? TX : val[b]!);

/** Sets a bit of the planes to 0, 1, or `X`. */
export function put(val: Uint8Array, unk: Uint8Array, b: number, t: number): void {
  unk[b] = t === TX ? 1 : 0;
  val[b] = t === 1 ? 1 : 0;
}

/** One of two outcomes: the value if they agree, else `X`. */
export const merge = (a: number, b: number) => (a === b ? a : TX);

/** What a control at `c` picks: `yes` when 1, `no` when 0, both merged when unknown. */
export const pick = (c: number, yes: number, no: number) =>
  c === 1 ? yes : c === 0 ? no : merge(yes, no);

/** Every bit `X`, or every bit the constant 0. */
export function fill(val: Uint8Array, unk: Uint8Array, idx: Int32Array, t: number): void {
  for (let i = 0; i < idx.length; i++) put(val, unk, idx[i]!, t);
}

/** Writes a one-bit result into bit 0 of Y and zeros above it. */
export function putBool(val: Uint8Array, unk: Uint8Array, y: Int32Array, t: number): void {
  put(val, unk, y[0]!, t);
  for (let i = 1; i < y.length; i++) put(val, unk, y[i]!, 0);
}

/** The cell's port bits as plane indices. */
export function indices(cell: HdlCell, port: string, bitCount: number): Int32Array {
  return Int32Array.from(cell.ports[port] ?? [], (bit) => planeIndex(bit, bitCount));
}

/**
 * A word's bits as plane indices, cut or extended to `width`: by its sign bit when `signed` (two's
 * complement), else by the constant 0 (`zero`, its plane index).
 */
export function extend(idx: Int32Array, width: number, zero: number, signed = false): Int32Array {
  const out = new Int32Array(width).fill(signed && idx.length > 0 ? idx[idx.length - 1]! : zero);
  out.set(idx.subarray(0, Math.min(width, idx.length)));
  return out;
}

/**
 * Whether a cell's operands are signed, as Yosys's cell library reads them: `A_SIGNED` for one
 * operand, both flags for two — `$add` of a signed and an unsigned operand is unsigned.
 */
export const signedOperands = (cell: HdlCell, operands: 1 | 2): boolean =>
  cell.params.A_SIGNED === 1 && (operands === 1 || cell.params.B_SIGNED === 1);
