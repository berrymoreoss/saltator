/**
 * Helpers for edge-triggered chips (flip-flops, registers, R09b's counters and shift registers):
 * strict and uncertain clock edges, merging the outcomes unknown inputs allow, and unit pin
 * templates. The timing checks themselves are `TimingChecks` in core. Spec:
 * docs/components.md#edge-triggered-chips.
 */
import { type Edge, type EvalContext, Level, type PinRef, toInput } from '../../core';

/** What a clock did in this delta. */
export const ClockEdge = {
  /** No transition that could be the active one. */
  NONE: 0,
  /** The active transition, strictly (0 → 1 for a rising edge). */
  ACTIVE: 1,
  /** A transition through `X`/`Z` that might have been the active one (0 → X, X → 1, X → Z). */
  UNCERTAIN: 2,
} as const;
export type ClockEdge = (typeof ClockEdge)[keyof typeof ClockEdge];

/**
 * The clock's edge in this delta. Reads the clock every time, so a floating clock is reported
 * even if it never changes.
 */
export function clockEdge(ctx: EvalContext<unknown>, pin: PinRef, edge: Edge): ClockEdge {
  const now = toInput(ctx.read(pin));
  if (!ctx.changed(pin)) return ClockEdge.NONE;
  const was = toInput(ctx.prev(pin));
  const from = edge === 'rise' ? Level.L0 : Level.L1;
  const to = edge === 'rise' ? Level.L1 : Level.L0;
  if (was === from && now === to) return ClockEdge.ACTIVE;
  return couldBe(was, from) && couldBe(now, to) ? ClockEdge.UNCERTAIN : ClockEdge.NONE;
}

/** The two known levels, for looping over the values an unknown input could have. */
export const BITS = [Level.L0, Level.L1] as const;

/** Whether an input level (`Z` read as `X`) could be `value`. */
export function couldBe(level: Level, value: Level): boolean {
  return level === value || level === Level.X || level === Level.Z;
}

/** One of two possible outcomes: the level if they agree, else `X`. */
export function either(a: Level, b: Level): Level {
  return a === b ? a : Level.X;
}

/** The complement of a stored or driven level (`X` stays `X`). */
export function complement(level: Level): Level {
  return level === Level.L0 ? Level.L1 : level === Level.L1 ? Level.L0 : Level.X;
}

/**
 * The next state of a JK flip-flop: hold (L L), reset (L H), set (H L), toggle (H H). Unknown
 * inputs merge every outcome they allow.
 */
export function jkNext(q: Level, j: Level, k: Level): Level {
  let next: Level | -1 = -1;
  for (const jv of BITS) {
    if (!couldBe(j, jv)) continue;
    for (const kv of BITS) {
      if (!couldBe(k, kv)) continue;
      const v =
        jv === Level.L1
          ? kv === Level.L1
            ? complement(q)
            : Level.L1
          : kv === Level.L1
            ? Level.L0
            : q;
      next = next === -1 ? v : either(next, v);
    }
  }
  return next as Level;
}

/** A unit's pin name or path from a template: `n` before a capital becomes the unit number. */
export function forUnit(template: string, unit: number): string {
  return template.replace(/\bn(?=[A-Z])/g, String(unit));
}
