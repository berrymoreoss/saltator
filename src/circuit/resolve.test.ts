import { describe, expect, it } from 'vitest';
import { compileCircuit } from './compile';
import { compileDesign } from './design';
import {
  type Circuit,
  type CircuitDocument,
  type ComponentInstance,
  emptyVerilogCircuit,
  SCHEMA_VERSION,
  type Wire,
} from './document';
import { partLayout, placementOf, placePins } from './layout';
import { compareDesignators, parseAddress, Resolver } from './resolve';
import { documentRegistry } from './subcircuit';
import { testModule, testRegistry } from './test-parts';

const registry = testRegistry();

// Pin positions at (x, y): test/high Y (x+5, y+1); test/and A (x, y+1), B (x, y+2), Y (x+5, y+1);
// test/rom A0 (x, y+1), A1 (x, y+2), Y (x+5, y+1); test/label N (x, y).
const part = (id: string, type: string, x: number, y: number, props = {}): ComponentInstance => ({
  id,
  type,
  x,
  y,
  rotation: 0,
  flip: false,
  props,
});
const wire = (id: string, x1: number, y1: number, x2: number, y2: number): Wire => ({
  id,
  from: [x1, y1],
  to: [x2, y2],
});

// H1.Y ─ U1.A, named CLK and TICK by labels; U1.Y labelled D1; ROMs U10 and U2 (A0 on D0 by a label).
const circuit: Circuit = {
  id: 'main',
  name: 'Main',
  components: [
    part('H1', 'test/high', 0, 0),
    part('U1', 'test/and', 10, 0),
    part('NL1', 'test/label', 7, 1, { name: 'CLK' }),
    part('NL4', 'test/label', 8, 1, { name: 'TICK' }), // a second name: the net is called CLK
    part('NL2', 'test/label', 18, 1, { name: 'D1' }),
    part('U10', 'test/rom', 30, 0),
    part('U2', 'test/rom', 30, 10),
    part('NL3', 'test/label', 27, 11, { name: 'D0' }),
  ],
  wires: [
    wire('w1', 5, 1, 10, 1),
    wire('w2', 15, 1, 18, 1),
    wire('w3', 27, 11, 30, 11),
    wire('w4', 40, 20, 42, 20),
  ],
  probes: [],
  testScript: [],
};

const resolver = new Resolver(compileCircuit(circuit, registry), registry);

describe('Resolver', () => {
  it('resolves parts and their pins, with the net each pin is on', () => {
    expect(resolver.resolve('U1')).toEqual({ kind: 'part', part: 'U1', type: 'test/and' });
    expect(resolver.resolve(' U1 ')).toEqual({ kind: 'part', part: 'U1', type: 'test/and' });
    expect(resolver.resolve('U1.A')).toEqual({ kind: 'pin', part: 'U1', pin: 'A', net: 'CLK' });
    expect(resolver.resolve('U1.B')).toEqual({ kind: 'pin', part: 'U1', pin: 'B', net: 'U1.B' });
  });

  it('resolves nets by name or by id', () => {
    expect(resolver.resolve('CLK')).toEqual({ kind: 'net', net: 'CLK' });
    expect(resolver.resolve('TICK')).toEqual({ kind: 'net', net: 'CLK' });
    expect(resolver.resolve('D1')).toEqual({ kind: 'net', net: 'D1' });
    expect(resolver.resolve('w4')).toEqual({ kind: 'net', net: 'w4' });
  });

  it('resolves a bus to its members bit 0 first, unnamed members undefined', () => {
    expect(resolver.resolve('D[0..3]')).toEqual({
      kind: 'bus',
      bus: 'D[0..3]',
      members: ['D0', 'D1', undefined, undefined],
    });
    expect(resolver.resolve('D[1..0]')).toMatchObject({ members: ['D0', 'D1'] });
  });

  it.each([
    ['', 'empty reference'],
    ['U9', 'no part or net named U9'],
    ['U9.A', 'no part U9'],
    ['U1.Q', 'U1 has no pin Q'],
    ['NL1', 'no part or net named NL1'], // net labels are not simulated
    ['Q[0..7]', 'no net of Q[0..7] is named on this circuit'],
    ['U1/D0', 'U1 is not a subcircuit'],
    ['A9/D0', 'no instance A9'],
  ])('explains %j: %s', (reference, message) => {
    expect(resolver.resolve(reference)).toBe(message);
  });

  it('resolves what a probe shows: a net, a pin, a bus, a group of single signals', () => {
    expect(resolver.signal('CLK')).toEqual({ bits: ['CLK'], keys: ['CLK'], vector: false });
    expect(resolver.signal('U1.B')).toEqual({ bits: ['U1.B'], keys: ['U1.B'], vector: false });
    expect(resolver.signal(' D[0..1]')).toEqual({
      bits: ['D0', 'D1'],
      keys: ['D0', 'D1'],
      vector: true,
    });
    expect(resolver.signal('U1')).toBe('U1 is a part: probe one of its pins');
    expect(resolver.signal('U9.A')).toBe('no part U9');
    expect(resolver.probe({ ref: 'TICK', name: 'tick' })).toEqual({
      bits: ['CLK'],
      keys: ['TICK'],
      vector: false,
    });
    expect(resolver.probe({ name: 'G', members: ['D0', 'U1.Y', 'CLK'] })).toEqual({
      bits: ['D0', 'D1', 'CLK'],
      keys: ['D0', 'U1.Y', 'CLK'],
      vector: true,
    });
    expect(resolver.probe({ name: 'G', members: ['CLK', 'U9.Y'] })).toBe('U9.Y: no part U9');
    expect(resolver.probe({ name: 'G', members: ['D[0..1]'] })).toBe(
      "D[0..1] is a bus: a group's members are single signals",
    );
  });

  it('names a net to probe it by: its name, else a pin on it, a driving one first', () => {
    expect(resolver.netReference('CLK')).toBe('CLK');
    expect(resolver.netReference('U1.B')).toBe('U1.B');
    const unnamed = new Resolver(
      compileCircuit(
        {
          ...circuit,
          components: [part('U3', 'test/and', 20, 0), part('U1', 'test/and', 10, 0)],
          wires: [wire('w1', 15, 1, 18, 1), wire('w2', 18, 1, 18, 2), wire('w3', 18, 2, 20, 2)],
        },
        registry,
      ),
      registry,
    );
    // U3.B, an input, comes first on the net (U3 is first in the document); U1.Y drives it.
    const target = unnamed.resolve('U3.B');
    expect(target).toMatchObject({ kind: 'pin' });
    const net = (target as { net: string }).net;
    expect(unnamed.netReference(net)).toBe('U1.Y');
    expect(unnamed.netReference('nothing')).toBeUndefined();
    expect(resolver.netReference('w4')).toBeUndefined(); // a wire on no pin
  });

  it('resolves cells of a memory part: one address or a range, as the memory tools take them', () => {
    const rom = registry.get('test/rom')!.memory!;
    const cells = (from: number, to: number) => ({
      kind: 'cells',
      part: 'U2',
      type: 'test/rom',
      memory: rom,
      from,
      to,
    });
    expect(resolver.resolve('U2[3]')).toEqual(cells(3, 3));
    expect(resolver.resolve(' U2[ 0x1 .. $2 ] ')).toEqual(cells(1, 2));
    expect(resolver.resolve('U2[3h..1]')).toEqual(cells(1, 3)); // either way round
    expect(resolver.resolve('U2[0..1]')).toEqual(cells(0, 1)); // a memory wins over a bus name
    expect(resolver.resolve('U2[4]')).toBe('U2[4]: The last address is 3.');
    expect(resolver.resolve('U2[0..q]')).toBe('U2[q]: Type a hex address, 0 to 3.');
    expect(resolver.resolve('U1[0]')).toBe('U1 holds no memory');
    expect(resolver.resolve('U9[0]')).toBe('no part or net named U9[0]');
    expect(resolver.signal('U2[1]')).toBe('U2[1] is memory, not a signal');
  });

  it('lists the simulated parts and, in designator order, the memories', () => {
    expect(resolver.parts.map((p) => p.id)).toEqual(['H1', 'U1', 'U10', 'U2']);
    const memories = resolver.memories();
    expect(memories.map((m) => [m.id, m.type, m.memory.words])).toEqual([
      ['U2', 'test/rom', 4],
      ['U10', 'test/rom', 4],
    ]);
    expect(memories[0]!.definition).toBe(registry.get('test/rom'));
  });
});

describe('parseAddress', () => {
  it('reads hex with or without a prefix, within the memory', () => {
    expect(['7f0', '0x7F0', '$7f0', '7F0h', ' 7f0 '].map((t) => parseAddress(t, 2048))).toEqual([
      0x7f0, 0x7f0, 0x7f0, 0x7f0, 0x7f0,
    ]);
    expect(parseAddress('800', 2048)).toBe('The last address is 7FF.');
    expect(parseAddress('xyz', 2048)).toBe('Type a hex address, 0 to 7FF.');
    expect(parseAddress('', 2048)).toBe('Type a hex address, 0 to 7FF.');
  });
});

describe('compareDesignators', () => {
  it('counts the numbers in designators', () => {
    expect(['U10', 'U2', 'SW1', 'U1', 'U1A'].sort(compareDesignators)).toEqual([
      'SW1',
      'U1',
      'U1A',
      'U2',
      'U10',
    ]);
  });
});

describe('Resolver over a design', () => {
  // `cell`: a ROM U1 (A0 on the port IN, Y on the port OUT), an AND U2 (A on the label LOCAL),
  // the bus port D[0..1] with entries D0 → U2.B. The top: H1 → A1.IN; A1.OUT → A2.IN by a label
  // LINK; a top-level label R/W and a ROM U3; nested: A2 is a `pair` holding cells B1, B2.
  const port = (id: string, name: string, x: number, y: number, direction = 'in') =>
    part(id, 'test/port', x, y, { name, direction, side: 'auto' });
  const label = (id: string, name: string, x: number, y: number) =>
    part(id, 'test/label', x, y, { name });
  const cell: Circuit = {
    id: 'cell',
    name: 'Cell',
    components: [
      part('U1', 'test/rom', 0, 0),
      port('P1', 'IN', 0, 1),
      port('P2', 'OUT', 5, 1, 'out'),
      part('U2', 'test/and', 20, 0),
      label('NL1', 'LOCAL', 20, 1),
      label('NL2', 'LOCAL', 30, 30),
      part('BE1', 'test/bus-entry', 20, 2, { name: 'D0' }),
      port('P3', 'D[0..1]', 23, 8),
    ],
    wires: [{ id: 'b1', from: [23, 3], to: [23, 8], bus: true }],
    probes: [],
    testScript: [],
  };
  const pair: Circuit = {
    id: 'pair',
    name: 'Pair',
    components: [part('B1', 'sub/cell', 0, 0), part('B2', 'sub/cell', 0, 30)],
    wires: [],
    probes: [],
    testScript: [],
  };
  const shell = (components: ComponentInstance[]): Circuit => ({
    id: 'main',
    name: 'Main',
    components,
    wires: [],
    probes: [],
    testScript: [],
  });
  const base = [
    part('H1', 'test/high', -20, 0),
    part('A1', 'sub/cell', 0, 0),
    part('A2', 'sub/pair', 0, 40),
    part('U3', 'test/rom', 60, 0),
  ];
  const draft = { schemaVersion: SCHEMA_VERSION, circuits: [shell(base), cell, pair] } as const;
  const pinAt = (ref: string) => {
    const [id, pin] = [ref.slice(0, ref.indexOf('.')), ref.slice(ref.indexOf('.') + 1)];
    const docRegistry = documentRegistry(draft, registry);
    const instance = base.find((c) => c.id === id)!;
    const placed = placePins(
      partLayout(docRegistry.get(instance.type)!, instance.props),
      placementOf(instance),
    );
    return placed.find((p) => p.name === pin)!.at;
  };
  const [hx, hy] = [-15, 1];
  const top = shell([
    ...base,
    label('NLH', 'HIGH', hx, hy),
    label('NLA', 'HIGH', ...pinAt('A1.IN')),
    label('NLL1', 'LINK', ...pinAt('A1.OUT')),
    label('NLRW', 'R/W', 70, 70),
  ]);
  const design = compileDesign(
    { schemaVersion: SCHEMA_VERSION, circuits: [top, cell, pair] },
    registry,
  );
  const r = new Resolver(design, registry);

  it('resolves parts, pins and nets inside instances by path', () => {
    expect(r.resolve('A1/U1')).toEqual({ kind: 'part', part: 'A1/U1', type: 'test/rom' });
    expect(r.resolve('A1/U1.A0')).toEqual({ kind: 'pin', part: 'A1/U1', pin: 'A0', net: 'HIGH' });
    expect(r.resolve('A1/LOCAL')).toEqual({ kind: 'net', net: 'A1/LOCAL' });
    expect(r.resolve('A1/U1.Y')).toEqual({ kind: 'pin', part: 'A1/U1', pin: 'Y', net: 'LINK' });
    expect(r.resolve('A2/B2/U2.A')).toEqual({
      kind: 'pin',
      part: 'A2/B2/U2',
      pin: 'A',
      net: 'A2/B2/LOCAL',
    });
    // The port's name inside is the outer net it joins.
    expect(r.resolve('A1/IN')).toEqual({ kind: 'net', net: 'HIGH' });
  });

  it('resolves an instance pin as the net it is on, a bus pin as its bits inside', () => {
    expect(r.resolve('A1.IN')).toEqual({ kind: 'net', net: 'HIGH' });
    expect(r.resolve('A1.D[0..1]')).toEqual({
      kind: 'bus',
      bus: 'A1.D[0..1]',
      members: ['A1/D0', undefined], // nothing names D1 inside, and the pin is open
    });
    expect(r.resolve('A1/D[0..1]')).toMatchObject({ kind: 'bus', bus: 'A1/D[0..1]' });
    expect(r.resolve('A1.NOPE')).toBe('A1 has no pin NOPE');
  });

  it('resolves memory cells inside instances, and lists every memory by path', () => {
    expect(r.resolve('A2/B1/U1[2..3]')).toMatchObject({
      kind: 'cells',
      part: 'A2/B1/U1',
      from: 2,
      to: 3,
    });
    expect(r.resolve('A1/U1[9]')).toBe('A1/U1[9]: The last address is 3.');
    expect(r.memories().map((m) => m.id)).toEqual(['A1/U1', 'A2/B1/U1', 'A2/B2/U1', 'U3']);
  });

  it('keeps a name with a slash a top-level net, and explains paths that go nowhere', () => {
    expect(r.resolve('R/W')).toEqual({ kind: 'net', net: 'R/W' });
    expect(r.resolve('A1')).toBe('A1 is a subcircuit: name a part or a signal inside it (A1/…)');
    expect(r.resolve('A2/B1')).toBe(
      'A2/B1 is a subcircuit: name a part or a signal inside it (A2/B1/…)',
    );
    expect(r.resolve('A1/U9')).toBe('no part or net named A1/U9');
    expect(r.resolve('A1/U9.Y')).toBe('no part A1/U9');
    expect(r.resolve('A2/B9/U1')).toBe('no instance B9 in A2');
    expect(r.resolve('A1/U1/X')).toBe('U1 is not a subcircuit');
  });

  it('names each flat net from its outermost circuit', () => {
    expect(r.netReference('HIGH')).toBe('HIGH');
    expect(r.netReference('A1/LOCAL')).toBe('A1/LOCAL');
    expect(r.netReference('A2/B2/LOCAL')).toBe('A2/B2/LOCAL');
    // An unnamed net inside: a driving pin there.
    expect(r.netReference(design.netOf('A2/B1', 'U2.Y')!)).toBe('A2/B1/U2.Y');
    // An open instance pin's net: the pin.
    expect(r.netReference('A2.B1')).toBeUndefined();
    expect(r.netReference(design.netOf('A1', 'OUT')!)).toBe('LINK');
    expect(r.signal('A1/U1.Y')).toEqual({ bits: ['LINK'], keys: ['A1/U1.Y'], vector: false });
  });
});

describe('Resolver: signals inside Verilog modules (HDL-4)', () => {
  // `gate` (testModule) keeps `and_y`, `held` and `u1.word[6:4]`; the top places it as A1 and,
  // through the subcircuit S1, as S1/B1.
  const gate: Circuit = { ...emptyVerilogCircuit('gate', 'Gate'), verilog: { module: testModule } };
  const shell = (id: string, components: ComponentInstance[]): Circuit => ({
    id,
    name: id,
    components,
    wires: [],
    probes: [],
    testScript: [],
  });
  const document: CircuitDocument = {
    schemaVersion: SCHEMA_VERSION,
    circuits: [
      shell('main', [part('A1', 'sub/gate', 0, 0), part('S1', 'sub/holder', 0, 40)]),
      shell('holder', [part('B1', 'sub/gate', 0, 0)]),
      gate,
    ],
  };
  const design = compileDesign(document, registry);
  const r = new Resolver(design, design.registry);
  const inner = (part: string, signal: number, bits: number[]) =>
    bits.map((bit) => ({ part, signal, bit }));

  it('resolves a named signal inside an instance by path, as a net inside a subcircuit', () => {
    expect(r.resolve('A1/and_y')).toEqual({
      kind: 'inner',
      part: 'A1/U1',
      type: 'hdl/gate',
      signal: 0,
      name: 'A1/and_y',
      lsb: 0,
      width: 1,
      bits: [0],
    });
    expect(r.signal('A1/held')).toEqual({
      bits: inner('A1/U1', 1, [0]),
      keys: ['A1/held'],
      vector: false,
    });
    expect(r.signal('S1/B1/and_y')).toEqual({
      bits: inner('S1/B1/U1', 0, [0]),
      keys: ['S1/B1/and_y'],
      vector: false,
    });
  });

  it("keeps a flattened submodule's dots, and reads a vector as a value bit by bit", () => {
    expect(r.signal('A1/u1.word')).toEqual({
      bits: inner('A1/U1', 2, [0, 1, 2]),
      keys: ['A1/u1.word[4]', 'A1/u1.word[5]', 'A1/u1.word[6]'],
      vector: true,
    });
  });

  it("slices by the signal's own indices, Verilog's way or the app's, low bit first", () => {
    const low = { bits: inner('A1/U1', 2, [0, 1]), keys: ['A1/u1.word[4]', 'A1/u1.word[5]'] };
    expect(r.signal('A1/u1.word[5:4]')).toEqual({ ...low, vector: true });
    expect(r.signal('A1/u1.word[4..5]')).toEqual({ ...low, vector: true });
    expect(r.signal('A1/u1.word[ 5 : 4 ]')).toEqual({ ...low, vector: true });
    expect(r.signal('A1/u1.word[6]')).toEqual({
      bits: inner('A1/U1', 2, [2]),
      keys: ['A1/u1.word[6]'],
      vector: false,
    });
    expect(r.signal('A1/u1.word[3:0]')).toBe('A1/u1.word is u1.word[6:4]: no bit 3');
    expect(r.signal('A1/held[1]')).toBe('A1/held is held, one bit: no bit 1');
  });

  it('says which signals there are when a name is wrong', () => {
    expect(r.signal('A1/hold')).toBe(
      'no part, net or signal named hold in A1 (signals: and_y, held, u1.word)',
    );
    expect(r.signal('A9/held')).toBe('no instance A9');
  });

  it('leaves what names a pin or a net as it was', () => {
    // The module's part, its pins, and its port nets inside the instance.
    expect(r.resolve('A1/U1')).toEqual({ kind: 'part', part: 'A1/U1', type: 'hdl/gate' });
    expect(r.signal('A1/U1.y')).toEqual({
      bits: [design.netOf('A1', 'y')],
      keys: ['A1/U1.y'],
      vector: false,
    });
    expect(r.signal('A1.y')).toEqual({
      bits: [design.netOf('A1', 'y')],
      keys: ['A1.y'],
      vector: false,
    });
    expect(r.signal('A1/d[1..0]')).toMatchObject({
      bits: [design.netOf('A1', 'd0'), design.netOf('A1', 'd1')],
    });
  });

  it("names a module's signals without a path in its own scope (its own benches)", () => {
    const own = compileDesign(document, registry, { top: 'gate' });
    const alone = new Resolver(own, own.registry);
    expect(alone.signal('held')).toEqual({
      bits: inner('U1', 1, [0]),
      keys: ['held'],
      vector: false,
    });
    expect(alone.signal('hold')).toBe(
      'no part, net or signal named hold in this module (signals: and_y, held, u1.word)',
    );
  });

  it('finds no signals in a module that has none, nor in a plain circuit', () => {
    const bare = { ...gate, verilog: { module: { ...testModule, signals: [] } } };
    const plain = compileDesign(
      { ...document, circuits: [document.circuits[0]!, document.circuits[1]!, bare] },
      registry,
    );
    expect(new Resolver(plain, plain.registry).signal('A1/held')).toBe(
      'no part, net or signal named held in A1: it keeps no named signals',
    );
    expect(r.signal('S1/held')).toBe('no part or net named S1/held');
  });
});
