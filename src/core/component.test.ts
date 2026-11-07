import { describe, expect, it } from 'vitest';
import {
  defineComponent,
  isDriverPin,
  isReadPin,
  type PinDef,
  type PinDir,
  pinIndex,
  pinsOf,
  resolveProps,
  validatePins,
} from './component';
import { Drive } from './logic';
import { ns } from './time';

const gate = defineComponent<{ inputs: number; delay: number; mode: string }, { count: number }>({
  type: 'test/gate',
  name: 'G',
  title: 'Test gate',
  pins: ({ inputs }) => [
    ...Array.from({ length: inputs }, (_, i): PinDef => ({ name: `I${i}`, dir: 'in' })),
    { name: 'Y', dir: 'out' },
  ],
  props: [
    { key: 'inputs', label: 'Inputs', type: 'integer', default: 2, min: 2, max: 8 },
    { key: 'delay', label: 'Delay', type: 'time', default: ns(1), min: 0, unit: 'ns' },
    {
      key: 'mode',
      label: 'Mode',
      type: 'enum',
      default: 'a',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
  ],
  create: ({ inputs, delay }) => ({
    createState: () => ({ count: 0 }),
    evaluate(ctx) {
      ctx.state.count++;
      ctx.drive(inputs, Drive.STRONG_1, delay);
    },
  }),
});

describe('pin directions', () => {
  it('classifies read and driver pins', () => {
    const dirs: PinDir[] = ['in', 'out', 'tristate', 'bidir', 'power', 'nc'];
    expect(dirs.filter(isReadPin)).toEqual(['in', 'bidir']);
    expect(dirs.filter(isDriverPin)).toEqual(['out', 'tristate', 'bidir']);
  });
});

describe('pins', () => {
  it('may depend on props', () => {
    const props = resolveProps(gate, { inputs: 3 });
    expect(pinsOf(gate, props).map((p) => p.name)).toEqual(['I0', 'I1', 'I2', 'Y']);
  });

  it('pinIndex finds pins by name and reports missing ones', () => {
    const pins = pinsOf(gate, resolveProps(gate));
    expect(pinIndex(pins, 'Y')).toBe(2);
    expect(() => pinIndex(pins, 'Q')).toThrow('no pin "Q" (pins: I0, I1, Y)');
  });

  it('validatePins rejects duplicate and empty names', () => {
    expect(() =>
      validatePins(
        [
          { name: 'A', dir: 'in' },
          { name: 'A', dir: 'out' },
        ],
        'x/y',
      ),
    ).toThrow('x/y: duplicate pin "A"');
    expect(() => validatePins([{ name: '', dir: 'in' }], 'x/y')).toThrow('x/y: empty pin name');
  });

  it('validatePins accepts a label that repeats another pin name, not a blank one', () => {
    const pins = [
      { name: 'Y', dir: 'out' as const },
      { name: 'YN', label: 'Y', dir: 'out' as const, activeLow: true },
    ];
    expect(() => validatePins(pins, 'x/y')).not.toThrow();
    expect(() => validatePins([{ name: 'YN', label: ' ', dir: 'out' }], 'x/y')).toThrow(
      'x/y: pin "YN" has an empty label',
    );
  });

  it('validatePins allows sense only on inputs', () => {
    expect(() => validatePins([{ name: 'A', dir: 'in', sense: true }], 'x/y')).not.toThrow();
    expect(() => validatePins([{ name: 'D', dir: 'bidir', sense: true }], 'x/y')).toThrow(
      'x/y: pin "D" is "bidir" and cannot be sense',
    );
  });

  it('validatePins allows bus pins only on nc pins', () => {
    expect(() => validatePins([{ name: 'B', dir: 'nc', bus: true }], 'x/y')).not.toThrow();
    expect(() => validatePins([{ name: 'A', dir: 'in', bus: false }], 'x/y')).not.toThrow();
    expect(() => validatePins([{ name: 'A', dir: 'in', bus: true }], 'x/y')).toThrow(
      'x/y: pin "A" is "in" and cannot be a bus pin',
    );
  });

  it('validatePins allows constant only on strong outputs, with level 0 or 1', () => {
    expect(() => validatePins([{ name: 'Y', dir: 'out', constant: 0 }], 'x/y')).not.toThrow();
    expect(() => validatePins([{ name: 'Y', dir: 'tristate', constant: 1 }], 'x/y')).toThrow(
      'x/y: pin "Y" is "tristate" and cannot be constant',
    );
    expect(() => validatePins([{ name: 'Y', dir: 'out', weak: true, constant: 1 }], 'x/y')).toThrow(
      'x/y: pin "Y" cannot be weak and constant',
    );
    const two = { name: 'Y', dir: 'out', constant: 2 } as unknown as PinDef;
    expect(() => validatePins([two], 'x/y')).toThrow('x/y: pin "Y" constant must be 0 or 1');
  });

  it('validatePins rejects a blank net name', () => {
    expect(() => validatePins([{ name: 'N', dir: 'nc', net: 'CLK' }], 'x/y')).not.toThrow();
    expect(() => validatePins([{ name: 'N', dir: 'nc', net: ' ' }], 'x/y')).toThrow(
      'x/y: pin "N" has an empty net name',
    );
  });

  it('validatePins allows weak only on driver pins', () => {
    expect(() => validatePins([{ name: 'Y', dir: 'out', weak: true }], 'x/y')).not.toThrow();
    expect(() => validatePins([{ name: 'A', dir: 'in', weak: true }], 'x/y')).toThrow(
      'x/y: pin "A" is "in" and cannot be weak',
    );
  });
});

describe('resolveProps', () => {
  it('fills in defaults', () => {
    expect(resolveProps(gate)).toEqual({ inputs: 2, delay: 1000, mode: 'a' });
    expect(resolveProps(gate, { inputs: 4 })).toEqual({ inputs: 4, delay: 1000, mode: 'a' });
  });

  it('rejects unknown props', () => {
    expect(() => resolveProps(gate, { input: 3 })).toThrow(
      'test/gate: unknown prop "input" (props: inputs, delay, mode)',
    );
  });

  it.each([
    [{ inputs: 1 }, 'prop "inputs" must be ≥ 2, got 1'],
    [{ inputs: 9 }, 'prop "inputs" must be ≤ 8, got 9'],
    [{ inputs: 2.5 }, 'prop "inputs" must be an integer, got 2.5'],
    [{ inputs: '3' }, 'prop "inputs" must be a finite number, got "3"'],
    [{ delay: 0.5 }, 'prop "delay" must be an integer number of picoseconds, got 0.5'],
    [{ delay: -1 }, 'prop "delay" must be ≥ 0, got -1'],
    [{ mode: 'c' }, 'prop "mode" must be one of "a", "b", got "c"'],
  ])('rejects %o', (raw, message) => {
    expect(() => resolveProps(gate, raw, 'U1')).toThrow(`U1: ${message}`);
  });

  it('checks boolean, string and color props', () => {
    const def = defineComponent({
      type: 'test/kinds',
      name: 'K',
      title: 'Kinds',
      pins: [],
      props: [
        { key: 'on', label: 'On', type: 'boolean', default: false },
        { key: 'label', label: 'Label', type: 'string', default: '' },
        { key: 'color', label: 'Color', type: 'color', default: '#f00' },
        { key: 'f', label: 'Frequency', type: 'number', default: 1.5 },
      ],
      create: () => ({}),
    });
    expect(resolveProps(def, { on: true })).toEqual({ on: true, label: '', color: '#f00', f: 1.5 });
    expect(() => resolveProps(def, { on: 1 })).toThrow('prop "on" must be a boolean, got 1');
    expect(() => resolveProps(def, { label: 2 })).toThrow('prop "label" must be a string, got 2');
    expect(() => resolveProps(def, { color: null })).not.toThrow(); // null → default
    expect(() => resolveProps(def, { f: Number.NaN })).toThrow('must be a finite number');
  });

  it('checks a string prop against its pattern', () => {
    const def = defineComponent({
      type: 'test/pattern',
      name: 'P',
      title: 'Pattern',
      pins: [],
      props: [
        {
          key: 'name',
          label: 'Name',
          type: 'string',
          default: 'A1',
          pattern: { regex: /^[A-Z][0-9]*$/, hint: 'a capital letter and digits' },
        },
      ],
      create: () => ({}),
    });
    expect(resolveProps(def, { name: 'B12' })).toEqual({ name: 'B12' });
    expect(() => resolveProps(def, { name: 'b1' }, 'U1')).toThrow(
      'U1: prop "name" must be a capital letter and digits, got "b1"',
    );
    expect(() => resolveProps(def, { name: 3 })).toThrow('prop "name" must be a string, got 3');
  });

  it('reports "none" for parts without props', () => {
    const def = defineComponent({
      type: 'test/none',
      name: 'N',
      title: 'None',
      pins: [],
      create: () => ({}),
    });
    expect(() => resolveProps(def, { x: 1 })).toThrow('unknown prop "x" (props: none)');
  });
});
