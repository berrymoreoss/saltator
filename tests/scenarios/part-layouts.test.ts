import { describe, expect, it } from 'vitest';
import { partLayout } from '../../src/circuit';
import { type AnyComponentDefinition, type PropValue, pinsOf, resolveProps } from '../../src/core';
import { createDefaultRegistry } from '../../src/library';

const parts = createDefaultRegistry().list();

/** Default props, then every prop varied on its own: min/max, each enum option, both booleans. */
function propVariants(definition: AnyComponentDefinition): Record<string, PropValue>[] {
  const variants: Record<string, PropValue>[] = [{}];
  for (const prop of definition.props ?? []) {
    const values: PropValue[] = [];
    // An image's max is its size, not a value.
    if (prop.min !== undefined && prop.type !== 'image') values.push(prop.min);
    if (prop.max !== undefined && prop.type !== 'image') values.push(prop.max);
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

  it('gives every part a symbol or a package (none falls back to the generic box)', () => {
    for (const d of parts) expect(d.symbol ?? d.package, d.type).toBeDefined();
  });

  it('keeps an LCD module’s pins on the same points for every size: taller bodies rise', () => {
    const lcd = parts.find((d) => d.type === 'periph/hd44780')!;
    const at = (size: string) => partLayout(lcd, resolveProps(lcd, { size })).pins;
    const base = at('16x2');
    expect(base.find((p) => p.name === 'VSS')!.at).toEqual([1, 7]);
    for (const option of lcd.props!.find((p) => p.key === 'size')!.options!) {
      expect(at(option.value), option.value).toEqual(base);
    }
    const tall = partLayout(lcd, resolveProps(lcd, { size: '20x4' })).body;
    expect([tall.y, tall.y + tall.height]).toEqual([-3, 6]);
  });

  it("puts a net label's pin at its origin, the tag centered on that row", () => {
    const label = parts.find((d) => d.type === 'net/label')!;
    const layout = partLayout(label, resolveProps(label, { name: 'CLK' }));
    expect(layout.pins).toEqual([{ name: 'N', at: [0, 0], side: 'left' }]);
    expect(layout.body).toEqual({ x: 1, y: -0.5, width: 3, height: 1 });
  });
});
