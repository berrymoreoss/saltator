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
import {
  type CellStep,
  extend,
  fill,
  indices,
  merge,
  pick,
  planeIndex,
  put,
  putBool,
  signedOperands,
  TX,
  tri,
} from './planes';
import { compileWordStep } from './word-cells';

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

/** Compiles a combinational cell or a latch into its step. */
export function compileStep(cell: HdlCell, bitCount: number): CellStep {
  const word = compileWordStep(cell, bitCount);
  if (word) return word;
  const spec: HdlCellSpec = HDL_CELLS[cell.type];
  const zero = bitCount;
  const a = indices(cell, 'A', bitCount);
  const b = indices(cell, 'B', bitCount);
  const y = indices(cell, spec.output, bitCount);
  const width = y.length;

  switch (cell.type) {
    case '$not':
    case '$pos': {
      const ax = extend(a, width, zero, signedOperands(cell, 1));
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
      const signed = signedOperands(cell, 2);
      const ax = extend(a, width, zero, signed);
      const bx = extend(b, width, zero, signed);
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
