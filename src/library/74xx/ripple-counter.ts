/**
 * Binary ripple counters: 74xx4040 (12 stages). Each stage is a toggle flip-flop clocked by the
 * stage before it, so an output changes one stage delay after the one below it. Pinout and
 * function table transcribed from the Nexperia data sheet; timing and its requirements in
 * `hc-timing.ts`. Spec: docs/components.md#counters-and-shift-registers.
 */
import {
  type AnyComponentDefinition,
  type EvalContext,
  Level,
  type PinTimes,
  pinIndex,
  strong,
  TimingChecks,
  toInput,
} from '../../core';
import {
  type ChipBehavior,
  type ChipSpec,
  chipDefinition,
  delay,
  type LogicFamily,
  pinIndices,
} from './chip';
import { ClockEdge, clockEdge, countInto, either } from './edge-triggered';
import { HC } from './hc-timing';
import { pins } from './pinout';

/** A ripple counter: a falling-edge clock `CP`, an active-HIGH master reset `MR`. */
export interface RippleCounterSpec extends ChipSpec {
  /** Comma-separated stage outputs, Q0 first. */
  readonly outputs: string;
}

/** State of a ripple counter. */
export interface RippleCounterState {
  /** The count, Q0 first; `X` until reset. */
  q: Level[];
  /** The count before the last edge, and before the last reset began (timing checks). */
  beforeEdge: Level[];
  beforeReset: Level[];
  times: PinTimes;
}

/**
 * Counts on every falling CP edge; MR HIGH clears at once and disarms the clock's checks. The
 * count is stored at the edge, but output Qn changes `tpd(CP to Q0) + n · tpd(Qn to Qn+1)`
 * after it, so the outputs pass through the intermediate counts as on the chip (decoding them
 * with gates glitches). In-spec clocks never cancel a ripple: a stage changes at most once per
 * 2^n clock periods, longer than its delay. An uncertain edge, a short clock phase or a recovery
 * violation makes `X` the bits the edge changes (or changed); a short reset pulse the bits it
 * cleared.
 */
export function rippleCounterBehavior(spec: RippleCounterSpec): ChipBehavior<RippleCounterState> {
  return (pinList, delays, min) => {
    const checks = new TimingChecks(pinList, min);
    const outputs = pinIndices(pinList, spec.outputs);
    const stages = outputs.length;
    const clock = pinIndex(pinList, 'CP');
    const reset = pinIndex(pinList, 'MR');
    const first = delay(delays, 'tpd(CP to Q0)');
    const stage = delay(delays, 'tpd(Qn to Qn+1)');
    const cleared = delay(delays, 'tPHL(MR to Qn)');
    const clockWidth = checks.pulseWidth({ pin: 'CP', level: 'both', width: 'tW(CP)' });
    const resetWidth = checks.pulseWidth({ pin: 'MR', level: 'high', width: 'tW(MR)' });
    const recovery = checks.recovery({
      pin: 'MR',
      active: 'high',
      clock: 'CP',
      edge: 'fall',
      recovery: 'trec(MR to CP)',
    });
    const next: Level[] = Array.from({ length: stages }, () => Level.X);
    const unknown = () => Array.from({ length: stages }, () => Level.X);

    const evaluate = (ctx: EvalContext<RippleCounterState>) => {
      const { q, beforeEdge, beforeReset, times } = ctx.state;
      const mr = toInput(ctx.read(reset));
      const armed = mr !== Level.L1;
      const shortClock = clockWidth.check(ctx, times, armed);
      const shortReset = resetWidth.check(ctx, times);
      const recovering = recovery.check(ctx, times);
      const edge = clockEdge(ctx, clock, 'fall');
      const resetStarts = ctx.changed(reset) && toInput(ctx.prev(reset)) === Level.L0;

      if (edge !== ClockEdge.NONE && armed) {
        countInto(q, true, next);
        const unsure = edge === ClockEdge.UNCERTAIN || shortClock || recovering;
        for (let n = 0; n < stages; n++) {
          const was = q[n]!;
          q[n] = unsure ? either(was, next[n]!) : next[n]!;
          if (edge === ClockEdge.ACTIVE) beforeEdge[n] = was;
        }
      } else if (shortClock) {
        for (let n = 0; n < stages; n++) q[n] = either(q[n]!, beforeEdge[n]!);
      }

      const byReset = ctx.changed(reset);
      for (let n = 0; n < stages; n++) {
        if (shortReset) q[n] = either(q[n]!, beforeReset[n]!);
        if (resetStarts) beforeReset[n] = q[n]!;
        if (mr === Level.L1) q[n] = Level.L0;
        else if (mr !== Level.L0) q[n] = either(q[n]!, Level.L0);
        ctx.drive(outputs[n]!, strong(q[n]!), byReset ? cleared : first + n * stage);
      }
      checks.track(ctx, times);
    };

    return () => ({
      createState: () => ({
        q: unknown(),
        beforeEdge: unknown(),
        beforeReset: unknown(),
        times: checks.createTimes(),
      }),
      evaluate,
    });
  };
}

export const CNT4040_SPEC: RippleCounterSpec = {
  number: '4040',
  title: '12-stage binary ripple counter',
  keywords: ['counter', 'ripple counter', 'binary', 'divider', 'frequency divider', 'prescaler'],
  pinCount: 16,
  pins: [
    pins('Q11', '1', 'out', 'output 11'),
    pins('Q5', '2', 'out', 'output 5'),
    pins('Q4', '3', 'out', 'output 4'),
    pins('Q6', '4', 'out', 'output 6'),
    pins('Q3', '5', 'out', 'output 3'),
    pins('Q2', '6', 'out', 'output 2'),
    pins('Q1', '7', 'out', 'output 1'),
    pins('GND', '8', 'power', 'ground (0 V)'),
    pins('Q0', '9', 'out', 'output 0'),
    pins('CP', '10', 'in', 'clock input (HIGH-to-LOW, edge-triggered)', {
      clock: true,
      activeLow: true,
    }),
    pins('MR', '11', 'in', 'master reset input (active HIGH)'),
    pins('Q8', '12', 'out', 'output 8'),
    pins('Q7', '13', 'out', 'output 7'),
    pins('Q9', '14', 'out', 'output 9'),
    pins('Q10', '15', 'out', 'output 10'),
    pins('VCC', '16', 'power', 'positive supply voltage'),
  ],
  functionTable: {
    inputs: ['CP', 'MR'],
    outputs: ['Qn'],
    // The data sheet writes "no change" for qn.
    rows: ['↑ L | qn', '↓ L | count', 'X H | L'],
    note: 'outputs Q0 to Q11: no change (qn), count, reset',
    state: { qn: 'Qn' },
  },
  outputs: 'Q0, Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10, Q11',
};

/** The ripple counters of a family. */
export function rippleCounterChips(family: LogicFamily): AnyComponentDefinition[] {
  return [chipDefinition(CNT4040_SPEC, family, rippleCounterBehavior(CNT4040_SPEC))];
}

/** 74HC4040. */
export const hcRippleCounters = rippleCounterChips(HC);
