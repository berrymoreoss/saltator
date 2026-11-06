/**
 * Examples that must stay drawn in code (the example files are in `examples/`, see
 * `example-files.ts`): the gallery of every registered part's symbol, which grows with the
 * library, and the stress-test grid shared with the circuit benchmark.
 */
import {
  type Circuit,
  CircuitBuilder,
  type ComponentInstance,
  partLayout,
  type Rotation,
  transformRect,
} from '../circuit';
import {
  type AnyComponentDefinition,
  type ComponentRegistry,
  designatorPrefixOf,
  type PropValue,
  resolveProps,
} from '../core';
import { layoutBounds } from '../editor';
import { chips74xx } from '../library';

/**
 * A large synthetic schematic for benchmarks and the stress-test example: a grid of 2-input NANDs
 * (A (x, y+1), B (x, y+3), Y (x+6, y+2)); each column sits one cell lower than the one before, so
 * an output runs straight to the next gate's input A. Each column has a vertical bus (one wire per
 * row, end to end) with a T-junction stub to the next gate's input B. The chain wires cross the
 * buses without connecting. ~3 wires per gate.
 */
export function nandGrid(registry: ComponentRegistry, rows: number, columns: number): Circuit {
  const b = new CircuitBuilder(registry);
  const at = (r: number, c: number): [number, number] => [c * 12, r * 6 + c];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) b.add(`U${r}_${c}`, 'prim/nand', { at: at(r, c) });
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const [x, y] = at(r, c);
      b.wire([x + 6, y + 2], [x + 12, y + 2]); // Y → next A
      b.wire([x + 9, y + 4], [x + 9, y + 10]); // bus segment
      b.wire([x + 9, y + 4], [x + 12, y + 4]); // stub → next B
    }
  }
  return b.build();
}

interface GalleryItem {
  readonly type: string;
  readonly props?: Record<string, PropValue>;
  readonly rotation?: Rotation;
  readonly flip?: boolean;
  /** Free text shown under the designator. */
  readonly note?: string;
}

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

function galleryRows(dev: boolean): GalleryItem[][] {
  const gates = ['and', 'nand', 'or', 'nor', 'xor', 'xnor'].map((g) => ({ type: `prim/${g}` }));
  const rows: GalleryItem[][] = [
    [
      ...gates,
      { type: 'prim/nand', props: { inputs: 3 }, note: '3 inputs' },
      { type: 'prim/or', props: { inputs: 5 }, note: '5 inputs' },
      { type: 'prim/xor', props: { inputs: 8 }, note: '8 inputs' },
    ],
    [
      { type: 'prim/buffer' },
      { type: 'prim/not' },
      { type: 'prim/tristate-buffer' },
      { type: 'prim/constant', props: { value: '0' } },
      { type: 'prim/constant', props: { value: '1' } },
      { type: 'prim/constant', props: { value: 'X' } },
      { type: 'prim/pull', props: { direction: 'up' }, note: 'pull-up' },
      { type: 'prim/pull', props: { direction: 'down' }, note: 'pull-down' },
      { type: 'io/vcc' },
      { type: 'io/gnd' },
    ],
    [
      { type: 'io/switch', note: 'SPDT off' },
      { type: 'io/switch', props: { on: true }, note: 'SPDT on' },
      { type: 'io/switch', props: { contact: 'spst-vcc' }, note: 'SPST to VCC' },
      { type: 'io/switch', props: { contact: 'spst-gnd', on: true }, note: 'SPST to GND, on' },
      { type: 'io/button', note: 'to VCC' },
      { type: 'io/button', props: { contact: 'spdt' }, note: 'SPDT' },
      { type: 'io/dip-switch', props: { count: 4, on: 5 } },
      { type: 'io/clock' },
      { type: 'io/clock', props: { mode: 'manual' }, note: 'manual' },
      { type: 'io/probe' },
    ],
    [
      ...['red', 'green', 'yellow', 'orange', 'blue', 'white'].map((color) => ({
        type: 'io/led',
        props: { color },
        note: color,
      })),
      { type: 'io/led-bar', props: { count: 8 } },
      { type: 'io/seven-segment' },
      { type: 'io/seven-segment', props: { common: 'anode', color: 'green' }, note: 'CA' },
      { type: 'io/hex-display', props: { color: 'yellow' } },
    ],
    chips74xx.map((chip) => ({ type: chip.type })),
    [
      ...ROTATIONS.map((rotation) => ({ type: 'prim/nand', rotation, note: `${rotation}°` })),
      ...ROTATIONS.map((rotation) => ({
        type: 'prim/tristate-buffer',
        rotation,
        flip: true,
        note: `${rotation}° flipped`,
      })),
      ...ROTATIONS.map((rotation) => ({
        type: '74xx/74hc245',
        rotation,
        flip: rotation === 90,
        note: rotation === 90 ? '90° flipped' : `${rotation}°`,
      })),
    ],
  ];
  if (dev) {
    rows.push([
      ...ROTATIONS.map((rotation) => ({ type: 'dev/dip-14', rotation, note: `${rotation}°` })),
      { type: 'dev/dip-28' },
      { type: 'dev/box' },
      { type: 'dev/unknown-kind' },
    ]);
  }
  return rows;
}

/** Row width before wrapping, in cells. */
const ROW_WIDTH = 96;
const GAP_X = 5;
const GAP_Y = 7;

/**
 * Every part's symbol, with prop variants and placements. `dev` adds the renderer fixtures
 * (registered in dev builds only) and two broken parts (unknown type, invalid props).
 */
export function symbolGallery(registry: ComponentRegistry, dev = false): Circuit {
  const builder = new CircuitBuilder(registry);
  const counters = new Map<string, number>();
  const nextId = (definition: AnyComponentDefinition) => {
    const prefix = designatorPrefixOf(definition);
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}${n}`;
  };
  let y = 0;
  for (const row of galleryRows(dev)) {
    let x = 0;
    let rowHeight = 0;
    for (const item of row) {
      const definition = registry.get(item.type);
      if (!definition) continue;
      const rotation = item.rotation ?? 0;
      const flip = item.flip ?? false;
      const props = resolveProps(definition, item.props ?? {});
      const local = layoutBounds(partLayout(definition, props));
      const placed = transformRect(local, { origin: [0, 0], rotation, flip });
      if (x > 0 && x + placed.width > ROW_WIDTH) {
        x = 0;
        y += rowHeight + GAP_Y;
        rowHeight = 0;
      }
      builder.add(nextId(definition), item.type, {
        at: [x - placed.x, y - placed.y],
        rotation,
        flip,
        ...(item.props && { props: item.props }),
        ...(item.note && { label: item.note }),
      });
      x += placed.width + GAP_X;
      rowHeight = Math.max(rowHeight, placed.height);
    }
    y += rowHeight + GAP_Y;
  }
  const circuit = builder.build();
  if (!dev) return circuit;
  const broken: ComponentInstance[] = [
    { id: 'U90', type: 'nope/missing', x: 0, y, rotation: 0, flip: false, props: {} },
    {
      id: 'U91',
      type: 'prim/and',
      x: 10,
      y,
      rotation: 0,
      flip: false,
      props: { inputs: 99 },
      label: 'invalid props',
    },
  ];
  return { ...circuit, components: [...circuit.components, ...broken] };
}
