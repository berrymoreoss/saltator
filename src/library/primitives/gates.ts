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
  type SymbolDef,
  type SymbolPin,
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

/**
 * Symbol of an N-input gate: inputs one cell apart down the left side, skipping the middle row
 * for an even count so the output sits on the grid in the middle of the right side (2 inputs:
 * rows 1 and 3, output 2). The editor draws the gate shape `kind` into the 4-cell-wide body.
 */
export function gateSymbol(kind: string, inputs: number): SymbolDef {
  const even = inputs % 2 === 0;
  const height = inputs + (even ? 2 : 1);
  const pins: Record<string, SymbolPin> = { Y: { side: 'right', offset: height / 2 } };
  for (let i = 0; i < inputs; i++) {
    const skip = even && i >= inputs / 2 ? 1 : 0;
    pins[INPUT_NAMES[i]!] = { side: 'left', offset: i + 1 + skip };
  }
  return { kind, width: 4, height, pins };
}

/** Symbol of a one-input part (buffer, inverter): a triangle with A on the left, Y on the right. */
export function oneInputSymbol(kind: string): SymbolDef {
  return {
    kind,
    width: 3,
    height: 2,
    pins: { A: { side: 'left', offset: 1 }, Y: { side: 'right', offset: 1 } },
  };
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
    symbol: ({ inputs }) => gateSymbol(`gate-${part}`, inputs),
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
  symbol: oneInputSymbol('buffer'),
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
  symbol: oneInputSymbol('not'),
  props: [delayProp],
  create: ({ delay }) => ({
    evaluate: (ctx) => ctx.drive(1, strong(not(ctx.read(0))), delay),
  }),
});
