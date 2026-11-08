/**
 * Subcircuits (R11a): a circuit of the document placed in another as an instance of type
 * `sub/<circuit id>`. The document registry serves one generated definition per circuit — pins
 * from its ports, a box symbol — so layouts, drawing and the editor treat an instance like any
 * part; the compiler never hands one to the kernel, it flattens it (`compileDesign`).
 * Spec: docs/circuit.md#subcircuits.
 */
import {
  type AnyComponentDefinition,
  COMBINING_OVERLINE,
  type ComponentRegistry,
  defineComponent,
  isBusName,
  netNameRuns,
  type PinDef,
  type PinSide,
  type PortDirection,
  type PropValue,
  pinsOf,
  resolveProps,
  runsText,
  type SymbolPin,
} from '../core';
import { portBits } from './checks';
import type { Circuit, CircuitDocument } from './document';
import type { Point } from './geometry';
import { partLayout, placementOf, placePins } from './layout';

/** The family of instance types: `sub/<circuit id>`. No library part may use it. */
export const SUBCIRCUIT_FAMILY = 'sub';

/** Designator prefix of instances: IEEE 315's `A`, an assembly (a board, a module): `A1`. */
export const SUBCIRCUIT_PREFIX = 'A';

/** The part type of an instance of circuit `id`. */
export function subcircuitType(id: string): string {
  return `${SUBCIRCUIT_FAMILY}/${id}`;
}

/** The circuit id an instance type names, or undefined for any other type. */
export function subcircuitOf(type: string): string | undefined {
  return type.startsWith(`${SUBCIRCUIT_FAMILY}/`)
    ? type.slice(SUBCIRCUIT_FAMILY.length + 1)
    : undefined;
}

/** A port of a circuit, as its instances' pin. */
export interface CircuitPort {
  /** The port part's designator (`P1`). */
  readonly component: string;
  /** The pin's name: a net name, or a bus name for a bus port. */
  readonly name: string;
  readonly direction: PortDirection;
  /** Where the instance symbol puts it, `auto` resolved. */
  readonly side: PinSide;
  readonly bus: boolean;
  /** Where the port's pin is in its circuit (orders the pins of a side). */
  readonly at: Point;
}

/**
 * A circuit's ports in pin order: left, right, top, bottom; within a side in the order they are
 * drawn — left and right by y then x, top and bottom by x then y. A port giving a name an earlier
 * one (in document order) gives already is left out, as is one whose part or props are invalid:
 * the compiler reports those (`duplicate-port`, `invalid-props`).
 */
export function circuitPorts(circuit: Circuit, registry: ComponentRegistry): CircuitPort[] {
  const ports: CircuitPort[] = [];
  const given = new Set<string>();
  for (const instance of circuit.components) {
    const definition = registry.get(instance.type);
    if (!definition?.port) continue;
    let props: Record<string, PropValue>;
    try {
      props = resolveProps(definition, instance.props, instance.id);
    } catch {
      continue;
    }
    const port = definition.port(props);
    const bits = portBits(port.name);
    if (bits.some((bit) => given.has(bit))) continue;
    for (const bit of bits) given.add(bit);
    const pins = pinsOf(definition, props);
    const index = Math.max(
      0,
      pins.findIndex((p) => p.net === port.name),
    );
    const at = placePins(partLayout(definition, props), placementOf(instance))[index]!.at;
    const side = port.side === 'auto' ? (port.direction === 'in' ? 'left' : 'right') : port.side;
    ports.push({
      component: instance.id,
      name: port.name,
      direction: port.direction,
      side,
      bus: isBusName(port.name),
      at,
    });
  }
  const rank = (side: PinSide) => SIDE_ORDER.indexOf(side);
  return ports.sort((a, b) => {
    if (a.side !== b.side) return rank(a.side) - rank(b.side);
    const vertical = a.side === 'left' || a.side === 'right';
    const [a1, a2] = vertical ? [a.at[1], a.at[0]] : a.at;
    const [b1, b2] = vertical ? [b.at[1], b.at[0]] : b.at;
    return a1 - b1 || a2 - b2;
  });
}

const SIDE_ORDER: readonly PinSide[] = ['left', 'right', 'top', 'bottom'];

/** Font sizes the subcircuit drawer uses, in cells; the symbol is sized by them. */
export const SUBCIRCUIT_PIN_FONT = 0.55;
export const SUBCIRCUIT_TITLE_FONT = 0.65;

/** Width of one character of the (monospaced) pin name font, in cells. */
const PIN_CHAR = SUBCIRCUIT_PIN_FONT * 0.6;
/** Width of one character of the bold title, in cells (sans; generous). */
const TITLE_CHAR = SUBCIRCUIT_TITLE_FONT * 0.62;

const DIRECTION_WORDS: Readonly<Record<PortDirection, string>> = {
  in: 'input',
  out: 'output',
  bidir: 'bidirectional',
};

/**
 * Rows a symbol keeps along its top or bottom edge for the names of the pins there, which read
 * across the edge inside the body: as many cells as the longest name needs, 0 without pins.
 */
export function subcircuitRoom(names: readonly string[]): number {
  if (names.length === 0) return 0;
  const longest = Math.max(...names.map((n) => runsText(netNameRuns(n)).length));
  return Math.ceil(longest * PIN_CHAR + 0.5);
}

/** A port name as drawn on a pin: `~{CLR}` → C̅L̅R̅ (marked with U+0305 for `pinTextRuns`). */
function pinLabel(name: string): string | undefined {
  const runs = netNameRuns(name);
  if (!runs.some((run) => run.overline)) return undefined;
  return runs
    .map((run) =>
      run.overline ? [...run.text].map((c) => c + COMBINING_OVERLINE).join('') : run.text,
    )
    .join('');
}

/**
 * The generated definition of circuit `circuit` with ports `ports` (in pin order): type
 * `sub/<id>`, its name, prefix `A`, a pin per port and a box symbol (`kind: 'subcircuit'`) with
 * the circuit's name at the top and each pin on its side in order. It has no behavior: creating
 * one is a bug (instances are flattened).
 */
export function subcircuitDefinition(
  circuit: Circuit,
  ports: readonly CircuitPort[],
): AnyComponentDefinition {
  const pins: PinDef[] = ports.map((port) => {
    const label = pinLabel(port.name);
    const description = `${DIRECTION_WORDS[port.direction]} ${port.bus ? 'bus ' : ''}port ${port.name}`;
    const base = { name: port.name, description, ...(label !== undefined && { label }) };
    return port.bus
      ? { ...base, dir: 'nc', bus: true }
      : {
          ...base,
          dir: port.direction === 'in' ? 'in' : port.direction === 'out' ? 'out' : 'bidir',
        };
  });
  const side = (s: PinSide) => ports.filter((p) => p.side === s);
  const [left, right, top, bottom] = SIDE_ORDER.map(side) as [
    CircuitPort[],
    CircuitPort[],
    CircuitPort[],
    CircuitPort[],
  ];
  const longest = (list: readonly CircuitPort[]) =>
    Math.max(0, ...list.map((p) => runsText(netNameRuns(p.name)).length));
  const room = (list: readonly CircuitPort[]) => subcircuitRoom(list.map((p) => p.name));
  const topRoom = room(top);
  const rows = Math.max(left.length, right.length);
  const height = topRoom + rows + 2 + room(bottom);
  const width = Math.max(
    4,
    Math.ceil((longest(left) + longest(right)) * PIN_CHAR + 1.5),
    Math.ceil(runsText(netNameRuns(circuit.name)).length * TITLE_CHAR + 1),
    Math.max(top.length, bottom.length) + 1,
  );
  const symbolPins: Record<string, SymbolPin> = {};
  // The title sits on the row at `topRoom + 1`; side pins start below it.
  for (const [i, p] of left.entries())
    symbolPins[p.name] = { side: 'left', offset: topRoom + 2 + i };
  for (const [i, p] of right.entries()) {
    symbolPins[p.name] = { side: 'right', offset: topRoom + 2 + i };
  }
  const across = (list: readonly CircuitPort[], s: 'top' | 'bottom') => {
    const start = Math.max(1, Math.floor((width - list.length + 1) / 2));
    for (const [i, p] of list.entries()) symbolPins[p.name] = { side: s, offset: start + i };
  };
  across(top, 'top');
  across(bottom, 'bottom');
  const inputs = ports.filter((p) => p.direction === 'in').map((p) => p.name);
  const outputs = ports.filter((p) => p.direction === 'out').map((p) => p.name);
  const both = ports.filter((p) => p.direction === 'bidir').map((p) => p.name);
  const summary = [
    [inputs.join(', '), outputs.join(', ')].filter(Boolean).join(' → '),
    both.length > 0 ? `↔ ${both.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return defineComponent<Record<string, never>, undefined>({
    type: subcircuitType(circuit.id),
    name: circuit.name,
    title: summary === '' ? 'Subcircuit without ports' : `Subcircuit: ${summary}`,
    keywords: ['subcircuit', 'module', circuit.id],
    designatorPrefix: SUBCIRCUIT_PREFIX,
    pins,
    symbol: { kind: 'subcircuit', width, height, pins: symbolPins },
    create: () => {
      throw new Error(`${subcircuitType(circuit.id)}: a subcircuit is flattened, never simulated`);
    },
  });
}

/** What a generated definition depends on: the circuit's name and its ports in order. */
function signatureOf(circuit: Circuit, ports: readonly CircuitPort[]): string {
  return JSON.stringify([circuit.name, ports.map((p) => [p.name, p.direction, p.side])]);
}

interface Generated {
  readonly circuit: Circuit;
  readonly signature: string;
  readonly definition: AnyComponentDefinition;
}

/**
 * The parts a document's circuits can use: the library's, and an instance definition for each
 * of the document's circuits (`sub/<id>`). Built from a previous one, it keeps every definition
 * whose circuit's name and ports didn't change, so layouts and scenes built on them stay valid.
 */
export class DocumentRegistry implements ComponentRegistry {
  readonly library: ComponentRegistry;
  readonly document: CircuitDocument;
  readonly #generated = new Map<string, Generated>();

  constructor(document: CircuitDocument, library: ComponentRegistry, previous?: DocumentRegistry) {
    this.library = library instanceof DocumentRegistry ? library.library : library;
    this.document = document;
    for (const circuit of document.circuits) {
      const old =
        previous?.library === this.library ? previous.#generated.get(circuit.id) : undefined;
      if (old?.circuit === circuit) {
        this.#generated.set(circuit.id, old);
        continue;
      }
      const ports = circuitPorts(circuit, this.library);
      const signature = signatureOf(circuit, ports);
      const definition =
        old?.signature === signature ? old.definition : subcircuitDefinition(circuit, ports);
      this.#generated.set(circuit.id, { circuit, signature, definition });
    }
  }

  get(type: string): AnyComponentDefinition | undefined {
    const id = subcircuitOf(type);
    return id === undefined ? this.library.get(type) : this.#generated.get(id)?.definition;
  }

  has(type: string): boolean {
    return this.get(type) !== undefined;
  }

  /** The document's circuits' definitions in document order, then the library's parts. */
  list(): readonly AnyComponentDefinition[] {
    const own = [...this.#generated.values()].map((g) => g.definition);
    return [...own, ...this.library.list().filter((d) => subcircuitOf(d.type) === undefined)];
  }

  /** The circuit an instance type places, if it is one of the document's. */
  circuitOf(type: string): Circuit | undefined {
    const id = subcircuitOf(type);
    return id === undefined ? undefined : this.#generated.get(id)?.circuit;
  }
}

/** The registry of a document's parts: the library's and its circuits' (see `DocumentRegistry`). */
export function documentRegistry(
  document: CircuitDocument,
  library: ComponentRegistry,
  previous?: DocumentRegistry,
): DocumentRegistry {
  return new DocumentRegistry(document, library, previous);
}
