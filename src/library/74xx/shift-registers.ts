/**
 * 8-bit shift registers: 74xx164 (serial in, parallel out), 165 (parallel or serial in, serial
 * out), 595 (serial in, a storage register, 3-state parallel out). Pinouts and function tables transcribed from the Nexperia data sheets; timing and its
 * requirements in `hc-timing.ts`. Spec: docs/components.md#counters-and-shift-registers.
 */
import {
  type AnyComponentDefinition,
  and,
  Drive,
  type EvalContext,
  Level,
  not,
  or,
  type PinRef,
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
import { ClockEdge, clockEdge, couldBe, either } from './edge-triggered';
import { HC } from './hc-timing';
import { type DelayPath, pathDelays } from './paths';
import { pins } from './pinout';

/** A shift register chip; the behavior is its own, the spec adds the delay paths. */
export interface ShiftRegisterSpec extends ChipSpec {
  readonly paths: readonly DelayPath[];
}

/** State of a shift register: its stages, Q0 (the serial input's end) first. */
export interface ShiftRegisterState {
  /** The stages; `X` until reset or loaded. */
  q: Level[];
  /** The stages before the last shift, and before the last reset or parallel load began. */
  beforeEdge: Level[];
  beforeAsync: Level[];
  times: PinTimes;
}

const STAGES = 8;
const D8 = 'D0, D1, D2, D3, D4, D5, D6, D7';
const Q8 = 'Q0, Q1, Q2, Q3, Q4, Q5, Q6, Q7';

const unknown = () => Array.from({ length: STAGES }, () => Level.X);

function createState(checks: TimingChecks): ShiftRegisterState {
  return {
    q: unknown(),
    beforeEdge: unknown(),
    beforeAsync: unknown(),
    times: checks.createTimes(),
  };
}

/**
 * One shift of `q` into `q` itself, `serial` entering stage 0; or, `unsure`, each stage merged
 * with its shifted value (an uncertain edge, a short clock phase, a recovery violation).
 * Records the stages before the shift for an active edge.
 */
function shift(state: ShiftRegisterState, serial: Level, unsure: boolean, active: boolean): void {
  const { q, beforeEdge } = state;
  let incoming = serial;
  for (let n = 0; n < STAGES; n++) {
    const was = q[n]!;
    q[n] = unsure ? either(was, incoming) : incoming;
    if (active) beforeEdge[n] = was;
    incoming = was;
  }
}

/** Merges every stage with its value before the last shift (inputs moved too soon after it). */
function undoUncertain(state: ShiftRegisterState): void {
  for (let n = 0; n < STAGES; n++) state.q[n] = either(state.q[n]!, state.beforeEdge[n]!);
}

/**
 * An asynchronous clear (164: MR̅ LOW) or parallel load (165: PL̅ LOW, transparent) of every
 * stage from `values` (`null`: zeros), with the timing: `uncertain` stages (data that moved
 * around PL̅ rising) are `X`; a short pulse makes `X` the stages it changed.
 */
function applyAsync(
  ctx: EvalContext<ShiftRegisterState>,
  pin: PinRef,
  values: Int32Array | null,
  uncertain: number,
  short: boolean,
): void {
  const { q, beforeAsync } = ctx.state;
  const level = toInput(ctx.read(pin));
  const starts = ctx.changed(pin) && toInput(ctx.prev(pin)) === Level.L1;
  for (let n = 0; n < STAGES; n++) {
    if (starts) beforeAsync[n] = q[n]!;
    if (level !== Level.L1) {
      const d = values ? toInput(ctx.read(values[n]!)) : Level.L0;
      q[n] = level === Level.L0 ? d : either(q[n]!, d);
    }
    if ((uncertain >> n) & 1) q[n] = Level.X;
    if (short) q[n] = either(q[n]!, beforeAsync[n]!);
  }
}

/**
 * 74xx164: on the rising CP edge every stage takes the one before it and Q0 takes DSA · DSB
 * (either input gates the other); MR̅ LOW clears at once and disarms the clock's checks. A late
 * serial input shifts in `X` where it could change the AND; one that changes within the hold
 * time makes Q0 `X` if the new AND differs.
 */
export function sipoBehavior(spec: ShiftRegisterSpec): ChipBehavior<ShiftRegisterState> {
  return (pinList, delays, min) => {
    const checks = new TimingChecks(pinList, min);
    const outputs = pinIndices(pinList, Q8);
    const clock = pinIndex(pinList, 'CP');
    const reset = pinIndex(pinList, 'MR');
    const dsa = pinIndex(pinList, 'DSA');
    const dsb = pinIndex(pinList, 'DSB');
    const paths = pathDelays(pinList, delays, spec.paths);
    const dataCheck = checks.setupHold({
      data: 'DSA, DSB',
      clock: 'CP',
      edge: 'rise',
      setup: 'tsu(DSA, DSB to CP)',
      hold: 'th(DSA, DSB to CP)',
    });
    const clockWidth = checks.pulseWidth({ pin: 'CP', level: 'both', width: 'tW(CP)' });
    const resetWidth = checks.pulseWidth({ pin: 'MR', level: 'low', width: 'tW(MR)' });
    const recovery = checks.recovery({
      pin: 'MR',
      active: 'low',
      clock: 'CP',
      edge: 'rise',
      recovery: 'trec(MR to CP)',
    });

    const evaluate = (ctx: EvalContext<ShiftRegisterState>) => {
      const state = ctx.state;
      const { q, times } = state;
      const armed = toInput(ctx.read(reset)) !== Level.L0;
      const late = dataCheck.setup(ctx, times, armed);
      const early = dataCheck.hold(ctx, times, armed);
      const shortClock = clockWidth.check(ctx, times, armed);
      const shortReset = resetWidth.check(ctx, times);
      const recovering = recovery.check(ctx, times);
      const edge = clockEdge(ctx, clock, 'rise');

      if (edge !== ClockEdge.NONE && armed) {
        const a = late & 1 ? Level.X : toInput(ctx.read(dsa));
        const b = late & 2 ? Level.X : toInput(ctx.read(dsb));
        const unsure = edge === ClockEdge.UNCERTAIN || shortClock || recovering;
        shift(state, and(a, b), unsure, edge === ClockEdge.ACTIVE);
      } else {
        if (shortClock) undoUncertain(state);
        if (early !== 0) q[0] = either(q[0]!, and(toInput(ctx.read(dsa)), toInput(ctx.read(dsb))));
      }
      applyAsync(ctx, reset, null, 0, shortReset);

      for (let n = 0; n < STAGES; n++) {
        const out = outputs[n]!;
        ctx.drive(out, strong(q[n]!), paths.delay(ctx, out));
      }
      checks.track(ctx, times);
    };

    return () => ({ createState: () => createState(checks), evaluate });
  };
}

/**
 * 74xx165: PL̅ LOW loads D0–D7 (asynchronous, transparent; a data bit that moved around PL̅
 * rising is `X`); else a rising edge of the internal clock CP + CE̅ (the data sheet's ≥1: the
 * two pins are interchangeable) shifts, DS entering Q0. Only Q7 and Q̅7 are outputs. Each clock
 * pin has set-up and hold to the other (it must be LOW, enabling, around the other's edge): a
 * breach makes `X` the stages the edge would change.
 */
export function pisoBehavior(spec: ShiftRegisterSpec): ChipBehavior<ShiftRegisterState> {
  return (pinList, delays, min) => {
    const checks = new TimingChecks(pinList, min);
    const data = pinIndices(pinList, D8);
    const q7 = pinIndex(pinList, 'Q7');
    const q7n = pinIndex(pinList, 'Q7N');
    const clock = pinIndex(pinList, 'CP');
    const enable = pinIndex(pinList, 'CE');
    const serial = pinIndex(pinList, 'DS');
    const load = pinIndex(pinList, 'PL');
    const paths = pathDelays(pinList, delays, spec.paths);
    const hold = 'th(DS to CP, CE and Dn to PL)';
    const loadCheck = checks.setupHold({
      data: D8,
      clock: 'PL',
      edge: 'rise',
      setup: 'tsu(Dn to PL)',
      hold,
    });
    // The serial input to each clock pin, and each clock pin to the other.
    const serialTo = (pin: string) =>
      checks.setupHold({ data: 'DS', clock: pin, edge: 'rise', setup: 'tsu(DS to CP, CE)', hold });
    const gate = (data: string, pin: string) =>
      checks.setupHold({
        data,
        clock: pin,
        edge: 'rise',
        setup: 'tsu(CE to CP, CP to CE)',
        hold: 'th(CE to CP, CP to CE)',
      });
    const serialToClock = serialTo('CP');
    const serialToEnable = serialTo('CE');
    const enableToClock = gate('CE', 'CP');
    const clockToEnable = gate('CP', 'CE');
    const clockWidth = checks.pulseWidth({ pin: 'CP', level: 'both', width: 'tW(CP)' });
    const loadWidth = checks.pulseWidth({ pin: 'PL', level: 'low', width: 'tW(PL)' });
    const recoveryTo = (pin: string) =>
      checks.recovery({
        pin: 'PL',
        active: 'low',
        clock: pin,
        edge: 'rise',
        recovery: 'trec(PL to CP, CE)',
      });
    const clockRecovery = recoveryTo('CP');
    const enableRecovery = recoveryTo('CE');

    const evaluate = (ctx: EvalContext<ShiftRegisterState>) => {
      const state = ctx.state;
      const { q, times } = state;
      const pl = toInput(ctx.read(load));
      const armed = pl !== Level.L0;
      const cp = toInput(ctx.read(clock));
      const ce = toInput(ctx.read(enable));
      // CP's rise clocks only while CE̅ is LOW, and CE̅'s only while CP is LOW.
      const byClock = armed && couldBe(ce, Level.L0);
      const byEnable = armed && couldBe(cp, Level.L0);
      const uncertainData = loadCheck.setup(ctx, times) | loadCheck.hold(ctx, times);
      const shortLoad = loadWidth.check(ctx, times);
      let recovering = false;
      if (byClock) recovering = clockRecovery.check(ctx, times);
      if (byEnable) recovering = enableRecovery.check(ctx, times) || recovering;
      const lateSerial =
        serialToClock.setup(ctx, times, byClock) | serialToEnable.setup(ctx, times, byEnable);
      const earlySerial =
        serialToClock.hold(ctx, times, byClock) | serialToEnable.hold(ctx, times, byEnable);
      const lateGate =
        enableToClock.setup(ctx, times, byClock) | clockToEnable.setup(ctx, times, byEnable);
      // The enabling pin going HIGH too soon after the other's edge.
      const earlyGate =
        enableToClock.hold(ctx, times, armed && ce !== Level.L0) |
        clockToEnable.hold(ctx, times, armed && cp !== Level.L0);
      const shortClock = clockWidth.check(ctx, times, byClock);

      // The internal clock CP + CE̅ rising.
      let edge: ClockEdge = ClockEdge.NONE;
      if (ctx.changed(clock) || ctx.changed(enable)) {
        const was = or(toInput(ctx.prev(clock)), toInput(ctx.prev(enable)));
        const now = or(cp, ce);
        if (was === Level.L0 && now === Level.L1) edge = ClockEdge.ACTIVE;
        else if (couldBe(was, Level.L0) && couldBe(now, Level.L1)) edge = ClockEdge.UNCERTAIN;
      }

      if (edge !== ClockEdge.NONE && armed) {
        const ds = lateSerial ? Level.X : toInput(ctx.read(serial));
        const unsure = edge === ClockEdge.UNCERTAIN || shortClock || recovering || lateGate !== 0;
        shift(state, ds, unsure, edge === ClockEdge.ACTIVE);
      } else {
        if (shortClock || earlyGate !== 0) undoUncertain(state);
        if (earlySerial !== 0) q[0] = either(q[0]!, toInput(ctx.read(serial)));
      }
      applyAsync(ctx, load, data, uncertainData, shortLoad);

      ctx.drive(q7, strong(q[7]!), paths.delay(ctx, q7));
      ctx.drive(q7n, strong(not(q[7]!)), paths.delay(ctx, q7n));
      checks.track(ctx, times);
    };

    return () => ({ createState: () => createState(checks), evaluate });
  };
}

/** State of a shift register with a storage register (595). */
export interface StorageShiftRegisterState extends ShiftRegisterState {
  /** The storage register, driving the parallel outputs; `X` until a store. */
  storage: Level[];
  /** The storage register before its last clock edge (timing checks). */
  beforeStore: Level[];
  /** When the shift register last shifted (SHCP and STCP at the same instant: one behind). */
  shiftedAt: number;
}

/**
 * 74xx595: a rising SHCP shifts DS into the shift register (MR̅ LOW clears it, asynchronous, and
 * disarms SHCP's checks); a rising STCP copies the shift register into the storage register,
 * which drives Q0–Q7 while OE̅ is LOW (`ten`/`tdis`; an unknown OE̅ drives `X`). Q7S is the shift
 * register's last stage, always driven, for cascading. With both clocks rising at the same
 * instant the storage register takes the shift register from before the shift (the data sheet's
 * "one clock pulse behind"); STCP rising later but within `tsu(SHCP to STCP)` is a set-up
 * violation, and the stages where the old and new contents differ store `X`.
 */
export function storageShiftRegisterBehavior(
  spec: ShiftRegisterSpec,
): ChipBehavior<StorageShiftRegisterState> {
  return (pinList, delays, min) => {
    const checks = new TimingChecks(pinList, min);
    const outputs = pinIndices(pinList, Q8);
    const serialOut = pinIndex(pinList, 'Q7S');
    const shiftClock = pinIndex(pinList, 'SHCP');
    const storeClock = pinIndex(pinList, 'STCP');
    const reset = pinIndex(pinList, 'MR');
    const outputEnable = pinIndex(pinList, 'OE');
    const serial = pinIndex(pinList, 'DS');
    const paths = pathDelays(pinList, delays, spec.paths);
    const ten = delay(delays, 'ten(OE to Qn)');
    const tdis = delay(delays, 'tdis(OE to Qn)');
    const dataCheck = checks.setupHold({
      data: 'DS',
      clock: 'SHCP',
      edge: 'rise',
      setup: 'tsu(DS to SHCP)',
      hold: 'th(DS to SHCP)',
    });
    const storeCheck = checks.setupHold({
      data: 'SHCP',
      clock: 'STCP',
      edge: 'rise',
      setup: 'tsu(SHCP to STCP)',
      dataEdge: 'rise',
      sameInstantAllowed: true,
    });
    const shiftWidth = checks.pulseWidth({ pin: 'SHCP', level: 'both', width: 'tW(SHCP)' });
    const storeWidth = checks.pulseWidth({ pin: 'STCP', level: 'both', width: 'tW(STCP)' });
    const resetWidth = checks.pulseWidth({ pin: 'MR', level: 'low', width: 'tW(MR)' });
    const recovery = checks.recovery({
      pin: 'MR',
      active: 'low',
      clock: 'SHCP',
      edge: 'rise',
      recovery: 'trec(MR to SHCP)',
    });

    const evaluate = (ctx: EvalContext<StorageShiftRegisterState>) => {
      const state = ctx.state;
      const { q, beforeEdge, storage, beforeStore, times } = state;
      const armed = toInput(ctx.read(reset)) !== Level.L0;
      const late = dataCheck.setup(ctx, times, armed);
      const early = dataCheck.hold(ctx, times, armed);
      const lateShift = storeCheck.setup(ctx, times, armed);
      const shortShift = shiftWidth.check(ctx, times, armed);
      const shortStore = storeWidth.check(ctx, times);
      const shortReset = resetWidth.check(ctx, times);
      const recovering = recovery.check(ctx, times);
      const storeEdge = clockEdge(ctx, storeClock, 'rise');
      const shiftEdge = clockEdge(ctx, shiftClock, 'rise');

      // The storage register first: it takes the shift register before this instant's shift.
      if (storeEdge !== ClockEdge.NONE) {
        const behind = state.shiftedAt === ctx.now;
        const unsure = storeEdge === ClockEdge.UNCERTAIN || shortStore;
        for (let n = 0; n < STAGES; n++) {
          const was = storage[n]!;
          let value = behind ? beforeEdge[n]! : q[n]!;
          if (lateShift) value = either(beforeEdge[n]!, q[n]!);
          storage[n] = unsure ? either(was, value) : value;
          if (storeEdge === ClockEdge.ACTIVE) beforeStore[n] = was;
        }
      } else if (shortStore) {
        for (let n = 0; n < STAGES; n++) storage[n] = either(storage[n]!, beforeStore[n]!);
      }

      if (shiftEdge !== ClockEdge.NONE && armed) {
        const ds = late ? Level.X : toInput(ctx.read(serial));
        const unsure = shiftEdge === ClockEdge.UNCERTAIN || shortShift || recovering;
        shift(state, ds, unsure, shiftEdge === ClockEdge.ACTIVE);
        state.shiftedAt = ctx.now;
      } else {
        if (shortShift) undoUncertain(state);
        if (early !== 0) q[0] = either(q[0]!, toInput(ctx.read(serial)));
      }
      applyAsync(ctx, reset, null, 0, shortReset);

      const enabled = toInput(ctx.read(outputEnable));
      const enableChanged = ctx.changed(outputEnable);
      for (let n = 0; n < STAGES; n++) {
        const out = outputs[n]!;
        if (enabled === Level.L1) ctx.drive(out, Drive.Z, tdis);
        else {
          const level = enabled === Level.L0 ? storage[n]! : Level.X;
          ctx.drive(out, strong(level), enableChanged ? ten : paths.delay(ctx, out));
        }
      }
      ctx.drive(serialOut, strong(q[7]!), paths.delay(ctx, serialOut));
      checks.track(ctx, times);
    };

    return () => ({
      createState: () => ({
        ...createState(checks),
        storage: unknown(),
        beforeStore: unknown(),
        shiftedAt: -Infinity,
      }),
      evaluate,
    });
  };
}

const KEYWORDS = ['shift register', 'serial', 'parallel', 'register'];

export const SR164_SPEC: ShiftRegisterSpec = {
  number: '164',
  title: '8-bit serial-in, parallel-out shift register',
  keywords: [...KEYWORDS, 'sipo', 'serial-in', 'parallel-out', 'output expander'],
  pinCount: 14,
  pins: [
    pins('DSA, DSB', '1, 2', 'in', 'data input'),
    pins(Q8, '3, 4, 5, 6, 10, 11, 12, 13', 'out', 'output'),
    pins('GND', '7', 'power', 'ground (0 V)'),
    pins('CP', '8', 'in', 'clock input (LOW-to-HIGH, edge-triggered)', { clock: true }),
    pins('MR', '9', 'in', 'master reset input (active LOW)', { activeLow: true }),
    pins('VCC', '14', 'power', 'positive supply voltage'),
  ],
  functionTable: {
    inputs: ['MR', 'CP', 'DSA', 'DSB'],
    outputs: ['Q0', 'Q1–Q7'],
    rows: [
      'L X X X | L L',
      'H ↑ l l | L q0–q6',
      'H ↑ l h | L q0–q6',
      'H ↑ h l | L q0–q6',
      'H ↑ h h | H q0–q6',
    ],
    note: 'reset (clear), shift; q0–q6: the previous Q0 to Q6 (Q1 to Q7 take them)',
  },
  paths: [
    { from: 'CP', to: Q8, delay: 'tpd(CP to Qn)' },
    { from: 'MR', to: Q8, delay: 'tPHL(MR to Qn)' },
  ],
};

export const SR165_SPEC: ShiftRegisterSpec = {
  number: '165',
  title: '8-bit parallel-in/serial out shift register',
  keywords: [...KEYWORDS, 'piso', 'parallel-in', 'serial-out', 'input expander', 'keyboard'],
  pinCount: 16,
  pins: [
    pins('PL', '1', 'in', 'asynchronous parallel load input (active LOW)', { activeLow: true }),
    pins('CP', '2', 'in', 'clock input (LOW-to-HIGH edge-triggered)', { clock: true }),
    pins('D4, D5, D6, D7', '3, 4, 5, 6', 'in', 'parallel data input'),
    pins('Q7N', '7', 'out', 'complementary output from the last stage', {
      activeLow: true,
      label: 'Q7',
    }),
    pins('GND', '8', 'power', 'ground (0 V)'),
    pins('Q7', '9', 'out', 'serial output from the last stage'),
    pins('DS', '10', 'in', 'serial data input'),
    pins('D0, D1, D2, D3', '11, 12, 13, 14', 'in', 'parallel data input'),
    pins('CE', '15', 'in', 'clock enable input (active LOW)', { activeLow: true }),
    pins('VCC', '16', 'power', 'positive supply voltage'),
  ],
  functionTable: {
    inputs: ['PL', 'CE', 'CP', 'DS', 'D0–D7'],
    outputs: ['Q0', 'Q1–Q6', 'Q7', 'Q7N'],
    rows: [
      'L X X X L | L L L H',
      'L X X X H | H H H L',
      'H L ↑ l X | L q0–q5 q6 q̅6',
      'H L ↑ h X | H q0–q5 q6 q̅6',
      'H ↑ L l X | L q0–q5 q6 q̅6',
      'H ↑ L h X | H q0–q5 q6 q̅6',
      'H H X X X | q0 q1–q6 q7 q̅7',
      'H X H X X | q0 q1–q6 q7 q̅7',
    ],
    note: 'parallel load, serial shift (CP and CE̅ interchangeable), hold "do nothing"; Q0 to Q6 are the internal stages; q: a stage before the row',
    state: { q7: 'Q7' },
  },
  paths: [
    { from: 'CP, CE', to: 'Q7, Q7N', delay: 'tpd(CP, CE to Q7, Q7N)' },
    { from: 'PL', to: 'Q7, Q7N', delay: 'tpd(PL to Q7, Q7N)' },
    { from: 'D7', to: 'Q7, Q7N', delay: 'tpd(D7 to Q7, Q7N)' },
  ],
};

export const SR595_SPEC: ShiftRegisterSpec = {
  number: '595',
  title: '8-bit serial-in, serial or parallel-out shift register with output latches; 3-state',
  keywords: [...KEYWORDS, 'sipo', 'latch', 'storage register', 'output expander', '3-state'],
  pinCount: 16,
  pins: [
    pins('Q1, Q2, Q3, Q4, Q5, Q6, Q7', '1, 2, 3, 4, 5, 6, 7', 'tristate', 'parallel data output'),
    pins('GND', '8', 'power', 'ground (0 V)'),
    pins('Q7S', '9', 'out', 'serial data output'),
    pins('MR', '10', 'in', 'master reset (active LOW)', { activeLow: true }),
    pins('SHCP', '11', 'in', 'shift register clock input', { clock: true }),
    pins('STCP', '12', 'in', 'storage register clock input', { clock: true }),
    pins('OE', '13', 'in', 'output enable input (active LOW)', { activeLow: true }),
    pins('DS', '14', 'in', 'serial data input'),
    pins('Q0', '15', 'tristate', 'parallel data output 0'),
    pins('VCC', '16', 'power', 'supply voltage'),
  ],
  functionTable: {
    inputs: ['SHCP', 'STCP', 'OE', 'MR', 'DS'],
    outputs: ['Q7S', 'Qn'],
    rows: [
      'X X L L X | L NC',
      'X ↑ L L X | L L',
      'X X H L X | L Z',
      '↑ X L H H | Q6S NC',
      'X ↑ L H X | NC QnS',
      '↑ ↑ L H X | Q6S QnS',
    ],
    note: 'MR̅ LOW clears the shift register only (STCP ↑ then stores it empty); OE̅ HIGH: outputs in the high-impedance OFF-state; SHCP ↑ shifts DS into stage 0 and stage 6 (Q6S) on to Q7S; STCP ↑ stores the shift register stages (QnS); both together: the contents from before the shift are stored. NC: no change',
  },
  paths: [
    { from: 'STCP', to: Q8, delay: 'tpd(STCP to Qn)' },
    { from: 'SHCP', to: 'Q7S', delay: 'tpd(SHCP to Q7S)' },
    { from: 'MR', to: 'Q7S', delay: 'tPHL(MR to Q7S)' },
  ],
};

/** The shift registers of a family. */
export function shiftRegisterChips(family: LogicFamily): AnyComponentDefinition[] {
  return [
    chipDefinition(SR164_SPEC, family, sipoBehavior(SR164_SPEC)),
    chipDefinition(SR165_SPEC, family, pisoBehavior(SR165_SPEC)),
    chipDefinition(SR595_SPEC, family, storageShiftRegisterBehavior(SR595_SPEC)),
  ];
}

/** 74HC164, 165, 595. */
export const hcShiftRegisters = shiftRegisterChips(HC);
