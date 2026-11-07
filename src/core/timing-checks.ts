/**
 * Timing checks for edge-triggered parts: setup, hold, pulse width and recovery against the data
 * sheet's guaranteed minima (`TimingDef.min`). A part declares its checks once, from its pin list
 * and minima; each instance keeps the times of its watched pins' last changes and edges in its
 * state (`createTimes()`). Its `evaluate` runs the checks, then `track`. A check that fails
 * reports a diagnostic and tells the part what failed, so the part can make the bits it may have
 * loaded unknown. Spec: docs/simulation.md#timing-checks.
 */
import { type EvalContext, type PinDef, type PinRef, pinIndex } from './component';
import { Level } from './logic';
import { formatTime, type Time } from './time';

/** Diagnostic kinds the timing checks report. */
export const TimingViolation = {
  SETUP: 'setup-violation',
  HOLD: 'hold-violation',
  PULSE_WIDTH: 'pulse-width-violation',
  RECOVERY: 'recovery-violation',
} as const;
export type TimingViolationKind = (typeof TimingViolation)[keyof typeof TimingViolation];

/** True for the diagnostic kinds of `TimingViolation`. */
export function isTimingViolation(kind: string): kind is TimingViolationKind {
  return (Object.values(TimingViolation) as string[]).includes(kind);
}

/**
 * Short circuits, oscillations and timing violations break the circuit (a violated set-up time
 * is an intermittent failure on a real board); the rest are warnings.
 */
export function diagnosticSeverity(diagnostic: { readonly kind: string }): 'error' | 'warning' {
  const { kind } = diagnostic;
  return kind === 'contention' || kind === 'oscillation' || isTimingViolation(kind)
    ? 'error'
    : 'warning';
}

/** The clock transition a part acts on. */
export type Edge = 'rise' | 'fall';

/**
 * Per pin (by `PinRef`): the time of its last change, and of the last time it left LOW and left
 * HIGH, as three consecutive entries; `-Infinity` until it happens. Plain data in the instance's
 * state: absolute simulation times, so a carry-over keeps them. Recorded from `ctx.prev` only: a
 * check observes a pin, it doesn't read it (reading a floating net would report it as used).
 */
export type PinTimes = Float64Array;

const CHANGED = 0;
const LEFT_LOW = 1;
const LEFT_HIGH = 2;

/** Setup and hold of data (or enable) inputs against a clock edge. */
export interface SetupHoldSpec {
  /** Comma-separated input pin names (at most 31). */
  readonly data: string;
  readonly clock: string;
  readonly edge: Edge;
  /**
   * Key of the setup time in the minima: `tsu(nD to nCP)`; omitted when the data sheet gives
   * only a hold time (the 74HC193's other clock must stay HIGH after the counting edge).
   */
  readonly setup?: string;
  /** Key of the hold time; omitted when the data sheet gives none. */
  readonly hold?: string;
  /**
   * Only this transition of a data pin counts as its change: an edge-to-edge requirement, such
   * as the 74HC595's `tsu(SHCP to STCP)` from SHCP rising to STCP rising. Default: any change.
   */
  readonly dataEdge?: Edge;
  /**
   * A data change at the same instant as the clock edge is no violation: a documented mode,
   * such as the 595's two clocks tied together (the storage register then takes the shift
   * register's contents from before the shift).
   */
  readonly sameInstantAllowed?: boolean;
}

/** The shortest HIGH and/or LOW phase of a pin: a clock, or an asynchronous set/reset pulse. */
export interface PulseWidthSpec {
  readonly pin: string;
  readonly level: 'high' | 'low' | 'both';
  /** Key of the pulse width in the minima: `tW(nCP)`. */
  readonly width: string;
}

/** The time between releasing an asynchronous set/reset and the next active clock edge. */
export interface RecoverySpec {
  readonly pin: string;
  /** The level at which `pin` is active (sets or resets). */
  readonly active: 'high' | 'low';
  readonly clock: string;
  readonly edge: Edge;
  /** Key of the recovery time in the minima: `trec(MR to CP)`. */
  readonly recovery: string;
}

/** A declared setup/hold check. */
export interface SetupHoldCheck {
  /**
   * At the active edge of the clock (in this delta): the data inputs that changed (or made their
   * `dataEdge`) less than the setup time before it, at the same instant included unless
   * `sameInstantAllowed`; bit `n` is the `n`th data pin. Reports each one. 0 when the clock had
   * no active edge, when not `armed` (the part ignores the edge: held in reset, loading
   * disabled), or without a setup time.
   */
  setup(ctx: EvalContext<unknown>, times: PinTimes, armed?: boolean): number;
  /**
   * The data inputs that changed (or made their `dataEdge`) in this delta less than the hold
   * time after the last active edge; bit `n` is the `n`th data pin. An edge in this delta isn't recorded yet (`track` runs
   * last): data changing with it is the setup check's business. 0 when not `armed`.
   */
  hold(ctx: EvalContext<unknown>, times: PinTimes, armed?: boolean): number;
}

/** A declared pulse-width check. */
export interface PulseWidthCheck {
  /**
   * True (and reported) when the pin just ended a checked phase shorter than the minimum; false
   * when not `armed` (a clock the part ignores now).
   */
  check(ctx: EvalContext<unknown>, times: PinTimes, armed?: boolean): boolean;
}

/** A declared recovery check. */
export interface RecoveryCheck {
  /**
   * True (and reported) when the clock's active edge (in this delta) came less than the recovery
   * time after `pin` was released, at the same instant included.
   */
  check(ctx: EvalContext<unknown>, times: PinTimes): boolean;
}

/**
 * The timing checks of one part definition. Declared in the definition's closure (immutable once
 * declared); the per-instance times live in the instance state:
 *
 * ```ts
 * const checks = new TimingChecks(pinList, timing.min);
 * const data = checks.setupHold({ data: 'D', clock: 'CP', edge: 'rise',
 *   setup: 'tsu(D to CP)', hold: 'th(D to CP)' });
 * // evaluate: const late = data.setup(ctx, times); …; checks.track(ctx, times);
 * ```
 *
 * Throws at definition time on unknown pins or a missing minimum.
 */
export class TimingChecks {
  readonly #pins: readonly PinDef[];
  readonly #min: Readonly<Record<string, Time>>;
  #watched = new Int32Array(0);

  constructor(pins: readonly PinDef[], min: Readonly<Record<string, Time>> = {}) {
    this.#pins = pins;
    this.#min = min;
  }

  /** Times for a new instance: nothing has changed yet. */
  createTimes(): PinTimes {
    return new Float64Array(this.#pins.length * 3).fill(-Infinity);
  }

  /**
   * Records the changes and edges of every watched pin in this delta. Call it in every `evaluate`,
   * after the checks (they compare against the times before this delta).
   */
  track(ctx: EvalContext<unknown>, times: PinTimes): void {
    const watched = this.#watched;
    const now = ctx.now;
    for (let i = 0; i < watched.length; i++) {
      const pin = watched[i]!;
      if (!ctx.changed(pin)) continue;
      times[pin * 3 + CHANGED] = now;
      const was = ctx.prev(pin);
      if (was === Level.L0) times[pin * 3 + LEFT_LOW] = now;
      else if (was === Level.L1) times[pin * 3 + LEFT_HIGH] = now;
    }
  }

  setupHold(spec: SetupHoldSpec): SetupHoldCheck {
    const data = Int32Array.from(names(spec.data), (name) => this.#pin(name));
    if (data.length > 31) throw new Error(`setup check on ${data.length} pins (at most 31)`);
    if (spec.setup === undefined && spec.hold === undefined) {
      throw new Error(`setup/hold check on ${spec.data} without a setup or hold time`);
    }
    const clock = this.#pin(spec.clock);
    const tsu = spec.setup === undefined ? 0 : this.#limit(spec.setup);
    const th = spec.hold === undefined ? 0 : this.#limit(spec.hold);
    // The last active edge: when the clock last left the level before it.
    const edgeSlot = spec.edge === 'rise' ? LEFT_LOW : LEFT_HIGH;
    const verb = edgeVerb(spec.edge);
    // A data pin's change: any change, or (edge to edge) leaving the level before its edge.
    const dataEdge = spec.dataEdge;
    const dataSlot = dataEdge === undefined ? CHANGED : dataEdge === 'rise' ? LEFT_LOW : LEFT_HIGH;
    const dataFrom = dataEdge === 'fall' ? Level.L1 : Level.L0;
    const changes = dataEdge === undefined ? 'changed' : edgeVerb(dataEdge);
    const sameInstantAllowed = spec.sameInstantAllowed === true;
    const pins = this.#pins;
    const clockName = pins[clock]!.name;
    const active = (ctx: EvalContext<unknown>) =>
      spec.edge === 'rise' ? ctx.rose(clock) : ctx.fell(clock);
    const changedNow = (ctx: EvalContext<unknown>, pin: PinRef) =>
      ctx.changed(pin) && (dataEdge === undefined || ctx.prev(pin) === dataFrom);

    return {
      setup(ctx, times, armed = true) {
        if (tsu === 0 || !armed || !active(ctx)) return 0;
        let late = 0;
        for (let n = 0; n < data.length; n++) {
          const pin = data[n]!;
          const elapsed = changedNow(ctx, pin) ? 0 : ctx.now - times[pin * 3 + dataSlot]!;
          if (elapsed >= tsu || (elapsed === 0 && sameInstantAllowed)) continue;
          late |= 1 << n;
          const when = elapsed === 0 ? 'at the same time as' : `${formatTime(elapsed)} before`;
          ctx.report({
            kind: TimingViolation.SETUP,
            message: `${pins[pin]!.name} ${changes} ${when} ${clockName} ${verb} (setup time ≥ ${formatTime(tsu)})`,
            pin,
          });
        }
        return late;
      },
      hold(ctx, times, armed = true) {
        if (!armed || th === 0) return 0;
        const elapsed = ctx.now - times[clock * 3 + edgeSlot]!;
        if (elapsed >= th || (elapsed === 0 && sameInstantAllowed)) return 0;
        let early = 0;
        for (let n = 0; n < data.length; n++) {
          const pin = data[n]!;
          if (!changedNow(ctx, pin)) continue;
          early |= 1 << n;
          const when = elapsed === 0 ? 'at the same time as' : `${formatTime(elapsed)} after`;
          ctx.report({
            kind: TimingViolation.HOLD,
            message: `${pins[pin]!.name} ${changes} ${when} ${clockName} ${verb} (hold time ≥ ${formatTime(th)})`,
            pin,
          });
        }
        return early;
      },
    };
  }

  pulseWidth(spec: PulseWidthSpec): PulseWidthCheck {
    const pin = this.#pin(spec.pin);
    const tw = this.#limit(spec.width);
    const name = this.#pins[pin]!.name;
    const high = spec.level !== 'low';
    const low = spec.level !== 'high';
    return {
      check(ctx, times, armed = true) {
        if (!armed || !ctx.changed(pin)) return false;
        // A phase counts from the pin leaving the opposite level: one that began from Z or X
        // only (power-on) is not a pulse.
        const was = ctx.prev(pin);
        let since: number;
        if (was === Level.L1 && high) since = times[pin * 3 + LEFT_LOW]!;
        else if (was === Level.L0 && low) since = times[pin * 3 + LEFT_HIGH]!;
        else return false;
        const width = ctx.now - since;
        if (width >= tw) return false;
        ctx.report({
          kind: TimingViolation.PULSE_WIDTH,
          message: `${name} was ${was === Level.L1 ? 'HIGH' : 'LOW'} for only ${formatTime(width)} (pulse width ≥ ${formatTime(tw)})`,
          pin,
        });
        return true;
      },
    };
  }

  recovery(spec: RecoverySpec): RecoveryCheck {
    const pin = this.#pin(spec.pin);
    const clock = this.#pin(spec.clock);
    const trec = this.#limit(spec.recovery);
    // Released = leaving the active level.
    const activeLevel = spec.active === 'low' ? Level.L0 : Level.L1;
    const releaseSlot = spec.active === 'low' ? LEFT_LOW : LEFT_HIGH;
    const name = this.#pins[pin]!.name;
    const clockName = this.#pins[clock]!.name;
    const verb = edgeVerb(spec.edge);
    return {
      check(ctx, times) {
        const edge = spec.edge === 'rise' ? ctx.rose(clock) : ctx.fell(clock);
        if (!edge) return false;
        const released = ctx.changed(pin) && ctx.prev(pin) === activeLevel;
        const elapsed = released ? 0 : ctx.now - times[pin * 3 + releaseSlot]!;
        if (elapsed >= trec) return false;
        const when = elapsed === 0 ? 'at the same time as' : `${formatTime(elapsed)} after`;
        ctx.report({
          kind: TimingViolation.RECOVERY,
          message: `${clockName} ${verb} ${when} ${name} was released (recovery time ≥ ${formatTime(trec)})`,
          pin,
        });
        return true;
      },
    };
  }

  #pin(name: string): PinRef {
    const pin = pinIndex(this.#pins, name);
    if (!this.#watched.includes(pin)) this.#watched = Int32Array.from([...this.#watched, pin]);
    return pin;
  }

  #limit(key: string): Time {
    const value = this.#min[key];
    if (value === undefined || value < 0) throw new Error(`missing minimum "${key}"`);
    return value;
  }
}

function names(list: string): string[] {
  return list.split(',').map((s) => s.trim());
}

function edgeVerb(edge: Edge): string {
  return edge === 'rise' ? 'rose' : 'fell';
}
