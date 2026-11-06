/**
 * Small part definitions for circuit unit tests (circuit may not import library, not even in
 * tests). Not part of the public API. Scenario tests with real parts live in tests/scenarios.
 */
import { and, defineComponent, Level, ns, type PinDef, Registry, strong, weak } from '../core';

const INPUTS = ['A', 'B', 'C', 'D'];

/** `test/and`: AND gate with 2–4 inputs `A`…`D` and output `Y`, 1 ns delay. */
export const testAnd = defineComponent<{ inputs: number }, undefined>({
  type: 'test/and',
  name: 'AND',
  title: 'Test AND gate',
  pins: ({ inputs }) => [
    ...INPUTS.slice(0, inputs).map((name): PinDef => ({ name, dir: 'in' })),
    { name: 'Y', dir: 'out' },
  ],
  props: [{ key: 'inputs', label: 'Inputs', type: 'integer', default: 2, min: 2, max: 4 }],
  create: ({ inputs }) => ({
    evaluate: (ctx) => {
      let level = ctx.read(0);
      for (let i = 1; i < inputs; i++) level = and(level, ctx.read(i));
      ctx.drive(inputs, strong(level), ns(1));
    },
  }),
});

/** `test/high`: push-pull output `Y` driving 1 from t = 0. */
export const testHigh = defineComponent<Record<string, never>, undefined>({
  type: 'test/high',
  name: 'HIGH',
  title: 'Test constant 1',
  pins: [{ name: 'Y', dir: 'out' }],
  create: () => ({ init: (ctx) => ctx.drive(0, strong(Level.L1), 0) }),
});

/** `test/pull`: weak pull-down on `Y`. */
export const testPull = defineComponent<Record<string, never>, undefined>({
  type: 'test/pull',
  name: 'PULL',
  title: 'Test pull-down',
  pins: [{ name: 'Y', dir: 'out', weak: true }],
  create: () => ({ init: (ctx) => ctx.drive(0, weak(Level.L0), 0) }),
});

/** `test/bus`: inputs `A`, `EN`, tri-state output `Y`, bidirectional `D`. No behavior. */
export const testBus = defineComponent<Record<string, never>, undefined>({
  type: 'test/bus',
  name: 'BUS',
  title: 'Test bus part',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'EN', dir: 'in' },
    { name: 'Y', dir: 'tristate' },
    { name: 'D', dir: 'bidir' },
  ],
  create: () => ({}),
});

/** `test/dip`: 74HC00 pinout in a DIP-14 (listed out of physical order on purpose). */
export const testDip = defineComponent<Record<string, never>, undefined>({
  type: 'test/dip',
  name: '74HC00',
  title: 'Test DIP-14',
  package: { kind: 'dip', pins: 14 },
  pins: [
    { name: 'VCC', number: 14, dir: 'power' },
    { name: '1A', number: 1, dir: 'in' },
    { name: '1B', number: 2, dir: 'in' },
    { name: '1Y', number: 3, dir: 'out' },
    { name: '2A', number: 4, dir: 'in' },
    { name: '2B', number: 5, dir: 'in' },
    { name: '2Y', number: 6, dir: 'out' },
    { name: 'GND', number: 7, dir: 'power' },
    { name: '3Y', number: 8, dir: 'out' },
    { name: '3A', number: 9, dir: 'in' },
    { name: '3B', number: 10, dir: 'in' },
    { name: '4Y', number: 11, dir: 'out' },
    { name: '4A', number: 12, dir: 'in' },
    { name: '4B', number: 13, dir: 'in' },
  ],
  create: () => ({}),
});

export function testRegistry(): Registry {
  return new Registry([testAnd, testHigh, testPull, testBus, testDip]);
}
