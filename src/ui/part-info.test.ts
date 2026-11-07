import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../library';
import {
  activeLowColumns,
  columnLabels,
  datasheetName,
  functionTableInfo,
  outputsHeading,
  pinInfo,
} from './part-info';

const registry = createDefaultRegistry();
const part = (type: string) => registry.get(type)!;

describe('pinInfo', () => {
  it('lists a chip’s pins in pin-number order with type and datasheet description', () => {
    const pins = pinInfo(part('74xx/74hc02'));
    expect(pins.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(pins[0]).toEqual({
      number: 1,
      name: '1Y',
      activeLow: false,
      type: 'output',
      description: 'data output',
    });
    expect(pins[6]).toMatchObject({ name: 'GND', type: 'power', description: 'ground (0 V)' });
  });

  it('marks active-low pins, shows n.c. pins as NC and names every pin type', () => {
    const hc245 = pinInfo(part('74xx/74hc245'));
    expect(hc245.find((p) => p.number === 19)).toMatchObject({ name: 'OE', activeLow: true });
    expect(hc245.find((p) => p.number === 2)?.type).toBe('input/output');
    expect(pinInfo(part('74xx/74hc20')).find((p) => p.number === 3)).toMatchObject({
      name: 'NC',
      type: 'not connected',
    });
    expect(pinInfo(part('74xx/74hc125')).find((p) => p.number === 3)?.type).toBe('3-state output');
  });

  it('follows an instance’s props, and its defaults when they are invalid', () => {
    expect(pinInfo(part('prim/nand'), { inputs: 3 }).map((p) => p.name)).toEqual([
      'A',
      'B',
      'C',
      'Y',
    ]);
    expect(pinInfo(part('prim/nand'), { inputs: 99 })).toHaveLength(3);
    // No numbers, no descriptions: definition order, nothing invented.
    expect(pinInfo(part('io/led'))).toEqual([
      { name: 'A', activeLow: false, type: 'input' },
      { name: 'K', activeLow: false, type: 'input' },
    ]);
  });
});

describe('pins that are not simulated', () => {
  it('keeps their names: a 555 in astable mode draws its timing pins', () => {
    const rows = pinInfo(part('timer/ne555'), { mode: 'astable' });
    expect(rows.find((r) => r.number === 2)).toEqual(
      expect.objectContaining({ name: 'TRIG', type: 'not simulated' }),
    );
    const bistable = pinInfo(part('timer/ne555'), { mode: 'bistable' });
    expect(bistable.find((r) => r.number === 2)?.type).toBe('input');
    expect(pinInfo(part('74xx/74hc20')).find((r) => r.number === 3)).toEqual(
      expect.objectContaining({ name: 'NC', type: 'not connected' }),
    );
  });
});

describe('pin labels', () => {
  it('shows a labelled pin under its label, with its name as the id', () => {
    const rows = pinInfo(part('74xx/74hc151'));
    expect(rows.find((r) => r.number === 5)).toEqual(
      expect.objectContaining({ name: 'Y', activeLow: false }),
    );
    expect(rows.find((r) => r.number === 5)!.id).toBeUndefined();
    expect(rows.find((r) => r.number === 6)).toEqual(
      expect.objectContaining({ name: 'Y', id: 'YN', activeLow: true }),
    );
  });

  it('heads the function table column of a labelled pin with its label, overlined', () => {
    const hc151 = part('74xx/74hc151');
    expect([...columnLabels(hc151)]).toEqual([['YN', 'Y']]);
    expect(activeLowColumns(hc151)).toEqual(new Set(['E', 'YN']));
    expect(columnLabels(part('74xx/74hc00')).size).toBe(0);
  });
});

describe('functionTableInfo', () => {
  it('splits rows into cells and keeps the note', () => {
    expect(functionTableInfo(part('74xx/74hc00').functionTable)).toEqual({
      inputs: ['nA', 'nB'],
      outputs: ['nY'],
      rows: [
        { inputs: ['L', 'X'], outputs: ['H'] },
        { inputs: ['X', 'L'], outputs: ['H'] },
        { inputs: ['H', 'H'], outputs: ['L'] },
      ],
      note: 'each gate (n = 1 to 4)',
    });
  });

  it('spaces out datasheet text cells and is undefined without a table', () => {
    const info = functionTableInfo(part('74xx/74hc245').functionTable)!;
    expect(info.rows[0]).toEqual({ inputs: ['L', 'L'], outputs: ['A = B', 'input'] });
    expect(functionTableInfo(part('prim/nand').functionTable)).toBeUndefined();
  });
});

describe('activeLowColumns', () => {
  it('finds the columns that name active-low pins', () => {
    expect([...activeLowColumns(part('74xx/74hc125'))]).toEqual(['nOE']);
    expect([...activeLowColumns(part('74xx/74hc244'))]).toEqual(['nOE']);
    expect([...activeLowColumns(part('74xx/74hc245'))]).toEqual(['OE']);
    expect([...activeLowColumns(part('74xx/74hc126'))]).toEqual([]); // active high
    expect([...activeLowColumns(part('prim/nand'))]).toEqual([]);
  });

  it('heads bus port columns as inputs/outputs, as the 245 data sheet does', () => {
    expect(outputsHeading(part('74xx/74hc245'))).toBe('Inputs/outputs');
    expect(outputsHeading(part('74xx/74hc244'))).toBe('Outputs');
  });
});

describe('datasheetName', () => {
  it('is the document’s file name, else the host', () => {
    expect(datasheetName('https://assets.nexperia.com/documents/data-sheet/74HC_HCT00.pdf')).toBe(
      '74HC_HCT00',
    );
    expect(datasheetName('https://www.ti.com/')).toBe('www.ti.com');
    expect(datasheetName('not a url')).toBe('not a url');
  });
});
