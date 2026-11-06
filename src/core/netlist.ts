/**
 * The flat, serializable netlist the kernel simulates, a code-first builder for it, and resolution
 * against a registry (validation + implicit nets). Spec: docs/simulation.md#netlist.
 */
import {
  type AnyComponentDefinition,
  type PinDef,
  type PropValue,
  pinsOf,
  resolveProps,
  validatePins,
} from './component';
import type { ComponentRegistry } from './registry';

export interface NetlistComponent {
  readonly id: string;
  readonly type: string;
  readonly props?: Readonly<Record<string, unknown>>;
}

export interface NetlistPin {
  readonly component: string;
  readonly pin: string;
}

export interface NetlistNet {
  readonly id: string;
  readonly pins: readonly NetlistPin[];
}

/**
 * Component instances plus nets (sets of connected pins). Pins that appear in no net are
 * unconnected; they get a private implicit net when the netlist is resolved.
 */
export interface Netlist {
  readonly components: readonly NetlistComponent[];
  readonly nets: readonly NetlistNet[];
}

/** A netlist that failed validation; `problems` lists every issue found. */
export class NetlistError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`invalid netlist:\n  ${problems.join('\n  ')}`);
    this.name = 'NetlistError';
    this.problems = problems;
  }
}

/** `'U1.Y'` or `{ component: 'U1', pin: 'Y' }`. */
export type PinSpec = string | NetlistPin;

function parsePin(spec: PinSpec): NetlistPin {
  if (typeof spec !== 'string') return spec;
  const dot = spec.indexOf('.');
  if (dot <= 0 || dot === spec.length - 1) {
    throw new Error(`bad pin reference "${spec}" (expected "component.pin", e.g. "U1.Y")`);
  }
  return { component: spec.slice(0, dot), pin: spec.slice(dot + 1) };
}

const pinKey = (p: NetlistPin) => `${p.component}.${p.pin}`;

/**
 * Builds a netlist in code (tests, examples). Connecting pins merges their nets (union-find), so
 * connecting a pin twice joins everything it touches. Net ids default to the first pin connected,
 * e.g. `U1.Y`; `net()` names one explicitly (and joins nets of the same name).
 */
export class NetlistBuilder {
  private readonly components: NetlistComponent[] = [];
  private readonly ids = new Set<string>();
  private readonly parent = new Map<string, string>();
  private readonly pins = new Map<string, NetlistPin>(); // in first-connection order
  private readonly names = new Map<string, string>(); // root key → explicit net name

  /** Adds a component instance. Ids must be unique and may not contain `.`. */
  add(id: string, type: string, props?: Readonly<Record<string, unknown>>): this {
    if (id === '' || id.includes('.')) throw new Error(`bad component id "${id}" (no dots)`);
    if (this.ids.has(id)) throw new Error(`duplicate component id "${id}"`);
    this.ids.add(id);
    this.components.push(props === undefined ? { id, type } : { id, type, props });
    return this;
  }

  /** Puts all given pins on one net (merging the nets they were already on). */
  connect(...pins: PinSpec[]): this {
    const keys = pins.map((spec) => this.touch(parsePin(spec)));
    for (const key of keys.slice(1)) this.union(keys[0]!, key);
    return this;
  }

  /**
   * Like `connect`, and names the resulting net. Using a name again joins that net, as net labels
   * do on a schematic.
   */
  net(name: string, ...pins: PinSpec[]): this {
    if (pins.length === 0) throw new Error(`net "${name}" needs at least one pin`);
    this.connect(...pins);
    const key = pinKey(parsePin(pins[0]!));
    const named = [...this.names].find(([, other]) => other === name);
    if (named) {
      this.union(named[0], key);
      return this;
    }
    const root = this.find(key);
    const existing = this.names.get(root);
    if (existing !== undefined) throw new Error(`net "${name}" is already named "${existing}"`);
    this.names.set(root, name);
    return this;
  }

  build(): Netlist {
    const groups = new Map<string, NetlistPin[]>();
    for (const [key, pin] of this.pins) {
      const root = this.find(key);
      const group = groups.get(root);
      if (group) group.push(pin);
      else groups.set(root, [pin]);
    }
    const nets = [...groups].map(([root, pins]) => ({
      id: this.names.get(root) ?? pinKey(pins[0]!),
      pins,
    }));
    return { components: [...this.components], nets };
  }

  private touch(pin: NetlistPin): string {
    const key = pinKey(pin);
    if (!this.pins.has(key)) {
      this.pins.set(key, pin);
      this.parent.set(key, key);
    }
    return key;
  }

  private find(key: string): string {
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression keeps long chains of connect() calls near-linear.
    let node = key;
    while (node !== root) {
      const next = this.parent.get(node)!;
      this.parent.set(node, root);
      node = next;
    }
    return root;
  }

  private union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const nameA = this.names.get(ra);
    const nameB = this.names.get(rb);
    if (nameA !== undefined && nameB !== undefined) {
      throw new Error(`connecting nets "${nameA}" and "${nameB}"`);
    }
    // Keep the root that was connected first so default net ids stay stable.
    this.parent.set(rb, ra);
    if (nameB !== undefined) {
      this.names.delete(rb);
      this.names.set(ra, nameB);
    }
  }
}

// --- Resolution ---------------------------------------------------------------------------------

export interface ResolvedComponent {
  readonly id: string;
  readonly definition: AnyComponentDefinition;
  readonly props: Readonly<Record<string, PropValue>>;
  readonly pins: readonly PinDef[];
}

export interface ResolvedPin {
  /** Index into `ResolvedNetlist.components`. */
  readonly component: number;
  /** Index into that component's `pins`. */
  readonly pin: number;
}

export interface ResolvedNet {
  readonly id: string;
  readonly pins: readonly ResolvedPin[];
  /** True for the private net of an unconnected pin. */
  readonly implicit: boolean;
}

/** A validated netlist with definitions looked up, props defaulted and indices assigned. */
export interface ResolvedNetlist {
  readonly components: readonly ResolvedComponent[];
  /** Declared nets in netlist order, then implicit nets of unconnected pins. */
  readonly nets: readonly ResolvedNet[];
}

/**
 * Validates a netlist against a registry and resolves it to indices. Every unconnected pin
 * (except `power`/`nc`) gets an implicit net with id `component.pin`. Throws a `NetlistError`
 * listing all problems: duplicate ids, unknown types, bad props, unknown pins, pins on two nets.
 */
export function resolveNetlist(netlist: Netlist, registry: ComponentRegistry): ResolvedNetlist {
  const problems: string[] = [];
  const components: ResolvedComponent[] = [];
  const indexById = new Map<string, number>();

  for (const c of netlist.components) {
    if (indexById.has(c.id)) {
      problems.push(`duplicate component id "${c.id}"`);
      continue;
    }
    const definition = registry.get(c.type);
    if (!definition) {
      problems.push(`${c.id}: unknown component type "${c.type}"`);
      continue;
    }
    try {
      const props = resolveProps(definition, c.props, c.id);
      const pins = pinsOf(definition, props);
      validatePins(pins, c.id);
      indexById.set(c.id, components.length);
      components.push({ id: c.id, definition, props, pins });
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  const netIds = new Set<string>();
  const netOfPin = new Map<string, string>();
  const nets: ResolvedNet[] = [];
  for (const net of netlist.nets) {
    if (netIds.has(net.id)) problems.push(`duplicate net id "${net.id}"`);
    netIds.add(net.id);
    const pins: ResolvedPin[] = [];
    for (const p of net.pins) {
      const key = pinKey(p);
      const component = indexById.get(p.component);
      if (component === undefined) {
        // Unknown types were already reported; only flag ids that don't exist at all.
        if (!netlist.components.some((c) => c.id === p.component)) {
          problems.push(`net "${net.id}": unknown component "${p.component}"`);
        }
        continue;
      }
      const pin = components[component]!.pins.findIndex((d) => d.name === p.pin);
      if (pin < 0) {
        const names = components[component]!.pins.map((d) => d.name).join(', ');
        problems.push(
          `net "${net.id}": component "${p.component}" has no pin "${p.pin}" (pins: ${names})`,
        );
        continue;
      }
      const other = netOfPin.get(key);
      if (other !== undefined) {
        problems.push(`pin ${key} is on two nets: "${other}" and "${net.id}"`);
        continue;
      }
      netOfPin.set(key, net.id);
      pins.push({ component, pin });
    }
    nets.push({ id: net.id, pins, implicit: false });
  }

  if (problems.length > 0) throw new NetlistError(problems);

  components.forEach((c, component) => {
    c.pins.forEach((def, pin) => {
      if (def.dir === 'power' || def.dir === 'nc') return;
      const key = `${c.id}.${def.name}`;
      if (netOfPin.has(key)) return;
      let id = key;
      for (let n = 2; netIds.has(id); n++) id = `${key}#${n}`;
      netIds.add(id);
      nets.push({ id, pins: [{ component, pin }], implicit: true });
    });
  });

  return { components, nets };
}
