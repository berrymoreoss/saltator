import { describe, expect, it } from 'vitest';
import { defineComponent, type PinDef } from './component';
import { NetlistBuilder, NetlistError, resolveNetlist } from './netlist';
import { Registry } from './registry';

const registry = new Registry([
  defineComponent<{ inputs: number }, unknown>({
    type: 'test/gate',
    name: 'G',
    title: 'Gate',
    pins: ({ inputs }) => [
      ...Array.from({ length: inputs }, (_, i): PinDef => ({ name: 'ABCDEFGH'[i]!, dir: 'in' })),
      { name: 'Y', dir: 'out' },
    ],
    props: [{ key: 'inputs', label: 'Inputs', type: 'integer', default: 2, min: 2, max: 8 }],
    create: () => ({}),
  }),
  defineComponent({
    type: 'test/chip',
    name: 'C',
    title: 'Chip',
    pins: [
      { name: 'A', dir: 'in' },
      { name: 'Y', dir: 'out' },
      { name: 'VCC', dir: 'power' },
      { name: 'NC', dir: 'nc' },
    ],
    create: () => ({}),
  }),
]);

const problemsOf = (fn: () => unknown): readonly string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof NetlistError) return error.problems;
    throw error;
  }
  throw new Error('expected a NetlistError');
};

describe('NetlistBuilder', () => {
  it('builds components and nets', () => {
    const netlist = new NetlistBuilder()
      .add('U1', 'test/gate')
      .add('U2', 'test/gate', { inputs: 3 })
      .connect('U1.Y', 'U2.A')
      .connect({ component: 'U2', pin: 'Y' }, 'U1.A')
      .build();
    expect(netlist).toEqual({
      components: [
        { id: 'U1', type: 'test/gate' },
        { id: 'U2', type: 'test/gate', props: { inputs: 3 } },
      ],
      nets: [
        {
          id: 'U1.Y',
          pins: [
            { component: 'U1', pin: 'Y' },
            { component: 'U2', pin: 'A' },
          ],
        },
        {
          id: 'U2.Y',
          pins: [
            { component: 'U2', pin: 'Y' },
            { component: 'U1', pin: 'A' },
          ],
        },
      ],
    });
  });

  it('merges nets when a pin is connected twice (union-find)', () => {
    const netlist = new NetlistBuilder()
      .connect('U1.Y', 'U2.A')
      .connect('U3.Y', 'U4.A')
      .connect('U4.A', 'U2.A')
      .build();
    expect(netlist.nets).toHaveLength(1);
    expect(netlist.nets[0]!.id).toBe('U1.Y');
    expect(netlist.nets[0]!.pins.map((p) => `${p.component}.${p.pin}`)).toEqual([
      'U1.Y',
      'U2.A',
      'U3.Y',
      'U4.A',
    ]);
  });

  it('handles long chains', () => {
    const b = new NetlistBuilder();
    for (let i = 0; i < 2000; i++) b.connect(`U${i}.Y`, `U${i + 1}.Y`);
    const nets = b.build().nets;
    expect(nets).toHaveLength(1);
    expect(nets[0]!.pins).toHaveLength(2001);
  });

  it('names nets, and keeps names when merging', () => {
    const netlist = new NetlistBuilder()
      .net('CLK', 'U1.Y', 'U2.A')
      .connect('U3.A', 'U4.A')
      .connect('U3.A', 'U2.A')
      .connect('U6.A')
      .build();
    expect(netlist.nets.map((n) => [n.id, n.pins.length])).toEqual([
      ['CLK', 4],
      ['U6.A', 1],
    ]);
  });

  it('joins nets that use the same name (like net labels)', () => {
    const netlist = new NetlistBuilder().net('CLK', 'U1.Y').net('CLK', 'U2.A', 'U3.A').build();
    expect(netlist.nets.map((n) => [n.id, n.pins.length])).toEqual([['CLK', 3]]);
  });

  it('moves the name when the named net is merged into an unnamed one', () => {
    const netlist = new NetlistBuilder()
      .connect('U1.Y', 'U2.A')
      .net('BUS', 'U3.Y')
      .connect('U2.A', 'U3.Y')
      .build();
    expect(netlist.nets.map((n) => n.id)).toEqual(['BUS']);
  });

  it('rejects conflicting names', () => {
    const b = new NetlistBuilder().net('A', 'U1.Y').net('B', 'U2.Y');
    expect(() => b.connect('U1.Y', 'U2.Y')).toThrow('connecting nets "A" and "B"');
    expect(() => b.net('C', 'U1.Y')).toThrow('net "C" is already named "A"');
    expect(() => b.net('A', 'U2.Y')).toThrow('connecting nets "A" and "B"');
    expect(() => b.net('D')).toThrow('net "D" needs at least one pin');
  });

  it('rejects bad ids and pin references', () => {
    const b = new NetlistBuilder().add('U1', 'test/gate');
    expect(() => b.add('U1', 'test/gate')).toThrow('duplicate component id "U1"');
    expect(() => b.add('U.1', 'test/gate')).toThrow('bad component id "U.1"');
    expect(() => b.add('', 'test/gate')).toThrow('bad component id ""');
    for (const bad of ['U1', '.Y', 'U1.']) {
      expect(() => b.connect(bad)).toThrow(`bad pin reference "${bad}"`);
    }
  });
});

describe('resolveNetlist', () => {
  it('resolves definitions, props, pins and indices', () => {
    const netlist = new NetlistBuilder()
      .add('U1', 'test/gate', { inputs: 3 })
      .add('U2', 'test/chip')
      .connect('U1.Y', 'U2.A')
      .build();
    const resolved = resolveNetlist(netlist, registry);
    expect(
      resolved.components.map((c) => [c.id, c.definition.type, c.props, c.pins.length]),
    ).toEqual([
      ['U1', 'test/gate', { inputs: 3 }, 4],
      ['U2', 'test/chip', {}, 4],
    ]);
    expect(resolved.nets[0]).toEqual({
      id: 'U1.Y',
      pins: [
        { component: 0, pin: 3 },
        { component: 1, pin: 0 },
      ],
      implicit: false,
    });
  });

  it('gives unconnected pins implicit nets, except power and nc', () => {
    const netlist = new NetlistBuilder().add('U1', 'test/chip').connect('U1.A').build();
    const resolved = resolveNetlist(netlist, registry);
    expect(resolved.nets.map((n) => [n.id, n.implicit])).toEqual([
      ['U1.A', false],
      ['U1.Y', true],
    ]);
  });

  it('keeps implicit net ids unique', () => {
    const netlist = {
      components: [{ id: 'U1', type: 'test/chip' }],
      nets: [{ id: 'U1.Y', pins: [{ component: 'U1', pin: 'A' }] }],
    };
    expect(resolveNetlist(netlist, registry).nets.map((n) => n.id)).toEqual(['U1.Y', 'U1.Y#2']);
  });

  it('lists every problem at once', () => {
    const netlist = {
      components: [
        { id: 'U1', type: 'test/gate' },
        { id: 'U1', type: 'test/gate' },
        { id: 'U2', type: 'test/nope' },
        { id: 'U3', type: 'test/gate', props: { inputs: 12 } },
      ],
      nets: [
        { id: 'n1', pins: [{ component: 'U1', pin: 'Q' }] },
        {
          id: 'n2',
          pins: [
            { component: 'U9', pin: 'A' },
            { component: 'U2', pin: 'A' },
            { component: 'U1', pin: 'A' },
          ],
        },
        { id: 'n2', pins: [{ component: 'U1', pin: 'A' }] },
      ],
    };
    expect(problemsOf(() => resolveNetlist(netlist, registry))).toEqual([
      'duplicate component id "U1"',
      'U2: unknown component type "test/nope"',
      'U3: prop "inputs" must be ≤ 8, got 12',
      'net "n1": component "U1" has no pin "Q" (pins: A, B, Y)',
      'net "n2": unknown component "U9"',
      'duplicate net id "n2"',
      'pin U1.A is on two nets: "n2" and "n2"',
    ]);
  });

  it('reports duplicate pin names from prop-dependent pin lists', () => {
    const bad = new Registry([
      defineComponent({
        type: 'test/bad',
        name: 'B',
        title: 'Bad',
        pins: () => [
          { name: 'A', dir: 'in' },
          { name: 'A', dir: 'in' },
        ],
        create: () => ({}),
      }),
    ]);
    const netlist = new NetlistBuilder().add('U1', 'test/bad').build();
    expect(problemsOf(() => resolveNetlist(netlist, bad))).toEqual(['U1: duplicate pin "A"']);
  });

  it('formats the error message', () => {
    const error = new NetlistError(['a', 'b']);
    expect(error.message).toBe('invalid netlist:\n  a\n  b');
    expect(error.name).toBe('NetlistError');
  });
});
