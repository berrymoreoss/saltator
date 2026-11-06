import { describe, expect, it } from 'vitest';
import { ns, type PropDef } from '../core';
import { parsePropText, propText } from './prop-input';

const integer: PropDef = {
  key: 'inputs',
  label: 'Inputs',
  type: 'integer',
  default: 2,
  min: 2,
  max: 8,
};
const number: PropDef = {
  key: 'hz',
  label: 'Frequency',
  type: 'number',
  default: 1,
  min: 0.001,
  unit: 'Hz',
};
const time: PropDef = { key: 'delay', label: 'Delay', type: 'time', default: ns(1), min: 0 };
const options = [
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
];
const choice: PropDef = { key: 'color', label: 'Color', type: 'enum', default: 'red', options };

describe('prop input', () => {
  it('shows values as editable text', () => {
    expect(propText(time, ns(2.5))).toBe('2.5 ns');
    expect(propText(integer, 3)).toBe('3');
    expect(propText(integer, undefined)).toBe('');
  });

  it('reads integers and numbers within their limits', () => {
    expect(parsePropText(integer, ' 4 ')).toEqual({ value: 4 });
    expect(parsePropText(integer, '4.5')).toEqual({ error: 'Enter a whole number.' });
    expect(parsePropText(integer, '9')).toEqual({ error: 'Enter a number between 2 and 8.' });
    expect(parsePropText(integer, '')).toEqual({ error: 'Enter a number.' });
    expect(parsePropText(number, '2.5 Hz')).toEqual({ value: 2.5 });
    expect(parsePropText(number, '0')).toEqual({ error: 'Enter a number at least 0.001.' });
    expect(parsePropText(number, 'fast')).toEqual({ error: 'Enter a number.' });
  });

  it('reads times with units', () => {
    expect(parsePropText(time, '10 ns')).toEqual({ value: ns(10) });
    expect(parsePropText(time, '1.5us')).toEqual({ value: ns(1500) });
    expect(parsePropText(time, '7')).toEqual({ value: ns(7) });
    expect(parsePropText(time, 'soon')).toMatchObject({ error: expect.stringMatching(/10 ns/) });
    const bounded: PropDef = { ...time, min: ns(1), max: ns(100) };
    expect(parsePropText(bounded, '1 µs')).toEqual({
      error: 'Enter a time between 1 ns and 100 ns.',
    });
  });

  it('accepts only listed options for enums', () => {
    expect(parsePropText(choice, 'green')).toEqual({ value: 'green' });
    expect(parsePropText(choice, 'mauve')).toEqual({ error: 'Choose one of the options.' });
  });
});
