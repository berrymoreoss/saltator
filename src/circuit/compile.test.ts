import { describe, expect, it } from 'vitest';
import { Level, Simulator } from '../core';
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
        schemaVersion: 1,
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
