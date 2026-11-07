/**
 * 74xx283 4-bit binary full adder (pinout from the TI CD74HC283 data sheet, pin descriptions and
 * the function table example from the Philips 74HC/HCT283 sheet, which TI lacks) and 74xx85
 * 4-bit magnitude comparator (Nexperia data sheet, tables 2 and 3).
 * Spec: docs/components.md#74xx-chips-74xx.
 */
import {
  type AnyComponentDefinition,
  and,
  type EvalContext,
  Level,
  not,
  or,
  strong,
  toInput,
  xor,
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

const GND_16 = pins('GND', '8', 'power', 'ground (0 V)');
const AB = 'A0, A1, A2, A3, B0, B1, B2, B3';
const SUMS = 'S0, S1, S2, S3';

export const ADDER_SPEC: ChipSpec & { readonly paths: readonly DelayPath[] } = {
  number: '283',
  title: '4-bit binary full adder with fast carry',
  keywords: ['adder', 'full adder', 'sum', 'carry', 'arithmetic', 'alu', '4-bit'],
  pinCount: 16,
  // TI pin names (0-based); the descriptions are the Philips sheet's (TI's has none).
  pins: [
    pins('S0, S1, S2, S3', '4, 1, 13, 10', 'out', 'sum outputs'),
    pins('A0, A1, A2, A3', '5, 3, 14, 12', 'in', 'A operand inputs'),
    pins('B0, B1, B2, B3', '6, 2, 15, 11', 'in', 'B operand inputs'),
    pins('CIN', '7', 'in', 'carry input'),
    GND_16,
    pins('COUT', '9', 'out', 'carry output'),
    pins('VCC', '16', 'power', 'positive supply voltage'),
  ],
  functionTable: {
    inputs: ['CIN', 'A0', 'A1', 'A2', 'A3', 'B0', 'B1', 'B2', 'B3'],
    outputs: ['S0', 'S1', 'S2', 'S3', 'COUT'],
    rows: ['L L H L H H L L H | H H L L H'],
    note: 'example: 10 + 9 = 19 (A + B + CIN, for every input)',
  },
  paths: [
    { from: 'CIN', to: 'S0', delay: 'tpd(CIN to S0)' },
    { from: 'CIN', to: 'S1', delay: 'tpd(CIN to S1)' },
    { from: 'CIN', to: 'S2', delay: 'tpd(CIN to S2)' },
    { from: 'CIN', to: 'S3', delay: 'tpd(CIN to S3)' },
    { from: AB, to: SUMS, delay: 'tpd(An, Bn to Sn)' },
    { from: 'CIN', to: 'COUT', delay: 'tpd(CIN to COUT)' },
    { from: AB, to: 'COUT', delay: 'tpd(An, Bn to COUT)' },
  ],
};

/**
 * S = A + B + CIN, COUT the carry out of bit 3. 4-state, bit by bit as a ripple of full adders:
 * the sum bits below the first unknown input stay known, and a carry both of whose other inputs
 * agree is known too (1 + 1 + X carries 1).
 */
const adderBehavior: ChipBehavior = (pinList, delays) => {
  const paths = pathDelays(pinList, delays, ADDER_SPEC.paths);
  const a = pinIndices(pinList, 'A0, A1, A2, A3');
  const b = pinIndices(pinList, 'B0, B1, B2, B3');
  const s = pinIndices(pinList, SUMS);
  const [cin, cout] = pinIndices(pinList, 'CIN, COUT') as unknown as [number, number];

  const evaluate = (ctx: EvalContext<undefined>) => {
    let carry = toInput(ctx.read(cin));
    for (let n = 0; n < 4; n++) {
      const an = toInput(ctx.read(a[n]!));
      const bn = toInput(ctx.read(b[n]!));
      const half = xor(an, bn);
      ctx.drive(s[n]!, strong(xor(half, carry)), paths.delay(ctx, s[n]!));
      carry = or(and(an, bn), and(carry, or(an, bn)));
    }
    ctx.drive(cout, strong(carry), paths.delay(ctx, cout));
  };
  return () => ({ evaluate });
};

export const COMPARATOR_SPEC: ChipSpec & { readonly paths: readonly DelayPath[] } = {
  number: '85',
  title: '4-bit magnitude comparator',
  keywords: ['comparator', 'magnitude', 'compare', 'equal', 'greater', 'less', 'arithmetic'],
  pinCount: 16,
  pins: [
    pins('IA<B', '2', 'in', 'A<B expansion input'),
    pins('IA=B', '3', 'in', 'A=B expansion input'),
    pins('IA>B', '4', 'in', 'A>B expansion input'),
    pins('QA>B', '5', 'out', 'A>B output'),
    pins('QA=B', '6', 'out', 'A=B output'),
    pins('QA<B', '7', 'out', 'A<B output'),
    pins('A0, A1, A2, A3', '10, 12, 13, 15', 'in', 'word A inputs'),
    pins('B0, B1, B2, B3', '9, 11, 14, 1', 'in', 'word B inputs'),
    GND_16,
    pins('VCC', '16', 'power', 'supply voltage'),
  ],
  functionTable: {
    inputs: ['A3,B3', 'A2,B2', 'A1,B1', 'A0,B0', 'IA>B', 'IA<B', 'IA=B'],
    outputs: ['QA>B', 'QA<B', 'QA=B'],
    rows: [
      'A3>B3 X X X X X X | H L L',
      'A3<B3 X X X X X X | L H L',
      'A3=B3 A2>B2 X X X X X | H L L',
      'A3=B3 A2<B2 X X X X X | L H L',
      'A3=B3 A2=B2 A1>B1 X X X X | H L L',
      'A3=B3 A2=B2 A1<B1 X X X X | L H L',
      'A3=B3 A2=B2 A1=B1 A0>B0 X X X | H L L',
      'A3=B3 A2=B2 A1=B1 A0<B0 X X X | L H L',
      'A3=B3 A2=B2 A1=B1 A0=B0 H L L | H L L',
      'A3=B3 A2=B2 A1=B1 A0=B0 L H L | L H L',
      'A3=B3 A2=B2 A1=B1 A0=B0 L L H | L L H',
      'A3=B3 A2=B2 A1=B1 A0=B0 X X H | L L H',
      'A3=B3 A2=B2 A1=B1 A0=B0 H H L | L L L',
      'A3=B3 A2=B2 A1=B1 A0=B0 L L L | H H L',
    ],
  },
  paths: [
    { from: AB, to: 'QA>B, QA<B', delay: 'tpd(An, Bn to QA>B, QA<B)' },
    { from: AB, to: 'QA=B', delay: 'tpd(An, Bn to QA=B)' },
    { from: 'IA=B, IA>B', to: 'QA<B', delay: 'tpd(IA=B, IA>B to QA<B; IA<B, IA=B to QA>B)' },
    { from: 'IA<B, IA=B', to: 'QA>B', delay: 'tpd(IA=B, IA>B to QA<B; IA<B, IA=B to QA>B)' },
    { from: 'IA=B', to: 'QA=B', delay: 'tpd(IA=B to QA=B)' },
  ],
};

/**
 * A > B or A < B decide the outputs; with A = B they follow the expansion inputs as the function
 * table shows: QA=B = IA=B, QA>B = not IA<B and not IA=B, QA<B = not IA>B and not IA=B (so IA>B
 * never reaches QA>B). 4-state, from bit 3 down: an unknown bit makes `X` only what it could
 * change.
 */
const comparatorBehavior: ChipBehavior = (pinList, delays) => {
  const paths = pathDelays(pinList, delays, COMPARATOR_SPEC.paths);
  const a = pinIndices(pinList, 'A0, A1, A2, A3');
  const b = pinIndices(pinList, 'B0, B1, B2, B3');
  const [ilt, ieq, igt, qgt, qeq, qlt] = pinIndices(
    pinList,
    'IA<B, IA=B, IA>B, QA>B, QA=B, QA<B',
  ) as unknown as [number, number, number, number, number, number];

  const evaluate = (ctx: EvalContext<undefined>) => {
    let greater: Level = Level.L0;
    let less: Level = Level.L0;
    let equal: Level = Level.L1;
    for (let n = 3; n >= 0; n--) {
      const an = toInput(ctx.read(a[n]!));
      const bn = toInput(ctx.read(b[n]!));
      greater = or(greater, and(equal, and(an, not(bn))));
      less = or(less, and(equal, and(not(an), bn)));
      equal = and(equal, not(xor(an, bn)));
    }
    const notEq = not(ctx.read(ieq));
    const gt = or(greater, and(equal, and(not(ctx.read(ilt)), notEq)));
    const lt = or(less, and(equal, and(not(ctx.read(igt)), notEq)));
    const eq = and(equal, toInput(ctx.read(ieq)));
    ctx.drive(qgt, strong(gt), paths.delay(ctx, qgt));
    ctx.drive(qlt, strong(lt), paths.delay(ctx, qlt));
    ctx.drive(qeq, strong(eq), paths.delay(ctx, qeq));
  };
  return () => ({ evaluate });
};

/** The 283 and 85 of a family. */
export function arithmeticChips(family: LogicFamily): AnyComponentDefinition[] {
  return [
    chipDefinition(ADDER_SPEC, family, adderBehavior),
    chipDefinition(COMPARATOR_SPEC, family, comparatorBehavior),
  ];
}

/** 74HC283, 74HC85. */
export const hcArithmetic = arithmeticChips(HC);
