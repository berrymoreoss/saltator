/**
 * The circuit document: what the user draws and what gets saved. Spec: docs/circuit.md.
 * Documents are immutable values; `loadDocument` builds them from JSON and fills defaults, so in
 * memory every optional field except a component's `label` and a wire's `bus` is present.
 */
import type { PropValue } from '../core';
import type { Point, Rotation } from './geometry';

/**
 * Version written into every saved document. Bump it together with a migration.
 * v2 (R10b): bus lines (`Wire.bus`). v3 (R13): probes (`Circuit.probes`). v4 (R11a): several
 * circuits with subcircuit instances; circuit ids are slugs (`CIRCUIT_ID`).
 */
export const SCHEMA_VERSION = 4;

/**
 * Ids of components (their designators: `U1`, `SW1`) and wires: a letter or `_`, then
 * letters, digits, `_` or `-`. No dots, because netlists address pins as `U1.Y`.
 */
export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Ids of circuits: lowercase letters and digits in dash-separated runs (`main`,
 * `decade-counter`), the part half of a type id, since an instance of a circuit is a part of
 * type `sub/<circuit id>`.
 */
export const CIRCUIT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CircuitDocument {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  /**
   * At least one, ids unique. The first is the **top** circuit: the one that simulates and opens
   * at load; the others are subcircuits placed in it (or in each other), in the order listed.
   */
  readonly circuits: readonly Circuit[];
}

export interface Circuit {
  /** A slug (`CIRCUIT_ID`); kept when the circuit is renamed, so its instances keep their type. */
  readonly id: string;
  /** Display text: the Circuits list, the instance symbol's title. */
  readonly name: string;
  readonly components: readonly ComponentInstance[];
  readonly wires: readonly Wire[];
  /** The signals the Waveforms tab shows, in its order (R13). No part of the netlist. */
  readonly probes: readonly Probe[];
}

/** How a probe's value is written: buses and groups default to `hex`, 1-bit signals to levels. */
export type ProbeRadix = 'hex' | 'dec' | 'bin' | 'ascii';

export const PROBE_RADIXES: readonly ProbeRadix[] = ['hex', 'dec', 'bin', 'ascii'];

/**
 * A probed signal, by the resolver's reference (docs/circuit.md#resolver): a net by name
 * (`CLK`), a pin (`U1.Y`, also for an unnamed net), or a bus (`D[0..7]`).
 */
export interface SignalProbe {
  readonly ref: string;
  /** Display name instead of the reference. */
  readonly name?: string;
  readonly radix?: ProbeRadix;
}

/** Several 1-bit references read as one value, bit 0 first (`U3.Q0`…`U3.Q3` as `PC`). */
export interface GroupProbe {
  readonly name: string;
  readonly members: readonly string[];
  readonly radix?: ProbeRadix;
}

export type Probe = SignalProbe | GroupProbe;

export const isGroupProbe = (probe: Probe): probe is GroupProbe => 'members' in probe;

/** A part placed on the grid. */
export interface ComponentInstance {
  /** The designator (`U1`, `SW1`, `D3`), unique within the circuit together with wire ids. */
  readonly id: string;
  /** Part type id (`prim/nand`). Not checked when loading: the compiler reports unknown types. */
  readonly type: string;
  /** Grid position of the part's local origin. */
  readonly x: number;
  readonly y: number;
  /** Clockwise, around the local origin. */
  readonly rotation: Rotation;
  /** Mirror horizontally (applied before the rotation). */
  readonly flip: boolean;
  /** Prop values as set by the user; the compiler fills defaults and validates them. */
  readonly props: Readonly<Record<string, PropValue>>;
  /** Free display text (`RESET`, `CARRY`); not an identifier. */
  readonly label?: string;
}

/** One straight horizontal or vertical wire segment; an L-shaped wire is two of them. */
export interface Wire {
  readonly id: string;
  readonly from: Point;
  readonly to: Point;
  /**
   * A bus line: it connects only to bus lines and bus pins (bus entries, bus labels), never to
   * wires or other pins. Absent on plain wires.
   */
  readonly bus?: true;
}

/** A document holding one empty circuit. */
export function emptyDocument(name = 'Main'): CircuitDocument {
  return { schemaVersion: SCHEMA_VERSION, circuits: [emptyCircuit('main', name)] };
}

export function emptyCircuit(id = 'main', name = 'Main'): Circuit {
  return { id, name, components: [], wires: [], probes: [] };
}

/**
 * A circuit id for `name`, not in `taken`: the name as a slug (`Decade Counter` →
 * `decade-counter`; `circuit` if nothing is left), then `-2`, `-3`, … until it is free.
 */
export function circuitIdFor(name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const base =
    name
      .normalize('NFKD') // é → e + a combining accent, dropped next
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'circuit';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}
