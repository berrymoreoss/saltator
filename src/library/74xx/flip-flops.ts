/**
 * Dual flip-flops with asynchronous set and/or reset: 74xx74 (D), 107, 112 (JK, falling edge),
 * 109 (JK̅, rising edge). Pinouts and function tables transcribed from the Nexperia data sheets;
 * timing and its requirements in `hc-timing.ts`. Spec: docs/components.md#edge-triggered-chips.
 */
import {
  type AnyComponentDefinition,
  type Edge,
  type EvalContext,
  Level,
  type PinRef,
  type PinTimes,
  type PulseWidthCheck,
  pinIndex,
  type RecoveryCheck,
  type SetupHoldCheck,
  strong,
  TimingChecks,
  toInput,
  type UnitDef,
} from '../../core';
import {
  type ChipBehavior,
  type ChipSpec,
  chipDefinition,
  type LogicFamily,
  pinIndices,
} from './chip';
import {
  BITS,
  ClockEdge,
  clockEdge,
  complement,
  couldBe,
  either,
  forUnit,
  jkNext,
} from './edge-triggered';
import { HC } from './hc-timing';
import { type DelayPath, pathDelays } from './paths';
import { pins } from './pinout';

/** An asynchronous set or reset input (active LOW) of each flip-flop, with its timing keys. */
export interface AsyncInput {
  /** Pin template: `nRD`. */
  readonly pin: string;
  /** Key of the minimum pulse width, and which phases it applies to. */
  readonly width: string;
  readonly widthLevel: 'low' | 'both';
  /** Key of the recovery time before the next active clock edge. */
  readonly recovery: string;
}

/**
 * A dual flip-flop chip. Pin and path templates use `n` for the flip-flop's number (`nCP`,
 * `nQN`); every flip-flop has a clock `nCP`, outputs `nQ` and `nQN` (drawn `nQ̅`).
 */
export interface FlipFlopSpec extends ChipSpec {
  readonly units: readonly UnitDef[];
  readonly edge: Edge;
  /** `D`: Q takes D; `JK`; `JKN`: a JK flip-flop whose K input is active LOW (109). */
  readonly kind: 'D' | 'JK' | 'JKN';
  /** Data input templates: `nD`, or `nJ, nK`. */
  readonly data: string;
  /** Keys of the set-up and hold times of the data inputs, and of the clock pulse width. */
  readonly setup: string;
  readonly hold: string;
  readonly clockWidth: string;
  readonly set?: AsyncInput;
  readonly reset: AsyncInput;
  /** Q and Q̅ while set and reset are both active (74, 109: H H; 112: H L). */
  readonly bothActive?: readonly [Level, Level];
  readonly paths: readonly DelayPath[];
}

/** State of a dual flip-flop chip, per flip-flop. */
export interface FlipFlopState {
  /** The stored bit; `X` until set, reset or clocked, and while set and reset are both active. */
  q: Level[];
  /** The bit before the last active edge, and before the last set/reset began (timing checks). */
  beforeEdge: Level[];
  beforeAsync: Level[];
  times: PinTimes;
}

interface Unit {
  readonly data: Int32Array;
  readonly clock: PinRef;
  readonly set: PinRef;
  readonly reset: PinRef;
  readonly q: PinRef;
  readonly qn: PinRef;
  readonly setupHold: SetupHoldCheck;
  readonly widths: readonly PulseWidthCheck[];
  readonly clockWidth: PulseWidthCheck;
  readonly recoveries: readonly RecoveryCheck[];
}

/**
 * Each flip-flop, on every call:
 *
 * - Synchronous part: an active edge loads the next state (D, or JK from the stored bit); an
 *   uncertain edge makes it `X` unless it would not change. Timing checks: a data input that
 *   changed within the set-up time makes the loaded bit `X`; a short inactive clock phase or a
 *   recovery violation make it `X` where the edge would change it (it may not have loaded); a
 *   hold violation where the new data would load something else; a short active clock phase
 *   where the last edge changed the bit; a short set/reset pulse where it changed the bit.
 * - Asynchronous part: every set/reset combination the inputs allow, merged — set (Q = H), reset
 *   (Q = L), both (the data sheet's outputs; the stored bit becomes `X`, so releasing both at
 *   once leaves it unknown), neither (the synchronous result).
 */
export function flipFlopBehavior(spec: FlipFlopSpec): ChipBehavior<FlipFlopState> {
  return (pinList, delays, min) => {
    const checks = new TimingChecks(pinList, min);
    const unitNumbers = spec.units.map((_, i) => i + 1);
    const paths = pathDelays(
      pinList,
      delays,
      unitNumbers.flatMap((n) =>
        spec.paths.map((p) => ({ ...p, from: forUnit(p.from, n), to: forUnit(p.to, n) })),
      ),
    );
    const asyncInputs = spec.set ? [spec.set, spec.reset] : [spec.reset];
    const units = unitNumbers.map((n): Unit => {
      const at = (template: string) => forUnit(template, n);
      const clock = at('nCP');
      return {
        data: pinIndices(pinList, at(spec.data)),
        clock: pinIndex(pinList, clock),
        set: spec.set ? pinIndex(pinList, at(spec.set.pin)) : -1,
        reset: pinIndex(pinList, at(spec.reset.pin)),
        q: pinIndex(pinList, at('nQ')),
        qn: pinIndex(pinList, at('nQN')),
        setupHold: checks.setupHold({
          data: at(spec.data),
          clock,
          edge: spec.edge,
          setup: spec.setup,
          hold: spec.hold,
        }),
        clockWidth: checks.pulseWidth({ pin: clock, level: 'both', width: spec.clockWidth }),
        widths: asyncInputs.map((a) =>
          checks.pulseWidth({ pin: at(a.pin), level: a.widthLevel, width: a.width }),
        ),
        recoveries: asyncInputs.map((a) =>
          checks.recovery({
            pin: at(a.pin),
            active: 'low',
            clock,
            edge: spec.edge,
            recovery: a.recovery,
          }),
        ),
      };
    });
    const [bothQ, bothQN] = spec.bothActive ?? [Level.L1, Level.L1];

    /** The state an edge loads into a flip-flop that holds `q`, from the data inputs now. */
    const load = (ctx: EvalContext<FlipFlopState>, unit: Unit, q: Level): Level => {
      const a = toInput(ctx.read(unit.data[0]!));
      if (spec.kind === 'D') return a;
      const b = toInput(ctx.read(unit.data[1]!));
      return jkNext(q, a, spec.kind === 'JKN' ? complement(b) : b);
    };

    const evaluate = (ctx: EvalContext<FlipFlopState>) => {
      const { q: stored, beforeEdge, beforeAsync, times } = ctx.state;
      for (let u = 0; u < units.length; u++) {
        const unit = units[u]!;
        const was = stored[u]!;
        let q = was;
        const set = unit.set < 0 ? Level.L1 : toInput(ctx.read(unit.set));
        const reset = toInput(ctx.read(unit.reset));
        // The clock's checks apply while it matters: set and reset not (surely) active.
        const armed = set !== Level.L0 && reset !== Level.L0;
        const late = unit.setupHold.setup(ctx, times, armed);
        const early = unit.setupHold.hold(ctx, times, armed);
        const shortClock = unit.clockWidth.check(ctx, times, armed);
        let shortAsync = false;
        let recovering = false;
        for (const check of unit.widths) shortAsync = check.check(ctx, times) || shortAsync;
        for (const check of unit.recoveries) recovering = check.check(ctx, times) || recovering;

        const edge = clockEdge(ctx, unit.clock, spec.edge);
        if (edge === ClockEdge.ACTIVE) {
          beforeEdge[u] = was;
          const next = load(ctx, unit, was);
          if (late !== 0) q = Level.X;
          else if (shortClock || recovering) q = either(was, next);
          else q = next;
        } else if (edge === ClockEdge.UNCERTAIN) {
          q = either(was, load(ctx, unit, was));
        } else {
          if (early !== 0) q = either(q, load(ctx, unit, beforeEdge[u]!));
          if (shortClock) q = either(q, beforeEdge[u]!);
        }
        if (shortAsync) q = either(q, beforeAsync[u]!);

        if ((unit.set >= 0 && ctx.fell(unit.set)) || ctx.fell(unit.reset)) beforeAsync[u] = was;
        let state: Level | -1 = -1;
        let outQ: Level | -1 = -1;
        let outQN: Level | -1 = -1;
        for (const s of BITS) {
          if (!couldBe(set, s)) continue;
          for (const r of BITS) {
            if (!couldBe(reset, r)) continue;
            // Neither active: the synchronous result; set only; reset only; both.
            const next =
              s === r ? (s === Level.L1 ? q : Level.X) : s === Level.L1 ? Level.L0 : Level.L1;
            const a = s === Level.L0 && r === Level.L0 ? bothQ : next;
            const b = s === Level.L0 && r === Level.L0 ? bothQN : complement(next);
            state = state === -1 ? next : either(state, next);
            outQ = outQ === -1 ? a : either(outQ, a);
            outQN = outQN === -1 ? b : either(outQN, b);
          }
        }
        stored[u] = state as Level;
        ctx.drive(unit.q, strong(outQ as Level), paths.delay(ctx, unit.q));
        ctx.drive(unit.qn, strong(outQN as Level), paths.delay(ctx, unit.qn));
      }
      checks.track(ctx, times);
    };

    return () => ({
      createState: () => ({
        q: units.map(() => Level.X),
        beforeEdge: units.map(() => Level.X),
        beforeAsync: units.map(() => Level.X),
        times: checks.createTimes(),
      }),
      evaluate,
    });
  };
}

/** The two flip-flops' pins, inputs first in the function table's column order. */
function flipFlopUnits(columns: readonly string[]): UnitDef[] {
  return [1, 2].map((n, i) => ({ name: 'AB'[i]!, pins: columns.map((c) => forUnit(c, n)) }));
}

export const FF74_SPEC: FlipFlopSpec = {
  number: '74',
  title: 'Dual D-type flip-flop with set and reset; positive edge-trigger',
  keywords: [
    'flip-flop',
    'flipflop',
    'd-type',
    'register',
    'latch',
    'set',
    'reset',
    'preset',
    'clear',
  ],
  pinCount: 14,
  pins: [
    pins('1RD, 2RD', '1, 13', 'in', 'asynchronous reset-direct input (active LOW)', {
      activeLow: true,
    }),
    pins('1D, 2D', '2, 12', 'in', 'data input'),
    pins('1CP, 2CP', '3, 11', 'in', 'clock input (LOW-to-HIGH, edge-triggered)', { clock: true }),
    pins('1SD, 2SD', '4, 10', 'in', 'asynchronous set-direct input (active LOW)', {
      activeLow: true,
    }),
    pins('1Q, 2Q', '5, 9', 'out', 'output'),
    pins('1QN', '6', 'out', 'complement output', { activeLow: true, label: '1Q' }),
    pins('GND', '7', 'power', 'ground (0 V)'),
    pins('2QN', '8', 'out', 'complement output', { activeLow: true, label: '2Q' }),
    pins('VCC', '14', 'power', 'supply voltage'),
  ],
  units: flipFlopUnits(['nSD', 'nRD', 'nCP', 'nD', 'nQ', 'nQN']),
  functionTable: {
    inputs: ['nSD', 'nRD', 'nCP', 'nD'],
    outputs: ['nQ', 'nQN'],
    rows: ['L H X X | H L', 'H L X X | L H', 'L L X X | H H', 'H H ↑ L | L H', 'H H ↑ H | H L'],
    note: 'each flip-flop (n = 1, 2); ↑ rows: the state after the transition (tables 3 and 4)',
  },
  edge: 'rise',
  kind: 'D',
  data: 'nD',
  setup: 'tsu(nD to nCP)',
  hold: 'th(nD to nCP)',
  clockWidth: 'tW(nCP)',
  set: { pin: 'nSD', width: 'tW(nSD, nRD)', widthLevel: 'low', recovery: 'trec(nSD, nRD)' },
  reset: { pin: 'nRD', width: 'tW(nSD, nRD)', widthLevel: 'low', recovery: 'trec(nSD, nRD)' },
  bothActive: [Level.L1, Level.L1],
  paths: [
    { from: 'nCP', to: 'nQ, nQN', delay: 'tpd(nCP to nQ, nQN)' },
    { from: 'nSD', to: 'nQ, nQN', delay: 'tpd(nSD to nQ, nQN)' },
    { from: 'nRD', to: 'nQ, nQN', delay: 'tpd(nRD to nQ, nQN)' },
  ],
};

export const FLIP_FLOP_SPECS: readonly FlipFlopSpec[] = [FF74_SPEC];

/** The dual flip-flops of a family. */
export function flipFlopChips(family: LogicFamily): AnyComponentDefinition[] {
  return FLIP_FLOP_SPECS.map((spec) => chipDefinition(spec, family, flipFlopBehavior(spec)));
}

/** 74HC74. */
export const hcFlipFlops = flipFlopChips(HC);
