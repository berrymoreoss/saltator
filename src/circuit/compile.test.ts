import { describe, expect, it } from 'vitest';
import { Level, Simulator, sameNetlistStructure } from '../core';
import { compileCircuit, compileDocument } from './compile';
import type { Circuit, ComponentInstance, Wire } from './document';
import { testRegistry } from './test-parts';

const registry = testRegistry();

// Pin positions of the test parts placed at (x, y) — box layout, see layout.ts:
//   test/high, test/pull: Y (x+5, y+1)
//   test/and:             A (x, y+1), B (x, y+2), Y (x+5, y+1)
//   test/bus:             A (x, y+1), EN (x, y+2), Y (x+5, y+1), D (x+5, y+2)
// Symbols:
//   test/tie:             Y (x+1, y+2) for level 1, (x+1, y) for level 0
//   test/lamp:            A (x, y+1), K (x+4, y+1)
//   test/label:           N (x, y)          test/hi: Y (x+5, y+1)
//   test/bus-label:       B (x, y)          test/bus-entry: N (x, y), B (x+3, y+1)

function part(
  id: string,
  type: string,
  x: number,
  y: number,
  patch: Partial<ComponentInstance> = {},
): ComponentInstance {
  return { id, type, x, y, rotation: 0, flip: false, props: {}, ...patch };
}

const wire = (id: string, x1: number, y1: number, x2: number, y2: number): Wire => ({
  id,
  from: [x1, y1],
  to: [x2, y2],
});

const circuit = (components: ComponentInstance[], wires: Wire[] = []): Circuit => ({
  id: 'main',
  name: 'Main',
  components,
  wires,
});

const compile = (components: ComponentInstance[], wires: Wire[] = []) =>
  compileCircuit(circuit(components, wires), registry);

const codes = (result: ReturnType<typeof compile>) => result.issues.map((i) => i.code);

describe('compileCircuit', () => {
  // H1.Y (5,1) ─w1─ U1.A (10,1); a T-junction at (7,1) feeds U1.B (10,2) through w2, w3.
  const fanOut = () =>
    compile(
      [part('H1', 'test/high', 0, 0), part('U1', 'test/and', 10, 0)],
      [wire('w1', 5, 1, 10, 1), wire('w2', 7, 1, 7, 2), wire('w3', 7, 2, 10, 2)],
    );

  it('compiles a drawn circuit to a netlist', () => {
    const result = fanOut();
    expect(result.netlist).toEqual({
      components: [
        { id: 'H1', type: 'test/high' },
        { id: 'U1', type: 'test/and' },
      ],
      nets: [
        {
          id: 'H1.Y',
          pins: [
            { component: 'H1', pin: 'Y' },
            { component: 'U1', pin: 'A' },
            { component: 'U1', pin: 'B' },
          ],
        },
        { id: 'U1.Y', pins: [{ component: 'U1', pin: 'Y' }] },
      ],
    });
    expect([...result.wireNets]).toEqual([
      ['w1', 'H1.Y'],
      ['w2', 'H1.Y'],
      ['w3', 'H1.Y'],
    ]);
    expect(result.junctions).toEqual([[7, 1]]);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('produces a netlist the simulator runs', () => {
    const sim = new Simulator(fanOut().netlist, registry);
    sim.settle();
    expect(sim.level('U1.Y')).toBe(Level.L1);
    expect(sim.diagnostics.entries).toEqual([]);
  });

  it('lists every net with its placed pins and wires', () => {
    const net = fanOut().nets[0]!;
    expect(net.pins.map((p) => [p.component, p.pin, p.dir, p.at])).toEqual([
      ['H1', 'Y', 'out', [5, 1]],
      ['U1', 'A', 'in', [10, 1]],
      ['U1', 'B', 'in', [10, 2]],
    ]);
    expect(net.wires.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
  });

  it('passes props through and lays out each instance by its own props', () => {
    // A 3-input AND has C at (x, y+3); a wire from H1 reaches it only on that instance.
    const result = compile(
      [
        part('H1', 'test/high', 0, 0),
        part('U1', 'test/and', 10, 0, { props: { inputs: 3 } }),
        part('U2', 'test/and', 10, 10),
      ],
      [
        wire('w1', 5, 1, 5, 3),
        wire('w2', 5, 3, 10, 3),
        wire('w3', 5, 3, 5, 13),
        wire('w4', 5, 13, 10, 13),
      ],
    );
    expect(result.netlist.components[1]).toEqual({
      id: 'U1',
      type: 'test/and',
      props: { inputs: 3 },
    });
    expect(result.nets[0]!.pins.map((p) => `${p.component}.${p.pin}`)).toEqual(['H1.Y', 'U1.C']);
    expect(codes(result)).toContain('dangling-wire'); // w4 stops at (10,13), U2 has only A, B
  });

  it('places pins of rotated and mirrored parts', () => {
    // Rotated 90° around (10, 0): A → (9, 0), B → (8, 0), Y → (9, 5).
    const result = compile(
      [part('H1', 'test/high', 4, -4), part('U1', 'test/and', 10, 0, { rotation: 90 })],
      [wire('w1', 9, -3, 9, 0)], // from above, so it doesn't pass through B at (8, 0)
    );
    expect(result.nets[0]!.pins.map((p) => `${p.component}.${p.pin}`)).toEqual(['H1.Y', 'U1.A']);
    // Approaching from the side runs through B first: everything that touches connects.
    const side = compile(
      [part('H1', 'test/high', 0, -1), part('U1', 'test/and', 10, 0, { rotation: 90 })],
      [wire('w1', 5, 0, 9, 0)],
    );
    expect(side.nets[0]!.pins.map((p) => `${p.component}.${p.pin}`)).toEqual([
      'H1.Y',
      'U1.A',
      'U1.B',
    ]);
    const flipped = compile(
      [part('H1', 'test/high', 0, 0, { flip: true })],
      [wire('w1', -5, 1, -8, 1)],
    );
    expect(flipped.nets[0]!.wires.map((w) => w.id)).toEqual(['w1']);
  });

  it('connects DIP pins, power pins included', () => {
    // test/dip at (0, 0): pin 1 (1A) at (0, 1), pin 14 (VCC) at (6, 1), pin 7 (GND) at (0, 7).
    const result = compile(
      [part('U1', 'test/dip', 0, 0), part('H1', 'test/high', -10, 0)],
      [wire('w1', -5, 1, 0, 1), wire('w2', 6, 1, 9, 1)],
    );
    const pinsOf = (id: string) =>
      result.nets.find((n) => n.id === id)!.pins.map((p) => `${p.component}.${p.pin}`);
    expect(pinsOf('H1.Y')).toEqual(['U1.1A', 'H1.Y']);
    expect(pinsOf('U1.VCC')).toEqual(['U1.VCC']);
    expect(result.wireNets.get('w2')).toBe('U1.VCC');
    expect(() => new Simulator(result.netlist, registry)).not.toThrow();
  });

  describe('net names', () => {
    it('prefer the first driver pin over earlier inputs', () => {
      const result = compile(
        [part('U1', 'test/and', 10, 0), part('H1', 'test/high', 0, 0)],
        [wire('w1', 5, 1, 10, 1)],
      );
      expect(result.nets.map((n) => n.id)).toEqual(['H1.Y', 'U1.B', 'U1.Y']);
    });

    it('use the first pin of driverless nets and the first wire of wire-only nets', () => {
      const result = compile(
        [part('U1', 'test/and', 0, 0), part('U2', 'test/and', 0, 10)],
        [
          wire('w1', 0, 1, -3, 1),
          wire('w2', -3, 1, -3, 11),
          wire('w3', -3, 11, 0, 11),
          wire('w9', 20, 20, 25, 20),
        ],
      );
      expect(result.nets.map((n) => n.id)).toEqual(['U1.A', 'U1.B', 'U1.Y', 'U2.B', 'U2.Y', 'w9']);
      const sim = new Simulator(result.netlist, registry);
      sim.settle();
      expect(sim.level('w9')).toBe(Level.Z);
    });
  });

  describe('net labels', () => {
    const label = (id: string, name: string, x: number, y: number) =>
      part(id, 'test/label', x, y, { props: { name } });

    // H1.Y (5,1) ─w1─ label A (8,1)   …   label A (20,1) ─w2─ U1.A (25,1)
    const split = () =>
      compile(
        [
          part('H1', 'test/high', 0, 0),
          label('NL1', 'A', 8, 1),
          label('NL2', 'A', 20, 1),
          part('U1', 'test/and', 25, 0),
        ],
        [wire('w1', 5, 1, 8, 1), wire('w2', 20, 1, 25, 1)],
      );

    it('join the parts on labels of the same name into one net called by it', () => {
      const result = split();
      const net = result.nets.find((n) => n.id === 'A')!;
      expect(net.names).toEqual(['A']);
      expect(net.pins.map((p) => `${p.component}.${p.pin}`)).toEqual(['H1.Y', 'U1.A']);
      expect(net.schematicPins.map((p) => p.component)).toEqual(['NL1', 'NL2']);
      expect(net.wires.map((w) => w.id)).toEqual(['w1', 'w2']);
      expect(result.wireNets).toEqual(
        new Map([
          ['w1', 'A'],
          ['w2', 'A'],
        ]),
      );
      expect(result.junctions).toEqual([]);
      expect([...result.openPins]).toEqual(['U1.B', 'U1.Y']);
      expect(result.issues.map((i) => `${i.code} ${i.pin}`)).toEqual(['undriven-input B']);
      const sim = new Simulator(result.netlist, registry);
      sim.settle();
      expect(sim.level('A')).toBe(Level.L1);
    });

    it('stay out of the netlist', () => {
      const result = split();
      expect(result.netlist.components.map((c) => c.id)).toEqual(['H1', 'U1']);
      expect(result.netlist.nets.find((n) => n.id === 'A')!.pins).toEqual([
        { component: 'H1', pin: 'Y' },
        { component: 'U1', pin: 'A' },
      ]);
      // A label that joins nothing new leaves the netlist's structure as it was.
      const moved = compile(
        [
          part('H1', 'test/high', 0, 0),
          label('NL1', 'A', 8, 1),
          label('NL2', 'A', 20, 1),
          label('NL3', 'A', 40, 40),
          part('U1', 'test/and', 25, 0),
        ],
        [wire('w1', 5, 1, 8, 1), wire('w2', 20, 1, 25, 1)],
      );
      expect(sameNetlistStructure(result.netlist, moved.netlist)).toBe(true);
    });

    it('name a net by simulated pins first, then labels, each in code-point order', () => {
      // R1.Y (5,1) with labels Z and B on its wire.
      const result = compile(
        [part('R1', 'test/hi', 0, 0), label('NL1', 'Z', 8, 1), label('NL2', 'B', 9, 1)],
        [wire('w1', 5, 1, 9, 1)],
      );
      expect(result.nets.map((n) => [n.id, n.names])).toEqual([['HI', ['HI', 'B', 'Z']]]);
    });

    it('join named simulated pins without a wire', () => {
      const result = compile([part('R1', 'test/hi', 0, 0), part('R2', 'test/hi', 0, 10)]);
      expect(result.nets.map((n) => n.id)).toEqual(['HI']);
      expect([...result.openPins]).toEqual(['R1.Y', 'R2.Y']); // they touch nothing
      expect(result.nets[0]!.pins.map((p) => p.component)).toEqual(['R1', 'R2']);
      expect(result.issues).toEqual([]); // tied to the same level: one source
    });

    it('rename a wire-only net whose id is a net name', () => {
      const result = compile(
        [part('H1', 'test/high', 0, 0), label('NL1', 'A', 5, 1)],
        [wire('A', 20, 20, 25, 20)],
      );
      expect(result.nets.map((n) => n.id)).toEqual(['A', 'A#2']);
      expect(result.wireNets.get('A')).toBe('A#2');
      expect(() => new Simulator(result.netlist, registry)).not.toThrow();
    });

    it('join nothing while the name is invalid', () => {
      const result = compile([
        part('H1', 'test/high', 0, 0),
        label('NL1', 'a b', 5, 1),
        label('NL2', 'a b', 20, 1),
      ]);
      expect(codes(result)).toEqual(['invalid-props', 'invalid-props']);
      expect(result.issues[0]!.message).toBe(
        'NL1: prop "name" must be capital letters and digits, got "a b"',
      );
      expect(result.nets.map((n) => n.id)).toEqual(['H1.Y']);
    });

    it('warn about a label whose name nothing else uses', () => {
      const result = compile(
        [part('H1', 'test/high', 0, 0), label('NL1', 'CKL', 5, 1), label('NL2', 'HI', 30, 30)],
        [wire('w1', 5, 1, 9, 1)],
      );
      expect(result.issues.filter((i) => i.code === 'single-net-label')).toEqual([
        {
          severity: 'warning',
          code: 'single-net-label',
          message:
            'net label NL1 "CKL" is the only one with this name, so it joins nothing (a typo?)',
          net: 'CKL',
          component: 'NL1',
          pin: 'N',
          at: [5, 1],
        },
        expect.objectContaining({ component: 'NL2' }),
      ]);
      // A rail of the same name or a second label is a partner.
      const partnered = compile([
        part('R1', 'test/hi', 0, 0),
        label('NL1', 'HI', 20, 20),
        label('NL2', 'B', 30, 30),
        label('NL3', 'B', 40, 40),
      ]);
      expect(codes(partnered)).toEqual([]);
    });

    it('warn about a net with several names, at the pin giving the second', () => {
      const result = compile(
        [label('NL1', 'CLOCK', 0, 0), label('NL2', 'CLK', 5, 0), label('NL3', 'CLK', 9, 9)],
        [wire('w1', 0, 0, 5, 0), wire('w2', 9, 9, 9, 12)],
      );
      expect(result.issues.filter((i) => i.code === 'multiple-net-names')).toEqual([
        {
          severity: 'warning',
          code: 'multiple-net-names',
          message: 'net "CLK" has several names: CLK, CLOCK (it is called CLK)',
          net: 'CLK',
          component: 'NL1',
          pin: 'N',
          at: [0, 0],
        },
      ]);
    });

    it('make an input on a label part of a net, not unconnected', () => {
      const result = compile([part('U1', 'test/and', 0, 0), label('NL1', 'A', 0, 1)]);
      expect(result.issues.find((i) => i.pin === 'A')!.message).toBe(
        'input U1.A is on net "A", which nothing drives (reads as X)',
      );
    });
  });

  describe('buses', () => {
    const entry = (id: string, name: string, x: number, y: number) =>
      part(id, 'test/bus-entry', x, y, { props: { name } });
    const busLabel = (id: string, name: string, x: number, y: number) =>
      part(id, 'test/bus-label', x, y, { props: { name } });
    const bus = (id: string, x1: number, y1: number, x2: number, y2: number): Wire => ({
      ...wire(id, x1, y1, x2, y2),
      bus: true,
    });
    const ids = (pins: readonly { component: string; pin: string }[]) =>
      pins.map((p) => `${p.component}.${p.pin}`);

    // H1.Y (5,1) = entry D0 ─ bus b1 (8,2)…(8,10) = label D[0..3]
    // U1.A (30,1) = entry D0 ─ bus b2 (33,2)…(33,6) = label D[0..3]
    const twoBuses = (extra: Wire[] = []) =>
      compile(
        [
          part('H1', 'test/high', 0, 0),
          entry('BE1', 'D0', 5, 1),
          busLabel('BL1', 'D[0..3]', 8, 10),
          part('U1', 'test/and', 30, 0),
          entry('BE2', 'D0', 30, 1),
          busLabel('BL2', 'D[0..3]', 33, 6),
        ],
        [bus('b1', 8, 2, 8, 10), bus('b2', 33, 2, 33, 6), ...extra],
      );

    it('gather bus lines and bus pins, joined by their labels and named by them', () => {
      const result = twoBuses();
      expect(result.buses).toHaveLength(1);
      const [d] = result.buses;
      expect(d!.id).toBe('D[0..3]');
      expect(d!.names).toEqual(['D[0..3]']);
      expect(d!.members).toEqual(['D0', 'D1', 'D2', 'D3']);
      expect(ids(d!.pins)).toEqual(['BE1.B', 'BL1.B', 'BE2.B', 'BL2.B']);
      expect(d!.wires.map((w) => w.id)).toEqual(['b1', 'b2']);
      expect(result.wireBuses).toEqual(
        new Map([
          ['b1', 'D[0..3]'],
          ['b2', 'D[0..3]'],
        ]),
      );
      expect(result.wireNets.size).toBe(0);
      expect(result.busJunctions).toEqual([]);
      expect([...result.openPins]).toEqual(['U1.B', 'U1.Y']);
    });

    it('leave the nets to the entries: members are nets joined by name', () => {
      const result = twoBuses();
      const d0 = result.nets.find((n) => n.id === 'D0')!;
      expect(ids(d0.pins)).toEqual(['H1.Y', 'U1.A']);
      expect(ids(d0.schematicPins)).toEqual(['BE1.N', 'BE2.N']);
      expect(result.nets.every((n) => n.wires.length === 0)).toBe(true);
      expect(result.netlist.components.map((c) => c.id)).toEqual(['H1', 'U1']);
      expect(result.issues.map((i) => `${i.code} ${i.pin}`)).toEqual(['undriven-input B']);
      const sim = new Simulator(result.netlist, registry);
      sim.settle();
      expect(sim.level('D0')).toBe(Level.L1);
      // Bus lines never reach the netlist.
      const more = twoBuses([bus('b3', 33, 6, 40, 6)]);
      expect(sameNetlistStructure(result.netlist, more.netlist)).toBe(true);
    });

    it('never connect to wires, and say so where a wire ends on one', () => {
      // H1.Y (5,1) ─w1─ (8,1) on bus b1 (8,0)…(8,4); a net label at the bus end (8,4), a bus
      // label on w1's middle (6,1).
      const result = compile(
        [
          part('H1', 'test/high', 0, 0),
          part('NL1', 'test/label', 8, 4, { props: { name: 'A' } }),
          busLabel('BL1', 'D[0..3]', 6, 1),
        ],
        [wire('w1', 5, 1, 8, 1), bus('b1', 8, 0, 8, 4)],
      );
      expect(result.nets.map((n) => [n.id, n.wires.map((w) => w.id)])).toEqual([
        ['H1.Y', ['w1']],
        ['A', []],
      ]);
      expect(result.buses.map((b) => [b.id, ids(b.pins), b.wires.map((w) => w.id)])).toEqual([
        ['D[0..3]', ['BL1.B'], []],
        ['b1', [], ['b1']],
      ]);
      expect(result.junctions).toEqual([]);
      expect([...result.openPins]).toEqual(['NL1.N', 'BL1.B']);
      expect(result.issues.filter((i) => i.code === 'dangling-wire').map((i) => i.message)).toEqual(
        [
          'wire w1 ends at (8, 1) on a bus without connecting to it (use a bus entry)',
          'bus b1 ends at (8, 0) without touching anything',
          'bus b1 ends at (8, 4) without touching anything',
        ],
      );
    });

    it('are called by their first pin or line when unnamed', () => {
      const result = compile(
        [entry('BE1', 'D0', 0, 0)],
        [bus('b1', 3, 1, 3, 5), bus('b9', 10, 0, 10, 5)],
      );
      expect(result.buses.map((b) => [b.id, b.names, b.members])).toEqual([
        ['BE1.B', [], []],
        ['b9', [], []],
      ]);
    });

    it('report entries that are not members of their bus, and entries that join nothing', () => {
      const result = compile(
        [
          entry('BE1', 'D9', 0, 0),
          entry('BE2', 'D2', 0, 2),
          busLabel('BL1', 'D[0..3]', 3, 5),
          entry('BE3', 'D9', 20, 0), // on an unnamed bus: no member check
        ],
        [bus('b1', 3, 1, 3, 5), bus('b2', 23, 1, 23, 4)],
      );
      expect(result.issues.filter((i) => i.code === 'bus-entry-member')).toEqual([
        {
          severity: 'warning',
          code: 'bus-entry-member',
          message: 'bus entry BE1 joins D9, which is not a member of bus D[0..3]',
          component: 'BE1',
          pin: 'B',
          at: [3, 1],
        },
      ]);
      expect(
        result.issues.filter((i) => i.code === 'single-net-label').map((i) => i.message),
      ).toEqual([
        'bus entry BE2 "D2" is the only one with this name, so it joins nothing (a typo?)',
      ]);
    });

    it('report a bus with several names, called by the first', () => {
      const result = compile(
        [busLabel('BL1', 'D[0..3]', 3, 5), busLabel('BL2', 'A[0..7]', 3, 1)],
        [bus('b1', 3, 1, 3, 5)],
      );
      expect(result.buses.map((b) => [b.id, b.members.length])).toEqual([['A[0..7]', 8]]);
      expect(result.issues).toEqual([
        {
          severity: 'warning',
          code: 'multiple-net-names',
          message: 'bus "A[0..7]" has several names: A[0..7], D[0..3] (it is called A[0..7])',
          component: 'BL1',
          pin: 'B',
          at: [3, 5],
        },
      ]);
    });

    it('get junction dots of their own, where bus lines meet', () => {
      const result = compile(
        // An entry and a label on b1's middle: no dots there.
        [entry('BE1', 'D0', -3, 1), busLabel('BL1', 'D[0..3]', 0, 7)],
        [
          bus('b1', 0, 0, 0, 8),
          bus('b2', 0, 4, 4, 4),
          wire('w1', -2, 6, 2, 6), // crosses b1's middle: nothing on either layer
          wire('w2', 4, 0, 4, 8), // through b2's end: a plain wire passing, no dot
        ],
      );
      expect(result.busJunctions).toEqual([[0, 4]]);
      expect(result.junctions).toEqual([]);
      expect(result.buses).toHaveLength(1);
    });
  });

  describe('design checks', () => {
    it('reports unknown part types and compiles the rest', () => {
      const result = compile(
        [part('X1', 'test/nope', 3, 4), part('H1', 'test/high', 0, 0)],
        [wire('w1', 5, 1, 8, 1)],
      );
      expect(result.issues[0]).toEqual({
        severity: 'error',
        code: 'unknown-type',
        message: 'X1: unknown part type "test/nope"',
        component: 'X1',
        at: [3, 4],
      });
      expect(result.ok).toBe(false);
      expect(result.netlist.components.map((c) => c.id)).toEqual(['H1']);
    });

    it('reports invalid props', () => {
      const result = compile([part('U1', 'test/and', 0, 0, { props: { inputs: 9 } })]);
      expect(result.issues).toEqual([
        {
          severity: 'error',
          code: 'invalid-props',
          message: 'U1: prop "inputs" must be ≤ 4, got 9',
          component: 'U1',
          at: [0, 0],
        },
      ]);
      expect(result.netlist.components).toEqual([]);
      expect(result.ok).toBe(false);
    });

    it('reports push-pull outputs shorted together', () => {
      // H1.Y (5,1) and H2.Y (5,11) joined by a vertical wire.
      const result = compile(
        [part('H1', 'test/high', 0, 0), part('H2', 'test/high', 0, 10)],
        [wire('w1', 5, 1, 5, 11)],
      );
      expect(result.issues).toEqual([
        {
          severity: 'error',
          code: 'shorted-outputs',
          message: 'outputs shorted together on net "H1.Y": H1.Y, H2.Y',
          net: 'H1.Y',
          component: 'H2',
          pin: 'Y',
          at: [5, 11],
        },
      ]);
      expect(result.ok).toBe(false);
    });

    it('allows an output with a pull resistor or a tri-state output on the same net', () => {
      expect(
        compile(
          [part('H1', 'test/high', 0, 0), part('R1', 'test/pull', 0, 10)],
          [wire('w1', 5, 1, 5, 11)],
        ).issues,
      ).toEqual([]);
      const bus = compile(
        [
          part('H1', 'test/high', 0, 0),
          part('B1', 'test/bus', 0, 10),
          part('H2', 'test/high', -10, 10),
          part('H3', 'test/high', -10, 11),
        ],
        [wire('w1', 5, 1, 5, 11), wire('w2', -5, 11, 0, 11), wire('w3', -5, 12, 0, 12)],
      );
      expect(codes(bus)).toEqual([]);
    });

    it('counts outputs tied to the same level as one source', () => {
      // T1, T2 (level 1): Y (1, 2), (11, 2) on one horizontal wire. Fine.
      const vcc = compile(
        [part('T1', 'test/tie', 0, 0), part('T2', 'test/tie', 10, 0)],
        [wire('w1', 1, 2, 11, 2)],
      );
      expect(vcc.issues).toEqual([]);
      // Add a tie to 0 (Y at (21, 2)) and a push-pull output (H1.Y at (25, 2)).
      const shorted = compile(
        [
          part('T1', 'test/tie', 0, 0),
          part('T2', 'test/tie', 10, 0),
          part('T3', 'test/tie', 20, 2, { props: { level: '0' } }),
          part('H1', 'test/high', 20, 1),
        ],
        [wire('w1', 1, 2, 25, 2)],
      );
      expect(shorted.issues).toEqual([
        {
          severity: 'error',
          code: 'shorted-outputs',
          message: 'outputs shorted together on net "T1.Y": T1.Y, T2.Y, T3.Y, H1.Y',
          net: 'T1.Y',
          component: 'T3',
          pin: 'Y',
          at: [21, 2],
        },
      ]);
      // A tie and a push-pull output: the output is the second source.
      const output = compile(
        [part('T1', 'test/tie', 0, 0), part('H1', 'test/high', 0, 1)],
        [wire('w1', 1, 2, 5, 2)],
      );
      expect(output.issues.map((i) => [i.code, i.component])).toEqual([['shorted-outputs', 'H1']]);
    });

    it('never reports sense pins (LEDs, probes) as undriven inputs', () => {
      const lamp = compile([part('L1', 'test/lamp', 0, 0)]);
      expect(lamp.issues).toEqual([]);
      expect(lamp.nets.map((n) => n.pins.map((p) => [p.pin, p.sense]))).toEqual([
        [['A', true]],
        [['K', true]],
      ]);
    });

    it('reports inputs that nothing drives', () => {
      expect(compile([part('U1', 'test/and', 0, 0)]).issues).toEqual([
        {
          severity: 'warning',
          code: 'undriven-input',
          message: 'input U1.A is not connected (reads as X)',
          component: 'U1',
          pin: 'A',
          net: 'U1.A',
          at: [0, 1],
        },
        {
          severity: 'warning',
          code: 'undriven-input',
          message: 'input U1.B is not connected (reads as X)',
          component: 'U1',
          pin: 'B',
          net: 'U1.B',
          at: [0, 2],
        },
      ]);
      // A and B tied together, still nothing driving them.
      const tied = compile([part('U1', 'test/and', 0, 0)], [wire('w1', 0, 1, 0, 2)]);
      expect(tied.issues.map((i) => i.message)).toEqual([
        'input U1.A is on net "U1.A", which nothing drives (reads as X)',
        'input U1.B is on net "U1.A", which nothing drives (reads as X)',
      ]);
      expect(tied.ok).toBe(true); // warnings don't block
    });

    it('treats pull resistors, tri-state and bidirectional pins as possible drivers', () => {
      // R1.Y (5,1) → U1.A (10,1); B1.Y (5,11) → U1.B (10,2) via (8,11)-(8,2); B1.D drives B1's EN.
      const result = compile(
        [
          part('R1', 'test/pull', 0, 0),
          part('B1', 'test/bus', 0, 10),
          part('U1', 'test/and', 10, 0),
        ],
        [
          wire('w1', 5, 1, 10, 1),
          wire('w2', 5, 11, 8, 11),
          wire('w3', 8, 11, 8, 2),
          wire('w4', 8, 2, 10, 2),
          wire('w5', 5, 12, 5, 14),
          wire('w6', 5, 14, -1, 14),
          wire('w7', -1, 14, -1, 12),
          wire('w8', -1, 12, 0, 12),
        ],
      );
      expect(result.issues.map((i) => i.message)).toEqual([
        'input B1.A is not connected (reads as X)',
      ]);
    });

    it('reports wire ends that touch nothing', () => {
      const result = compile([part('H1', 'test/high', 0, 0)], [wire('w1', 5, 1, 9, 1)]);
      expect(result.issues).toEqual([
        {
          severity: 'warning',
          code: 'dangling-wire',
          message: 'wire w1 ends at (9, 1) without touching anything',
          wire: 'w1',
          at: [9, 1],
        },
      ]);
    });

    it('lists errors before warnings', () => {
      const result = compile([part('U1', 'test/and', 0, 0), part('X1', 'test/nope', 9, 9)]);
      expect(codes(result)).toEqual(['unknown-type', 'undriven-input', 'undriven-input']);
    });
  });
});

describe('compileDocument', () => {
  it('compiles the first circuit', () => {
    const result = compileDocument(
      {
        schemaVersion: 2,
        circuits: [
          circuit([part('H1', 'test/high', 0, 0)]),
          circuit([part('U1', 'test/and', 0, 0)]),
        ],
      },
      registry,
    );
    expect(result.netlist.components.map((c) => c.id)).toEqual(['H1']);
  });
});
