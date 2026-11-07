/**
 * Trigger conditions on recorded channels (R13): a logic analyzer's "pattern and one edge",
 * evaluated at the end of each instant, so a zero-delay glitch never fires one. R14's
 * breakpoints reuse them. Spec: docs/simulation.md#triggers.
 */
import { Level } from './logic';
import type { Recorder } from './recorder';
import type { Simulator } from './simulator';
import type { Time } from './time';

/**
 * One term of a condition, on recorder channels:
 * - `rise` / `fall` / `edge`: the channel went from exactly 0 to exactly 1 (or back, or either)
 *   at this instant — strict, like `ctx.rose`: `X → 1` is no rising edge;
 * - `level`: the channel is at `level` (`0`, `1`, `X` or `Z`);
 * - `equal` / `notEqual`: the channels (bit 0 first: a bus or a group) read `value`, hex digits
 *   with `X` for a don't-care digit (`3F`, `X5`); every bit it cares about exactly 0 or 1 as
 *   written. `notEqual` is its negation.
 */
export type TriggerTerm =
  | { readonly kind: 'rise' | 'fall' | 'edge'; readonly channel: number }
  | { readonly kind: 'level'; readonly channel: number; readonly level: Level }
  | {
      readonly kind: 'equal' | 'notEqual';
      readonly channels: readonly number[];
      readonly value: string;
    };

/** All terms must hold (AND); at most one edge term. */
export type TriggerCondition = readonly TriggerTerm[];

const isEdge = (term: TriggerTerm) =>
  term.kind === 'rise' || term.kind === 'fall' || term.kind === 'edge';

/**
 * A hex pattern for `width` bits, bit 0 first: −1 where the bit doesn't matter, else 0 or 1;
 * digits not written are 0, as in a number (`5` on eight bits is `0x05`, `X5` leaves the high
 * nibble free). An error message instead when the text isn't hex digits and `X`s, or sets a bit
 * above `width`.
 */
export function parseHexPattern(text: string, width: number): Int8Array | string {
  const digits = text.trim().replace(/^0x/i, '').replace(/_/g, '');
  if (!/^[0-9a-fx]+$/i.test(digits)) return `"${text}" is not a hex value (digits, X for any)`;
  const bits = new Int8Array(width).fill(0);
  for (let d = 0; d < digits.length; d++) {
    const digit = digits[digits.length - 1 - d]!;
    const care = !/x/i.test(digit);
    const value = care ? Number.parseInt(digit, 16) : 0;
    for (let b = 0; b < 4; b++) {
      const bit = d * 4 + b;
      const one = (value >> b) & 1;
      if (bit < width) bits[bit] = care ? one : -1;
      else if (care && one) return `${text} doesn't fit in ${width} bit${width === 1 ? '' : 's'}`;
    }
  }
  return bits;
}

/** Problems with a condition (empty when it can be armed). */
export function conditionProblems(condition: TriggerCondition): string[] {
  const problems: string[] = [];
  if (condition.length === 0) problems.push('the trigger has no condition');
  if (condition.filter(isEdge).length > 1) problems.push('only one term may be an edge');
  for (const term of condition) {
    if (term.kind !== 'equal' && term.kind !== 'notEqual') continue;
    if (term.channels.length === 0) problems.push('a value term needs at least one signal');
    else {
      const pattern = parseHexPattern(term.value, term.channels.length);
      if (typeof pattern === 'string') problems.push(pattern);
    }
  }
  return problems;
}

interface Compiled {
  readonly term: TriggerTerm;
  readonly channels: readonly number[];
  readonly pattern?: Int8Array;
}

/**
 * A single-shot trigger: armed on a simulator, it watches the end of every instant in which one
 * of its channels changed, and fires once — at the edge while the other terms hold, or, without
 * an edge term, when the pattern becomes true (a pattern already true when armed waits until it
 * has been false). Its channels are read from the recorder, so a carry-over only needs `attach`
 * of the new simulator.
 */
export class Trigger {
  readonly condition: TriggerCondition;
  /** The instant it fired; undefined while armed or idle. */
  fired: Time | undefined;
  readonly #recorder: Recorder;
  readonly #terms: readonly Compiled[];
  readonly #edge: Compiled | undefined;
  readonly #channels: readonly number[];
  readonly #onFire: (time: Time) => void;
  #off: (() => void) | undefined;
  #wasTrue = false;

  /** Throws with the problems when the condition can't be armed (`conditionProblems`). */
  constructor(recorder: Recorder, condition: TriggerCondition, onFire: (time: Time) => void) {
    const problems = conditionProblems(condition);
    if (problems.length > 0) throw new Error(problems.join('; '));
    this.condition = condition;
    this.#recorder = recorder;
    this.#onFire = onFire;
    const terms = condition.map((term): Compiled => {
      if ('channels' in term) {
        const pattern = parseHexPattern(term.value, term.channels.length) as Int8Array;
        return { term, channels: term.channels, pattern };
      }
      return { term, channels: [term.channel] };
    });
    this.#edge = terms.find((c) => isEdge(c.term));
    this.#terms = terms.filter((c) => c !== this.#edge);
    this.#channels = [...new Set(terms.flatMap((c) => c.channels))];
  }

  /** Watching a simulator. */
  get armed(): boolean {
    return this.#off !== undefined;
  }

  /** Starts watching `sim` (from its current instant); also after a carry-over. */
  attach(sim: Simulator): void {
    if (this.fired !== undefined) return;
    const first = this.#off === undefined;
    this.#off?.();
    if (first) this.#wasTrue = this.#pattern(sim.now);
    this.#off = sim.onInstant((now) => this.#instant(now));
  }

  /** Stops watching. */
  disarm(): void {
    this.#off?.();
    this.#off = undefined;
  }

  #instant(now: Time): void {
    const recorder = this.#recorder;
    let changed = false;
    for (const channel of this.#channels) {
      if (recorder.lastChange(channel) === now) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    const pattern = this.#pattern(now);
    let fire: boolean;
    if (this.#edge) {
      fire = pattern && this.#edgeAt(this.#edge.term, this.#edge.channels[0]!, now);
    } else {
      fire = pattern && !this.#wasTrue;
      this.#wasTrue = pattern;
    }
    if (!fire) return;
    this.fired = now;
    this.disarm();
    this.#onFire(now);
  }

  #edgeAt(term: TriggerTerm, channel: number, now: Time): boolean {
    const recorder = this.#recorder;
    const before = recorder.level(channel, now - 1);
    const after = recorder.level(channel, now);
    const rose = before === Level.L0 && after === Level.L1;
    const fell = before === Level.L1 && after === Level.L0;
    return term.kind === 'rise' ? rose : term.kind === 'fall' ? fell : rose || fell;
  }

  /** Every non-edge term holds at `now`. */
  #pattern(now: Time): boolean {
    for (const { term, channels, pattern } of this.#terms) {
      if (!this.#holds(term, channels, pattern, now)) return false;
    }
    return true;
  }

  #holds(
    term: TriggerTerm,
    channels: readonly number[],
    pattern: Int8Array | undefined,
    now: Time,
  ): boolean {
    const recorder = this.#recorder;
    if (term.kind === 'level') return recorder.level(term.channel, now) === term.level;
    if (!pattern) return false;
    let equal = true;
    for (let bit = 0; bit < channels.length && equal; bit++) {
      const want = pattern[bit]!;
      if (want < 0) continue;
      equal = recorder.level(channels[bit]!, now) === (want === 1 ? Level.L1 : Level.L0);
    }
    return term.kind === 'equal' ? equal : !equal;
  }
}
