import { type FunctionTable, parseFunctionTableRow } from '../function-table';
import { levelChar } from '../logic';
import { type Bench, type BenchValue, type BenchValues, toLevel } from './bench';

const INPUT_LETTERS: Readonly<Record<string, readonly BenchValue[]>> = {
  H: [1],
  L: [0],
  X: [0, 1],
};
const OUTPUT_LETTERS: Readonly<Record<string, BenchValue>> = { H: 1, L: 0, Z: 'Z' };

/**
 * Checks a datasheet function table (`FunctionTable`, letters `H`, `L`, `X` = don't care, `Z`) on
 * the bench: every row with don't-cares expanded — set inputs, settle, compare outputs. Throws
 * one error listing every failing row. Returns the number of input combinations checked.
 *
 * Datasheet `X` is *don't care*, not the simulator's unknown `X`; it is rejected in outputs
 * because it is ambiguous there. Use `truthTable` to test unknown/floating inputs.
 *
 * `pins` maps the table's columns (inputs, then outputs) to the bench's pins, so one generic
 * table (`nA nB | nY`) checks every unit of a chip:
 *
 * ```ts
 * for (const unit of hc00.units!) functionTable(bench, hc00.functionTable!, unit.pins);
 * ```
 *
 * An output column mapped to `null` is display-only (the 4511's `Display` column: `8`,
 * `blank`): its cells are not checked.
 */
export function functionTable(
  bench: Bench,
  table: FunctionTable,
  pins: readonly (string | null)[] = [...table.inputs, ...table.outputs],
): number {
  const columns = table.inputs.length + table.outputs.length;
  if (pins.length !== columns) {
    throw new Error(
      `function table: ${pins.length} pins [${pins.join(', ')}] for ${columns} columns`,
    );
  }
  const inPins = pins.slice(0, table.inputs.length);
  const outPins = pins.slice(table.inputs.length);
  if (inPins.includes(null)) throw new Error('function table: every input column needs a pin');
  const cases: { label: string; inputs: BenchValues; outputs: BenchValues }[] = [];
  for (const row of table.rows) {
    const { inputs: ins, outputs: outs } = parseFunctionTableRow(table, row);
    const outputs: Record<string, BenchValue> = {};
    outs.forEach((letter, i) => {
      if (outPins[i] === null) return; // display only
      const value = OUTPUT_LETTERS[letter];
      if (value === undefined) {
        const hint =
          letter === 'X' ? ' (datasheet X means "don\'t care"; not allowed in outputs)' : '';
        throw new Error(`function table row "${row}": bad output letter "${letter}"${hint}`);
      }
      outputs[outPins[i]!] = value;
    });
    const choices = ins.map((letter) => {
      const values = INPUT_LETTERS[letter];
      if (values === undefined)
        throw new Error(`function table row "${row}": bad input letter "${letter}"`);
      return values;
    });
    for (const combo of product(choices)) {
      const inputs = Object.fromEntries(inPins.map((name, i) => [name!, combo[i]!]));
      cases.push({ label: row, inputs, outputs });
    }
  }
  return check(bench, cases);
}

/**
 * Checks rows of simulator values (`0`, `1`, `'X'`, `'Z'`) without any expansion — for unknown
 * and floating inputs, which datasheet tables don't cover. `X` here means unknown.
 */
export function truthTable(
  bench: Bench,
  inputs: readonly string[],
  outputs: readonly string[],
  rows: readonly (readonly BenchValue[])[],
): number {
  const cases = rows.map((row) => {
    if (row.length !== inputs.length + outputs.length) {
      throw new Error(
        `truth table row [${row.join(', ')}]: expected ${inputs.length + outputs.length} values`,
      );
    }
    return {
      label: row.map((v) => levelChar(toLevel(v))).join(' '),
      inputs: Object.fromEntries(inputs.map((name, i) => [name, row[i]!])),
      outputs: Object.fromEntries(outputs.map((name, i) => [name, row[inputs.length + i]!])),
    };
  });
  return check(bench, cases);
}

function check(
  bench: Bench,
  cases: readonly { label: string; inputs: BenchValues; outputs: BenchValues }[],
): number {
  const failures: string[] = [];
  for (const c of cases) {
    bench.set(c.inputs);
    bench.settle();
    const wrong = bench.mismatches(c.outputs);
    if (wrong.length > 0) {
      const applied = Object.entries(c.inputs)
        .map(([n, v]) => `${n}=${levelChar(toLevel(v))}`)
        .join(' ');
      failures.push(`row "${c.label}" with ${applied}: ${wrong.join(', ')}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${cases.length} rows failed:\n  ${failures.join('\n  ')}`,
    );
  }
  return cases.length;
}

function product<T>(choices: readonly (readonly T[])[]): T[][] {
  return choices.reduce<T[][]>(
    (acc, options) => acc.flatMap((prefix) => options.map((o) => [...prefix, o])),
    [[]],
  );
}
