import { describe, expect, it } from 'vitest';
import { pinsOf, Registry, resolveProps, symbolOf } from '../core';
import { compileCircuit } from './compile';
import {
  type Circuit,
  type CircuitDocument,
  type ComponentInstance,
  SCHEMA_VERSION,
  type Wire,
} from './document';
import { partLayout, placementOf, placePins } from './layout';
import {
  circuitPorts,
  DocumentRegistry,
  documentRegistry,
  subcircuitDefinition,
  subcircuitOf,
  subcircuitType,
} from './subcircuit';
import { testRegistry } from './test-parts';

const library = testRegistry();

function part(
  id: string,
  type: string,
  x: number,
  y: number,
  props: Record<string, string> = {},
): ComponentInstance {
  return { id, type, x, y, rotation: 0, flip: false, props };
}

const port = (id: string, name: string, x: number, y: number, direction = 'in', side = 'auto') =>
  part(id, 'test/port', x, y, { name, direction, side });

const circuit = (
  id: string,
  components: ComponentInstance[],
  wires: Wire[] = [],
  name = id.toUpperCase(),
): Circuit => ({ id, name, components, wires, probes: [] });

const doc = (...circuits: Circuit[]): CircuitDocument => ({
  schemaVersion: SCHEMA_VERSION,
  circuits,
});

/** A module with inputs A, B (left), output Y (right), drawn as an AND gate between them. */
const gate = () =>
  circuit(
    'gate',
    [
      part('U1', 'test/and', 10, 0),
      port('P1', 'A', 10, 1),
      port('P2', 'B', 10, 2),
      port('P3', 'Y', 15, 1, 'out'),
    ],
    [],
    'Gate',
  );

describe('subcircuit types', () => {
  it('name a circuit in the reserved sub family', () => {
    expect(subcircuitType('decade-counter')).toBe('sub/decade-counter');
    expect(subcircuitOf('sub/decade-counter')).toBe('decade-counter');
    expect(subcircuitOf('test/and')).toBeUndefined();
    expect(subcircuitOf('subway/x')).toBeUndefined();
  });
});

describe('circuitPorts', () => {
  it('orders ports by side, then as drawn: down the left and right, across top and bottom', () => {
    const ports = circuitPorts(
      circuit('m', [
        port('P1', 'B', 0, 5),
        port('P2', 'Y', 0, 0, 'out'),
        port('P3', 'A', 3, 2),
        port('P4', 'EN', 9, 0, 'in', 'top'),
        port('P5', 'CLK', 4, 0, 'in', 'top'),
        port('P6', 'D', 0, 9, 'bidir'),
        port('P7', 'CO', 0, 9, 'out', 'bottom'),
      ]),
      library,
    );
    expect(ports.map((p) => [p.name, p.side])).toEqual([
      ['A', 'left'],
      ['B', 'left'],
      ['Y', 'right'],
      ['D', 'right'], // bidirectional ports go right
      ['CLK', 'top'],
      ['EN', 'top'],
      ['CO', 'bottom'],
    ]);
    expect(ports[0]).toEqual({
      component: 'P3',
      name: 'A',
      direction: 'in',
      side: 'left',
      bus: false,
      at: [3, 2],
    });
  });

  it('leaves out a port giving a name an earlier one gives, and broken ports', () => {
    const ports = circuitPorts(
      circuit('m', [
        port('P1', 'D[0..3]', 0, 0, 'bidir'),
        port('P2', 'D2', 0, 4),
        port('P3', 'D2', 0, 6, 'sideways'),
        port('P4', 'CLK', 0, 8),
        port('P5', 'CLK', 0, 10, 'out'),
        part('U1', 'test/and', 20, 0),
      ]),
      library,
    );
    expect(ports.map((p) => [p.component, p.name, p.bus])).toEqual([
      ['P4', 'CLK', false],
      ['P1', 'D[0..3]', true],
    ]);
  });
});

describe('subcircuitDefinition', () => {
  const definitionOf = (c: Circuit) => subcircuitDefinition(c, circuitPorts(c, library));

  it('has a pin per port, an A designator and no behavior', () => {
    const definition = definitionOf(gate());
    expect(definition.type).toBe('sub/gate');
    expect(definition.name).toBe('Gate');
    expect(definition.title).toBe('Subcircuit: A, B → Y');
    expect(definition.designatorPrefix).toBe('A');
    expect(pinsOf(definition, {})).toEqual([
      { name: 'A', dir: 'in', description: 'input port A' },
      { name: 'B', dir: 'in', description: 'input port B' },
      { name: 'Y', dir: 'out', description: 'output port Y' },
    ]);
    expect(() => definition.create({})).toThrow('a subcircuit is flattened, never simulated');
  });

  it('makes a bus port a bus pin and a bidirectional port a bidir pin', () => {
    const definition = definitionOf(
      circuit('m', [port('P1', 'Q[0..3]', 0, 0, 'out'), port('P2', 'D', 0, 2, 'bidir')]),
    );
    expect(pinsOf(definition, {})).toEqual([
      { name: 'Q[0..3]', dir: 'nc', bus: true, description: 'output bus port Q[0..3]' },
      { name: 'D', dir: 'bidir', description: 'bidirectional port D' },
    ]);
    expect(definition.title).toBe('Subcircuit: Q[0..3] ↔ D');
  });

  it('labels an overlined name with marks, so pins draw it overlined', () => {
    const c: Circuit = circuit('m', []);
    const definition = subcircuitDefinition(c, [
      { component: 'P1', name: '~{CLR}', direction: 'in', side: 'left', bus: false, at: [0, 0] },
    ]);
    expect(pinsOf(definition, {})[0]!.label).toBe('C̅L̅R̅');
  });

  it('draws a box: title row first, side pins below it, top and bottom pins across', () => {
    const definition = definitionOf(
      circuit('m', [
        port('P1', 'A', 0, 0),
        port('P2', 'B', 0, 1),
        port('P3', 'Y', 0, 0, 'out'),
        port('P4', 'CLK', 0, 0, 'in', 'top'),
        port('P5', 'CO', 0, 0, 'out', 'bottom'),
      ]),
    );
    const symbol = symbolOf(definition, {})!;
    expect(symbol).toMatchObject({ kind: 'subcircuit', width: 4 });
    // CLK reads down from the top edge: 3 characters need 2 rows; CO 2 rows at the bottom.
    expect(symbol.pins).toEqual({
      A: { side: 'left', offset: 4 },
      B: { side: 'left', offset: 5 },
      Y: { side: 'right', offset: 4 },
      CLK: { side: 'top', offset: 2 },
      CO: { side: 'bottom', offset: 2 },
    });
    expect(symbol.height).toBe(2 + 2 + 2 + 2);
    // The registry's own validation: pins on the body's edge, never two on one point.
    expect(() => new Registry([definition])).not.toThrow();
  });

  it('grows with its names and its title, and keeps a box for a circuit without ports', () => {
    const wide = definitionOf(
      circuit(
        'm',
        [port('P1', 'ADDRESS', 0, 0), port('P2', 'DATA[0..7]', 0, 0, 'bidir')],
        [],
        'Memory Module',
      ),
    );
    const symbol = symbolOf(wide, {})!;
    expect(symbol.width).toBeGreaterThanOrEqual(Math.ceil((7 + 10) * 0.33 + 1.5));
    const empty = definitionOf(circuit('m', [], [], 'X'));
    expect(empty.symbol).toEqual({ kind: 'subcircuit', width: 4, height: 2, pins: {} });
    expect(empty.title).toBe('Subcircuit without ports');
  });
});

describe('DocumentRegistry', () => {
  const top = circuit('main', [part('A1', 'sub/gate', 0, 0)]);

  it('serves the library and a definition per circuit', () => {
    const registry = documentRegistry(doc(top, gate()), library);
    expect(registry.get('test/and')).toBe(library.get('test/and'));
    expect(registry.get('sub/gate')!.name).toBe('Gate');
    expect(registry.get('sub/main')!.pins).toEqual([]);
    expect(registry.get('sub/nothing')).toBeUndefined();
    expect(registry.has('sub/gate')).toBe(true);
    expect(
      registry
        .list()
        .slice(0, 2)
        .map((d) => d.type),
    ).toEqual(['sub/main', 'sub/gate']);
    expect(registry.list()).toHaveLength(library.list().length + 2);
    expect(registry.circuitOf('sub/gate')).toBe(registry.document.circuits[1]);
    expect(registry.circuitOf('test/and')).toBeUndefined();
  });

  it('keeps a definition while its name and ports stay, and makes a new one when they change', () => {
    const first = documentRegistry(doc(top, gate()), library);
    const definition = first.get('sub/gate');
    // An edit that leaves the ports alone: another part inside.
    const edited = { ...gate(), components: [...gate().components, part('U2', 'test/and', 30, 0)] };
    const second = documentRegistry(doc(top, edited), library, first);
    expect(second.get('sub/gate')).toBe(definition);
    // A port renamed, or the circuit renamed: a new definition.
    const renamedPort = {
      ...gate(),
      components: gate().components.map((c) =>
        c.id === 'P3' ? { ...c, props: { ...c.props, name: 'Q' } } : c,
      ),
    };
    expect(documentRegistry(doc(top, renamedPort), library, second).get('sub/gate')).not.toBe(
      definition,
    );
    expect(
      documentRegistry(doc(top, { ...gate(), name: 'AND' }), library, second).get('sub/gate')!.name,
    ).toBe('AND');
  });

  it('builds on the library of a document registry it is given', () => {
    const first = new DocumentRegistry(doc(top), library);
    expect(new DocumentRegistry(doc(top, gate()), first).library).toBe(library);
  });
});

describe('instances in a compiled circuit', () => {
  const registry = documentRegistry(doc(top(), gate()), library);
  function top(components: ComponentInstance[] = [], wires: Wire[] = []): Circuit {
    return circuit('main', [part('A1', 'sub/gate', 0, 0), ...components], wires);
  }
  const pinAt = (c: Circuit, ref: string) => {
    const [id, pin] = ref.split('.') as [string, string];
    const instance = c.components.find((x) => x.id === id)!;
    const definition = registry.get(instance.type)!;
    const props = resolveProps(definition, instance.props);
    const placed = placePins(partLayout(definition, props), placementOf(instance));
    return placed.find((p) => p.name === pin)!.at;
  };

  it('connect their pins but stay out of the netlist', () => {
    const c = top([part('H1', 'test/high', -20, 0)]);
    const [x, y] = pinAt(c, 'A1.A');
    const wired = top(
      [part('H1', 'test/high', -20, 0)],
      [
        { id: 'w1', from: [-15, 1], to: [-15, y] },
        { id: 'w2', from: [-15, y], to: [x, y] },
      ],
    );
    const result = compileCircuit(wired, registry);
    expect(result.netlist.components.map((c) => c.id)).toEqual(['H1']);
    const net = result.nets.find((n) => n.instancePins.some((p) => p.pin === 'A'))!;
    expect(net.id).toBe('H1.Y');
    expect(net.pins.map((p) => p.component)).toEqual(['H1']);
    expect(net.instancePins).toEqual([
      expect.objectContaining({ component: 'A1', pin: 'A', instance: true }),
    ]);
    expect(result.netlist.nets.flatMap((n) => n.pins.map((p) => p.component))).not.toContain('A1');
  });

  it('report an unconnected instance input, never an instance output as shorted', () => {
    const result = compileCircuit(top([part('A2', 'sub/gate', 0, 20)]), registry);
    expect(result.issues.map((i) => i.message)).toEqual([
      'input A1.A is not connected (reads as X)',
      'input A1.B is not connected (reads as X)',
      'input A2.A is not connected (reads as X)',
      'input A2.B is not connected (reads as X)',
    ]);
    // Both outputs on one wire: what drives them is inside; the kernel reports a real fight.
    const y1 = pinAt(top(), 'A1.Y');
    const twoOut = top(
      [part('A2', 'sub/gate', 0, 20)],
      [
        { id: 'w1', from: y1, to: [y1[0] + 2, y1[1]] },
        { id: 'w2', from: [y1[0] + 2, y1[1]], to: [y1[0] + 2, y1[1] + 20] },
        { id: 'w3', from: [y1[0] + 2, y1[1] + 20], to: [y1[0], y1[1] + 20] },
      ],
    );
    expect(compileCircuit(twoOut, registry).issues.map((i) => i.code)).not.toContain(
      'shorted-outputs',
    );
  });

  it('let an instance output drive an input, and name such a net by the output', () => {
    const c = top([part('U1', 'test/and', 40, 0)]);
    const [x, y] = pinAt(c, 'A1.Y');
    const wired = top(
      [part('U1', 'test/and', 40, y - 1)],
      [{ id: 'w1', from: [x, y], to: [40, y] }],
    );
    const result = compileCircuit(wired, registry);
    const net = result.nets.find((n) => n.wires.length > 0)!;
    expect(net.id).toBe('A1.Y');
    expect(result.issues.filter((i) => i.pin === 'A' && i.component === 'U1')).toEqual([]);
  });

  it('make the members of a bus at their bus pin names a label may rely on', () => {
    // `reg` has the bus port D[0..1]; the top runs a bus named X[0..1] from A1's bus pin and
    // names X0 once, by a label: it joins A1's bit 0, so it is no lone label.
    const reg = circuit('reg', [port('P1', 'D[0..1]', 0, 0)]);
    const shell = circuit('main', [part('A1', 'sub/reg', 0, 0)]);
    const docRegistry = documentRegistry(doc(shell, reg), library);
    const definition = docRegistry.get('sub/reg')!;
    const at = placePins(partLayout(definition, {}), placementOf(shell.components[0]!))[0]!.at;
    const top = circuit(
      'main',
      [
        part('A1', 'sub/reg', 0, 0),
        part('BL1', 'test/bus-label', at[0] + 4, at[1], { name: 'X[0..1]' }),
        part('NL1', 'test/label', 30, 30, { name: 'X0' }),
      ],
      [{ id: 'b1', from: at, to: [at[0] + 4, at[1]], bus: true }],
    );
    expect(compileCircuit(top, docRegistry).issues).toEqual([]);
  });

  it('drive the members of a bus at an output bus port, not at an input one', () => {
    const undriven = (direction: string) => {
      const reg = circuit('reg', [port('P1', 'D[0..1]', 0, 0, direction)]);
      const shell = circuit('main', [part('A1', 'sub/reg', 0, 0)]);
      const docRegistry = documentRegistry(doc(shell, reg), library);
      const definition = docRegistry.get('sub/reg')!;
      const at = placePins(partLayout(definition, {}), placementOf(shell.components[0]!))[0]!.at;
      // X0 reaches an AND gate's inputs by labels; X1 nothing.
      const top = circuit(
        'main',
        [
          part('A1', 'sub/reg', 0, 0),
          part('BL1', 'test/bus-label', at[0] + 4, at[1], { name: 'X[0..1]' }),
          part('U1', 'test/and', 30, 30),
          part('NL1', 'test/label', 30, 31, { name: 'X0' }),
          part('NL2', 'test/label', 30, 32, { name: 'X0' }),
        ],
        [{ id: 'b1', from: at, to: [at[0] + 4, at[1]], bus: true }],
      );
      return compileCircuit(top, docRegistry).issues.filter((i) => i.code === 'undriven-input')
        .length;
    };
    expect(undriven('out')).toBe(0);
    expect(undriven('bidir')).toBe(0);
    expect(undriven('in')).toBe(2);
  });

  it('are an unknown type when their circuit is missing', () => {
    const result = compileCircuit(circuit('main', [part('A1', 'sub/gone', 0, 0)]), registry);
    expect(result.issues.map((i) => i.code)).toEqual(['unknown-type']);
  });
});
