import { describe, expect, it } from 'vitest';
import {
  type AnyComponentDefinition,
  DEFAULT_DESIGNATOR_PREFIX,
  defineComponent,
  designatorPrefixOf,
  type PinDef,
} from './component';
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
});

describe('familyOf', () => {
  it('returns the part before the slash', () => {
    expect(familyOf('74xx/74hc00')).toBe('74xx');
    expect(familyOf('prim/nand')).toBe('prim');
  });
});
