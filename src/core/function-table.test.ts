import { describe, expect, it } from 'vitest';
import {
  type FunctionTable,
  parseFunctionTableRow,
  stateReference,
  validateFunctionTable,
} from './function-table';

const nand: FunctionTable = {
  inputs: ['nA', 'nB'],
  outputs: ['nY'],
  rows: ['L X | H', 'X L | H', 'H H | L'],
  note: 'each gate',
};

describe('parseFunctionTableRow', () => {
  it('splits a row into input and output cells, whitespace-insensitive', () => {
    expect(parseFunctionTableRow(nand, '  L   X|H ')).toEqual({
      inputs: ['L', 'X'],
      outputs: ['H'],
    });
  });

  it('keeps text cells for display', () => {
    const xcvr: FunctionTable = { inputs: ['OE', 'DIR'], outputs: ['An', 'Bn'], rows: [] };
    expect(parseFunctionTableRow(xcvr, 'L L | A=B input')).toEqual({
      inputs: ['L', 'L'],
      outputs: ['A=B', 'input'],
    });
  });

  it.each(['L L H', 'L | H', 'L L | H | H', 'L L |'])('rejects %j', (row) => {
    expect(() => parseFunctionTableRow(nand, row)).toThrow(
      `function table row "${row}": expected 2 inputs | 1 outputs`,
    );
  });
});

describe('validateFunctionTable', () => {
  it('accepts a well-formed table', () => {
    expect(() => validateFunctionTable(nand, 'U1')).not.toThrow();
  });

  it('rejects missing columns, bad or duplicate names, no rows and malformed rows', () => {
    const check = (table: Partial<FunctionTable>) => () =>
      validateFunctionTable({ ...nand, ...table }, 'x/y');
    expect(check({ inputs: [] })).toThrow('x/y: function table needs input and output columns');
    expect(check({ outputs: [] })).toThrow('x/y: function table needs input and output columns');
    expect(check({ inputs: ['nA', 'n B'] })).toThrow('x/y: bad function table column "n B"');
    expect(check({ inputs: ['nA', ''] })).toThrow('x/y: bad function table column ""');
    expect(check({ outputs: ['nA'] })).toThrow('x/y: duplicate function table column "nA"');
    expect(check({ rows: [] })).toThrow('x/y: function table has no rows');
    expect(check({ rows: ['L X | H', 'H | L'] })).toThrow(
      'x/y: function table row "H | L": expected 2 inputs | 1 outputs',
    );
    expect(check({ state: { q: 'nQ' } })).toThrow('x/y: bad function table state "q" → "nQ"');
    expect(check({ state: { Q: 'nY' } })).toThrow('x/y: bad function table state "Q" → "nY"');
    expect(() => validateFunctionTable({ ...nand, state: { q: 'nY' } }, 'x/y')).not.toThrow();
  });
});

describe('stateReference', () => {
  const jk: FunctionTable = { ...nand, outputs: ['nQ', 'nQN'], state: { q: 'nQ' } };

  it('reads a previous-state letter, complemented with an overline', () => {
    expect(stateReference(jk, 'q')).toEqual({ column: 'nQ', inverted: false });
    expect(stateReference(jk, 'q̅')).toEqual({ column: 'nQ', inverted: true });
  });

  it('leaves other cells alone', () => {
    expect(stateReference(jk, 'H')).toBeUndefined();
    expect(stateReference(jk, 'input')).toBeUndefined();
    expect(stateReference(nand, 'q')).toBeUndefined();
  });
});
