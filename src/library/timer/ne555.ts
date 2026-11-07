/**
 * NE555 timer, behavioral: the TI NE555 data sheet's pinout and function table, with the external
 * timing network (RA, RB, C) as props instead of simulated parts. Spec:
 * docs/components.md#timers-timer; decision: docs/adr/0013-behavioral-timer.md.
 */
import {
  Drive,
  defineComponent,
  type EvalContext,
  Level,
  ns,
  type PinDef,
  type PinDir,
  strong,
  type Time,
  toInput,
} from '../../core';

export type TimerMode = 'astable' | 'monostable' | 'bistable';

type Props = { mode: TimerMode; ra: number; rb: number; c: number };

/** State of an NE555: the internal flip-flop (OUT before its delay), the timing phase. */
export interface TimerState {
  /** The flip-flop: 1 = OUT high, discharge off. `X` at power-on in monostable/bistable mode. */
  q: Level;
  /** Astable: oscillating; monostable: a pulse is timing (1) or held by a low TRIG (2). */
  phase: number;
  /** Generation of the pending timer; a wake with an older token is stale (no cancel). */
  gen: number;
}

/** Typical propagation delay, read off TI's Figure 5-8 at 25 °C, trigger pulse down to 0 V. */
const TPD = ns(225);

const TIMING_PIN = 'timing capacitor network; not simulated in this mode (RA, RB and C set it)';

/** The pins in a mode: those wired to the RC network are drawn but not simulated (`nc`). */
function timerPins(mode: TimerMode): PinDef[] {
  const simulated = (simulatedIn: readonly TimerMode[], dir: PinDir) =>
    simulatedIn.includes(mode) ? dir : 'nc';
  const explain = (simulatedIn: readonly TimerMode[], text: string) =>
    simulatedIn.includes(mode) ? text : `${text}; ${TIMING_PIN}`;
  return [
    { name: 'GND', number: 1, dir: 'power', description: 'ground' },
    {
      name: 'TRIG',
      number: 2,
      dir: simulated(['monostable', 'bistable'], 'in'),
      description: explain(
        ['monostable', 'bistable'],
        'start of timing input: TRIG < ½ CONT sets output high and discharge open',
      ),
    },
    { name: 'OUT', number: 3, dir: 'out', description: 'high current timer output signal' },
    {
      name: 'RESET',
      number: 4,
      dir: 'in',
      activeLow: true,
      description: 'reset input (active LOW): forces output and discharge low',
    },
    {
      name: 'CONT',
      number: 5,
      dir: 'nc',
      description: 'controls comparator thresholds (2/3 × VCC); not simulated',
    },
    {
      name: 'THRES',
      number: 6,
      dir: simulated(['bistable'], 'in'),
      description: explain(
        ['bistable'],
        'end of timing input: THRES > CONT sets output low and discharge low',
      ),
    },
    {
      name: 'DISCH',
      number: 7,
      dir: simulated(['bistable'], 'tristate'),
      description: explain(['bistable'], 'open collector output to discharge timing capacitor'),
    },
    { name: 'VCC', number: 8, dir: 'power', description: 'input supply voltage, 4.5 V to 16 V' },
  ];
}

/** The data sheet's factor for charging between ⅓ and ⅔ VCC (ln 2, as TI rounds it). */
// biome-ignore lint/suspicious/noApproximativeNumericConstant: the data sheet's 0.693, not Math.LN2
const HALF = 0.693;
/** The data sheet's factor for charging from 0 V to ⅔ VCC (≈ ln 3, as TI gives it). */
const FROM_EMPTY = 1.1;

/** Picoseconds of `k × R × C` seconds, at least 1 ps. */
const rc = (k: number, r: number, c: number): Time => Math.max(1, Math.round(k * r * c * 1e12));

/**
 * The timing of a mode from the data sheet's equations: astable tH = 0.693 (RA + RB) C and
 * tL = 0.693 RB C (equations 1, 2), the first high time 1.1 (RA + RB) C (charging from 0 V, as a
 * monostable pulse); monostable tw = 1.1 RA C.
 */
export function timerTiming(ra: number, rb: number, c: number) {
  return {
    first: rc(FROM_EMPTY, ra + rb, c),
    high: rc(HALF, ra + rb, c),
    low: rc(HALF, rb, c),
    pulse: rc(FROM_EMPTY, ra, c),
  };
}

const ohms = (key: string, label: string, value: number) => ({
  key,
  label,
  type: 'number' as const,
  default: value,
  min: 1,
  max: 10e6,
  unit: 'Ω',
  si: true,
});

const merge = (a: Level, b: Level): Level => (a === b ? a : Level.X);

const PIN_TRIG = 1;
const PIN_OUT = 2;
const PIN_RESET = 3;
const PIN_THRES = 5;
const PIN_DISCH = 6;

export const ne555 = defineComponent<Props, TimerState>({
  type: 'timer/ne555',
  name: 'NE555',
  title: 'Precision timer',
  keywords: [
    '555',
    'timer',
    'oscillator',
    'astable',
    'monostable',
    'bistable',
    'clock',
    'debounce',
  ],
  datasheet: 'https://www.ti.com/lit/ds/symlink/ne555.pdf',
  pins: ({ mode }) => timerPins(mode),
  package: { kind: 'dip', pins: 8 },
  props: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'enum',
      default: 'astable',
      options: [
        { value: 'astable', label: 'Astable: free-running oscillator' },
        { value: 'monostable', label: 'Monostable: one pulse per trigger' },
        { value: 'bistable', label: 'Bistable: set by TRIG, reset by RESET' },
      ],
    },
    ohms('ra', 'RA', 1000),
    ohms('rb', 'RB (astable)', 100_000),
    {
      key: 'c',
      label: 'C',
      type: 'number',
      default: 1e-6,
      min: 1e-12,
      max: 100e-6,
      unit: 'F',
      si: true,
    },
  ],
  timing: {
    typical: { tPD: TPD },
    conditions:
      'TA = 25 °C, trigger pulse down to 0 V; RC timing from the data sheet equations (typical)',
    source:
      'TI NE555 data sheet, SLFS022K (March 2026): Figure 5-8 (tPD), equations 1–2 and section 6.3',
  },
  functionTable: {
    inputs: ['RESET', 'TRIG', 'THRES'],
    outputs: ['OUT', 'DISCH'],
    rows: ['L X X | L on', 'H L X | H off', 'H H H | L on', 'H H L | Q0 Q0'],
    note: 'TRIG L = below ⅓ VCC, THRES H = above ⅔ VCC; Q0 = as previously established',
  },
  create: ({ mode, ra, rb, c }) => {
    const { first, high, low, pulse } = timerTiming(ra, rb, c);
    const drive = (ctx: EvalContext<TimerState>, q: Level) => {
      ctx.state.q = q;
      ctx.drive(PIN_OUT, strong(q), TPD);
      if (mode !== 'bistable') return;
      // Open collector: on (low) while the flip-flop is reset, off (released) while set.
      ctx.drive(
        PIN_DISCH,
        q === Level.L1 ? Drive.Z : strong(q === Level.L0 ? Level.L0 : Level.X),
        TPD,
      );
    };
    /** Starts a timer for `delay`, making any pending one stale. */
    const time = (ctx: EvalContext<TimerState>, delay: Time) => {
      ctx.state.gen++;
      ctx.wakeAfter(delay, ctx.state.gen);
    };
    const stop = (ctx: EvalContext<TimerState>, q: Level) => {
      ctx.state.gen++;
      ctx.state.phase = 0;
      drive(ctx, q);
    };

    // Astable: RESET high runs it, starting with the long first charge; RESET low stops it low.
    const astable = (ctx: EvalContext<TimerState>) => {
      const reset = toInput(ctx.read(PIN_RESET));
      if (reset === Level.L1) {
        if (ctx.state.phase === 0) {
          ctx.state.phase = 1;
          drive(ctx, Level.L1);
          time(ctx, first);
        }
      } else if (
        ctx.state.phase !== 0 ||
        ctx.state.q !== (reset === Level.L0 ? Level.L0 : Level.X)
      ) {
        stop(ctx, reset === Level.L0 ? Level.L0 : Level.X);
      }
    };

    // Monostable: TRIG low (and RESET high) starts a pulse; triggers during it are ignored; at its
    // end OUT stays high while TRIG is still low.
    const monostable = (ctx: EvalContext<TimerState>) => {
      const reset = toInput(ctx.read(PIN_RESET));
      const trig = toInput(ctx.read(PIN_TRIG));
      const { phase, q } = ctx.state;
      if (reset === Level.L0) {
        if (phase !== 0 || q !== Level.L0) stop(ctx, Level.L0);
      } else if (reset === Level.X) {
        if (phase !== 0 || q !== Level.X) stop(ctx, Level.X);
      } else if (phase === 1) {
        // timing: TRIG is ignored
      } else if (trig === Level.L0) {
        if (phase === 0) {
          ctx.state.phase = 1;
          drive(ctx, Level.L1);
          time(ctx, pulse);
        }
      } else if (phase === 2 && trig === Level.L1) {
        ctx.state.phase = 0;
        drive(ctx, Level.L0);
      } else if (trig === Level.X && q !== Level.X) {
        stop(ctx, Level.X); // it might have fired (idle) or been released (held)
      }
    };

    // Bistable: the function table, with THRES and TRIG as levels; unknowns merge the outcomes.
    const bistable = (ctx: EvalContext<TimerState>) => {
      const reset = toInput(ctx.read(PIN_RESET));
      const trig = toInput(ctx.read(PIN_TRIG));
      const thres = toInput(ctx.read(PIN_THRES));
      const q = ctx.state.q;
      const afterThres =
        thres === Level.L1 ? Level.L0 : thres === Level.L0 ? q : merge(Level.L0, q);
      const running =
        trig === Level.L0 ? Level.L1 : trig === Level.L1 ? afterThres : merge(Level.L1, afterThres);
      const next =
        reset === Level.L0 ? Level.L0 : reset === Level.L1 ? running : merge(Level.L0, running);
      drive(ctx, next);
    };

    const evaluate = mode === 'astable' ? astable : mode === 'monostable' ? monostable : bistable;
    return {
      createState: () => ({ q: mode === 'astable' ? Level.L0 : Level.X, phase: 0, gen: 0 }),
      init(ctx) {
        drive(ctx, ctx.state.q);
      },
      evaluate,
      wake(ctx, token) {
        if (token !== ctx.state.gen) return; // stale: reset or retimed since
        if (mode === 'astable') {
          const rising = ctx.state.q !== Level.L1;
          drive(ctx, rising ? Level.L1 : Level.L0);
          time(ctx, rising ? high : low);
        } else if (mode === 'monostable' && ctx.state.phase === 1) {
          const trig = toInput(ctx.read(PIN_TRIG));
          if (trig === Level.L0) {
            ctx.state.phase = 2; // TRIG still low: OUT stays high until it rises
          } else {
            ctx.state.phase = 0;
            drive(ctx, trig === Level.L1 ? Level.L0 : Level.X);
          }
        }
      },
    };
  },
});
