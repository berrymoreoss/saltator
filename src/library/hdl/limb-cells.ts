/**
 * Cells run as closures over an instance's words (HDL-10), where generated code would gain
 * little: the shifts, a 32-bit window of the operand at a position known only when they run. Their
 * operands are read through the layout's runs into limbs, their output written a word at a time,
 * with the semantics of `word-cells.ts`: `A` extended to the wider of A and Y by its signedness
 * (as it is for `$shiftx`), `$sshr` of a signed A filling with its sign, a signed amount of
 * `$shift`/`$shiftx` below 0 shifting the other way, out of range 0 (`X` for `$shiftx`), an
 * unknown amount all `X`. Spec: docs/components.md#verilog-modules-hdl.
 */
import { type HdlCell, hdlCellOutput } from '../../core';
import { extendBits, type Layout, limbsOf, maskOf, operand } from './layout';
import { operandReader, type WordClosure } from './source';
import { bitOf, negate, setFrom } from './words';

/**
 * The 32 bits of `src` (bits 0…top) from position `p` up; positions below 0 read `low` (0 or 1),
 * above `top` read `high`.
 */
export function window(
  src: Uint32Array,
  top: number,
  p: number,
  low: number,
  high: number,
): number {
  let r = 0;
  const lo = Math.max(p, 0);
  const hi = Math.min(p + 31, top);
  if (lo <= hi) {
    const length = hi - lo + 1;
    const k = lo >>> 5;
    const o = lo & 31;
    let x = src[k]! >>> o;
    if (o !== 0 && length > 32 - o) x |= src[k + 1]! << (32 - o);
    if (length < 32) x &= (1 << length) - 1;
    r = x << (lo - p);
  }
  if (low !== 0 && p < 0) r |= p <= -32 ? -1 : (1 << -p) - 1;
  if (high !== 0) {
    const start = top + 1 - p;
    if (start < 32) r |= start <= 0 ? -1 : -1 << start;
  }
  return r;
}

/** A number from limbs: exact up to 2^53, beyond only huge (which shifts everything out). */
function toNumber(v: Uint32Array): number {
  let x = 0;
  for (let k = v.length - 1; k >= 0; k--) x = x * 2 ** 32 + v[k]!;
  return x;
}

/** A shift cell (`$shl` `$sshl` `$shr` `$sshr` `$shift` `$shiftx`) whose output starts at word `first`. */
export function shiftClosure(cell: HdlCell, layout: Layout, first: number): WordClosure {
  const type = cell.type;
  const width = hdlCellOutput(cell).length;
  const aBits = cell.ports.A ?? [];
  const bBits = cell.ports.B ?? [];
  const signedA = cell.params.A_SIGNED === 1;
  const signedB = (type === '$shift' || type === '$shiftx') && cell.params.B_SIGNED === 1;
  const selects = type === '$shiftx';
  const a = selects ? aBits : extendBits(aBits, Math.max(aBits.length, width), signedA);
  const top = a.length - 1;
  const fillsSign = type === '$sshr' && signedA;
  const left = type === '$shl' || type === '$sshl';
  const outsideU = selects ? 1 : 0;
  const aOp = operand(layout, a);
  const bOp = operand(layout, bBits);
  const readA = operandReader(aOp);
  const readB = operandReader(bOp);
  // One limb more than A has: a window reads the limb above its first.
  const av = new Uint32Array(aOp.length + 1);
  const au = new Uint32Array(aOp.length + 1);
  const bv = new Uint32Array(bOp.length);
  const bu = new Uint32Array(bOp.length);
  const limbs = limbsOf(width);
  const masks = Int32Array.from({ length: limbs }, (_, k) => maskOf(Math.min(32, width - 32 * k)));
  return (V, U) => {
    readB(V, U, bv, bu);
    let unknown = 0;
    for (let k = 0; k < bu.length; k++) unknown |= bu[k]!;
    if (unknown !== 0) {
      for (let k = 0; k < limbs; k++) {
        V[first + k] = 0;
        U[first + k] = masks[k]!;
      }
      return;
    }
    let amount: number;
    if (signedB && bitOf(bv, bBits.length - 1)) {
      // A negative amount: minus its magnitude, from the two's complement.
      setFrom(bv, bBits.length);
      negate(bv, bv);
      amount = -toNumber(bv);
    } else amount = toNumber(bv);
    readA(V, U, av, au);
    const highV = fillsSign ? bitOf(av, top) : 0;
    const highU = fillsSign ? bitOf(au, top) : outsideU;
    for (let k = 0; k < limbs; k++) {
      const p = left ? 32 * k - amount : 32 * k + amount;
      const m = masks[k]!;
      const u = window(au, top, p, outsideU, highU) & m;
      U[first + k] = u;
      V[first + k] = window(av, top, p, 0, highV) & m & ~u;
    }
  };
}
