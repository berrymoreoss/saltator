import { describe, expect, it } from 'vitest';
import {
  type AnyComponentDefinition,
  DEFAULT_DESIGNATOR_PREFIX,
  defineComponent,
  designatorPrefixOf,
  type PinDef,
} from './component';
import type { CpuDef } from './cpu';
import type { SignalsDef } from './inner-signals';
import { Level } from './logic';
import { createAccessStamps } from './memory';
import { familyOf, Registry } from './registry';
import type { SymbolDef } from './symbol';

const part = (type: string, extra: Partial<AnyComponentDefinition> = {}) =>
  defineComponent({ type, name: type, title: type, pins: [], create: () => ({}), ...extra });

describe('Registry', () => {
  it('registers and looks up definitions in order', () => {
    const a = part('prim/a');
    const b = part('prim/b');
    const registry = new Registry([a]).register(b);
    expect(registry.get('prim/a')).toBe(a);
    expect(registry.has('prim/b')).toBe(true);
    expect(registry.has('prim/c')).toBe(false);
    expect(registry.get('prim/c')).toBeUndefined();
    expect(registry.list()).toEqual([a, b]);
  });

  it('rejects duplicate types', () => {
    const registry = new Registry([part('prim/a')]);
    expect(() => registry.register(part('prim/a'))).toThrow('duplicate component type "prim/a"');
  });

  it.each(['', 'sw', 'SW1', 'S W', 'S_W'])('rejects designator prefix %j', (prefix) => {
    expect(() => new Registry([part('prim/a', { designatorPrefix: prefix })])).toThrow(
      `prim/a: invalid designator prefix "${prefix}"`,
    );
  });

  it('accepts uppercase designator prefixes; parts without one get U', () => {
    const registry = new Registry([part('io/a', { designatorPrefix: 'PWR' }), part('io/b')]);
    expect(designatorPrefixOf(registry.get('io/a')!)).toBe('PWR');
    expect(designatorPrefixOf(registry.get('io/b')!)).toBe(DEFAULT_DESIGNATOR_PREFIX);
    expect(DEFAULT_DESIGNATOR_PREFIX).toBe('U');
  });

  it.each(['nand', 'Prim/nand', 'prim/', '/nand', 'prim/nand/x', 'prim/tri state', 'prim/-a'])(
    'rejects malformed type id %j',
    (type) => {
      expect(() => new Registry([part(type)])).toThrow(`invalid type id "${type}"`);
    },
  );

  it.each(['74xx/74hc00', 'prim/tristate-buffer', 'cpu/w65c02s'])('accepts %j', (type) => {
    expect(new Registry([part(type)]).has(type)).toBe(true);
  });

  it('validates static pin lists', () => {
    const bad = part('prim/bad', {
      pins: [
        { name: 'A', dir: 'in' },
        { name: 'A', dir: 'in' },
      ],
    });
    expect(() => new Registry([bad])).toThrow('prim/bad: duplicate pin "A"');
  });

  it('validates prop-dependent pins with the default props', () => {
    const bad = part('prim/bad', {
      props: [{ key: 'n', label: 'N', type: 'integer', default: 2 }],
      pins: (props) => Array.from({ length: Number(props.n) }, () => ({ name: 'A', dir: 'in' })),
    });
    expect(() => new Registry([bad])).toThrow('prim/bad: duplicate pin "A"');
  });

  it('rejects definitions whose default props are invalid', () => {
    const bad = part('prim/bad', {
      props: [{ key: 'n', label: 'N', type: 'integer', default: 9, max: 8 }],
    });
    expect(() => new Registry([bad])).toThrow('prim/bad: prop "n" must be ≤ 8, got 9');
  });

  it('validates symbols, static or prop-dependent, with the default props', () => {
    const pins: PinDef[] = [{ name: 'A', dir: 'in' }];
    const symbol: SymbolDef = {
      kind: 'k',
      width: 2,
      height: 2,
      pins: { A: { side: 'left', offset: 1 } },
    };
    const good = part('prim/good', { pins, symbol });
    expect(new Registry([good]).has('prim/good')).toBe(true);

    const unplaced = part('prim/bad', { pins, symbol: { ...symbol, pins: {} } });
    expect(() => new Registry([unplaced])).toThrow('prim/bad: symbol does not place pin "A"');

    const tooSmall = part('prim/bad', { pins, symbol: () => ({ ...symbol, height: 0 }) });
    expect(() => new Registry([tooSmall])).toThrow('prim/bad: symbol height must be a positive');
  });

  it('validates function tables', () => {
    const table = { inputs: ['A'], outputs: ['Y'], rows: ['L | H', 'H | L'] };
    expect(new Registry([part('prim/good', { functionTable: table })]).has('prim/good')).toBe(true);
    const bad = part('prim/bad', { functionTable: { ...table, rows: ['L L | H'] } });
    expect(() => new Registry([bad])).toThrow(
      'prim/bad: function table row "L L | H": expected 1 inputs | 1 outputs',
    );
  });

  describe('memory parts', () => {
    const view = () => ({
      data: new Uint8Array(0),
      unknown: new Uint8Array(0),
      ...createAccessStamps(0),
    });
    const addressPins = ['A0', 'A1', 'A2', 'A3'];
    const pins: PinDef[] = [
      ...addressPins.map((name) => ({ name, dir: 'in' as const })),
      { name: 'DQ', dir: 'bidir' as const },
    ];
    const memory = { words: 16, width: 8, volatile: false, addressPins, view };
    const image = (max?: number) =>
      [{ key: 'contents', label: 'Contents', type: 'image', default: '', max }] as const;

    it('accepts a memory with an image prop of its size', () => {
      const rom = part('mem/rom', { pins, memory, props: image(16) });
      expect(new Registry([rom]).has('mem/rom')).toBe(true);
    });

    it.each([
      [{ ...memory, words: 0 }, 'mem/bad: memory words must be a positive integer, got 0'],
      [{ ...memory, words: 2.5 }, 'mem/bad: memory words must be a positive integer, got 2.5'],
      [{ ...memory, width: 9 }, 'mem/bad: memory width must be 1 to 8 bits, got 9'],
      [{ ...memory, width: 0 }, 'mem/bad: memory width must be 1 to 8 bits, got 0'],
      [{ ...memory, words: 32 }, 'mem/bad: 4 address pins select 16 words, the memory has 32'],
      [
        { ...memory, addressPins: ['A0', 'A1', 'A2', 'A9'] },
        'mem/bad: address pin "A9" is not an input pin',
      ],
      [
        { ...memory, addressPins: ['A0', 'A1', 'A2', 'DQ'] },
        'mem/bad: address pin "DQ" is not an input pin',
      ],
    ])('rejects a malformed size or address', (bad, message) => {
      expect(() => new Registry([part('mem/bad', { pins, memory: bad })])).toThrow(message);
    });

    it('rejects an image prop without its size, or of another size than the memory', () => {
      expect(() => new Registry([part('mem/bad', { props: image() })])).toThrow(
        'mem/bad: image prop "contents" needs its size in bytes as max',
      );
      expect(() => new Registry([part('mem/bad', { pins, memory, props: image(32) })])).toThrow(
        'mem/bad: image prop "contents" holds 32 bytes, the memory 16 words',
      );
    });
  });

  describe('CPU parts', () => {
    const pins: PinDef[] = [
      { name: 'A0', dir: 'tristate' },
      { name: 'A1', dir: 'tristate' },
      { name: 'D0', dir: 'bidir' },
      { name: 'VDD', dir: 'power' },
      { name: 'NC', dir: 'nc' },
    ];
    const cpu: CpuDef = {
      registers: [
        { name: 'A', width: 8 },
        { name: 'PC', width: 16 },
        { name: 'P', width: 8, flags: 'NV-BDIZC' },
      ],
      programCounter: 'PC',
      addressPins: ['A0', 'A1'],
      dataPins: ['D0'],
      view: () => ({ values: [0, 0, 0], unknown: [0, 0, 0], mode: 'unknown' }),
    };

    it('accepts a well-formed CPU', () => {
      expect(new Registry([part('cpu/ok', { pins, cpu })]).has('cpu/ok')).toBe(true);
    });

    it.each<[Partial<CpuDef>, string]>([
      [{ registers: [] }, 'a CPU needs registers; program counter "PC" is not a register'],
      [
        {
          registers: [
            { name: 'PC', width: 16 },
            { name: 'PC', width: 8 },
          ],
        },
        'duplicate register "PC"',
      ],
      [{ registers: [{ name: '1A', width: 8 }, ...cpu.registers] }, 'invalid register name "1A"'],
      [{ registers: [{ name: 'PC', width: 33 }] }, 'register PC must be 1 to 32 bits wide, got 33'],
      [{ registers: [{ name: 'PC', width: 0.5 }] }, 'register PC must be 1 to 32 bits wide'],
      [
        {
          registers: [
            { name: 'PC', width: 16 },
            { name: 'P', width: 8, flags: 'NVBDIZC' },
          ],
        },
        `register P's flags "NVBDIZC" must name 8 bits`,
      ],
      [{ programCounter: 'IP' }, 'program counter "IP" is not a register'],
      [{ addressPins: [] }, 'a CPU needs address pins'],
      [{ addressPins: ['A0', 'A9'] }, 'address pin "A9" is not a signal pin of the part'],
      [{ dataPins: ['VDD'] }, 'data pin "VDD" is not a signal pin of the part'],
      [{ dataPins: ['NC'] }, 'data pin "NC" is not a signal pin of the part'],
    ])('rejects a malformed CPU (%#)', (bad, message) => {
      expect(() => new Registry([part('cpu/bad', { pins, cpu: { ...cpu, ...bad } })])).toThrow(
        `cpu/bad: ${message}`,
      );
    });
  });

  describe('inner signals (HDL-4)', () => {
    const signals = (list: SignalsDef['list']): SignalsDef => ({ list, level: () => Level.X });

    it('accepts named signals', () => {
      const ok = signals([
        { name: 'state', lsb: 0, width: 2 },
        { name: 'u_core.count', lsb: 4, width: 4, src: 'core.v:3' },
      ]);
      expect(new Registry([part('hdl/ok', { signals: ok })]).has('hdl/ok')).toBe(true);
    });

    it.each<[SignalsDef['list'], string]>([
      [[{ name: '', lsb: 0, width: 1 }], 'an inner signal has no name'],
      [
        [
          { name: 'q', lsb: 0, width: 1 },
          { name: 'q', lsb: 0, width: 2 },
        ],
        'inner signal q twice',
      ],
      [[{ name: 'q', lsb: 0, width: 0 }], 'inner signal q: width 0'],
      [[{ name: 'q', lsb: 0.5, width: 1 }], 'inner signal q: lsb 0.5'],
    ])('rejects malformed ones (%#)', (list, message) => {
      expect(() => new Registry([part('hdl/bad', { signals: signals(list) })])).toThrow(
        `hdl/bad: ${message}`,
      );
    });
  });
});

describe('familyOf', () => {
  it('returns the part before the slash', () => {
    expect(familyOf('74xx/74hc00')).toBe('74xx');
    expect(familyOf('prim/nand')).toBe('prim');
  });
});
