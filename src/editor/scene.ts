/**
 * The scene: everything the renderer and hit-testing need about a circuit, precomputed once per
 * document change — each part's layout, placement, world bounds, placed pins with their nets and
 * text; wires with their nets; junction dots, unconnected pin ends, dangling wire ends and the
 * design issues. Pure (no DOM). Spec: docs/editor.md#scene.
 */
import {
  type Circuit,
  type CompileResult,
  type ComponentInstance,
  compileCircuit,
  type DesignIssue,
  type PartLayout,
  type Placement,
  type Point,
  partLayout,
  placementOf,
  type Rect,
  type Side,
  transformPoint,
  transformRect,
  transformSide,
} from '../circuit';
import {
  type AnyComponentDefinition,
  type ComponentRegistry,
  type PropValue,
  resolveProps,
  type SymbolDef,
  symbolOf,
} from '../core';
import { placeTextBlock, type SceneText, type TextLine, textSide } from './text-placement';

/** How a part is drawn. */
export type PartDrawing =
  | { readonly kind: 'symbol'; readonly symbol: SymbolDef }
  | { readonly kind: 'dip'; readonly pinCount: number }
  | { readonly kind: 'box' }
  /** The registry lacks the type, or the props are invalid: a marked placeholder. */
  | { readonly kind: 'broken'; readonly reason: string };

export interface ScenePin {
  readonly name: string;
  /** Connection point (tip of the stub), world. */
  readonly at: Point;
  /** Where the stub meets the body, world. */
  readonly base: Point;
  /** Side of the body after placement. */
  readonly side: Side;
  /** Net id (bus id for a bus pin); undefined for parts left out of the netlist. */
  readonly net?: string;
  /** The pin connects on the bus layer (bus entries' bus ends, bus labels). */
  readonly bus: boolean;
  /** Nothing else is connected to this pin. */
  readonly open: boolean;
}

export interface ScenePart {
  readonly id: string;
  readonly instance: ComponentInstance;
  readonly definition?: AnyComponentDefinition;
  /** Resolved props (raw props if they don't resolve). */
  readonly props: Readonly<Record<string, PropValue>>;
  readonly drawing: PartDrawing;
  /** Layout in local coordinates. */
  readonly layout: PartLayout;
  /** Local bounding box: body and pin tips. */
  readonly localBounds: Rect;
  readonly placement: Placement;
  /** World bounding box: body and pin tips. */
  readonly bounds: Rect;
  /** World body rectangle. */
  readonly body: Rect;
  readonly pins: readonly ScenePin[];
  readonly texts: readonly SceneText[];
}

export interface SceneWire {
  readonly id: string;
  readonly from: Point;
  readonly to: Point;
  /** Net id of a wire, bus id of a bus line (`CompileResult.buses`). */
  readonly net: string;
  /** A bus line. */
  readonly bus: boolean;
}

export interface Scene {
  readonly circuit: Circuit;
  readonly compiled: CompileResult;
  /** In document order (later parts draw on top). */
  readonly parts: readonly ScenePart[];
  readonly wires: readonly SceneWire[];
  readonly partById: ReadonlyMap<string, ScenePart>;
  readonly wireById: ReadonlyMap<string, SceneWire>;
  readonly junctions: readonly Point[];
  /** Junction dots of bus lines. */
  readonly busJunctions: readonly Point[];
  /** Wire and bus ends that touch nothing. */
  readonly danglingEnds: readonly Point[];
  readonly issues: readonly DesignIssue[];
  /** Bounding box of everything, or undefined for an empty circuit. */
  readonly bounds?: Rect;
}

/** Kinds whose text is the part's name placed opposite the pin (VCC above its bar). */
const RAIL_KINDS = new Set(['vcc', 'gnd']);

/** Placeholder size of a broken part, in cells. */
const BROKEN_LAYOUT: PartLayout = { body: { x: 0, y: 0, width: 4, height: 2 }, pins: [] };

/**
 * Layouts depend only on the definition and props, so they are cached across scene rebuilds.
 * Create one per editor. Keyed by the definition object, not its type: a subcircuit's generated
 * definition is replaced when its ports change (R11a), and its old layout must not be reused.
 */
export class LayoutCache {
  readonly #layouts = new WeakMap<AnyComponentDefinition, Map<string, PartLayout>>();

  get(definition: AnyComponentDefinition, props: Readonly<Record<string, PropValue>>): PartLayout {
    const key =
      typeof definition.pins === 'function' || typeof definition.symbol === 'function'
        ? JSON.stringify(props)
        : '';
    let layouts = this.#layouts.get(definition);
    if (!layouts) {
      layouts = new Map();
      this.#layouts.set(definition, layouts);
    }
    let layout = layouts.get(key);
    if (!layout) {
      layout = partLayout(definition, props);
      layouts.set(key, layout);
    }
    return layout;
  }
}

/** Builds the scene of a circuit; compiles it unless a compile result is given. */
export function buildScene(
  circuit: Circuit,
  registry: ComponentRegistry,
  options: { compiled?: CompileResult; layouts?: LayoutCache } = {},
): Scene {
  const compiled = options.compiled ?? compileCircuit(circuit, registry);
  const layouts = options.layouts ?? new LayoutCache();

  const pinNet = new Map<string, string>();
  for (const net of compiled.nets) {
    for (const pin of net.pins) pinNet.set(`${pin.component}.${pin.pin}`, net.id);
    for (const pin of net.schematicPins) pinNet.set(`${pin.component}.${pin.pin}`, net.id);
    for (const pin of net.instancePins) pinNet.set(`${pin.component}.${pin.pin}`, net.id);
  }
  const busPins = new Set<string>();
  for (const bus of compiled.buses) {
    for (const pin of bus.pins) {
      const key = `${pin.component}.${pin.pin}`;
      pinNet.set(key, bus.id);
      busPins.add(key);
    }
  }

  const parts = circuit.components.map((instance) =>
    buildPart(instance, registry, layouts, { pinNet, busPins, openPins: compiled.openPins }),
  );
  const wires = circuit.wires.map((wire): SceneWire => {
    const bus = wire.bus === true;
    const net = (bus ? compiled.wireBuses : compiled.wireNets).get(wire.id) ?? wire.id;
    return { id: wire.id, from: wire.from, to: wire.to, net, bus };
  });
  const danglingEnds = compiled.issues.flatMap((issue) =>
    issue.code === 'dangling-wire' && issue.at ? [issue.at] : [],
  );

  return {
    circuit,
    compiled,
    parts,
    wires,
    partById: new Map(parts.map((part) => [part.id, part])),
    wireById: new Map(wires.map((wire) => [wire.id, wire])),
    junctions: compiled.junctions,
    busJunctions: compiled.busJunctions,
    danglingEnds,
    issues: compiled.issues,
    ...optional('bounds', sceneBounds(parts, wires)),
  };
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function buildPart(
  instance: ComponentInstance,
  registry: ComponentRegistry,
  layouts: LayoutCache,
  pinsOf: {
    readonly pinNet: ReadonlyMap<string, string>;
    readonly busPins: ReadonlySet<string>;
    readonly openPins: ReadonlySet<string>;
  },
): ScenePart {
  const { pinNet, busPins, openPins } = pinsOf;
  const placement = placementOf(instance);
  const definition = registry.get(instance.type);
  let props: Readonly<Record<string, PropValue>> = instance.props;
  let drawing: PartDrawing;
  let layout = BROKEN_LAYOUT;
  if (!definition) {
    drawing = { kind: 'broken', reason: `unknown part type "${instance.type}"` };
  } else {
    try {
      props = resolveProps(definition, instance.props, instance.id);
      layout = layouts.get(definition, props);
      drawing = drawingOf(definition, props);
    } catch (error) {
      drawing = { kind: 'broken', reason: (error as Error).message };
    }
  }

  const localBounds = layoutBounds(layout);
  const pins = layout.pins.map((pin): ScenePin => {
    const key = `${instance.id}.${pin.name}`;
    const net = pinNet.get(key);
    return {
      name: pin.name,
      at: transformPoint(pin.at, placement),
      base: transformPoint(stubBase(pin.at, pin.side), placement),
      side: transformSide(pin.side, placement),
      ...(net !== undefined && { net }),
      bus: busPins.has(key),
      open: openPins.has(key),
    };
  });
  const bounds = transformRect(localBounds, placement);
  return {
    id: instance.id,
    instance,
    ...(definition && { definition }),
    props,
    drawing,
    layout,
    localBounds,
    placement,
    bounds,
    body: transformRect(layout.body, placement),
    pins,
    texts: partTexts(instance, definition, drawing, pins, bounds),
  };
}

function drawingOf(
  definition: AnyComponentDefinition,
  props: Readonly<Record<string, PropValue>>,
): PartDrawing {
  if (definition.package) return { kind: 'dip', pinCount: definition.package.pins };
  const symbol = symbolOf(definition, props);
  return symbol ? { kind: 'symbol', symbol } : { kind: 'box' };
}

/** The point one cell from the tip towards the body. */
function stubBase(tip: Point, side: Side): Point {
  switch (side) {
    case 'left':
      return [tip[0] + 1, tip[1]];
    case 'right':
      return [tip[0] - 1, tip[1]];
    case 'top':
      return [tip[0], tip[1] + 1];
    case 'bottom':
      return [tip[0], tip[1] - 1];
  }
}

/** Smallest rectangle containing the body and every pin tip. */
export function layoutBounds(layout: PartLayout): Rect {
  const { body } = layout;
  let x0 = body.x;
  let y0 = body.y;
  let x1 = body.x + body.width;
  let y1 = body.y + body.height;
  for (const { at } of layout.pins) {
    x0 = Math.min(x0, at[0]);
    y0 = Math.min(y0, at[1]);
    x1 = Math.max(x1, at[0]);
    y1 = Math.max(y1, at[1]);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Symbol kinds drawn without a designator or label beside them. */
const UNLABELED_KINDS: ReadonlySet<string> = new Set(['net-label', 'bus-entry', 'port', 'text']);

function partTexts(
  instance: ComponentInstance,
  definition: AnyComponentDefinition | undefined,
  drawing: PartDrawing,
  pins: readonly ScenePin[],
  bounds: Rect,
): SceneText[] {
  const symbolKind = drawing.kind === 'symbol' ? drawing.symbol.kind : undefined;
  // Net labels, bus entries and ports show their names, texts are their text; their
  // designators are never drawn.
  if (symbolKind !== undefined && UNLABELED_KINDS.has(symbolKind)) return [];
  if (definition && symbolKind !== undefined && RAIL_KINDS.has(symbolKind)) {
    const lines: TextLine[] = [{ text: instance.label ?? definition.name, role: 'name' }];
    return placeTextBlock(lines, bounds, textSide([], pins[0]?.side));
  }
  const lines: TextLine[] = [{ text: instance.id, role: 'designator' }];
  if (instance.label) lines.push({ text: instance.label, role: 'label' });
  return placeTextBlock(lines, bounds, textSide(pins.map((pin) => pin.side)));
}

function sceneBounds(parts: readonly ScenePart[], wires: readonly SceneWire[]): Rect | undefined {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const { bounds: b, texts } of parts) {
    add(b.x, b.y);
    add(b.x + b.width, b.y + b.height);
    // Text sticks out of the box; include its anchors with a margin for its size.
    for (const t of texts) {
      add(t.at[0] - t.size, t.at[1] - t.size);
      add(t.at[0] + t.size, t.at[1] + t.size);
    }
  }
  for (const { from, to } of wires) {
    add(from[0], from[1]);
    add(to[0], to[1]);
  }
  return x0 === Number.POSITIVE_INFINITY
    ? undefined
    : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
