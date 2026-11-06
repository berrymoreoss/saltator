import { describe, expect, it } from 'vitest';
import { type AnyComponentDefinition, defineComponent } from './component';
import { familyOf, Registry } from './registry';

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
});

describe('familyOf', () => {
  it('returns the part before the slash', () => {
    expect(familyOf('74xx/74hc00')).toBe('74xx');
    expect(familyOf('prim/nand')).toBe('prim');
  });
});
