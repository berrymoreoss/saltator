/**
 * 74xx147 10-to-4 and 74xx148 8-to-3 priority encoders, from the TI data sheets (Nexperia has
 * none): pinouts from the pinning figures, function tables transcribed. TI's CD74HC147 pin table
 * calls pin 9 an input `I0`; its pinning figure (and every 74147) has output `Y0` there.
 * Spec: docs/components.md#74xx-chips-74xx.
 */
import { type AnyComponentDefinition, type EvalContext, Level, strong, toInput } from '../../core';
import {
  type ChipBehavior,
  type ChipSpec,
  chipDefinition,
  type LogicFamily,
  pinIndices,
} from './chip';
import { HC } from './hc-timing';
import { type DelayPath, pathDelays } from './paths';
import { type PinRow, pins } from './pinout';

const GND_16 = pins('GND', '8', 'power', 'ground');
const VCC_16 = pins('VCC', '16', 'power', 'positive supply');

/** Possible outcomes of an encoder, merged: which output bits all of them agree on, and how. */
type Outcomes = number;
const NONE: Outcomes = -1;

/** Adds outcome `bits` (one bit per output, 1 = high) to `seen`: `(agree << 8) | value`. */
function merge(seen: Outcomes, bits: number, all: number): Outcomes {
  if (seen === NONE) return (all << 8) | bits;
  const value = seen & 0xff;
  return (((seen >> 8) & ~(value ^ bits) & all) << 8) | value;
}

/** Output `bit` of merged outcomes: its level if every possible outcome agrees, else `X`. */
function outcomeLevel(seen: Outcomes, bit: number): Level {
  if (!((seen >> 8) & (1 << bit))) return Level.X;
  return seen & (1 << bit) ? Level.L1 : Level.L0;
}

/** TI's per-pin rows: `Active low input 4` → `input 4 (active LOW)`. */
const numbered = (prefix: string, kind: 'in' | 'out', what: string, list: string) =>
  list.split(',').map((entry): PinRow => {
    const [n, pin] = entry.trim().split(':') as [string, string];
    return pins(`${prefix}${n}`, pin, kind, `${what} ${n} (active LOW)`, { activeLow: true });
  });

export const ENCODER147_SPEC: ChipSpec & { readonly paths: readonly DelayPath[] } = {
  number: '147',
  title: '10-to-4 line priority encoder',
  keywords: ['encoder', 'priority encoder', 'decimal', 'bcd', 'keypad', '10-to-4'],
  pinCount: 16,
  pins: [
    ...numbered('I', 'in', 'input', '4:1, 5:2, 6:3, 7:4, 8:5, 9:10, 1:11, 2:12, 3:13'),
    ...numbered('Y', 'out', 'output', '2:6, 1:7, 0:9, 3:14'),
    pins('n.c.', '15', 'nc', 'no internal connection'),
    GND_16,
    VCC_16,
  ],
  functionTable: {
    inputs: ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9'],
    outputs: ['Y3', 'Y2', 'Y1', 'Y0'],
    rows: [
      'H H H H H H H H H | H H H H',
      'X X X X X X X X L | L H H L',
      'X X X X X X X L H | L H H H',
      'X X X X X X L H H | H L L L',
      'X X X X X L H H H | H L L H',
      'X X X X L H H H H | H L H L',
      'X X X L H H H H H | H L H H',
      'X X L H H H H H H | H H L L',
      'X L H H H H H H H | H H L H',
      'L H H H H H H H H | H H H L',
    ],
  },
  paths: [
    {
      from: 'I1, I2, I3, I4, I5, I6, I7, I8, I9',
      to: 'Y0, Y1, Y2, Y3',
      delay: 'tpd',
    },
  ],
};

/**
 * The highest active (low) input wins; Y is its number in BCD, inverted (all high when none is
 * active: the implied zero). An unknown input makes `X` only the output bits that the possible
 * winners disagree on.
 */
const encoder147Behavior: ChipBehavior = (pinList, delays) => {
  const paths = pathDelays(pinList, delays, ENCODER147_SPEC.paths);
  const inputs = pinIndices(pinList, 'I1, I2, I3, I4, I5, I6, I7, I8, I9'); // I1 at 0
  const y = pinIndices(pinList, 'Y0, Y1, Y2, Y3');

  const evaluate = (ctx: EvalContext<undefined>) => {
    let seen: Outcomes = NONE;
    let decided = false;
    for (let n = 9; n >= 1 && !decided; n--) {
      const level = toInput(ctx.read(inputs[n - 1]!));
      if (level === Level.L1) continue;
      seen = merge(seen, ~n & 0xf, 0xf);
      decided = level === Level.L0;
    }
    if (!decided) seen = merge(seen, 0xf, 0xf); // possibly none active
    for (let bit = 0; bit < 4; bit++) {
      ctx.drive(y[bit]!, strong(outcomeLevel(seen, bit)), paths.delay(ctx, y[bit]!));
    }
  };
  return () => ({ evaluate });
};

const DATA_148 = '0, 1, 2, 3, 4, 5, 6, 7';
const A_148 = 'A0, A1, A2';

export const ENCODER148_SPEC: ChipSpec & { readonly paths: readonly DelayPath[] } = {
  number: '148',
  title: '8-to-3 line priority encoder',
  keywords: ['encoder', 'priority encoder', 'octal', 'interrupt', '8-to-3', 'cascade'],
  pinCount: 16,
  // TI's names; the data sheet has no pin table: descriptions from its text ("data inputs and
  // outputs are active at the low logic level", enable input EI, enable output EO).
  pins: [
    pins(DATA_148, '10, 11, 12, 13, 1, 2, 3, 4', 'in', 'data input (active LOW)', {
      activeLow: true,
    }),
    pins('EI', '5', 'in', 'enable input (active LOW)', { activeLow: true }),
    pins('A2, A1, A0', '6, 7, 9', 'out', 'binary output (active LOW)', { activeLow: true }),
    pins('GS', '14', 'out', 'group select output (active LOW)', { activeLow: true }),
    pins('EO', '15', 'out', 'enable output (active LOW)', { activeLow: true }),
    GND_16,
    pins('VCC', '16', 'power', 'supply voltage'),
  ],
  functionTable: {
    inputs: ['EI', '0', '1', '2', '3', '4', '5', '6', '7'],
    outputs: ['A2', 'A1', 'A0', 'GS', 'EO'],
    rows: [
      'H X X X X X X X X | H H H H H',
      'L H H H H H H H H | H H H H L',
      'L X X X X X X X L | L L L L H',
      'L X X X X X X L H | L L H L H',
      'L X X X X X L H H | L H L L H',
      'L X X X X L H H H | L H H L H',
      'L X X X L H H H H | H L L L H',
      'L X X L H H H H H | H L H L H',
      'L X L H H H H H H | H H L L H',
      'L L H H H H H H H | H H H L H',
    ],
  },
  paths: [
    { from: '1, 2, 3, 4, 5, 6, 7', to: A_148, delay: 'tpd(1-7 to A0-A2)' },
    { from: DATA_148, to: 'EO', delay: 'tpd(0-7 to EO)' },
    { from: DATA_148, to: 'GS', delay: 'tpd(0-7 to GS)' },
    { from: 'EI', to: A_148, delay: 'tpd(EI to A0-A2)' },
    { from: 'EI', to: 'GS', delay: 'tpd(EI to GS)' },
    { from: 'EI', to: 'EO', delay: 'tpd(EI to EO)' },
  ],
};

// Outcome bits of the 148: A0, A1, A2, GS, EO.
const ALL_148 = 0b11111;
const DISABLED_148 = 0b11111;
const IDLE_148 = 0b01111; // enabled, no input active: EO low
const winner148 = (n: number) => (~n & 0b111) | 0b10000; // GS low, EO high

/**
 * EI high: every output high. EI low: the highest active (low) input wins, A is its number
 * inverted and GS low; with no input active, EO goes low (to enable the next, lower-priority
 * chip). Unknown inputs or EI make `X` only the outputs the possible outcomes disagree on.
 */
const encoder148Behavior: ChipBehavior = (pinList, delays) => {
  const paths = pathDelays(pinList, delays, ENCODER148_SPEC.paths);
  const inputs = pinIndices(pinList, DATA_148);
  const outputs = pinIndices(pinList, 'A0, A1, A2, GS, EO');
  const EI = pinIndices(pinList, 'EI')[0]!;

  const evaluate = (ctx: EvalContext<undefined>) => {
    const ei = toInput(ctx.read(EI));
    let seen: Outcomes = ei === Level.L0 ? NONE : merge(NONE, DISABLED_148, ALL_148);
    if (ei !== Level.L1) {
      let decided = false;
      for (let n = 7; n >= 0 && !decided; n--) {
        const level = toInput(ctx.read(inputs[n]!));
        if (level === Level.L1) continue;
        seen = merge(seen, winner148(n), ALL_148);
        decided = level === Level.L0;
      }
      if (!decided) seen = merge(seen, IDLE_148, ALL_148);
    }
    for (let bit = 0; bit < 5; bit++) {
      const out = outputs[bit]!;
      ctx.drive(out, strong(outcomeLevel(seen, bit)), paths.delay(ctx, out));
    }
  };
  return () => ({ evaluate });
};

/** The 147 and 148 of a family. */
export function encoderChips(family: LogicFamily): AnyComponentDefinition[] {
  return [
    chipDefinition(ENCODER147_SPEC, family, encoder147Behavior),
    chipDefinition(ENCODER148_SPEC, family, encoder148Behavior),
  ];
}

/** 74HC147, 74HC148. */
export const hcEncoders = encoderChips(HC);
