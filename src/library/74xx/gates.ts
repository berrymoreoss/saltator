/**
 * 74xx gate chips (00, 02, 04, 08, 10, 11, 14, 20, 21, 27, 30, 32, 86): pinouts and function
 * tables transcribed from the Nexperia data sheets (tables 2 and 3), behavior shared with every
 * family. Spec: docs/components.md#74xx-chips.
 */
import {
  type AnyComponentDefinition,
  and,
  type EvalContext,
  type Level,
  not,
  or,
  pinIndex,
  strong,
  toInput,
  type UnitDef,
  xor,
} from '../../core';
import { type ChipBehavior, type ChipSpec, chipDefinition, delay, type LogicFamily } from './chip';
import { HC } from './hc-timing';
import { pins } from './pinout';

/** How a gate combines its inputs; `buffer` is a one-input gate (inverters). */
type GateOp = 'and' | 'or' | 'xor' | 'buffer';

export interface GateSpec extends ChipSpec {
  readonly op: GateOp;
  /** Output inverted (NAND, NOR, inverters). */
  readonly invert: boolean;
  /** One unit per gate: its input pins, then its output pin. */
  readonly units: readonly UnitDef[];
}

const COMBINE: Readonly<Record<GateOp, (a: Level, b: Level) => Level>> = {
  and,
  or,
  xor,
  buffer: and, // never called: a buffer has one input
};

/**
 * Behavior of a gate chip: every gate is re-evaluated on each call (re-driving an unchanged
 * output schedules nothing). Evaluating only the gates with a changed input would be wrong: the
 * forced evaluation at power-on and after a recompile may see some inputs changed and must still
 * evaluate the rest. 4-state semantics as `prim/*`: a 0 into a NAND gives 1 whatever the other
 * inputs; a floating input reads as `X`.
 */
function gateBehavior(spec: GateSpec): ChipBehavior {
  return (pinList, delays) => {
    const tpd = delay(delays, 'tpd');
    const gates = spec.units.length;
    const width = spec.units[0]!.pins.length - 1;
    if (spec.op === 'buffer' && width !== 1) throw new Error(`74xx${spec.number}: buffer width`);
    const inputs = new Int32Array(gates * width);
    const outputs = new Int32Array(gates);
    spec.units.forEach((unit, g) => {
      if (unit.pins.length !== width + 1) throw new Error(`74xx${spec.number}: unit ${unit.name}`);
      unit.pins.forEach((name, i) => {
        if (i < width) inputs[g * width + i] = pinIndex(pinList, name);
        else outputs[g] = pinIndex(pinList, name);
      });
    });
    const combine = COMBINE[spec.op];
    const invert = spec.invert;

    const update = (ctx: EvalContext<undefined>, g: number) => {
      const base = g * width;
      let level = ctx.read(inputs[base]!);
      for (let i = 1; i < width; i++) level = combine(level, ctx.read(inputs[base + i]!));
      ctx.drive(outputs[g]!, strong(invert ? not(level) : toInput(level)), tpd);
    };
    const evaluate = (ctx: EvalContext<undefined>) => {
      for (let g = 0; g < gates; g++) update(ctx, g);
    };
    return () => ({ evaluate });
  };
}

const UNIT_NAMES = 'ABCDEF';

/** Units `A`, `B`, … of `count` gates with pins `<n><input>` and `<n>Y`, n = 1…count. */
function numberedGates(count: number, inputs: string): UnitDef[] {
  return Array.from({ length: count }, (_, i) => ({
    name: UNIT_NAMES[i]!,
    pins: [...[...inputs].map((input) => `${i + 1}${input}`), `${i + 1}Y`],
  }));
}

const GND_14 = pins('GND', '7', 'power', 'ground (0 V)');
const VCC_14 = pins('VCC', '14', 'power', 'supply voltage');

/** The pinout of the quad 2-input gates 00, 08, 32, 86. */
const QUAD_2_INPUT = [
  pins('1A, 2A, 3A, 4A', '1, 4, 9, 12', 'in', 'data input'),
  pins('1B, 2B, 3B, 4B', '2, 5, 10, 13', 'in', 'data input'),
  pins('1Y, 2Y, 3Y, 4Y', '3, 6, 8, 11', 'out', 'data output'),
  GND_14,
  VCC_14,
];

/** The pinout of the hex inverters 04, 14. */
const HEX_1_INPUT = [
  pins('1A, 2A, 3A, 4A, 5A, 6A', '1, 3, 5, 9, 11, 13', 'in', 'data input'),
  pins('1Y, 2Y, 3Y, 4Y, 5Y, 6Y', '2, 4, 6, 8, 10, 12', 'out', 'data output'),
  GND_14,
  VCC_14,
];

/** The pinout of the triple 3-input gates 10, 11, 27. */
const TRIPLE_3_INPUT = [
  pins('1A, 2A, 3A', '1, 3, 9', 'in', 'data input'),
  pins('1B, 2B, 3B', '2, 4, 10', 'in', 'data input'),
  GND_14,
  pins('1C, 2C, 3C', '13, 5, 11', 'in', 'data input'),
  pins('1Y, 2Y, 3Y', '12, 6, 8', 'out', 'data output'),
  VCC_14,
];

/** The pinout of the dual 4-input gates 20, 21. */
const DUAL_4_INPUT = [
  pins('1A, 1B, 1C, 1D', '1, 2, 4, 5', 'in', 'data input'),
  pins('n.c.', '3, 11', 'nc', 'not connected'),
  pins('1Y', '6', 'out', 'data output'),
  GND_14,
  pins('2Y', '8', 'out', 'data output'),
  pins('2A, 2B, 2C, 2D', '9, 10, 12, 13', 'in', 'data input'),
  VCC_14,
];

const TWO_INPUT_COLUMNS = { inputs: ['nA', 'nB'], outputs: ['nY'] } as const;
const ONE_INPUT_COLUMNS = { inputs: ['nA'], outputs: ['nY'] } as const;
const THREE_INPUT_COLUMNS = { inputs: ['nA', 'nB', 'nC'], outputs: ['nY'] } as const;
const FOUR_INPUT_COLUMNS = { inputs: ['nA', 'nB', 'nC', 'nD'], outputs: ['nY'] } as const;

/** Every gate chip's function, as in its datasheet. */
export const GATE_SPECS: readonly GateSpec[] = [
  {
    number: '00',
    title: 'Quad 2-input NAND gate',
    keywords: ['nand', 'gate', 'quad'],
    op: 'and',
    invert: true,
    pinCount: 14,
    pins: QUAD_2_INPUT,
    units: numberedGates(4, 'AB'),
    functionTable: {
      ...TWO_INPUT_COLUMNS,
      rows: ['L X | H', 'X L | H', 'H H | L'],
      note: 'each gate (n = 1 to 4)',
    },
  },
  {
    number: '02',
    title: 'Quad 2-input NOR gate',
    keywords: ['nor', 'gate', 'quad'],
    op: 'or',
    invert: true,
    pinCount: 14,
    pins: [
      pins('1Y, 2Y, 3Y, 4Y', '1, 4, 10, 13', 'out', 'data output'),
      pins('1A, 2A, 3A, 4A', '2, 5, 8, 11', 'in', 'data input'),
      pins('1B, 2B, 3B, 4B', '3, 6, 9, 12', 'in', 'data input'),
      GND_14,
      VCC_14,
    ],
    units: numberedGates(4, 'AB'),
    functionTable: {
      ...TWO_INPUT_COLUMNS,
      rows: ['L L | H', 'X H | L', 'H X | L'],
      note: 'each gate (n = 1 to 4)',
    },
  },
  {
    number: '04',
    title: 'Hex inverter',
    keywords: ['not', 'inverter', 'hex'],
    op: 'buffer',
    invert: true,
    pinCount: 14,
    pins: HEX_1_INPUT,
    units: numberedGates(6, 'A'),
    functionTable: {
      ...ONE_INPUT_COLUMNS,
      rows: ['L | H', 'H | L'],
      note: 'each inverter (n = 1 to 6)',
    },
  },
  {
    number: '08',
    title: 'Quad 2-input AND gate',
    keywords: ['and', 'gate', 'quad'],
    op: 'and',
    invert: false,
    pinCount: 14,
    pins: QUAD_2_INPUT,
    units: numberedGates(4, 'AB'),
    functionTable: {
      ...TWO_INPUT_COLUMNS,
      rows: ['L L | L', 'L H | L', 'H L | L', 'H H | H'],
      note: 'each gate (n = 1 to 4)',
    },
  },
  {
    number: '10',
    title: 'Triple 3-input NAND gate',
    keywords: ['nand', 'gate', 'triple'],
    op: 'and',
    invert: true,
    pinCount: 14,
    pins: TRIPLE_3_INPUT,
    units: numberedGates(3, 'ABC'),
    functionTable: {
      ...THREE_INPUT_COLUMNS,
      rows: ['L X X | H', 'X L X | H', 'X X L | H', 'H H H | L'],
      note: 'each gate (n = 1 to 3)',
    },
  },
  {
    number: '11',
    title: 'Triple 3-input AND gate',
    keywords: ['and', 'gate', 'triple'],
    op: 'and',
    invert: false,
    pinCount: 14,
    pins: TRIPLE_3_INPUT,
    units: numberedGates(3, 'ABC'),
    functionTable: {
      ...THREE_INPUT_COLUMNS,
      rows: ['L X X | L', 'X L X | L', 'X X L | L', 'H H H | H'],
      note: 'each gate (n = 1 to 3)',
    },
  },
  {
    number: '14',
    title: 'Hex inverting Schmitt trigger',
    keywords: ['not', 'inverter', 'schmitt', 'trigger', 'hysteresis', 'hex'],
    op: 'buffer',
    invert: true,
    pinCount: 14,
    pins: HEX_1_INPUT,
    units: numberedGates(6, 'A'),
    functionTable: {
      ...ONE_INPUT_COLUMNS,
      rows: ['L | H', 'H | L'],
      note: 'each inverter (n = 1 to 6)',
    },
  },
  {
    number: '20',
    title: 'Dual 4-input NAND gate',
    keywords: ['nand', 'gate', 'dual'],
    op: 'and',
    invert: true,
    pinCount: 14,
    pins: DUAL_4_INPUT,
    units: numberedGates(2, 'ABCD'),
    functionTable: {
      ...FOUR_INPUT_COLUMNS,
      rows: ['L X X X | H', 'X L X X | H', 'X X L X | H', 'X X X L | H', 'H H H H | L'],
      note: 'each gate (n = 1, 2)',
    },
  },
  {
    number: '21',
    title: 'Dual 4-input AND gate',
    keywords: ['and', 'gate', 'dual'],
    op: 'and',
    invert: false,
    pinCount: 14,
    pins: DUAL_4_INPUT,
    units: numberedGates(2, 'ABCD'),
    functionTable: {
      ...FOUR_INPUT_COLUMNS,
      rows: ['L X X X | L', 'X L X X | L', 'X X L X | L', 'X X X L | L', 'H H H H | H'],
      note: 'each gate (n = 1, 2)',
    },
  },
  {
    number: '27',
    title: 'Triple 3-input NOR gate',
    keywords: ['nor', 'gate', 'triple'],
    op: 'or',
    invert: true,
    pinCount: 14,
    pins: TRIPLE_3_INPUT,
    units: numberedGates(3, 'ABC'),
    functionTable: {
      ...THREE_INPUT_COLUMNS,
      rows: ['L L L | H', 'X X H | L', 'X H X | L', 'H X X | L'],
      note: 'each gate (n = 1 to 3)',
    },
  },
  {
    number: '30',
    title: '8-input NAND gate',
    keywords: ['nand', 'gate', 'eight'],
    op: 'and',
    invert: true,
    pinCount: 14,
    pins: [
      pins('A, B, C, D, E, F', '1, 2, 3, 4, 5, 6', 'in', 'data input'),
      GND_14,
      pins('Y', '8', 'out', 'data output'),
      pins('n.c.', '9, 10, 13', 'nc', 'not connected'),
      pins('G, H', '11, 12', 'in', 'data input'),
      VCC_14,
    ],
    units: [{ name: 'A', pins: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Y'] }],
    functionTable: {
      inputs: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      outputs: ['Y'],
      rows: [
        'L X X X X X X X | H',
        'X L X X X X X X | H',
        'X X L X X X X X | H',
        'X X X L X X X X | H',
        'X X X X L X X X | H',
        'X X X X X L X X | H',
        'X X X X X X L X | H',
        'X X X X X X X L | H',
        'H H H H H H H H | L',
      ],
    },
  },
  {
    number: '32',
    title: 'Quad 2-input OR gate',
    keywords: ['or', 'gate', 'quad'],
    op: 'or',
    invert: false,
    pinCount: 14,
    pins: QUAD_2_INPUT,
    units: numberedGates(4, 'AB'),
    functionTable: {
      ...TWO_INPUT_COLUMNS,
      rows: ['L L | L', 'L H | H', 'H L | H', 'H H | H'],
      note: 'each gate (n = 1 to 4)',
    },
  },
  {
    number: '86',
    title: 'Quad 2-input EXCLUSIVE-OR gate',
    keywords: ['xor', 'exclusive or', 'parity', 'gate', 'quad'],
    op: 'xor',
    invert: false,
    pinCount: 14,
    pins: QUAD_2_INPUT,
    units: numberedGates(4, 'AB'),
    functionTable: {
      ...TWO_INPUT_COLUMNS,
      rows: ['L L | L', 'L H | H', 'H L | H', 'H H | L'],
      note: 'each gate (n = 1 to 4)',
    },
  },
];

/** The gate chips of a family. */
export function gateChips(family: LogicFamily): AnyComponentDefinition[] {
  return GATE_SPECS.map((spec) => chipDefinition(spec, family, gateBehavior(spec)));
}

/** 74HC00 … 74HC86. */
export const hcGates = gateChips(HC);
