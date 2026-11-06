import { describe, expect, it } from 'vitest';
import { CircuitBuilder, removeItems, renameComponent, updateComponent } from '../circuit';
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

  it('records each edit as one undo step and restores circuit and selection', () => {
    const editor = new Editor(registry, circuit);
    editor.setSelection(selectionOf(['U1']));
    const moved = updateComponent(circuit, 'U1', { x: 12 });
    expect(editor.edit('Move', moved)).toBe(true);
    expect(editor.state.get().circuit).toBe(moved);
    expect(editor.undoLabel).toBe('Move');
    expect(editor.edit('Delete', removeItems(moved, { parts: ['U1'], wires: [] }))).toBe(true);
    expect(editor.state.get().selection.parts.size).toBe(0);

    editor.undo();
    expect(editor.state.get().circuit).toBe(moved);
    expect([...editor.state.get().selection.parts]).toEqual(['U1']);
    expect(editor.redoLabel).toBe('Delete');
    editor.undo();
    expect(editor.state.get().circuit).toBe(circuit);
    expect(editor.undoLabel).toBeUndefined();
    editor.undo(); // nothing left: no-op
    editor.redo();
    editor.redo();
    expect(editor.state.get().circuit.components.map((c) => c.id)).toEqual(['SW1']);
    expect(editor.redoLabel).toBeUndefined();
  });

  it('records nothing for an edit that changes nothing; normalizes wires', () => {
    const editor = new Editor(registry, circuit);
    expect(editor.edit('Nothing', circuit)).toBe(false);
    expect(editor.undoLabel).toBeUndefined();
    // Splitting the switch → NAND wire in two: normalization merges it back, so nothing changed.
    const [w] = circuit.wires;
    const split = {
      ...circuit,
      wires: [
        { id: 'w1', from: w!.from, to: [7, 1] as const },
        { id: 'w2', from: [7, 1] as const, to: w!.to },
      ],
    };
    expect(editor.edit('Split', split)).toBe(false);
  });

  it('coalesces nudges, reports renames and their inverse on undo; loading clears history', () => {
    const editor = new Editor(registry, circuit);
    const one = updateComponent(circuit, 'U1', { x: 11 });
    const two = updateComponent(one, 'U1', { x: 12 });
    editor.edit('Nudge', one, { coalesce: 'nudge' });
    editor.edit('Nudge', two, { coalesce: 'nudge' });
    editor.undo();
    expect(editor.state.get().circuit).toBe(circuit);

    const renames = new Map([['U1', 'NAND']]);
    editor.edit('Rename U1', renameComponent(circuit, 'U1', 'NAND'), { renames });
    expect(editor.state.get().renames).toEqual(renames);
    editor.setSelection(selectionOf(['NAND']));
    expect(editor.state.get().renames).toBeUndefined();
    editor.undo();
    expect(editor.state.get().renames).toEqual(new Map([['NAND', 'U1']]));
    editor.redo();
    expect(editor.state.get().renames).toEqual(renames);

    editor.setCircuit(circuit);
    expect(editor.undoLabel).toBeUndefined();
    expect(editor.redoLabel).toBeUndefined();
  });

  it('setCircuit can restore a view instead of fitting', () => {
    const editor = new Editor(registry);
    const camera = { x: -12, y: 7, scale: 24 };
    editor.setCircuit(circuit, { camera });
    expect(editor.view.get().camera).toEqual(camera);
  });
});
