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

/** The clock transition a part acts on. */
export type Edge = 'rise' | 'fall';

/**
 * Per pin (by `PinRef`): the time of its last change, last rise and last fall (strict 0 ↔ 1), as
 * three consecutive entries; `-Infinity` until it happens. Plain data in the instance's state:
 * absolute simulation times, so a carry-over keeps them.
 */
export type PinTimes = Float64Array;

const CHANGED = 0;
const ROSE = 1;
const FELL = 2;

/** Setup and hold of data (or enable) inputs against a clock edge. */
export interface SetupHoldSpec {
  /** Comma-separated input pin names (at most 31). */
  readonly data: string;
  readonly clock: string;
  readonly edge: Edge;
  /** Key of the setup time in the minima: `tsu(nD to nCP)`. */
  readonly setup: string;
  /** Key of the hold time; omitted when the data sheet gives none. */
  readonly hold?: string;
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
   * At the active edge of the clock (in this delta): the data inputs that changed less than the
   * setup time before it, at the same instant included; bit `n` is the `n`th data pin. Reports
   * each one. 0 when the clock had no active edge, or when not `armed` (the part ignores the
   * edge: held in reset, loading disabled).
   */
  setup(ctx: EvalContext<unknown>, times: PinTimes, armed?: boolean): number;
  /**
   * The data inputs that changed in this delta less than the hold time after the last active
   * edge; bit `n` is the `n`th data pin. An edge in this delta isn't recorded yet (`track` runs
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
      if (ctx.rose(pin)) times[pin * 3 + ROSE] = now;
      else if (ctx.fell(pin)) times[pin * 3 + FELL] = now;
    }
  }

  setupHold(spec: SetupHoldSpec): SetupHoldCheck {
    const data = Int32Array.from(names(spec.data), (name) => this.#pin(name));
    if (data.length > 31) throw new Error(`setup check on ${data.length} pins (at most 31)`);
    const clock = this.#pin(spec.clock);
    const tsu = this.#limit(spec.setup);
    const th = spec.hold === undefined ? 0 : this.#limit(spec.hold);
    const edgeSlot = spec.edge === 'rise' ? ROSE : FELL;
    const verb = edgeVerb(spec.edge);
    const pins = this.#pins;
    const clockName = pins[clock]!.name;
    const active = (ctx: EvalContext<unknown>) =>
      spec.edge === 'rise' ? ctx.rose(clock) : ctx.fell(clock);

    return {
      setup(ctx, times, armed = true) {
        if (!armed || !active(ctx)) return 0;
        let late = 0;
        for (let n = 0; n < data.length; n++) {
          const pin = data[n]!;
          const elapsed = ctx.changed(pin) ? 0 : ctx.now - times[pin * 3 + CHANGED]!;
          if (elapsed >= tsu) continue;
          late |= 1 << n;
          const when = elapsed === 0 ? 'at the same time as' : `${formatTime(elapsed)} before`;
          ctx.report({
            kind: TimingViolation.SETUP,
            message: `${pins[pin]!.name} changed ${when} ${clockName} ${verb} (setup time ≥ ${formatTime(tsu)})`,
            pin,
          });
        }
        return late;
      },
      hold(ctx, times, armed = true) {
        if (!armed || th === 0) return 0;
        const elapsed = ctx.now - times[clock * 3 + edgeSlot]!;
        if (elapsed >= th) return 0;
        let early = 0;
        for (let n = 0; n < data.length; n++) {
          const pin = data[n]!;
          if (!ctx.changed(pin)) continue;
          early |= 1 << n;
          const when = elapsed === 0 ? 'at the same time as' : `${formatTime(elapsed)} after`;
          ctx.report({
            kind: TimingViolation.HOLD,
            message: `${pins[pin]!.name} changed ${when} ${clockName} ${verb} (hold time ≥ ${formatTime(th)})`,
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
        // A phase counts from a strict edge into it: one that began from X/Z (power-on) is
        // not a pulse.
        const was = ctx.prev(pin);
        let since: number;
        if (was === Level.L1 && high) since = times[pin * 3 + ROSE]!;
        else if (was === Level.L0 && low) since = times[pin * 3 + FELL]!;
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
    // Released = the strict edge out of the active level.
    const releaseSlot = spec.active === 'low' ? ROSE : FELL;
    const name = this.#pins[pin]!.name;
    const clockName = this.#pins[clock]!.name;
    const verb = edgeVerb(spec.edge);
    return {
      check(ctx, times) {
        const edge = spec.edge === 'rise' ? ctx.rose(clock) : ctx.fell(clock);
        if (!edge) return false;
        const released = spec.active === 'low' ? ctx.rose(pin) : ctx.fell(pin);
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
