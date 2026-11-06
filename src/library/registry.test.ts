import { describe, expect, it } from 'vitest';
import { familyOf } from '../core';
import { createDefaultRegistry } from './registry';

describe('createDefaultRegistry', () => {
  it('contains every primitive', () => {
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
    ]);
  });

  it('gives every part a name, a title and search keywords', () => {
    for (const d of createDefaultRegistry().list()) {
      expect(d.name, d.type).not.toBe('');
      expect(d.title, d.type).not.toBe('');
      expect(d.keywords?.length, d.type).toBeGreaterThan(0);
      expect(familyOf(d.type)).toBe('prim');
    }
  });

  it('returns a fresh registry each time', () => {
    const a = createDefaultRegistry();
    const b = createDefaultRegistry();
    expect(a).not.toBe(b);
    expect(a.list()).toEqual(b.list());
  });
});
