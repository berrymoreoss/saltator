/**
 * Pin-to-pin delays of a module's `specify` paths (HDL-2): each driving pin is driven with the
 * delay of its paths whose cause happened in this delta — the same rule as the chips with several
 * paths (`pathDelays` in `74xx/paths.ts`, docs/components.md#timing): among the paths whose source
 * pin changed (an edge-sensitive path: with its edge, also an uncertain one; a conditional path:
 * its condition not known 0 after the change), the longest; rise for a new 1, fall for a new 0, the
 * longer of the two for `X` and a release. When no path's cause happened (the forced evaluation,
 * a change through logic no path describes) the pin's longest path; a pin no path reaches takes the
 * part's one delay. Compiled once per module into typed arrays: no allocation per evaluation.
 */
import {
  type EvalContext,
  type HdlPath,
  type HdlPortBit,
  Level,
  type Time,
  toInput,
} from '../../core';
import type { Layout } from './layout';

/** What a driving pin drives, for its delay: 0, 1, `X` (2), released (3). */
export const DRIVE_Z = 3;

const ANY = 0;
const RISE = 1;
const FALL = 2;

/** The delays of a module's driving pins, by their `specify` paths. */
export interface ModulePathDelays {
  /** Per driving pin, whether a path reaches it (else it takes the part's delay). */
  readonly reached: Uint8Array;
  /**
   * The delay to drive driving pin `i` (in the program's `drivePins` order) with `level` (0, 1,
   * 2 = `X`, 3 = released) in this evaluation; `fallback` where no path reaches it. `v` and `u`
   * are the module's words after the settle (conditions are read after the change).
   */
  delay(
    ctx: EvalContext<unknown>,
    v: Int32Array,
    u: Int32Array,
    i: number,
    level: number,
    fallback: Time,
  ): Time;
}

/**
 * Whether `pin` made (or may have made) `edge` in this delta: from 0 or `X` to 1 or `X` for a rise,
 * never `X` to `X`. Observes the pin (`prev`, `level`), never reads it: a delay reports nothing.
 */
function madeEdge(ctx: EvalContext<unknown>, pin: number, rise: boolean): boolean {
  const before = toInput(ctx.prev(pin));
  const after = toInput(ctx.level(pin));
  if (before === after) return false;
  return rise
    ? before !== Level.L1 && after !== Level.L0
    : before !== Level.L0 && after !== Level.L1;
}

/**
 * Compiles `paths` for the driving pins whose port bits are `drivePortBits` (in `drivePins`
 * order); `sourcePins(bit)` gives the part's pins an input or inout bit enters by. Undefined
 * without paths: the part drives everything with its one delay.
 */
export function compilePathDelays(
  paths: readonly HdlPath[],
  layout: Layout,
  drivePortBits: readonly HdlPortBit[],
  sourcePins: (bit: number) => readonly number[],
): ModulePathDelays | undefined {
  if (paths.length === 0) return undefined;
  interface Entry {
    readonly pin: number;
    readonly edge: number;
    readonly when: HdlPortBit | undefined;
    readonly rise: Time;
    readonly fall: Time;
  }
  const drivesOf = new Map<number, number[]>();
  for (const [i, bit] of drivePortBits.entries()) {
    if (typeof bit !== 'number') continue;
    const list = drivesOf.get(bit) ?? [];
    list.push(i);
    drivesOf.set(bit, list);
  }
  const perPin: Entry[][] = drivePortBits.map(() => []);
  for (const path of paths) {
    const pairs: [number, number][] = path.full
      ? path.from.flatMap((f) => path.to.map((t): [number, number] => [f, t]))
      : path.from.map((f, k): [number, number] => [f, path.to[k]!]);
    const edge = path.edge === 'rise' ? RISE : path.edge === 'fall' ? FALL : ANY;
    for (const [from, to] of pairs) {
      for (const i of drivesOf.get(to) ?? []) {
        for (const pin of sourcePins(from)) {
          perPin[i]!.push({ pin, edge, when: path.when, rise: path.rise.typ, fall: path.fall.typ });
        }
      }
    }
  }

  const starts = new Int32Array(drivePortBits.length + 1);
  const entries = perPin.flat();
  perPin.forEach((list, i) => {
    starts[i + 1] = starts[i]! + list.length;
  });
  const pathPin = Int32Array.from(entries, (e) => e.pin);
  const pathEdge = Uint8Array.from(entries, (e) => e.edge);
  // A condition bit's word and position; −1: always (a constant `x` may hold: always too).
  const whenWord = Int32Array.from(entries, (e) =>
    typeof e.when === 'number' ? layout.word[e.when]! : -1,
  );
  const whenPos = Int32Array.from(entries, (e) =>
    typeof e.when === 'number' ? layout.pos[e.when]! : 0,
  );
  const rise = Float64Array.from(entries, (e) => e.rise);
  const fall = Float64Array.from(entries, (e) => e.fall);
  const longest = (of: (e: Entry) => Time) =>
    Float64Array.from(perPin, (list) => list.reduce((m, e) => Math.max(m, of(e)), 0));
  const longRise = longest((e) => e.rise);
  const longFall = longest((e) => e.fall);
  const reached = Uint8Array.from(perPin, (list) => (list.length > 0 ? 1 : 0));

  return {
    reached,
    delay(ctx, v, u, i, level, fallback) {
      const start = starts[i]!;
      const end = starts[i + 1]!;
      if (start === end) return fallback;
      let best = -1;
      for (let j = start; j < end; j++) {
        const pin = pathPin[j]!;
        if (!ctx.changed(pin)) continue;
        const edge = pathEdge[j]!;
        if (edge !== ANY && !madeEdge(ctx, pin, edge === RISE)) continue;
        const w = whenWord[j]!;
        if (w >= 0 && (((u[w]! | v[w]!) >>> whenPos[j]!) & 1) === 0) continue;
        const t = level === 1 ? rise[j]! : level === 0 ? fall[j]! : Math.max(rise[j]!, fall[j]!);
        if (t > best) best = t;
      }
      if (best >= 0) return best;
      return level === 1
        ? longRise[i]!
        : level === 0
          ? longFall[i]!
          : Math.max(longRise[i]!, longFall[i]!);
    },
  };
}
