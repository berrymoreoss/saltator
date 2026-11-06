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
    placePins(layout, placementOf(instance)).forEach((placed, i) => {
      const def = defs[i]!;
      pins.push({
        component: instance.id,
        pin: def.name,
        dir: def.dir,
        weak: def.weak === true,
        sense: def.sense === true,
        ...(def.constant !== undefined && { constant: def.constant }),
        at: placed.at,
      });
    });
    components.push(
      Object.keys(instance.props).length > 0
        ? { id: instance.id, type: instance.type, props: instance.props }
        : { id: instance.id, type: instance.type },
    );
  }

  const connectivity = connect(
    pins.map((p) => p.at),
    circuit.wires,
  );
  const groups = Array.from({ length: connectivity.netCount }, () => ({
    pins: [] as PlacedPin[],
    wires: [] as Wire[],
  }));
  for (const [i, pin] of pins.entries()) groups[connectivity.pinNet[i]!]!.pins.push(pin);
  for (const [i, wire] of circuit.wires.entries()) {
    groups[connectivity.wireNet[i]!]!.wires.push(wire);
  }
  const nets: CircuitNet[] = groups.map((g) => ({ id: netName(g.pins, g.wires), ...g }));

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

/**
 * A readable, deterministic net id: the net's first driver pin (`U1.Y`), else its first pin, else
 * its first wire. Pin names contain a dot and ids don't, so these never collide.
 */
function netName(pins: readonly PlacedPin[], wires: readonly Wire[]): string {
  const named = pins.find((p) => isDriverPin(p.dir)) ?? pins[0];
  return named ? `${named.component}.${named.pin}` : wires[0]!.id;
}

const severityRank = (issue: DesignIssue) => (issue.severity === 'error' ? 0 : 1);
