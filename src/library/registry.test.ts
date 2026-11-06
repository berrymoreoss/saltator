import { describe, expect, it } from 'vitest';
import { designatorPrefixOf, familyOf } from '../core';
import { createDefaultRegistry } from './registry';

describe('createDefaultRegistry', () => {
  it('contains every primitive and IO part', () => {
    expect(
      createDefaultRegistry()
        .list()
        .map((d) => d.type),
    ).toEqual([
      'prim/buffer',
      'prim/not',
      'prim/and',
      'prim/or',
      'prim/nand',
      'prim/nor',
      'prim/xor',
      'prim/xnor',
      'prim/tristate-buffer',
      'prim/constant',
      'prim/pull',
      'io/vcc',
      'io/gnd',
      'io/switch',
      'io/button',
      'io/dip-switch',
      'io/clock',
      'io/led',
      'io/led-bar',
      'io/seven-segment',
      'io/hex-display',
      'io/probe',
    ]);
  });

  it('gives every part a name, a title and search keywords', () => {
    for (const d of createDefaultRegistry().list()) {
      expect(d.name, d.type).not.toBe('');
      expect(d.title, d.type).not.toBe('');
      expect(d.keywords?.length, d.type).toBeGreaterThan(0);
      expect(['prim', 'io']).toContain(familyOf(d.type));
    }
  });

  it('gives every part its conventional designator prefix', () => {
    const prefixes = Object.fromEntries(
      createDefaultRegistry()
        .list()
        .map((d) => [d.type, designatorPrefixOf(d)]),
    );
    expect(prefixes).toEqual({
      'prim/buffer': 'U',
      'prim/not': 'U',
      'prim/and': 'U',
      'prim/or': 'U',
      'prim/nand': 'U',
      'prim/nor': 'U',
      'prim/xor': 'U',
      'prim/xnor': 'U',
      'prim/tristate-buffer': 'U',
      'prim/constant': 'U',
      'prim/pull': 'R',
      'io/vcc': 'PWR',
      'io/gnd': 'PWR',
      'io/switch': 'SW',
      'io/button': 'SW',
      'io/dip-switch': 'SW',
      'io/clock': 'X',
      'io/led': 'D',
      'io/led-bar': 'D',
      'io/seven-segment': 'DS',
      'io/hex-display': 'DS',
      'io/probe': 'TP',
    });
  });

  it('returns a fresh registry each time', () => {
    const a = createDefaultRegistry();
    const b = createDefaultRegistry();
    expect(a).not.toBe(b);
    expect(a.list()).toEqual(b.list());
  });
});
