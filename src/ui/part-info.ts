/**
 * What the Part tab of the bottom dock shows about a part type: its pins with their datasheet
 * descriptions and its function table. Pure, so it is unit-tested without React.
 */
import {
  type AnyComponentDefinition,
  type FunctionTable,
  type FunctionTableRow,
  formatTime,
  type PinDef,
  type PinDir,
  type PropValue,
  parseFunctionTableRow,
  pinsOf,
  resolveProps,
} from '../core';

/** The part the Part tab shows: the last one picked on the canvas (`id`) or in the Parts panel. */
export interface PartPick {
  readonly type: string;
  readonly id?: string;
}

export const PIN_TYPE_LABEL: Readonly<Record<PinDir, string>> = {
  in: 'input',
  out: 'output',
  tristate: '3-state output',
  bidir: 'input/output',
  power: 'power',
  nc: 'not connected',
};

export interface PinInfo {
  readonly number?: number;
  /** What the drawing shows: the pin's label, else its name (`NC` for n.c. pins). */
  readonly name: string;
  /** The pin's name when it is drawn with a different label (151's `YN`, drawn `Y`). */
  readonly id?: string;
  readonly activeLow: boolean;
  readonly type: string;
  readonly description?: string;
}

/**
 * One row per pin, in pin-number order for packages (as a datasheet lists them), in definition
 * order otherwise. `props` are an instance's (raw) props; invalid ones fall back to the defaults.
 */
export function pinInfo(
  definition: AnyComponentDefinition,
  props: Readonly<Record<string, PropValue>> = {},
): PinInfo[] {
  let resolved: Record<string, PropValue>;
  try {
    resolved = resolveProps(definition, props);
  } catch {
    resolved = resolveProps(definition);
  }
  const rows = pinsOf(definition, resolved).map(
    (pin): PinInfo => ({
      ...(pin.number !== undefined && { number: pin.number }),
      // n.c. pins (`NC3`) show as NC; other `nc` pins are drawn but not simulated (a 555's
      // timing pins in astable mode).
      name: /^NC\d+$/.test(pin.name) ? 'NC' : (pin.label ?? pin.name),
      ...(pin.label !== undefined && { id: pin.name }),
      activeLow: pin.activeLow === true,
      type:
        pin.dir === 'nc' && !/^NC\d+$/.test(pin.name) ? 'not simulated' : PIN_TYPE_LABEL[pin.dir],
      ...(pin.description !== undefined && { description: pin.description }),
    }),
  );
  return rows.every((row) => row.number !== undefined)
    ? rows.sort((a, b) => a.number! - b.number!)
    : rows;
}

export interface FunctionTableInfo {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly rows: readonly FunctionTableRow[];
  readonly note?: string;
}

/** The definition's function table split into cells (datasheet text like `A=B`, `A3>B3` spaced out). */
export function functionTableInfo(table: FunctionTable | undefined): FunctionTableInfo | undefined {
  if (!table) return undefined;
  const spaced = (cell: string) => cell.replace(/([=<>])/g, ' $1 ');
  return {
    inputs: table.inputs,
    outputs: table.outputs,
    rows: table.rows.map((row) => {
      const { inputs, outputs } = parseFunctionTableRow(table, row);
      return { inputs: inputs.map(spaced), outputs: outputs.map(spaced) };
    }),
    ...(table.note !== undefined && { note: table.note }),
  };
}

/**
 * Function table columns naming pins that match `test`: a column is a pin's name (`Y7`, `EI`) or
 * the datasheet's generic name of a pin, its numbers replaced by `n` (`1OE` → `nOE`, `1A0` →
 * `nAn`).
 */
function columnsWhere(
  definition: AnyComponentDefinition,
  test: (pin: PinDef) => boolean,
): Set<string> {
  const named = pinsOf(definition, resolveProps(definition))
    .filter(test)
    .flatMap((pin) => [pin.name, pin.name.replace(/\d+/g, 'n')]);
  const table = definition.functionTable;
  const columns = table ? [...table.inputs, ...table.outputs] : [];
  return new Set(columns.filter((column) => named.includes(column)));
}

/** Function table columns of pins drawn with a label, and that label (151: `YN` → `Y`). */
export function columnLabels(definition: AnyComponentDefinition): Map<string, string> {
  const labels = new Map<string, string>();
  for (const pin of pinsOf(definition, resolveProps(definition))) {
    if (pin.label === undefined) continue;
    const column = pin.name.replace(/\d+/g, 'n');
    if (
      definition.functionTable &&
      [...definition.functionTable.inputs, ...definition.functionTable.outputs].includes(column)
    ) {
      labels.set(column, pin.label.replace(/\d+/g, 'n'));
    }
  }
  return labels;
}

/** Function table columns of active-low pins, drawn overlined. */
export function activeLowColumns(definition: AnyComponentDefinition): Set<string> {
  return columnsWhere(definition, (pin) => pin.activeLow === true);
}

/** The heading over a function table's output columns: `Inputs/outputs` for bus ports (245). */
export function outputsHeading(definition: AnyComponentDefinition): string {
  return columnsWhere(definition, (pin) => pin.dir === 'bidir').size > 0
    ? 'Inputs/outputs'
    : 'Outputs';
}

/** A pin name as drawn: its label (`1QN` → `1Q`), overlined when the pin is active LOW. */
export interface NameView {
  readonly text: string;
  readonly overline: boolean;
}

/** One timing parameter: `tpd` from `nCP` to `nQ, nQ̅`, typical 17 ns, max 44 ns. */
export interface TimingRow {
  /** `tpd`, `tsu`, `tW`: the letter t and its subscript. */
  readonly symbol: string;
  /** The path or pins in the key's parentheses, as drawn: `nCP`, `to`, `nQ`, `nQ̅`. */
  readonly path: readonly (NameView | string)[];
  readonly typical: string;
  /** Delays: the maximum; requirements: the guaranteed minimum the timing checks use. */
  readonly max?: string;
  readonly min?: string;
}

/** A part's timing for the Part tab: delays, then the requirements its timing checks hold. */
export interface TimingInfo {
  readonly delays: readonly TimingRow[];
  readonly requirements: readonly TimingRow[];
  readonly conditions?: string;
  readonly source?: string;
}

/**
 * The definition's `timing` split into delays (`max` given) and requirements (`min` given);
 * undefined without timing. Pin names in a key (`tpd(nCP to nQ, nQN)`) are shown as drawn, the
 * datasheet's generic names (`nQN`) included.
 */
export function timingInfo(definition: AnyComponentDefinition): TimingInfo | undefined {
  const timing = definition.timing;
  if (!timing) return undefined;
  const view = new Map<string, NameView>();
  for (const pin of pinsOf(definition, resolveProps(definition))) {
    const shown = { text: pin.label ?? pin.name, overline: pin.activeLow === true };
    view.set(pin.name, shown);
    view.set(pin.name.replace(/\d+/g, 'n'), {
      ...shown,
      text: shown.text.replace(/\d+/g, 'n'),
    });
  }
  const row = (key: string, limit: 'max' | 'min'): TimingRow => {
    const match = /^(\w+)(?:\((.*)\))?$/.exec(key);
    const symbol = match?.[1] ?? key;
    const path = (match?.[2] ?? '')
      .split(/(,\s*| to )/)
      .filter((part) => part !== '')
      .map((part) => view.get(part) ?? part);
    const value = timing[limit]?.[key];
    return {
      symbol,
      path,
      typical: formatTime(timing.typical[key] ?? 0),
      ...(value !== undefined && { [limit]: formatTime(value) }),
    };
  };
  return {
    delays: Object.keys(timing.max ?? timing.typical)
      .filter((key) => timing.min?.[key] === undefined)
      .map((key) => row(key, 'max')),
    requirements: Object.keys(timing.min ?? {}).map((key) => row(key, 'min')),
    ...(timing.conditions !== undefined && { conditions: timing.conditions }),
    ...(timing.source !== undefined && { source: timing.source }),
  };
}

/** A short name for a datasheet link: the document's file name (`74HC_HCT00`), else the host. */
export function datasheetName(url: string): string {
  try {
    const { pathname, hostname } = new URL(url);
    const file = pathname.split('/').filter(Boolean).at(-1);
    return file ? decodeURIComponent(file).replace(/\.pdf$/i, '') : hostname;
  } catch {
    return url;
  }
}
