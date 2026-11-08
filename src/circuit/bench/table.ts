/**
 * Text tables of test vectors (R15a): `` b.table`…` `` in a test script. The first line names
 * the signals, inputs `|` outputs; each later line is a row, run as one step. Cells are separated
 * by spaces; `#` starts a comment; `${…}` puts a script value in a cell of its own. Spec:
 * docs/circuit.md#test-benches.
 *
 * ```text
 *   ~{RST} EN CLK | Q[0..3] CO
 *   0      1  C   | 0       0      # synchronous clear
 *   1      1  C   | ${n}    -
 * ```
 */
import { BenchError } from './values';

/** One row of a table: its cells as written (text) or interpolated (any script value). */
export interface TableRow {
  /** Lines from the start of the template to the row (0: the line the template starts on). */
  readonly offset: number;
  readonly inputs: readonly unknown[];
  readonly outputs: readonly unknown[];
}

export interface Table {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly rows: readonly TableRow[];
}

/** Marks an interpolated value in the joined text: no script text holds U+E000. */
const HOLE = '';
const HOLE_CELL = new RegExp(`^${HOLE}(\\d+)${HOLE}$`);

/**
 * Reads a table from a template's strings and values. Throws a `BenchError` whose `line` is the
 * offset of the line at fault from the template's first line.
 */
export function parseTable(strings: readonly string[], values: readonly unknown[]): Table {
  const text = strings.reduce(
    (all, part, i) => all + part + (i < values.length ? `${HOLE}${i}${HOLE}` : ''),
    '',
  );
  let header: { inputs: string[]; outputs: string[] } | undefined;
  const rows: TableRow[] = [];
  text.split(/\r?\n/).forEach((raw, offset) => {
    const comment = raw.indexOf('#');
    const line = (comment < 0 ? raw : raw.slice(0, comment)).replaceAll('|', ' | ').trim();
    if (line === '') return;
    const fail = (message: string): never => {
      throw new BenchError(`table: ${message}`, offset);
    };
    const cells = line.split(/\s+/).map((cell) => {
      const hole = HOLE_CELL.exec(cell);
      if (hole) return { value: values[Number(hole[1])] };
      if (cell.includes(HOLE)) fail('put ${…} in a cell of its own, with spaces around it');
      return { text: cell, value: cell as unknown };
    });
    const bar = cells.findIndex((cell) => cell.text === '|');
    if (bar < 0 || cells.findIndex((cell, i) => i > bar && cell.text === '|') >= 0) {
      fail(
        header
          ? 'a row needs one | between inputs and outputs'
          : 'the header needs one | between inputs and outputs, as in `A B | Y`',
      );
    }
    if (!header) {
      const names = cells.map((cell) => {
        if (typeof cell.value !== 'string') fail('the header names signals: text, not a value');
        return cell.value as string;
      });
      header = { inputs: names.slice(0, bar), outputs: names.slice(bar + 1) };
      const repeated = names.find((n, i) => n !== '|' && names.indexOf(n) !== i);
      if (repeated !== undefined) fail(`${repeated} is in the header twice`);
      return;
    }
    const inputs = cells.slice(0, bar).map((cell) => cell.value);
    const outputs = cells.slice(bar + 1).map((cell) => cell.value);
    if (inputs.length !== header.inputs.length || outputs.length !== header.outputs.length) {
      fail(
        `a row has ${header.inputs.length} | ${header.outputs.length} cells, as the header; this one has ${inputs.length} | ${outputs.length}`,
      );
    }
    rows.push({ offset, inputs, outputs });
  });
  if (!header) throw new BenchError('table: no header (inputs | outputs) and no rows', 0);
  return { ...header, rows };
}
