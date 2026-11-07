/**
 * Document operations for editing: designators and wire ids, adding, removing, updating and
 * renaming parts, wire normalization, and fragments for copy/paste. All pure `Circuit → Circuit`;
 * unchanged components and wires keep their identity, so undo snapshots share them.
 * Spec: docs/circuit.md#editing.
 */
import {
  type ComponentRegistry,
  DEFAULT_DESIGNATOR_PREFIX,
  designatorPrefixOf,
  type PropValue,
} from '../core';
import {
  type Circuit,
  type ComponentInstance,
  type GroupProbe,
  ID_PATTERN,
  isGroupProbe,
  type Probe,
  type SignalProbe,
  type Wire,
} from './document';
import type { Point, Rotation } from './geometry';

/** Prefix of generated wire ids. */
export const WIRE_PREFIX = 'w';

/** Every id in use in a circuit: designators and wire ids share one namespace. */
export function circuitIds(circuit: Circuit): Set<string> {
  const ids = new Set<string>();
  for (const c of circuit.components) ids.add(c.id);
  for (const w of circuit.wires) ids.add(w.id);
  return ids;
}

/**
 * Hands out unused ids `<prefix><n>`, lowest n ≥ 1 first (gaps are filled: `U1, U3` → `U2`).
 * Every id it returns or is told about counts as used from then on.
 */
export class IdAllocator {
  readonly #used: Set<string>;

  constructor(used: Iterable<string> = []) {
    this.#used = new Set(used);
  }

  static of(circuit: Circuit): IdAllocator {
    return new IdAllocator(circuitIds(circuit));
  }

  has(id: string): boolean {
    return this.#used.has(id);
  }

  /** Marks an id used; false if it already was. */
  take(id: string): boolean {
    if (this.#used.has(id)) return false;
    this.#used.add(id);
    return true;
  }

  next(prefix: string): string {
    let n = 1;
    while (this.#used.has(`${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    this.#used.add(id);
    return id;
  }
}

/** The designator the next part with this prefix gets: `nextDesignator(c, 'SW')` → `SW2`. */
export function nextDesignator(circuit: Circuit, prefix: string): string {
  return IdAllocator.of(circuit).next(prefix);
}

/** Designator prefix of a part type (the default for types the registry doesn't know). */
export function prefixOfType(registry: ComponentRegistry, type: string): string {
  const definition = registry.get(type);
  return definition ? designatorPrefixOf(definition) : DEFAULT_DESIGNATOR_PREFIX;
}

/** Ids of the items an operation works on. */
export interface ItemIds {
  readonly parts: Iterable<string>;
  readonly wires: Iterable<string>;
}

export function addComponents(circuit: Circuit, components: readonly ComponentInstance[]): Circuit {
  if (components.length === 0) return circuit;
  const ids = circuitIds(circuit);
  for (const c of components) {
    if (ids.has(c.id)) throw new Error(`duplicate id "${c.id}"`);
    ids.add(c.id);
  }
  return { ...circuit, components: [...circuit.components, ...components] };
}

/**
 * Adds wires (zero-length ones are skipped), or bus lines when `bus` is set; ids are generated.
 * Returns the new wires too.
 */
export function addWires(
  circuit: Circuit,
  segments: readonly (readonly [Point, Point])[],
  bus = false,
): { circuit: Circuit; wires: Wire[] } {
  const ids = IdAllocator.of(circuit);
  const wires: Wire[] = [];
  for (const [from, to] of segments) {
    if (from[0] === to[0] && from[1] === to[1]) continue;
    if (from[0] !== to[0] && from[1] !== to[1]) {
      throw new Error(`wire (${from}) → (${to}) is neither horizontal nor vertical`);
    }
    wires.push(makeWire(ids.next(WIRE_PREFIX), from, to, bus));
  }
  if (wires.length === 0) return { circuit, wires };
  return { circuit: { ...circuit, wires: [...circuit.wires, ...wires] }, wires };
}

/** Removes parts and wires by id. Wires attached to removed parts stay. */
export function removeItems(circuit: Circuit, items: ItemIds): Circuit {
  const parts = new Set(items.parts);
  const wires = new Set(items.wires);
  if (parts.size === 0 && wires.size === 0) return circuit;
  const components = circuit.components.filter((c) => !parts.has(c.id));
  const kept = circuit.wires.filter((w) => !wires.has(w.id));
  if (components.length === circuit.components.length && kept.length === circuit.wires.length) {
    return circuit;
  }
  return { ...circuit, components, wires: kept };
}

/** What `updateComponent` can change. `label: ''` or `undefined` removes the label. */
export interface ComponentPatch {
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: Rotation;
  readonly flip?: boolean;
  readonly props?: Readonly<Record<string, PropValue>>;
  readonly label?: string | undefined;
}

/** Applies a patch to one part (the same circuit if nothing changes). */
export function updateComponent(circuit: Circuit, id: string, patch: ComponentPatch): Circuit {
  const index = circuit.components.findIndex((c) => c.id === id);
  if (index < 0) throw new Error(`no part "${id}"`);
  const current = circuit.components[index]!;
  const { label: _, ...rest } = current;
  const next: ComponentInstance = {
    ...rest,
    ...(patch.x !== undefined && { x: patch.x }),
    ...(patch.y !== undefined && { y: patch.y }),
    ...(patch.rotation !== undefined && { rotation: patch.rotation }),
    ...(patch.flip !== undefined && { flip: patch.flip }),
    ...(patch.props !== undefined && { props: patch.props }),
  };
  const label = 'label' in patch ? patch.label : current.label;
  const updated: ComponentInstance = label ? { ...next, label } : next;
  if (sameComponent(current, updated)) return circuit;
  const components = [...circuit.components];
  components[index] = updated;
  return { ...circuit, components };
}

/** True if two circuits hold the same parts, wires and probes in the same order (by value). */
export function sameCircuit(a: Circuit, b: Circuit): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.name !== b.name) return false;
  if (a.components.length !== b.components.length || a.wires.length !== b.wires.length) {
    return false;
  }
  if (!sameProbes(a.probes, b.probes)) return false;
  for (let i = 0; i < a.components.length; i++) {
    const x = a.components[i]!;
    const y = b.components[i]!;
    if (x !== y && !sameComponent(x, y)) return false;
  }
  for (let i = 0; i < a.wires.length; i++) {
    const x = a.wires[i]!;
    const y = b.wires[i]!;
    if (
      x !== y &&
      (x.id !== y.id ||
        x.from[0] !== y.from[0] ||
        x.from[1] !== y.from[1] ||
        x.to[0] !== y.to[0] ||
        x.to[1] !== y.to[1] ||
        x.bus !== y.bus)
    ) {
      return false;
    }
  }
  return true;
}

/** Two probe lists alike, item by item. */
export function sameProbes(a: readonly Probe[], b: readonly Probe[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    if (x === y) return true;
    if (x.name !== y.name || x.radix !== y.radix) return false;
    if (isGroupProbe(x) || isGroupProbe(y)) {
      return (
        isGroupProbe(x) &&
        isGroupProbe(y) &&
        x.members.length === y.members.length &&
        x.members.every((m, k) => m === y.members[k])
      );
    }
    return x.ref === y.ref;
  });
}

function sameComponent(a: ComponentInstance, b: ComponentInstance): boolean {
  if (
    a.id !== b.id ||
    a.type !== b.type ||
    a.x !== b.x ||
    a.y !== b.y ||
    a.rotation !== b.rotation ||
    a.flip !== b.flip ||
    a.label !== b.label
  ) {
    return false;
  }
  const keys = Object.keys(a.props);
  return (
    keys.length === Object.keys(b.props).length && keys.every((k) => a.props[k] === b.props[k])
  );
}

/** Why `to` can't be the new designator of `from`, or undefined if it can. */
export function designatorError(circuit: Circuit, from: string, to: string): string | undefined {
  if (to === from) return undefined;
  if (to === '') return 'A designator is required.';
  if (!ID_PATTERN.test(to)) {
    return 'Use a letter or _ first, then letters, digits, _ or - (no spaces or dots).';
  }
  if (circuitIds(circuit).has(to)) return `"${to}" is already used.`;
  return undefined;
}

/** Renames a part (its id is its designator). Throws if the new id is invalid or taken. */
export function renameComponent(circuit: Circuit, from: string, to: string): Circuit {
  const index = circuit.components.findIndex((c) => c.id === from);
  if (index < 0) throw new Error(`no part "${from}"`);
  const error = designatorError(circuit, from, to);
  if (error) throw new Error(error);
  if (from === to) return circuit;
  const components = [...circuit.components];
  components[index] = { ...components[index]!, id: to };
  return { ...circuit, components, probes: renameInProbes(circuit.probes, from, to) };
}

/** Probes with the pin references of part `from` (`U5.A0`) rewritten to part `to`. */
export function renameInProbes(
  probes: readonly Probe[],
  from: string,
  to: string,
): readonly Probe[] {
  const prefix = `${from}.`;
  const rename = (ref: string) =>
    ref.startsWith(prefix) ? `${to}.${ref.slice(prefix.length)}` : ref;
  let changed = false;
  const renamed = probes.map((probe) => {
    const next = isGroupProbe(probe)
      ? { ...probe, members: probe.members.map(rename) }
      : { ...probe, ref: rename(probe.ref) };
    const same = isGroupProbe(probe)
      ? (next as GroupProbe).members.every((m, i) => m === probe.members[i])
      : (next as SignalProbe).ref === probe.ref;
    if (same) return probe;
    changed = true;
    return next;
  });
  return changed ? renamed : probes;
}

/** Moves every part and wire of a circuit by whole cells. */
export function translateCircuit(circuit: Circuit, dx: number, dy: number): Circuit {
  if (dx === 0 && dy === 0) return circuit;
  const move = (p: Point): Point => [p[0] + dx, p[1] + dy];
  return {
    ...circuit,
    components: circuit.components.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy })),
    wires: circuit.wires.map((w) => ({ ...w, from: move(w.from), to: move(w.to) })),
  };
}

// ── Wire normalization ─────────────────────────────────────────────────────────────────────

interface Run {
  /** Fixed coordinate (y of a horizontal run, x of a vertical one). */
  readonly line: number;
  readonly lo: number;
  readonly hi: number;
  /** Index of the input wire. */
  readonly index: number;
}

/** A wire, or a bus line when `bus` is set (plain wires carry no `bus` field). */
function makeWire(id: string, from: Point, to: Point, bus: boolean): Wire {
  return bus ? { id, from, to, bus } : { id, from, to };
}

/**
 * Normalizes the wires: drops zero-length ones and merges collinear wires that overlap or meet
 * end to end into one straight run — except at a point where perpendicular wires pass through
 * (one wire's interior, or two that meet there and merge too): wires ending there connect to
 * them, a run through it would cross unconnected, so the run is split there instead. Output
 * wire ends are always input wire ends and cover the same points, so connectivity never changes
 * (everything that touches connects). Wires that don't change keep their identity and order; a
 * merged run takes the id and position of its first wire in document order. Bus lines and wires
 * are separate layers: each is normalized on its own, and a bus never merges with a wire.
 */
export function normalizeWires(circuit: Circuit): Circuit {
  const { wires } = circuit;
  const layers = [false, true].map(() => ({
    horizontal: new Map<number, Run[]>(),
    vertical: new Map<number, Run[]>(),
  }));
  let zeroLength = false;
  wires.forEach((w, index) => {
    const [x0, y0] = w.from;
    const [x1, y1] = w.to;
    if (x0 === x1 && y0 === y1) {
      zeroLength = true;
      return;
    }
    const isHorizontal = y0 === y1;
    const { horizontal, vertical } = layers[w.bus === true ? 1 : 0]!;
    const map = isHorizontal ? horizontal : vertical;
    const line = isHorizontal ? y0 : x0;
    const a = isHorizontal ? x0 : y0;
    const b = isHorizontal ? x1 : y1;
    const run: Run = { line, lo: Math.min(a, b), hi: Math.max(a, b), index };
    const list = map.get(line);
    if (list) list.push(run);
    else map.set(line, [run]);
  });

  // Output segments per input index that gives them their id (or -1 for a fresh id).
  type Out = {
    readonly from: Point;
    readonly to: Point;
    readonly source: number;
    readonly bus: boolean;
  };
  const out: Out[] = [];
  let changed = zeroLength;

  const lineRuns = (
    map: Map<number, Run[]>,
    isHorizontal: boolean,
    cross: Map<number, Run[]>,
    bus: boolean,
  ) => {
    const point = (line: number, at: number): Point => (isHorizontal ? [at, line] : [line, at]);
    for (const [line, runs] of map) {
      if (runs.length === 1) {
        out.push({ ...segmentOf(wires[runs[0]!.index]!), source: runs[0]!.index, bus });
        continue;
      }
      runs.sort((a, b) => a.lo - b.lo || a.hi - b.hi || a.index - b.index);
      let group: Run[] = [];
      let groupHi = Number.NEGATIVE_INFINITY;
      const flush = () => {
        if (group.length === 0) return;
        changed = emitGroup(group, line, point, cross, wires, out, bus) || changed;
        group = [];
      };
      for (const run of runs) {
        if (run.lo > groupHi) flush();
        group.push(run);
        groupHi = group.length === 1 ? run.hi : Math.max(groupHi, run.hi);
      }
      flush();
    }
  };
  layers.forEach(({ horizontal, vertical }, layer) => {
    lineRuns(horizontal, true, vertical, layer === 1);
    lineRuns(vertical, false, horizontal, layer === 1);
  });

  if (!changed) return circuit;

  // Keep document order: a segment sits where its source wire was; fresh ones go last.
  out.sort((a, b) => (a.source < 0 ? 1 : 0) - (b.source < 0 ? 1 : 0) || a.source - b.source);
  const ids = new IdAllocator(circuit.components.map((c) => c.id));
  const used = new Set<number>();
  const result: Wire[] = [];
  const pending: Out[] = [];
  for (const segment of out) {
    if (segment.source >= 0 && !used.has(segment.source)) {
      used.add(segment.source);
      const original = wires[segment.source]!;
      ids.take(original.id);
      result.push(
        sameSegment(original, segment)
          ? original
          : makeWire(original.id, segment.from, segment.to, segment.bus),
      );
    } else {
      pending.push(segment);
    }
  }
  for (const w of wires) ids.take(w.id);
  for (const segment of pending) {
    result.push(makeWire(ids.next(WIRE_PREFIX), segment.from, segment.to, segment.bus));
  }
  return { ...circuit, wires: result };
}

function segmentOf(w: Wire): { from: Point; to: Point } {
  return { from: w.from, to: w.to };
}

function sameSegment(w: Wire, s: { readonly from: Point; readonly to: Point }): boolean {
  const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
  return (same(w.from, s.from) && same(w.to, s.to)) || (same(w.from, s.to) && same(w.to, s.from));
}

/**
 * True if the perpendicular wires on line `at` reach the point (`at`, `line`) from both sides —
 * through one wire's interior or as two wires meeting there — so after merging they pass
 * through it.
 */
function coveredBothSides(cross: Map<number, Run[]>, line: number, at: number): boolean {
  const runs = cross.get(at);
  if (!runs) return false;
  return (
    runs.some((r) => r.lo < line && r.hi >= line) && runs.some((r) => r.lo <= line && r.hi > line)
  );
}

/**
 * Emits one group of overlapping/touching collinear runs as merged segments split at crossing
 * points. Returns true if the output differs from the input runs.
 */
function emitGroup(
  group: readonly Run[],
  line: number,
  point: (line: number, at: number) => Point,
  cross: Map<number, Run[]>,
  wires: readonly Wire[],
  out: { from: Point; to: Point; source: number; bus: boolean }[],
  bus: boolean,
): boolean {
  if (group.length === 1) {
    const run = group[0]!;
    out.push({ ...segmentOf(wires[run.index]!), source: run.index, bus });
    return false;
  }
  const lo = group[0]!.lo;
  const hi = Math.max(...group.map((r) => r.hi));
  // Split at input ends strictly inside the merged run where perpendicular wires pass through
  // (or will, once merged themselves): a merged run would cross them unconnected.
  const cuts = new Set<number>();
  for (const r of group) {
    for (const end of [r.lo, r.hi]) {
      if (end > lo && end < hi && coveredBothSides(cross, line, end)) cuts.add(end);
    }
  }
  const stops = [lo, ...[...cuts].sort((a, b) => a - b), hi];
  // Each piece takes the id of the input wire equal to it, else of the first one (document
  // order) overlapping it that hasn't given its id yet.
  const given = new Set<number>();
  let changed = false;
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    const exact = group.find((r) => r.lo === a && r.hi === b && !given.has(r.index));
    const overlapping = group
      .filter((r) => r.lo < b && r.hi > a && !given.has(r.index))
      .sort((x, y) => x.index - y.index)[0];
    const source = exact ?? overlapping;
    if (source) given.add(source.index);
    if (!exact) changed = true;
    out.push({ from: point(line, a), to: point(line, b), source: source?.index ?? -1, bus });
  }
  // Inputs that gave no piece were absorbed.
  if (given.size !== group.length) changed = true;
  return changed;
}

// ── Fragments (copy / paste) ───────────────────────────────────────────────────────────────

/** The selected parts and wires as a standalone circuit (for the clipboard). */
export function copyFragment(circuit: Circuit, items: ItemIds): Circuit {
  const parts = new Set(items.parts);
  const wires = new Set(items.wires);
  return {
    id: circuit.id,
    name: circuit.name,
    components: circuit.components.filter((c) => parts.has(c.id)),
    wires: circuit.wires.filter((w) => wires.has(w.id)),
    probes: [], // probes belong to the circuit, not to a selection
  };
}

export interface PasteResult {
  readonly circuit: Circuit;
  /** Ids of the pasted parts and wires in the result. */
  readonly parts: readonly string[];
  readonly wires: readonly string[];
}

/**
 * Adds a fragment moved by `offset`. Designators are kept where they are free and renumbered
 * with their part's prefix otherwise; wire ids are always fresh; labels are kept.
 */
export function pasteFragment(
  circuit: Circuit,
  fragment: Circuit,
  offset: Point,
  registry: ComponentRegistry,
): PasteResult {
  const ids = IdAllocator.of(circuit);
  const moved = translateCircuit(fragment, offset[0], offset[1]);
  const components = moved.components.map((c) => {
    const id = ids.take(c.id) ? c.id : ids.next(prefixOfType(registry, c.type));
    return id === c.id ? c : { ...c, id };
  });
  const wires = moved.wires.map((w) => ({ ...w, id: ids.next(WIRE_PREFIX) }));
  return {
    circuit: {
      ...circuit,
      components: [...circuit.components, ...components],
      wires: [...circuit.wires, ...wires],
    },
    parts: components.map((c) => c.id),
    wires: wires.map((w) => w.id),
  };
}
