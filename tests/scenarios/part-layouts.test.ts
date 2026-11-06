import { describe, expect, it } from 'vitest';
import { partLayout } from '../../src/circuit';
import {
  type AnyComponentDefinition,
  familyOf,
  type PropValue,
  pinsOf,
  resolveProps,
} from '../../src/core';
import { createDefaultRegistry } from '../../src/library';

const parts = createDefaultRegistry().list();

/** Default props, then every prop varied on its own: min/max, each enum option, both booleans. */
function propVariants(definition: AnyComponentDefinition): Record<string, PropValue>[] {
  const variants: Record<string, PropValue>[] = [{}];
  for (const prop of definition.props ?? []) {
    const values: PropValue[] = [];
    if (prop.min !== undefined) values.push(prop.min);
    if (prop.max !== undefined) values.push(prop.max);
    for (const option of prop.options ?? []) values.push(option.value);
    if (prop.type === 'boolean') values.push(false, true);
    for (const value of values) variants.push({ [prop.key]: value });
  }
  return variants;
}

describe('part layouts of every built-in part', () => {
  it.each(parts.map((d) => [d.type, d] as const))('%s lays out for all prop variants', (_, d) => {
    for (const raw of propVariants(d)) {
      const props = resolveProps(d, raw);
      const pins = pinsOf(d, props);
      const layout = partLayout(d, props);
      const where = `${d.type} ${JSON.stringify(raw)}`;
      expect(
        layout.pins.map((p) => p.name),
        where,
      ).toEqual(pins.map((p) => p.name));
      const points = new Set(layout.pins.map((p) => `${p.at[0]},${p.at[1]}`));
      expect(points.size, `${where}: two pins on one point`).toBe(pins.length);
    }
  });

  it('gives every IO part a symbol', () => {
    for (const d of parts.filter((p) => familyOf(p.type) === 'io')) {
      expect(d.symbol ?? d.package, d.type).toBeDefined();
    }
  });
});
