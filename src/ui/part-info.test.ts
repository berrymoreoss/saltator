import { describe, expect, it } from 'vitest';
import type { TextRun } from '../core';
import { createDefaultRegistry } from '../library';
import {
  columnRuns,
  datasheetName,
  functionTableInfo,
  outputsHeading,
  pinInfo,
  timingInfo,
} from './part-info';

const registry = createDefaultRegistry();
const part = (type: string) => registry.get(type)!;
/** Runs as text, overlined pieces marked with a leading ‾: `1‾RD`. */
const shown = (runs: readonly TextRun[]) =>
  runs.map((r) => `${r.overline ? '‾' : ''}${r.text}`).join('');

describe('pinInfo', () => {
  it('lists a chip’s pins in pin-number order with type and datasheet description', () => {
    const pins = pinInfo(part('74xx/74hc02'));
    expect(pins.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(pins[0]).toEqual({
      number: 1,
      name: '1Y',
      runs: [{ text: '1Y', overline: false }],
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
      { name: 'A', runs: [{ text: 'A', overline: false }], activeLow: false, type: 'input' },
      { name: 'K', runs: [{ text: 'K', overline: false }], activeLow: false, type: 'input' },
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
    const columns = columnRuns(part('74xx/74hc151'));
    expect(shown(columns.get('YN')!)).toBe('‾Y');
    expect(shown(columns.get('E')!)).toBe('‾E');
    expect(shown(columns.get('Y')!)).toBe('Y');
  });

  it("overlines an active-LOW pin's letters, not its digits, as the data sheets do", () => {
    const rows = pinInfo(part('74xx/74hc74'));
    expect(shown(rows.find((r) => r.number === 1)!.runs)).toBe('1‾RD');
    expect(shown(rows.find((r) => r.number === 6)!.runs)).toBe('1‾Q');
    expect(shown(pinInfo(part('74xx/74hc138')).find((r) => r.number === 4)!.runs)).toBe('‾E1');
    // Marked labels: the 175 overlines Q̅0̅ whole, the 191 only the U of U̅/D.
    expect(shown(pinInfo(part('74xx/74hc175')).find((r) => r.number === 3)!.runs)).toBe('‾Q0');
    const ud = pinInfo(part('74xx/74hc191')).find((r) => r.number === 5)!;
    expect([ud.name, shown(ud.runs), ud.id]).toEqual(['U/D', '‾U/D', 'UD']);
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

describe('columnRuns', () => {
  it('draws the columns that name pins as the pins are drawn, generic numbers as n', () => {
    const of = (type: string) =>
      Object.fromEntries(
        [...columnRuns(part(type))].map(([column, runs]) => [column, shown(runs)]),
      );
    expect(of('74xx/74hc125')).toEqual({ nA: 'nA', nOE: 'n‾OE', nY: 'nY' });
    expect(of('74xx/74hc245')).toMatchObject({ OE: '‾OE', DIR: 'DIR' });
    expect(of('74xx/74hc126')).toMatchObject({ nOE: 'nOE' }); // active high
    expect(of('74xx/74hc139')).toMatchObject({ nE: 'n‾E', nY0: 'n‾Y0' });
    expect(of('prim/nand')).toEqual({});
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

describe('timingInfo', () => {
  const of = (type: string) => timingInfo(registry.get(type)!)!;

  it('lists delays with typical and max, pin names as drawn', () => {
    const t = of('74xx/74hc74');
    expect(t.delays[0]).toEqual({
      symbol: 'tpd',
      path: [
        { runs: [{ text: 'nCP', overline: false }] },
        ' to ',
        { runs: [{ text: 'nQ', overline: false }] },
        ', ',
        // 1QN, drawn 1Q̅
        {
          runs: [
            { text: 'n', overline: false },
            { text: 'Q', overline: true },
          ],
        },
      ],
      typical: '17 ns',
      max: '44 ns',
    });
  });

  it('lists the requirements with their typical value and the minimum the checks use', () => {
    const t = of('74xx/74hc74');
    expect(t.requirements.map((r) => [r.symbol, r.typical, r.min])).toEqual([
      ['tW', '7 ns', '20 ns'],
      ['tW', '7 ns', '20 ns'],
      ['trec', '1 ns', '8 ns'],
      ['tsu', '2 ns', '15 ns'],
      ['th', '-2 ns', '3 ns'],
    ]);
    expect(t.conditions).toContain('min at −40 °C to +85 °C');
    expect(t.source).toMatch(/^Nexperia 74HC_HCT74 product data sheet, rev\. 9/);
  });

  it('overlines a falling-edge clock, and leaves single delays without a path', () => {
    expect(of('74xx/74hc107').delays[0]!.path[0]).toEqual({
      runs: [
        { text: 'n', overline: false },
        { text: 'CP', overline: true },
      ],
    });
    expect(of('74xx/74hc00')).toMatchObject({
      delays: [{ symbol: 'tpd', path: [], typical: '9 ns', max: '23 ns' }],
      requirements: [],
    });
    expect(timingInfo(registry.get('io/led')!)).toBeUndefined();
  });

  it('shows a memory’s limits: max and min of a delay, minima of outputs and requirements', () => {
    const rom = of('mem/at28c16');
    expect(rom.limitsOnly).toBe(true);
    expect(rom.delays.map((r) => [r.symbol, r.typical, r.max, r.min])).toEqual([
      ['tACC', undefined, '150 ns', undefined],
      ['tCE', undefined, '150 ns', undefined],
      ['tOE', undefined, '70 ns', '10 ns'],
      ['tDF', undefined, '50 ns', '0 ps'],
    ]);
    expect(rom.requirements.map((r) => [r.symbol, r.min])).toEqual([['tOH', '0 ps']]);
    expect(of('74xx/74hc74').limitsOnly).toBe(false);
  });

  it('shows the timing of an instance’s speed grade', () => {
    const tAA = (speed?: string) =>
      timingInfo(registry.get('mem/6116')!, speed ? { speed } : {})!.delays.find(
        (r) => r.symbol === 'tAA',
      )!.max;
    expect(tAA()).toBe('25 ns');
    expect(tAA('15')).toBe('15 ns');
    expect(tAA('nonsense')).toBe('25 ns');
  });
});
