/**
 * The compiler: circuit document → the kernel's `Netlist`, plus what the editor needs to show it
 * (net of every wire, junction dots) and design issues. Spec: docs/circuit.md#compiler.
 */
import {
  busMembers,
  type ComponentRegistry,
  isDriverPin,
  type Netlist,
  type NetlistComponent,
  type PropValue,
  pinsOf,
  resolveProps,
} from '../core';
import {
  busEntryMembers,
  type CircuitBus,
  type CircuitNet,
  type DesignIssue,
  danglingWires,
  multipleBusNames,
  multipleNetNames,
  type PlacedPin,
  shortedOutputs,
  singleNetLabels,
  undrivenInputs,
} from './checks';
import { type Connectivity, connect } from './connectivity';
import type { Circuit, CircuitDocument, Wire } from './document';
import { type Point, pointKey } from './geometry';
import { type PartLayout, partLayout, placementOf, placePins } from './layout';

export interface CompileResult {
  /** Ready for `new Simulator(netlist, registry)`. Components with errors are left out. */
  readonly netlist: Netlist;
  /** Every net with its placed pins and wires, in netlist order. */
  readonly nets: readonly CircuitNet[];
  /** Net id of every plain wire, by wire id (for coloring wires by level). */
  readonly wireNets: ReadonlyMap<string, string>;
  /** Every bus: bus lines and bus pins, apart from the nets (a layer of their own). */
  readonly buses: readonly CircuitBus[];
  /** Bus id of every bus line, by wire id. */
  readonly wireBuses: ReadonlyMap<string, string>;
  /** Points where a junction dot is drawn on wires, sorted by x, then y. */
  readonly junctions: readonly Point[];
  /** Points where a junction dot is drawn on bus lines, sorted by x, then y. */
  readonly busJunctions: readonly Point[];
  /**
   * Pins that touch nothing at their point (`U1.A`), net labels and bus pins included: a bus pin
   * touches only bus lines and bus pins, other pins only wires and pins. A pin can be open and
   * still share a net by name: a lone VCC symbol, a label away from any wire.
   */
  readonly openPins: ReadonlySet<string>;
  /** Design issues: errors first by kind, each kind in document order. */
  readonly issues: readonly DesignIssue[];
  /** True if there are no error-severity issues. */
  readonly ok: boolean;
}

/**
 * Compiles one circuit. Never throws on user mistakes (unknown parts, bad props, unconnected
 * inputs): those become `issues`, and the rest of the circuit still compiles. Throws only on
 * library bugs (an inconsistent package definition).
 */
export function compileCircuit(circuit: Circuit, registry: ComponentRegistry): CompileResult {
  const issues: DesignIssue[] = [];
  const components: NetlistComponent[] = [];
  const pins: PlacedPin[] = [];
  const schematicPins: PlacedPin[] = [];
  const busPins: PlacedPin[] = [];
  const layouts = new Map<string, PartLayout>();

  for (const instance of circuit.components) {
    const definition = registry.get(instance.type);
    if (!definition) {
      issues.push({
        severity: 'error',
        code: 'unknown-type',
        message: `${instance.id}: unknown part type "${instance.type}"`,
        component: instance.id,
        at: [instance.x, instance.y],
      });
      continue;
    }
    let props: Record<string, PropValue>;
    try {
      props = resolveProps(definition, instance.props, instance.id);
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'invalid-props',
        message: (error as Error).message,
        component: instance.id,
        at: [instance.x, instance.y],
      });
      continue;
    }
    // Parts with a fixed pin list and symbol share one layout; others depend on their props.
    const key =
      typeof definition.pins === 'function' || typeof definition.symbol === 'function'
        ? `${definition.type} ${JSON.stringify(props)}`
        : definition.type;
    let layout = layouts.get(key);
    if (!layout) {
      layout = partLayout(definition, props);
      layouts.set(key, layout);
    }
    const defs = pinsOf(definition, props);
    const schematicOnly = definition.schematicOnly === true;
    const target = schematicOnly ? schematicPins : pins;
    placePins(layout, placementOf(instance)).forEach((placed, i) => {
      const def = defs[i]!;
      (def.bus === true ? busPins : target).push({
        component: instance.id,
        pin: def.name,
        dir: def.dir,
        weak: def.weak === true,
        sense: def.sense === true,
        ...(def.constant !== undefined && { constant: def.constant }),
        ...(def.net !== undefined && { net: def.net }),
        at: placed.at,
      });
    });
    if (schematicOnly) continue;
    components.push(
      Object.keys(instance.props).length > 0
        ? { id: instance.id, type: instance.type, props: instance.props }
        : { id: instance.id, type: instance.type },
    );
  }

  // Two layers that never touch: wires with pins (nets), bus lines with bus pins (buses).
  const wires = circuit.wires.filter((w) => w.bus !== true);
  const busWires = circuit.wires.filter((w) => w.bus === true);

  // Simulated pins first, so nets keep being numbered by them; label pins only join.
  const allPins = [...pins, ...schematicPins];
  const connectivity = connectPins(allPins, wires);
  const groups = Array.from({ length: connectivity.netCount }, () => ({
    pins: [] as PlacedPin[],
    schematicPins: [] as PlacedPin[],
    wires: [] as Wire[],
  }));
  for (const [i, pin] of allPins.entries()) {
    const group = groups[connectivity.pinNet[i]!]!;
    (i < pins.length ? group.pins : group.schematicPins).push(pin);
  }
  for (const [i, wire] of wires.entries()) {
    groups[connectivity.wireNet[i]!]!.wires.push(wire);
  }
  const nets = nameNets(groups);

  const busConnectivity = connectPins(busPins, busWires);
  const buses = nameBuses(busConnectivity, busPins, busWires);
  const onBus = busLocator(busPins, busWires);
  // Bus entries: parts with an unnamed bus pin; each joins the name of its other pin.
  const entries = new Set(busPins.filter((p) => p.net === undefined).map((p) => p.component));
  const entryNames = new Map(
    allPins.flatMap((p) =>
      entries.has(p.component) && p.net !== undefined ? [[p.component, p.net] as const] : [],
    ),
  );

  issues.push(
    ...shortedOutputs(nets),
    ...undrivenInputs(nets),
    ...danglingWires(connectivity.danglingEnds, wires, onBus),
    ...danglingWires(busConnectivity.danglingEnds, busWires),
    ...multipleNetNames(nets),
    ...multipleBusNames(buses),
    ...singleNetLabels(nets, entries),
    ...busEntryMembers(buses, entryNames),
  );
  issues.sort((a, b) => severityRank(a) - severityRank(b));

  return {
    netlist: {
      components,
      nets: nets.map((net) => ({
        id: net.id,
        pins: net.pins.map((p) => ({ component: p.component, pin: p.pin })),
      })),
    },
    nets,
    wireNets: new Map(wires.map((wire, i) => [wire.id, nets[connectivity.wireNet[i]!]!.id])),
    buses,
    wireBuses: new Map(
      busWires.map((wire, i) => [wire.id, buses[busConnectivity.wireNet[i]!]!.id]),
    ),
    junctions: connectivity.junctions,
    busJunctions: busConnectivity.junctions,
    openPins: new Set([
      ...connectivity.openPins.map((i) => pinId(allPins[i]!)),
      ...busConnectivity.openPins.map((i) => pinId(busPins[i]!)),
    ]),
    issues,
    ok: !issues.some((issue) => issue.severity === 'error'),
  };
}

/** Compiles the document's main (first) circuit. */
export function compileDocument(
  document: CircuitDocument,
  registry: ComponentRegistry,
): CompileResult {
  return compileCircuit(document.circuits[0]!, registry);
}

const pinId = (pin: PlacedPin) => `${pin.component}.${pin.pin}`;

function connectPins(pins: readonly PlacedPin[], wires: readonly Wire[]): Connectivity {
  return connect(
    pins.map((p) => p.at),
    wires,
    pins.map((p) => p.net),
  );
}

/**
 * Buses from the bus layer's connectivity. A bus is called by its first name (bus labels, in
 * code-point order), else its first bus pin (`BE1.B`), else its first bus line. Bus ids are only
 * compared with each other, so they may repeat a net id.
 */
function nameBuses(
  connectivity: Connectivity,
  pins: readonly PlacedPin[],
  wires: readonly Wire[],
): CircuitBus[] {
  const groups = Array.from({ length: connectivity.netCount }, () => ({
    pins: [] as PlacedPin[],
    wires: [] as Wire[],
  }));
  for (const [i, pin] of pins.entries()) groups[connectivity.pinNet[i]!]!.pins.push(pin);
  for (const [i, wire] of wires.entries()) groups[connectivity.wireNet[i]!]!.wires.push(wire);
  return groups.map((group) => {
    const names = [...new Set(group.pins.flatMap((p) => (p.net === undefined ? [] : [p.net])))];
    names.sort(byCodePoint);
    const pin = group.pins[0];
    const id = names[0] ?? (pin ? pinId(pin) : group.wires[0]!.id);
    return { id, names, members: names[0] === undefined ? [] : busMembers(names[0]), ...group };
  });
}

/** Whether a point lies on a bus line (ends included) or a bus pin. */
function busLocator(pins: readonly PlacedPin[], wires: readonly Wire[]): (at: Point) => boolean {
  const points = new Set(pins.map((p) => pointKey(p.at)));
  return (at) =>
    points.has(pointKey(at)) ||
    wires.some(({ from, to }) => {
      const [x, y] = at;
      return (
        x >= Math.min(from[0], to[0]) &&
        x <= Math.max(from[0], to[0]) &&
        y >= Math.min(from[1], to[1]) &&
        y <= Math.max(from[1], to[1])
      );
    });
}

type NetGroup = Omit<CircuitNet, 'id' | 'names'>;

/**
 * Readable, deterministic net ids. A named net is called by its first name (`CLK`, `VCC`); other
 * nets by their first driver pin (`U1.Y`), else their first pin, else their first wire. Pin ids
 * contain a dot and names and wire ids don't; a wire id that is also some net's name gets a
 * `#2` suffix.
 */
function nameNets(groups: readonly NetGroup[]): CircuitNet[] {
  const names = groups.map(namesOf);
  const taken = new Set(names.flat());
  return groups.map((group, i) => {
    const own = names[i]!;
    let id = own[0];
    if (id === undefined) {
      const base = unnamedId(group);
      id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}#${n}`;
      taken.add(id);
    }
    return { id, names: own, ...group };
  });
}

/** Names from simulated pins (VCC, GND), then from labels, each group in code-point order. */
function namesOf(group: NetGroup): string[] {
  const names = new Set<string>();
  for (const list of [group.pins, group.schematicPins]) {
    const own = list.flatMap((p) => (p.net === undefined ? [] : [p.net]));
    for (const name of own.sort(byCodePoint)) names.add(name);
  }
  return [...names];
}

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function unnamedId({ pins, schematicPins, wires }: NetGroup): string {
  const pin = pins.find((p) => isDriverPin(p.dir)) ?? pins[0] ?? schematicPins[0];
  return pin ? `${pin.component}.${pin.pin}` : wires[0]!.id;
}

const severityRank = (issue: DesignIssue) => (issue.severity === 'error' ? 0 : 1);
