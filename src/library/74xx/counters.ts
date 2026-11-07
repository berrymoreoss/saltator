/**
 * Synchronous 4-bit binary counters: 74xx161 (asynchronous reset) and 163 (synchronous reset).
 * Pinouts and function tables transcribed from the Nexperia data sheets; timing and its
 * requirements in `hc-timing.ts`. Spec: docs/components.md#counters-and-shift-registers.
 */
import {
  type AnyComponentDefinition,
  and,
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
  type LogicFamily,
  pinIndices,
} from './chip';
import {
  allAt,
  ClockEdge,
  clockEdge,
  couldBe,
  countInto,
  either,
  mergeInto,
} from './edge-triggered';
import { HC } from './hc-timing';
import { type DelayPath, pathDelays } from './paths';
import { pins } from './pinout';

/**
 * A presettable synchronous counter with the 161's pins: MR, CP, D0–D3, CEP, CET, PE → Q0–Q3,
 * TC. Loads on the clock edge while PE is LOW, counts while CEP and CET are HIGH.
 */
export interface SyncCounterSpec extends ChipSpec {
  /** MR clears at once (161) or at the next clock edge (163). */
  readonly reset: 'asynchronous' | 'synchronous';
  /** Keys of the timing requirements. */
  readonly requirements: {
    readonly setupData: string;
    readonly setupLoad: string;
    readonly setupEnables: string;
    /** The 163's MR is a synchronous input with its own set-up time. */
    readonly setupReset?: string;
    readonly hold: string;
    readonly clockWidth: string;
    /** The 161's asynchronous MR: its pulse width and its recovery time before CP. */
    readonly resetWidth?: string;
    readonly recovery?: string;
  };
  /** Delay paths of Q0–Q3 and TC. */
  readonly paths: readonly DelayPath[];
}

/** State of a counter chip. */
export interface CounterState {
  /** The count, bit 0 first; `X` until reset or loaded. */
  q: Level[];
  /** The count before the last active edge, and before the last reset began (timing checks). */
  beforeEdge: Level[];
  beforeReset: Level[];
  times: PinTimes;
}

const BITS = 4;

/**
 * On every call: an active clock edge resets (163), loads or counts as the controls say; a
 * control that is unknown, or changed within its set-up time, merges the outcomes of every mode
 * it allows (only the bits where they differ become `X`); a late data bit loads `X`. An
 * uncertain edge makes `X` the bits the edge would change. A short clock phase or a recovery
 * violation makes `X` the bits the edge would change (a short HIGH phase: changed); a short
 * reset pulse the bits it cleared. The 161's MR clears at once and disarms the clock's checks.
 * TC = CET · (count = 15).
 */
export function syncCounterBehavior(spec: SyncCounterSpec): ChipBehavior<CounterState> {
  return (pinList, delays, min) => {
    const r = spec.requirements;
    const asyncReset = spec.reset === 'asynchronous';
    const checks = new TimingChecks(pinList, min);
    const data = pinIndices(pinList, 'D0, D1, D2, D3');
    const outputs = pinIndices(pinList, 'Q0, Q1, Q2, Q3');
    const clock = pinIndex(pinList, 'CP');
    const reset = pinIndex(pinList, 'MR');
    const load = pinIndex(pinList, 'PE');
    const cep = pinIndex(pinList, 'CEP');
    const cet = pinIndex(pinList, 'CET');
    const tc = pinIndex(pinList, 'TC');
    const paths = pathDelays(pinList, delays, spec.paths);

    const check = (pins: string, setup: string) =>
      checks.setupHold({ data: pins, clock: 'CP', edge: 'rise', setup, hold: r.hold });
    const dataCheck = check('D0, D1, D2, D3', r.setupData);
    const loadCheck = check('PE', r.setupLoad);
    const enableCheck = check('CEP, CET', r.setupEnables);
    const resetCheck = r.setupReset ? check('MR', r.setupReset) : null;
    const clockWidth = checks.pulseWidth({ pin: 'CP', level: 'both', width: r.clockWidth });
    const resetWidth = r.resetWidth
      ? checks.pulseWidth({ pin: 'MR', level: 'low', width: r.resetWidth })
      : null;
    const recovery = r.recovery
      ? checks.recovery({
          pin: 'MR',
          active: 'low',
          clock: 'CP',
          edge: 'rise',
          recovery: r.recovery,
        })
      : null;

    // Scratch outcomes, filled and used within one call (evaluate is never re-entered).
    const zeros: readonly Level[] = [Level.L0, Level.L0, Level.L0, Level.L0];
    const loaded: Level[] = [...zeros];
    const counted: Level[] = [...zeros];
    const next: Level[] = [...zeros];

    const evaluate = (ctx: EvalContext<CounterState>) => {
      const { q, beforeEdge, beforeReset, times } = ctx.state;
      const mr = toInput(ctx.read(reset));
      // The 161's clock matters unless MR surely holds it cleared.
      const armed = !asyncReset || mr !== Level.L0;
      // Synchronous controls, unknown (X) when they changed within their set-up time.
      const lateReset = resetCheck ? resetCheck.setup(ctx, times, armed) : 0;
      const syncReset = asyncReset ? Level.L1 : lateReset ? Level.X : mr;
      const counting = syncReset !== Level.L0;
      const lateLoad = loadCheck.setup(ctx, times, armed && counting);
      const pe = lateLoad ? Level.X : toInput(ctx.read(load));
      const loading = counting && couldBe(pe, Level.L0);
      const lateData = dataCheck.setup(ctx, times, armed && loading);
      const lateEnables = enableCheck.setup(ctx, times, armed && counting && pe !== Level.L0);
      let early = dataCheck.hold(ctx, times, armed && loading);
      early |= loadCheck.hold(ctx, times, armed && counting);
      early |= enableCheck.hold(ctx, times, armed && counting && pe !== Level.L0);
      if (resetCheck) early |= resetCheck.hold(ctx, times, armed);
      const shortClock = clockWidth.check(ctx, times, armed);
      const shortReset = resetWidth ? resetWidth.check(ctx, times) : false;
      const recovering = recovery ? recovery.check(ctx, times) : false;
      const edge = clockEdge(ctx, clock, 'rise');
      const resetStarts = asyncReset && ctx.changed(reset) && toInput(ctx.prev(reset)) === Level.L1;
      const enabled = toInput(ctx.read(cet));

      if (edge !== ClockEdge.NONE && armed) {
        // Every mode the controls allow: reset, load, count, hold.
        let first = true;
        if (syncReset !== Level.L1) {
          mergeInto(next, zeros, first);
          first = false;
        }
        if (loading) {
          for (let n = 0; n < BITS; n++) {
            loaded[n] = (lateData >> n) & 1 ? Level.X : toInput(ctx.read(data[n]!));
          }
          mergeInto(next, loaded, first);
          first = false;
        }
        if (counting && pe !== Level.L0) {
          const both = and(
            lateEnables & 1 ? Level.X : toInput(ctx.read(cep)),
            lateEnables & 2 ? Level.X : enabled,
          );
          if (both !== Level.L0) {
            countInto(q, true, counted);
            mergeInto(next, counted, first);
            first = false;
          }
          if (both !== Level.L1) {
            mergeInto(next, q, first);
            first = false;
          }
        }
        for (let n = 0; n < BITS; n++) {
          const was = q[n]!;
          q[n] =
            edge === ClockEdge.UNCERTAIN || shortClock || recovering
              ? either(was, next[n]!)
              : next[n]!;
          if (edge === ClockEdge.ACTIVE) beforeEdge[n] = was;
        }
      } else if (early !== 0 || shortClock) {
        // Inputs that moved too soon after the edge, or a short HIGH phase: the edge's changes.
        for (let n = 0; n < BITS; n++) q[n] = either(q[n]!, beforeEdge[n]!);
      }

      for (let n = 0; n < BITS; n++) {
        if (shortReset) q[n] = either(q[n]!, beforeReset[n]!);
        if (resetStarts) beforeReset[n] = q[n]!;
        if (asyncReset) {
          if (mr === Level.L0) q[n] = Level.L0;
          else if (mr !== Level.L1) q[n] = either(q[n]!, Level.L0);
        }
        const out = outputs[n]!;
        ctx.drive(out, strong(q[n]!), paths.delay(ctx, out));
      }
      ctx.drive(tc, strong(and(enabled, allAt(q, Level.L1))), paths.delay(ctx, tc));
      checks.track(ctx, times);
    };

    return () => ({
      createState: () => ({
        q: [Level.X, Level.X, Level.X, Level.X],
        beforeEdge: [Level.X, Level.X, Level.X, Level.X],
        beforeReset: [Level.X, Level.X, Level.X, Level.X],
        times: checks.createTimes(),
      }),
      evaluate,
    });
  };
}

const KEYWORDS = ['counter', 'binary', 'synchronous', 'presettable', 'program counter', 'divider'];
const COUNTER_PINS = (reset: string) => [
  pins('MR', '1', 'in', `${reset} master reset (active LOW)`, { activeLow: true }),
  pins('CP', '2', 'in', 'clock input (LOW-to-HIGH, edge-triggered)', { clock: true }),
  pins('D0, D1, D2, D3', '3, 4, 5, 6', 'in', 'data input'),
  pins('CEP', '7', 'in', 'count enable input'),
  pins('GND', '8', 'power', 'ground (0 V)'),
  pins('PE', '9', 'in', 'parallel enable input (active LOW)', { activeLow: true }),
  pins('CET', '10', 'in', 'count enable carry input'),
  pins('Q0, Q1, Q2, Q3', '14, 13, 12, 11', 'out', 'flip-flop output'),
  pins('TC', '15', 'out', 'terminal count output'),
  pins('VCC', '16', 'power', 'supply voltage'),
];
const Q4 = 'Q0, Q1, Q2, Q3';
const TC_NOTE = '[1] TC is HIGH when CET is HIGH and the counter is at terminal count (HHHH)';

export const CNT161_SPEC: SyncCounterSpec = {
  number: '161',
  title: 'Presettable synchronous 4-bit binary counter; asynchronous reset',
  keywords: [...KEYWORDS, 'asynchronous reset', 'clear'],
  pinCount: 16,
  pins: COUNTER_PINS('asynchronous'),
  functionTable: {
    inputs: ['MR', 'CP', 'CEP', 'CET', 'PE', 'Dn'],
    outputs: ['Qn', 'TC'],
    rows: [
      'L X X X X X | L L',
      'H ↑ X X l l | L L',
      'H ↑ X X l h | H [1]',
      'H ↑ h h h X | count [1]',
      'H X l X h X | qn [1]',
      'H X X l h X | qn L',
    ],
    note: `each flip-flop (n = 0 to 3): reset (clear), parallel load, count, hold (do nothing); ${TC_NOTE}`,
    state: { qn: 'Qn' },
  },
  reset: 'asynchronous',
  requirements: {
    setupData: 'tsu(Dn to CP)',
    setupLoad: 'tsu(PE to CP)',
    setupEnables: 'tsu(CEP, CET to CP)',
    hold: 'th(Dn, PE, CEP, CET to CP)',
    clockWidth: 'tW(CP)',
    resetWidth: 'tW(MR)',
    recovery: 'trec(MR to CP)',
  },
  paths: [
    { from: 'CP', to: Q4, delay: 'tpd(CP to Qn)' },
    { from: 'CP', to: 'TC', delay: 'tpd(CP to TC)' },
    { from: 'CET', to: 'TC', delay: 'tpd(CET to TC)' },
    { from: 'MR', to: Q4, delay: 'tPHL(MR to Qn)' },
    { from: 'MR', to: 'TC', delay: 'tPHL(MR to TC)' },
  ],
};

export const CNT163_SPEC: SyncCounterSpec = {
  number: '163',
  title: 'Presettable synchronous 4-bit binary counter; synchronous reset',
  keywords: [...KEYWORDS, 'synchronous reset', 'clear', 'modulo'],
  pinCount: 16,
  pins: COUNTER_PINS('synchronous'),
  functionTable: {
    inputs: ['MR', 'CP', 'CEP', 'CET', 'PE', 'Dn'],
    outputs: ['Qn', 'TC'],
    // The data sheet's TC column says L in the second load row and the first hold row, against
    // its own note [1]; written as the 161's.
    rows: [
      'l ↑ X X X X | L L',
      'h ↑ X X l l | L L',
      'h ↑ X X l h | H [1]',
      'h ↑ h h h X | count [1]',
      'h X l X h X | qn [1]',
      'h X X l h X | qn L',
    ],
    note: `each flip-flop (n = 0 to 3): reset (clear), parallel load, count, hold (do nothing); ${TC_NOTE}`,
    state: { qn: 'Qn' },
  },
  reset: 'synchronous',
  requirements: {
    setupData: 'tsu(MR, Dn to CP)',
    setupLoad: 'tsu(PE to CP)',
    setupEnables: 'tsu(CEP, CET to CP)',
    setupReset: 'tsu(MR, Dn to CP)',
    hold: 'th(Dn, PE, CEP, CET, MR to CP)',
    clockWidth: 'tW(CP)',
  },
  paths: [
    { from: 'CP', to: Q4, delay: 'tpd(CP to Qn)' },
    { from: 'CP', to: 'TC', delay: 'tpd(CP to TC)' },
    { from: 'CET', to: 'TC', delay: 'tpd(CET to TC)' },
  ],
};

export const COUNTER_SPECS: readonly SyncCounterSpec[] = [CNT161_SPEC, CNT163_SPEC];

/** The synchronous counters of a family. */
export function counterChips(family: LogicFamily): AnyComponentDefinition[] {
  return COUNTER_SPECS.map((spec) => chipDefinition(spec, family, syncCounterBehavior(spec)));
}

/** 74HC161, 163. */
export const hcCounters = counterChips(HC);
