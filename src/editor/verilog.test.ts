import { describe, expect, it } from 'vitest';
import { addCircuit, type CircuitDocument, emptyDocument, replaceCircuit } from '../circuit';
import type { HdlModule } from '../core';
import { createDefaultRegistry, fromYosys } from '../library';
import { YOSYS_FIXTURES } from '../library/hdl/fixtures';
import { Editor } from './editor';
import { FakeClock } from './fake-clock';

const registry = createDefaultRegistry();

function moduleOf(name: string): HdlModule {
  const { module } = fromYosys(YOSYS_FIXTURES[name]);
  if (!module) throw new Error(`fixture ${name}`);
  return module;
}

/** A document with a Verilog module `dec` placed as A1 in the top circuit. */
function withModule(module?: HdlModule): CircuitDocument {
  const { document, id } = addCircuit(emptyDocument(), 'Dec', { verilog: true });
  const dec = document.circuits.find((c) => c.id === id)!;
  const withIr = module ? replaceCircuit(document, { ...dec, verilog: { module } }) : document;
  const main = withIr.circuits[0]!;
  return replaceCircuit(withIr, {
    ...main,
    components: [{ id: 'A1', type: 'sub/dec', x: 0, y: 0, rotation: 0, flip: false, props: {} }],
  });
}

describe('Editor: Verilog modules', () => {
  it('adds a module not compiled yet, and compiles it as one undo step', () => {
    const editor = new Editor(registry, emptyDocument());
    const { document, id } = addCircuit(editor.state.get().document, 'Module 2', { verilog: true });
    editor.editDocument('Add Verilog Module', document, { open: id });
    expect(editor.state.get().circuit.verilog).toEqual({});
    expect(editor.setModule(id, moduleOf('decoder'))).toBe(true);
    expect(editor.state.get().circuit.verilog?.module?.top).toBe('decoder');
    expect(editor.history.get().past.at(-1)?.label).toBe('Compile Module 2');
    // The same IR again (another object from the same JSON) is no change.
    expect(editor.setModule(id, moduleOf('decoder'))).toBe(false);
    editor.undo();
    expect(editor.state.get().circuit.verilog).toEqual({});
    expect(editor.setModule('main', moduleOf('decoder'))).toBe(false);
  });

  it('keeps parts and wires out of a module', () => {
    const editor = new Editor(registry, withModule(moduleOf('decoder')));
    editor.openCircuit('dec');
    const circuit = editor.state.get().circuit;
    const part = {
      id: 'U9',
      type: 'prim/not',
      x: 0,
      y: 0,
      rotation: 0,
      flip: false,
      props: {},
    } as const;
    expect(editor.edit('Paste', { ...circuit, components: [part] })).toBe(false);
    expect(editor.state.get().circuit.components).toEqual([]);
  });

  it('places a module: its instance has its pins and runs its part', () => {
    const editor = new Editor(registry, withModule(moduleOf('decoder')));
    const { design } = editor.state.get();
    expect(design.netlist.components).toEqual([{ id: 'A1/U1', type: 'hdl/dec' }]);
    expect(design.registry.get('hdl/dec')?.name).toBe('Dec');
  });

  it('restarts a running module when it is compiled again, and only then', () => {
    const clock = new FakeClock();
    const editor = new Editor(
      registry,
      withModule(moduleOf('counter')),
      {},
      { simulation: { clock } },
    );
    editor.simulation.run();
    clock.frame(16);
    const running = editor.simulation.simulator;
    expect(running).toBeDefined();
    // An edit elsewhere: the same simulator goes on.
    editor.editDocument('Rename', { ...editor.state.get().document });
    const { document } = editor.state.get();
    editor.editDocument(
      'Move',
      replaceCircuit(document, {
        ...document.circuits[0]!,
        components: [{ ...document.circuits[0]!.components[0]!, x: 4 }],
      }),
    );
    expect(editor.simulation.simulator).toBe(running);
    // Compiled again: the simulation continues in a new simulator, at the same time.
    const now = running!.now;
    editor.setModule('dec', { ...moduleOf('counter'), creator: 'again' });
    expect(editor.simulation.simulator).not.toBe(running);
    expect(editor.simulation.simulator?.now).toBe(now);
    expect(editor.simulation.state).toBe('running');
  });
});
