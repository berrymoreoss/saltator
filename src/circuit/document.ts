/**
 * The circuit document: what the user draws and what gets saved. Spec: docs/circuit.md.
 * Documents are immutable values; `loadDocument` builds them from JSON and fills defaults, so in
 * memory every optional field except a component's `label` and a wire's `bus` is present.
 */
import type { PropValue } from '../core';
import type { Point, Rotation } from './geometry';

/**
 * Version written into every saved document. Bump it together with a migration.
 * v2 (R10b): bus lines (`Wire.bus`). v3 (R13): probes (`Circuit.probes`).
 */
export const SCHEMA_VERSION = 3;

/**
 * Ids of circuits, components (their designators: `U1`, `SW1`) and wires: a letter or `_`, then
 * letters, digits, `_` or `-`. No dots, because netlists address pins as `U1.Y`.
 */
export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export interface CircuitDocument {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  /** At least one. The first is used; subcircuits (R11) give the others a meaning. */
  readonly circuits: readonly Circuit[];
}

export interface Circuit {
  readonly id: string;
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
