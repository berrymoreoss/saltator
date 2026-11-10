/**
 * Words of any width as 32-bit limbs, least significant first (HDL-9): what the interpreter's word
 * cells compute on — arithmetic modulo 2^(32 × limbs), unsigned; callers handle two's complement
 * by sign extension and negation. Every function writes into limbs the caller made once per cell,
 * so nothing is allocated while a module runs. Spec: docs/components.md#verilog-modules-hdl.
 */

/** A word's limbs: 32 bits each, least significant first. */
export type Limbs = Uint32Array;

/** Limbs for a word of `width` bits (at least one). */
export const limbCount = (width: number): number => Math.max(1, Math.ceil(width / 32));

/** Reads bits `idx` of the planes into `v` (values, unknown bits 0) and `u` (unknown bits). */
export function readWord(
  val: Uint8Array,
  unk: Uint8Array,
  idx: Int32Array,
  v: Limbs,
  u: Limbs,
): void {
  v.fill(0);
  u.fill(0);
  for (let i = 0; i < idx.length; i++) {
    const b = idx[i]!;
    const k = i >>> 5;
    const m = 1 << (i & 31);
    if (unk[b]) u[k]! |= m;
    else if (val[b]) v[k]! |= m;
  }
}

/** Writes the low `idx.length` bits of `v` (values) and `u` (unknown bits) into the planes. */
export function writeWord(
  val: Uint8Array,
  unk: Uint8Array,
  idx: Int32Array,
  v: Limbs,
  u: Limbs,
): void {
  for (let i = 0; i < idx.length; i++) {
    const b = idx[i]!;
    const k = i >>> 5;
    const s = i & 31;
    const x = (u[k]! >>> s) & 1;
    unk[b] = x;
    val[b] = x ? 0 : (v[k]! >>> s) & 1;
  }
}

/** Bit `i` of `a`: 0 or 1. */
export const bitOf = (a: Limbs, i: number): number => (a[i >>> 5]! >>> (i & 31)) & 1;

/** Whether every limb is 0. */
export function isZero(a: Limbs): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== 0) return false;
  return true;
}

/** The lowest set bit of `a`, or −1. */
export function lowestSet(a: Limbs): number {
  for (let k = 0; k < a.length; k++) {
    const x = a[k]!;
    if (x !== 0) return k * 32 + (31 - Math.clz32(x & -x));
  }
  return -1;
}

/** Sets every bit from `from` up (within the limbs). */
export function setFrom(a: Limbs, from: number): void {
  for (let k = from >>> 5; k < a.length; k++) {
    const low = k * 32;
    a[k] = from <= low ? 0xffffffff : a[k]! | (0xffffffff << (from - low));
  }
}

/** Clears every bit from `width` up. */
export function truncate(a: Limbs, width: number): void {
  for (let k = width >>> 5; k < a.length; k++) {
    const low = k * 32;
    a[k] = width <= low ? 0 : a[k]! & (2 ** (width - low) - 1);
  }
}

/** r = a + b. `r` may be `a` or `b`. */
export function add(r: Limbs, a: Limbs, b: Limbs): void {
  let carry = 0;
  for (let k = 0; k < r.length; k++) {
    const s = a[k]! + b[k]! + carry;
    r[k] = s;
    carry = s > 0xffffffff ? 1 : 0;
  }
}

/** r = a − b. `r` may be `a` or `b`. */
export function sub(r: Limbs, a: Limbs, b: Limbs): void {
  let borrow = 0;
  for (let k = 0; k < r.length; k++) {
    const d = a[k]! - b[k]! - borrow;
    r[k] = d;
    borrow = d < 0 ? 1 : 0;
  }
}

/** r = −a. `r` may be `a`. */
export function negate(r: Limbs, a: Limbs): void {
  let borrow = 0;
  for (let k = 0; k < r.length; k++) {
    const d = -a[k]! - borrow;
    r[k] = d;
    borrow = d < 0 ? 1 : 0;
  }
}

/** −1, 0 or 1 as `a` is below, equal to or above `b`, unsigned. */
export function compare(a: Limbs, b: Limbs): number {
  for (let k = a.length - 1; k >= 0; k--) {
    const x = a[k]!;
    const y = b[k]!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The 16-bit digit `i` of `a`. */
const digit = (a: Limbs, i: number): number => (a[i >>> 1]! >>> ((i & 1) << 4)) & 0xffff;

/**
 * r = a × b modulo 2^(32 × limbs), schoolbook on 16-bit digits so every partial product and sum
 * stays exact in a double. `acc` holds two digits a limb (twice `r`'s length). `r` may be `a` or
 * `b`.
 */
export function mul(r: Limbs, a: Limbs, b: Limbs, acc: Float64Array): void {
  const digits = r.length * 2;
  acc.fill(0);
  for (let i = 0; i < digits; i++) {
    const ai = digit(a, i);
    if (ai === 0) continue;
    for (let j = 0; j < digits - i; j++) acc[i + j]! += ai * digit(b, j);
  }
  let carry = 0;
  for (let t = 0; t < digits; t++) {
    const s = acc[t]! + carry;
    const d = s % 65536;
    carry = (s - d) / 65536;
    if (t & 1) r[t >>> 1] = (r[t >>> 1]! | (d << 16)) >>> 0;
    else r[t >>> 1] = d;
  }
}

/**
 * q = a ÷ b and r = a mod b, unsigned, over the low `width` bits of `a` (b ≠ 0), by restoring
 * division a bit at a time. The limbs must hold `width + 1` bits, so the partial remainder never
 * overflows. `q` and `r` are neither `a` nor `b`.
 */
export function divide(q: Limbs, r: Limbs, a: Limbs, b: Limbs, width: number): void {
  q.fill(0);
  r.fill(0);
  for (let i = width - 1; i >= 0; i--) {
    // r = 2r + bit i of a
    let carry = bitOf(a, i);
    for (let k = 0; k < r.length; k++) {
      const x = r[k]!;
      r[k] = ((x << 1) | carry) >>> 0;
      carry = x >>> 31;
    }
    if (compare(r, b) >= 0) {
      sub(r, r, b);
      q[i >>> 5] = (q[i >>> 5]! | (1 << (i & 31))) >>> 0;
    }
  }
}
