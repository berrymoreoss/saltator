import { levelChar } from '../logic';
import { type Bench, type BenchValue, type BenchValues, toLevel } from './bench';

/**
 * A datasheet function table, transcribed with the datasheet's own letters:
 *
 * - inputs: `H` (high), `L` (low), `X` (**don't care** — expanded to both `L` and `H`);
 * - outputs: `H`, `L`, `Z` (high impedance).
 *
 * Datasheet `X` is *don't care*, not the simulator's unknown `X`; it is rejected in outputs
 * because it is ambiguous there. Use `truthTable` to test unknown/floating inputs.
 *
 * ```ts
 * functionTable(bench, {
 *   inputs: ['A', 'B'],
 *   outputs: ['Y'],
 *   rows: ['L X | H', 'X L | H', 'H H | L'],
 * });
 * ```
 */
export interface FunctionTable {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  /** One row per string: input letters, `|`, output letters (whitespace-separated). */
  readonly rows: readonly string[];
}

const INPUT_LETTERS: Readonly<Record<string, readonly BenchValue[]>> = {
  H: [1],
  L: [0],
  X: [0, 1],
};
const OUTPUT_LETTERS: Readonly<Record<string, BenchValue>> = { H: 1, L: 0, Z: 'Z' };

/**
 * Checks every row (with don't-cares expanded) on the bench: set inputs, settle, compare outputs.
 * Throws one error listing every failing row. Returns the number of input combinations checked.
 */
export function functionTable(bench: Bench, table: FunctionTable): number {
  const cases: { label: string; inputs: BenchValues; outputs: BenchValues }[] = [];
  for (const row of table.rows) {
    const [inText, outText, extra] = row.split('|');
    const ins = words(inText);
    const outs = words(outText);
    if (
      extra !== undefined ||
      ins.length !== table.inputs.length ||
      outs.length !== table.outputs.length
    ) {
      throw new Error(
        `function table row "${row}": expected ${table.inputs.length} inputs | ${table.outputs.length} outputs`,
      );
    }
    const outputs: Record<string, BenchValue> = {};
    outs.forEach((letter, i) => {
      const value = OUTPUT_LETTERS[letter];
      if (value === undefined) {
        const hint =
          letter === 'X' ? ' (datasheet X means "don\'t care"; not allowed in outputs)' : '';
        throw new Error(`function table row "${row}": bad output letter "${letter}"${hint}`);
      }
      outputs[table.outputs[i]!] = value;
    });
    const choices = ins.map((letter) => {
      const values = INPUT_LETTERS[letter];
      if (values === undefined)
        throw new Error(`function table row "${row}": bad input letter "${letter}"`);
      return values;
    });
    for (const combo of product(choices)) {
      const inputs = Object.fromEntries(table.inputs.map((name, i) => [name, combo[i]!]));
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

function words(text: string | undefined): string[] {
  return (text ?? '').trim().split(/\s+/).filter(Boolean);
}

function product<T>(choices: readonly (readonly T[])[]): T[][] {
  return choices.reduce<T[][]>(
    (acc, options) => acc.flatMap((prefix) => options.map((o) => [...prefix, o])),
    [[]],
  );
}
