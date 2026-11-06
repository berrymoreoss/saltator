import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit';
import { createDefaultRegistry } from '../library';
import { DEFAULT_CAMERA } from './camera';
import { WIRE_WIDTH } from './graphics';
import { drawCircuitPreview } from './preview';
import { type RenderOptions, renderScene, type SignalView } from './renderer';
import { buildScene } from './scene';
import { EMPTY_SELECTION } from './selection';
import { DARK_CANVAS, SignalStyle } from './theme';

const registry = createDefaultRegistry();

/** A 2D context that does nothing but record each stroke: `[color, lineWidth, segments]`. */
function recordingContext() {
  const strokes: [string, number, number][] = [];
  let segments = 0;
  const state: Record<string, unknown> = { strokeStyle: '', lineWidth: 1 };
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'measureText') return () => ({ width: 0 });
      if (key === 'beginPath') return () => (segments = 0);
      if (key === 'lineTo') return () => segments++;
      if (key === 'stroke') {
        return () => strokes.push([String(target.strokeStyle), Number(target.lineWidth), segments]);
      }
      return () => undefined;
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

// Two wires from a switch to an LED on one net, and a lone wire.
const circuit = new CircuitBuilder(registry)
  .add('SW1', 'io/switch', { at: [0, 0] })
  .add('D1', 'io/led', { at: [10, 0] })
  .connect('SW1.Y', 'D1.A', [7, 1])
  .wire([0, 10], [5, 10])
  .build();
const scene = buildScene(circuit, registry);
const [w1, w2, lone] = scene.wires.map((w) => w.id) as [string, string, string];

function draw(options: Partial<RenderOptions>) {
  const { ctx, strokes } = recordingContext();
  renderScene(
    ctx,
    scene,
    { camera: DEFAULT_CAMERA, viewport: { width: 800, height: 600 }, dpr: 1 },
    {
      theme: DARK_CANVAS,
      gateStyle: 'ansi',
      showGrid: false,
      selection: EMPTY_SELECTION,
      ...options,
    },
  );
  return strokes;
}

const levels = DARK_CANVAS.levels;
const signals = (styles: Record<string, SignalStyle>, flash = true): SignalView => ({
  wire: (id) => styles[id] ?? SignalStyle.NONE,
  point: () => SignalStyle.NONE,
  flash,
  part: () => undefined,
});
/** Strokes of the given width (in cells), as `color: segments`. */
const wireStrokes = (strokes: [string, number, number][], width = WIRE_WIDTH) =>
  strokes.filter(([, w]) => w === width).map(([color, , n]) => `${color}: ${n}`);

describe('renderScene: signals', () => {
  it('draws all wires in the wire color when not simulating', () => {
    expect(wireStrokes(draw({}))).toEqual([`${DARK_CANVAS.wire}: 3`]);
  });

  it('draws each wire in the color of its signal, one path per color', () => {
    const strokes = draw({
      signals: signals({ [w1]: SignalStyle.L1, [w2]: SignalStyle.L1, [lone]: SignalStyle.Z }),
    });
    expect(wireStrokes(strokes)).toEqual([`${levels.l1}: 2`, `${levels.z}: 1`]);
  });

  it('flashes contention and keeps a selected wire in its level color over a halo', () => {
    const selection = { parts: new Set<string>(), wires: new Set([lone]) };
    const styles = {
      [w1]: SignalStyle.CONTENTION,
      [w2]: SignalStyle.CONTENTION,
      [lone]: SignalStyle.WEAK_1,
    };
    const bright = draw({ selection, signals: signals(styles, true) });
    expect(wireStrokes(bright)).toEqual([`${levels.x}: 2`, `${levels.weak1}: 1`]);
    expect(wireStrokes(bright, WIRE_WIDTH * 4)).toEqual([`${DARK_CANVAS.hover}: 1`]);
    const dim = draw({ selection, signals: signals(styles, false) });
    expect(wireStrokes(dim)).toEqual([`${levels.contentionDim}: 2`, `${levels.weak1}: 1`]);
  });

  it('draws ghost wires in the selection color even while simulating', () => {
    const ghost = { parts: new Set<string>(), wires: new Set([lone]) };
    const strokes = draw({
      ghost,
      signals: signals({ [w1]: SignalStyle.L0, [w2]: SignalStyle.L0 }),
    });
    expect(wireStrokes(strokes)).toEqual([`${levels.l0}: 2`, `${DARK_CANVAS.selection}: 1`]);
  });
});

describe('drawCircuitPreview', () => {
  it('draws a whole circuit, and an empty one without failing', () => {
    const { ctx, strokes } = recordingContext();
    const size = { width: 200, height: 120 };
    const options = { theme: DARK_CANVAS, gateStyle: 'ansi' as const, dpr: 2 };
    drawCircuitPreview(ctx, registry, circuit, size, options);
    expect(strokes.length).toBeGreaterThan(3);
    const empty = recordingContext();
    const nothing = { ...circuit, components: [], wires: [] };
    drawCircuitPreview(empty.ctx, registry, nothing, size, options);
    expect(empty.strokes.length).toBeLessThan(strokes.length);
  });
});
