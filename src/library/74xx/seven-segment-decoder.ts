/**
 * 74xx4511 BCD to 7-segment latch/decoder/driver: pinout and function table transcribed from the
 * Nexperia data sheet (tables 2 and 3). Spec: docs/components.md#74xx-chips-74xx.
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
import { merge, NO_OUTCOME, outcomeLevel } from './outcomes';
import { type DelayPath, pathDelays } from './paths';
import { pins } from './pinout';

const SEGMENTS = 'a, b, c, d, e, f, g';

export const BCD_DECODER_SPEC: ChipSpec & { readonly paths: readonly DelayPath[] } = {
  number: '4511',
  title: 'BCD to 7-segment latch/decoder/driver',
  keywords: ['bcd', '7-segment', 'seven segment', 'decoder', 'display driver', 'latch', 'digit'],
  pinCount: 16,
  pins: [
    pins('LT', '3', 'in', 'lamp test input (active LOW)', { activeLow: true }),
    pins('BI', '4', 'in', 'ripple blanking input (active LOW)', { activeLow: true }),
    pins('LE', '5', 'in', 'latch enable input (active LOW)', { activeLow: true }),
    pins('A, B, C, D', '7, 1, 2, 6', 'in', 'BCD address inputs'),
    pins('GND', '8', 'power', 'ground (0 V)'),
    pins(SEGMENTS, '13, 12, 11, 10, 9, 15, 14', 'out', 'segments outputs'),
    pins('VCC', '16', 'power', 'supply voltage'),
  ],
  functionTable: {
    inputs: ['LE', 'BI', 'LT', 'D', 'C', 'B', 'A'],
    outputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'Display'],
    rows: [
      'X X L X X X X | H H H H H H H 8',
      'X L H X X X X | L L L L L L L blank',
      'L H H L L L L | H H H H H H L 0',
      'L H H L L L H | L H H L L L L 1',
      'L H H L L H L | H H L H H L H 2',
      'L H H L L H H | H H H H L L H 3',
      'L H H L H L L | L H H L L H H 4',
      'L H H L H L H | H L H H L H H 5',
      'L H H L H H L | L L H H H H H 6',
      'L H H L H H H | H H H L L L L 7',
      'L H H H L L L | H H H H H H H 8',
      'L H H H L L H | H H H L L H H 9',
      'L H H H L H L | L L L L L L L blank',
      'L H H H L H H | L L L L L L L blank',
      'L H H H H L L | L L L L L L L blank',
      'L H H H H L H | L L L L L L L blank',
      'L H H H H H L | L L L L L L L blank',
      'L H H H H H H | L L L L L L L blank',
    ],
    note: 'LE = H: the code latched at the LOW-to-HIGH transition of LE',
  },
  paths: [
    { from: 'A, B, C, D', to: SEGMENTS, delay: 'tpd(A-D to a-g)' },
    { from: 'LE', to: SEGMENTS, delay: 'tpd(LE to a-g)' },
    { from: 'BI', to: SEGMENTS, delay: 'tpd(BI to a-g)' },
    { from: 'LT', to: SEGMENTS, delay: 'tpd(LT to a-g)' },
  ],
};

/** Lit segments of codes 0–15, bit 0 = a … bit 6 = g, from the function table (6 and 9 without tails). */
const PATTERNS = [
  0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111100, 0b0000111, 0b1111111,
  0b1100111, 0, 0, 0, 0, 0, 0,
];
const ALL = 0b1111111;

/** State of a 4511: the latched code, bit 0 (A) first; `X` where unknown when latched. */
export interface BcdDecoderState {
  latched: Level[];
}

/**
 * LE low: transparent; LE high: holds the code it had when LE rose (a code arriving at that very
 * instant is not taken: hold time 0). LT low lights every segment; else BI low blanks them;
 * else the latched code is decoded, codes 10–15 blank. Unknowns make `X` only the segments the
 * possible displays disagree on; an unknown LE latches `X` where the input and the held bit
 * differ.
 */
const bcdDecoderBehavior: ChipBehavior<BcdDecoderState> = (pinList, delays) => {
  const paths = pathDelays(pinList, delays, BCD_DECODER_SPEC.paths);
  const code = pinIndices(pinList, 'A, B, C, D');
  const segments = pinIndices(pinList, SEGMENTS);
  const [LT, BI, LE] = pinIndices(pinList, 'LT, BI, LE') as unknown as [number, number, number];

  const evaluate = (ctx: EvalContext<BcdDecoderState>) => {
    const latched = ctx.state.latched;
    const le = toInput(ctx.read(LE));
    if (le !== Level.L1) {
      for (let n = 0; n < 4; n++) {
        const d = toInput(ctx.read(code[n]!));
        latched[n] = le === Level.L0 || latched[n] === d ? d : Level.X;
      }
    }
    // Every display the inputs allow, merged: segments they disagree on are X.
    let seen = NO_OUTCOME;
    const lt = toInput(ctx.read(LT));
    const bi = toInput(ctx.read(BI));
    if (lt !== Level.L1) seen = merge(seen, ALL, ALL);
    if (lt !== Level.L0) {
      if (bi !== Level.L1) seen = merge(seen, 0, ALL);
      if (bi !== Level.L0) {
        let known = 0;
        let value = 0;
        for (let n = 0; n < 4; n++) {
          const bit = latched[n]!;
          if (bit === Level.L0 || bit === Level.L1) {
            known |= 1 << n;
            value |= bit << n;
          }
        }
        for (let c = 0; c < 16; c++)
          if ((c & known) === value) seen = merge(seen, PATTERNS[c]!, ALL);
      }
    }
    for (let s = 0; s < 7; s++) {
      const out = segments[s]!;
      ctx.drive(out, strong(outcomeLevel(seen, s)), paths.delay(ctx, out));
    }
  };
  return () => ({
    createState: () => ({ latched: [Level.X, Level.X, Level.X, Level.X] }),
    evaluate,
  });
};

/** The 4511 of a family. */
export function bcdDecoderChip(family: LogicFamily): AnyComponentDefinition {
  return chipDefinition(BCD_DECODER_SPEC, family, bcdDecoderBehavior);
}

/** 74HC4511. */
export const hc4511 = bcdDecoderChip(HC);
