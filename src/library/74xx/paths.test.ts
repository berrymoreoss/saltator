import { describe, expect, it } from 'vitest';
import {
  and,
  type EvalContext,
  ns,
  type PinRef,
  pinIndex,
  pinsOf,
  strong,
  toInput,
} from '../../core';
import { Bench } from '../../core/testing';
import { type ChipBehavior, type ChipSpec, chipDefinition, type LogicFamily } from './chip';
import { pathDelays } from './paths';
import { pins } from './pinout';

/** A fixture chip: Y = A·B·E, Z = B·E, with a delay per path like an MSI data sheet. */
const SPEC: ChipSpec = {
  number: '999',
  title: 'Test chip with delay paths',
  keywords: [],
  pinCount: 8,
  pins: [
    pins('A, B, E', '1, 2, 3', 'in', 'data input'),
    pins('GND', '4', 'power', 'ground (0 V)'),
    pins('Y, Z', '5, 6', 'out', 'data output'),
    pins('n.c.', '7', 'nc', 'not connected'),
    pins('VCC', '8', 'power', 'supply voltage'),
  ],
  functionTable: { inputs: ['A', 'B', 'E'], outputs: ['Y', 'Z'], rows: ['H H H | H H'] },
};

const PATHS = [
  { from: 'A, B', to: 'Y', delay: 'tpd(A-Y)' },
  { from: 'E', to: 'Y, Z', delay: 'tpd(E-Y)' },
  { from: 'B', to: 'Z', delay: 'tpd(B-Z)' },
];

const FAMILY: LogicFamily = {
  name: 'TT',
  chips: {
    '999': {
      datasheet: 'https://example.com/999.pdf',
      timing: { typical: { 'tpd(A-Y)': ns(10), 'tpd(E-Y)': ns(15), 'tpd(B-Z)': ns(7) } },
    },
  },
};

const behavior: ChipBehavior = (pinList, delays) => {
  const paths = pathDelays(pinList, delays, PATHS);
  const [A, B, E, Y, Z] = ['A', 'B', 'E', 'Y', 'Z'].map((n) => pinIndex(pinList, n)) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return () => ({
    evaluate(ctx) {
      const b = ctx.read(B);
      const e = ctx.read(E);
      ctx.drive(Y, strong(toInput(and(and(ctx.read(A), b), e))), paths.delay(ctx, Y));
      ctx.drive(Z, strong(toInput(and(b, e))), paths.delay(ctx, Z));
    },
  });
};

const chip = chipDefinition(SPEC, FAMILY, behavior);
const pinList = pinsOf(chip, {});
const ref = (name: string) => pinIndex(pinList, name);

/** A context where exactly `changed` changed (all `pathDelays` looks at). */
const contextWith = (...changed: string[]) => {
  const refs = new Set(changed.map(ref));
  return { changed: (pin: PinRef) => refs.has(pin) } as unknown as EvalContext<unknown>;
};

describe('pathDelays', () => {
  const paths = pathDelays(pinList, FAMILY.chips['999']!.timing.typical, PATHS);

  it('takes the delay of the path whose input changed', () => {
    expect(paths.delay(contextWith('A'), ref('Y'))).toBe(ns(10));
    expect(paths.delay(contextWith('E'), ref('Y'))).toBe(ns(15));
    expect(paths.delay(contextWith('B'), ref('Z'))).toBe(ns(7));
  });

  it('takes the longest changed path when several inputs change at once', () => {
    expect(paths.delay(contextWith('A', 'E'), ref('Y'))).toBe(ns(15));
    expect(paths.delay(contextWith('B', 'E'), ref('Z'))).toBe(ns(15));
    expect(paths.delay(contextWith('A', 'B'), ref('Y'))).toBe(ns(10));
  });

  it("ignores inputs that don't reach the output", () => {
    // A doesn't reach Z: nothing on Z's paths changed, so its longest path.
    expect(paths.delay(contextWith('A'), ref('Z'))).toBe(ns(15));
  });

  it('takes the longest path when nothing changed (the forced evaluation)', () => {
    expect(paths.delay(contextWith(), ref('Y'))).toBe(ns(15));
    expect(paths.delay(contextWith(), ref('Z'))).toBe(ns(15));
  });

  it('keeps the longest delay of an input listed on two paths', () => {
    const twice = pathDelays(pinList, FAMILY.chips['999']!.timing.typical, [
      ...PATHS,
      { from: 'B', to: 'Z', delay: 'tpd(E-Y)' },
    ]);
    expect(twice.delay(contextWith('B'), ref('Z'))).toBe(ns(15));
  });

  it('rejects an output without a path, an unknown symbol or pin', () => {
    const typical = FAMILY.chips['999']!.timing.typical;
    expect(() => pathDelays(pinList, typical, PATHS.slice(0, 1))).toThrow('no delay path to pin Z');
    expect(() => pathDelays(pinList, typical, [{ from: 'A', to: 'Y', delay: 'tpd' }])).toThrow(
      'missing delay "tpd"',
    );
    expect(() => pathDelays(pinList, typical, [{ from: 'Q', to: 'Y', delay: 'tpd(A-Y)' }])).toThrow(
      /Q/,
    );
  });

  it('drives each output after the delay of the input that changed, in a simulation', () => {
    const bench = new Bench(chip);
    bench.set({ A: 1, B: 1, E: 1 }).settle();
    bench.expect({ Y: 1, Z: 1 });
    expect(bench.measure({ A: 0 }, 'Y')).toBe(ns(10));
    expect(bench.measure({ A: 1 }, 'Y')).toBe(ns(10));
    expect(bench.measure({ B: 0 }, 'Z')).toBe(ns(7));
    expect(bench.measure({ B: 1 }, 'Y')).toBe(ns(10));
    expect(bench.measure({ E: 0 }, 'Y')).toBe(ns(15));
    bench.set({ A: 0 }).settle();
    expect(bench.measure({ A: 1, E: 1 }, 'Y')).toBe(ns(15));
  });
});
