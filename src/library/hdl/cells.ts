/**
 * The cells of a module, compiled once per definition into steps over an instance's bit planes
 * (HDL-1): a byte per bit for its value and one for "unknown", the constants 0, 1 and x after the
 * signal bits. Combinational cells and latches are steps run in topological order; flip-flops
 * are loaded on their clock's edges in two phases (every next state from the values before the
 * edge, then all of them at once). `X` is pessimistic where it must be and no more: bitwise
 * cells per bit, comparisons by the ranges unknown bits allow, arithmetic unknown from the
 * lowest unknown bit up, multiplexers merging the inputs a select could pick.
 * Spec: docs/components.md#verilog-modules-hdl.
 */
import { HDL_CELLS, type HdlBit, type HdlCell, type HdlCellSpec } from '../../core';

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

function put(val: Uint8Array, unk: Uint8Array, b: number, t: number): void {
  unk[b] = t === TX ? 1 : 0;
  val[b] = t === 1 ? 1 : 0;
}

/** One of two outcomes: the value if they agree, else `X`. */
export const merge = (a: number, b: number) => (a === b ? a : TX);

/** What a control at `c` picks: `yes` when 1, `no` when 0, both merged when unknown. */
export const pick = (c: number, yes: number, no: number) =>
  c === 1 ? yes : c === 0 ? no : merge(yes, no);

// A word read from the planes: its value (unknown bits 0) and its unknown bits. Module-level
// registers, so reading a word allocates nothing; valid until the next `gather`.
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

/** Every bit `X`, or every bit the constant 0. */
function fill(val: Uint8Array, unk: Uint8Array, idx: Int32Array, t: number): void {
  for (let i = 0; i < idx.length; i++) put(val, unk, idx[i]!, t);
}

/** Bits 0…width−1 set. */
const maskOf = (width: number) => (width >= 32 ? 0xffffffff : 2 ** width - 1);

/** A word's bits as plane indices, zero-extended (the constant 0) or cut to `width`. */
function extend(idx: Int32Array, width: number, zero: number): Int32Array {
  const out = new Int32Array(width).fill(zero);
  out.set(idx.subarray(0, Math.min(width, idx.length)));
  return out;
}

/** Whether any of the bits is 1 (1), none can be (0), or it depends on unknown ones (`X`). */
function anyOne(val: Uint8Array, unk: Uint8Array, idx: Int32Array): number {
  let unknown = false;
  for (let i = 0; i < idx.length; i++) {
    const b = idx[i]!;
    if (unk[b]) unknown = true;
    else if (val[b]) return 1;
  }
  return unknown ? TX : 0;
}

/** Whether all of the bits are 1 (1), one is surely 0 (0), or it depends (`X`). */
function allOne(val: Uint8Array, unk: Uint8Array, idx: Int32Array): number {
  let unknown = false;
  for (let i = 0; i < idx.length; i++) {
    const b = idx[i]!;
    if (unk[b]) unknown = true;
    else if (!val[b]) return 0;
  }
  return unknown ? TX : 1;
}

const not3 = (t: number) => (t === TX ? TX : 1 - t);
const and3 = (a: number, b: number) => (a === 0 || b === 0 ? 0 : a === TX || b === TX ? TX : 1);
const or3 = (a: number, b: number) => (a === 1 || b === 1 ? 1 : a === TX || b === TX ? TX : 0);
const xor3 = (a: number, b: number) => (a === TX || b === TX ? TX : a ^ b);

/** Writes a one-bit result into bit 0 of Y and zeros above it. */
function putBool(val: Uint8Array, unk: Uint8Array, y: Int32Array, t: number): void {
  put(val, unk, y[0]!, t);
  for (let i = 1; i < y.length; i++) put(val, unk, y[i]!, 0);
}

/** The cell's port bits as plane indices. */
function indices(cell: HdlCell, port: string, bitCount: number): Int32Array {
  return Int32Array.from(cell.ports[port] ?? [], (bit) => planeIndex(bit, bitCount));
}

/** Compiles a combinational cell or a latch into its step. */
export function compileStep(cell: HdlCell, bitCount: number): CellStep {
  const spec: HdlCellSpec = HDL_CELLS[cell.type];
  const zero = bitCount;
  const a = indices(cell, 'A', bitCount);
  const b = indices(cell, 'B', bitCount);
  const y = indices(cell, spec.output, bitCount);
  const width = y.length;
  const mask = maskOf(width);

  switch (cell.type) {
    case '$not':
    case '$pos': {
      const ax = extend(a, width, zero);
      const invert = cell.type === '$not';
      return (val, unk) => {
        for (let i = 0; i < width; i++) {
          const t = tri(val, unk, ax[i]!);
          put(val, unk, y[i]!, invert ? not3(t) : t);
        }
      };
    }
    case '$and':
    case '$or':
    case '$xor':
    case '$xnor': {
      const ax = extend(a, width, zero);
      const bx = extend(b, width, zero);
      const op =
        cell.type === '$and'
          ? and3
          : cell.type === '$or'
            ? or3
            : cell.type === '$xor'
              ? xor3
              : (p: number, q: number) => not3(xor3(p, q));
      return (val, unk) => {
        for (let i = 0; i < width; i++) {
          put(val, unk, y[i]!, op(tri(val, unk, ax[i]!), tri(val, unk, bx[i]!)));
        }
      };
    }
    case '$reduce_and':
      return (val, unk) => putBool(val, unk, y, allOne(val, unk, a));
    case '$reduce_or':
    case '$reduce_bool':
      return (val, unk) => putBool(val, unk, y, anyOne(val, unk, a));
    case '$logic_not':
      return (val, unk) => putBool(val, unk, y, not3(anyOne(val, unk, a)));
    case '$reduce_xor':
    case '$reduce_xnor': {
      const invert = cell.type === '$reduce_xnor' ? 1 : 0;
      return (val, unk) => {
        let parity = invert;
        for (let i = 0; i < a.length; i++) {
          const t = tri(val, unk, a[i]!);
          if (t === TX) {
            putBool(val, unk, y, TX);
            return;
          }
          parity ^= t;
        }
        putBool(val, unk, y, parity);
      };
    }
    case '$logic_and':
      return (val, unk) => putBool(val, unk, y, and3(anyOne(val, unk, a), anyOne(val, unk, b)));
    case '$logic_or':
      return (val, unk) => putBool(val, unk, y, or3(anyOne(val, unk, a), anyOne(val, unk, b)));
    case '$add':
    case '$sub':
    case '$neg': {
      const op = cell.type;
      return (val, unk) => {
        gather(val, unk, a);
        const av = wv;
        const au = wu;
        let bv = 0;
        let bu = 0;
        if (op !== '$neg') {
          gather(val, unk, b);
          bv = wv;
          bu = wu;
        }
        const r = (op === '$add' ? av + bv : op === '$sub' ? av - bv : -av) >>> 0;
        // A sum's bit depends on the bits at and below it: unknown from the lowest unknown bit up.
        const u = ((au | bu) & mask) >>> 0;
        const x = u === 0 ? 0 : (mask & ~((u & -u) - 1)) >>> 0;
        scatter(val, unk, y, r & mask, x);
      };
    }
    case '$eq':
    case '$ne': {
      const equal = cell.type === '$eq' ? 1 : 0;
      return (val, unk) => {
        gather(val, unk, a);
        const av = wv;
        const au = wu;
        gather(val, unk, b);
        const known = ~(au | wu);
        const t = ((av ^ wv) & known) !== 0 ? 1 - equal : (au | wu) !== 0 ? TX : equal;
        putBool(val, unk, y, t);
      };
    }
    case '$lt':
    case '$le':
    case '$gt':
    case '$ge': {
      const op = cell.type;
      return (val, unk) => {
        gather(val, unk, a);
        const aMin = wv;
        const aMax = (wv | wu) >>> 0;
        gather(val, unk, b);
        const bMin = wv;
        const bMax = (wv | wu) >>> 0;
        // Sure when every value the unknown bits allow gives the same answer.
        let t: number;
        if (op === '$lt') t = aMax < bMin ? 1 : aMin >= bMax ? 0 : TX;
        else if (op === '$le') t = aMax <= bMin ? 1 : aMin > bMax ? 0 : TX;
        else if (op === '$gt') t = aMin > bMax ? 1 : aMax <= bMin ? 0 : TX;
        else t = aMin >= bMax ? 1 : aMax < bMin ? 0 : TX;
        putBool(val, unk, y, t);
      };
    }
    case '$shl':
    case '$sshl':
    case '$shr':
    case '$sshr':
    case '$shift':
    case '$shiftx': {
      const left = cell.type === '$shl' || cell.type === '$sshl';
      const fillX = cell.type === '$shiftx';
      const signed = cell.params.B_SIGNED === 1 && b.length > 0;
      const bWidth = b.length;
      return (val, unk) => {
        gather(val, unk, b);
        if (wu !== 0) {
          fill(val, unk, y, TX);
          return;
        }
        let amount = wv;
        if (signed && (amount >>> (bWidth - 1)) & 1) amount -= 2 ** bWidth;
        for (let i = 0; i < width; i++) {
          const from = left ? i - amount : i + amount;
          if (from >= 0 && from < a.length) {
            const src = a[from]!;
            unk[y[i]!] = unk[src]!;
            val[y[i]!] = val[src]!;
          } else put(val, unk, y[i]!, fillX ? TX : 0);
        }
      };
    }
    case '$mux': {
      const s = indices(cell, 'S', bitCount)[0]!;
      return (val, unk) => {
        const sel = tri(val, unk, s);
        for (let i = 0; i < width; i++) {
          const pa = tri(val, unk, a[i]!);
          const pb = tri(val, unk, b[i]!);
          put(val, unk, y[i]!, sel === 0 ? pa : sel === 1 ? pb : merge(pa, pb));
        }
      };
    }
    case '$pmux': {
      const s = indices(cell, 'S', bitCount);
      return (val, unk) => {
        // The cases a select could pick: none (A), one (its slice of B), or several at once (X).
        let candidates = 0;
        let chosen = -1;
        let sure = false;
        for (let k = 0; k < s.length; k++) {
          const t = tri(val, unk, s[k]!);
          if (t === 0) continue;
          candidates++;
          chosen = k;
          sure = t === 1;
        }
        if (candidates > 1) {
          fill(val, unk, y, TX);
          return;
        }
        for (let i = 0; i < width; i++) {
          const pa = tri(val, unk, a[i]!);
          if (candidates === 0) put(val, unk, y[i]!, pa);
          else {
            const pb = tri(val, unk, b[chosen * width + i]!);
            put(val, unk, y[i]!, sure ? pb : merge(pa, pb));
          }
        }
      };
    }
    case '$dlatch':
    case '$adlatch': {
      const en = indices(cell, 'EN', bitCount)[0]!;
      const d = indices(cell, 'D', bitCount);
      const enPolarity = cell.params.EN_POLARITY as number;
      const reset = cell.type === '$adlatch';
      const arst = reset ? indices(cell, 'ARST', bitCount)[0]! : 0;
      const arstPolarity = reset ? (cell.params.ARST_POLARITY as number) : 0;
      const value = reset
        ? Int32Array.from(cell.params.ARST_VALUE as HdlBit[], (bit) => planeIndex(bit, bitCount))
        : new Int32Array(0);
      return (val, unk) => {
        const e = active(tri(val, unk, en), enPolarity);
        const r = reset ? active(tri(val, unk, arst), arstPolarity) : 0;
        for (let i = 0; i < width; i++) {
          const t = pick(e, tri(val, unk, d[i]!), tri(val, unk, y[i]!));
          put(val, unk, y[i]!, r === 0 ? t : pick(r, tri(val, unk, value[i]!), t));
        }
      };
    }
    case '$tribuf': {
      // Inside the module a released net reads X; the pin it drives is the part's business.
      const en = indices(cell, 'EN', bitCount)[0]!;
      return (val, unk) => {
        const e = tri(val, unk, en);
        for (let i = 0; i < width; i++) put(val, unk, y[i]!, e === 1 ? tri(val, unk, a[i]!) : TX);
      };
    }
    default:
      throw new Error(`${cell.type} is not a combinational cell`);
  }
}

/** Whether a control at level `t` is active for `polarity` (1: HIGH): 1, 0, or `X`. */
export const active = (t: number, polarity: number) => (t === TX ? TX : t === polarity ? 1 : 0);

/** A flip-flop, compiled. */
export interface FlipFlop {
  readonly type: HdlCell['type'];
  /** The plane index of its clock: an input bit or a constant. */
  readonly clk: number;
  readonly rising: boolean;
  readonly d: Int32Array;
  readonly q: Int32Array;
  /** Plane indices of EN, SRST, ARST; −1 where it has none. */
  readonly en: number;
  readonly enPolarity: number;
  readonly srst: number;
  readonly srstPolarity: number;
  readonly srstValue: Int32Array;
  readonly arst: number;
  readonly arstPolarity: number;
  readonly arstValue: Int32Array;
  /** Where its next state sits in the instance's `next` array. */
  readonly offset: number;
}

export function compileFlipFlop(cell: HdlCell, bitCount: number, offset: number): FlipFlop {
  const one = (port: string) =>
    cell.ports[port] ? planeIndex(cell.ports[port][0]!, bitCount) : -1;
  const values = (name: string) =>
    Int32Array.from((cell.params[name] as HdlBit[] | undefined) ?? [], (bit) =>
      planeIndex(bit, bitCount),
    );
  const polarity = (name: string) => (cell.params[name] as number | undefined) ?? 1;
  return {
    type: cell.type,
    clk: one('CLK'),
    rising: polarity('CLK_POLARITY') === 1,
    d: indices(cell, 'D', bitCount),
    q: indices(cell, 'Q', bitCount),
    en: one('EN'),
    enPolarity: polarity('EN_POLARITY'),
    srst: one('SRST'),
    srstPolarity: polarity('SRST_POLARITY'),
    srstValue: values('SRST_VALUE'),
    arst: one('ARST'),
    arstPolarity: polarity('ARST_POLARITY'),
    arstValue: values('ARST_VALUE'),
    offset,
  };
}

/**
 * The state a clock edge loads into a flip-flop, from the planes as they are (before the edge),
 * into `next` (one value a bit: 0, 1, `X`). An uncertain edge merges it with the stored state, so
 * only the bits a load would change become `X`.
 */
export function nextState(
  ff: FlipFlop,
  uncertain: boolean,
  val: Uint8Array,
  unk: Uint8Array,
  next: Uint8Array,
): void {
  const en = ff.en < 0 ? 1 : active(tri(val, unk, ff.en), ff.enPolarity);
  const srst = ff.srst < 0 ? 0 : active(tri(val, unk, ff.srst), ff.srstPolarity);
  // $sdffce resets only while enabled; $sdffe's reset (and $sdff's) wins over the enable.
  const resetInside = ff.type === '$sdffce';
  for (let i = 0; i < ff.q.length; i++) {
    const q = tri(val, unk, ff.q[i]!);
    const d = tri(val, unk, ff.d[i]!);
    const r = srst === 0 ? 0 : tri(val, unk, ff.srstValue[i]!);
    const t = resetInside ? pick(en, pick(srst, r, d), q) : pick(srst, r, pick(en, d, q));
    next[ff.offset + i] = uncertain ? merge(q, t) : t;
  }
}

/** Stores a flip-flop's next state (`nextState`) in the planes. */
export function load(ff: FlipFlop, val: Uint8Array, unk: Uint8Array, next: Uint8Array): void {
  for (let i = 0; i < ff.q.length; i++) put(val, unk, ff.q[i]!, next[ff.offset + i]!);
}

/** An asynchronous reset, level-sensitive: the reset value while active, merged while unknown. */
export function asyncReset(ff: FlipFlop, val: Uint8Array, unk: Uint8Array): void {
  if (ff.arst < 0) return;
  const r = active(tri(val, unk, ff.arst), ff.arstPolarity);
  if (r === 0) return;
  for (let i = 0; i < ff.q.length; i++) {
    put(val, unk, ff.q[i]!, pick(r, tri(val, unk, ff.arstValue[i]!), tri(val, unk, ff.q[i]!)));
  }
}
