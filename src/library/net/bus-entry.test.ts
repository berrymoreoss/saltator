import { describe, expect, it } from 'vitest';
import { pinsOf, resolveProps, symbolOf } from '../../core';
import { createDefaultRegistry } from '../registry';
import { busEntry, FIRST_BUS_ENTRY_NAME } from './bus-entry';

describe('net/bus-entry', () => {
  it('is schematic-only: its bit end joins the net of its name, its bus end a bus line', () => {
    expect(busEntry.schematicOnly).toBe(true);
    expect(resolveProps(busEntry)).toEqual({ name: FIRST_BUS_ENTRY_NAME });
    expect(pinsOf(busEntry, resolveProps(busEntry, { name: 'D3' }))).toEqual([
      { name: 'N', dir: 'nc', net: 'D3', description: 'joins the net D3' },
      { name: 'B', dir: 'nc', bus: true, description: 'sits on a bus line' },
    ]);
    expect(createDefaultRegistry().get('net/bus-entry')).toBe(busEntry);
  });

  it('takes net names, not bus names', () => {
    expect(resolveProps(busEntry, { name: '~{WE}' })).toEqual({ name: '~{WE}' });
    expect(() => resolveProps(busEntry, { name: 'D[0..7]' }, 'BE1')).toThrow(
      'BE1: prop "name" must be letters, digits, _ + - / # and ~{…} for an overline, at most 32 characters, got "D[0..7]"',
    );
  });

  it('continues D0 with D1', () => {
    expect(busEntry.nextProps!({ name: 'D0' })).toEqual({ name: 'D1' });
    expect(busEntry.nextProps!({ name: 'A15' })).toEqual({ name: 'A16' });
  });

  it('is a diagonal across one cell, between its bit end and its bus end', () => {
    expect(symbolOf(busEntry, resolveProps(busEntry))).toEqual({
      kind: 'bus-entry',
      width: 1,
      height: 1,
      pins: { N: { side: 'left', offset: 0 }, B: { side: 'right', offset: 1 } },
    });
  });
});
