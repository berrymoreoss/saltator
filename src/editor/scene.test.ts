import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  CircuitBuilder,
  type ComponentInstance,
  emptyCircuit,
  type Rect,
  ROTATIONS,
} from '../circuit';
import { Registry } from '../core';
import { createDefaultRegistry } from '../library';
import { DEV_PARTS } from './dev-parts';
import { buildScene, LayoutCache, layoutBounds } from './scene';
import { TEXT_GAP } from './text-placement';

const registry = createDefaultRegistry();

function instance(id: string, type: string, extra: Partial<ComponentInstance> = {}) {
  return { id, type, x: 0, y: 0, rotation: 0, flip: false, props: {}, ...extra } as const;
}

function circuitOf(...components: ComponentInstance[]): Circuit {
  return { ...emptyCircuit(), components };
}

describe('scene parts', () => {
  it('places a part: bounds, body, pins with stub bases, nets', () => {
    const scene = buildScene(
      new CircuitBuilder(registry).add('U1', 'prim/nand', { at: [10, 0] }).build(),
      registry,
    );
    const part = scene.partById.get('U1')!;
    expect(part.drawing).toMatchObject({ kind: 'symbol', symbol: { kind: 'gate-nand' } });
    expect(part.localBounds).toEqual({ x: 0, y: 0, width: 6, height: 4 });
    expect(part.bounds).toEqual({ x: 10, y: 0, width: 6, height: 4 });
    expect(part.body).toEqual({ x: 11, y: 0, width: 4, height: 4 });
    expect(part.pins.map((p) => [p.name, p.at, p.base, p.side])).toEqual([
      ['A', [10, 1], [11, 1], 'left'],
      ['B', [10, 3], [11, 3], 'left'],
      ['Y', [16, 2], [15, 2], 'right'],
    ]);
    expect(part.pins.every((p) => p.net !== undefined && p.open)).toBe(true);
  });

  it('gives net labels their net, no text block, and marks pins open by what they touch', () => {
    // V1, V2 are one net by name but touch nothing; NL1 sits on U1.A, NL2 alone far away.
    const circuit = new CircuitBuilder(registry)
      .add('V1', 'io/vcc', { at: [0, 0] })
      .add('V2', 'io/vcc', { at: [0, 10] })
      .add('U1', 'prim/nand', { at: [20, 0] })
      .add('NL1', 'net/label', { at: [20, 1], props: { name: 'A' } })
      .add('NL2', 'net/label', { at: [40, 40], props: { name: 'A' } })
      .build();
    const scene = buildScene(circuit, registry);
    const pin = (id: string) => scene.partById.get(id)!.pins[0]!;
    expect([pin('V1').net, pin('V1').open, pin('V2').open]).toEqual(['VCC', true, true]);
    expect([pin('NL1').net, pin('NL1').open]).toEqual(['A', false]);
    expect([pin('NL2').net, pin('NL2').open]).toEqual(['A', true]);
    expect([pin('U1').net, pin('U1').open]).toEqual(['A', false]);
    expect(scene.partById.get('NL1')!.texts).toEqual([]);
    expect(scene.partById.get('NL1')!.body).toEqual({ x: 21, y: 0.5, width: 2, height: 1 });
  });

  it('draws a text as its body only: no pins, no designator, bounds of its box', () => {
    const scene = buildScene(
      new CircuitBuilder(registry)
        .add('TXT1', 'draw/text', {
          at: [4, 6],
          props: { text: 'LDA #$01\nSTA $0200', font: 'mono' },
        })
        .build(),
      registry,
    );
    const part = scene.partById.get('TXT1')!;
    expect(part.drawing).toMatchObject({ kind: 'symbol', symbol: { kind: 'text' } });
    expect(part.pins).toEqual([]);
    expect(part.texts).toEqual([]);
    // 9 characters × 0.6 × 0.7 + 0.4 = 4.18 → 5 cells; 2 lines × 0.875 → 2.
    expect(part.body).toEqual({ x: 4, y: 6, width: 5, height: 2 });
    expect(part.bounds).toEqual(part.body);
    expect(scene.compiled.netlist.components).toEqual([]);
    expect(scene.issues).toEqual([]);
  });

  it('transforms pins and bounds with the placement', () => {
    const scene = buildScene(
      new CircuitBuilder(registry).add('U1', 'prim/nand', { at: [0, 0], rotation: 90 }).build(),
      registry,
    );
    const part = scene.partById.get('U1')!;
    expect(part.bounds).toEqual({ x: -4, y: 0, width: 4, height: 6 });
    expect(part.pins.find((p) => p.name === 'Y')).toMatchObject({ at: [-2, 6], side: 'bottom' });
  });

  it('marks only pins with nothing attached as open', () => {
    const circuit = new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('U1', 'prim/nand', { at: [10, 0] })
      .connect('SW1.Y', 'U1.A')
      .build();
    const scene = buildScene(circuit, registry);
    const open = scene.parts.flatMap((p) =>
      p.pins.filter((pin) => pin.open).map((pin) => pin.name),
    );
    expect(open).toEqual(['B', 'Y']);
    const wire = scene.wires[0]!;
    expect(wire.net).toBe('SW1.Y');
    expect(scene.partById.get('U1')!.pins[0]!.net).toBe('SW1.Y');
  });

  it('draws unknown types and invalid props as broken placeholders', () => {
    const scene = buildScene(
      circuitOf(
        instance('X1', 'nope/part'),
        instance('U1', 'prim/and', { x: 10, props: { inputs: 99 } }),
      ),
      registry,
    );
    expect(scene.partById.get('X1')!.drawing).toEqual({
      kind: 'broken',
      reason: 'unknown part type "nope/part"',
    });
    const bad = scene.partById.get('U1')!;
    expect(bad.drawing.kind).toBe('broken');
    expect(bad.pins).toEqual([]);
    expect(bad.bounds).toEqual({ x: 10, y: 0, width: 4, height: 2 });
    expect(scene.issues.map((i) => i.code)).toEqual(['unknown-type', 'invalid-props']);
  });

  it('draws a package part as a DIP', () => {
    const withDev = new Registry([...registry.list(), ...DEV_PARTS]);
    const part = buildScene(circuitOf(instance('U1', 'dev/dip-14')), withDev).parts[0]!;
    expect(part.drawing).toEqual({ kind: 'dip', pinCount: 14 });
    expect(part.bounds).toEqual({ x: 0, y: 0, width: 6, height: 8 });
    expect(part.texts[0]).toMatchObject({ text: 'U1', baseline: 'bottom' });
  });

  it('draws a part with neither package nor symbol as a box', () => {
    const withDev = new Registry([...registry.list(), ...DEV_PARTS]);
    const part = buildScene(circuitOf(instance('U1', 'dev/box')), withDev).parts[0]!;
    expect(part.drawing).toEqual({ kind: 'box' });
  });
});

describe('scene wires and marks', () => {
  it('collects junctions, dangling ends and bounds', () => {
    const circuit = new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('U1', 'prim/nand', { at: [10, 0] })
      .wire('SW1.Y', [7, 1], 'U1.A')
      .wire([7, 1], [7, 3], 'U1.B')
      .wire([7, 6], [9, 6])
      .build();
    const scene = buildScene(circuit, registry);
    expect(scene.junctions).toEqual([[7, 1]]);
    expect(scene.danglingEnds).toEqual([
      [7, 6],
      [9, 6],
    ]);
    const b = scene.bounds!;
    expect(b.x).toBeLessThanOrEqual(0);
    expect(b.x + b.width).toBeGreaterThanOrEqual(16);
    expect(b.y + b.height).toBeGreaterThanOrEqual(6);
  });

  it('has no bounds when empty', () => {
    expect(buildScene(emptyCircuit(), registry).bounds).toBeUndefined();
  });

  it('reuses cached layouts across rebuilds', () => {
    const layouts = new LayoutCache();
    const circuit = new CircuitBuilder(registry).add('U1', 'prim/nand', { at: [0, 0] }).build();
    const a = buildScene(circuit, registry, { layouts }).parts[0]!.layout;
    const b = buildScene(circuit, registry, { layouts }).parts[0]!.layout;
    expect(a).toBe(b);
  });
});

describe('text placement', () => {
  function outside(at: readonly [number, number], b: Rect): boolean {
    return at[0] < b.x || at[0] > b.x + b.width || at[1] < b.y || at[1] > b.y + b.height;
  }

  it('puts the designator above a horizontal gate and the label below it', () => {
    const scene = buildScene(
      new CircuitBuilder(registry).add('U1', 'prim/nand', { at: [0, 0], label: 'CARRY' }).build(),
      registry,
    );
    const [designator, label] = scene.parts[0]!.texts;
    expect(designator).toMatchObject({ text: 'U1', role: 'designator', align: 'center' });
    expect(label).toMatchObject({ text: 'CARRY', role: 'label', align: 'center' });
    expect(designator!.at[0]).toBe(3);
    expect(designator!.at[1]).toBeLessThan(label!.at[1]);
    expect(label!.at[1]).toBeLessThanOrEqual(-TEXT_GAP);
  });

  it('keeps text outside the part and off the sides with pins, in all 8 placements', () => {
    for (const type of ['prim/nand', 'prim/tristate-buffer', 'io/led', 'io/switch']) {
      for (const rotation of ROTATIONS) {
        for (const flip of [false, true]) {
          const scene = buildScene(
            circuitOf(instance('U1', type, { rotation, flip, label: 'L' })),
            registry,
          );
          const part = scene.parts[0]!;
          const pinSides = new Set(part.pins.map((p) => p.side));
          const where = `${type} @${rotation}${flip ? ' flipped' : ''}`;
          for (const text of part.texts) {
            expect(outside(text.at, part.bounds), where).toBe(true);
            const side =
              text.at[1] < part.bounds.y
                ? 'top'
                : text.at[1] > part.bounds.y + part.bounds.height
                  ? 'bottom'
                  : text.at[0] > part.bounds.x + part.bounds.width
                    ? 'right'
                    : 'left';
            expect(pinSides.has(side), `${where}: text on the ${side} side`).toBe(false);
          }
        }
      }
    }
  });

  it('names power rails at the end away from the pin', () => {
    const scene = buildScene(
      circuitOf(instance('PWR1', 'io/vcc'), instance('PWR2', 'io/gnd', { x: 10 })),
      registry,
    );
    const [vcc, gnd] = scene.parts;
    expect(vcc!.texts).toMatchObject([{ text: 'VCC', role: 'name', baseline: 'bottom' }]);
    expect(vcc!.texts[0]!.at[1]).toBeLessThan(vcc!.bounds.y);
    expect(gnd!.texts).toMatchObject([{ text: 'GND', role: 'name', baseline: 'top' }]);
    expect(gnd!.texts[0]!.at[1]).toBeGreaterThan(gnd!.bounds.y + gnd!.bounds.height);
  });
});

describe('layoutBounds', () => {
  it('covers the body and every pin tip', () => {
    expect(
      layoutBounds({
        body: { x: 1, y: 1, width: 2, height: 2 },
        pins: [
          { name: 'A', at: [0, 2], side: 'left' },
          { name: 'B', at: [2, 4], side: 'bottom' },
        ],
      }),
    ).toEqual({ x: 0, y: 1, width: 3, height: 3 });
  });
});
