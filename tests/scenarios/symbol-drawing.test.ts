/**
 * Every registered part (plus the editor's DIP and box fixtures) draws with a dedicated drawing
 * inside its layout, in both gate styles and for default, boundary and enum props; and the pins
 * the editor draws are exactly where the compiler connects wires.
 */
import { describe, expect, it } from 'vitest';
import { type Circuit, compileCircuit, emptyCircuit, type Rect } from '../../src/circuit';
import {
  type AnyComponentDefinition,
  Level,
  levelChar,
  type PropValue,
  Registry,
  Simulator,
  us,
} from '../../src/core';
import {
  buildScene,
  DEV_PARTS,
  DRAWERS,
  drawPartBody,
  GATE_STYLES,
  type LiveDraw,
  lit,
  type PartLive,
  RecordingGraphics,
  type ScenePart,
  UNKNOWN_LIGHT,
  unlit,
} from '../../src/editor';
import { createDefaultRegistry } from '../../src/library';

const shipped = createDefaultRegistry().list();
const registry = new Registry([...shipped, ...DEV_PARTS]);

/** Default props, then each integer prop at its bounds and each enum option. */
function propVariants(definition: AnyComponentDefinition): Record<string, PropValue>[] {
  const variants: Record<string, PropValue>[] = [{}];
  for (const prop of definition.props ?? []) {
    if (prop.type === 'integer') {
      for (const value of [prop.min, prop.max]) {
        if (value !== undefined) variants.push({ [prop.key]: value });
      }
    }
    if (prop.type === 'enum') {
      for (const option of prop.options ?? []) variants.push({ [prop.key]: option.value });
    }
    if (prop.type === 'boolean') variants.push({ [prop.key]: !prop.default });
  }
  return variants;
}

function circuitOf(type: string, props: Record<string, PropValue>): Circuit {
  return {
    ...emptyCircuit(),
    components: [{ id: 'U1', type, x: 3, y: -2, rotation: 90, flip: true, props }],
  };
}

function within(points: readonly (readonly [number, number])[], b: Rect): boolean {
  const eps = 1e-9;
  return points.every(
    ([x, y]) =>
      x >= b.x - eps && x <= b.x + b.width + eps && y >= b.y - eps && y <= b.y + b.height + eps,
  );
}

describe('symbol drawing', () => {
  it('has a drawer for the symbol kind of every shipped part', () => {
    for (const definition of shipped) {
      for (const props of propVariants(definition)) {
        const part = buildScene(circuitOf(definition.type, props), registry).parts[0]!;
        if (part.drawing.kind === 'symbol') {
          expect(DRAWERS[part.drawing.symbol.kind], definition.type).toBeDefined();
        } else {
          expect(part.drawing.kind, definition.type).toBe('dip');
        }
      }
    }
  });

  it('draws every part inside its layout, in both gate styles', () => {
    for (const definition of registry.list()) {
      for (const props of propVariants(definition)) {
        const part = buildScene(circuitOf(definition.type, props), registry).parts[0]!;
        for (const style of GATE_STYLES) {
          const g = new RecordingGraphics();
          drawPartBody(g, part, style, 'red');
          const where = `${definition.type} ${JSON.stringify(props)} ${style}`;
          expect(g.strokes + g.fills, where).toBeGreaterThan(0);
          expect(within(g.points, part.localBounds), where).toBe(true);
          for (const text of g.texts) {
            expect(within([text.at], part.localBounds), `${where}: "${text.text}"`).toBe(true);
          }
        }
      }
    }
  });

  it('draws pins exactly where the compiler connects them', () => {
    for (const definition of registry.list()) {
      for (const props of propVariants(definition)) {
        const circuit = circuitOf(definition.type, props);
        const compiled = compileCircuit(circuit, registry);
        const connected = compiled.nets.flatMap((net) =>
          [...net.pins, ...net.schematicPins].map((p) => [p.pin, p.at]),
        );
        const drawn = buildScene(circuit, registry).parts[0]!.pins.map((p) => [p.name, p.at]);
        expect(drawn, definition.type).toEqual(connected);
      }
    }
  });

  it('draws DIP pin numbers, names and the part name', () => {
    const part = buildScene(circuitOf('dev/dip-14', {}), registry).parts[0]!;
    const g = new RecordingGraphics();
    drawPartBody(g, part, 'ansi', 'red');
    const texts = g.texts.map((t) => t.text);
    expect(texts).toContain('14');
    expect(texts).toContain('VCC');
    expect(texts).toContain('DEV14');
    expect(g.texts.find((t) => t.text === 'OE')?.style.overline).toBe(true);
  });

  it('draws a 555’s unsimulated timing pins under their names, n.c. pins as NC', () => {
    const texts = (type: string, props = {}) => {
      const g = new RecordingGraphics();
      drawPartBody(g, buildScene(circuitOf(type, props), registry).parts[0]!, 'ansi', 'red');
      return g.texts.map((t) => t.text);
    };
    expect(texts('timer/ne555', { mode: 'astable' })).toEqual(
      expect.arrayContaining(['TRIG', 'THRES', 'DISCH', 'CONT', 'NE555']),
    );
    expect(texts('timer/ne555')).not.toContain('NC');
    expect(texts('74xx/74hc20')).toContain('NC');
  });

  it('draws a labelled pin under its label: the 74HC151 has Y and Y overlined', () => {
    const part = buildScene(circuitOf('74xx/74hc151', {}), registry).parts[0]!;
    const g = new RecordingGraphics();
    drawPartBody(g, part, 'ansi', 'red');
    const ys = g.texts.filter((t) => t.text === 'Y').map((t) => t.style.overline === true);
    expect(ys.sort()).toEqual([false, true]);
    expect(g.texts.some((t) => t.text === 'YN')).toBe(false);
  });

  it("overlines an active-LOW pin's letters, not its digits, unless its label marks them", () => {
    const overlines = (type: string) => {
      const g = new RecordingGraphics();
      drawPartBody(g, buildScene(circuitOf(type, {}), registry).parts[0]!, 'ansi', 'red');
      return Object.fromEntries(g.texts.map((t) => [t.text, t.style.overline ?? false]));
    };
    expect(overlines('74xx/74hc74')).toMatchObject({
      '1RD': [[1, 3]],
      '1Q': [[1, 2]],
      '1D': false,
    });
    expect(overlines('74xx/74hc138')).toMatchObject({ E1: [[0, 1]], Y0: [[0, 1]], E3: false });
    expect(overlines('74xx/74hc245')).toMatchObject({ OE: true });
    expect(overlines('74xx/74hc175')).toMatchObject({ Q0: true }); // marked: Q̅0̅
    expect(overlines('74xx/74hc191')).toMatchObject({ 'U/D': [[0, 1]] }); // marked: U̅/D
  });
});

describe('symbol drawing while simulating', () => {
  const levelColor = (level: Level) => `level-${levelChar(level)}`;

  /** The part in a simulator of its own, run for a while, with `light` for every light. */
  function live(
    part: ScenePart,
    light: number,
    levels?: (pin: string) => Level,
  ): LiveDraw & { readonly part: PartLive } {
    const sim = new Simulator(
      compileCircuit(circuitOf(part.instance.type, part.instance.props), registry).netlist,
      registry,
    );
    sim.runUntil(us(3));
    return {
      part: {
        state: sim.stateOf('U1'),
        level: levels ?? ((pin) => sim.pinLevel('U1', pin)),
        light: () => light,
      },
      levelColor,
    };
  }

  /** Schematic-only parts (net labels) aren't simulated: they get their nets' colors only. */
  const liveOrNet = (part: ScenePart, light: number): LiveDraw =>
    part.definition?.schematicOnly ? { levelColor, pinColor: () => 'level-1' } : live(part, light);

  it('draws every part inside its layout with live state, lit and unknown', () => {
    for (const definition of shipped) {
      for (const props of propVariants(definition)) {
        const part = buildScene(circuitOf(definition.type, props), registry).parts[0]!;
        for (const light of [0, 0.5, 1, UNKNOWN_LIGHT]) {
          const g = new RecordingGraphics();
          drawPartBody(g, part, 'ansi', 'red', liveOrNet(part, light));
          const where = `${definition.type} ${JSON.stringify(props)} light ${light}`;
          expect(g.strokes + g.fills, where).toBeGreaterThan(0);
          expect(within(g.points, part.localBounds), where).toBe(true);
          for (const text of g.texts) {
            expect(within([text.at], part.localBounds), `${where}: "${text.text}"`).toBe(true);
          }
        }
      }
    }
  });

  const partOf = (type: string, props: Record<string, PropValue> = {}) =>
    buildScene(circuitOf(type, props), registry).parts[0]!;
  const draw = (part: ScenePart, draw: LiveDraw | undefined) => {
    const g = new RecordingGraphics();
    drawPartBody(g, part, 'ansi', 'red', draw);
    return g;
  };

  it('lights LEDs and segments at their brightness, unknown ones in the X color', () => {
    const led = partOf('io/led', { color: 'green' });
    expect(draw(led, undefined).paints).toContain(unlit('green'));
    expect(draw(led, live(led, 1)).paints).toContain(lit('green', 1));
    expect(draw(led, live(led, 0.5)).paints).toContain(lit('green', 0.5));
    expect(draw(led, live(led, UNKNOWN_LIGHT)).paints).toContain('level-X99');
    const digit = partOf('io/seven-segment');
    expect(draw(digit, live(digit, 1)).paints.filter((p) => p === lit('red', 1)).length).toBe(2);
  });

  it('shows switch positions, the pressed button and the DIP switches from the state', () => {
    const toggle = partOf('io/switch');
    const off = draw(toggle, live(toggle, 0)).points;
    const on = { ...live(toggle, 0) };
    const flipped = draw(toggle, { ...on, part: { ...on.part, state: { on: true } } }).points;
    expect(flipped).not.toEqual(off);
    expect(flipped).toEqual(draw(partOf('io/switch', { on: true }), undefined).points);
    const button = partOf('io/button');
    const released = live(button, 0);
    expect(
      draw(button, { ...released, part: { ...released.part, state: { pressed: true } } }).points,
    ).not.toEqual(draw(button, released).points);
    const dip = partOf('io/dip-switch', { count: 2 });
    const bank = live(dip, 0);
    expect(
      draw(dip, { ...bank, part: { ...bank.part, state: { on: [true, false] } } }).points,
    ).toEqual(draw(partOf('io/dip-switch', { count: 2, on: 1 }), undefined).points);
  });

  it('shows the hex digit of the inputs and the probed level', () => {
    const hex = partOf('io/hex-display');
    const value = (pin: string) => (pin === 'D0' || pin === 'D3' ? Level.L1 : Level.L0);
    expect(draw(hex, live(hex, 0, value)).texts.map((t) => t.text)).toContain('9');
    const unknown = draw(
      hex,
      live(hex, 0, () => Level.Z),
    );
    expect(unknown.texts.find((t) => t.text === '–')?.style.paint).toBe('level-X');
    const probe = partOf('io/probe');
    const text = draw(
      probe,
      live(probe, 0, () => Level.L1),
    ).texts[0]!;
    expect([text.text, text.style.paint]).toEqual(['1', 'level-1']);
    const clock = partOf('io/clock');
    expect(
      draw(
        clock,
        live(clock, 0, () => Level.L0),
      ).paints,
    ).toContain('level-0');
  });

  it('draws a net label with its name, overlined as marked, its outline in its net color', () => {
    const label = partOf('net/label', { name: '~{CLR}' });
    const idle = draw(label, undefined);
    expect(idle.texts.map((t) => [t.text, t.style.overline])).toEqual([['CLR', true]]);
    expect(idle.paints).not.toContain('level-1');
    const running = draw(label, { levelColor, pinColor: (pin) => `net-${pin}` });
    expect(running.paints).toContain('net-N');
    const partial = draw(partOf('net/label', { name: '~{CS}1' }), undefined).texts[0]!;
    expect([partial.text, partial.style.overline]).toEqual(['CS1', [[0, 2]]]);
  });
});
