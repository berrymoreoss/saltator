/**
 * The word cells — arithmetic, comparisons, shifts (HDL-1; any width and signedness, HDL-9) —
 * compiled into steps over the planes. Up to 32 bits a word is a number; wider, 32-bit limbs
 * (`words.ts`) made once per cell, so a step allocates nothing. Operands are extended to the
 * operation's width by index — by their sign bit when signed — as Yosys's cell library
 * (`simlib.v`) does. `X`: arithmetic unknown from the lowest unknown bit up, comparisons sure when
 * every value the unknown bits allow agrees, a shift by an unknown amount all `X`.
 * Spec: docs/components.md#verilog-modules-hdl.
 */
import type { HdlCell } from '../../core';
import { type CellStep, extend, fill, indices, put, putBool, signedOperands, TX } from './planes';
import {
  add,
  bitOf,
  compare,
  isZero,
  type Limbs,
  limbCount,
  lowestSet,
  negate,
  readWord,
  setFrom,
  sub,
  writeWord,
} from './words';

/** Bits 0…width−1 set (width ≤ 32). */
const maskOf = (width: number) => (width >= 32 ? 0xffffffff : 2 ** width - 1);

// A word of at most 32 bits read from the planes: its value (unknown bits 0) and its unknown
// bits. Module-level registers, so reading a word allocates nothing; valid until the next `gather`.
let wv = 0;
let wu = 0;

function gather(val: Uint8Array, unk: Uint8Array, idx: Int32Array): void {
  let v = 0;
  let u = 0;
  for (let i = 0; i < idx.length; i++) {
    const b = idx[i]!;
    if (unk[b]) u |= 1 << i;
    else if (val[b]) v |= 1 << i;
  }
  wv = v >>> 0;
  wu = u >>> 0;
}

function scatter(val: Uint8Array, unk: Uint8Array, idx: Int32Array, v: number, u: number): void {
  for (let i = 0; i < idx.length; i++) {
    const b = idx[i]!;
    const x = (u >>> i) & 1;
    unk[b] = x;
    val[b] = x ? 0 : (v >>> i) & 1;
  }
}

/** Compiles a word cell into its step; undefined when `cell` is not one. */
export function compileWordStep(cell: HdlCell, bitCount: number): CellStep | undefined {
  switch (cell.type) {
    case '$add':
    case '$sub':
    case '$neg':
      return arithmetic(cell, bitCount);
    case '$eq':
    case '$ne':
    case '$lt':
    case '$le':
    case '$gt':
    case '$ge':
      return comparison(cell, bitCount);
    case '$shl':
    case '$sshl':
    case '$shr':
    case '$sshr':
    case '$shift':
    case '$shiftx':
      return shift(cell, bitCount);
    default:
      return undefined;
  }
}

/** Limbs for one word: its value and its unknown bits. */
const word = (n: number) => ({ v: new Uint32Array(n), u: new Uint32Array(n) });

/** `u` = every bit from the lowest unknown bit of `a` or `b` up: a sum's bit depends on those below. */
function unknownFromLowest(u: Limbs, a: Limbs, b: Limbs): void {
  u.fill(0);
  const pa = lowestSet(a);
  const pb = lowestSet(b);
  const p = pa < 0 ? pb : pb < 0 ? pa : Math.min(pa, pb);
  if (p >= 0) setFrom(u, p);
}

/** `$add`, `$sub`, `$neg`: modulo 2^Y, the operands extended or cut to Y's width. */
function arithmetic(cell: HdlCell, bitCount: number): CellStep {
  const op = cell.type;
  const y = indices(cell, 'Y', bitCount);
  const width = y.length;
  const signed = signedOperands(cell, op === '$neg' ? 1 : 2);
  // Only Y's bits are computed: no operand bit above them can change one.
  const a = extend(indices(cell, 'A', bitCount), width, bitCount, signed);
  const b = extend(indices(cell, 'B', bitCount), width, bitCount, signed);
  if (width <= 32) {
    const mask = maskOf(width);
    return (val, unk) => {
      gather(val, unk, a);
      const av = wv;
      const au = wu;
      gather(val, unk, b);
      const bv = wv;
      const bu = wu;
      const r = (op === '$add' ? av + bv : op === '$sub' ? av - bv : -av) >>> 0;
      const u = ((au | bu) & mask) >>> 0;
      const x = u === 0 ? 0 : (mask & ~((u & -u) - 1)) >>> 0;
      scatter(val, unk, y, r & mask, x);
    };
  }
  const n = limbCount(width);
  const A = word(n);
  const B = word(n);
  const R = word(n);
  return (val, unk) => {
    readWord(val, unk, a, A.v, A.u);
    readWord(val, unk, b, B.v, B.u);
    if (op === '$add') add(R.v, A.v, B.v);
    else if (op === '$sub') sub(R.v, A.v, B.v);
    else negate(R.v, A.v);
    unknownFromLowest(R.u, A.u, B.u);
    writeWord(val, unk, y, R.v, R.u);
  };
}

/**
 * `$eq` `$ne` `$lt` `$le` `$gt` `$ge`: at the wider operand's width, signed when both operands
 * are. Signed order is unsigned order with the sign bit flipped, so the range unknown bits allow is
 * the same min/max either way.
 */
function comparison(cell: HdlCell, bitCount: number): CellStep {
  const op = cell.type;
  const signed = signedOperands(cell, 2);
  const aBits = indices(cell, 'A', bitCount);
  const bBits = indices(cell, 'B', bitCount);
  const width = Math.max(aBits.length, bBits.length);
  const a = extend(aBits, width, bitCount, signed);
  const b = extend(bBits, width, bitCount, signed);
  const y = indices(cell, 'Y', bitCount);
  const equal = op === '$eq' ? 1 : 0;
  const equality = op === '$eq' || op === '$ne';
  /** The answer from the ranges of A and B: 1, 0, or `X` when they overlap the wrong way. */
  const order = (aBelowB: boolean, aAtLeastB: boolean, aAboveB: boolean, aAtMostB: boolean) =>
    op === '$lt'
      ? aBelowB
        ? 1
        : aAtLeastB
          ? 0
          : TX
      : op === '$le'
        ? aAtMostB
          ? 1
          : aAboveB
            ? 0
            : TX
        : op === '$gt'
          ? aAboveB
            ? 1
            : aAtMostB
              ? 0
              : TX
          : aAtLeastB
            ? 1
            : aBelowB
              ? 0
              : TX;

  if (width <= 32) {
    const flip = signed ? 2 ** (width - 1) : 0;
    return (val, unk) => {
      gather(val, unk, a);
      const av = wv;
      const au = wu;
      gather(val, unk, b);
      const bv = wv;
      const bu = wu;
      if (equality) {
        const known = ~(au | bu);
        const t = ((av ^ bv) & known) !== 0 ? 1 - equal : (au | bu) !== 0 ? TX : equal;
        putBool(val, unk, y, t);
        return;
      }
      const aMin = ((av ^ flip) & ~au) >>> 0;
      const aMax = ((av ^ flip) | au) >>> 0;
      const bMin = ((bv ^ flip) & ~bu) >>> 0;
      const bMax = ((bv ^ flip) | bu) >>> 0;
      // Sure when every value the unknown bits allow gives the same answer.
      putBool(val, unk, y, order(aMax < bMin, aMin >= bMax, aMin > bMax, aMax <= bMin));
    };
  }

  const n = limbCount(width);
  const A = word(n);
  const B = word(n);
  const aMin = new Uint32Array(n);
  const aMax = new Uint32Array(n);
  const bMin = new Uint32Array(n);
  const bMax = new Uint32Array(n);
  const signLimb = (width - 1) >>> 5;
  const signBit = signed ? 1 << ((width - 1) & 31) : 0;
  return (val, unk) => {
    readWord(val, unk, a, A.v, A.u);
    readWord(val, unk, b, B.v, B.u);
    if (equality) {
      let differ = false;
      let unknown = false;
      for (let k = 0; k < n; k++) {
        const u = A.u[k]! | B.u[k]!;
        if (((A.v[k]! ^ B.v[k]!) & ~u) !== 0) differ = true;
        if (u !== 0) unknown = true;
      }
      putBool(val, unk, y, differ ? 1 - equal : unknown ? TX : equal);
      return;
    }
    for (let k = 0; k < n; k++) {
      const f = k === signLimb ? signBit : 0;
      aMin[k] = (A.v[k]! ^ f) & ~A.u[k]!;
      aMax[k] = (A.v[k]! ^ f) | A.u[k]!;
      bMin[k] = (B.v[k]! ^ f) & ~B.u[k]!;
      bMax[k] = (B.v[k]! ^ f) | B.u[k]!;
    }
    putBool(
      val,
      unk,
      y,
      order(
        compare(aMax, bMin) < 0,
        compare(aMin, bMax) >= 0,
        compare(aMin, bMax) > 0,
        compare(aMax, bMin) <= 0,
      ),
    );
  };
}

/** A number from limbs: exact up to 2^53, beyond only huge (which shifts everything out). */
function toNumber(v: Limbs): number {
  let x = 0;
  for (let k = v.length - 1; k >= 0; k--) x = x * 2 ** 32 + v[k]!;
  return x;
}

/**
 * The shifts. `A` is extended to the wider of A and Y by its signedness first (Yosys's
 * `$signed(A) >> B`), except in `$shiftx`, which selects Y's bits from A as it is (`A[B +: Y]`,
 * out of range `X`). `$sshr` of a signed A fills with its sign; a signed amount of `$shift` and
 * `$shiftx` below 0 shifts the other way.
 */
function shift(cell: HdlCell, bitCount: number): CellStep {
  const type = cell.type;
  const y = indices(cell, 'Y', bitCount);
  const width = y.length;
  const aBits = indices(cell, 'A', bitCount);
  const b = indices(cell, 'B', bitCount);
  const signedA = cell.params.A_SIGNED === 1;
  const signedB = (type === '$shift' || type === '$shiftx') && cell.params.B_SIGNED === 1;
  const selects = type === '$shiftx';
  const a = selects ? aBits : extend(aBits, Math.max(aBits.length, width), bitCount, signedA);
  const top = a.length - 1;
  const fillsSign = type === '$sshr' && signedA;
  const left = type === '$shl' || type === '$sshl';
  const outside = selects ? TX : 0;
  const n = limbCount(b.length);
  const B = word(n);
  const magnitude = new Uint32Array(n);
  return (val, unk) => {
    readWord(val, unk, b, B.v, B.u);
    if (!isZero(B.u)) {
      fill(val, unk, y, TX);
      return;
    }
    let amount: number;
    if (signedB && bitOf(B.v, b.length - 1)) {
      // A negative amount: minus its magnitude, from the two's complement.
      magnitude.set(B.v);
      setFrom(magnitude, b.length);
      negate(magnitude, magnitude);
      amount = -toNumber(magnitude);
    } else amount = toNumber(B.v);
    for (let i = 0; i < width; i++) {
      const from = left ? i - amount : i + amount;
      const target = y[i]!;
      if (from >= 0 && from <= top) {
        const src = a[from]!;
        unk[target] = unk[src]!;
        val[target] = val[src]!;
      } else if (fillsSign && from > top) {
        unk[target] = unk[a[top]!]!;
        val[target] = val[a[top]!]!;
      } else put(val, unk, target, outside);
    }
  };
}
