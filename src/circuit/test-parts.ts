/**
 * Small part definitions for circuit unit tests (circuit may not import library, not even in
 * tests). Not part of the public API. Scenario tests with real parts live in tests/scenarios.
 */
import {
  and,
  createAccessStamps,
  defineComponent,
  Level,
  ns,
  type PinDef,
  Registry,
  strong,
  weak,
} from '../core';

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

/**
 * `test/tie`: output `Y` tied to `level`, drawn as a rail: a 2×1 body with the pin below it for 1
 * (like VCC) and above it for 0 (like GND). At (x, y): level 1 → Y (x+1, y+2); 0 → Y (x+1, y).
 */
export const testTie = defineComponent<{ level: '0' | '1' }, undefined>({
  type: 'test/tie',
  name: 'TIE',
  title: 'Test rail',
  props: [
    {
      key: 'level',
      label: 'Level',
      type: 'enum',
      default: '1',
      options: [
        { value: '0', label: '0' },
        { value: '1', label: '1' },
      ],
    },
  ],
  pins: ({ level }) => [{ name: 'Y', dir: 'out', constant: level === '1' ? 1 : 0 }],
  symbol: ({ level }) => ({
    kind: 'tie',
    width: 2,
    height: 1,
    pins: { Y: { side: level === '1' ? 'bottom' : 'top', offset: 1 } },
  }),
  create: ({ level }) => ({
    init: (ctx) => ctx.drive(0, strong(level === '1' ? Level.L1 : Level.L0), 0),
  }),
});

/** `test/lamp`: indicator with sense inputs on a 2×2 symbol. At (x, y): A (x, y+1), K (x+4, y+1). */
export const testLamp = defineComponent<Record<string, never>, undefined>({
  type: 'test/lamp',
  name: 'LAMP',
  title: 'Test lamp',
  pins: [
    { name: 'A', dir: 'in', sense: true },
    { name: 'K', dir: 'in', sense: true },
  ],
  symbol: {
    kind: 'lamp',
    width: 2,
    height: 2,
    pins: { A: { side: 'left', offset: 1 }, K: { side: 'right', offset: 1 } },
  },
  create: () => ({}),
});

/**
 * `test/label`: a schematic-only net label; its pin `N` joins the net named by `name` (capital
 * letters and digits). At (x, y): N (x, y).
 */
export const testLabel = defineComponent<{ name: string }, undefined>({
  type: 'test/label',
  name: 'LABEL',
  title: 'Test net label',
  schematicOnly: true,
  props: [
    {
      key: 'name',
      label: 'Name',
      type: 'string',
      default: 'N',
      pattern: { regex: /^[A-Z0-9]+$/, hint: 'capital letters and digits' },
    },
  ],
  pins: ({ name }) => [{ name: 'N', dir: 'nc', net: name }],
  symbol: { kind: 'label', width: 2, height: 1, pins: { N: { side: 'left', offset: 0 } } },
  create: () => ({}),
});

/**
 * `test/bus-label`: a schematic-only bus label; its bus pin `B` joins every bus named `name`
 * (`D[0..3]`). At (x, y): B (x, y).
 */
export const testBusLabel = defineComponent<{ name: string }, undefined>({
  type: 'test/bus-label',
  name: 'BUS LABEL',
  title: 'Test bus label',
  schematicOnly: true,
  props: [
    {
      key: 'name',
      label: 'Name',
      type: 'string',
      default: 'D[0..3]',
      pattern: { regex: /^[A-Z]+\[\d+\.\.\d+\]$/, hint: 'a bus name' },
    },
  ],
  pins: ({ name }) => [{ name: 'B', dir: 'nc', net: name, bus: true }],
  symbol: { kind: 'label', width: 2, height: 1, pins: { B: { side: 'left', offset: 0 } } },
  create: () => ({}),
});

/**
 * `test/bus-entry`: a schematic-only bus entry; its pin `N` joins the net named `name`, its bus
 * pin `B` sits on a bus line. At (x, y): N (x, y), B (x+3, y+1).
 */
export const testBusEntry = defineComponent<{ name: string }, undefined>({
  type: 'test/bus-entry',
  name: 'BUS ENTRY',
  title: 'Test bus entry',
  schematicOnly: true,
  props: [
    {
      key: 'name',
      label: 'Name',
      type: 'string',
      default: 'D0',
      pattern: { regex: /^[A-Z0-9]+$/, hint: 'capital letters and digits' },
    },
  ],
  pins: ({ name }) => [
    { name: 'N', dir: 'nc', net: name },
    { name: 'B', dir: 'nc', bus: true },
  ],
  symbol: {
    kind: 'bus-entry',
    width: 1,
    height: 1,
    pins: { N: { side: 'left', offset: 0 }, B: { side: 'right', offset: 1 } },
  },
  create: () => ({}),
});

/** `test/hi`: a rail joining the net `HI` by name, output `Y` tied to 1. At (x, y): Y (x+5, y+1). */
export const testHi = defineComponent<Record<string, never>, undefined>({
  type: 'test/hi',
  name: 'HI',
  title: 'Test named rail',
  pins: [{ name: 'Y', dir: 'out', constant: 1, net: 'HI' }],
  create: () => ({ init: (ctx) => ctx.drive(0, strong(Level.L1), 0) }),
});

/** `test/rom`: a 4-byte ROM with address inputs `A0`, `A1` and output `Y`. No behavior. */
export const testRom = defineComponent<Record<string, never>, undefined>({
  type: 'test/rom',
  name: 'ROM',
  title: 'Test ROM',
  pins: [
    { name: 'A0', dir: 'in' },
    { name: 'A1', dir: 'in' },
    { name: 'Y', dir: 'out' },
  ],
  memory: {
    words: 4,
    width: 8,
    volatile: false,
    addressPins: ['A0', 'A1'],
    view: () => ({ data: new Uint8Array(4), unknown: new Uint8Array(4), ...createAccessStamps(4) }),
  },
  create: () => ({}),
});

export function testRegistry(): Registry {
  return new Registry([
    testAnd,
    testHigh,
    testPull,
    testBus,
    testDip,
    testTie,
    testLamp,
    testLabel,
    testBusLabel,
    testBusEntry,
    testHi,
    testRom,
  ]);
}
