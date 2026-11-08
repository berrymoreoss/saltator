import { describe, expect, it } from 'vitest';
import {
  addCircuit,
  type CircuitDocument,
  type Point,
  removeItems,
  replaceCircuit,
  setTopCircuit,
} from '../circuit';
import { Level, ns, strong } from '../core';
import { testDriver } from '../core/testing';
import { createDefaultRegistry } from '../library';
import { Editor, type PointerInput } from './editor';
import { FakeClock } from './fake-clock';
import { selectionOf } from './selection';
import { chainDesign, lampDesign, latchedRegisters, toggleDesign } from './test-documents';
import { SignalStyle } from './theme';

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
    // Up several levels at once: the instance on the way down selected.
    editor.openInstance('A2/A1');
    expect(editor.goUpTo('A1')).toBe(false);
    expect(editor.goUpTo('')).toBe(true);
    expect(where(editor)).toEqual(['main', '']);
    expect([...editor.state.get().selection.parts]).toEqual(['A2']);
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

describe('Editor: live levels inside an instance', () => {
  /** The signal style at a pin tip of a part of the open circuit. */
  const atPin = (editor: Editor, part: string, pin: string) => {
    const tip = editor.scene.partById.get(part)!.pins.find((p) => p.name === pin)!.at;
    return editor.simulation.signalView()!.point(tip);
  };

  it('draws each instance with its own levels, parts and pins', () => {
    const { editor, simulation } = latchedRegisters(library);
    editor.openCircuit('reg');
    expect(editor.state.get().path).toBe('A1');
    expect(editor.flatPart('U1')).toBe('A1/U1');
    expect(atPin(editor, 'U1', '1Q')).toBe(SignalStyle.L1);
    expect(simulation.signalView()!.part('U1')!.level('1Q')).toBe(Level.L1);
    expect(simulation.pinStyle(editor.flatPart('U1')!, '1Q')).toBe(SignalStyle.L1);
    // The same scene in A2: mapped again, its own levels.
    editor.openInstance('A2');
    expect(atPin(editor, 'U1', '1Q')).toBe(SignalStyle.L0);
    expect(simulation.signalView()!.part('U1')!.level('1Q')).toBe(Level.L0);
    editor.goTop();
    expect(simulation.signalView()!.part('D1')).toBeDefined();
  });

  it('re-maps one scene for another instance path (the host compares paths too)', () => {
    const { editor, simulation } = latchedRegisters(library);
    editor.openInstance('A1');
    const { design, scene } = editor.state.get();
    simulation.sync({
      netlist: design.netlist,
      scene,
      path: 'A2',
      flatNet: (net) => design.netOf('A2', net),
      flatPart: (id) => `A2/${id}`,
    });
    expect(atPin(editor, 'U1', '1Q')).toBe(SignalStyle.L0);
    expect(simulation.signalView()!.part('U1')!.level('1Q')).toBe(Level.L0);
  });

  it('draws nothing live in a circuit the design places nowhere', () => {
    const { editor, simulation } = latchedRegisters(library);
    const { document, id } = addCircuit(editor.state.get().document, 'Spare');
    editor.editDocument('Add Circuit', document, { open: id });
    expect(editor.flatPart('U1')).toBeUndefined();
    expect(simulation.signalView()!.part('U1')).toBeUndefined();
  });

  it('carries the run over an edit made inside an instance, which stays open', () => {
    const { editor, simulation } = latchedRegisters(library);
    editor.openInstance('A2');
    const now = simulation.simulator!.now;
    editor.placePart('prim/not');
    click(editor, [60, 30]);
    expect(editor.state.get().path).toBe('A2');
    expect(simulation.simulator!.now).toBe(now);
    expect(atPin(editor, 'U1', '1Q')).toBe(SignalStyle.L0);
    editor.openInstance('A1');
    expect(atPin(editor, 'U1', '1Q')).toBe(SignalStyle.L1);
  });

  it('shows each instance’s lights', () => {
    const clock = new FakeClock();
    const editor = new Editor(library, lampDesign(library), {}, { simulation: { clock } });
    const { simulation } = editor;
    simulation.run();
    simulation.pause();
    simulation.action('D1', strong(Level.L1));
    simulation.action('D2', strong(Level.L0));
    simulation.runTo({ kind: 'time', until: ns(100), label: 'test' });
    for (let i = 0; i < 100 && simulation.state === 'running'; i++) clock.frame(16);
    editor.openInstance('A1');
    expect(simulation.signalView()!.part('D1')!.light(0)).toBe(1);
    editor.openInstance('A2');
    expect(simulation.signalView()!.part('D1')!.light(0)).toBe(0);
  });
});

describe('Editor: tools inside an instance', () => {
  /** The world point halfway along a pin of a part of the open circuit. */
  const onPin = (editor: Editor, part: string, pin: string): Point => {
    const p = editor.scene.partById.get(part)!.pins.find((q) => q.name === pin)!;
    return [(p.base[0] + p.at[0]) / 2, (p.base[1] + p.at[1]) / 2];
  };
  const center = (editor: Editor, part: string): Point => {
    const { x, y, width, height } = editor.scene.partById.get(part)!.body;
    return [x + width / 2, y + height / 2];
  };
  function running(document: CircuitDocument) {
    const clock = new FakeClock();
    const editor = new Editor(library, document, {}, { simulation: { clock } });
    editor.simulation.run();
    return { clock, editor, state: (id: string) => editor.simulation.simulator!.stateOf(id) };
  }

  it('flips the switch of the instance open, and only that one', () => {
    const { editor, state } = running(toggleDesign(library));
    editor.openInstance('A2');
    expect(editor.tool.get()).toBe('interact');
    click(editor, center(editor, 'SW1'));
    expect([state('A1/SW1'), state('A2/SW1')]).toEqual([{ on: false }, { on: true }]);
    editor.openInstance('A1');
    click(editor, center(editor, 'SW1'));
    click(editor, center(editor, 'SW1'));
    expect([state('A1/SW1'), state('A2/SW1')]).toEqual([{ on: false }, { on: true }]);
  });

  it('probes inside an instance by its path, named as read there; a second click removes it', () => {
    const { editor } = running(chainDesign(library));
    editor.setTool('probe');
    editor.openInstance('A1/A2');
    click(editor, onPin(editor, 'U1', 'Y'));
    expect(editor.analyzer.probes).toEqual([{ ref: 'A1/A2/U1.Y' }]);
    click(editor, center(editor, 'P1')); // the port A: its net, by its name inside
    expect(editor.analyzer.probes.map((p) => 'ref' in p && p.ref)).toEqual([
      'A1/A2/U1.Y',
      'A1/A2/A',
    ]);
    expect(editor.analyzer.channels.get().map((c) => c.problem)).toEqual([undefined, undefined]);
    editor.goUp();
    click(editor, center(editor, 'NLMID0')); // a label in Chain, inside A1
    expect(editor.analyzer.probes.at(-1)).toEqual({ ref: 'A1/MID' });
    editor.openInstance('A1/A2');
    click(editor, onPin(editor, 'U1', 'Y'));
    expect(editor.analyzer.probes.map((p) => 'ref' in p && p.ref)).toEqual(['A1/A2/A', 'A1/MID']);
  });

  it('gives the context menu’s Add to Waveforms, Break When and Watch the path', () => {
    const { editor } = running(chainDesign(library));
    editor.openInstance('A2/A1');
    const [x, y] = onPin(editor, 'U1', 'Y');
    editor.pointerDown({ at: [x * 16, y * 16], button: 2, shift: false });
    expect(editor.contextProbe?.ref).toBe('A2/A1/U1.Y');
  });

  it('refuses to probe a circuit the design places nowhere', () => {
    const { editor } = running(chainDesign(library));
    const doc = editor.state.get().document;
    const { document, id } = addCircuit(doc, 'Spare');
    const spare = document.circuits.find((c) => c.id === id)!;
    editor.editDocument(
      'Add Circuit',
      replaceCircuit(document, {
        ...spare,
        components: doc.circuits.find((c) => c.id === 'inverter')!.components,
      }),
      { open: id },
    );
    editor.setTool('probe');
    click(editor, onPin(editor, 'U1', 'Y'));
    expect(editor.analyzer.probes).toEqual([]);
    const request = editor.requests.get();
    expect(request?.kind === 'probed' && request.problem).toBe(
      "Spare isn't placed in Main, so it doesn't simulate: place it to probe it.",
    );
  });

  it('locates a part or a net of the design in the instance it is in', () => {
    const { editor } = running(chainDesign(library));
    editor.locatePart('A1/A2/U1');
    expect(where(editor)).toEqual(['inverter', 'A1/A2']);
    expect([...editor.state.get().selection.parts]).toEqual(['U1']);
    editor.locatePart('D2');
    expect(where(editor)).toEqual(['main', '']);
    expect([...editor.state.get().selection.parts]).toEqual(['D2']);
    editor.locateNet('A2/MID');
    expect(where(editor)).toEqual(['chain', 'A2']);
    editor.locatePart('A9/U1');
    expect(where(editor)).toEqual(['chain', 'A2']);
  });
});

describe('Editor: going in and out', () => {
  // Inside the body's bottom right corner: the labels on an instance's input pins cover its left.
  const corner = (editor: Editor, part: string): Point => {
    const { x, y, width, height } = editor.scene.partById.get(part)!.body;
    return [x + width - 0.5, y + height - 0.5];
  };
  const doubleClick = (editor: Editor, part: string) =>
    editor.doubleClick(input(corner(editor, part)));

  it('goes into an instance by double-click, stopped or running', () => {
    const editor = new Editor(library, chainDesign(library));
    doubleClick(editor, 'A2');
    expect(where(editor)).toEqual(['chain', 'A2']);
    doubleClick(editor, 'A1');
    expect(where(editor)).toEqual(['inverter', 'A2/A1']);
    doubleClick(editor, 'U1'); // no instance: its properties
    expect(where(editor)).toEqual(['inverter', 'A2/A1']);
    expect(editor.requests.get()?.kind).toBe('edit-properties');
    editor.goTop();
    editor.simulation.run();
    expect(editor.tool.get()).toBe('interact');
    doubleClick(editor, 'A1');
    expect(where(editor)).toEqual(['chain', 'A1']);
    expect(editor.goInto('A2')).toBe(true);
    expect(where(editor)).toEqual(['inverter', 'A1/A2']);
    expect(editor.goInto('U1')).toBe(false);
  });

  it('goes from a circuit placed nowhere into the first instance of the one it places', () => {
    const editor = new Editor(library, chainDesign(library));
    const { document, id } = addCircuit(editor.state.get().document, 'Spare');
    const spare = document.circuits.find((c) => c.id === id)!;
    const instance = editor.state
      .get()
      .document.circuits[1]!.components.find((c) => c.id === 'A1')!;
    editor.editDocument(
      'Add Circuit',
      replaceCircuit(document, { ...spare, components: [instance] }),
      { open: id },
    );
    expect(where(editor)).toEqual(['spare', undefined]);
    doubleClick(editor, 'A1');
    expect(where(editor)).toEqual(['inverter', 'A1/A1']);
  });

  it('goes up to the instance it came from, keeping a view that shows it', () => {
    const editor = new Editor(library, chainDesign(library));
    editor.view.update((view) => ({ ...view, viewport: { width: 800, height: 600 } }));
    editor.setCamera({ x: 0, y: 0, scale: 16 });
    doubleClick(editor, 'A2');
    editor.goUp();
    expect(editor.view.get().camera).toEqual({ x: 0, y: 0, scale: 16 });
    // Panned away from A2 meanwhile: brought back into view.
    editor.setCamera({ x: 5000, y: 5000, scale: 16 });
    doubleClick(editor, 'A2'); // nothing there: stays
    expect(where(editor)).toEqual(['main', '']);
    editor.openInstance('A2');
    editor.goUp();
    const { camera } = editor.view.get();
    expect(camera).not.toEqual({ x: 5000, y: 5000, scale: 16 });
    expect([...editor.state.get().selection.parts]).toEqual(['A2']);
  });
});
