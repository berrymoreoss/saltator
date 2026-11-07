import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../library';
import { groupParts, matchesQuery } from './parts-filter';

const parts = createDefaultRegistry().list();
const nand = parts.find((p) => p.type === 'prim/nand')!;

describe('parts filter', () => {
  it('matches every word against name, title, type and keywords', () => {
    expect(matchesQuery(nand, '')).toBe(true);
    expect(matchesQuery(nand, 'NAND')).toBe(true);
    expect(matchesQuery(nand, 'prim/na')).toBe(true);
    expect(matchesQuery(nand, 'nand gate')).toBe(true);
    expect(matchesQuery(nand, 'nand led')).toBe(false);
  });

  it('groups by family in display order', () => {
    const groups = groupParts(parts, '');
    expect(groups.map((g) => g.label)).toEqual([
      '74HC Logic',
      'Timers',
      'Memory',
      'Peripherals',
      'Primitives',
      'Input / Output',
      'Nets',
    ]);
    expect(groups.flatMap((g) => g.parts)).toHaveLength(parts.length);
  });

  it('drops empty families when filtering', () => {
    const groups = groupParts(parts, 'led');
    expect(groups.map((g) => g.family)).toEqual(['io']);
    expect(groups[0]!.parts.map((p) => p.type)).toContain('io/led');
  });
});
