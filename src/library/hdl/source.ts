/**
 * The pieces generated code is made of (HDL-10, ADR-0037): integers as source text — the one way
 * a value from a module's IR enters it — and the expressions that read an operand's limb from an
 * instance's words. Spec: docs/components.md#verilog-modules-hdl.
 */
import { type Limb, maskOf, type Operand, type Run } from './layout';
import type { MemoryPlanes } from './planes';

/**
 * A cell's semantics on words, run by generated code as `C[slot](V, U, M)`; `M` is the instance's
 * memories, for a memory's read port (HDL-6).
 */
export type WordClosure = (V: Int32Array, U: Int32Array, M: MemoryPlanes) => void;

/**
 * An integer as source text: the one way a value reaches generated code. Throws on anything that
 * isn't a safe integer, so text from a document can never become code.
 */
export function int(n: number): string {
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) {
    throw new Error(`generated code takes integers only, not ${String(n)}`);
  }
  return String(n);
}

/** A 32-bit mask as a signed integer literal (`0xffffffff` → `-1`). */
export const i32 = (n: number): string => int(n | 0);

/** A run's bits in their place in an operand's limb, from `plane` (`V` or `U`). */
function runExpr(run: Run, plane: string): string {
  const word = `${plane}[${int(run.word)}]`;
  if (run.kind === 'fill') {
    return `(-((${word} >>> ${int(run.from)}) & 1) & ${i32(maskOf(run.length) * 2 ** run.to)})`;
  }
  if (run.from === 0 && run.length === 32) return word;
  const shifted =
    run.from + run.length === 32
      ? `(${word} >>> ${int(run.from)})`
      : run.from === 0
        ? `(${word} & ${i32(maskOf(run.length))})`
        : `((${word} >>> ${int(run.from)}) & ${i32(maskOf(run.length))})`;
  return run.to === 0 ? shifted : `(${shifted} << ${int(run.to)})`;
}

/** An operand's limb from one plane: its runs and its constant bits. */
export function limbExpr(limb: Limb, plane: 'V' | 'U'): string {
  const parts = limb.runs.map((run) => runExpr(run, plane));
  const constant = plane === 'V' ? limb.ones : limb.unknown;
  if (constant !== 0) parts.push(i32(constant));
  if (parts.length === 0) return '0';
  return parts.length === 1 ? parts[0]! : `(${parts.join(' | ')})`;
}

/**
 * The one place generated code becomes a function: `body` made by the generators from their
 * templates and `int`, `params` and `name` constants of theirs (`name` shows in profiles and the
 * debugger as `hdl/<name>.js`).
 */
export function generated<F>(name: string, params: readonly string[], body: string): F {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`not a name for generated code: ${name}`);
  return new Function(...params, `'use strict';\n${body}\n//# sourceURL=hdl/${name}.js`) as F;
}

/** Reads an operand's limbs into `v` and `u`: generated once per operand, for closures. */
export type OperandReader = (V: Int32Array, U: Int32Array, v: Uint32Array, u: Uint32Array) => void;

/** The reader of `op`: a function of its limbs' expressions. */
export function operandReader(op: Operand): OperandReader {
  const body = op
    .map(
      (limb, k) => `v[${int(k)}] = ${limbExpr(limb, 'V')};\nu[${int(k)}] = ${limbExpr(limb, 'U')};`,
    )
    .join('\n');
  return generated<OperandReader>('operand', ['V', 'U', 'v', 'u'], body);
}
