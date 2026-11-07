import { type FunctionTable, parseFunctionTableRow, stateReference } from '../function-table';
import { type Level, levelChar, not } from '../logic';
import { type Time, us } from '../time';
import { type Bench, type BenchValue, type BenchValues, toLevel } from './bench';

const INPUT_LETTERS: Readonly<Record<string, readonly BenchValue[]>> = {
  H: [1],
  L: [0],
  X: [0, 1],
  h: [1],
  l: [0],
};
/** Transitions: the level before, then after. */
const EDGE_LETTERS: Readonly<Record<string, readonly [BenchValue, BenchValue]>> = {
  '↑': [0, 1],
  '↓': [1, 0],
};
const OUTPUT_LETTERS: Readonly<Record<string, BenchValue>> = { H: 1, L: 0, Z: 'Z' };

/** How `functionTable` runs a sequential part's table. */
export interface FunctionTableOptions {
  /**
   * Ways to load the part before a row with previous-state outputs (`q`): each is a list of
   * steps, applied one after the other. Every such row is checked after each of them; together
   * they must give the referenced outputs both 0 and 1.
   */
  readonly states?: readonly (readonly BenchValues[])[];
  /**
   * Time to run after each step, so set-up and pulse-width minima are met. Default: 1 µs for
   * tables with transitions or previous-state outputs, else 0 (settle only).
   */
  readonly gap?: Time;
}

/** An expected output: a level, or the previous level of an output pin (complemented). */
type Expected =
  | { readonly value: BenchValue }
  | { readonly pin: string; readonly inverted: boolean };

interface Case {
  readonly label: string;
  readonly prepare: readonly BenchValues[];
  /** Applied first; then the clock inputs' levels; then the transitions, if any. */
  readonly inputs: BenchValues;
  readonly clocks: BenchValues | null;
  readonly edges: BenchValues | null;
  readonly outputs: Readonly<Record<string, Expected>>;
}

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
 *
 * Sequential tables: a row applies its data inputs, runs `options.gap`, then sets its clock inputs
 * (pins marked `clock`; a don't-care clock may make an edge, with the data already stable), and
 * for `↑`/`↓` the level before the transition, runs `options.gap` again, then makes the
 * transition; `h`/`l` are applied like `H`/`L`.
 * A row with previous-state outputs (`q`, `q̅`) is checked once after each of `options.states`.
 */
export function functionTable(
  bench: Bench,
  table: FunctionTable,
  pins: readonly (string | null)[] = [...table.inputs, ...table.outputs],
  options: FunctionTableOptions = {},
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
  // Transitions, levels before them or previous-state outputs anywhere make the whole table
  // sequential: every row then waits `gap` per step and sets its clocks after its data.
  const sequential = table.rows.some((row) => {
    const { inputs: ins, outputs: outs } = parseFunctionTableRow(table, row);
    return (
      ins.some((cell) => cell in EDGE_LETTERS || cell === 'h' || cell === 'l') ||
      outs.some((cell) => stateReference(table, cell) !== undefined)
    );
  });
  const clockPins = new Set(bench.pins.filter((p) => p.clock).map((p) => p.name));
  const referenced = new Set<string>();
  const cases: Case[] = [];
  for (const row of table.rows) {
    const { inputs: ins, outputs: outs } = parseFunctionTableRow(table, row);
    const outputs: Record<string, Expected> = {};
    let usesState = false;
    outs.forEach((letter, i) => {
      if (outPins[i] === null) return; // display only
      const ref = stateReference(table, letter);
      if (ref) {
        const pin = outPins[table.outputs.indexOf(ref.column)];
        if (!pin)
          throw new Error(`function table row "${row}": state column ${ref.column} has no pin`);
        outputs[outPins[i]!] = { pin, inverted: ref.inverted };
        referenced.add(pin);
        usesState = true;
        return;
      }
      const value = OUTPUT_LETTERS[letter];
      if (value === undefined) {
        const hint =
          letter === 'X' ? ' (datasheet X means "don\'t care"; not allowed in outputs)' : '';
        throw new Error(`function table row "${row}": bad output letter "${letter}"${hint}`);
      }
      outputs[outPins[i]!] = { value };
    });
    const edges: Record<string, BenchValue> = {};
    const choices = ins.map((letter, i) => {
      const edge = EDGE_LETTERS[letter];
      if (edge) {
        edges[inPins[i]!] = edge[1];
        return [edge[0]];
      }
      const values = INPUT_LETTERS[letter];
      if (values === undefined)
        throw new Error(`function table row "${row}": bad input letter "${letter}"`);
      return values;
    });
    const hasEdge = Object.keys(edges).length > 0;
    const prepares = usesState ? (options.states ?? []) : [[]];
    if (usesState && prepares.length === 0) {
      throw new Error(`function table row "${row}" uses the previous state: pass options.states`);
    }
    for (const combo of product(choices)) {
      const inputs: Record<string, BenchValue> = {};
      const clocks: Record<string, BenchValue> = {};
      inPins.forEach((name, i) => {
        (clockPins.has(name!) ? clocks : inputs)[name!] = combo[i]!;
      });
      const hasClocks = sequential && Object.keys(clocks).length > 0;
      prepares.forEach((prepare, s) => {
        const label = usesState ? `${row}" from state #${s + 1} "` : row;
        cases.push({
          label,
          prepare,
          inputs: hasClocks ? inputs : { ...inputs, ...clocks },
          clocks: hasClocks ? clocks : null,
          edges: hasEdge ? edges : null,
          outputs,
        });
      });
    }
  }
  return check(bench, cases, options.gap ?? (sequential ? us(1) : 0), referenced);
}

function check(
  bench: Bench,
  cases: readonly Case[],
  gap: Time,
  referenced: ReadonlySet<string>,
): number {
  const failures: string[] = [];
  const step = (values: BenchValues) => {
    bench.set(values);
    bench.settle();
    if (gap > 0) bench.run(gap);
  };
  const seen = new Map<string, Set<Level>>();
  for (const c of cases) {
    for (const values of c.prepare) step(values);
    const prior = new Map<string, Level>();
    for (const pin of referenced) {
      const level = bench.get(pin);
      prior.set(pin, level);
      if (c.prepare.length > 0) {
        const levels = seen.get(pin) ?? new Set<Level>();
        levels.add(level);
        seen.set(pin, levels);
      }
    }
    step(c.inputs);
    if (c.clocks) step(c.clocks);
    if (c.edges) step(c.edges);
    const expected: Record<string, BenchValue> = {};
    for (const [pin, e] of Object.entries(c.outputs)) {
      if ('value' in e) {
        expected[pin] = e.value;
        continue;
      }
      const was = prior.get(e.pin)!;
      expected[pin] = e.inverted ? not(was) : was;
    }
    const wrong = bench.mismatches(expected);
    if (wrong.length > 0) {
      const applied = Object.entries({ ...c.inputs, ...c.clocks, ...c.edges })
        .map(([n, v]) => `${n}=${levelChar(toLevel(v))}`)
        .join(' ');
      failures.push(`row "${c.label}" with ${applied}: ${wrong.join(', ')}`);
    }
  }
  for (const [pin, levels] of seen) {
    if (!levels.has(0) || !levels.has(1)) {
      throw new Error(`function table: options.states don't load both 0 and 1 into ${pin}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${cases.length} rows failed:\n  ${failures.join('\n  ')}`,
    );
  }
  return cases.length;
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
    const expected = outputs.map((name, i): [string, Expected] => [
      name,
      { value: row[inputs.length + i]! },
    ]);
    return {
      label: row.map((v) => levelChar(toLevel(v))).join(' '),
      prepare: [],
      inputs: Object.fromEntries(inputs.map((name, i) => [name, row[i]!])),
      clocks: null,
      edges: null,
      outputs: Object.fromEntries(expected),
    };
  });
  return check(bench, cases, 0, new Set());
}

function product<T>(choices: readonly (readonly T[])[]): T[][] {
  return choices.reduce<T[][]>(
    (acc, options) => acc.flatMap((prefix) => options.map((o) => [...prefix, o])),
    [[]],
  );
}
