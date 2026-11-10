/**
 * The word cells — arithmetic, comparisons, shifts (HDL-1; any width and signedness,
 * multiplication, division and powers, HDL-9) — compiled into steps over the planes. Up to 32 bits a word is a number; wider, 32-bit limbs
 * (`words.ts`) made once per cell, so a step allocates nothing. Operands are extended to the
 * operation's width by index — by their sign bit when signed — as Yosys's cell library
 * (`simlib.v`) does. `X`: sums and products unknown from the lowest unknown bit up, comparisons
 * sure when every value the unknown bits allow agrees (`===` too: a board has no `X` to compare),
 * a shift by an unknown amount, a division or a power with an unknown operand, and a division by
 * zero all `X` (Verilog's and Yosys's `x`; the board's value depends on the synthesis).
 * Spec: docs/components.md#verilog-modules-hdl.
 */
import type { HdlCell } from '../../core';
import { type CellStep, extend, fill, indices, put, putBool, signedOperands, TX } from './planes';
import {
  add,
  bitOf,
  compare,
  divide,
  isZero,
  type Limbs,
  limbCount,
  lowestSet,
  mul,
  negate,
  readWord,
  setFrom,
  sub,
  truncate,
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
    case '$mul':
      return arithmetic(cell, bitCount);
    case '$div':
    case '$mod':
    case '$divfloor':
    case '$modfloor':
      return division(cell, bitCount);
    case '$pow':
      return power(cell, bitCount);
    case '$eq':
    case '$ne':
    case '$eqx':
    case '$nex':
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

/**
 * `$add`, `$sub`, `$neg`, `$mul`: modulo 2^Y, the operands extended or cut to Y's width. A
 * product's bit, like a sum's, depends only on the operands' bits at and below it.
 */
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
      const r =
        (op === '$add'
          ? av + bv
          : op === '$sub'
            ? av - bv
            : op === '$mul'
              ? Math.imul(av, bv)
              : -av) >>> 0;
      const u = ((au | bu) & mask) >>> 0;
      const x = u === 0 ? 0 : (mask & ~((u & -u) - 1)) >>> 0;
      scatter(val, unk, y, r & mask, x);
    };
  }
  const n = limbCount(width);
  const A = word(n);
  const B = word(n);
  const R = word(n);
  const acc = new Float64Array(2 * n);
  return (val, unk) => {
    readWord(val, unk, a, A.v, A.u);
    readWord(val, unk, b, B.v, B.u);
    if (op === '$add') add(R.v, A.v, B.v);
    else if (op === '$sub') sub(R.v, A.v, B.v);
    else if (op === '$mul') mul(R.v, A.v, B.v, acc);
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
  const equal = op === '$eq' || op === '$eqx' ? 1 : 0;
  const equality = equal === 1 || op === '$ne' || op === '$nex';
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

/** Makes `a` (a `width`-bit two's complement value) its magnitude; says whether it was negative. */
function magnitude(a: Limbs, width: number): boolean {
  if (!bitOf(a, width - 1)) return false;
  setFrom(a, width);
  negate(a, a);
  return true;
}

/**
 * `$div` `$mod` (truncating, as Verilog) and `$divfloor` `$modfloor` (floor: a remainder takes
 * the divisor's sign): at the widest of A, B and Y, signed when both operands are, on the
 * magnitudes with the signs put back. Any unknown bit, or a zero divisor, makes Y all `X`.
 */
function division(cell: HdlCell, bitCount: number): CellStep {
  const op = cell.type;
  const signed = signedOperands(cell, 2);
  const aBits = indices(cell, 'A', bitCount);
  const bBits = indices(cell, 'B', bitCount);
  const y = indices(cell, 'Y', bitCount);
  const width = Math.max(aBits.length, bBits.length, y.length);
  const a = extend(aBits, width, bitCount, signed);
  const b = extend(bBits, width, bitCount, signed);
  const floor = op === '$divfloor' || op === '$modfloor';
  const quotient = op === '$div' || op === '$divfloor';
  // One bit more than the width: the restoring division's partial remainder needs it.
  const n = limbCount(width + 1);
  const A = word(n);
  const B = word(n);
  const divisor = new Uint32Array(n);
  const q = new Uint32Array(n);
  const r = new Uint32Array(n);
  const one = new Uint32Array(n);
  one[0] = 1;
  const known = new Uint32Array(n);
  return (val, unk) => {
    readWord(val, unk, a, A.v, A.u);
    readWord(val, unk, b, B.v, B.u);
    if (!isZero(A.u) || !isZero(B.u) || isZero(B.v)) {
      fill(val, unk, y, TX);
      return;
    }
    divisor.set(B.v);
    const aNegative = signed && magnitude(A.v, width);
    const bNegative = signed && magnitude(divisor, width);
    divide(q, r, A.v, divisor, width);
    const differ = aNegative !== bNegative;
    const result = quotient ? q : r;
    if (quotient) {
      // Floor rounds a negative quotient with a remainder down, away from zero.
      if (floor && differ && !isZero(r)) add(q, q, one);
      if (differ) negate(q, q);
    } else {
      if (aNegative) negate(r, r);
      // Floor gives the remainder the divisor's sign: r + B when their signs differ.
      if (floor && differ && !isZero(r)) {
        if (bNegative) setFrom(B.v, width);
        add(r, r, B.v);
      }
    }
    truncate(result, width);
    writeWord(val, unk, y, result, known);
  };
}

/**
 * `$pow`: A ** B modulo 2^Y, the base signed when A_SIGNED and the exponent when B_SIGNED
 * (`simlib.v`'s four cases), with Verilog's rules for a negative exponent: 0 ** −n is `x`,
 * 1 ** −n is 1, −1 ** −n is ±1, any other base 0. Square and multiply over the exponent's bits.
 */
function power(cell: HdlCell, bitCount: number): CellStep {
  const y = indices(cell, 'Y', bitCount);
  const width = y.length;
  const aBits = indices(cell, 'A', bitCount);
  const b = indices(cell, 'B', bitCount);
  const signedA = cell.params.A_SIGNED === 1;
  const signedB = cell.params.B_SIGNED === 1;
  // The base extended or cut to Y: the result modulo 2^Y depends on nothing above.
  const a = extend(aBits, width, bitCount, signedA);
  const n = limbCount(width);
  const A = word(n);
  const B = word(limbCount(b.length));
  const base = new Uint32Array(n);
  const R = word(n);
  const acc = new Float64Array(2 * n);
  /** Whether A's own bits (not their extension) are all 1: −1 when signed. */
  const minusOne = (val: Uint8Array): boolean => {
    for (let i = 0; i < aBits.length; i++) if (!val[aBits[i]!]) return false;
    return true;
  };
  return (val, unk) => {
    readWord(val, unk, a, A.v, A.u);
    readWord(val, unk, b, B.v, B.u);
    if (!isZero(A.u) || !isZero(B.u)) {
      fill(val, unk, y, TX);
      return;
    }
    let zero = true;
    for (let i = 0; i < aBits.length && zero; i++) zero = val[aBits[i]!] === 0;
    let one = !zero && val[aBits[0]!] === 1;
    for (let i = 1; i < aBits.length && one; i++) one = val[aBits[i]!] === 0;
    R.v.fill(0);
    if (signedB && bitOf(B.v, b.length - 1)) {
      // A negative exponent.
      if (zero) {
        fill(val, unk, y, TX);
        return;
      }
      if (one) R.v[0] = 1;
      else if (signedA && minusOne(val)) {
        if (bitOf(B.v, 0)) setFrom(R.v, 0);
        else R.v[0] = 1;
      }
    } else {
      R.v[0] = 1;
      base.set(A.v);
      let top = b.length - 1;
      while (top >= 0 && !bitOf(B.v, top)) top--;
      for (let i = 0; i <= top; i++) {
        if (bitOf(B.v, i)) mul(R.v, R.v, base, acc);
        if (i < top) mul(base, base, base, acc);
      }
    }
    writeWord(val, unk, y, R.v, R.u);
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
