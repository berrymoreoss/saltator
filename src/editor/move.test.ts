import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  CircuitBuilder,
  compileCircuit,
  normalizeWires,
  type Point,
  ROTATIONS,
} from '../circuit';
import { createDefaultRegistry } from '../library';
import { type ItemTransform, mirror, rotation, transformItems, translation } from './move';
import { buildScene } from './scene';
import { selectionOf } from './selection';

const registry = createDefaultRegistry();

/** Wires as `x,y-x,y` strings, in order. */
const segments = (c: Circuit) => c.wires.map((w) => `${w.from}-${w.to}`);

/** Pins grouped by net: `[['SW1.Y', 'U1.A'], …]`, sorted. */
function nets(c: Circuit): string[][] {
  return compileCircuit(c, registry)
    .nets.map((n) => n.pins.map((p) => `${p.component}.${p.pin}`).sort())
    .filter((pins) => pins.length > 1)
    .sort();
}

/** Applies a transform and normalizes, as `Editor.edit` would. */
function apply(c: Circuit, parts: string[], wires: string[], t: ItemTransform): Circuit {
  return normalizeWires(transformItems(buildScene(c, registry), selectionOf(parts, wires), t));
}

// SW1.Y (5, 1) → U1.A (10, 1), straight.
const straight = new CircuitBuilder(registry)
  .add('SW1', 'io/switch', { at: [0, 0] })
  .add('U1', 'prim/nand', { at: [10, 0] })
  .connect('SW1.Y', 'U1.A')
  .build();

describe('transformItems: wires follow moved parts', () => {
  it('stretches a wire that stays straight', () => {
    const moved = apply(straight, ['U1'], [], translation(3, 0));
    expect(moved.components[1]).toMatchObject({ x: 13, y: 0 });
    expect(segments(moved)).toEqual(['4,1-13,1']);
  });

  it('bends a wire into a Z when its fixed end is a pin', () => {
    const moved = apply(straight, ['U1'], [], translation(0, 3));
    expect(segments(moved)).toEqual(['4,1-7,1', '7,1-7,4', '7,4-10,4']);
    expect(nets(moved)).toEqual(nets(straight));
  });

  it('slides a plain corner and stretches its neighbour (KiCad drag)', () => {
    const cornered = new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('U1', 'prim/nand', { at: [10, 4] })
      .wire('SW1.Y', [7, 1], [7, 5], 'U1.A')
      .build();
    expect(segments(cornered)).toEqual(['4,1-7,1', '7,1-7,5', '7,5-10,5']);
    const moved = apply(cornered, ['U1'], [], translation(0, 2));
    expect(segments(moved)).toEqual(['4,1-7,1', '7,1-7,7', '7,7-10,7']);
  });

  it('moves a wire along when both its ends move', () => {
    const moved = apply(straight, ['SW1', 'U1'], [], translation(-4, 6));
    expect(segments(moved)).toEqual(['0,7-6,7']);
    expect(moved.components.map((c) => `${c.x},${c.y}`)).toEqual(['-4,6', '6,6']);
  });

  it('draws a new wire where a pin touched a pin directly', () => {
    const touching = new CircuitBuilder(registry)
      .add('U1', 'prim/nand', { at: [0, 0] })
      .add('D1', 'io/led', { at: [6, 1] }) // A (6, 2) = U1.Y
      .build();
    expect(nets(touching)).toEqual([['D1.A', 'U1.Y']]);
    const moved = apply(touching, ['D1'], [], translation(3, 0));
    expect(segments(moved)).toEqual(['6,2-9,2']);
    expect(nets(moved)).toEqual(nets(touching));
    // Sideways: one cell out of the fixed pin before turning.
    const sideways = apply(touching, ['D1'], [], translation(3, 2));
    expect(segments(sideways)).toEqual(['6,2-7,2', '7,2-7,4', '7,4-9,4']);
    expect(nets(sideways)).toEqual(nets(touching));
  });

  it('draws a new wire where a pin sat on a wire', () => {
    const builder = new CircuitBuilder(registry).add('PWR1', 'io/vcc', { at: [4, 0] });
    const [x, y] = builder.pin('PWR1.Y');
    const onWire = builder
      .add('U1', 'prim/nand', { at: [x + 6, y - 1] })
      .wire([x - 4, y], 'U1.A')
      .build();
    expect(nets(onWire)).toEqual([['PWR1.Y', 'U1.A']]);
    const moved = apply(onWire, ['PWR1'], [], translation(0, -3));
    expect(nets(moved)).toEqual(nets(onWire));
    // The wire stays; a stub rises from where the pin was to where it is.
    expect(segments(moved)).toContain(`${x},${y}-${x},${y - 3}`);
  });
});

describe('transformItems: selected wires', () => {
  it('moves a selected wire and drags the wires ending on it', () => {
    const c: Circuit = {
      ...new CircuitBuilder(registry).build(),
      wires: [
        { id: 'w1', from: [0, 0], to: [10, 0] },
        { id: 'w2', from: [5, 0], to: [5, 5] },
      ],
    };
    expect(segments(apply(c, [], ['w1'], translation(0, -2)))).toEqual(['0,-2-10,-2', '5,-2-5,5']);
  });

  it('keeps a selected wire connected to the pins it ended on, without touching others', () => {
    // The new wires leave each pin head-on instead of running along U1's input column, where
    // U1.B sits two cells below U1.A.
    for (const dy of [-2, 4, 6]) {
      expect(nets(apply(straight, [], ['w1'], translation(0, dy))), `dy ${dy}`).toEqual(
        nets(straight),
      );
    }
  });
});

describe('transforms keep connections', () => {
  const hello = new CircuitBuilder(registry)
    .add('SW1', 'io/switch', { at: [0, 0] })
    .add('U1', 'prim/nand', { at: [10, 0] })
    .add('PWR1', 'io/vcc', { at: [7, -4] })
    .add('D1', 'io/led', { at: [20, 0] })
    .add('PWR2', 'io/gnd', { at: [26, 1] })
    .connect('SW1.Y', 'U1.A')
    .connect('PWR1.Y', 'U1.B', [8, 3])
    .connect('U1.Y', 'D1.A', [18, 2], [18, 1])
    .connect('D1.K', 'PWR2.Y')
    .build();
  const before = nets(hello);

  /** Every net of `before` is still inside one net (moves may add contacts, never cut). */
  function keepsConnections(after: Circuit) {
    const netOf = new Map<string, number>();
    nets(after).forEach((pins, i) => {
      for (const p of pins) netOf.set(p, i);
    });
    for (const pins of before) {
      expect(new Set(pins.map((p) => netOf.get(p))).size, pins.join(' ')).toBe(1);
    }
  }

  const center: Point = [13, 2];
  it.each([
    ['move right', translation(7, 0)],
    ['move down', translation(0, 9)],
    ['move diagonally', translation(-5, 11)],
    ['rotate clockwise', rotation(center, true)],
    ['rotate counter-clockwise', rotation(center, false)],
    ['mirror horizontally', mirror(center, 'horizontal')],
    ['mirror vertically', mirror(center, 'vertical')],
  ])('%s U1, then everything, then a wire', (_, t) => {
    keepsConnections(apply(hello, ['U1'], [], t));
    keepsConnections(apply(hello, ['D1', 'PWR2'], [], t));
    keepsConnections(apply(hello, ['SW1', 'U1', 'PWR1'], ['w1'], t));
    const all = apply(
      hello,
      hello.components.map((c) => c.id),
      hello.wires.map((w) => w.id),
      t,
    );
    expect(nets(all)).toEqual(before);
  });
});

describe('placement after a transform', () => {
  it.each(ROTATIONS.flatMap((r) => [false, true].map((flip) => [r, flip] as const)))(
    'puts the pins where the transform maps them (rotation %i, flip %s)',
    (r, flip) => {
      const c = new CircuitBuilder(registry)
        .add('U1', 'prim/nand', { at: [3, -2], rotation: r, flip })
        .build();
      const scene = buildScene(c, registry);
      const pinsBefore = scene.parts[0]!.pins.map((p) => p.at);
      for (const t of [
        translation(2, 5),
        rotation([1, 1], true),
        rotation([1, 1], false),
        mirror([1, 1], 'horizontal'),
        mirror([1, 1], 'vertical'),
      ]) {
        const moved = transformItems(scene, selectionOf(['U1']), t);
        const pinsAfter = buildScene(moved, registry).parts[0]!.pins.map((p) => p.at);
        expect(pinsAfter).toEqual(pinsBefore.map((p) => t.point(p)));
      }
    },
  );
});
