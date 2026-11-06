import { describe, expect, it } from 'vitest';
import { type AnyComponentDefinition, Level, ns, pinsOf } from '../../core';
import { Bench, functionTable, Trace, truthTable } from '../../core/testing';
import { BUFFER_SPECS, hcBuffers } from './buffers';

const chip = (number: string) => hcBuffers.find((d) => d.name === `74HC${number}`)!;
const nameAt = (d: AnyComponentDefinition, number: number) =>
  pinsOf(d, {}).find((p) => p.number === number)!.name;

/** Every buffer by physical pin numbers — enable, input, output — from the pinning figures. */
const QUAD = [
  [1, 2, 3],
  [4, 5, 6],
  [10, 9, 8],
  [13, 12, 11],
];
const OCTAL = [
  [1, 2, 18],
  [1, 4, 16],
  [1, 6, 14],
  [1, 8, 12],
  [19, 17, 3],
  [19, 15, 5],
  [19, 13, 7],
  [19, 11, 9],
];
const BUFFERS_BY_PIN: Readonly<Record<string, readonly (readonly number[])[]>> = {
  '125': QUAD,
  '126': QUAD,
  '240': OCTAL,
  '244': OCTAL,
};

/** Typical [tpd, ten, tdis] at VCC = 4.5 V, CL = 50 pF from each data sheet's table 7, in ns. */
const DELAYS_NS: Readonly<Record<string, readonly [number, number, number]>> = {
  '125': [11, 15, 15],
  '126': [11, 15, 15],
  '240': [11, 14, 15],
  '244': [11, 13, 14],
};

describe.each(BUFFER_SPECS.map((spec) => [spec.number, spec] as const))(
  '74HC%s',
  (number, spec) => {
    const def = chip(number);
    const on = spec.enable === 'low' ? Level.L0 : Level.L1;
    const off = spec.enable === 'low' ? Level.L1 : Level.L0;

    it('follows its data sheet function table on every buffer, by pin number', () => {
      const bench = new Bench(def);
      for (const buffer of BUFFERS_BY_PIN[number]!) {
        const names = buffer.map((n) => nameAt(def, n));
        expect(functionTable(bench, def.functionTable!, names)).toBe(4);
      }
    });

    it('enables after ten, follows its input after tpd, releases after tdis', () => {
      const [tpd, ten, tdis] = DELAYS_NS[number]!.map(ns) as [number, number, number];
      const [oe, a, y] = spec.buffers[0]!;
      const bench = new Bench(def);
      bench.set({ [oe]: off, [a]: 1 }).settle();
      expect(bench.get(y)).toBe(Level.Z);
      expect(bench.measure({ [oe]: on }, y)).toBe(ten);
      expect(bench.measure({ [a]: 0 }, y)).toBe(tpd);
      expect(bench.measure({ [oe]: off }, y)).toBe(tdis);
      bench.expect({ [y]: 'Z' });
    });

    it('drives X while its enable is unknown or floating, and from a floating input', () => {
      const [oe, a, y] = spec.buffers[0]!;
      truthTable(
        new Bench(def),
        [oe, a],
        [y],
        [
          ['X', 1, 'X'],
          ['Z', 0, 'X'],
          [on, 'Z', 'X'],
          [off, 'X', 'Z'],
        ],
      );
    });
  },
);

describe('74HC240', () => {
  it('inverts', () => {
    const bench = new Bench(chip('240'));
    bench.set({ '1OE': 0, '1A0': 1, '2OE': 0, '2A3': 0 }).settle();
    bench.expect({ '1Y0': 0, '2Y3': 1 });
  });
});

describe('enable groups and sections', () => {
  it('are independent: 1OE of a 74HC244 switches only 1Y0–1Y3', () => {
    const bench = new Bench(chip('244'));
    bench.set({ '1OE': 0, '2OE': 0, '1A0': 1, '2A0': 1 }).settle();
    bench.set({ '1OE': 1 }).settle();
    bench.expect({ '1Y0': 'Z', '2Y0': 1 });
  });

  it('a buffer whose enable floats drives X even when another one changes at power-on', () => {
    // Regression: evaluating only the sections with a changed input left 2Y–4Y released.
    const bench = new Bench(chip('125'));
    bench.set({ '1OE': 0, '1A': 1 }).settle();
    bench.expect({ '1Y': 1, '2Y': 'X', '3Y': 'X', '4Y': 'X' });
  });

  it('swallow an enable pulse shorter than ten (inertial delay)', () => {
    const bench = new Bench(chip('244'));
    bench.set({ '1OE': 1, '1A0': 1 }).settle();
    const trace = new Trace(bench.sim);
    bench.set({ '1OE': 0 });
    bench.run(ns(5));
    bench.set({ '1OE': 1 }).settle();
    expect(trace.of('1Y0')).toEqual([]);
  });
});
