import { describe, expect, it } from 'vitest';
import {
  type Circuit,
  documentRegistry,
  emptyCircuit,
  type Rect,
  SCHEMA_VERSION,
} from '../../circuit';
import { Level, levelChar, type PropValue, Registry } from '../../core';
import {
  createDefaultRegistry,
  createHd44780Controller,
  type Hd44780Controller,
  st7789,
} from '../../library';
import { DEV_PARTS } from '../dev-parts';
import { RecordingGraphics } from '../recording-graphics';
import { buildScene } from '../scene';
import { DRAWERS, drawPartBody, GATE_STYLES, type GateStyle, LCD_GLASS, TFT_GLASS } from '.';

const registry = new Registry([...createDefaultRegistry().list(), ...DEV_PARTS]);

function part(type: string, props: Record<string, PropValue> = {}) {
  const circuit: Circuit = {
    ...emptyCircuit(),
    components: [{ id: 'U1', type, x: 0, y: 0, rotation: 0, flip: false, props }],
  };
  return buildScene(circuit, registry).parts[0]!;
}

function draw(type: string, props: Record<string, PropValue>, style: GateStyle) {
  const g = new RecordingGraphics();
  drawPartBody(g, part(type, props), style, 'red');
  return g;
}

function within(points: readonly (readonly [number, number])[], b: Rect): boolean {
  const eps = 1e-9;
  return points.every(
    ([x, y]) =>
      x >= b.x - eps && x <= b.x + b.width + eps && y >= b.y - eps && y <= b.y + b.height + eps,
  );
}

const GATES = ['prim/and', 'prim/nand', 'prim/or', 'prim/nor', 'prim/xor', 'prim/xnor'];

describe('gate drawers', () => {
  it('draw every gate kind for 2–8 inputs inside the layout, in both styles', () => {
    for (const type of GATES) {
      for (let inputs = 2; inputs <= 8; inputs++) {
        for (const style of GATE_STYLES) {
          const p = part(type, { inputs });
          const g = draw(type, { inputs }, style);
          const where = `${type} ×${inputs} ${style}`;
          expect(g.strokes, where).toBeGreaterThan(0);
          expect(within(g.points, p.localBounds), where).toBe(true);
        }
      }
    }
  });

  it('marks inverting gates with a bubble at the output', () => {
    const plain = draw('prim/and', {}, 'ansi');
    const inverted = draw('prim/nand', {}, 'ansi');
    expect(inverted.strokes).toBe(plain.strokes + 1);
  });

  it('labels IEC gates with their qualifying symbol', () => {
    const qualifier = (type: string) => draw(type, {}, 'iec').texts.map((t) => t.text);
    expect(qualifier('prim/and')).toEqual(['&']);
    expect(qualifier('prim/or')).toEqual(['≥1']);
    expect(qualifier('prim/xnor')).toEqual(['=1']);
    expect(qualifier('prim/not')).toEqual(['1']);
  });

  it('has a drawer for every gate-like primitive kind', () => {
    for (const kind of ['gate-and', 'buffer', 'not', 'tristate-buffer', 'constant', 'vcc', 'gnd']) {
      expect(DRAWERS[kind], kind).toBeDefined();
    }
  });
});

describe('net drawers', () => {
  it('draw a bus label in the bus color, its value after it while simulating', () => {
    const label = part('net/label', { name: 'D[0..7]' });
    const stopped = new RecordingGraphics();
    drawPartBody(stopped, label, 'ansi', 'red');
    expect(stopped.texts.map((t) => t.text)).toEqual(['D[0..7]']);
    const running = new RecordingGraphics();
    drawPartBody(running, label, 'ansi', 'red', {
      levelColor: () => 'green',
      pinColor: () => 'violet',
      busValue: '0x3F',
    });
    expect(running.texts.map((t) => t.text)).toEqual(['D[0..7]', '0x3F']);
    // The value sits after the tag, outside the label's own bounds.
    expect(running.texts[1]!.at[0]).toBeGreaterThan(label.layout.body.x + label.layout.body.width);
  });

  it('draw a port as a flag pointing the way its signal goes, its name in bold', () => {
    const tips = (direction: string) => {
      const p = part('net/port', { name: 'CLK', direction });
      const g = draw('net/port', { name: 'CLK', direction }, 'ansi');
      const { x, width } = p.layout.body;
      const y = p.layout.body.y + p.layout.body.height / 2;
      expect(within(g.points, p.localBounds), direction).toBe(true);
      expect(g.texts.map((t) => [t.text, t.style.bold])).toEqual([['CLK', true]]);
      const at = (px: number) => g.points.some(([gx, gy]) => gx === px && gy === y);
      return [at(x), at(x + width)];
    };
    expect(tips('in')).toEqual([true, false]);
    expect(tips('out')).toEqual([false, true]);
    expect(tips('bidir')).toEqual([true, true]);
    expect(part('net/port', { name: 'CLK' }).texts).toEqual([]);
  });

  it('draw a bus entry with its name, no designator', () => {
    const entry = part('net/bus-entry', { name: 'A15' });
    expect(draw('net/bus-entry', { name: 'A15' }, 'ansi').texts.map((t) => t.text)).toEqual([
      'A15',
    ]);
    expect(entry.texts).toEqual([]);
  });
});

describe('subcircuit drawer', () => {
  it('draws a box with the circuit name and every port name inside, overlines marked', () => {
    const port = (id: string, name: string, x: number, y: number, props = {}) => ({
      id,
      type: 'net/port',
      x,
      y,
      rotation: 0 as const,
      flip: false,
      props: { name, direction: 'in', side: 'auto', ...props },
    });
    const module: Circuit = {
      ...emptyCircuit('counter', 'Counter'),
      components: [
        port('P1', 'CLK', 0, 0),
        port('P2', '~{CLR}', 0, 2),
        port('P3', 'Q[0..3]', 9, 0, { direction: 'out' }),
        port('P4', 'EN', 4, 0, { side: 'top' }),
        port('P5', 'CO', 4, 9, { direction: 'out', side: 'bottom' }),
      ],
    };
    const top: Circuit = {
      ...emptyCircuit(),
      components: [
        { id: 'A1', type: 'sub/counter', x: 0, y: 0, rotation: 0, flip: false, props: {} },
      ],
    };
    const docRegistry = documentRegistry(
      { schemaVersion: SCHEMA_VERSION, circuits: [top, module] },
      registry,
    );
    const instance = buildScene(top, docRegistry).parts[0]!;
    const g = new RecordingGraphics();
    drawPartBody(g, instance, 'ansi', 'red');
    expect(within(g.points, instance.localBounds)).toBe(true);
    expect(g.texts.map((t) => [t.text, t.style.overline ?? false])).toEqual([
      ['Counter', false],
      ['CLK', false],
      ['CLR', true],
      ['Q[0..3]', false],
      ['EN', false],
      ['CO', false],
    ]);
    for (const t of g.texts) {
      expect(within([t.at], instance.layout.body), t.text).toBe(true);
    }
    expect(g.texts.filter((t) => t.style.rotate === 90).map((t) => t.text)).toEqual(['EN', 'CO']);
    // The designator is the scene's text, outside the body.
    expect(instance.texts.map((t) => t.text)).toEqual(['A1']);
  });
});

describe('power drawers', () => {
  it('draw constants, pulls and rails inside the layout in both styles', () => {
    const cases: [string, Record<string, PropValue>][] = [
      ['prim/constant', { value: '0' }],
      ['prim/constant', { value: 'X' }],
      ['prim/pull', { direction: 'up' }],
      ['prim/pull', { direction: 'down' }],
      ['io/vcc', {}],
      ['io/gnd', {}],
      ['prim/buffer', {}],
      ['prim/not', {}],
      ['prim/tristate-buffer', {}],
    ];
    for (const [type, props] of cases) {
      for (const style of GATE_STYLES) {
        const g = draw(type, props, style);
        const where = `${type} ${JSON.stringify(props)} ${style}`;
        expect(g.strokes + g.fills, where).toBeGreaterThan(0);
        expect(within(g.points, part(type, props).localBounds), where).toBe(true);
      }
    }
  });

  it('shows the value of a constant', () => {
    expect(draw('prim/constant', { value: 'X' }, 'ansi').texts[0]?.text).toBe('X');
  });
});

describe('LCD drawer', () => {
  const levels = (over: Record<string, Level>) => (pin: string) =>
    over[pin] ?? { A: Level.L1, K: Level.L0, V0: Level.L0 }[pin] ?? Level.Z;

  /** The module drawn with a controller showing `text` and the given pin levels. */
  function drawLcd(over: Record<string, Level> = {}, edit?: (c: Hd44780Controller) => void) {
    const ctl = createHd44780Controller('reset', 0);
    ctl.d = 1;
    ctl.n = 1;
    for (const [i, ch] of [...'Hi'].entries()) ctl.ddram[i] = ch.charCodeAt(0);
    edit?.(ctl);
    const g = new RecordingGraphics();
    drawPartBody(g, part('periph/hd44780', { backlight: 'blue' }), 'ansi', 'red', {
      part: { state: { ctl }, level: levels(over), light: () => 0, time: 0 },
      levelColor: (level) => `level-${levelChar(level)}`,
    });
    return g;
  }

  const glass = LCD_GLASS.blue;

  it('lights the glass while A is HIGH and K LOW, like an LED', () => {
    expect(drawLcd().paints).toContain(glass.lit);
    expect(drawLcd({ A: Level.Z }).paints).toEqual(expect.arrayContaining([glass.dark]));
    expect(drawLcd({ K: Level.L1 }).paints).not.toContain(glass.lit);
  });

  it('shows the characters only with V0 LOW (contrast)', () => {
    expect(drawLcd().paints).toContain(glass.on);
    expect(drawLcd({ V0: Level.Z }).paints).not.toContain(glass.on);
    expect(drawLcd({ V0: Level.L1 }).paints).not.toContain(glass.on);
  });

  it('marks unknown characters in the X color', () => {
    expect(drawLcd({}, (c) => c.ddramX.fill(1, 2, 3)).paints).toContain('level-Xaa');
    expect(drawLcd().paints).not.toContain('level-Xaa');
  });

  it('is a dark module before power-on, its pins named along the bottom', () => {
    const g = draw('periph/hd44780', {}, 'ansi');
    expect(g.paints).toContain(LCD_GLASS['yellow-green'].dark);
    expect(g.paints).not.toContain(LCD_GLASS['yellow-green'].on);
    const texts = Object.fromEntries(g.texts.map((t) => [t.text, t.style.overline ?? false]));
    expect(Object.keys(texts)).toEqual(expect.arrayContaining(['VSS', 'V0', 'E', 'DB7', 'K']));
    expect(texts['R/W']).toEqual([[2, 3]]);
  });
});

describe('TFT drawer', () => {
  /** A module's state after power-on with the display on, inversion on, 16-bit. */
  function tftState() {
    const behavior = st7789.create({ panel: '135x240' });
    const state = behavior.createState!() as {
      ctl: { [k: string]: unknown; gram: Uint32Array; version: number };
    };
    Object.assign(state.ctl, { sleep: 0, display: 1, inversion: 1 });
    return state;
  }

  function drawTft(state: object, blk: Level = Level.Z, epoch = 0) {
    const g = new RecordingGraphics();
    drawPartBody(g, part('periph/st7789', { panel: '135x240' }), 'ansi', 'red', {
      part: {
        state,
        level: (pin) => (pin === 'BLK' ? blk : Level.Z),
        light: () => 0,
        time: 0,
        epoch,
      },
      levelColor: () => '#ff0000',
    });
    return g;
  }

  it('shows the glass as an image of the panel’s size while the backlight is lit', () => {
    const g = drawTft(tftState());
    expect(g.images).toHaveLength(1);
    const { image, box } = g.images[0]!;
    expect([image.width, image.height]).toEqual([135, 240]);
    expect([box.width, box.height]).toEqual([135 / 16, 240 / 16]);
    expect(within(g.points, part('periph/st7789', { panel: '135x240' }).localBounds)).toBe(true);
  });

  it('is dark with BLK LOW, and before power-on', () => {
    const g = drawTft(tftState(), Level.L0);
    expect(g.images).toHaveLength(0);
    expect(g.paints).toContain(TFT_GLASS.dark);
    expect(draw('periph/st7789', {}, 'ansi').paints).toContain(TFT_GLASS.dark);
  });

  it('draws unknown memory as noise in the X color and known pixels as they are', () => {
    const state = tftState();
    state.ctl.gram[40 * 240 + 52] = 0x3ffff; // the glass's top-left pixel: white
    const { rgba } = drawTft(state).images[0]!.image;
    expect([...rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    const [r, g, b] = rgba.slice(4, 7);
    expect(r! > 0 && g === 0 && b === 0).toBe(true); // noise in the X color (#ff0000)
  });

  it('reuses the image while nothing changed, and makes a new one after a change or a rewind', () => {
    const state = tftState();
    const first = drawTft(state).images[0]!.image;
    expect(drawTft(state).images[0]!.image).toBe(first);
    state.ctl.version++;
    const second = drawTft(state).images[0]!.image;
    expect(second).not.toBe(first);
    expect(drawTft(state, Level.Z, 1).images[0]!.image).not.toBe(second);
  });

  it('names the pins along the bottom', () => {
    const texts = draw('periph/st7789', {}, 'ansi').texts.map((t) => t.text);
    expect(texts).toEqual(['GND', 'VCC', 'SCL', 'SDA', 'RES', 'DC', 'CS', 'BLK']);
  });
});
