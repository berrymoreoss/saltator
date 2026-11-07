/**
 * D-type registers with a common clock: 74xx175, 273 (master reset), 377 (data enable), 173
 * (data enables, master reset, 3-state), 374, 574 (3-state). Pinouts and function tables
 * transcribed from the Nexperia data sheets; timing and its requirements in `hc-timing.ts`.
 * Spec: docs/components.md#edge-triggered-chips.
 */
import {
  type AnyComponentDefinition,
  Drive,
  type EvalContext,
  Level,
  type PinTimes,
  type PulseWidthCheck,
  pinIndex,
  type RecoveryCheck,
  type SetupHoldCheck,
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
import { ClockEdge, clockEdge, complement, either } from './edge-triggered';
import { HC } from './hc-timing';
import { type DelayPath, pathDelays } from './paths';
import { pins } from './pinout';

/** A register chip: data inputs and outputs per bit, a rising-edge clock `CP`, and options. */
export interface RegisterSpec extends ChipSpec {
  /** Comma-separated data inputs and true outputs, bit 0 first; complement outputs (175). */
  readonly data: string;
  readonly outputs: string;
  readonly complements?: string;
  /** Keys of the data inputs' set-up and hold times and of the clock pulse width. */
  readonly setup: string;
  readonly hold: string;
  readonly clockWidth: string;
  /** Asynchronous master reset `MR`: its active level and timing keys. */
  readonly reset?: {
    readonly active: 'high' | 'low';
    readonly width: string;
    readonly recovery: string;
  };
  /** Data enables (active LOW, all LOW to load) with their set-up and hold keys. */
  readonly enable?: { readonly pins: string; readonly setup: string; readonly hold: string };
  /** Output enables (active LOW, all LOW to drive) with the `ten` and `tdis` keys. */
  readonly outputEnable?: { readonly pins: string; readonly ten: string; readonly tdis: string };
  /** Delay paths of the outputs: from CP, from MR. */
  readonly paths: readonly DelayPath[];
}

/** State of a register chip, per bit. */
export interface RegisterState {
  /** The stored bits; `X` until reset or loaded. */
  q: Level[];
  /** The bits before the last active edge, and before the last reset began (timing checks). */
  beforeEdge: Level[];
  beforeReset: Level[];
  times: PinTimes;
}

/** All of `pins` at `active` (`L1`), any at the other level (`L0`), else `X`. */
function allActiveLow(ctx: EvalContext<unknown>, pinList: Int32Array): Level {
  let all: Level = Level.L1;
  for (let i = 0; i < pinList.length; i++) {
    const level = toInput(ctx.read(pinList[i]!));
    if (level === Level.L1) return Level.L0;
    if (level !== Level.L0) all = Level.X;
  }
  return all;
}

/**
 * Every bit, on every call: an active clock edge loads D (when the data enables allow; an
 * unknown enable loads `X` where D differs from the stored bit), an uncertain edge makes `X`
 * where a load would change the bit, the master reset clears it. Timing checks make the bits the
 * edge may have loaded `X` (see `flipFlopBehavior`): a late data bit itself; a late or early
 * enable where loading or not differ; a short clock phase or a recovery violation where the edge
 * would change or changed the bit; a short reset pulse where it changed the bit. The clock's
 * checks apply while the reset isn't (surely) active, the data's while loading is possible.
 * 3-state outputs follow the output enables after `ten`/`tdis` (an unknown enable drives `X`).
 */
export function registerBehavior(spec: RegisterSpec): ChipBehavior<RegisterState> {
  return (pinList, delays, min) => {
    const checks = new TimingChecks(pinList, min);
    const data = pinIndices(pinList, spec.data);
    const outputs = pinIndices(pinList, spec.outputs);
    const complements = spec.complements ? pinIndices(pinList, spec.complements) : null;
    const bits = data.length;
    const clock = pinIndex(pinList, 'CP');
    const reset = spec.reset ? pinIndex(pinList, 'MR') : -1;
    const resetActive = spec.reset?.active === 'high' ? Level.L1 : Level.L0;
    const enables = spec.enable ? pinIndices(pinList, spec.enable.pins) : new Int32Array(0);
    const outputEnables = spec.outputEnable
      ? pinIndices(pinList, spec.outputEnable.pins)
      : new Int32Array(0);
    const ten = spec.outputEnable ? delay(delays, spec.outputEnable.ten) : 0;
    const tdis = spec.outputEnable ? delay(delays, spec.outputEnable.tdis) : 0;
    // Output enables are timed by `ten`/`tdis` (as the 244), not by a path.
    const paths = pathDelays(pinList, delays, spec.paths);

    const dataCheck: SetupHoldCheck = checks.setupHold({
      data: spec.data,
      clock: 'CP',
      edge: 'rise',
      setup: spec.setup,
      hold: spec.hold,
    });
    const enableCheck: SetupHoldCheck | null = spec.enable
      ? checks.setupHold({
          data: spec.enable.pins,
          clock: 'CP',
          edge: 'rise',
          setup: spec.enable.setup,
          hold: spec.enable.hold,
        })
      : null;
    const clockWidth: PulseWidthCheck = checks.pulseWidth({
      pin: 'CP',
      level: 'both',
      width: spec.clockWidth,
    });
    const resetWidth: PulseWidthCheck | null = spec.reset
      ? checks.pulseWidth({ pin: 'MR', level: spec.reset.active, width: spec.reset.width })
      : null;
    const recovery: RecoveryCheck | null = spec.reset
      ? checks.recovery({
          pin: 'MR',
          active: spec.reset.active,
          clock: 'CP',
          edge: 'rise',
          recovery: spec.reset.recovery,
        })
      : null;

    const evaluate = (ctx: EvalContext<RegisterState>) => {
      const { q, beforeEdge, beforeReset, times } = ctx.state;
      const mr = reset < 0 ? complement(resetActive) : toInput(ctx.read(reset));
      const load = enables.length > 0 ? allActiveLow(ctx, enables) : Level.L1;
      const armed = mr !== resetActive;
      const late = dataCheck.setup(ctx, times, armed && load !== Level.L0);
      const early = dataCheck.hold(ctx, times, armed && load !== Level.L0);
      const lateEnable = enableCheck ? enableCheck.setup(ctx, times, armed) : 0;
      const earlyEnable = enableCheck ? enableCheck.hold(ctx, times, armed) : 0;
      const shortClock = clockWidth.check(ctx, times, armed);
      const shortReset = resetWidth ? resetWidth.check(ctx, times) : false;
      const recovering = recovery ? recovery.check(ctx, times) : false;
      const edge = clockEdge(ctx, clock, 'rise');
      const resetStarts =
        reset >= 0 && ctx.changed(reset) && toInput(ctx.prev(reset)) === complement(resetActive);

      for (let n = 0; n < bits; n++) {
        const was = q[n]!;
        let bit = was;
        if (edge !== ClockEdge.NONE) {
          // D is read only when the edge may load it (a late enable may have allowed it).
          if (load !== Level.L0 || lateEnable !== 0) {
            const d = toInput(ctx.read(data[n]!));
            const next = load === Level.L1 ? d : load === Level.L0 ? was : either(was, d);
            if (edge === ClockEdge.UNCERTAIN) bit = either(was, next);
            else if ((late >> n) & 1) bit = Level.X;
            else if (lateEnable !== 0) bit = either(was, d);
            else if (shortClock || recovering) bit = either(was, next);
            else bit = next;
          }
        } else {
          if ((early >> n) & 1) bit = either(bit, toInput(ctx.read(data[n]!)));
          if (earlyEnable !== 0 || shortClock) bit = either(bit, beforeEdge[n]!);
        }
        if (edge === ClockEdge.ACTIVE) beforeEdge[n] = was;
        if (shortReset) bit = either(bit, beforeReset[n]!);
        if (resetStarts) beforeReset[n] = was;
        if (mr === resetActive) bit = Level.L0;
        else if (mr !== complement(resetActive)) bit = either(bit, Level.L0);
        q[n] = bit;
      }

      const enabled = outputEnables.length > 0 ? allActiveLow(ctx, outputEnables) : Level.L1;
      let enableChanged = false;
      for (let i = 0; i < outputEnables.length; i++)
        enableChanged = enableChanged || ctx.changed(outputEnables[i]!);
      for (let n = 0; n < bits; n++) {
        const out = outputs[n]!;
        if (enabled === Level.L0) {
          ctx.drive(out, Drive.Z, tdis);
        } else {
          // Enabled, or maybe (X: it might be driving).
          const level = enabled === Level.L1 ? q[n]! : Level.X;
          ctx.drive(out, strong(level), enableChanged ? ten : paths.delay(ctx, out));
        }
        if (complements) {
          const qn = complements[n]!;
          ctx.drive(qn, strong(complement(q[n]!)), paths.delay(ctx, qn));
        }
      }
      checks.track(ctx, times);
    };

    return () => ({
      createState: () => ({
        q: Array.from({ length: bits }, () => Level.X),
        beforeEdge: Array.from({ length: bits }, () => Level.X),
        beforeReset: Array.from({ length: bits }, () => Level.X),
        times: checks.createTimes(),
      }),
      evaluate,
    });
  };
}

const D8 = 'D0, D1, D2, D3, D4, D5, D6, D7';
const Q8 = 'Q0, Q1, Q2, Q3, Q4, Q5, Q6, Q7';
const KEYWORDS = ['register', 'flip-flop', 'flipflop', 'd-type', 'latch', 'storage'];

export const REG175_SPEC: RegisterSpec = {
  number: '175',
  title: 'Quad D-type flip-flop with reset; positive-edge trigger',
  keywords: [...KEYWORDS, 'quad', 'reset', 'clear'],
  pinCount: 16,
  pins: [
    pins('MR', '1', 'in', 'asynchronous master reset input (active LOW)', { activeLow: true }),
    pins('Q0, Q1, Q2, Q3', '2, 7, 10, 15', 'out', 'flip-flop output'),
    ...[3, 6, 11, 14].map((number, n) =>
      pins(`Q${n}N`, String(number), 'out', 'complementary flip-flop output', {
        activeLow: true,
        label: `Q${n}`,
      }),
    ),
    pins('D0, D1, D2, D3', '4, 5, 12, 13', 'in', 'data input'),
    pins('GND', '8', 'power', 'ground (0 V)'),
    pins('CP', '9', 'in', 'clock input (LOW-to-HIGH edge-triggered)', { clock: true }),
    pins('VCC', '16', 'power', 'positive supply voltage'),
  ],
  functionTable: {
    inputs: ['MR', 'CP', 'Dn'],
    outputs: ['Qn', 'QnN'],
    rows: ['L X X | L H', 'H ↑ h | H L', 'H ↑ l | L H'],
    note: 'each flip-flop (n = 0 to 3): reset (clear), load "1", load "0"',
  },
  data: 'D0, D1, D2, D3',
  outputs: 'Q0, Q1, Q2, Q3',
  complements: 'Q0N, Q1N, Q2N, Q3N',
  setup: 'tsu(Dn to CP)',
  hold: 'th(Dn to CP)',
  clockWidth: 'tW(CP)',
  reset: { active: 'low', width: 'tW(MR)', recovery: 'trec(MR to CP)' },
  paths: [
    { from: 'CP', to: 'Q0, Q1, Q2, Q3, Q0N, Q1N, Q2N, Q3N', delay: 'tpd(CP to Qn, QnN)' },
    { from: 'MR', to: 'Q0, Q1, Q2, Q3, Q0N, Q1N, Q2N, Q3N', delay: 'tPHL(MR to Qn, QnN)' },
  ],
};

export const REG273_SPEC: RegisterSpec = {
  number: '273',
  title: 'Octal D-type flip-flop with reset; positive-edge trigger',
  keywords: [...KEYWORDS, 'octal', 'reset', 'clear', 'output register'],
  pinCount: 20,
  pins: [
    pins('MR', '1', 'in', 'master reset input (active LOW)', { activeLow: true }),
    pins(Q8, '2, 5, 6, 9, 12, 15, 16, 19', 'out', 'flip-flop output'),
    pins(D8, '3, 4, 7, 8, 13, 14, 17, 18', 'in', 'data input'),
    pins('GND', '10', 'power', 'ground (0 V)'),
    pins('CP', '11', 'in', 'clock input (LOW-to-HIGH, edge-triggered)', { clock: true }),
    pins('VCC', '20', 'power', 'supply voltage'),
  ],
  functionTable: {
    inputs: ['MR', 'CP', 'Dn'],
    outputs: ['Qn'],
    rows: ['L X X | L', 'H ↑ h | H', 'H ↑ l | L'],
    note: 'each flip-flop (n = 0 to 7): reset (clear), load "1", load "0"',
  },
  data: D8,
  outputs: Q8,
  setup: 'tsu(Dn to CP)',
  hold: 'th(Dn to CP)',
  clockWidth: 'tW(CP)',
  reset: { active: 'low', width: 'tW(MR)', recovery: 'trec(MR to CP)' },
  paths: [
    { from: 'CP', to: Q8, delay: 'tpd(CP to Qn)' },
    { from: 'MR', to: Q8, delay: 'tPHL(MR to Qn)' },
  ],
};

export const REG377_SPEC: RegisterSpec = {
  number: '377',
  title: 'Octal D-type flip-flop with data enable; positive-edge trigger',
  keywords: [...KEYWORDS, 'octal', 'enable', 'load'],
  pinCount: 20,
  pins: [
    pins('E', '1', 'in', 'data enable input (active LOW)', { activeLow: true }),
    pins(Q8, '2, 5, 6, 9, 12, 15, 16, 19', 'out', 'flip-flop output'),
    pins(D8, '3, 4, 7, 8, 13, 14, 17, 18', 'in', 'data input'),
    pins('GND', '10', 'power', 'ground (0 V)'),
    pins('CP', '11', 'in', 'clock input (LOW-to-HIGH, edge triggered)', { clock: true }),
    pins('VCC', '20', 'power', 'supply voltage'),
  ],
  functionTable: {
    inputs: ['CP', 'E', 'Dn'],
    outputs: ['Qn'],
    // The data sheet writes "no change" for qn.
    rows: ['↑ l h | H', '↑ l l | L', '↑ h X | qn', 'X H X | qn'],
    note: 'each flip-flop (n = 0 to 7): load "1", load "0", hold (qn: no change)',
    state: { qn: 'Qn' },
  },
  data: D8,
  outputs: Q8,
  setup: 'tsu(Dn to CP)',
  hold: 'th(Dn to CP)',
  clockWidth: 'tW(CP)',
  enable: { pins: 'E', setup: 'tsu(E to CP)', hold: 'th(E to CP)' },
  paths: [{ from: 'CP', to: Q8, delay: 'tpd(CP to Qn)' }],
};

export const REG173_SPEC: RegisterSpec = {
  number: '173',
  title: 'Quad D-type flip-flop; positive-edge trigger; 3-state',
  keywords: [...KEYWORDS, 'quad', '3-state', 'tri-state', 'bus', 'enable', 'reset', 'clear'],
  pinCount: 16,
  pins: [
    pins('OE1, OE2', '1, 2', 'in', 'output enable input (active LOW)', { activeLow: true }),
    pins('Q0, Q1, Q2, Q3', '3, 4, 5, 6', 'tristate', '3-state flip-flop output'),
    pins('CP', '7', 'in', 'clock input (LOW-to-HIGH, edge triggered)', { clock: true }),
    pins('GND', '8', 'power', 'ground (0 V)'),
    pins('E1, E2', '9, 10', 'in', 'data enable input (active LOW)', { activeLow: true }),
    pins('D0, D1, D2, D3', '14, 13, 12, 11', 'in', 'data input'),
    pins('MR', '15', 'in', 'asynchronous master reset (active HIGH)'),
    pins('VCC', '16', 'power', 'supply voltage'),
  ],
  functionTable: {
    inputs: ['MR', 'CP', 'E1', 'E2', 'Dn', 'OE1', 'OE2'],
    outputs: ['Qn'],
    rows: [
      'H X X X X L L | L',
      'L ↑ l l l L L | L',
      'L ↑ l l h L L | H',
      'L X h X X L L | qn',
      'L X X h X L L | qn',
      'X X X X X H X | Z',
      'X X X X X X H | Z',
    ],
    note: 'each flip-flop (n = 0 to 3): reset, parallel load, hold, outputs disabled (tables 3 and 4 merged: Qn shows the register while OE1 = OE2 = L)',
    state: { qn: 'Qn' },
  },
  data: 'D0, D1, D2, D3',
  outputs: 'Q0, Q1, Q2, Q3',
  setup: 'tsu(Dn to CP)',
  hold: 'th(Dn to CP)',
  clockWidth: 'tW(CP)',
  reset: { active: 'high', width: 'tW(MR)', recovery: 'trec(MR to CP)' },
  enable: { pins: 'E1, E2', setup: 'tsu(En to CP)', hold: 'th(En to CP)' },
  outputEnable: { pins: 'OE1, OE2', ten: 'ten(OEn to Qn)', tdis: 'tdis(OEn to Qn)' },
  paths: [
    { from: 'CP', to: 'Q0, Q1, Q2, Q3', delay: 'tpd(CP to Qn)' },
    { from: 'MR', to: 'Q0, Q1, Q2, Q3', delay: 'tPHL(MR to Qn)' },
  ],
};

/** The 374 and 574 share their function; only the pinout differs (574: flow-through). */
const OCTAL_3STATE_TABLE = {
  inputs: ['OE', 'CP', 'Dn'],
  outputs: ['Internal', 'Qn'],
  rows: ['L ↑ l | L L', 'L ↑ h | H H', 'H ↑ l | L Z', 'H ↑ h | H Z'],
  note: 'each flip-flop (n = 0 to 7): load and read register; load register and disable outputs (Internal: the register bit)',
} as const;

export const REG374_SPEC: RegisterSpec = {
  number: '374',
  title: 'Octal D-type flip-flop; positive edge-trigger; 3-state',
  keywords: [...KEYWORDS, 'octal', '3-state', 'tri-state', 'bus'],
  pinCount: 20,
  pins: [
    pins('OE', '1', 'in', 'output enable input (active LOW)', { activeLow: true }),
    pins(Q8, '2, 5, 6, 9, 12, 15, 16, 19', 'tristate', 'data outputs'),
    pins(D8, '3, 4, 7, 8, 13, 14, 17, 18', 'in', 'data inputs'),
    pins('GND', '10', 'power', 'ground (0 V)'),
    pins('CP', '11', 'in', 'clock pulse input (active rising edge)', { clock: true }),
    pins('VCC', '20', 'power', 'supply voltage'),
  ],
  functionTable: OCTAL_3STATE_TABLE,
  data: D8,
  outputs: Q8,
  setup: 'tsu(Dn to CP)',
  hold: 'th(Dn to CP)',
  clockWidth: 'tW(CP)',
  outputEnable: { pins: 'OE', ten: 'ten(OE to Qn)', tdis: 'tdis(OE to Qn)' },
  paths: [{ from: 'CP', to: Q8, delay: 'tpd(CP to Qn)' }],
};

export const REG574_SPEC: RegisterSpec = {
  number: '574',
  title: 'Octal D-type flip-flop; positive edge-trigger; 3-state',
  keywords: [...KEYWORDS, 'octal', '3-state', 'tri-state', 'bus', 'flow-through'],
  pinCount: 20,
  pins: [
    pins('OE', '1', 'in', '3-state output enable input (active LOW)', { activeLow: true }),
    pins(D8, '2, 3, 4, 5, 6, 7, 8, 9', 'in', 'data inputs'),
    pins('GND', '10', 'power', 'ground (0 V)'),
    pins('CP', '11', 'in', 'clock input (LOW-to-HIGH, edge triggered)', { clock: true }),
    pins(Q8, '19, 18, 17, 16, 15, 14, 13, 12', 'tristate', '3-state flip-flop outputs'),
    pins('VCC', '20', 'power', 'supply voltage'),
  ],
  functionTable: OCTAL_3STATE_TABLE,
  data: D8,
  outputs: Q8,
  setup: 'tsu(Dn to CP)',
  hold: 'th(Dn to CP)',
  clockWidth: 'tW(CP)',
  outputEnable: { pins: 'OE', ten: 'ten(OE to Qn)', tdis: 'tdis(OE to Qn)' },
  paths: [{ from: 'CP', to: Q8, delay: 'tpd(CP to Qn)' }],
};

export const REGISTER_SPECS: readonly RegisterSpec[] = [
  REG173_SPEC,
  REG175_SPEC,
  REG273_SPEC,
  REG374_SPEC,
  REG377_SPEC,
  REG574_SPEC,
];

/** The registers of a family. */
export function registerChips(family: LogicFamily): AnyComponentDefinition[] {
  return REGISTER_SPECS.map((spec) => chipDefinition(spec, family, registerBehavior(spec)));
}

/** 74HC173, 175, 273, 374, 377, 574. */
export const hcRegisters = registerChips(HC);
