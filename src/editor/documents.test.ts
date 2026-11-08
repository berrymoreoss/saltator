import { describe, expect, it } from 'vitest';
import {
  addCircuit,
  type Circuit,
  CircuitBuilder,
  type CircuitDocument,
  type ComponentInstance,
  emptyCircuit,
  type Point,
  replaceCircuit,
  SCHEMA_VERSION,
} from '../circuit';
import { createDefaultRegistry } from '../library';
import { Editor, type PointerInput } from './editor';
import { selectionOf } from './selection';

// The editor on documents with several circuits (R11a), headless: pointer input at 16 px a cell.
const registry = createDefaultRegistry();
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

const port = (
  id: string,
  name: string,
  x: number,
  y: number,
  direction = 'in',
): ComponentInstance => ({
  id,
  type: 'net/port',
  x,
  y,
  rotation: 0,
  flip: false,
  props: { name, direction, side: 'auto' },
});

/** `inverter`: a 74HC04 gate between ports A (in) and Y (out), joined by labels at its pins. */
function inverter(): Circuit {
  const b = new CircuitBuilder(registry, { id: 'inverter', name: 'Inverter' });
  b.add('U1', 'prim/not', { at: [10, 0] });
  const [a, y] = [b.pin('U1.A'), b.pin('U1.Y')];
  const circuit = b.build();
  return {
    ...circuit,
    components: [
      ...circuit.components,
      port('P1', 'A', a[0], a[1]),
      port('P2', 'Y', y[0], y[1], 'out'),
    ],
  };
}

function document(): CircuitDocument {
  const main = {
    ...emptyCircuit(),
    components: [
      { id: 'A1', type: 'sub/inverter', x: 20, y: 0, rotation: 0, flip: false, props: {} } as const,
    ],
  };
  return { schemaVersion: SCHEMA_VERSION, circuits: [main, inverter()] };
}

describe('Editor on documents', () => {
  it('holds the whole document, the top open, and the flattened design', () => {
    const editor = new Editor(registry, document());
    const state = editor.state.get();
    expect(state.circuit.id).toBe('main');
    expect(state.document.circuits.map((c) => c.id)).toEqual(['main', 'inverter']);
    expect(state.design.netlist.components.map((c) => c.id)).toEqual(['A1/U1']);
    expect(editor.registry.get('sub/inverter')!.name).toBe('Inverter');
    expect(editor.scene.partById.get('A1')!.pins.map((p) => p.name)).toEqual(['A', 'Y']);
  });

  it('opens another circuit without an edit, each with its own camera', () => {
    const editor = new Editor(registry, document());
    editor.setCamera({ x: 5, y: 6, scale: 20 });
    editor.openCircuit('inverter');
    expect(editor.state.get().circuit.id).toBe('inverter');
    expect(editor.scene.partById.has('U1')).toBe(true);
    expect(editor.undoLabel).toBeUndefined();
    editor.setCamera({ x: -3, y: 1, scale: 30 });
    editor.openCircuit('main');
    expect(editor.view.get().camera).toEqual({ x: 5, y: 6, scale: 20 });
    editor.openCircuit('inverter');
    expect(editor.view.get().camera).toEqual({ x: -3, y: 1, scale: 30 });
    expect(editor.cameras.get('main')).toEqual({ x: 5, y: 6, scale: 20 });
    editor.openCircuit('nothing');
    expect(editor.state.get().circuit.id).toBe('inverter');
  });

  it('edits the open circuit inside the document; the instances follow its ports', () => {
    const editor = new Editor(registry, document());
    editor.openCircuit('inverter');
    const { circuit } = editor.state.get();
    editor.edit('Place', {
      ...circuit,
      components: [...circuit.components, port('P3', 'EN', 0, 20)],
    });
    const state = editor.state.get();
    expect(state.document.circuits[1]).toBe(state.circuit);
    const instance = state.design.circuits.get('main')!;
    expect(instance.nets.flatMap((n) => n.instancePins.map((p) => p.pin))).toEqual([
      'A',
      'EN',
      'Y',
    ]);
  });

  it('undoes an edit made in another circuit by opening it', () => {
    const editor = new Editor(registry, document());
    editor.openCircuit('inverter');
    editor.setSelection(selectionOf(['U1']));
    editor.deleteSelection();
    editor.openCircuit('main');
    editor.undo();
    expect(editor.state.get().circuit.id).toBe('inverter');
    expect(editor.scene.partById.has('U1')).toBe(true);
    expect([...editor.state.get().selection.parts]).toEqual(['U1']);
    editor.redo();
    expect(editor.scene.partById.has('U1')).toBe(false);
  });

  it('edits the document as one undo step, keeping or choosing the circuit open', () => {
    const editor = new Editor(registry, document());
    const { document: next, id } = addCircuit(editor.state.get().document, 'Counter');
    expect(editor.editDocument('Add Circuit', next, { open: id })).toBe(true);
    expect(editor.state.get().circuit.id).toBe('counter');
    expect(editor.editDocument('Nothing', editor.state.get().document)).toBe(false);
    editor.undo();
    expect(editor.state.get().document.circuits.map((c) => c.id)).toEqual(['main', 'inverter']);
    expect(editor.state.get().circuit.id).toBe('main');
  });

  it('places an instance of another circuit, never one that contains the open circuit', () => {
    const editor = new Editor(registry, document());
    editor.placePart('sub/inverter');
    click(editor, [40, 10]);
    expect(editor.state.get().circuit.components.map((c) => c.id)).toEqual(['A1', 'A2']);
    expect(editor.state.get().design.netlist.components.map((c) => c.id)).toEqual([
      'A1/U1',
      'A2/U1',
    ]);
    editor.escape();
    editor.openCircuit('inverter');
    editor.placePart('sub/main');
    click(editor, [40, 10]);
    editor.placePart('sub/inverter');
    click(editor, [40, 20]);
    expect(editor.state.get().circuit.components.map((c) => c.id)).toEqual(['U1', 'P1', 'P2']);
  });

  it('renames a part inside a subcircuit in the top circuit’s probes and for the simulator', () => {
    const doc = document();
    const probed = replaceCircuit(doc, { ...doc.circuits[0]!, probes: [{ ref: 'A1/U1.Y' }] });
    const editor = new Editor(registry, probed);
    editor.openCircuit('inverter');
    expect(editor.renamePart('U1', 'U7')).toBeUndefined();
    const state = editor.state.get();
    expect(state.document.circuits[0]!.probes).toEqual([{ ref: 'A1/U7.Y' }]);
    expect(state.renames).toEqual(new Map([['A1/U1', 'A1/U7']]));
    editor.undo();
    expect(editor.state.get().renames).toEqual(new Map([['A1/U7', 'A1/U1']]));
    // Renaming the instance renames every part inside it.
    editor.openCircuit('main');
    editor.renamePart('A1', 'INV');
    expect(editor.state.get().renames).toEqual(new Map([['A1/U1', 'INV/U1']]));
    expect(editor.state.get().document.circuits[0]!.probes).toEqual([{ ref: 'INV/U1.Y' }]);
  });

  it('copies instances with their circuits into another document', () => {
    const source = new Editor(registry, document());
    source.setSelection(selectionOf(['A1']));
    const text = source.copySelection()!;
    const target = new Editor(registry, emptyCircuit());
    expect(target.pasteText(text)).toBe(true);
    click(target, [10, 10]);
    const state = target.state.get();
    expect(state.document.circuits.map((c) => c.id)).toEqual(['main', 'inverter']);
    expect(state.circuit.components.map((c) => c.type)).toEqual(['sub/inverter']);
    expect(state.design.netlist.components.map((c) => c.id)).toEqual(['A1/U1']);
    // One undo takes the paste back, circuit and all.
    target.undo();
    expect(target.state.get().document.circuits.map((c) => c.id)).toEqual(['main']);
  });

  it('refuses to paste an instance of a circuit that contains the open one', () => {
    const editor = new Editor(registry, document());
    editor.setSelection(selectionOf(['A1']));
    const text = editor.copySelection()!;
    editor.openCircuit('inverter');
    expect(editor.pasteText(text)).toBe(false);
  });
});
