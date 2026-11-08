/**
 * The design: a document's top circuit with its subcircuit instances flattened into the one
 * netlist the kernel simulates (R11a). Every circuit is compiled once on its own; flattening
 * walks the instances from the top, prefixing inner parts and nets with the instance path
 * (`A1/U3`, `A1/CLK`) and joining nets through ports. Spec: docs/circuit.md#flattening.
 */
import {
  type AnyComponentDefinition,
  busMembers,
  type ComponentRegistry,
  type Netlist,
  type NetlistComponent,
  type NetlistPin,
  pinsOf,
  resolveProps,
} from '../core';
import type { CircuitBus, DesignIssue, PlacedPin } from './checks';
import { type CompileResult, compileCircuit } from './compile';
import type { Circuit, CircuitDocument } from './document';
import { DocumentRegistry, documentRegistry, subcircuitOf } from './subcircuit';

/** An instance of a subcircuit somewhere in the design. */
export interface DesignInstance {
  /** Its instance path: designators from the top down, `A1`, `A1/A2`. */
  readonly path: string;
  /** Its designator in the circuit it is placed in. */
  readonly designator: string;
  /** The path of the instance it is placed in, `''` for the top circuit. */
  readonly parent: string;
  /** The id of the circuit it places. */
  readonly circuit: string;
}

/** A design issue with the circuit it is in. */
export type CircuitIssue = DesignIssue & { readonly circuit: string };

export interface Design {
  /** The id of the top circuit, the one flattened. */
  readonly top: string;
  /** The registry the circuits were compiled with: the library's parts and the document's. */
  readonly registry: DocumentRegistry;
  /**
   * Ready for `new Simulator(netlist, registry)`: the top circuit's parts as they are, each
   * instance's inner parts by path (`A1/U3`); a net for every net of every circuit instance,
   * joined through ports, called by its outermost id (`CLK`, `A1/U2.Y`, `VCC`).
   */
  readonly netlist: Netlist;
  /** Every circuit of the document compiled on its own (its scene, its design checks). */
  readonly circuits: ReadonlyMap<string, CompileResult>;
  /** Every instance of the flattened design, depth first in document order. */
  readonly instances: readonly DesignInstance[];
  /**
   * Every circuit's design issues, each with its circuit, and the hierarchy's: errors first,
   * then in document order.
   */
  readonly issues: readonly CircuitIssue[];
  /** No error-severity issues anywhere. */
  readonly ok: boolean;
  /** The id of the circuit at an instance path (`''`: the top), if there is such an instance. */
  circuitAt(path: string): string | undefined;
  /** The flat net id of net `net` (a local id of its circuit) in the instance at `path`. */
  netOf(path: string, net: string): string | undefined;
}

export interface DesignOptions {
  /** The circuit to flatten (default: the document's first, its top). */
  readonly top?: string;
  /** Per-circuit compile results kept across calls (the editor keeps one per document). */
  readonly cache?: CompileCache;
}

/**
 * Compile results of circuits, reused while the circuit and the definitions of the parts it uses
 * stay the same objects (a subcircuit whose ports change gets a new definition, so circuits
 * placing it are compiled again).
 */
export class CompileCache {
  #registry: DocumentRegistry | undefined;
  readonly #results = new WeakMap<
    Circuit,
    {
      readonly result: CompileResult;
      readonly uses: ReadonlyMap<string, AnyComponentDefinition | undefined>;
    }
  >();

  /**
   * The document registry of `document`, built from the last one this cache made, so the
   * definitions of unchanged circuits stay the same objects.
   */
  registry(document: CircuitDocument, library: ComponentRegistry): DocumentRegistry {
    const last = this.#registry;
    if (last?.document === document && last.library === library) return last;
    this.#registry = documentRegistry(document, library, last);
    return this.#registry;
  }

  compile(circuit: Circuit, registry: ComponentRegistry): CompileResult {
    const cached = this.#results.get(circuit);
    if (
      cached &&
      [...cached.uses].every(([type, definition]) => registry.get(type) === definition)
    ) {
      return cached.result;
    }
    const result = compileCircuit(circuit, registry);
    const uses = new Map(circuit.components.map((c) => [c.type, registry.get(c.type)] as const));
    this.#results.set(circuit, { result, uses });
    return result;
  }
}

/**
 * Flattens a document's top circuit (or `options.top`) into one netlist. Never throws on user
 * mistakes: a circuit that would contain itself is a `recursive-subcircuit` error and its
 * instance stays empty; a bus port meeting a bus of another width is a `bus-port-width`
 * warning and the bits that exist connect.
 */
export function compileDesign(
  document: CircuitDocument,
  library: ComponentRegistry,
  options: DesignOptions = {},
): Design {
  const cache = options.cache ?? new CompileCache();
  const registry =
    library instanceof DocumentRegistry && library.document === document
      ? library
      : cache.registry(document, library);
  const byId = new Map(document.circuits.map((c) => [c.id, c]));
  const top = options.top ?? document.circuits[0]!.id;
  if (!byId.has(top)) throw new Error(`no circuit "${top}" in the document`);
  const circuits = new Map(
    document.circuits.map((c) => [c.id, cache.compile(c, registry)] as const),
  );
  const hierarchy = recursiveInstances(document, registry);
  const loops = new Set(hierarchy.map((i) => `${i.circuit} ${i.component}`));
  const globals = globalNames(registry.library);

  const nets = new FlatNets();
  const components: NetlistComponent[] = [];
  const pinsByNet = new Map<number, NetlistPin[]>();
  const instances: DesignInstance[] = [];
  const circuitAt = new Map<string, string>([['', top]]);
  const widthIssues = new Map<string, CircuitIssue>();

  const expand = (circuitId: string, path: string) => {
    const compiled = circuits.get(circuitId)!;
    const prefix = path === '' ? '' : `${path}/`;
    for (const net of compiled.nets) {
      const node = nets.node(path, net.id);
      for (const name of net.names) if (globals.has(name)) nets.union(node, nets.node('', name));
    }
    for (const component of compiled.netlist.components) {
      components.push({ ...component, id: prefix + component.id });
    }
    for (const net of compiled.nets) {
      const node = nets.node(path, net.id);
      let list = pinsByNet.get(node);
      if (!list) {
        list = [];
        pinsByNet.set(node, list);
      }
      for (const pin of net.pins) list.push({ component: prefix + pin.component, pin: pin.pin });
    }
    const circuit = byId.get(circuitId)!;
    for (const instance of circuit.components) {
      const inner = subcircuitOf(instance.type);
      if (inner === undefined || !byId.has(inner)) continue;
      if (loops.has(`${circuitId} ${instance.id}`)) continue;
      const childPath = prefix + instance.id;
      instances.push({ path: childPath, designator: instance.id, parent: path, circuit: inner });
      circuitAt.set(childPath, inner);
      connectPorts(compiled, circuits.get(inner)!, instance.id, path, childPath, circuitId);
      expand(inner, childPath);
    }
  };

  /**
   * Joins an instance's pins in the outer circuit to the nets of its ports inside. A bus port's
   * bits join the outer bus's members by name; a member nothing names on one side is a net of
   * its own there (a bus between two instances names bits no other part uses).
   */
  const connectPorts = (
    outer: CompileResult,
    inner: CompileResult,
    designator: string,
    path: string,
    childPath: string,
    circuitId: string,
  ) => {
    const innerNet = indexOf(inner).byName;
    const outerNet = indexOf(outer).byName;
    const { pins, buses } = indexOf(outer).instances.get(designator) ?? NO_PINS;
    for (const { pin, net } of pins) {
      const id = innerNet.get(pin);
      if (id !== undefined) nets.union(nets.node(path, net), nets.node(childPath, id));
    }
    for (const { pin, bus } of buses) {
      const bits = busMembers(pin.pin);
      const outside = bus.members;
      const connected = bus.wires.length > 0 || bus.pins.length > 1;
      if (connected && outside.length !== bits.length) {
        const key = `${circuitId} ${designator}.${pin.pin}`;
        widthIssues.set(key, {
          severity: 'warning',
          code: 'bus-port-width',
          message:
            outside.length === 0
              ? `bus port ${designator}.${pin.pin} is on an unnamed bus: name it to connect its bits`
              : `bus port ${designator}.${pin.pin} has ${bits.length} bits, its bus ${bus.id} ${outside.length}: bits ${Math.min(bits.length, outside.length)} and up don't connect`,
          component: designator,
          pin: pin.pin,
          at: pin.at,
          circuit: circuitId,
        });
      }
      for (let i = 0; i < Math.min(bits.length, outside.length); i++) {
        const a = outerNet.get(outside[i]!) ?? outside[i]!;
        const b = innerNet.get(bits[i]!) ?? bits[i]!;
        nets.union(nets.node(path, a), nets.node(childPath, b));
      }
    }
  };

  expand(top, '');

  // Every flat net once, in the order its first member appeared, called by its outermost id.
  const flatNets = new Map<number, NetlistPin[]>();
  for (let node = 0; node < nets.size; node++) {
    const root = nets.find(node);
    let list = flatNets.get(root);
    if (!list) {
      list = [];
      flatNets.set(root, list);
    }
    list.push(...(pinsByNet.get(node) ?? []));
  }
  const netlist: Netlist = {
    components,
    nets: [...flatNets].map(([root, pins]) => ({ id: nets.key(root), pins })),
  };

  const issues: CircuitIssue[] = [];
  for (const circuit of document.circuits) {
    for (const issue of circuits.get(circuit.id)!.issues)
      issues.push({ ...issue, circuit: circuit.id });
    for (const issue of hierarchy) if (issue.circuit === circuit.id) issues.push(issue);
    for (const issue of widthIssues.values()) if (issue.circuit === circuit.id) issues.push(issue);
  }
  issues.sort((a, b) => rank(a) - rank(b));

  return {
    top,
    registry,
    netlist,
    circuits,
    instances,
    issues,
    ok: !issues.some((issue) => issue.severity === 'error'),
    circuitAt: (path) => circuitAt.get(path),
    netOf: (path, net) => {
      const node = nets.lookup(path, net);
      return node === undefined ? undefined : nets.key(nets.find(node));
    },
  };
}

const rank = (issue: DesignIssue) => (issue.severity === 'error' ? 0 : 1);

/** What flattening looks up in a compiled circuit, built once per compile result. */
interface CompileIndex {
  /** Net id by every name a net has. */
  readonly byName: ReadonlyMap<string, string>;
  /** Each instance's pins with their nets, and its bus pins with their buses, by designator. */
  readonly instances: ReadonlyMap<string, InstancePins>;
}

interface InstancePins {
  readonly pins: readonly { readonly pin: string; readonly net: string }[];
  readonly buses: readonly { readonly pin: PlacedPin; readonly bus: CircuitBus }[];
}

const NO_PINS: InstancePins = { pins: [], buses: [] };

const INDEXES = new WeakMap<CompileResult, CompileIndex>();

function indexOf(result: CompileResult): CompileIndex {
  let index = INDEXES.get(result);
  if (index) return index;
  const byName = new Map<string, string>();
  const instances = new Map<
    string,
    { pins: InstancePins['pins'][number][]; buses: InstancePins['buses'][number][] }
  >();
  const entry = (designator: string) => {
    let pins = instances.get(designator);
    if (!pins) {
      pins = { pins: [], buses: [] };
      instances.set(designator, pins);
    }
    return pins;
  };
  for (const net of result.nets) {
    for (const name of net.names) byName.set(name, net.id);
    for (const pin of net.instancePins)
      entry(pin.component).pins.push({ pin: pin.pin, net: net.id });
  }
  for (const bus of result.buses) {
    for (const pin of bus.pins) if (pin.instance) entry(pin.component).buses.push({ pin, bus });
  }
  index = { byName, instances };
  INDEXES.set(result, index);
  return index;
}

/**
 * The global net names: those a simulated part's pin joins by name (the VCC and GND symbols'),
 * the same net wherever they appear. Other names — net labels, ports — are local to a circuit.
 */
function globalNames(library: ComponentRegistry): ReadonlySet<string> {
  let names = GLOBALS.get(library);
  if (!names) {
    names = new Set<string>();
    for (const definition of library.list()) {
      if (definition.schematicOnly) continue;
      for (const pin of pinsOf(definition, resolveProps(definition))) {
        if (pin.net !== undefined) names.add(pin.net);
      }
    }
    GLOBALS.set(library, names);
  }
  return names;
}

const GLOBALS = new WeakMap<ComponentRegistry, Set<string>>();

/**
 * Instances that close a loop — a circuit placing itself, directly or through others: one error
 * per such instance, in the circuit it is placed in. Their instances are left empty.
 */
export function recursiveInstances(
  document: CircuitDocument,
  registry: ComponentRegistry,
): CircuitIssue[] {
  const byId = new Map(document.circuits.map((c) => [c.id, c]));
  const names = new Map(document.circuits.map((c) => [c.id, c.name]));
  const issues: CircuitIssue[] = [];
  const reported = new Set<string>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string, stack: readonly string[]) => {
    state.set(id, 'open');
    for (const instance of byId.get(id)!.components) {
      const inner = subcircuitOf(instance.type);
      if (inner === undefined || !byId.has(inner) || !registry.has(instance.type)) continue;
      if (state.get(inner) === 'open') {
        const key = `${id} ${instance.id}`;
        if (reported.has(key)) continue;
        reported.add(key);
        const path = inner === id ? [id] : [...stack.slice(stack.indexOf(inner)), id];
        const loop = [...path, inner].map((c) => names.get(c));
        issues.push({
          severity: 'error',
          code: 'recursive-subcircuit',
          message: `${instance.id} would place ${names.get(inner)} inside itself (${loop.join(' → ')}): it is left empty`,
          component: instance.id,
          at: [instance.x, instance.y],
          circuit: id,
        });
      } else if (state.get(inner) !== 'done') {
        visit(inner, [...stack, id]);
      }
    }
    state.set(id, 'done');
  };
  for (const circuit of document.circuits) if (!state.has(circuit.id)) visit(circuit.id, []);
  return issues;
}

/**
 * Union-find over the nets of circuit instances. A node is a net of the instance at a path,
 * keyed `path/id` (`id` at the top); a key already taken by another node gets `#2`. The root
 * of a set is its outermost node: the fewest path segments, then the first made.
 */
class FlatNets {
  readonly #keys: string[] = [];
  readonly #depth: number[] = [];
  readonly #parent: number[] = [];
  readonly #byOrigin = new Map<string, number>();
  readonly #taken = new Set<string>();

  get size(): number {
    return this.#keys.length;
  }

  node(path: string, id: string): number {
    const origin = `${path}\u0000${id}`;
    const existing = this.#byOrigin.get(origin);
    if (existing !== undefined) return existing;
    const base = path === '' ? id : `${path}/${id}`;
    let key = base;
    for (let n = 2; this.#taken.has(key); n++) key = `${base}#${n}`;
    const index = this.#keys.length;
    this.#keys.push(key);
    this.#depth.push(path === '' ? 0 : path.split('/').length);
    this.#parent.push(index);
    this.#byOrigin.set(origin, index);
    this.#taken.add(key);
    return index;
  }

  lookup(path: string, id: string): number | undefined {
    return this.#byOrigin.get(`${path}\u0000${id}`);
  }

  key(node: number): string {
    return this.#keys[node]!;
  }

  find(node: number): number {
    let root = node;
    while (this.#parent[root] !== root) root = this.#parent[root]!;
    while (this.#parent[node] !== root) {
      const next = this.#parent[node]!;
      this.#parent[node] = root;
      node = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const outer =
      this.#depth[ra]! < this.#depth[rb]! || (this.#depth[ra] === this.#depth[rb] && ra < rb);
    if (outer) this.#parent[rb] = ra;
    else this.#parent[ra] = rb;
  }
}
