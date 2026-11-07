import { describe, expect, it } from 'vitest';
import { ns, type PropDef } from '../core';
import { formatSi, parsePropText, parseSi, propText } from './prop-input';

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

const resistance: PropDef = {
  key: 'ra',
  label: 'RA',
  type: 'number',
  default: 1000,
  min: 1,
  max: 10e6,
  unit: 'Ω',
  si: true,
};

describe('SI prefixes', () => {
  it('formats with a prefix and 4 significant digits', () => {
    expect(formatSi(4700, 'Ω')).toBe('4.7 kΩ');
    expect(formatSi(1e-7, 'F')).toBe('100 nF');
    expect(formatSi(1e-6, 'F')).toBe('1 µF');
    expect(formatSi(1, 'Hz')).toBe('1 Hz');
    expect(formatSi(0.001, 'Hz')).toBe('1 mHz');
    expect(formatSi(1_234_567, 'Ω')).toBe('1.235 MΩ');
    expect(formatSi(999.99, 'Ω')).toBe('1 kΩ');
    expect(formatSi(0, 'F')).toBe('0 F');
    expect(formatSi(1e-15, 'F')).toBe('0.001 pF');
  });

  it('reads a number with an optional prefix and unit, exactly', () => {
    expect(parseSi('4.7k')).toBe(4700);
    expect(parseSi('4.7 kΩ', 'Ω')).toBe(4700);
    expect(parseSi('100n', 'F')).toBe(1e-7);
    expect(parseSi('1u', 'F')).toBe(1e-6);
    expect(parseSi('1 µF', 'F')).toBe(1e-6);
    expect(parseSi('2.2M')).toBe(2.2e6);
    expect(parseSi('1m', 'Hz')).toBe(0.001);
    expect(parseSi('1e3 k')).toBe(1e6);
    expect(parseSi('22', 'Ω')).toBe(22);
    expect(parseSi('k')).toBeUndefined();
    expect(parseSi('1 x')).toBeUndefined();
    expect(parseSi('1 kF', 'Ω')).toBeUndefined();
  });

  it('is how Properties shows and reads props marked si', () => {
    expect(propText(resistance, 100_000)).toBe('100 kΩ');
    expect(parsePropText(resistance, '1M')).toEqual({ value: 1e6 });
    expect(parsePropText(resistance, '100 kΩ')).toEqual({ value: 1e5 });
    expect(parsePropText(resistance, '20M')).toEqual({
      error: 'Enter a number between 1 Ω and 10 MΩ.',
    });
    expect(parsePropText(resistance, 'lots')).toEqual({
      error: 'Enter a value such as 4.7k or 100n.',
    });
  });
});

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

  it('checks a string prop with a pattern, without the spaces at its ends', () => {
    const name: PropDef = {
      key: 'name',
      label: 'Name',
      type: 'string',
      default: 'A',
      pattern: { regex: /^[A-Z]+$/, hint: 'capital letters' },
    };
    expect(parsePropText(name, ' CLK ')).toEqual({ value: 'CLK' });
    expect(parsePropText(name, 'a b')).toEqual({ error: 'Use capital letters.' });
    const free: PropDef = { key: 'text', label: 'Text', type: 'string', default: '' };
    expect(parsePropText(free, ' a b ')).toEqual({ value: ' a b ' });
  });
});
