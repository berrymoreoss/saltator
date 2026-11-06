/**
 * 74xx245 octal bus transceiver: pinout and function table transcribed from the Nexperia data
 * sheet (tables 2 and 3). Spec: docs/components.md#74xx-chips.
 */
import {
  type AnyComponentDefinition,
  Drive,
  type EvalContext,
  Level,
  pinIndex,
  strong,
  toInput,
} from '../../core';
import { type ChipBehavior, type ChipSpec, chipDefinition, delay, type LogicFamily } from './chip';
import { HC } from './hc-timing';
import { pins } from './pinout';

const BITS = [0, 1, 2, 3, 4, 5, 6, 7];

export const TRANSCEIVER_SPEC: ChipSpec = {
  number: '245',
  title: 'Octal bus transceiver; 3-state',
  keywords: ['transceiver', 'bus', 'bidirectional', 'tri-state', '3-state', 'buffer', 'octal'],
  pinCount: 20,
  pins: [
    pins('DIR', '1', 'in', 'direction control'),
    pins('A0, A1, A2, A3, A4, A5, A6, A7', '2, 3, 4, 5, 6, 7, 8, 9', 'bidir', 'data input/output'),
    pins('GND', '10', 'power', 'ground (0 V)'),
    pins(
      'B7, B6, B5, B4, B3, B2, B1, B0',
      '11, 12, 13, 14, 15, 16, 17, 18',
      'bidir',
      'data input/output',
    ),
    pins('OE', '19', 'in', 'output enable input (active LOW)', { activeLow: true }),
    pins('VCC', '20', 'power', 'supply voltage'),
  ],
  functionTable: {
    inputs: ['OE', 'DIR'],
    outputs: ['An', 'Bn'],
    rows: ['L L | A=B input', 'L H | input B=A', 'H X | Z Z'],
    note: 'each bit (n = 0 to 7)',
  },
};

/**
 * `OE` high: both ports released (`tdis`). `OE` low: `DIR` high drives B from A and releases A,
 * `DIR` low drives A from B and releases B; the port that starts driving uses `ten`, data changes
 * `tpd`. `OE` or `DIR` unknown: every port that might be an output drives `X`. Only the input
 * port is read, so a floating input bus is reported and an idle output bus is not.
 */
const transceiverBehavior: ChipBehavior = (pinList, delays) => {
  const tpd = delay(delays, 'tpd');
  const ten = delay(delays, 'ten');
  const tdis = delay(delays, 'tdis');
  const OE = pinIndex(pinList, 'OE');
  const DIR = pinIndex(pinList, 'DIR');
  const a = Int32Array.from(BITS, (n) => pinIndex(pinList, `A${n}`));
  const b = Int32Array.from(BITS, (n) => pinIndex(pinList, `B${n}`));

  const update = (
    ctx: EvalContext<undefined>,
    n: number,
    oe: Level,
    dir: Level,
    control: boolean,
  ) => {
    const enable = control ? ten : tpd;
    if (oe === Level.L1) {
      ctx.drive(a[n]!, Drive.Z, tdis);
      ctx.drive(b[n]!, Drive.Z, tdis);
    } else if (oe === Level.L0 && dir === Level.L1) {
      ctx.drive(a[n]!, Drive.Z, tdis);
      ctx.drive(b[n]!, strong(toInput(ctx.read(a[n]!))), enable);
    } else if (oe === Level.L0 && dir === Level.L0) {
      ctx.drive(b[n]!, Drive.Z, tdis);
      ctx.drive(a[n]!, strong(toInput(ctx.read(b[n]!))), enable);
    } else {
      ctx.drive(
        a[n]!,
        dir === Level.L1 ? Drive.Z : Drive.STRONG_X,
        dir === Level.L1 ? tdis : enable,
      );
      ctx.drive(
        b[n]!,
        dir === Level.L0 ? Drive.Z : Drive.STRONG_X,
        dir === Level.L0 ? tdis : enable,
      );
    }
  };
  const evaluate = (ctx: EvalContext<undefined>) => {
    const oe = ctx.read(OE);
    const dir = ctx.read(DIR);
    const control = ctx.changed(OE) || ctx.changed(DIR);
    for (let n = 0; n < 8; n++) update(ctx, n, oe, dir, control);
  };
  return () => ({ evaluate });
};

/** The 245 of a family. */
export function transceiverChip(family: LogicFamily): AnyComponentDefinition {
  return chipDefinition(TRANSCEIVER_SPEC, family, transceiverBehavior);
}

/** 74HC245. */
export const hc245 = transceiverChip(HC);
