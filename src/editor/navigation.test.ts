import { describe, expect, it } from 'vitest';
import {
  addCircuit,
  type CircuitDocument,
  type Point,
  removeItems,
  replaceCircuit,
  setTopCircuit,
} from '../circuit';
import { testDriver } from '../core/testing';
import { createDefaultRegistry } from '../library';
import { Editor, type PointerInput } from './editor';
import { selectionOf } from './selection';
import { chainDesign } from './test-documents';

// Going into instances (R11b), headless: pointer input at 16 px a cell.
const library = createDefaultRegistry().register(testDriver);
const input = (p: Point): PointerInput => ({
  at: [p[0] * 16, p[1] * 16],
  button: 0,
  shift: false,
});
function click(editor: Editor, at: Point): void {
  editor.pointerMove(input(at));
  editor.pointerDown(input(at));
  editor.pointerUp(input(at));
}
const where = (editor: Editor) => {
  const { circuit, path } = editor.state.get();
  return [circuit.id, path];
};

describe('Editor: the instance open', () => {
  it('opens the top at path "" and a subcircuit in its first instance', () => {
    const editor = new Editor(library, chainDesign(library));
    expect(where(editor)).toEqual(['main', '']);
    editor.openCircuit('chain');
    expect(where(editor)).toEqual(['chain', 'A1']);
    editor.openCircuit('inverter');
    expect(where(editor)).toEqual(['inverter', 'A1/A1']);
    expect(editor.undoLabel).toBeUndefined();
  });

  it('goes into an instance and up again, selecting the instance it came from', () => {
    const editor = new Editor(library, chainDesign(library));
    editor.openInstance('A2/A2');
    expect(where(editor)).toEqual(['inverter', 'A2/A2']);
    expect(editor.goUp()).toBe(true);
    expect(where(editor)).toEqual(['chain', 'A2']);
    expect([...editor.state.get().selection.parts]).toEqual(['A2']);
    expect(editor.goUp()).toBe(true);
    expect(where(editor)).toEqual(['main', '']);
    expect([...editor.state.get().selection.parts]).toEqual(['A2']);
    expect(editor.goUp()).toBe(false);
    editor.openInstance('A9');
    expect(where(editor)).toEqual(['main', '']);
    editor.openInstance('A1/A2');
    editor.goTop();
    expect(where(editor)).toEqual(['main', '']);
  });

  it('switches between instances of the open circuit, keeping the selection and the camera', () => {
    const editor = new Editor(library, chainDesign(library));
    editor.openInstance('A1/A1');
    editor.setSelection(selectionOf(['U1']));
    editor.setCamera({ x: 3, y: 4, scale: 20 });
    editor.openInstance('A2/A1');
    expect(where(editor)).toEqual(['inverter', 'A2/A1']);
    expect([...editor.state.get().selection.parts]).toEqual(['U1']);
    expect(editor.view.get().camera).toEqual({ x: 3, y: 4, scale: 20 });
    // Opening the circuit it is in already stays in that instance.
    editor.openCircuit('inverter');
    expect(where(editor)).toEqual(['inverter', 'A2/A1']);
  });

  it('stays in the instance through edits; an undo comes back in it', () => {
    const editor = new Editor(library, chainDesign(library));
    editor.openInstance('A2/A1');
    editor.placePart('prim/not');
    click(editor, [40, 30]);
    expect(where(editor)).toEqual(['inverter', 'A2/A1']);
    editor.goTop();
    editor.undo();
    expect(where(editor)).toEqual(['inverter', 'A2/A1']);
    editor.goTop();
    editor.redo();
    expect(where(editor)).toEqual(['inverter', 'A2/A1']);
  });

  it('falls back to the first instance when its own is gone, and to none', () => {
    const editor = new Editor(library, chainDesign(library));
    editor.openInstance('A2/A1');
    const remove = (doc: CircuitDocument, circuit: string, part: string) =>
      replaceCircuit(
        doc,
        removeItems(doc.circuits.find((c) => c.id === circuit)!, { parts: [part], wires: [] }),
      );
    editor.editDocument('Delete A2', remove(editor.state.get().document, 'main', 'A2'));
    expect(where(editor)).toEqual(['inverter', 'A1/A1']);
    editor.editDocument('Delete A1', remove(editor.state.get().document, 'main', 'A1'));
    expect(where(editor)).toEqual(['inverter', undefined]);
    expect(editor.goUp()).toBe(false);
    const { document, id } = addCircuit(editor.state.get().document, 'Spare');
    editor.editDocument('Add Circuit', document, { open: id });
    expect(where(editor)).toEqual(['spare', undefined]);
  });

  it('follows Set as Top: the new top is "", its instances the paths', () => {
    const editor = new Editor(library, chainDesign(library));
    editor.openInstance('A1/A2');
    editor.editDocument('Set as Top', setTopCircuit(editor.state.get().document, 'chain'));
    expect(where(editor)).toEqual(['inverter', 'A2']);
    editor.openCircuit('chain');
    expect(where(editor)).toEqual(['chain', '']);
  });

  it('opens a document in the instance asked for, else the first', () => {
    const editor = new Editor(library);
    editor.setDocument(chainDesign(library), { open: 'inverter', path: 'A2/A2' });
    expect(where(editor)).toEqual(['inverter', 'A2/A2']);
    editor.setDocument(chainDesign(library), { open: 'inverter', path: 'A7' });
    expect(where(editor)).toEqual(['inverter', 'A1/A1']);
  });
});
