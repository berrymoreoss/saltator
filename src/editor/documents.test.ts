import { describe, expect, it } from 'vitest';
import {
  addCircuit,
  type Circuit,
  type CircuitDocument,
  emptyCircuit,
  type Point,
  renameCircuit,
  replaceCircuit,
  SCHEMA_VERSION,
} from '../circuit';
import { Level, ns, strong } from '../core';
import { testDriver } from '../core/testing';
import { createDefaultRegistry } from '../library';
import { Editor, type PointerInput } from './editor';
import { selectionOf } from './selection';
import { inverterCircuit, latchedRegisters, port } from './test-documents';

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

const inverter = () => inverterCircuit(registry);

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

  it('keeps the camera when the open circuit is renamed to a new id', () => {
    const editor = new Editor(registry, document());
    const { document: next, id } = addCircuit(editor.state.get().document, 'Circuit 3');
    editor.editDocument('Add Circuit', next, { open: id });
    editor.setCamera({ x: 7, y: 8, scale: 25 });
    const doc = editor.state.get().document;
    editor.editDocument('Rename', renameCircuit(doc, 'circuit-3', 'Adder'), { open: 'adder' });
    expect(editor.state.get().circuit.id).toBe('adder');
    expect(editor.view.get().camera).toEqual({ x: 7, y: 8, scale: 25 });
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
    // The instance's own path too: references to nets inside it (`A1/CLK`) follow.
    expect(editor.state.get().renames).toEqual(
      new Map([
        ['A1', 'INV'],
        ['A1/U1', 'INV/U1'],
      ]),
    );
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

describe('Editor on documents: simulating the design', () => {
  const library = createDefaultRegistry().register(testDriver);
  const latched = () => latchedRegisters(library);

  it('simulates the instances, each with its own state', () => {
    const { q } = latched();
    expect([q('A1/U1'), q('A2/U1')]).toEqual([Level.L1, Level.L0]);
  });

  it('carries the run over an edit of the definition, every instance keeping its state', () => {
    const { editor, simulation, q } = latched();
    const now = simulation.simulator!.now;
    editor.openCircuit('reg');
    editor.placePart('prim/not');
    click(editor, [60, 30]);
    expect(editor.state.get().design.netlist.components.map((c) => c.id)).toContain('A2/U2');
    expect(simulation.simulator!.now).toBe(now);
    expect([q('A1/U1'), q('A2/U1')]).toEqual([Level.L1, Level.L0]);
    // Renamed inside the module: the state follows the new path in both instances.
    editor.renamePart('U1', 'U7');
    expect([q('A1/U7'), q('A2/U7')]).toEqual([Level.L1, Level.L0]);
  });

  it('probes and watches signals inside instances by path', () => {
    const { editor, step } = latched();
    expect(editor.analyzer.addProbe({ ref: 'A1/U1.1Q' })).toBeUndefined();
    expect(editor.state.get().document.circuits[0]!.probes).toEqual([{ ref: 'A1/U1.1Q' }]);
    expect(editor.analyzer.channels.get()[0]!.problem).toBeUndefined();
    expect(editor.debug.addWatch('A2/Q')).toBeUndefined();
    step(ns(300));
    expect(editor.debug.watches.get().map((w) => [w.label, w.value])).toEqual([['A2/Q', '0']]);
    // The probes are the top circuit's, whichever circuit is open.
    editor.openCircuit('reg');
    expect(editor.analyzer.probes).toEqual([{ ref: 'A1/U1.1Q' }]);
  });

  it('breaks on a signal inside an instance, and keeps watches and breakpoints across a rename', () => {
    const { editor, simulation, step } = latched();
    const id = editor.debug.addBreakpoint([{ signal: 'A2/U1.1Q', kind: 'rise' }]);
    expect(typeof id).toBe('number');
    expect(editor.debug.addWatch('A1/U1.1Q')).toBeUndefined();
    editor.renamePart('A2', 'LOW');
    expect(editor.debug.setup.get().breakpoints[0]!.terms[0]!.signal).toBe('LOW/U1.1Q');
    expect(editor.debug.watches.get().map((w) => w.label)).toEqual(['A1/U1.1Q']);
    // Latch a 1 into LOW: its Q rises and the breakpoint pauses there.
    simulation.action('D2', strong(Level.L1));
    simulation.action('CK', strong(Level.L0));
    step(ns(400));
    const edge = simulation.simulator!.now;
    simulation.action('CK', strong(Level.L1));
    step(edge + ns(400));
    expect(simulation.status.get().reason).toBe('Breakpoint 1: LOW/U1.1Q ↑');
    expect(simulation.simulator!.now).toBeLessThan(edge + ns(400));
  });

  it('lists a memory inside an instance and edits its circuit’s image', () => {
    const rom: Circuit = {
      ...emptyCircuit('rom', 'ROM'),
      components: [
        { id: 'U1', type: 'mem/at28c16', x: 0, y: 0, rotation: 0, flip: false, props: {} },
      ],
    };
    const top: Circuit = {
      ...emptyCircuit(),
      components: [{ id: 'A1', type: 'sub/rom', x: 0, y: 0, rotation: 0, flip: false, props: {} }],
    };
    const editor = new Editor(library, { schemaVersion: SCHEMA_VERSION, circuits: [top, rom] });
    expect(editor.memory.memories().map((m) => m.id)).toEqual(['A1/U1']);
    expect(editor.memory.write('A1/U1', 0x10, [0xab])).toBeUndefined();
    const image = editor.state.get().document.circuits[1]!.components[0]!.props.contents;
    expect(String(image)).toContain('0010:AB');
    expect(editor.state.get().circuit.id).toBe('main');
    editor.undo();
    expect(
      String(editor.state.get().document.circuits[1]!.components[0]!.props.contents ?? ''),
    ).not.toContain('AB');
  });
});
