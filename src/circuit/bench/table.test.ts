import { describe, expect, it } from 'vitest';
import { parseTable } from './table';
import { BenchError } from './values';

/** The table of a tagged template, as `b.table` gets it. */
const table = (strings: TemplateStringsArray, ...values: unknown[]) => parseTable(strings, values);

/** The error a template makes: its message and line offset. */
function problem(strings: TemplateStringsArray, ...values: unknown[]) {
  try {
    parseTable(strings, values);
  } catch (error) {
    if (error instanceof BenchError) return { message: error.message, line: error.line };
    throw error;
  }
  return undefined;
}

describe('parseTable', () => {
  it('reads a header and rows, skipping blank lines and comments', () => {
    expect(
      table`
        # a counter
        ~{RST} EN CLK | Q[0..3] CO

        0      1  C   | 0       0    # clear
        1      1  C   | 1       -
      `,
    ).toEqual({
      inputs: ['~{RST}', 'EN', 'CLK'],
      outputs: ['Q[0..3]', 'CO'],
      rows: [
        { offset: 4, inputs: ['0', '1', 'C'], outputs: ['0', '0'] },
        { offset: 5, inputs: ['1', '1', 'C'], outputs: ['1', '-'] },
      ],
    });
  });

  it('puts interpolated values in their cells as they are', () => {
    const n = 7;
    const t = table`A B | Y
      ${n} ${0x2an} | ${'X'}`;
    expect(t.rows).toEqual([{ offset: 1, inputs: [7, 42n], outputs: ['X'] }]);
  });

  it('takes | without spaces, and tables with no inputs or no outputs', () => {
    expect(
      table`A|Y
      1|0`.rows,
    ).toEqual([{ offset: 1, inputs: ['1'], outputs: ['0'] }]);
    expect(table`| Y
      | 1`).toEqual({
      inputs: [],
      outputs: ['Y'],
      rows: [{ offset: 1, inputs: [], outputs: ['1'] }],
    });
    expect(table`A |`.rows).toEqual([]);
  });

  it('says what is wrong and on which line', () => {
    expect(problem`A B Y`).toEqual({
      message: 'table: the header needs one | between inputs and outputs, as in `A B | Y`',
      line: 0,
    });
    expect(problem`
      A B | Y
      0 1 0`).toEqual({ message: 'table: a row needs one | between inputs and outputs', line: 2 });
    expect(problem`A B | Y
      0 | 1`).toEqual({
      message: 'table: a row has 2 | 1 cells, as the header; this one has 1 | 1',
      line: 1,
    });
    expect(problem`A | Y | Z`).toMatchObject({ line: 0 });
    expect(problem`A A | Y`).toEqual({ message: 'table: A is in the header twice', line: 0 });
    expect(problem`A ${3} | Y`).toEqual({
      message: 'table: the header names signals: text, not a value',
      line: 0,
    });
    expect(problem`A | Y
      x${1} | 0`).toEqual({
      message: 'table: put ${…} in a cell of its own, with spaces around it',
      line: 1,
    });
    expect(problem`  # nothing
    `).toEqual({ message: 'table: no header (inputs | outputs) and no rows', line: 0 });
  });

  it('takes a header named by a value', () => {
    const signal = 'D[0..7]';
    expect(table`${signal} | Y`.inputs).toEqual(['D[0..7]']);
  });
});
