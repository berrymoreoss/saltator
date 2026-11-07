/**
 * The compiler: circuit document → the kernel's `Netlist`, plus what the editor needs to show it
 * (net of every wire, junction dots) and design issues. Spec: docs/circuit.md#compiler.
 */
import {
  type ComponentRegistry,
  isDriverPin,
  type Netlist,
  type NetlistComponent,
  type PropValue,
  pinsOf,
  resolveProps,
} from '../core';
import {
  type CircuitNet,
  type DesignIssue,
  danglingWires,
  type PlacedPin,
  shortedOutputs,
  undrivenInputs,
} from './checks';
import { connect } from './connectivity';
import type { Circuit, CircuitDocument, Wire } from './document';
import type { Point } from './geometry';
import { type PartLayout, partLayout, placementOf, placePins } from './layout';

export interface CompileResult {
  /** Ready for `new Simulator(netlist, registry)`. Components with errors are left out. */
  readonly netlist: Netlist;
  /** Every net with its placed pins and wires, in netlist order. */
  readonly nets: readonly CircuitNet[];
  /** Net id of every wire, by wire id (for coloring wires by level). */
  readonly wireNets: ReadonlyMap<string, string>;
  /** Points where a junction dot is drawn, sorted by x, then y. */
  readonly junctions: readonly Point[];
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
      target.push({
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

  // Simulated pins first, so nets keep being numbered by them; label pins only join.
  const allPins = [...pins, ...schematicPins];
  const connectivity = connect(
    allPins.map((p) => p.at),
    circuit.wires,
    allPins.map((p) => p.net),
  );
  const groups = Array.from({ length: connectivity.netCount }, () => ({
    pins: [] as PlacedPin[],
    schematicPins: [] as PlacedPin[],
    wires: [] as Wire[],
  }));
  for (const [i, pin] of allPins.entries()) {
    const group = groups[connectivity.pinNet[i]!]!;
    (i < pins.length ? group.pins : group.schematicPins).push(pin);
  }
  for (const [i, wire] of circuit.wires.entries()) {
    groups[connectivity.wireNet[i]!]!.wires.push(wire);
  }
  const nets = nameNets(groups);

  issues.push(
    ...shortedOutputs(nets),
    ...undrivenInputs(nets),
    ...danglingWires(connectivity.danglingEnds, circuit.wires),
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
    wireNets: new Map(
      circuit.wires.map((wire, i) => [wire.id, nets[connectivity.wireNet[i]!]!.id]),
    ),
    junctions: connectivity.junctions,
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
