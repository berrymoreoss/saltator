/**
 * The circuit document: what the user draws and what gets saved. Spec: docs/circuit.md.
 * Documents are immutable values; `loadDocument` builds them from JSON and fills defaults, so in
 * memory every optional field except `label` is present.
 */
import type { PropValue } from '../core';
import type { Point, Rotation } from './geometry';

/** Version written into every saved document. Bump it together with a migration. */
export const SCHEMA_VERSION = 1;

/**
 * Ids of circuits, components (their designators: `U1`, `SW1`) and wires: a letter or `_`, then
 * letters, digits, `_` or `-`. No dots, because netlists address pins as `U1.Y`.
 */
export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export interface CircuitDocument {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  /** At least one. Schema v1 uses the first; subcircuits (R11) give the others a meaning. */
  readonly circuits: readonly Circuit[];
}

export interface Circuit {
  readonly id: string;
  readonly name: string;
  readonly components: readonly ComponentInstance[];
  readonly wires: readonly Wire[];
}

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
}

/** A document holding one empty circuit. */
export function emptyDocument(name = 'Main'): CircuitDocument {
  return { schemaVersion: SCHEMA_VERSION, circuits: [emptyCircuit('main', name)] };
}

export function emptyCircuit(id = 'main', name = 'Main'): Circuit {
  return { id, name, components: [], wires: [] };
}
