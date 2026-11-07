import { describe, expect, it } from 'vitest';
import { pinsOf, resolveProps, symbolOf } from '../../core';
import { FIRST_NET_NAME, NET_NAME, netLabel, netLabelWidth, nextNetName } from './label';

describe('net/label', () => {
  it('is schematic-only, with one pin joining the net of its name', () => {
    expect(netLabel.schematicOnly).toBe(true);
    const props = resolveProps(netLabel, { name: 'CLK' });
    expect(pinsOf(netLabel, props)).toEqual([
      { name: 'N', dir: 'nc', net: 'CLK', description: 'joins every net label named CLK' },
    ]);
    expect(resolveProps(netLabel)).toEqual({ name: FIRST_NET_NAME });
  });

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
  ])('accepts the name %s', (name) => {
    expect(NET_NAME.test(name)).toBe(true);
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
  ])('rejects the name %j', (name) => {
    expect(NET_NAME.test(name)).toBe(false);
  });

  it('refuses a bad name with a hint saying what names may be', () => {
    expect(() => resolveProps(netLabel, { name: 'A B' }, 'NL1')).toThrow(
      'NL1: prop "name" must be letters, digits, _ + - / # and ~{…} for an overline, at most 32 characters, got "A B"',
    );
  });

  it('is a centered tag as wide as its name', () => {
    expect(netLabelWidth('A')).toBe(2);
    expect(netLabelWidth('CLK')).toBe(3);
    expect(netLabelWidth('~{CLR}')).toBe(netLabelWidth('CLR')); // the marks take no room
    expect(netLabelWidth('X'.repeat(32))).toBe(13);
    expect(symbolOf(netLabel, resolveProps(netLabel, { name: 'CLK' }))).toEqual({
      kind: 'net-label',
      width: 3,
      height: 1,
      centered: true,
      pins: { N: { side: 'left', offset: 0 } },
    });
  });

  it.each([
    ['D0', 'D1'],
    ['A7', 'A8'],
    ['D9', 'D10'],
    ['A09', 'A10'],
    ['BUS007', 'BUS008'],
    ['~{CS}1', '~{CS}2'],
    ['NET1', 'NET2'],
    ['CLK', 'CLK'],
    ['~{CLR}', '~{CLR}'],
    ['1', '2'],
    [`${'X'.repeat(31)}9`, `${'X'.repeat(31)}9`], // D10 would be 33 characters
  ])('continues %s with %s', (name, next) => {
    expect(nextNetName(name)).toBe(next);
  });
});
