import { describe, expect, it } from 'vitest';
import { type AnyComponentDefinition, KernelDiagnosticKind, ns, pinsOf } from '../../core';
import { Bench, functionTable, Trace, truthTable } from '../../core/testing';
import { GATE_SPECS, hcGates } from './gates';

const chip = (number: string) => hcGates.find((d) => d.name === `74HC${number}`)!;
const nameAt = (d: AnyComponentDefinition, number: number) =>
  pinsOf(d, {}).find((p) => p.number === number)!.name;

/**
 * Every gate by physical pin numbers — inputs, then the output — read off each data sheet's
 * pinning figure: an independent transcription the function tables are checked through.
 */
const GATES_BY_PIN: Readonly<Record<string, readonly (readonly number[])[]>> = {
  '00': [
    [1, 2, 3],
    [4, 5, 6],
    [9, 10, 8],
    [12, 13, 11],
  ],
  '02': [
    [2, 3, 1],
    [5, 6, 4],
    [8, 9, 10],
    [11, 12, 13],
  ],
  '04': [
    [1, 2],
    [3, 4],
    [5, 6],
    [9, 8],
    [11, 10],
    [13, 12],
  ],
  '08': [
    [1, 2, 3],
    [4, 5, 6],
    [9, 10, 8],
    [12, 13, 11],
  ],
  '10': [
    [1, 2, 13, 12],
    [3, 4, 5, 6],
    [9, 10, 11, 8],
  ],
  '11': [
    [1, 2, 13, 12],
    [3, 4, 5, 6],
    [9, 10, 11, 8],
  ],
  '14': [
    [1, 2],
    [3, 4],
    [5, 6],
    [9, 8],
    [11, 10],
    [13, 12],
  ],
  '20': [
    [1, 2, 4, 5, 6],
    [9, 10, 12, 13, 8],
  ],
  '21': [
    [1, 2, 4, 5, 6],
    [9, 10, 12, 13, 8],
  ],
  '27': [
    [1, 2, 13, 12],
    [3, 4, 5, 6],
    [9, 10, 11, 8],
  ],
  '30': [[1, 2, 3, 4, 5, 6, 11, 12, 8]],
  '32': [
    [1, 2, 3],
    [4, 5, 6],
    [9, 10, 8],
    [12, 13, 11],
  ],
  '86': [
    [1, 2, 3],
    [4, 5, 6],
    [9, 10, 8],
    [12, 13, 11],
  ],
};

/** Typical tpd at VCC = 4.5 V, CL = 50 pF from each data sheet's table 7, in ns. */
const TPD_NS: Readonly<Record<string, number>> = {
  '00': 9,
  '02': 9,
  '04': 9,
  '08': 9,
  '10': 11,
  '11': 12,
  '14': 15,
  '20': 10,
  '21': 12,
  '27': 10,
  '30': 15,
  '32': 8,
  '86': 14,
};

describe.each(GATE_SPECS.map((spec) => [spec.number, spec] as const))('74HC%s', (number, spec) => {
  const def = chip(number);

  it('follows its data sheet function table on every gate, by pin number', () => {
    const bench = new Bench(def);
    for (const gate of GATES_BY_PIN[number]!) {
      const names = gate.map((n) => nameAt(def, n));
      expect(functionTable(bench, def.functionTable!, names)).toBeGreaterThan(0);
    }
  });

  it('lists one unit per gate, inputs first', () => {
    const byPin = spec.units.map((unit) =>
      unit.pins.map((name) => pinsOf(def, {}).find((p) => p.name === name)!.number),
    );
    expect(byPin).toEqual(GATES_BY_PIN[number]);
  });

  it('switches its output tpd after an input, both ways', () => {
    expect(def.timing!.typical.tpd).toBe(ns(TPD_NS[number]!));
    const [first, ...rest] = spec.units[0]!.pins.slice(0, -1);
    const output = spec.units[0]!.pins.at(-1)!;
    // The other inputs at the level that lets the first one through.
    const pass = spec.op === 'and' ? 1 : 0;
    const bench = new Bench(def);
    bench.set({ ...Object.fromEntries(rest.map((pin) => [pin, pass])), [first!]: 0 }).settle();
    expect(bench.measure({ [first!]: 1 }, output)).toBe(ns(TPD_NS[number]!));
    expect(bench.measure({ [first!]: 0 }, output)).toBe(ns(TPD_NS[number]!));
  });
});

describe('unknown and floating inputs', () => {
  it('NAND (74HC00): a 0 decides, otherwise X', () => {
    truthTable(
      new Bench(chip('00')),
      ['1A', '1B'],
      ['1Y'],
      [
        [0, 'X', 1],
        ['X', 0, 1],
        [1, 'X', 'X'],
        ['Z', 1, 'X'],
        ['Z', 0, 1],
      ],
    );
  });

  it('NOR (74HC02): a 1 decides, otherwise X', () => {
    truthTable(
      new Bench(chip('02')),
      ['1A', '1B'],
      ['1Y'],
      [
        [1, 'X', 0],
        ['Z', 1, 0],
        [0, 'X', 'X'],
        ['Z', 0, 'X'],
      ],
    );
  });

  it('AND (74HC08) and OR (74HC32)', () => {
    truthTable(
      new Bench(chip('08')),
      ['1A', '1B'],
      ['1Y'],
      [
        [0, 'Z', 0],
        [1, 'X', 'X'],
      ],
    );
    truthTable(
      new Bench(chip('32')),
      ['1A', '1B'],
      ['1Y'],
      [
        [1, 'Z', 1],
        [0, 'X', 'X'],
      ],
    );
  });

  it('XOR (74HC86): any unknown input gives X', () => {
    truthTable(
      new Bench(chip('86')),
      ['1A', '1B'],
      ['1Y'],
      [
        [0, 'X', 'X'],
        [1, 'Z', 'X'],
        ['X', 'X', 'X'],
      ],
    );
  });

  it('inverters (74HC04, 74HC14)', () => {
    for (const number of ['04', '14']) {
      truthTable(
        new Bench(chip(number)),
        ['1A'],
        ['1Y'],
        [
          ['X', 'X'],
          ['Z', 'X'],
          [0, 1],
        ],
      );
    }
  });

  it('unused gates with floating inputs drive X and their inputs are reported', () => {
    const bench = new Bench(chip('00'));
    bench.set({ '1A': 1, '1B': 1 }).settle();
    expect(bench.levels(['1Y', '2Y', '3Y', '4Y'])).toEqual({
      '1Y': '0',
      '2Y': 'X',
      '3Y': 'X',
      '4Y': 'X',
    });
    const floating = bench.diagnostics.filter(
      (d) => d.kind === KernelDiagnosticKind.FLOATING_INPUT,
    );
    expect(floating.map((d) => d.pin).sort()).toEqual(['2A', '2B', '3A', '3B', '4A', '4B']);
  });
});

describe('gate sections', () => {
  it('are independent: a change on one gate leaves the others alone', () => {
    const bench = new Bench(chip('00'));
    bench.set({ '1A': 1, '1B': 1, '2A': 1, '2B': 0, '3A': 0, '3B': 0, '4A': 1, '4B': 1 }).settle();
    const trace = new Trace(bench.sim);
    bench.set({ '2B': 1 }).settle();
    expect(trace.lines().map((line) => line.split(' ')[1])).toEqual(['2B=1', '2Y=0']);
  });
});
