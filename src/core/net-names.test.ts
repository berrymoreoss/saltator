import { describe, expect, it } from 'vitest';
import { Level } from './logic';
import {
  BUS_NAME,
  busMembers,
  busValueText,
  isBusName,
  LABEL_NAME,
  NET_NAME,
  parseBusName,
} from './net-names';

const { L0, L1, X, Z } = Level;

describe('net names', () => {
  it.each([
    'A',
    'CLK',
    'D0',
    'BUS7',
    'RESET_N',
    '+5V',
    'R/W',
    'A-B',
    '#WR',
    '~{CLR}',
    '~{CS}1',
    'R/~{W}',
    'X'.repeat(32),
  ])('accepts the net name %s', (name) => {
    expect(NET_NAME.test(name)).toBe(true);
    expect(LABEL_NAME.test(name)).toBe(true);
  });

  it.each([
    '',
    ' ',
    'A B',
    'U1.Y',
    'D[0..7]',
    'D[3]',
    '~CLR',
    '~{}',
    '~{CLR',
    'CLR}',
    'É',
    'X'.repeat(33),
  ])('rejects the net name %j', (name) => {
    expect(NET_NAME.test(name)).toBe(false);
  });
});

describe('bus names', () => {
  it.each([
    ['D[0..7]', 'D', 0, 7],
    ['A[15..0]', 'A', 15, 0],
    ['DATA[0..99]', 'DATA', 0, 99],
    ['~{D}[0..3]', '~{D}', 0, 3],
    ['A1[0..3]', 'A1', 0, 3],
    ['Q[5..5]', 'Q', 5, 5],
    [`${'X'.repeat(26)}[0..1]`, 'X'.repeat(26), 0, 1], // 32 characters
  ])('takes %s apart', (name, stem, from, to) => {
    expect(BUS_NAME.test(name)).toBe(true);
    expect(isBusName(name)).toBe(true);
    expect(LABEL_NAME.test(name)).toBe(true);
    expect(parseBusName(name)).toEqual({ stem, from, to });
  });

  it.each([
    'D',
    'D0',
    'D[]',
    'D[0]',
    'D[0..]',
    'D[..7]',
    'D[0...7]',
    'D[00..7]',
    'D[0..100]',
    'D[-1..7]',
    '[0..7]',
    'D[0..7]X',
    'D [0..7]',
    'D.Q[0..7]',
    'D[0..7][0..1]',
    `${'X'.repeat(27)}[0..1]`, // 33 characters
  ])('rejects the bus name %j', (name) => {
    expect(BUS_NAME.test(name)).toBe(false);
    expect(parseBusName(name)).toBeUndefined();
  });

  it('lets a label be a net name or a bus name, nothing else', () => {
    expect(LABEL_NAME.test('D0')).toBe(true);
    expect(LABEL_NAME.test('D[0..7]')).toBe(true);
    for (const name of ['D[0]', 'D[0..100]', 'U1.Y', `${'X'.repeat(27)}[0..1]`, '']) {
      expect(LABEL_NAME.test(name)).toBe(false);
    }
  });

  it('lists the members least significant bit first, either way round', () => {
    const d = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'];
    expect(busMembers('D[0..7]')).toEqual(d);
    expect(busMembers('D[7..0]')).toEqual(d);
    expect(busMembers('A[8..11]')).toEqual(['A8', 'A9', 'A10', 'A11']);
    expect(busMembers('~{D}[1..2]')).toEqual(['~{D}1', '~{D}2']);
    expect(busMembers('CLK')).toEqual([]);
  });

  it('has members that are net names', () => {
    for (const name of ['D[0..99]', `${'X'.repeat(26)}[0..1]`, '~{D}[0..3]']) {
      for (const member of busMembers(name)) expect(NET_NAME.test(member)).toBe(true);
    }
  });
});

describe('busValueText', () => {
  /** Levels from a binary string written most significant bit first. */
  const bits = (text: string) =>
    [...text].reverse().map((c) => ({ '0': L0, '1': L1, X, Z })[c as '0' | '1' | 'X' | 'Z']);

  it.each([
    ['00111111', '0x3F'],
    ['00000000', '0x00'],
    ['11111111', '0xFF'],
    ['10100101', '0xA5'],
    ['0101', '0x5'],
    ['101', '0x5'], // a partial nibble
    ['110100101', '0x1A5'],
    ['1111111111111111', '0xFFFF'],
    ['ZZZZZZZZ', '0xZZ'],
    ['00X11111', '0xXF'],
    ['ZZZZ0001', '0xZ1'],
    ['0Z010000', '0xX0'], // partly floating
    ['ZZZX0000', '0xX0'],
    ['XXXXXXXX', '0xXX'],
  ])('shows %s as %s', (levels, text) => {
    expect(busValueText(bits(levels))).toBe(text);
  });
});
