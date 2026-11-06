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
 * Makes a behavior for one instance. Called once per chip definition with the pin list and the
 * typical delays, so it can precompute pin indices; the returned function runs per instance.
 */
export type ChipBehavior = (
  pins: readonly PinDef[],
  delays: Readonly<Record<string, Time>>,
) => () => Behavior<undefined>;

/** The definition of `spec` in `family`: type `74xx/74hc00`, name `74HC00`, a DIP package. */
export function chipDefinition(
  spec: ChipSpec,
  family: LogicFamily,
  behavior: ChipBehavior,
): AnyComponentDefinition {
  const made = family.chips[spec.number];
  if (!made) throw new Error(`74${family.name}${spec.number}: no timing in the family`);
  const name = `74${family.name}${spec.number}`;
  const pinList = dipPins(spec.pinCount, spec.pins);
  const create = behavior(pinList, made.timing.typical);
  return defineComponent<Record<string, never>, undefined>({
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

/** A delay the behavior needs; throws at definition time if the family's timing lacks it. */
export function delay(delays: Readonly<Record<string, Time>>, symbol: string): Time {
  const value = delays[symbol];
  if (value === undefined || value <= 0) throw new Error(`missing delay "${symbol}"`);
  return value;
}
