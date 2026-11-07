/**
 * 74xx chips: what a chip does is shared by every logic family (74HC00, 74HCT00, 74LS00 have the
 * same pinout and function table); the timing and the datasheet are the family's. A chip is a
 * `ChipSpec` (function, from the datasheet) combined with a `LogicFamily` entry (timing).
 */
import {
  type AnyComponentDefinition,
  type Behavior,
  defineComponent,
  type FunctionTable,
  type PinDef,
  pinIndex,
  type Time,
  type TimingDef,
  type UnitDef,
} from '../../core';
import { dipPins, type PinRow } from './pinout';

/** A chip's function, independent of the logic family. */
export interface ChipSpec {
  /** The number after the family: `00`, `245`. */
  readonly number: string;
  /** Datasheet title: `Quad 2-input NAND gate`. */
  readonly title: string;
  readonly keywords: readonly string[];
  /** DIP pin count. */
  readonly pinCount: number;
  /** The datasheet's pin description table. */
  readonly pins: readonly PinRow[];
  /** Gate sections, each listing its pins inputs first, in the function table's column order. */
  readonly units?: readonly UnitDef[];
  readonly functionTable: FunctionTable;
}

/** A chip as made in one logic family: the datasheet and its timing. */
export interface ChipTiming {
  readonly datasheet: string;
  readonly timing: TimingDef;
}

/** A logic family (`HC`): the timing of each chip it has, by chip number. */
export interface LogicFamily {
  readonly name: string;
  readonly chips: Readonly<Record<string, ChipTiming>>;
}

/**
 * Makes a behavior for one instance. Called once per chip definition with the pin list, the
 * typical delays and the minima of its timing requirements (for `TimingChecks`), so it can
 * precompute pin indices; the returned function runs per instance. `State` is the instance's
 * mutable state (a latch's stored bits); stateless chips use `undefined`.
 */
export type ChipBehavior<State = undefined> = (
  pins: readonly PinDef[],
  delays: Readonly<Record<string, Time>>,
  min: Readonly<Record<string, Time>>,
) => () => Behavior<State>;

/** The definition of `spec` in `family`: type `74xx/74hc00`, name `74HC00`, a DIP package. */
export function chipDefinition<State = undefined>(
  spec: ChipSpec,
  family: LogicFamily,
  behavior: ChipBehavior<State>,
): AnyComponentDefinition {
  const made = family.chips[spec.number];
  if (!made) throw new Error(`74${family.name}${spec.number}: no timing in the family`);
  const name = `74${family.name}${spec.number}`;
  const pinList = dipPins(spec.pinCount, spec.pins);
  const create = behavior(pinList, made.timing.typical, made.timing.min ?? {});
  return defineComponent<Record<string, never>, State>({
    type: `74xx/${name.toLowerCase()}`,
    name,
    title: spec.title,
    keywords: spec.keywords,
    datasheet: made.datasheet,
    pins: pinList,
    package: { kind: 'dip', pins: spec.pinCount },
    ...(spec.units ? { units: spec.units } : {}),
    timing: made.timing,
    functionTable: spec.functionTable,
    create,
  });
}

/** The `PinRef`s of comma-separated pin names, in order: `pinIndices(pins, 'A0, A1, A2')`. */
export function pinIndices(pinList: readonly PinDef[], names: string): Int32Array {
  return Int32Array.from(pinNames(names), (name) => pinIndex(pinList, name));
}

/** Comma-separated pin names as a list. */
export function pinNames(names: string): string[] {
  return names.split(',').map((s) => s.trim());
}

/** A delay the behavior needs; throws at definition time if the family's timing lacks it. */
export function delay(delays: Readonly<Record<string, Time>>, symbol: string): Time {
  const value = delays[symbol];
  if (value === undefined || value <= 0) throw new Error(`missing delay "${symbol}"`);
  return value;
}
