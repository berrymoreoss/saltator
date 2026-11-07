/**
 * Possible outcomes of a chip with unknown inputs, merged without allocating: an encoder or a
 * display decoder lists every output pattern its inputs allow, and drives the bits they all
 * agree on (`X` for the rest). A merged set is one number: `(agree << 8) | value`, patterns of up
 * to 8 bits.
 */
import { Level } from '../../core';

/** Merged outcomes. */
export type Outcomes = number;

/** No outcome yet. */
export const NO_OUTCOME: Outcomes = -1;

/** Adds the output pattern `bits` (1 = high) to `seen`; `all` has a bit for every output. */
export function merge(seen: Outcomes, bits: number, all: number): Outcomes {
  if (seen === NO_OUTCOME) return (all << 8) | bits;
  const value = seen & 0xff;
  return (((seen >> 8) & ~(value ^ bits) & all) << 8) | value;
}

/** Output `bit`: its level if every merged outcome agrees on it, else `X` (also with none). */
export function outcomeLevel(seen: Outcomes, bit: number): Level {
  if (seen === NO_OUTCOME || !((seen >> 8) & (1 << bit))) return Level.X;
  return seen & (1 << bit) ? Level.L1 : Level.L0;
}
