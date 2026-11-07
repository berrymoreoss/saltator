/**
 * Presettable synchronous 4-bit binary up/down counters with an asynchronous parallel load:
 * 74xx191 (one clock, count enable, up/down input, TC and RC̅) and 193 (count-up and count-down
 * clocks, master reset, TC̅U and TC̅D). Pinouts and function tables transcribed from the
 * Nexperia data sheets; timing and its requirements in `hc-timing.ts`. Spec:
 * docs/components.md#counters-and-shift-registers.
 */
import {
  type AnyComponentDefinition,
  and,
  type EvalContext,
  Level,
  not,
  type PinTimes,
  pinIndex,
  strong,
  TimingChecks,
  TimingViolation,
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

/** A chip whose behavior is its own; the spec adds the delay paths. */
export interface UpDownCounterSpec extends ChipSpec {
  readonly paths: readonly DelayPath[];
}

/** State of an up/down counter. */
export interface UpDownCounterState {
  /** The count, bit 0 first; `X` until loaded (or reset, 193). */
  q: Level[];
  /** The count before the last counting edge, and before the last load and reset began. */
  beforeEdge: Level[];
  beforeLoad: Level[];
  beforeReset: Level[];
  /** 191: U̅/D changed while CE̅ and CP were LOW, so the next count's direction is unknown. */
  directionUnknown: boolean;
  times: PinTimes;
}

const BITS = 4;
const D4 = 'D0, D1, D2, D3';
const Q4 = 'Q0, Q1, Q2, Q3';

function createState(checks: TimingChecks): UpDownCounterState {
  return {
    q: [Level.X, Level.X, Level.X, Level.X],
    beforeEdge: [Level.X, Level.X, Level.X, Level.X],
    beforeLoad: [Level.X, Level.X, Level.X, Level.X],
    beforeReset: [Level.X, Level.X, Level.X, Level.X],
    directionUnknown: false,
    times: checks.createTimes(),
  };
}

/** Scratch outcomes of one counting edge (evaluate is never re-entered). */
function scratch() {
  return { up: [Level.X, Level.X, Level.X, Level.X], down: [Level.X, Level.X, Level.X, Level.X] };
}

/**
 * The parallel load, transparent while PL̅ is LOW (an unknown PL̅ merges), with its timing: a data
 * bit that changed within its set-up or hold time around PL̅ rising (`uncertain`) is `X`; a short
 * PL̅ pulse makes `X` the bits it changed.
 */
function applyLoad(
  ctx: EvalContext<UpDownCounterState>,
  data: Int32Array,
  pl: Level,
  uncertain: number,
  shortLoad: boolean,
  loadStarts: boolean,
): void {
  const { q, beforeLoad } = ctx.state;
  for (let n = 0; n < BITS; n++) {
    if (loadStarts) beforeLoad[n] = q[n]!;
    if (pl !== Level.L1) {
      const d = toInput(ctx.read(data[n]!));
      q[n] = pl === Level.L0 ? d : either(q[n]!, d);
    }
    if ((uncertain >> n) & 1) q[n] = Level.X;
    if (shortLoad) q[n] = either(q[n]!, beforeLoad[n]!);
  }
}

/**
 * 74xx191. PL̅ LOW loads D (asynchronous, transparent); else a rising CP counts while CE̅ is LOW,
 * up while U̅/D is LOW, down while HIGH. Unknown or late CE̅ and U̅/D merge the outcomes they
 * allow. The data sheet's usage rules are checked like timing requirements (reported, and `X`
 * where the possible outcomes differ): CE̅ may rise only while CP is HIGH (else the gated clock
 * may count), U̅/D may change only while CE̅ or CP is HIGH (else the next count's direction is
 * unknown). TC is HIGH at 15 counting up or at 0 counting down; RC̅ is LOW while TC is HIGH and
 * CE̅ and CP are LOW.
 */
export function counter191Behavior(spec: UpDownCounterSpec): ChipBehavior<UpDownCounterState> {
  return (pinList, delays, min) => {
    const checks = new TimingChecks(pinList, min);
    const data = pinIndices(pinList, D4);
    const outputs = pinIndices(pinList, Q4);
    const clock = pinIndex(pinList, 'CP');
    const enable = pinIndex(pinList, 'CE');
    const direction = pinIndex(pinList, 'UD');
    const load = pinIndex(pinList, 'PL');
    const tc = pinIndex(pinList, 'TC');
    const rc = pinIndex(pinList, 'RC');
    const paths = pathDelays(pinList, delays, spec.paths);

    const dataCheck = checks.setupHold({
      data: D4,
      clock: 'PL',
      edge: 'rise',
      setup: 'tsu(Dn to PL)',
      hold: 'th(Dn to PL)',
    });
    const enableCheck = checks.setupHold({
      data: 'CE',
      clock: 'CP',
      edge: 'rise',
      setup: 'tsu(CE to CP)',
      hold: 'th(CE to CP)',
    });
    const directionCheck = checks.setupHold({
      data: 'UD',
      clock: 'CP',
      edge: 'rise',
      setup: 'tsu(UD to CP)',
      hold: 'th(UD to CP)',
    });
    const clockWidth = checks.pulseWidth({ pin: 'CP', level: 'both', width: 'tW(CP)' });
    const loadWidth = checks.pulseWidth({ pin: 'PL', level: 'low', width: 'tW(PL)' });
    const recovery = checks.recovery({
      pin: 'PL',
      active: 'low',
      clock: 'CP',
      edge: 'rise',
      recovery: 'trec(PL to CP)',
    });
    const { up, down } = scratch();
    const next = [Level.X, Level.X, Level.X, Level.X];

    const evaluate = (ctx: EvalContext<UpDownCounterState>) => {
      const state = ctx.state;
      const { q, beforeEdge, times } = state;
      const pl = toInput(ctx.read(load));
      const armed = pl !== Level.L0;
      const ce = toInput(ctx.read(enable));
      const ud = toInput(ctx.read(direction));
      const uncertainData = dataCheck.setup(ctx, times) | dataCheck.hold(ctx, times);
      const shortLoad = loadWidth.check(ctx, times);
      const recovering = recovery.check(ctx, times);
      const lateEnable = enableCheck.setup(ctx, times, armed);
      const counting = lateEnable ? true : couldBe(ce, Level.L0);
      const lateDirection = directionCheck.setup(ctx, times, armed && counting);
      const early =
        enableCheck.hold(ctx, times, armed) | directionCheck.hold(ctx, times, armed && counting);
      const shortClock = clockWidth.check(ctx, times, armed);
      const edge = clockEdge(ctx, clock, 'rise');
      const cp = toInput(ctx.read(clock));
      const loadStarts = ctx.changed(load) && toInput(ctx.prev(load)) === Level.L1;

      // Usage rules: only while the counter isn't loading, and only for a known breach.
      let spurious = false;
      if (
        armed &&
        ctx.changed(enable) &&
        toInput(ctx.prev(enable)) === Level.L0 &&
        ce !== Level.L0
      ) {
        spurious = cp !== Level.L1;
        if (cp === Level.L0) {
          ctx.report({
            kind: TimingViolation.SETUP,
            message: 'CE rose while CP was LOW (CE may rise only while CP is HIGH)',
            pin: enable,
          });
        }
      }
      if (armed && ctx.changed(direction) && couldBe(ce, Level.L0) && couldBe(cp, Level.L0)) {
        state.directionUnknown = true;
        if (ce === Level.L0 && cp === Level.L0) {
          ctx.report({
            kind: TimingViolation.SETUP,
            message:
              'UD changed while CE and CP were LOW (it may change only while either is HIGH)',
            pin: direction,
          });
        }
      }

      const countWays = (dir: Level, includeHold: boolean) => {
        let first = true;
        if (couldBe(dir, Level.L0)) {
          countInto(q, true, up);
          mergeInto(next, up, first);
          first = false;
        }
        if (couldBe(dir, Level.L1)) {
          countInto(q, false, down);
          mergeInto(next, down, first);
          first = false;
        }
        if (includeHold) mergeInto(next, q, first);
      };

      if (edge !== ClockEdge.NONE && armed) {
        const ceNow = lateEnable ? Level.X : ce;
        const dir = lateDirection || state.directionUnknown ? Level.X : ud;
        if (ceNow === Level.L1) mergeInto(next, q, true);
        else countWays(dir, ceNow !== Level.L0);
        for (let n = 0; n < BITS; n++) {
          const was = q[n]!;
          q[n] =
            edge === ClockEdge.UNCERTAIN || shortClock || recovering
              ? either(was, next[n]!)
              : next[n]!;
          if (edge === ClockEdge.ACTIVE) beforeEdge[n] = was;
        }
        state.directionUnknown = false;
      } else if (early !== 0 || shortClock) {
        for (let n = 0; n < BITS; n++) q[n] = either(q[n]!, beforeEdge[n]!);
      } else if (spurious) {
        countWays(state.directionUnknown ? Level.X : ud, true);
        for (let n = 0; n < BITS; n++) q[n] = next[n]!;
      }
      applyLoad(ctx, data, pl, uncertainData, shortLoad, loadStarts);

      for (let n = 0; n < BITS; n++) {
        const out = outputs[n]!;
        ctx.drive(out, strong(q[n]!), paths.delay(ctx, out));
      }
      const atEnd =
        ud === Level.L0
          ? allAt(q, Level.L1)
          : ud === Level.L1
            ? allAt(q, Level.L0)
            : either(allAt(q, Level.L1), allAt(q, Level.L0));
      ctx.drive(tc, strong(atEnd), paths.delay(ctx, tc));
      ctx.drive(rc, strong(not(and(atEnd, and(not(ce), not(cp))))), paths.delay(ctx, rc));
      checks.track(ctx, times);
    };

    return () => ({ createState: () => createState(checks), evaluate });
  };
}

/**
 * 74xx193. MR HIGH clears and PL̅ LOW loads D (both asynchronous, MR first); else the count goes
 * up on a rising CPU while CPD is HIGH and down on a rising CPD while CPU is HIGH. The other clock
 * must be HIGH at the counting edge and stay HIGH `th(CPU to CPD, CPD to CPU)` after it: a clock
 * rising while the other is LOW is a hold violation and makes `X` the bits where counting or not
 * differ (the logic diagram's chains do a partial count then); both rising together, where up and
 * down differ. TC̅U is LOW while CPU is LOW at 15, TC̅D while CPD is LOW at 0.
 */
export function counter193Behavior(spec: UpDownCounterSpec): ChipBehavior<UpDownCounterState> {
  return (pinList, delays, min) => {
    const checks = new TimingChecks(pinList, min);
    const data = pinIndices(pinList, D4);
    const outputs = pinIndices(pinList, Q4);
    const cpu = pinIndex(pinList, 'CPU');
    const cpd = pinIndex(pinList, 'CPD');
    const load = pinIndex(pinList, 'PL');
    const reset = pinIndex(pinList, 'MR');
    const tcu = pinIndex(pinList, 'TCU');
    const tcd = pinIndex(pinList, 'TCD');
    const paths = pathDelays(pinList, delays, spec.paths);

    const dataCheck = checks.setupHold({
      data: D4,
      clock: 'PL',
      edge: 'rise',
      setup: 'tsu(Dn to PL)',
      hold: 'th(Dn to PL)',
    });
    const hold = 'th(CPU to CPD, CPD to CPU)';
    // The other clock falling too soon after the counting edge (Fig. 14).
    const downHeld = checks.setupHold({
      data: 'CPD',
      clock: 'CPU',
      edge: 'rise',
      hold,
      dataEdge: 'fall',
    });
    const upHeld = checks.setupHold({
      data: 'CPU',
      clock: 'CPD',
      edge: 'rise',
      hold,
      dataEdge: 'fall',
    });
    const upWidth = checks.pulseWidth({ pin: 'CPU', level: 'both', width: 'tW(CPU, CPD)' });
    const downWidth = checks.pulseWidth({ pin: 'CPD', level: 'both', width: 'tW(CPU, CPD)' });
    const resetWidth = checks.pulseWidth({ pin: 'MR', level: 'high', width: 'tW(MR)' });
    const loadWidth = checks.pulseWidth({ pin: 'PL', level: 'low', width: 'tW(PL)' });
    const recoveries = (['CPU', 'CPD'] as const).flatMap((clock) => [
      checks.recovery({
        pin: 'PL',
        active: 'low',
        clock,
        edge: 'rise',
        recovery: 'trec(PL to CPU, CPD)',
      }),
      checks.recovery({
        pin: 'MR',
        active: 'high',
        clock,
        edge: 'rise',
        recovery: 'trec(MR to CPU, CPD)',
      }),
    ]);
    const { up, down } = scratch();
    const next = [Level.X, Level.X, Level.X, Level.X];

    const evaluate = (ctx: EvalContext<UpDownCounterState>) => {
      const state = ctx.state;
      const { q, beforeEdge, beforeReset, times } = state;
      const mr = toInput(ctx.read(reset));
      const pl = toInput(ctx.read(load));
      const loadArmed = mr !== Level.L1;
      const armed = loadArmed && pl !== Level.L0;
      const uncertainData =
        dataCheck.setup(ctx, times, loadArmed) | dataCheck.hold(ctx, times, loadArmed);
      const shortReset = resetWidth.check(ctx, times);
      const shortLoad = loadWidth.check(ctx, times, loadArmed);
      // Recovery matters only for a clock the counter acts on (not held by MR or PL̅).
      let recovering = false;
      for (let i = 0; armed && i < recoveries.length; i++) {
        recovering = recoveries[i]!.check(ctx, times) || recovering;
      }
      const upLevel = toInput(ctx.read(cpu));
      const downLevel = toInput(ctx.read(cpd));
      const early =
        downHeld.hold(ctx, times, armed && upLevel === Level.L1) |
        upHeld.hold(ctx, times, armed && downLevel === Level.L1);
      const shortUp = upWidth.check(ctx, times, armed);
      const shortDown = downWidth.check(ctx, times, armed);
      const upEdge = clockEdge(ctx, cpu, 'rise');
      const downEdge = clockEdge(ctx, cpd, 'rise');
      const loadStarts = ctx.changed(load) && toInput(ctx.prev(load)) === Level.L1;
      const resetStarts = ctx.changed(reset) && toInput(ctx.prev(reset)) === Level.L0;

      if ((upEdge !== ClockEdge.NONE || downEdge !== ClockEdge.NONE) && armed) {
        let uncertain = upEdge === ClockEdge.UNCERTAIN || downEdge === ClockEdge.UNCERTAIN;
        if (upEdge !== ClockEdge.NONE && downEdge !== ClockEdge.NONE) {
          ctx.report({
            kind: TimingViolation.HOLD,
            message:
              'CPU and CPD rose at the same time (one clock must stay HIGH while the other counts)',
            pin: cpu,
          });
          countInto(q, true, up);
          countInto(q, false, down);
          mergeInto(next, up, true);
          mergeInto(next, down, false);
        } else {
          const counting = upEdge !== ClockEdge.NONE;
          const other = counting ? downLevel : upLevel;
          countInto(q, counting, next);
          if (other !== Level.L1) {
            // The logic diagram's chains count partially: X where counting or not differ.
            uncertain = true;
            if (other === Level.L0) {
              const name = counting ? 'CPU' : 'CPD';
              const otherName = counting ? 'CPD' : 'CPU';
              ctx.report({
                kind: TimingViolation.HOLD,
                message: `${name} rose while ${otherName} was LOW (${otherName} must stay HIGH while ${name} counts)`,
                pin: counting ? cpd : cpu,
              });
            }
          }
        }
        const active = upEdge === ClockEdge.ACTIVE || downEdge === ClockEdge.ACTIVE;
        for (let n = 0; n < BITS; n++) {
          const was = q[n]!;
          q[n] = uncertain || shortUp || shortDown || recovering ? either(was, next[n]!) : next[n]!;
          if (active) beforeEdge[n] = was;
        }
      } else if (early !== 0 || shortUp || shortDown) {
        for (let n = 0; n < BITS; n++) q[n] = either(q[n]!, beforeEdge[n]!);
      }

      for (let n = 0; n < BITS; n++) if (resetStarts) beforeReset[n] = q[n]!;
      if (mr !== Level.L1) applyLoad(ctx, data, pl, uncertainData, shortLoad, loadStarts);
      for (let n = 0; n < BITS; n++) {
        if (mr === Level.L1) q[n] = Level.L0;
        else if (mr !== Level.L0) q[n] = either(q[n]!, Level.L0);
        if (shortReset) q[n] = either(q[n]!, beforeReset[n]!);
        const out = outputs[n]!;
        ctx.drive(out, strong(q[n]!), paths.delay(ctx, out));
      }
      ctx.drive(tcu, strong(not(and(allAt(q, Level.L1), not(upLevel)))), paths.delay(ctx, tcu));
      ctx.drive(tcd, strong(not(and(allAt(q, Level.L0), not(downLevel)))), paths.delay(ctx, tcd));
      checks.track(ctx, times);
    };

    return () => ({ createState: () => createState(checks), evaluate });
  };
}

const KEYWORDS = ['counter', 'binary', 'up/down', 'up-down', 'presettable', 'synchronous'];
const DATA_PINS = [
  pins('D0, D1, D2, D3', '15, 1, 10, 9', 'in', 'data input'),
  pins(Q4, '3, 2, 6, 7', 'out', 'flip-flop output'),
  pins('GND', '8', 'power', 'ground (0 V)'),
  pins('VCC', '16', 'power', 'supply voltage'),
];

export const CNT191_SPEC: UpDownCounterSpec = {
  number: '191',
  title: 'Presettable synchronous 4-bit binary up/down counter',
  keywords: [...KEYWORDS, 'ripple clock', 'terminal count'],
  pinCount: 16,
  pins: [
    ...DATA_PINS,
    pins('CE', '4', 'in', 'count enable input (active LOW)', { activeLow: true }),
    pins('UD', '5', 'in', 'up/down input (LOW: count up, HIGH: count down)', { label: 'U̅/D' }),
    pins('PL', '11', 'in', 'parallel load input (active LOW)', { activeLow: true }),
    pins('TC', '12', 'out', 'terminal count output'),
    pins('RC', '13', 'out', 'ripple clock output (active LOW)', { activeLow: true }),
    pins('CP', '14', 'in', 'clock input (LOW-to-HIGH, edge-triggered)', { clock: true }),
  ],
  functionTable: {
    inputs: ['PL', 'UD', 'CE', 'CP', 'Dn'],
    outputs: ['Qn'],
    rows: [
      'L X X X L | L',
      'L X X X H | H',
      'H L l ↑ X | count-up',
      'H H l ↑ X | count-down',
      'H X H X X | qn',
    ],
    note: 'each flip-flop (n = 0 to 3): parallel load, count up, count down, hold (qn: no change). TC is HIGH at 15 counting up and at 0 counting down; RC̅ follows CP while CE̅ is LOW and TC is HIGH (table 4)',
    state: { qn: 'Qn' },
  },
  paths: [
    { from: 'CP', to: Q4, delay: 'tpd(CP to Qn)' },
    { from: 'D0, D1, D2, D3', to: Q4, delay: 'tpd(Dn to Qn)' },
    { from: 'PL', to: Q4, delay: 'tpd(PL to Qn)' },
    { from: 'CP', to: 'TC', delay: 'tpd(CP to TC)' },
    { from: 'UD', to: 'TC', delay: 'tpd(UD to TC)' },
    { from: 'CP', to: 'RC', delay: 'tpd(CP to RC)' },
    { from: 'CE', to: 'RC', delay: 'tpd(CE to RC)' },
    { from: 'UD', to: 'RC', delay: 'tpd(UD to RC)' },
    // The data sheet gives no delay from a parallel load to TC or RC̅: the Qn delay is used.
    { from: 'D0, D1, D2, D3', to: 'TC, RC', delay: 'tpd(Dn to Qn)' },
    { from: 'PL', to: 'TC, RC', delay: 'tpd(PL to Qn)' },
  ],
};

export const CNT193_SPEC: UpDownCounterSpec = {
  number: '193',
  title: 'Presettable synchronous 4-bit binary up/down counter',
  keywords: [...KEYWORDS, 'dual clock', 'carry', 'borrow', 'reset'],
  pinCount: 16,
  pins: [
    ...DATA_PINS,
    pins('CPD', '4', 'in', 'count down clock input; LOW-to-HIGH, edge triggered', { clock: true }),
    pins('CPU', '5', 'in', 'count up clock input; LOW-to-HIGH, edge triggered', { clock: true }),
    pins('PL', '11', 'in', 'asynchronous parallel load input (active LOW)', { activeLow: true }),
    pins('TCU', '12', 'out', 'terminal count up (carry) output (active LOW)', { activeLow: true }),
    pins('TCD', '13', 'out', 'terminal count down (borrow) output (active LOW)', {
      activeLow: true,
    }),
    pins('MR', '14', 'in', 'asynchronous master reset input (active HIGH)'),
  ],
  functionTable: {
    inputs: ['MR', 'PL', 'CPU', 'CPD', 'D0', 'D1', 'D2', 'D3'],
    outputs: ['Q0', 'Q1', 'Q2', 'Q3', 'TCU', 'TCD'],
    rows: [
      'H X X L X X X X | L L L L H L',
      'H X X H X X X X | L L L L H H',
      'L L X L L L L L | L L L L H L',
      'L L X H L L L L | L L L L H H',
      'L L L X H H H H | H H H H L H',
      'L L H X H H H H | H H H H H H',
      'L H ↑ H X X X X | count-up count-up count-up count-up H H',
      'L H H ↑ X X X X | count-down count-down count-down count-down H H',
    ],
    note: 'reset (clear), parallel load, count up, count down. TC̅U = CPU at terminal count up (HHHH); TC̅D = CPD at terminal count down (LLLL)',
  },
  paths: [
    { from: 'CPU, CPD', to: Q4, delay: 'tpd(CPU, CPD to Qn)' },
    { from: 'PL', to: Q4, delay: 'tpd(PL to Qn)' },
    { from: 'MR', to: Q4, delay: 'tpd(MR to Qn)' },
    { from: 'D0, D1, D2, D3', to: Q4, delay: 'tpd(Dn to Qn)' },
    { from: 'CPU', to: 'TCU', delay: 'tpd(CPU to TCU)' },
    { from: 'CPD', to: 'TCD', delay: 'tpd(CPD to TCD)' },
    { from: 'PL', to: 'TCU, TCD', delay: 'tpd(PL to TCU, TCD)' },
    { from: 'MR', to: 'TCU, TCD', delay: 'tpd(MR to TCU, TCD)' },
    { from: 'D0, D1, D2, D3', to: 'TCU, TCD', delay: 'tpd(Dn to TCU, TCD)' },
    // A count with the other clock LOW (a hold violation) can change the other terminal count;
    // the data sheet gives no such path: the clock-to-Qn delay is used.
    { from: 'CPD', to: 'TCU', delay: 'tpd(CPU, CPD to Qn)' },
    { from: 'CPU', to: 'TCD', delay: 'tpd(CPU, CPD to Qn)' },
  ],
};

/** The up/down counters of a family. */
export function upDownCounterChips(family: LogicFamily): AnyComponentDefinition[] {
  return [
    chipDefinition(CNT191_SPEC, family, counter191Behavior(CNT191_SPEC)),
    chipDefinition(CNT193_SPEC, family, counter193Behavior(CNT193_SPEC)),
  ];
}

/** 74HC191, 193. */
export const hcUpDownCounters = upDownCounterChips(HC);
