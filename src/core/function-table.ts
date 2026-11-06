/**
 * Datasheet function tables as data: shown to the user (Part Info) and checked against the
 * behavior by the part's tests (`functionTable` in `core/testing`). Spec: docs/components.md.
 */

/**
 * A datasheet function table, transcribed with the datasheet's own column names and letters.
 *
 * - Columns use the datasheet's generic names (`nA`, `nB`, `nY`): one table describes every unit
 *   of a multi-gate chip; tests map the columns to each unit's pins.
 * - A row is its cells separated by whitespace, inputs `|` outputs: `'L X | H'`.
 * - Letters: `H` (high), `L` (low), `X` (**don't care**, inputs only), `Z` (high impedance,
 *   outputs only). Any other cell is datasheet text kept for display (`A=B`, `input`); rows with
 *   text cells can't be checked automatically, so the part's test covers them by hand.
 */
export interface FunctionTable {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly rows: readonly string[];
  /** What one row describes, e.g. `each gate (n = 1 to 4)`. */
  readonly note?: string;
}

/** One parsed row of a function table. */
export interface FunctionTableRow {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}

/** Splits a row into its input and output cells; throws if the cell counts don't match. */
export function parseFunctionTableRow(table: FunctionTable, row: string): FunctionTableRow {
  const [inText, outText, extra] = row.split('|');
  const inputs = cells(inText);
  const outputs = cells(outText);
  if (
    extra !== undefined ||
    inputs.length !== table.inputs.length ||
    outputs.length !== table.outputs.length
  ) {
    throw new Error(
      `function table row "${row}": expected ${table.inputs.length} inputs | ${table.outputs.length} outputs`,
    );
  }
  return { inputs, outputs };
}

/**
 * Throws unless the table has input and output columns with unique, non-empty names and at least
 * one row, and every row has the right number of cells. `where` prefixes the message.
 */
export function validateFunctionTable(table: FunctionTable, where: string): void {
  if (table.inputs.length === 0 || table.outputs.length === 0) {
    throw new Error(`${where}: function table needs input and output columns`);
  }
  const seen = new Set<string>();
  for (const column of [...table.inputs, ...table.outputs]) {
    if (!/^\S+$/.test(column)) throw new Error(`${where}: bad function table column "${column}"`);
    if (seen.has(column)) throw new Error(`${where}: duplicate function table column "${column}"`);
    seen.add(column);
  }
  if (table.rows.length === 0) throw new Error(`${where}: function table has no rows`);
  for (const row of table.rows) {
    try {
      parseFunctionTableRow(table, row);
    } catch (error) {
      throw new Error(`${where}: ${(error as Error).message}`);
    }
  }
}

function cells(text: string | undefined): string[] {
  return (text ?? '').trim().split(/\s+/).filter(Boolean);
}
