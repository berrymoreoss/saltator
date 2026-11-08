import { describe, expect, it } from 'vitest';
import { defineComponent, levelChar, Registry, Simulator, sameNetlistStructure } from '../core';
import { compileCircuit } from './compile';
import { CompileCache, compileDesign } from './design';
import {
  type Circuit,
  type CircuitDocument,
  type ComponentInstance,
  SCHEMA_VERSION,
  type Wire,
} from './document';
import { partLayout, placementOf, placePins } from './layout';
import { documentRegistry } from './subcircuit';
import { testRegistry } from './test-parts';

const library = testRegistry();

// Pin positions of test parts placed at (x, y):
//   test/and: A (x, y+1), B (x, y+2), Y (x+5, y+1)   test/high, test/hi: Y (x+5, y+1)
//   test/label, test/port, test/bus-label: their pin at (x, y)
//   test/bus-entry: N (x, y), B (x+3, y+1)

function part(
  id: string,
  type: string,
  x: number,
  y: number,
  props: Record<string, string> = {},
): ComponentInstance {
  return { id, type, x, y, rotation: 0, flip: false, props };
}
const label = (id: string, name: string, x: number, y: number) =>
  part(id, 'test/label', x, y, { name });
const port = (id: string, name: string, x: number, y: number, direction = 'in') =>
  part(id, 'test/port', x, y, { name, direction });
const circuit = (id: string, components: ComponentInstance[], wires: Wire[] = []): Circuit => ({
  id,
  name: id.toUpperCase(),
  components,
  wires,
  probes: [],
});
const doc = (...circuits: Circuit[]): CircuitDocument => ({
  schemaVersion: SCHEMA_VERSION,
  circuits,
});

/** `gate`: an AND gate between ports A, B (inputs) and Y (output). */
const gate = circuit('gate', [
  part('U1', 'test/and', 10, 0),
  port('P1', 'A', 10, 1),
  port('P2', 'B', 10, 2),
  port('P3', 'Y', 15, 1, 'out'),
]);

/** Where pin `ref` (`A1.A`) of a part of `top` is, with the document's subcircuits. */
function pinAt(document: CircuitDocument, top: Circuit, ref: string): [number, number] {
  const dot = ref.indexOf('.');
  const [id, pin] = [ref.slice(0, dot), ref.slice(dot + 1)];
  const registry = documentRegistry(document, library);
  const instance = top.components.find((c) => c.id === id)!;
  const definition = registry.get(instance.type)!;
  const placed = placePins(partLayout(definition, {}), placementOf(instance));
  return placed.find((p) => p.name === pin)!.at as [number, number];
}

/** Adds net labels named `name` at the given pins of the top circuit (its first). */
function labelPins(document: CircuitDocument, joins: Record<string, string[]>): CircuitDocument {
  const top = document.circuits[0]!;
  const labels = Object.entries(joins).flatMap(([name, refs]) =>
    refs.map((ref, i) => {
      const [x, y] = pinAt(document, top, ref);
      return label(`NL${name}${i}`, name, x, y);
    }),
  );
  return doc({ ...top, components: [...top.components, ...labels] }, ...document.circuits.slice(1));
}

/** Levels of the flattened design after it settles, by pin (`A2/U1.Y`). */
function levels(document: CircuitDocument, pins: string[]): string[] {
  const design = compileDesign(document, library);
  const sim = new Simulator(design.netlist, design.registry);
  sim.settle();
  return pins.map((ref) => {
    const dot = ref.lastIndexOf('.');
    return levelChar(sim.pinLevel(ref.slice(0, dot), ref.slice(dot + 1)));
  });
}

describe('compileDesign', () => {
  it('is the top circuit compiled when there are no instances', () => {
    const top = circuit('main', [
      part('H1', 'test/high', 0, 0),
      part('U1', 'test/and', 5, 0),
      label('NL1', 'CLK', 0, 30),
      // Two names on one net, the second a rail's: still called CLK, as compiled alone.
      label('NL2', 'CLK', 9, 30),
      label('NL3', 'HI', 9, 30),
    ]);
    const design = compileDesign(doc(top, gate), library);
    const alone = compileCircuit(top, library);
    expect(design.netlist).toEqual(alone.netlist);
    expect(design.instances).toEqual([]);
    expect(design.top).toBe('main');
    expect(design.issues.filter((i) => i.circuit === 'main')).toEqual(
      alone.issues.map((i) => ({ ...i, circuit: 'main' })),
    );
    expect(design.circuits.get('gate')!.netlist.components.map((c) => c.id)).toEqual(['U1']);
  });

  it('flattens instances by path and joins their ports to the outer nets', () => {
    const top = circuit('main', [
      part('H1', 'test/high', 0, 0),
      part('A1', 'sub/gate', 20, 0),
      part('A2', 'sub/gate', 40, 0),
    ]);
    const document = labelPins(doc(top, gate), {
      HIGH: ['H1.Y', 'A1.A', 'A1.B', 'A2.A'],
      LINK: ['A1.Y', 'A2.B'],
    });
    const design = compileDesign(document, library);
    expect(design.netlist.components.map((c) => c.id)).toEqual(['H1', 'A1/U1', 'A2/U1']);
    const net = (id: string) => design.netlist.nets.find((n) => n.id === id)!;
    expect(net('HIGH').pins).toEqual([
      { component: 'H1', pin: 'Y' },
      { component: 'A1/U1', pin: 'A' },
      { component: 'A1/U1', pin: 'B' },
      { component: 'A2/U1', pin: 'A' },
    ]);
    // A net joined through a port is called by its outer id.
    expect(net('LINK').pins).toEqual([
      { component: 'A1/U1', pin: 'Y' },
      { component: 'A2/U1', pin: 'B' },
    ]);
    expect(design.instances).toEqual([
      { path: 'A1', designator: 'A1', parent: '', circuit: 'gate' },
      { path: 'A2', designator: 'A2', parent: '', circuit: 'gate' },
    ]);
    expect(levels(document, ['A1/U1.Y', 'A2/U1.Y'])).toEqual(['1', '1']);
  });

  it('keeps labels local to each instance, and power names global', () => {
    // `inner`: U1.Y joins U2.A by the label N; U1's inputs and U2.B on HI by labels. N is
    // what labels are called by default: a label's name never becomes global.
    const inner = circuit('inner', [
      part('U1', 'test/and', 0, 0),
      part('U2', 'test/and', 0, 10),
      label('NL1', 'N', 5, 1),
      label('NL2', 'N', 0, 11),
      label('NL3', 'HI', 0, 1),
      label('NL4', 'HI', 0, 2),
      label('NL5', 'HI', 0, 12),
      port('P1', 'OUT', 5, 11, 'out'),
    ]);
    const top = circuit('main', [
      part('R1', 'test/hi', 0, 0),
      part('A1', 'sub/inner', 20, 0),
      part('A2', 'sub/inner', 20, 20),
      label('NL1', 'N', 50, 50),
    ]);
    const design = compileDesign(doc(top, inner), library);
    const ids = design.netlist.nets.map((n) => n.id);
    expect(ids).toContain('A1/N');
    expect(ids).toContain('A2/N');
    expect(ids).toContain('N'); // the top's own N, joined to neither
    expect(design.netlist.nets.find((n) => n.id === 'N')!.pins).toEqual([]);
    // HI is a rail's name: the labels inside both instances are the top's HI.
    expect(design.netlist.nets.find((n) => n.id === 'HI')!.pins.map((p) => p.component)).toEqual([
      'R1',
      'A1/U1',
      'A1/U1',
      'A1/U2',
      'A2/U1',
      'A2/U1',
      'A2/U2',
    ]);
    expect(design.netOf('A1', 'N')).toBe('A1/N');
    expect(design.netOf('A2', 'HI')).toBe('HI');
    expect(design.netOf('', 'HI')).toBe('HI');
    expect(design.netOf('A9', 'N')).toBeUndefined();
    expect(levels(doc(top, inner), ['A1/U2.Y', 'A2/U2.Y'])).toEqual(['1', '1']);
  });

  it('keeps a top-level name that looks like a path apart from the instance’s net', () => {
    // A label that takes any name, `/` included (real net labels do).
    const anyLabel = defineComponent<{ name: string }, undefined>({
      type: 'test/any-label',
      name: 'LABEL',
      title: 'Test label with any name',
      schematicOnly: true,
      props: [{ key: 'name', label: 'Name', type: 'string', default: 'N' }],
      pins: ({ name }) => [{ name: 'N', dir: 'nc', net: name }],
      symbol: { kind: 'label', width: 2, height: 1, pins: { N: { side: 'left', offset: 0 } } },
      create: () => ({}),
    });
    const registry = new Registry([...library.list(), anyLabel]);
    const inner = circuit('inner', [part('U1', 'test/and', 0, 0), label('NL1', 'X', 5, 1)]);
    const top = circuit('main', [
      part('A1', 'sub/inner', 0, 0),
      part('U1', 'test/and', 20, 0),
      part('NL1', 'test/any-label', 25, 1, { name: 'A1/X' }),
    ]);
    const design = compileDesign(doc(top, inner), registry);
    const net = (id: string) => design.netlist.nets.find((n) => n.id === id)?.pins;
    expect(net('A1/X')).toEqual([{ component: 'U1', pin: 'Y' }]);
    expect(net('A1/X#2')).toEqual([{ component: 'A1/U1', pin: 'Y' }]);
    expect(design.netOf('A1', 'X')).toBe('A1/X#2');
  });

  it('names a net only inside an instance by its path, one through an open pin by the pin', () => {
    const design = compileDesign(
      doc(circuit('main', [part('A1', 'sub/gate', 0, 0)]), gate),
      library,
    );
    // Each open instance pin is a net of the top's (`A1.Y`), the outermost id of its port's net.
    expect(design.netlist.nets.map((n) => n.id)).toEqual(['A1.A', 'A1.B', 'A1.Y']);
    expect(design.netOf('A1', 'Y')).toBe('A1.Y');
    // A net with no port is the instance's own: `A1/<local id>`.
    const inner = { ...gate, components: [...gate.components, part('U2', 'test/and', 30, 0)] };
    const nested = compileDesign(
      doc(circuit('main', [part('A1', 'sub/gate', 0, 0)]), inner),
      library,
    );
    expect(nested.netlist.nets.map((n) => n.id)).toContain('A1/U2.Y');
    expect(nested.netOf('A1', 'U2.Y')).toBe('A1/U2.Y');
  });

  it('flattens nested instances with nested paths', () => {
    const pair = circuit('pair', [
      part('A1', 'sub/gate', 0, 0),
      part('A2', 'sub/gate', 0, 20),
      port('P1', 'IN', 0, 40),
    ]);
    const pairDoc = doc(circuit('main', [part('A1', 'sub/pair', 0, 0)]), pair, gate);
    // Inside `pair`, IN feeds both gates' A inputs by labels at their pins.
    const pairLabels = ['A1.A', 'A2.A'].map((ref, i) => {
      const [x, y] = pinAt(pairDoc, pair, ref);
      return label(`NL${i}`, 'IN', x, y);
    });
    const document = doc(
      circuit('main', [part('H1', 'test/high', 0, 0), part('A1', 'sub/pair', 20, 0)]),
      { ...pair, components: [...pair.components, ...pairLabels] },
      gate,
    );
    const linked = labelPins(document, { HIGH: ['H1.Y', 'A1.IN'] });
    const design = compileDesign(linked, library);
    expect(design.netlist.components.map((c) => c.id)).toEqual(['H1', 'A1/A1/U1', 'A1/A2/U1']);
    expect(design.instances.map((i) => [i.path, i.parent, i.circuit])).toEqual([
      ['A1', '', 'pair'],
      ['A1/A1', 'A1', 'gate'],
      ['A1/A2', 'A1', 'gate'],
    ]);
    expect(design.circuitAt('A1/A2')).toBe('gate');
    expect(design.circuitAt('')).toBe('main');
    expect(design.circuitAt('A1/A3')).toBeUndefined();
    expect(design.netOf('A1/A2', 'A')).toBe('HIGH');
    expect(design.netlist.nets.find((n) => n.id === 'HIGH')!.pins).toEqual([
      { component: 'H1', pin: 'Y' },
      { component: 'A1/A1/U1', pin: 'A' },
      { component: 'A1/A2/U1', pin: 'A' },
    ]);
  });

  it('joins a bus port to the outer bus bit by bit, also between two instances', () => {
    // `reg`: the bus port D[0..1] on a bus line with entries D0 → U1.A, D1 → U1.B.
    const reg = circuit(
      'reg',
      [
        part('U1', 'test/and', 0, 0),
        part('BE1', 'test/bus-entry', 0, 1),
        part('BE2', 'test/bus-entry', 0, 2),
        port('P1', 'D[0..1]', 3, 6),
      ],
      [{ id: 'b1', from: [3, 2], to: [3, 6], bus: true }],
    );
    // In the top, a bus named X[0..1] runs from A1's bus pin to A2's; nothing else names X0.
    const shell = doc(
      circuit('main', [part('A1', 'sub/reg', 0, 0), part('A2', 'sub/reg', 0, 20)]),
      {
        ...reg,
        components: reg.components.map((c) =>
          c.id === 'BE1' || c.id === 'BE2'
            ? { ...c, props: { name: c.id === 'BE1' ? 'D0' : 'D1' } }
            : c,
        ),
      },
    );
    const top = shell.circuits[0]!;
    const a = pinAt(shell, top, 'A1.D[0..1]');
    const b = pinAt(shell, top, 'A2.D[0..1]');
    const bus = (id: string, from: [number, number], to: [number, number]): Wire => ({
      id,
      from,
      to,
      bus: true,
    });
    const wired = (name: string) =>
      doc(
        {
          ...top,
          components: [...top.components, part('BL1', 'test/bus-label', a[0] - 4, a[1], { name })],
          wires: [
            bus('b1', a, [a[0] - 4, a[1]]),
            bus('b2', [a[0] - 4, a[1]], [a[0] - 4, b[1]]),
            bus('b3', [a[0] - 4, b[1]], b),
          ],
        },
        shell.circuits[1]!,
      );
    // An open bus pin warns about nothing.
    expect(compileDesign(shell, library).issues.filter((i) => i.code === 'bus-port-width')).toEqual(
      [],
    );
    const design = compileDesign(wired('X[0..1]'), library);
    const pinsOf = (id: string) => design.netlist.nets.find((n) => n.id === id)?.pins;
    expect(pinsOf('X0')).toEqual([
      { component: 'A1/U1', pin: 'A' },
      { component: 'A2/U1', pin: 'A' },
    ]);
    expect(pinsOf('X1')).toEqual([
      { component: 'A1/U1', pin: 'B' },
      { component: 'A2/U1', pin: 'B' },
    ]);
    expect(design.issues.filter((i) => i.code === 'bus-port-width')).toEqual([]);

    // Three bits outside: bit 2 has nothing inside to join.
    const wide = compileDesign(wired('X[0..2]'), library);
    expect(wide.issues.filter((i) => i.code === 'bus-port-width')).toEqual([
      {
        severity: 'warning',
        code: 'bus-port-width',
        message: "bus port A1.D[0..1] has 2 bits, its bus X[0..2] 3: bits 2 and up don't connect",
        component: 'A1',
        pin: 'D[0..1]',
        at: a,
        circuit: 'main',
      },
      expect.objectContaining({ component: 'A2' }),
    ]);
    expect(wide.netlist.nets.find((n) => n.id === 'X0')!.pins).toHaveLength(2);

    // No name: nothing joins, and the warning says why.
    const unnamed = doc(
      { ...wired('X[0..1]').circuits[0]!, components: top.components },
      shell.circuits[1]!,
    );
    const message = compileDesign(unnamed, library).issues.find(
      (i) => i.code === 'bus-port-width',
    )!;
    expect(message.message).toBe(
      'bus port A1.D[0..1] is on an unnamed bus: name it to connect its bits',
    );
  });

  it('leaves an instance that would contain itself empty, with an error where the loop closes', () => {
    const loop = circuit('loop', [part('U1', 'test/and', 0, 0), part('A1', 'sub/main', 20, 0)]);
    const top = circuit('main', [part('A1', 'sub/loop', 0, 0)]);
    const design = compileDesign(doc(top, loop), library);
    expect(design.netlist.components.map((c) => c.id)).toEqual(['A1/U1']);
    expect(design.issues.filter((i) => i.code === 'recursive-subcircuit')).toEqual([
      {
        severity: 'error',
        code: 'recursive-subcircuit',
        message: 'A1 would place MAIN inside itself (MAIN → LOOP → MAIN): it is left empty',
        component: 'A1',
        at: [20, 0],
        circuit: 'loop',
      },
    ]);
    expect(design.ok).toBe(false);
    const self = compileDesign(doc(circuit('main', [part('A1', 'sub/main', 0, 0)])), library);
    expect(self.issues[0]!.message).toBe(
      'A1 would place MAIN inside itself (MAIN → MAIN): it is left empty',
    );
    expect(self.netlist.components).toEqual([]);
  });

  it('flattens another circuit as the top when asked', () => {
    const design = compileDesign(
      doc(circuit('main', [part('A1', 'sub/gate', 0, 0)]), gate),
      library,
      {
        top: 'gate',
      },
    );
    expect(design.top).toBe('gate');
    expect(design.netlist.components.map((c) => c.id)).toEqual(['U1']);
    expect(() => compileDesign(doc(gate), library, { top: 'nope' })).toThrow('no circuit "nope"');
  });

  it('reuses compile results of unchanged circuits, and recompiles a parent when ports change', () => {
    const cache = new CompileCache();
    const top = circuit('main', [part('A1', 'sub/gate', 0, 0)]);
    const first = compileDesign(doc(top, gate), library, { cache });
    // Inside the gate a part moves: the top is not compiled again.
    const moved = {
      ...gate,
      components: gate.components.map((c) => (c.id === 'U1' ? { ...c, y: 0 } : c)),
    };
    const nudged = { ...moved, components: [...moved.components, part('U9', 'test/and', 50, 50)] };
    const second = compileDesign(doc(top, nudged), library, { cache });
    expect(second.circuits.get('main')).toBe(first.circuits.get('main'));
    expect(second.circuits.get('gate')).not.toBe(first.circuits.get('gate'));
    // A port renamed: the top's instance has other pins, so the top is compiled again.
    const renamed = {
      ...gate,
      components: gate.components.map((c) =>
        c.id === 'P3' ? { ...c, props: { ...c.props, name: 'Q' } } : c,
      ),
    };
    const third = compileDesign(doc(top, renamed), library, { cache });
    expect(third.circuits.get('main')).not.toBe(first.circuits.get('main'));
  });

  it('keeps the netlist structure when a part inside a module moves without reconnecting', () => {
    const top = circuit('main', [part('H1', 'test/high', 0, 0), part('A1', 'sub/gate', 20, 0)]);
    const before = compileDesign(labelPins(doc(top, gate), { HIGH: ['H1.Y', 'A1.A'] }), library);
    const shifted = {
      ...gate,
      components: gate.components.map((c) => ({ ...c, x: c.x + 3 })),
    };
    const after = compileDesign(labelPins(doc(top, shifted), { HIGH: ['H1.Y', 'A1.A'] }), library);
    expect(sameNetlistStructure(before.netlist, after.netlist)).toBe(true);
  });

  it('lists every circuit’s issues with their circuit, errors first', () => {
    const broken = circuit('broken', [
      part('U1', 'test/nothing', 0, 0),
      part('U2', 'test/and', 10, 0),
    ]);
    const design = compileDesign(
      doc(circuit('main', [part('U1', 'test/and', 0, 0)]), broken),
      library,
    );
    expect(design.issues.map((i) => [i.circuit, i.code])).toEqual([
      ['broken', 'unknown-type'],
      ['main', 'undriven-input'],
      ['main', 'undriven-input'],
      ['broken', 'undriven-input'],
      ['broken', 'undriven-input'],
    ]);
  });
});
