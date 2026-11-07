/**
 * Code-first circuit documents for tests and examples: place parts, draw wires by points or pin
 * names, route simple L-shaped connections. Spec: docs/circuit.md#builder.
 *
 * The builder throws on programming mistakes (unknown part, bad props, unknown pin, diagonal
 * segment) right away, since it is used from code. It does not check what a wire touches on its
 * way: a route that runs over another pin connects to it, exactly as in the editor.
 */
import {
  type AnyComponentDefinition,
  type ComponentRegistry,
  type PropValue,
  resolveProps,
} from '../core';
import {
  type Circuit,
  type CircuitDocument,
  type ComponentInstance,
  ID_PATTERN,
  type Probe,
  SCHEMA_VERSION,
  type Wire,
} from './document';
import { isAxisAligned, type Point, type Rotation, samePoint } from './geometry';
import { partLayout, placementOf, placePins } from './layout';

export interface PlaceOptions {
  /** Grid position of the part's local origin (top-left of its box). */
  readonly at: Point;
  readonly rotation?: Rotation;
  readonly flip?: boolean;
  readonly props?: Readonly<Record<string, PropValue>>;
  readonly label?: string;
}

/** A grid point, or a pin given as `'U1.Y'`. */
export type WirePoint = Point | string;

export class CircuitBuilder {
  private readonly registry: ComponentRegistry;
  private readonly id: string;
  private readonly name: string;
  private readonly components: ComponentInstance[] = [];
  private readonly wires: Wire[] = [];
  private readonly probes: Probe[] = [];
  private readonly ids = new Set<string>();
  private readonly pins = new Map<string, Point>(); // 'U1.Y' → grid point
  private nextWire = 1;

  constructor(registry: ComponentRegistry, options: { id?: string; name?: string } = {}) {
    this.registry = registry;
    this.id = options.id ?? 'main';
    this.name = options.name ?? 'Main';
  }

  /** Places a part. `id` is its designator (`U1`, `SW1`). */
  add(id: string, type: string, options: PlaceOptions): this {
    this.claim(id);
    const definition = this.definition(type);
    const props = options.props ?? {};
    const resolved = resolveProps(definition, props, id);
    const instance: ComponentInstance = {
      id,
      type,
      x: options.at[0],
      y: options.at[1],
      rotation: options.rotation ?? 0,
      flip: options.flip ?? false,
      props: { ...props },
      ...(options.label !== undefined && { label: options.label }),
    };
    this.components.push(instance);
    for (const pin of placePins(partLayout(definition, resolved), placementOf(instance))) {
      this.pins.set(`${id}.${pin.name}`, pin.at);
    }
    return this;
  }

  /** Grid point of a placed part's pin, e.g. `pin('U1.Y')`. */
  pin(spec: string): Point {
    const at = this.pins.get(spec);
    if (at) return at;
    const dot = spec.indexOf('.');
    const component = dot < 0 ? spec : spec.slice(0, dot);
    if (!this.components.some((c) => c.id === component)) {
      throw new Error(`no component "${component}" (in pin "${spec}")`);
    }
    const names = [...this.pins.keys()]
      .filter((key) => key.startsWith(`${component}.`))
      .map((key) => key.slice(component.length + 1));
    throw new Error(
      `component "${component}" has no pin "${spec.slice(dot + 1)}" (pins: ${names.join(', ')})`,
    );
  }

  /**
   * Draws a polyline through the given points or pins, one wire per segment. Every segment must be
   * horizontal or vertical; repeated points are skipped.
   */
  wire(...points: WirePoint[]): this {
    this.addPath(this.straightPath(points), false);
    return this;
  }

  /**
   * Draws a bus line through the given points or bus pins (`BE1.B`), one segment each, like
   * `wire`. Bus lines connect only to bus lines and bus pins.
   */
  bus(...points: WirePoint[]): this {
    this.addPath(this.straightPath(points), true);
    return this;
  }

  /**
   * Connects two pins with an orthogonal route through optional `via` points. Where two
   * consecutive points are not aligned, the route goes horizontally first, then vertically.
   */
  connect(from: string, to: string, ...via: Point[]): this {
    const points = this.resolve([from, ...via, to]);
    const path: Point[] = [points[0]!];
    for (const p of points.slice(1)) {
      const last = path[path.length - 1]!;
      if (last[0] !== p[0] && last[1] !== p[1]) path.push([p[0], last[1]]);
      path.push(p);
    }
    this.addPath(path, false);
    return this;
  }

  /** Adds a probe for the Waveforms tab (`{ ref: 'CLK' }`, a group `{ name, members }`). */
  probe(probe: Probe): this {
    this.probes.push(probe);
    return this;
  }

  /** The circuit built so far (a snapshot; the builder can keep going). */
  build(): Circuit {
    return {
      id: this.id,
      name: this.name,
      components: [...this.components],
      wires: [...this.wires],
      probes: [...this.probes],
    };
  }

  /** The circuit wrapped in a document. */
  document(): CircuitDocument {
    return { schemaVersion: SCHEMA_VERSION, circuits: [this.build()] };
  }

  private straightPath(points: readonly WirePoint[]): Point[] {
    const path = this.resolve(points);
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1]!, path[i]!];
      if (!samePoint(a, b) && !isAxisAligned(a, b)) {
        throw new Error(`wire segment (${a}) → (${b}) is diagonal; add a corner point`);
      }
    }
    return path;
  }

  private addPath(path: readonly Point[], bus: boolean): void {
    for (let i = 1; i < path.length; i++) {
      const [from, to] = [path[i - 1]!, path[i]!];
      if (samePoint(from, to)) continue;
      let id = `w${this.nextWire++}`;
      while (this.ids.has(id)) id = `w${this.nextWire++}`;
      this.claim(id);
      this.wires.push(bus ? { id, from, to, bus } : { id, from, to });
    }
  }

  private resolve(points: readonly WirePoint[]): Point[] {
    if (points.length < 2) throw new Error('a wire needs at least two points');
    return points.map((p) => (typeof p === 'string' ? this.pin(p) : p));
  }

  private definition(type: string): AnyComponentDefinition {
    const definition = this.registry.get(type);
    if (!definition) throw new Error(`unknown part type "${type}"`);
    return definition;
  }

  private claim(id: string): void {
    if (!ID_PATTERN.test(id)) {
      throw new Error(`bad id "${id}" (a letter or _, then letters, digits, _ or -)`);
    }
    if (this.ids.has(id)) throw new Error(`duplicate id "${id}"`);
    this.ids.add(id);
  }
}
