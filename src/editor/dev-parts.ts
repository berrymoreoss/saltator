/**
 * Fixture parts for developing and testing the renderer: they exercise drawings no shipped part
 * uses yet (DIP packages until R06, the generic box, an unknown symbol kind). They have no
 * behavior and are registered only in tests and in dev builds of the app (`dev/*` types), never in
 * the default registry.
 */
import { type AnyComponentDefinition, defineComponent, type PinDef } from '../core';

/** A 74HC00-like DIP-14 (no behavior), plus an active-low and a clock pin to draw. */
const dip14 = defineComponent<Record<string, never>, undefined>({
  type: 'dev/dip-14',
  name: 'DEV14',
  title: 'Renderer fixture: DIP-14 package',
  pins: [
    { name: '1A', number: 1, dir: 'in' },
    { name: '1B', number: 2, dir: 'in' },
    { name: '1Y', number: 3, dir: 'out' },
    { name: '2A', number: 4, dir: 'in' },
    { name: '2B', number: 5, dir: 'in' },
    { name: '2Y', number: 6, dir: 'out' },
    { name: 'GND', number: 7, dir: 'power' },
    { name: '3Y', number: 8, dir: 'out' },
    { name: 'CLK', number: 9, dir: 'in', clock: true },
    { name: 'OE', number: 10, dir: 'in', activeLow: true },
    { name: '4Y', number: 11, dir: 'out' },
    { name: '4A', number: 12, dir: 'in' },
    { name: 'NC', number: 13, dir: 'nc' },
    { name: 'VCC', number: 14, dir: 'power' },
  ],
  package: { kind: 'dip', pins: 14 },
  create: () => ({}),
});

/** A wide (0.6") DIP-28, like a 28C256 EEPROM. */
const dip28 = defineComponent<Record<string, never>, undefined>({
  type: 'dev/dip-28',
  name: 'DEV28',
  title: 'Renderer fixture: DIP-28 package',
  pins: Array.from(
    { length: 28 },
    (_, i): PinDef => ({
      name: i === 13 ? 'GND' : i === 27 ? 'VCC' : `P${i + 1}`,
      number: i + 1,
      dir: i === 13 || i === 27 ? 'power' : 'bidir',
    }),
  ),
  package: { kind: 'dip', pins: 28 },
  create: () => ({}),
});

/** No package and no symbol: the generic box layout. */
const box = defineComponent<Record<string, never>, undefined>({
  type: 'dev/box',
  name: 'BOX',
  title: 'Renderer fixture: generic box',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'B', dir: 'in' },
    { name: 'Y', dir: 'out' },
    { name: 'VCC', dir: 'power' },
  ],
  create: () => ({}),
});

/** A symbol kind the editor has no drawing for: drawn as a labeled box. */
const unknownKind = defineComponent<Record<string, never>, undefined>({
  type: 'dev/unknown-kind',
  name: 'ODD',
  title: 'Renderer fixture: unknown symbol kind',
  pins: [{ name: 'Y', dir: 'out' }],
  symbol: { kind: 'dev-unknown', width: 3, height: 2, pins: { Y: { side: 'right', offset: 1 } } },
  create: () => ({}),
});

export const DEV_PARTS: readonly AnyComponentDefinition[] = [dip14, dip28, box, unknownKind];
