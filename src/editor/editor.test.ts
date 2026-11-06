import { describe, expect, it } from 'vitest';
import { CircuitBuilder } from '../circuit';
import { createDefaultRegistry } from '../library';
import { toScreen } from './camera';
import { Editor } from './editor';
import { selectionOf } from './selection';

// The editor's document, selection and camera logic works without a canvas (no DOM needed);
// pointer input and drawing are covered by the Playwright tests.
const registry = createDefaultRegistry();
const circuit = new CircuitBuilder(registry)
  .add('SW1', 'io/switch', { at: [0, 0] })
  .add('U1', 'prim/nand', { at: [10, 0] })
  .connect('SW1.Y', 'U1.A')
  .build();

describe('Editor (headless)', () => {
  it('keeps the selection of items that survive a circuit change', () => {
    const editor = new Editor(registry, circuit);
    editor.setSelection(selectionOf(['SW1', 'U1'], ['w1']));
    const smaller = new CircuitBuilder(registry).add('U1', 'prim/nand', { at: [10, 0] }).build();
    editor.setCircuit(smaller);
    const { selection } = editor.state.get();
    expect([...selection.parts]).toEqual(['U1']);
    expect(selection.wires.size).toBe(0);
  });

  it('selects all and clears', () => {
    const editor = new Editor(registry, circuit);
    editor.selectAll();
    expect(editor.state.get().selection.parts.size).toBe(2);
    editor.clearSelection();
    expect(editor.state.get().selection.parts.size).toBe(0);
  });

  it('locates an item: selects it and centers it at 100 % or more', () => {
    const editor = new Editor(registry, circuit);
    editor.view.update((view) => ({
      ...view,
      viewport: { width: 800, height: 600 },
      camera: { x: 0, y: 0, scale: 4 },
    }));
    editor.locate({ component: 'U1' });
    expect([...editor.state.get().selection.parts]).toEqual(['U1']);
    const { camera } = editor.view.get();
    expect(camera.scale).toBe(16);
    const [x, y] = toScreen(camera, [13, 2]); // the center of U1's bounds
    expect(x).toBeCloseTo(400);
    expect(y).toBeCloseTo(300);
  });

  it('zooms in and out by ladder steps about the view center', () => {
    const editor = new Editor(registry, circuit);
    editor.view.update((view) => ({ ...view, viewport: { width: 800, height: 600 } }));
    editor.zoomIn();
    expect(editor.view.get().camera.scale).toBeCloseTo(16 * Math.SQRT2);
    editor.zoomActual();
    expect(editor.view.get().camera.scale).toBeCloseTo(16);
    editor.zoomOut();
    expect(editor.view.get().camera.scale).toBeCloseTo(16 / Math.SQRT2);
  });
});
