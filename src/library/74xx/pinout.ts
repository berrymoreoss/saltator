/**
 * Package pinouts written like a datasheet's pin description table, one row per line of it:
 * `pins('1A, 2A, 3A, 4A', '1, 4, 9, 12', 'in', 'data input')`.
 */
import type { PinDef, PinDir } from '../../core';

/** One row of a datasheet pin description table: symbols, their pin numbers, description. */
export interface PinRow {
  readonly names: readonly string[];
  readonly numbers: readonly number[];
  readonly dir: PinDir;
  readonly description: string;
  readonly activeLow?: boolean;
  /** Drawn instead of the name (one-pin rows only): see `PinDef.label`. */
  readonly label?: string;
}

/**
 * A pin description row: comma-separated symbols and pin numbers in the same order. The symbol
 * `n.c.` (not connected) names each pin `NC<number>`, since pin names must be unique.
 */
export function pins(
  names: string,
  numbers: string,
  dir: PinDir,
  description: string,
  flags: { readonly activeLow?: boolean; readonly label?: string } = {},
): PinRow {
  const list = (text: string) => text.split(',').map((s) => s.trim());
  const nums = list(numbers).map(Number);
  const symbols = names === 'n.c.' ? nums.map((n) => `NC${n}`) : list(names);
  if (symbols.length !== nums.length || nums.some((n) => !Number.isInteger(n))) {
    throw new Error(`pin row "${names}": ${symbols.length} names for pins "${numbers}"`);
  }
  if (flags.label !== undefined && symbols.length !== 1) {
    throw new Error(`pin row "${names}": a label needs a row of one pin`);
  }
  return { names: symbols, numbers: nums, dir, description, ...flags };
}

/**
 * The pin list of a DIP package, in pin-number order (so a pin's `PinRef` is its number − 1).
 * Throws unless every pin 1…count appears exactly once.
 */
export function dipPins(count: number, rows: readonly PinRow[]): PinDef[] {
  const byNumber: (PinDef | undefined)[] = new Array(count).fill(undefined);
  for (const row of rows) {
    row.names.forEach((name, i) => {
      const number = row.numbers[i]!;
      if (number < 1 || number > count)
        throw new Error(`pin ${name}: number ${number} not in 1…${count}`);
      if (byNumber[number - 1]) throw new Error(`pin ${number} listed twice (${name})`);
      byNumber[number - 1] = {
        name,
        number,
        dir: row.dir,
        description: row.description,
        ...(row.activeLow ? { activeLow: true } : {}),
        ...(row.label !== undefined ? { label: row.label } : {}),
      };
    });
  }
  const missing = byNumber.indexOf(undefined);
  if (missing >= 0) throw new Error(`pin ${missing + 1} of ${count} not listed`);
  return byNumber as PinDef[];
}
