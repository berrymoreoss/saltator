/**
 * 74xx 3-state buffers (125, 126, 240, 244): pinouts and function tables transcribed from the
 * Nexperia data sheets (tables 2 and 3). Spec: docs/components.md#74xx-chips.
 */
import {
  type AnyComponentDefinition,
  Drive,
  type EvalContext,
  Level,
  not,
  pinIndex,
  strong,
  toInput,
  type UnitDef,
} from '../../core';
import { type ChipBehavior, type ChipSpec, chipDefinition, delay, type LogicFamily } from './chip';
import { HC } from './hc-timing';
import { pins } from './pinout';

export interface BufferSpec extends ChipSpec {
  /** Level of an output enable pin that enables its buffers. */
  readonly enable: 'low' | 'high';
  /** Outputs inverted (240). */
  readonly invert: boolean;
  /** Every buffer: its enable, input and output pin (an enable may be shared by several). */
  readonly buffers: readonly (readonly [oe: string, a: string, y: string])[];
}

/**
 * Behavior of a buffer chip. Enabled: Y = A (inverted for 240) after `tpd`, or after `ten` when
 * the enable has just become active; disabled: released after `tdis`; enable unknown or
 * floating: strong `X` (it might be driving), as `prim/tristate-buffer`. Every buffer is
 * re-evaluated on each call, as for gates.
 */
function bufferBehavior(spec: BufferSpec): ChipBehavior {
  return (pinList, delays) => {
    const tpd = delay(delays, 'tpd');
    const ten = delay(delays, 'ten');
    const tdis = delay(delays, 'tdis');
    const count = spec.buffers.length;
    const oe = new Int32Array(count);
    const a = new Int32Array(count);
    const y = new Int32Array(count);
    spec.buffers.forEach(([enable, input, output], b) => {
      oe[b] = pinIndex(pinList, enable);
      a[b] = pinIndex(pinList, input);
      y[b] = pinIndex(pinList, output);
    });
    const on = spec.enable === 'low' ? Level.L0 : Level.L1;
    const off = spec.enable === 'low' ? Level.L1 : Level.L0;
    const invert = spec.invert;

    const update = (ctx: EvalContext<undefined>, b: number, enableChanged: boolean) => {
      const enable = ctx.read(oe[b]!);
      if (enable === off) {
        ctx.drive(y[b]!, Drive.Z, tdis);
        return;
      }
      const drive =
        enable === on
          ? strong(invert ? not(ctx.read(a[b]!)) : toInput(ctx.read(a[b]!)))
          : Drive.STRONG_X;
      ctx.drive(y[b]!, drive, enableChanged ? ten : tpd);
    };
    const evaluate = (ctx: EvalContext<undefined>) => {
      for (let b = 0; b < count; b++) update(ctx, b, ctx.changed(oe[b]!));
    };
    return () => ({ evaluate });
  };
}

const quadPins = (enable: string) => [
  pins('1OE, 2OE, 3OE, 4OE', '1, 4, 10, 13', 'in', enable, { activeLow: enable.includes('LOW') }),
  pins('1A, 2A, 3A, 4A', '2, 5, 9, 12', 'in', 'data input'),
  pins('1Y, 2Y, 3Y, 4Y', '3, 6, 8, 11', 'tristate', 'data output'),
  pins('GND', '7', 'power', 'ground (0 V)'),
  pins('VCC', '14', 'power', 'supply voltage'),
];
const QUAD_BUFFERS = [1, 2, 3, 4].map((n) => [`${n}OE`, `${n}A`, `${n}Y`] as const);
const QUAD_UNITS: UnitDef[] = QUAD_BUFFERS.map((buffer, i) => ({
  name: 'ABCD'[i]!,
  pins: [...buffer],
}));

const OCTAL_PINS = [
  pins('1OE, 2OE', '1, 19', 'in', 'output enable input (active LOW)', { activeLow: true }),
  pins('1A0, 1A1, 1A2, 1A3', '2, 4, 6, 8', 'in', 'data input'),
  pins('2Y0, 2Y1, 2Y2, 2Y3', '3, 5, 7, 9', 'tristate', 'bus output'),
  pins('GND', '10', 'power', 'ground (0 V)'),
  pins('2A0, 2A1, 2A2, 2A3', '17, 15, 13, 11', 'in', 'data input'),
  pins('1Y0, 1Y1, 1Y2, 1Y3', '18, 16, 14, 12', 'tristate', 'bus output'),
  pins('VCC', '20', 'power', 'supply voltage'),
];
const BITS = [0, 1, 2, 3];
const OCTAL_BUFFERS = [1, 2].flatMap((g) =>
  BITS.map((n) => [`${g}OE`, `${g}A${n}`, `${g}Y${n}`] as const),
);
const OCTAL_UNITS: UnitDef[] = [1, 2].map((g) => ({
  name: 'AB'[g - 1]!,
  pins: [`${g}OE`, ...BITS.map((n) => `${g}A${n}`), ...BITS.map((n) => `${g}Y${n}`)],
}));

/** Every buffer chip's function, as in its datasheet. */
export const BUFFER_SPECS: readonly BufferSpec[] = [
  {
    number: '125',
    title: 'Quad buffer/line driver; 3-state',
    keywords: ['buffer', 'line driver', 'tri-state', '3-state', 'three-state', 'bus', 'quad'],
    enable: 'low',
    invert: false,
    pinCount: 14,
    pins: quadPins('output enable input (active LOW)'),
    buffers: QUAD_BUFFERS,
    units: QUAD_UNITS,
    functionTable: {
      inputs: ['nOE', 'nA'],
      outputs: ['nY'],
      rows: ['L L | L', 'L H | H', 'H X | Z'],
      note: 'each buffer (n = 1 to 4)',
    },
  },
  {
    number: '126',
    title: 'Quad buffer/line driver; 3-state',
    keywords: ['buffer', 'line driver', 'tri-state', '3-state', 'three-state', 'bus', 'quad'],
    enable: 'high',
    invert: false,
    pinCount: 14,
    pins: quadPins('data enable input (active HIGH)'),
    buffers: QUAD_BUFFERS,
    units: QUAD_UNITS,
    functionTable: {
      inputs: ['nOE', 'nA'],
      outputs: ['nY'],
      rows: ['H L | L', 'H H | H', 'L X | Z'],
      note: 'each buffer (n = 1 to 4)',
    },
  },
  {
    number: '240',
    title: 'Octal buffer/line driver; 3-state; inverting',
    keywords: ['buffer', 'line driver', 'inverting', 'tri-state', '3-state', 'bus', 'octal'],
    enable: 'low',
    invert: true,
    pinCount: 20,
    pins: OCTAL_PINS,
    buffers: OCTAL_BUFFERS,
    units: OCTAL_UNITS,
    functionTable: {
      inputs: ['nOE', 'nAn'],
      outputs: ['nYn'],
      rows: ['L L | H', 'L H | L', 'H X | Z'],
      note: 'each buffer (groups n = 1, 2; bits 0 to 3)',
    },
  },
  {
    number: '244',
    title: 'Octal buffer/line driver; 3-state',
    keywords: ['buffer', 'line driver', 'tri-state', '3-state', 'bus', 'octal'],
    enable: 'low',
    invert: false,
    pinCount: 20,
    pins: OCTAL_PINS,
    buffers: OCTAL_BUFFERS,
    units: OCTAL_UNITS,
    functionTable: {
      inputs: ['nOE', 'nAn'],
      outputs: ['nYn'],
      rows: ['L L | L', 'L H | H', 'H X | Z'],
      note: 'each buffer (groups n = 1, 2; bits 0 to 3)',
    },
  },
];

/** The buffer chips of a family. */
export function bufferChips(family: LogicFamily): AnyComponentDefinition[] {
  return BUFFER_SPECS.map((spec) => chipDefinition(spec, family, bufferBehavior(spec)));
}

/** 74HC125 … 74HC244. */
export const hcBuffers = bufferChips(HC);
