/**
 * 74xx138 and 74xx139 decoders/demultiplexers: pinouts and function tables transcribed from the
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

/** One decoder section: its enables, address inputs (bit 0 first) and outputs (Y0 first). */
interface DecoderSection {
  readonly enableLow: string;
  readonly enableHigh?: string;
  readonly address: string;
  readonly outputs: string;
}

export interface DecoderSpec extends ChipSpec {
  readonly sections: readonly DecoderSection[];
  readonly paths: readonly DelayPath[];
}

const GND_16 = pins('GND', '8', 'power', 'ground (0 V)');

export const DECODER_SPECS: readonly DecoderSpec[] = [
  {
    number: '138',
    title: '3-to-8 line decoder/demultiplexer; inverting',
    keywords: ['decoder', 'demultiplexer', 'demux', 'address', '3-to-8', 'chip select'],
    pinCount: 16,
    pins: [
      pins('A0, A1, A2', '1, 2, 3', 'in', 'address input'),
      pins('E1, E2', '4, 5', 'in', 'enable input (active LOW)', { activeLow: true }),
      pins('E3', '6', 'in', 'enable input (active HIGH)'),
      pins('Y0, Y1, Y2, Y3, Y4, Y5, Y6, Y7', '15, 14, 13, 12, 11, 10, 9, 7', 'out', 'output', {
        activeLow: true,
      }),
      GND_16,
      pins('VCC', '16', 'power', 'supply voltage'),
    ],
    functionTable: {
      inputs: ['E1', 'E2', 'E3', 'A2', 'A1', 'A0'],
      outputs: ['Y7', 'Y6', 'Y5', 'Y4', 'Y3', 'Y2', 'Y1', 'Y0'],
      rows: [
        'H X X X X X | H H H H H H H H',
        'X H X X X X | H H H H H H H H',
        'X X L X X X | H H H H H H H H',
        'L L H L L L | H H H H H H H L',
        'L L H L L H | H H H H H H L H',
        'L L H L H L | H H H H H L H H',
        'L L H L H H | H H H H L H H H',
        'L L H H L L | H H H L H H H H',
        'L L H H L H | H H L H H H H H',
        'L L H H H L | H L H H H H H H',
        'L L H H H H | L H H H H H H H',
      ],
    },
    sections: [
      {
        enableLow: 'E1, E2',
        enableHigh: 'E3',
        address: 'A0, A1, A2',
        outputs: 'Y0, Y1, Y2, Y3, Y4, Y5, Y6, Y7',
      },
    ],
    paths: [
      { from: 'A0, A1, A2', to: 'Y0, Y1, Y2, Y3, Y4, Y5, Y6, Y7', delay: 'tpd(An to Yn)' },
      { from: 'E3', to: 'Y0, Y1, Y2, Y3, Y4, Y5, Y6, Y7', delay: 'tpd(E3 to Yn)' },
      { from: 'E1, E2', to: 'Y0, Y1, Y2, Y3, Y4, Y5, Y6, Y7', delay: 'tpd(En to Yn)' },
    ],
  },
  {
    number: '139',
    title: 'Dual 2-to-4 line decoder/demultiplexer',
    keywords: ['decoder', 'demultiplexer', 'demux', 'address', '2-to-4', 'chip select', 'dual'],
    pinCount: 16,
    pins: [
      pins('1E, 2E', '1, 15', 'in', 'enable input (active LOW)', { activeLow: true }),
      pins('1A0, 1A1', '2, 3', 'in', 'address input'),
      pins('1Y0, 1Y1, 1Y2, 1Y3', '4, 5, 6, 7', 'out', 'output (active LOW)', { activeLow: true }),
      GND_16,
      pins('2Y0, 2Y1, 2Y2, 2Y3', '12, 11, 10, 9', 'out', 'output (active LOW)', {
        activeLow: true,
      }),
      pins('2A0, 2A1', '14, 13', 'in', 'address input'),
      pins('VCC', '16', 'power', 'positive supply voltage'),
    ],
    units: [1, 2].map((n, i) => ({
      name: 'AB'[i]!,
      pins: [`${n}E`, `${n}A1`, `${n}A0`, `${n}Y3`, `${n}Y2`, `${n}Y1`, `${n}Y0`],
    })),
    functionTable: {
      inputs: ['nE', 'nA1', 'nA0'],
      outputs: ['nY3', 'nY2', 'nY1', 'nY0'],
      rows: [
        'H X X | H H H H',
        'L L L | H H H L',
        'L L H | H H L H',
        'L H L | H L H H',
        'L H H | L H H H',
      ],
      note: 'each decoder (n = 1, 2)',
    },
    sections: [1, 2].map((n) => ({
      enableLow: `${n}E`,
      address: `${n}A0, ${n}A1`,
      outputs: `${n}Y0, ${n}Y1, ${n}Y2, ${n}Y3`,
    })),
    paths: [1, 2].flatMap((n) => [
      { from: `${n}A0, ${n}A1`, to: `${n}Y0, ${n}Y1, ${n}Y2, ${n}Y3`, delay: 'tpd(nAn to nYn)' },
      { from: `${n}E`, to: `${n}Y0, ${n}Y1, ${n}Y2, ${n}Y3`, delay: 'tpd(nE to nYn)' },
    ]),
  },
];

/**
 * Output n of a section is low (active) when the section is enabled and the address is n. 4-state:
 * an unknown address bit makes `X` only the outputs it could select (the others stay high); an
 * unknown enable makes the addressed output `X`. Every output is driven on every call.
 */
function decoderBehavior(spec: DecoderSpec): ChipBehavior {
  return (pinList, delays) => {
    const paths = pathDelays(pinList, delays, spec.paths);
    const sections = spec.sections.map((s) => ({
      enableLow: pinIndices(pinList, s.enableLow),
      enableHigh: s.enableHigh ? pinIndices(pinList, s.enableHigh) : new Int32Array(0),
      address: pinIndices(pinList, s.address),
      outputs: pinIndices(pinList, s.outputs),
    }));

    const evaluate = (ctx: EvalContext<undefined>) => {
      for (const { enableLow, enableHigh, address, outputs } of sections) {
        let enabled: Level = Level.L1;
        for (const pin of enableLow) enabled = and(enabled, not(ctx.read(pin)));
        for (const pin of enableHigh) enabled = and(enabled, toInput(ctx.read(pin)));
        for (let n = 0; n < outputs.length; n++) {
          let active = enabled;
          for (let bit = 0; bit < address.length; bit++) {
            const a = ctx.read(address[bit]!);
            active = and(active, (n >> bit) & 1 ? toInput(a) : not(a));
          }
          const y = outputs[n]!;
          ctx.drive(y, strong(not(active)), paths.delay(ctx, y));
        }
      }
    };
    return () => ({ evaluate });
  };
}

/** The decoders of a family. */
export function decoderChips(family: LogicFamily): AnyComponentDefinition[] {
  return DECODER_SPECS.map((spec) => chipDefinition(spec, family, decoderBehavior(spec)));
}

/** 74HC138, 74HC139. */
export const hcDecoders = decoderChips(HC);
