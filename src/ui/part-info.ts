/**
 * What the Part tab of the bottom dock shows about a part type: its pins with their datasheet
 * descriptions and its function table. Pure, so it is unit-tested without React.
 */
import { subcircuitOf } from '../circuit';
import {
  type AnyComponentDefinition,
  type ComponentRegistry,
  type FunctionTable,
  type FunctionTableRow,
  formatTime,
  hdlPartType,
  type PinDef,
  type PinDir,
  type PropValue,
  parseFunctionTableRow,
  pinsOf,
  pinTextRuns,
  resolveProps,
  runsText,
  type TextRun,
  timingOf,
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
  /** `name` with its overlines, as drawn (`1R̅D̅`, `U̅/D`). */
  readonly runs: readonly TextRun[];
  /** The pin's name when it is drawn with a different label (151's `YN`, drawn `Y`). */
  readonly id?: string;
  readonly activeLow: boolean;
  readonly type: string;
  readonly description?: string;
}

/** An instance's resolved props; the defaults when it has none or they are invalid. */
function resolvedOrDefault(
  definition: AnyComponentDefinition,
  props: Readonly<Record<string, unknown>> = {},
): Record<string, PropValue> {
  try {
    return resolveProps(definition, props);
  } catch {
    return resolveProps(definition);
  }
}

/**
 * One row per pin, in pin-number order for packages (as a datasheet lists them), in definition
 * order otherwise. `props` are an instance's (raw) props; invalid ones fall back to the defaults.
 */
export function pinInfo(
  definition: AnyComponentDefinition,
  props: Readonly<Record<string, PropValue>> = {},
): PinInfo[] {
  const resolved = resolvedOrDefault(definition, props);
  const rows = pinsOf(definition, resolved).map((pin): PinInfo => {
    // n.c. pins (`NC3`) show as NC; other `nc` pins are drawn but not simulated (a 555's timing
    // pins in astable mode).
    const runs = /^NC\d+$/.test(pin.name) ? [{ text: 'NC', overline: false }] : pinTextRuns(pin);
    return {
      ...(pin.number !== undefined && { number: pin.number }),
      name: runsText(runs),
      runs,
      ...(pin.label !== undefined && { id: pin.name }),
      activeLow: pin.activeLow === true,
      type:
        pin.dir === 'nc' && !/^NC\d+$/.test(pin.name) ? 'not simulated' : PIN_TYPE_LABEL[pin.dir],
      ...(pin.description !== undefined && { description: pin.description }),
    };
  });
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
 * Runs with their numbers as the datasheet's generic `n`: every number (`1A0` → `nAn`), or only
 * the leading unit number (`1Y0` → `nY0`, the 139's columns).
 */
function generic(runs: readonly TextRun[], unitOnly: boolean): TextRun[] {
  return runs.map((run, i) => ({
    ...run,
    text: unitOnly
      ? i === 0
        ? run.text.replace(/^\d+/, 'n')
        : run.text
      : run.text.replace(/\d+/g, 'n'),
  }));
}

/**
 * Function table columns that name a pin, as that pin is drawn: a column is a pin's name (`Y7`,
 * `EI`) or the datasheet's generic name of a pin, its numbers replaced by `n` (`1OE` → `nO̅E̅`,
 * `1A0` → `nAn`) or only its unit number (`1Y0` → `nY̅0`); the 151's `YN` is drawn `Y̅`, the
 * 191's `UD` `U̅/D`.
 */
export function columnRuns(definition: AnyComponentDefinition): Map<string, readonly TextRun[]> {
  return columnsOf(definition, () => true);
}

function columnsOf(
  definition: AnyComponentDefinition,
  test: (pin: PinDef) => boolean,
): Map<string, readonly TextRun[]> {
  const table = definition.functionTable;
  const columns = new Set(table ? [...table.inputs, ...table.outputs] : []);
  const shown = new Map<string, readonly TextRun[]>();
  const add = (column: string, runs: () => readonly TextRun[]) => {
    if (columns.has(column) && !shown.has(column)) shown.set(column, runs());
  };
  for (const pin of pinsOf(definition, resolveProps(definition)).filter(test)) {
    const runs = pinTextRuns(pin);
    add(pin.name, () => runs);
    add(pin.name.replace(/\d+/g, 'n'), () => generic(runs, false));
    add(pin.name.replace(/^\d+/, 'n'), () => generic(runs, true));
  }
  return shown;
}

/** The heading over a function table's output columns: `Inputs/outputs` for bus ports (245). */
export function outputsHeading(definition: AnyComponentDefinition): string {
  return columnsOf(definition, (pin) => pin.dir === 'bidir').size > 0
    ? 'Inputs/outputs'
    : 'Outputs';
}

/** A pin name as drawn: its label (`1QN` → `1Q̅`), with its overlines (`pinTextRuns`). */
export interface NameView {
  readonly runs: readonly TextRun[];
}

/** One timing parameter: `tpd` from `nCP` to `nQ, nQ̅`, typical 17 ns, max 44 ns. */
/**
 * A timing symbol as data sheets set it: `t` (or the HD44780's `PW`) and a subscript — `tpd`,
 * `tsu`, `PWEH` — or a key that names what it times (`Clear display`), shown as it is.
 */
export function symbolParts(symbol: string): { readonly base: string; readonly sub: string } {
  const match = /^(t|PW)(\w+)$/.exec(symbol);
  return match ? { base: match[1]!, sub: match[2]! } : { base: symbol, sub: '' };
}

export interface TimingRow {
  /** `tpd`, `tsu`, `tW`: the letter t and its subscript. */
  readonly symbol: string;
  /** The path or pins in the key's parentheses, as drawn: `nCP`, `to`, `nQ`, `nQ̅`. */
  readonly path: readonly (NameView | string)[];
  /** Absent for parts whose data sheets give limits only (memories). */
  readonly typical?: string;
  /** Delays: the maximum; requirements: the guaranteed minimum the timing checks use. */
  readonly max?: string;
  /** Requirements, and the minima of a limits-only part's outputs (`tOH`, `tOE` 10/70 ns). */
  readonly min?: string;
}

/** A part's timing for the Part tab: delays, then the requirements its timing checks hold. */
export interface TimingInfo {
  readonly delays: readonly TimingRow[];
  readonly requirements: readonly TimingRow[];
  /** The data sheet gives limits only (no typical values): the simulation uses them. */
  readonly limitsOnly: boolean;
  readonly conditions?: string;
  readonly source?: string;
}

/**
 * The timing of an instance with `props` (the defaults without), split into delays (a maximum,
 * or no minimum) and requirements (a minimum only); undefined without timing. Pin names in a
 * key (`tpd(nCP to nQ, nQN)`) are shown as drawn, the datasheet's generic names (`nQN`)
 * included.
 */
/**
 * The definition whose timing the Part tab shows: the part's own, or for an instance of a
 * document's Verilog module (`sub/<id>`, which has none) the module's part's — its `specify`
 * block (HDL-2).
 */
export function timingSource(
  registry: ComponentRegistry,
  definition: AnyComponentDefinition,
): AnyComponentDefinition {
  if (definition.timing) return definition;
  const id = subcircuitOf(definition.type);
  const part = id === undefined ? undefined : registry.get(hdlPartType(id));
  return part?.timing ? part : definition;
}

export function timingInfo(
  definition: AnyComponentDefinition,
  props?: Readonly<Record<string, unknown>>,
): TimingInfo | undefined {
  const resolved = resolvedOrDefault(definition, props);
  const timing = timingOf(definition, resolved);
  if (!timing) return undefined;
  const view = new Map<string, NameView>();
  for (const pin of pinsOf(definition, resolved)) {
    const runs = pinTextRuns(pin);
    view.set(pin.name, { runs });
    view.set(pin.name.replace(/\d+/g, 'n'), { runs: generic(runs, false) });
  }
  const row = (key: string): TimingRow => {
    const match = /^(\w+)(?:\((.*)\))?$/.exec(key);
    const symbol = match?.[1] ?? key;
    const path = (match?.[2] ?? '')
      .split(/(,\s*| to )/)
      .filter((part) => part !== '')
      .map((part) => view.get(part) ?? part);
    const typical = timing.typical[key];
    const max = timing.max?.[key];
    const min = timing.min?.[key];
    return {
      symbol,
      path,
      ...(typical !== undefined && { typical: formatTime(typical) }),
      ...(max !== undefined && { max: formatTime(max) }),
      ...(min !== undefined && { min: formatTime(min) }),
    };
  };
  // Every key once, in the order the timing lists them: a key with a maximum, or without a
  // minimum, is a delay; one with a minimum only is a requirement (or an output's minimum).
  const keys = [
    ...new Set([
      ...Object.keys(timing.typical),
      ...Object.keys(timing.max ?? {}),
      ...Object.keys(timing.min ?? {}),
    ]),
  ];
  const isDelay = (key: string) =>
    timing.max?.[key] !== undefined || timing.min?.[key] === undefined;
  return {
    delays: keys.filter(isDelay).map(row),
    requirements: keys.filter((key) => !isDelay(key)).map(row),
    limitsOnly: Object.keys(timing.typical).length === 0,
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
