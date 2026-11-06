/**
 * Abstract logic gates (Logisim-style): configurable input count and delay, 4-state semantics.
 * No datasheet: behavior is the textbook truth table; `X`/`Z` inputs propagate conservatively.
 */
import {
  type AnyComponentDefinition,
  and,
  defineComponent,
  type Level,
  not,
  ns,
  or,
  type PinDef,
  type PropDef,
  strong,
  toInput,
  xor,
} from '../../core';

export const MIN_GATE_INPUTS = 2;
export const MAX_GATE_INPUTS = 8;

/** Default propagation delay of every `prim/*` part (answer to plan Q1). */
export const PRIM_DEFAULT_DELAY = ns(1);

const INPUT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

/** Pins of an N-input gate: inputs `A`, `B`, … then output `Y`. */
export function gatePins(inputs: number): PinDef[] {
  return [
    ...INPUT_NAMES.slice(0, inputs).map((name): PinDef => ({ name, dir: 'in' })),
    { name: 'Y', dir: 'out' },
  ];
}

export const delayProp: PropDef = {
  key: 'delay',
  label: 'Delay',
  type: 'time',
  default: PRIM_DEFAULT_DELAY,
  min: 0,
};

const inputsProp: PropDef = {
  key: 'inputs',
  label: 'Inputs',
  type: 'integer',
  default: MIN_GATE_INPUTS,
  min: MIN_GATE_INPUTS,
  max: MAX_GATE_INPUTS,
};

type GateProps = { inputs: number; delay: number };

function gate(
  part: string,
  title: string,
  op: (a: Level, b: Level) => Level,
  invert: boolean,
  keywords: readonly string[],
): AnyComponentDefinition {
  return defineComponent<GateProps, undefined>({
    type: `prim/${part}`,
    name: part.toUpperCase(),
    title,
    keywords: ['gate', ...keywords],
    pins: ({ inputs }) => gatePins(inputs),
    props: [inputsProp, delayProp],
    create: ({ inputs, delay }) => ({
      evaluate(ctx) {
        let level = ctx.read(0);
        for (let i = 1; i < inputs; i++) level = op(level, ctx.read(i));
        ctx.drive(inputs, strong(invert ? not(level) : level), delay);
      },
    }),
  });
}

export const andGate = gate('and', 'AND gate', and, false, ['and', 'conjunction']);
export const orGate = gate('or', 'OR gate', or, false, ['or', 'disjunction']);
export const nandGate = gate('nand', 'NAND gate', and, true, ['nand', 'not and']);
export const norGate = gate('nor', 'NOR gate', or, true, ['nor', 'not or']);
export const xorGate = gate('xor', 'XOR gate (odd parity)', xor, false, [
  'xor',
  'exclusive or',
  'parity',
]);
export const xnorGate = gate('xnor', 'XNOR gate (even parity)', xor, true, [
  'xnor',
  'equivalence',
  'parity',
]);

const oneInputPins: readonly PinDef[] = [
  { name: 'A', dir: 'in' },
  { name: 'Y', dir: 'out' },
];

/** Non-inverting buffer: Y = A (a floating input reads as X). */
export const buffer = defineComponent<{ delay: number }, undefined>({
  type: 'prim/buffer',
  name: 'BUF',
  title: 'Buffer',
  keywords: ['buffer', 'driver', 'delay'],
  pins: oneInputPins,
  props: [delayProp],
  create: ({ delay }) => ({
    evaluate: (ctx) => ctx.drive(1, strong(toInput(ctx.read(0))), delay),
  }),
});

/** Inverter: Y = not A. */
export const inverter = defineComponent<{ delay: number }, undefined>({
  type: 'prim/not',
  name: 'NOT',
  title: 'Inverter (NOT gate)',
  keywords: ['not', 'inverter', 'gate'],
  pins: oneInputPins,
  props: [delayProp],
  create: ({ delay }) => ({
    evaluate: (ctx) => ctx.drive(1, strong(not(ctx.read(0))), delay),
  }),
});
