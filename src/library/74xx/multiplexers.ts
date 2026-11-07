/**
 * 74xx151, 153, 157 and 158 multiplexers: pinouts and function tables transcribed from the
 * Nexperia data sheets (tables 2 and 3). Spec: docs/components.md#74xx-chips-74xx.
 */
import {
  type AnyComponentDefinition,
  and,
  type EvalContext,
  Level,
  not,
  strong,
  toInput,
} from '../../core';
import {
  type ChipBehavior,
  type ChipSpec,
  chipDefinition,
  type LogicFamily,
  pinIndices,
} from './chip';
import { HC } from './hc-timing';
import { type DelayPath, pathDelays } from './paths';
import { pins } from './pinout';

/** One multiplexer: data inputs (I0 first) picked by select inputs (S0 first) to one output. */
interface MuxSection {
  /** Enable input, active LOW; disabled, the output goes to its inactive level. */
  readonly enable: string;
  readonly select: string;
  readonly data: string;
  readonly output: string;
  /** The complementary output, if the chip has one (151). */
  readonly complement?: string;
}

export interface MuxSpec extends ChipSpec {
  readonly sections: readonly MuxSection[];
  /** Outputs inverted (158): disabled they are high. */
  readonly inverting: boolean;
  readonly paths: readonly DelayPath[];
}

const GND_16 = pins('GND', '8', 'power', 'ground (0 V)');
const QUAD = [1, 2, 3, 4];
const quad = (f: (n: number) => string) => QUAD.map(f).join(', ');

/** The quad 2-input multiplexers 157 and 158: same pinout, 158 inverting. */
function quad2Input(number: '157' | '158'): MuxSpec {
  const inverting = number === '158';
  const out = inverting ? 'H' : 'L';
  const inv = (level: 'L' | 'H') => (inverting ? (level === 'L' ? 'H' : 'L') : level);
  return {
    number,
    title: inverting ? 'Quad 2-input multiplexer; inverting' : 'Quad 2-input multiplexer',
    keywords: [
      'multiplexer',
      'mux',
      'data selector',
      '2-to-1',
      'quad',
      ...(inverting ? ['inverting'] : []),
    ],
    pinCount: 16,
    pins: inverting
      ? [
          pins('S', '1', 'in', 'common data select input'),
          ...QUAD.flatMap((n) => {
            const [i0, i1, y] = [
              [2, 3, 4],
              [5, 6, 7],
              [11, 10, 9],
              [14, 13, 12],
            ][n - 1]!;
            return [
              pins(`${n}I0`, `${i0}`, 'in', `data input ${n} from source 0`),
              pins(`${n}I1`, `${i1}`, 'in', `data input ${n} from source 1`),
              pins(`${n}Y`, `${y}`, 'out', `multiplexer output ${n}`, { activeLow: true }),
            ];
          }),
          GND_16,
          pins('E', '15', 'in', 'enable input (active LOW)', { activeLow: true }),
          pins('VCC', '16', 'power', 'positive supply voltage'),
        ]
      : [
          pins('S', '1', 'in', 'common data select input'),
          pins(
            quad((n) => `${n}I0`),
            '2, 5, 11, 14',
            'in',
            'data inputs from source 0',
          ),
          pins(
            quad((n) => `${n}I1`),
            '3, 6, 10, 13',
            'in',
            'data inputs from source 1',
          ),
          pins(
            quad((n) => `${n}Y`),
            '4, 7, 9, 12',
            'out',
            'multiplexer outputs',
          ),
          GND_16,
          pins('E', '15', 'in', 'enable input (active LOW)', { activeLow: true }),
          pins('VCC', '16', 'power', 'supply voltage'),
        ],
    functionTable: {
      inputs: ['E', 'S', 'nI0', 'nI1'],
      outputs: ['nY'],
      rows: [
        `H X X X | ${out}`,
        `L L L X | ${inv('L')}`,
        `L L H X | ${inv('H')}`,
        `L H X L | ${inv('L')}`,
        `L H X H | ${inv('H')}`,
      ],
      note: 'each multiplexer (n = 1 to 4)',
    },
    sections: QUAD.map((n) => ({
      enable: 'E',
      select: 'S',
      data: `${n}I0, ${n}I1`,
      output: `${n}Y`,
    })),
    inverting,
    paths: [
      ...QUAD.map((n) => ({ from: `${n}I0, ${n}I1`, to: `${n}Y`, delay: 'tpd(nI0, nI1 to nY)' })),
      { from: 'S', to: quad((n) => `${n}Y`), delay: 'tpd(S to nY)' },
      { from: 'E', to: quad((n) => `${n}Y`), delay: 'tpd(E to nY)' },
    ],
  };
}

export const MUX_SPECS: readonly MuxSpec[] = [
  {
    number: '151',
    title: '8-input multiplexer',
    keywords: ['multiplexer', 'mux', 'data selector', '8-to-1'],
    pinCount: 16,
    pins: [
      pins('I0, I1, I2, I3, I4, I5, I6, I7', '4, 3, 2, 1, 15, 14, 13, 12', 'in', 'data inputs'),
      pins('Y', '5', 'out', 'multiplexer output'),
      // The data sheet's symbol is Y with an overline, like pin 5's: named YN, drawn as Y̅.
      pins('YN', '6', 'out', 'complementary multiplexer output', { activeLow: true, label: 'Y' }),
      pins('E', '7', 'in', 'enable input (active LOW)', { activeLow: true }),
      GND_16,
      pins('S0, S1, S2', '11, 10, 9', 'in', 'common data select inputs'),
      pins('VCC', '16', 'power', 'supply voltage'),
    ],
    functionTable: {
      inputs: ['E', 'S2', 'S1', 'S0', 'I0', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'],
      outputs: ['YN', 'Y'],
      rows: [
        'H X X X X X X X X X X X | H L',
        'L L L L L X X X X X X X | H L',
        'L L L L H X X X X X X X | L H',
        'L L L H X L X X X X X X | H L',
        'L L L H X H X X X X X X | L H',
        'L L H L X X L X X X X X | H L',
        'L L H L X X H X X X X X | L H',
        'L L H H X X X L X X X X | H L',
        'L L H H X X X H X X X X | L H',
        'L H L L X X X X L X X X | H L',
        'L H L L X X X X H X X X | L H',
        'L H L H X X X X X L X X | H L',
        'L H L H X X X X X H X X | L H',
        'L H H L X X X X X X L X | H L',
        'L H H L X X X X X X H X | L H',
        'L H H H X X X X X X X L | H L',
        'L H H H X X X X X X X H | L H',
      ],
    },
    sections: [
      {
        enable: 'E',
        select: 'S0, S1, S2',
        data: 'I0, I1, I2, I3, I4, I5, I6, I7',
        output: 'Y',
        complement: 'YN',
      },
    ],
    inverting: false,
    paths: [
      { from: 'I0, I1, I2, I3, I4, I5, I6, I7', to: 'Y', delay: 'tpd(In to Y)' },
      { from: 'I0, I1, I2, I3, I4, I5, I6, I7', to: 'YN', delay: 'tpd(In to YN)' },
      { from: 'S0, S1, S2', to: 'Y', delay: 'tpd(Sn to Y)' },
      { from: 'S0, S1, S2', to: 'YN', delay: 'tpd(Sn to YN)' },
      { from: 'E', to: 'Y', delay: 'tpd(E to Y)' },
      { from: 'E', to: 'YN', delay: 'tpd(E to YN)' },
    ],
  },
  {
    number: '153',
    title: 'Dual 4-input multiplexer',
    keywords: ['multiplexer', 'mux', 'data selector', '4-to-1', 'dual'],
    pinCount: 16,
    pins: [
      pins('1E, 2E', '1, 15', 'in', 'output enable inputs (active LOW)', { activeLow: true }),
      pins('S0, S1', '14, 2', 'in', 'data select inputs'),
      pins('1I0, 1I1, 1I2, 1I3', '6, 5, 4, 3', 'in', 'data inputs source 1'),
      pins('1Y', '7', 'out', 'multiplexer output source 1'),
      GND_16,
      pins('2Y', '9', 'out', 'multiplexer output source 2'),
      pins('2I0, 2I1, 2I2, 2I3', '10, 11, 12, 13', 'in', 'data inputs source 2'),
      pins('VCC', '16', 'power', 'supply voltage'),
    ],
    functionTable: {
      inputs: ['S0', 'S1', 'nI0', 'nI1', 'nI2', 'nI3', 'nE'],
      outputs: ['nY'],
      rows: [
        'X X X X X X H | L',
        'L L L X X X L | L',
        'L L H X X X L | H',
        'H L X L X X L | L',
        'H L X H X X L | H',
        'L H X X L X L | L',
        'L H X X H X L | H',
        'H H X X X L L | L',
        'H H X X X H L | H',
      ],
      note: 'each multiplexer (n = 1, 2)',
    },
    sections: [1, 2].map((n) => ({
      enable: `${n}E`,
      select: 'S0, S1',
      data: `${n}I0, ${n}I1, ${n}I2, ${n}I3`,
      output: `${n}Y`,
    })),
    inverting: false,
    paths: [1, 2].flatMap((n) => [
      { from: `${n}I0, ${n}I1, ${n}I2, ${n}I3`, to: `${n}Y`, delay: 'tpd(nIn to nY)' },
      { from: 'S0, S1', to: `${n}Y`, delay: 'tpd(Sn to nY)' },
      { from: `${n}E`, to: `${n}Y`, delay: 'tpd(nE to nY)' },
    ]),
  },
  quad2Input('157'),
  quad2Input('158'),
];

/**
 * The data input the select inputs pick, 4-state and as precise as the inputs allow: with an
 * unknown select bit, the value the possible inputs agree on, `X` if they differ (a 157 with
 * S = X and I0 = I1 = 1 gives 1). Floating inputs read as `X` (and are reported).
 */
function selected(ctx: EvalContext<undefined>, select: Int32Array, data: Int32Array): Level {
  let known = 0; // select bits that are 0 or 1
  let value = 0; // their values
  for (let bit = 0; bit < select.length; bit++) {
    const s = ctx.read(select[bit]!);
    if (s === Level.L0 || s === Level.L1) {
      known |= 1 << bit;
      value |= s << bit;
    }
  }
  let result: Level | undefined;
  for (let n = 0; n < data.length; n++) {
    if ((n & known) !== value) continue;
    const level = toInput(ctx.read(data[n]!));
    if (result === undefined) result = level;
    else if (result !== level) return Level.X;
  }
  return result ?? Level.X;
}

/**
 * Enabled (E low), each output is its selected data input (inverted on the 158), the 151's
 * complement its inverse; disabled, the outputs go low (high on the 158); an unknown enable gives
 * `X` unless the output would be at its disabled level anyway. Every output on every call.
 */
function muxBehavior(spec: MuxSpec): ChipBehavior {
  return (pinList, delays) => {
    const paths = pathDelays(pinList, delays, spec.paths);
    const sections = spec.sections.map((s) => ({
      enable: pinIndices(pinList, s.enable)[0]!,
      select: pinIndices(pinList, s.select),
      data: pinIndices(pinList, s.data),
      output: pinIndices(pinList, s.output)[0]!,
      complement: s.complement ? pinIndices(pinList, s.complement)[0]! : -1,
    }));
    const inverting = spec.inverting;

    const evaluate = (ctx: EvalContext<undefined>) => {
      for (const { enable, select, data, output, complement } of sections) {
        const y = and(not(ctx.read(enable)), selected(ctx, select, data));
        ctx.drive(output, strong(inverting ? not(y) : y), paths.delay(ctx, output));
        if (complement >= 0) ctx.drive(complement, strong(not(y)), paths.delay(ctx, complement));
      }
    };
    return () => ({ evaluate });
  };
}

/** The multiplexers of a family. */
export function muxChips(family: LogicFamily): AnyComponentDefinition[] {
  return MUX_SPECS.map((spec) => chipDefinition(spec, family, muxBehavior(spec)));
}

/** 74HC151, 153, 157, 158. */
export const hcMultiplexers = muxChips(HC);
