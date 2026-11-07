import { describe, expect, it } from 'vitest';
import { defineComponent } from '../core';
import { connect } from './connectivity';
import type { Circuit, ComponentInstance, Wire } from './document';
import {
  addComponents,
  addWires,
  copyFragment,
  designatorError,
  IdAllocator,
  nextDesignator,
  normalizeWires,
  pasteFragment,
  removeItems,
  renameComponent,
  renameInProbes,
  renameReference,
  sameCircuit,
  sameProbes,
  translateCircuit,
  updateComponent,
} from './edit';
import type { Point } from './geometry';
import { testRegistry } from './test-parts';

const part = (id: string, type = 'test/and', x = 0, y = 0): ComponentInstance => ({
  id,
  type,
  x,
  y,
  rotation: 0,
  flip: false,
  props: {},
});

const wire = (id: string, from: Point, to: Point): Wire => ({ id, from, to });
const busLine = (id: string, from: Point, to: Point): Wire => ({ id, from, to, bus: true });

const circuit = (components: ComponentInstance[] = [], wires: Wire[] = []): Circuit => ({
  id: 'main',
  name: 'Main',
  components,
  wires,
  probes: [],
});

describe('designators and ids', () => {
  it('hands out the lowest free number per prefix, filling gaps', () => {
    const c = circuit([part('U1'), part('U3'), part('SW1')], [wire('w1', [0, 0], [1, 0])]);
    expect(nextDesignator(c, 'U')).toBe('U2');
    expect(nextDesignator(c, 'SW')).toBe('SW2');
    expect(nextDesignator(c, 'D')).toBe('D1');
    expect(nextDesignator(c, 'w')).toBe('w2');
    const ids = IdAllocator.of(c);
    expect([ids.next('U'), ids.next('U'), ids.next('U')]).toEqual(['U2', 'U4', 'U5']);
    expect(ids.take('U4')).toBe(false);
    expect(ids.take('X9')).toBe(true);
    expect(ids.has('X9')).toBe(true);
  });

  it('explains why a designator is not allowed', () => {
    const c = circuit([part('U1'), part('U2')], [wire('w1', [0, 0], [1, 0])]);
    expect(designatorError(c, 'U1', 'U1')).toBeUndefined();
    expect(designatorError(c, 'U1', 'RESET')).toBeUndefined();
    expect(designatorError(c, 'U1', '')).toBe('A designator is required.');
    expect(designatorError(c, 'U1', 'U 3')).toMatch(/letter or _ first/);
    expect(designatorError(c, 'U1', 'U1.A')).toMatch(/no spaces or dots/);
    expect(designatorError(c, 'U1', '3U')).toMatch(/letter or _ first/);
    expect(designatorError(c, 'U1', 'U2')).toBe('"U2" is already used.');
    expect(designatorError(c, 'U1', 'w1')).toBe('"w1" is already used.');
  });

  it('renames a part in place', () => {
    const c = circuit([part('U1'), part('U2')]);
    const renamed = renameComponent(c, 'U2', 'CLK_DIV');
    expect(renamed.components.map((p) => p.id)).toEqual(['U1', 'CLK_DIV']);
    expect(renamed.components[0]).toBe(c.components[0]);
    expect(renameComponent(c, 'U1', 'U1')).toBe(c);
    expect(() => renameComponent(c, 'U1', 'U2')).toThrow('"U2" is already used.');
    expect(() => renameComponent(c, 'U9', 'U3')).toThrow('no part "U9"');
  });

  it('rewrites the pin references of probes to the renamed part', () => {
    const c = {
      ...circuit([part('U1'), part('U2')]),
      probes: [
        { ref: 'U2.Y', radix: 'bin' as const },
        { ref: 'U21.Y' },
        { ref: 'U2' },
        { name: 'G', members: ['U1.A', 'U2.A'] },
        { name: 'H', members: ['U1.A'] },
      ],
    };
    const renamed = renameComponent(c, 'U2', 'U7');
    expect(renamed.probes).toEqual([
      { ref: 'U7.Y', radix: 'bin' },
      { ref: 'U21.Y' },
      { ref: 'U2' }, // a part is no probe: left as it was
      { name: 'G', members: ['U1.A', 'U7.A'] },
      { name: 'H', members: ['U1.A'] },
    ]);
    expect(renamed.probes[1]).toBe(c.probes[1]);
    expect(renamed.probes[4]).toBe(c.probes[4]);
    expect(renameInProbes(c.probes, 'U9', 'U8')).toBe(c.probes);
  });
  it('renames the pins of a part in a signal reference, nothing else', () => {
    expect(renameReference('U5.A0', 'U5', 'U7')).toBe('U7.A0');
    expect(renameReference('U55.A0', 'U5', 'U7')).toBe('U55.A0');
    expect(renameReference('U5', 'U5', 'U7')).toBe('U5'); // a net could be called so
    expect(renameReference('D1[0..7]', 'D1', 'D3')).toBe('D1[0..7]'); // a bus
  });
});

describe('component operations', () => {
  it('adds components and rejects taken ids', () => {
    const c = circuit([part('U1')], [wire('w1', [0, 0], [1, 0])]);
    const added = addComponents(c, [part('U2')]);
    expect(added.components.map((p) => p.id)).toEqual(['U1', 'U2']);
    expect(addComponents(c, [])).toBe(c);
    expect(() => addComponents(c, [part('w1')])).toThrow('duplicate id "w1"');
    expect(() => addComponents(c, [part('U2'), part('U2')])).toThrow('duplicate id "U2"');
  });

  it('updates position, placement, props and label; unchanged updates return the circuit', () => {
    const c = circuit([{ ...part('U1'), label: 'OLD' }, part('U2')]);
    const moved = updateComponent(c, 'U1', { x: 4, y: -2, rotation: 90, flip: true });
    expect(moved.components[0]).toEqual({
      ...part('U1', 'test/and', 4, -2),
      rotation: 90,
      flip: true,
      label: 'OLD',
    });
    expect(moved.components[1]).toBe(c.components[1]);
    expect(updateComponent(c, 'U1', { label: 'NEW' }).components[0]?.label).toBe('NEW');
    expect(updateComponent(c, 'U1', { label: '' }).components[0]).not.toHaveProperty('label');
    expect(updateComponent(c, 'U1', { label: undefined }).components[0]).not.toHaveProperty(
      'label',
    );
    expect(updateComponent(c, 'U1', { props: { delay: 5 } }).components[0]?.props).toEqual({
      delay: 5,
    });
    expect(updateComponent(c, 'U1', { x: 0, label: 'OLD', props: {} })).toBe(c);
    expect(() => updateComponent(c, 'U9', { x: 1 })).toThrow('no part "U9"');
  });

  it('removes parts and wires by id, keeping wires attached to removed parts', () => {
    const c = circuit(
      [part('U1'), part('U2')],
      [wire('w1', [0, 0], [1, 0]), wire('w2', [0, 0], [0, 1])],
    );
    const removed = removeItems(c, { parts: ['U1'], wires: ['w2'] });
    expect(removed.components.map((p) => p.id)).toEqual(['U2']);
    expect(removed.wires.map((w) => w.id)).toEqual(['w1']);
    expect(removeItems(c, { parts: [], wires: [] })).toBe(c);
    expect(removeItems(c, { parts: ['nope'], wires: [] })).toBe(c);
  });

  it('adds wires with fresh ids, skipping zero-length and rejecting diagonal ones', () => {
    const c = circuit([part('w1')]);
    const { circuit: next, wires } = addWires(c, [
      [
        [0, 0],
        [3, 0],
      ],
      [
        [3, 0],
        [3, 0],
      ],
      [
        [3, 0],
        [3, 2],
      ],
    ]);
    expect(wires.map((w) => w.id)).toEqual(['w2', 'w3']);
    expect(next.wires).toEqual(wires);
    expect(() =>
      addWires(c, [
        [
          [0, 0],
          [1, 1],
        ],
      ]),
    ).toThrow('neither horizontal nor vertical');
  });

  it('adds bus lines', () => {
    const { wires } = addWires(
      circuit([]),
      [
        [
          [0, 0],
          [0, 4],
        ],
      ],
      true,
    );
    expect(wires).toEqual([busLine('w1', [0, 0], [0, 4])]);
    const plain = addWires(circuit([]), [
      [
        [0, 0],
        [0, 4],
      ],
    ]).wires;
    expect('bus' in plain[0]!).toBe(false);
  });

  it('compares circuits by value', () => {
    const c = circuit([part('U1')], [wire('w1', [0, 0], [3, 0])]);
    expect(sameCircuit(c, c)).toBe(true);
    expect(sameCircuit(c, circuit([part('U1')], [wire('w1', [0, 0], [3, 0])]))).toBe(true);
    expect(sameCircuit(c, circuit([part('U1')], [wire('w1', [0, 0], [4, 0])]))).toBe(false);
    expect(sameCircuit(c, circuit([part('U1')], [wire('w2', [0, 0], [3, 0])]))).toBe(false);
    expect(sameCircuit(c, circuit([part('U1', 'test/and', 1)], c.wires as Wire[]))).toBe(false);
    expect(sameCircuit(c, circuit([], c.wires as Wire[]))).toBe(false);
    expect(sameCircuit(c, { ...c, name: 'Other' })).toBe(false);
    const probed = { ...c, probes: [{ ref: 'CLK' }, { name: 'G', members: ['A', 'B'] }] };
    expect(sameCircuit(c, probed)).toBe(false);
    expect(sameCircuit(probed, { ...probed, probes: [...probed.probes] })).toBe(true);
    for (const other of [
      [{ ref: 'CLK', name: 'clock' }, probed.probes[1]!],
      [{ ref: 'CLK', radix: 'hex' as const }, probed.probes[1]!],
      [{ ref: 'CLR' }, probed.probes[1]!],
      [{ ref: 'CLK' }, { name: 'G', members: ['A'] }],
      [{ ref: 'CLK' }, { name: 'G', members: ['A', 'C'] }],
      [{ ref: 'CLK' }, { ref: 'G' }],
    ]) {
      expect(sameProbes(probed.probes, other)).toBe(false);
    }
  });

  it('translates a whole circuit', () => {
    const c = circuit([part('U1', 'test/and', 1, 2)], [wire('w1', [0, 0], [3, 0])]);
    const moved = translateCircuit(c, 2, -1);
    expect(moved.components[0]).toMatchObject({ x: 3, y: 1 });
    expect(moved.wires[0]).toEqual(wire('w1', [2, -1], [5, -1]));
    expect(translateCircuit(c, 0, 0)).toBe(c);
  });
});

describe('normalizeWires', () => {
  const ends = (c: Circuit) => c.wires.map((w) => [w.id, w.from, w.to]);

  it('returns the same circuit when nothing merges', () => {
    const c = circuit(
      [],
      [wire('w1', [0, 0], [4, 0]), wire('w2', [4, 0], [4, 3]), wire('w3', [6, 0], [9, 0])],
    );
    expect(normalizeWires(c)).toBe(c);
  });

  it('drops zero-length wires', () => {
    const c = circuit([], [wire('w1', [0, 0], [4, 0]), wire('w2', [2, 2], [2, 2])]);
    const n = normalizeWires(c);
    expect(n.wires).toEqual([c.wires[0]]);
    expect(n.wires[0]).toBe(c.wires[0]);
  });

  it('merges collinear wires meeting end to end into one run with the first id', () => {
    const c = circuit(
      [],
      [wire('w2', [4, 0], [9, 0]), wire('w5', [0, 3], [0, 6]), wire('w1', [0, 0], [4, 0])],
    );
    expect(ends(normalizeWires(c))).toEqual([
      ['w2', [0, 0], [9, 0]],
      ['w5', [0, 3], [0, 6]],
    ]);
  });

  it('merges overlapping and contained wires, vertical ones too', () => {
    const c = circuit(
      [],
      [
        wire('a', [0, 0], [0, 5]),
        wire('b', [0, 3], [0, 8]),
        wire('c', [0, 4], [0, 6]),
        wire('d', [0, 8], [0, 3]),
      ],
    );
    expect(ends(normalizeWires(c))).toEqual([['a', [0, 0], [0, 8]]]);
  });

  it('keeps a wire ending on a crossing wire split there (a run through it would not connect)', () => {
    // A vertical wire passes through (4, 0); both horizontal pieces end on it: a T on each side.
    const c = circuit(
      [],
      [wire('w1', [0, 0], [4, 0]), wire('w2', [4, 0], [9, 0]), wire('w3', [4, -3], [4, 3])],
    );
    expect(normalizeWires(c)).toBe(c);
  });

  it('splits an overlap at a crossing wire that one of the pieces ended on', () => {
    const c = circuit(
      [],
      [wire('w1', [0, 0], [6, 0]), wire('w2', [4, 0], [9, 0]), wire('w3', [6, -3], [6, 3])],
    );
    expect(ends(normalizeWires(c))).toEqual([
      ['w1', [0, 0], [6, 0]],
      ['w2', [6, 0], [9, 0]],
      ['w3', [6, -3], [6, 3]],
    ]);
  });

  it('keeps a four-way joint of two corners connected', () => {
    // Two L corners meeting at (4, 0): merging both lines would make an unconnected crossing.
    const c = circuit(
      [],
      [
        wire('w1', [0, 0], [4, 0]),
        wire('w2', [4, 0], [9, 0]),
        wire('w3', [4, -3], [4, 0]),
        wire('w4', [4, 0], [4, 3]),
      ],
    );
    expect(normalizeWires(c)).toBe(c);
  });

  it('merges through a T-junction: the stem still ends on the run', () => {
    const c = circuit(
      [],
      [wire('w1', [0, 0], [4, 0]), wire('w2', [4, 0], [9, 0]), wire('w3', [4, 0], [4, 3])],
    );
    expect(ends(normalizeWires(c))).toEqual([
      ['w1', [0, 0], [9, 0]],
      ['w3', [4, 0], [4, 3]],
    ]);
  });

  it('gives split pieces fresh ids that collide with nothing', () => {
    // One long wire and a short duplicate inside it, cut by a crossing at the short one's end.
    const c = circuit(
      [part('w4')],
      [wire('w1', [0, 0], [9, 0]), wire('w2', [0, 0], [4, 0]), wire('w3', [4, -2], [4, 2])],
    );
    expect(ends(normalizeWires(c))).toEqual([
      ['w1', [4, 0], [9, 0]],
      ['w2', [0, 0], [4, 0]],
      ['w3', [4, -2], [4, 2]],
    ]);
  });

  /** Deterministic PRNG (mulberry32). */
  function rng(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Unit edges a wire covers: `h x y` from (x, y) to (x+1, y), `v x y` downwards. */
  function unitEdges(w: Wire): string[] {
    const [x0, y0] = w.from;
    const [x1, y1] = w.to;
    const out: string[] = [];
    if (y0 === y1)
      for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x++) out.push(`h ${x} ${y0}`);
    else for (let y = Math.min(y0, y1); y < Math.max(y0, y1); y++) out.push(`v ${x0} ${y}`);
    return out;
  }

  /** Net of every unit edge and pin, as a canonical partition (labels by first appearance). */
  function partition(wires: readonly Wire[], pins: readonly Point[], keys: readonly string[]) {
    const { wireNet, pinNet } = connect(pins, wires);
    const netOf = new Map<string, number>();
    wires.forEach((w, i) => {
      for (const e of unitEdges(w)) netOf.set(e, wireNet[i]!);
    });
    pins.forEach((p, i) => {
      netOf.set(`pin ${i} ${p}`, pinNet[i]!);
    });
    const relabel = new Map<number, number>();
    return keys.map((k) => {
      const net = netOf.get(k)!;
      if (!relabel.has(net)) relabel.set(net, relabel.size);
      return relabel.get(net);
    });
  }

  it.each(Array.from({ length: 20 }, (_, i) => i + 1))(
    'never changes connectivity or covered points (random circuit, seed %i)',
    (seed) => {
      const random = rng(seed);
      const int = (n: number) => Math.floor(random() * n);
      const wires: Wire[] = [];
      for (let i = 0; i < 60; i++) {
        const a: Point = [int(8), int(8)];
        // Documents never hold zero-length wires (a point on a crossing would join both).
        const length = 1 + int(4);
        const b: Point = random() < 0.5 ? [a[0] + length, a[1]] : [a[0], a[1] + length];
        // A third of them bus lines: a layer of their own, never merged with wires.
        const make = random() < 0.33 ? busLine : wire;
        wires.push(random() < 0.5 ? make(`w${i + 1}`, a, b) : make(`w${i + 1}`, b, a));
      }
      const pins: Point[] = Array.from({ length: 10 }, () => [int(10), int(10)] as Point);
      const before = circuit([], wires);
      const after = normalizeWires(before);
      expect(new Set(after.wires.map((w) => w.id)).size).toBe(after.wires.length);

      for (const bus of [false, true]) {
        const layer = (ws: readonly Wire[]) => ws.filter((w) => (w.bus === true) === bus);
        const input = layer(wires);
        const output = layer(after.wires);
        const edges = (ws: readonly Wire[]) => [...new Set(ws.flatMap(unitEdges))].sort();
        expect(edges(output)).toEqual(edges(input));
        const keys = [...edges(input), ...pins.map((p, i) => `pin ${i} ${p}`)];
        expect(partition(output, pins, keys)).toEqual(partition(input, pins, keys));

        // No zero-length wires, no two wires of a layer sharing a unit edge, plain wires plain.
        expect(output.every((w) => unitEdges(w).length > 0)).toBe(true);
        const all = output.flatMap(unitEdges);
        expect(new Set(all).size).toBe(all.length);
        if (!bus) expect(output.every((w) => !('bus' in w))).toBe(true);
      }
      // Idempotent.
      expect(normalizeWires(after)).toBe(after);
    },
  );

  it('keeps bus lines and wires apart', () => {
    // A bus continuing a wire end to end, a bus over a wire, a bus through a wire corner.
    const c = circuit(
      [],
      [
        wire('w1', [0, 0], [4, 0]),
        busLine('b1', [4, 0], [8, 0]),
        busLine('b2', [0, 2], [6, 2]),
        wire('w2', [0, 2], [6, 2]),
        wire('w3', [3, 4], [3, 6]),
        wire('w4', [3, 6], [5, 6]),
        busLine('b3', [3, 5], [3, 9]),
      ],
    );
    expect(normalizeWires(c)).toBe(c);
  });

  it('merges bus lines into bus lines', () => {
    const c = circuit(
      [],
      [busLine('b1', [0, 0], [4, 0]), busLine('b2', [4, 0], [8, 0]), wire('w1', [8, 0], [9, 0])],
    );
    expect(normalizeWires(c).wires).toEqual([
      busLine('b1', [0, 0], [8, 0]),
      wire('w1', [8, 0], [9, 0]),
    ]);
  });

  it('splits a bus line where buses pass through, not where wires do', () => {
    const c = circuit(
      [],
      [
        busLine('b1', [0, 0], [4, 0]),
        busLine('b2', [4, 0], [8, 0]),
        busLine('b3', [4, -2], [4, 2]), // a bus through the joint: stays split there
        busLine('b4', [0, 5], [4, 5]),
        busLine('b5', [4, 5], [8, 5]),
        wire('w1', [4, 3], [4, 7]), // a wire through the joint: the bus merges across it
      ],
    );
    expect(normalizeWires(c).wires).toEqual([
      busLine('b1', [0, 0], [4, 0]),
      busLine('b2', [4, 0], [8, 0]),
      busLine('b3', [4, -2], [4, 2]),
      busLine('b4', [0, 5], [8, 5]),
      wire('w1', [4, 3], [4, 7]),
    ]);
  });
});

describe('fragments', () => {
  const registry = testRegistry().register(
    defineComponent({
      type: 'test/switch',
      name: 'SW',
      title: 'Switch',
      designatorPrefix: 'SW',
      pins: [{ name: 'Y', dir: 'out' }],
      create: () => ({}),
    }),
  );

  it('copies the selected items as a standalone circuit', () => {
    const c = circuit(
      [part('U1'), part('U2')],
      [wire('w1', [0, 0], [1, 0]), wire('w2', [0, 0], [0, 1])],
    );
    const fragment = copyFragment(
      { ...c, probes: [{ ref: 'U2.Y' }] },
      { parts: ['U2'], wires: ['w2'] },
    );
    expect(fragment.components).toEqual([c.components[1]]);
    expect(fragment.wires).toEqual([c.wires[1]]);
    expect(fragment.probes).toEqual([]); // probes belong to the circuit
  });

  it('pastes with an offset, keeping free designators and renumbering taken ones', () => {
    const c = circuit(
      [part('U1'), part('U2'), part('SW1', 'test/switch')],
      [wire('w1', [0, 0], [1, 0])],
    );
    const fragment = circuit(
      [
        { ...part('U2', 'test/and', 1, 1), label: 'KEEP' },
        part('U7', 'test/and', 3, 1),
        part('SW1', 'test/switch'),
        part('Q1', 'nope/unknown'),
      ],
      [wire('w1', [1, 1], [3, 1])],
    );
    const pasted = pasteFragment(c, fragment, [10, 0], registry);
    expect(pasted.parts).toEqual(['U3', 'U7', 'SW2', 'Q1']);
    expect(pasted.wires).toEqual(['w2']);
    expect(pasted.circuit.components.slice(3)).toEqual([
      { ...part('U3', 'test/and', 11, 1), label: 'KEEP' },
      part('U7', 'test/and', 13, 1),
      part('SW2', 'test/switch', 10, 0),
      part('Q1', 'nope/unknown', 10, 0),
    ]);
    expect(pasted.circuit.wires[1]).toEqual(wire('w2', [11, 1], [13, 1]));
    // Pasting the same fragment again renumbers everything (unknown types get U).
    const again = pasteFragment(pasted.circuit, fragment, [20, 0], registry);
    expect(again.parts).toEqual(['U4', 'U5', 'SW3', 'U6']);
  });
});
