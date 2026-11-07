import { describe, expect, it } from 'vitest';
import { dipPins, pins } from './pinout';

describe('pins', () => {
  it('pairs symbols with pin numbers in order', () => {
    expect(pins('1A, 2A', '1, 4', 'in', 'data input')).toEqual({
      names: ['1A', '2A'],
      numbers: [1, 4],
      dir: 'in',
      description: 'data input',
    });
  });

  it('names n.c. pins after their numbers and keeps flags', () => {
    expect(pins('n.c.', '3, 11', 'nc', 'not connected').names).toEqual(['NC3', 'NC11']);
    expect(pins('OE', '19', 'in', 'output enable', { activeLow: true }).activeLow).toBe(true);
  });

  it('keeps a label on a one-pin row and passes it to the pin', () => {
    const row = pins('YN', '6', 'out', 'complementary output', { activeLow: true, label: 'Y' });
    expect(dipPins(1, [{ ...row, numbers: [1] }])[0]).toMatchObject({ name: 'YN', label: 'Y' });
    expect(() => pins('A, B', '1, 2', 'in', '', { label: 'A' })).toThrow(
      'pin row "A, B": a label needs a row of one pin',
    );
  });

  it('rejects rows whose symbols and numbers do not match', () => {
    expect(() => pins('1A, 2A', '1', 'in', '')).toThrow('pin row "1A, 2A": 2 names for pins "1"');
    expect(() => pins('1A', 'x', 'in', '')).toThrow('pin row "1A": 1 names for pins "x"');
  });
});

describe('dipPins', () => {
  const rows = [
    pins('Y', '3', 'out', 'data output'),
    pins('A, B', '1, 2', 'in', 'data input', { activeLow: true }),
    pins('VCC', '4', 'power', 'supply voltage'),
  ];

  it('lists pins in pin-number order with their descriptions', () => {
    expect(dipPins(4, rows)).toEqual([
      { name: 'A', number: 1, dir: 'in', description: 'data input', activeLow: true },
      { name: 'B', number: 2, dir: 'in', description: 'data input', activeLow: true },
      { name: 'Y', number: 3, dir: 'out', description: 'data output' },
      { name: 'VCC', number: 4, dir: 'power', description: 'supply voltage' },
    ]);
  });

  it('rejects missing, repeated and out-of-range pin numbers', () => {
    expect(() => dipPins(5, rows)).toThrow('pin 5 of 5 not listed');
    expect(() => dipPins(4, [...rows, pins('Q', '3', 'out', '')])).toThrow(
      'pin 3 listed twice (Q)',
    );
    expect(() => dipPins(3, rows)).toThrow('pin VCC: number 4 not in 1…3');
  });
});
