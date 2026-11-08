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
import { Level, ns, strong } from '../core';
import { testDriver } from '../core/testing';
import { createDefaultRegistry } from '../library';
import { Editor, type PointerInput } from './editor';
import { FakeClock } from './fake-clock';
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
  const label = (id: string, name: string, at: Point): ComponentInstance => ({
    id,
    type: 'net/label',
    x: at[0],
    y: at[1],
    rotation: 0,
    flip: false,
    props: { name },
  });

  /** `reg`: a 74HC74 latching D on CP's rising edge to Q; set, reset and the spare tied high. */
  function reg(): Circuit {
    const b = new CircuitBuilder(library, { id: 'reg', name: 'Register' });
    b.add('U1', '74xx/74hc74', { at: [10, 0] });
    b.add('PWR1', 'io/vcc', { at: [30, 0] });
    const pins = (names: string[]) => names.map((n) => b.pin(`U1.${n}`));
    const circuit = b.build();
    const high = pins(['1SD', '1RD', '2SD', '2RD', '2D', '2CP']).map((at, i) =>
      label(`NL${i}`, 'VCC', at),
    );
    const [d, cp, q] = pins(['1D', '1CP', '1Q']) as [Point, Point, Point];
    return {
      ...circuit,
      components: [
        ...circuit.components,
        ...high,
        port('P1', 'D', d[0], d[1]),
        port('P2', 'CP', cp[0], cp[1]),
        port('P3', 'Q', q[0], q[1], 'out'),
      ],
    };
  }

  /** Two registers: drivers D1, D2 on their D inputs, CK on both clocks. */
  function design(): CircuitDocument {
    const module = reg();
    const shell = {
      ...emptyCircuit(),
      components: [
        { id: 'A1', type: 'sub/reg', x: 30, y: 0, rotation: 0, flip: false, props: {} },
        { id: 'A2', type: 'sub/reg', x: 30, y: 20, rotation: 0, flip: false, props: {} },
      ] as ComponentInstance[],
    };
    const draft: CircuitDocument = { schemaVersion: SCHEMA_VERSION, circuits: [shell, module] };
    const top = new CircuitBuilder(new Editor(library, draft).registry);
    top.add('A1', 'sub/reg', { at: [30, 0] });
    top.add('A2', 'sub/reg', { at: [30, 20] });
    top.add('D1', 'test/driver', { at: [0, 0] });
    top.add('D2', 'test/driver', { at: [0, 10] });
    top.add('CK', 'test/driver', { at: [0, 20] });
    const joins: [string, string[]][] = [
      ['DA', ['D1.Y', 'A1.D']],
      ['DB', ['D2.Y', 'A2.D']],
      ['CLOCK', ['CK.Y', 'A1.CP', 'A2.CP']],
    ];
    for (const [name, pins] of joins) {
      for (const [i, pin] of pins.entries()) {
        top.add(`NL${name}${i}`, 'net/label', { at: top.pin(pin), props: { name } });
      }
    }
    return { schemaVersion: SCHEMA_VERSION, circuits: [top.build(), module] };
  }

  /** Latches 1 into A1 and 0 into A2, while running, then pauses. */
  function latched() {
    const clock = new FakeClock();
    clock.cost = 0.001;
    const editor = new Editor(library, design(), {}, { simulation: { clock } });
    const { simulation } = editor;
    const step = (until: number) => {
      simulation.runTo({ kind: 'time', until, label: 'test' });
      for (let i = 0; i < 1000 && simulation.state === 'running'; i++) clock.frame(16);
    };
    simulation.run();
    simulation.pause();
    const act = (id: string, level: Level) => simulation.action(id, strong(level));
    act('D1', Level.L1);
    act('D2', Level.L0);
    act('CK', Level.L0);
    step(ns(100));
    act('CK', Level.L1);
    step(ns(200));
    const q = (path: string) => simulation.simulator!.pinLevel(path, '1Q');
    return { editor, simulation, step, q };
  }

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

  it('draws only the top circuit with live levels and parts', () => {
    const { editor, simulation } = latched();
    const view = simulation.signalView()!;
    expect(view.part('D1')).toBeDefined();
    editor.openCircuit('reg');
    const inside = simulation.signalView()!;
    expect(inside.part('U1')).toBeUndefined();
    expect(editor.flatPart('U1')).toBeUndefined();
  });

  it('probes and watches signals inside instances by path', () => {
    const { editor, step } = latched();
    expect(editor.analyzer.addProbe({ ref: 'A1/U1.1Q' })).toBeUndefined();
    expect(editor.state.get().document.circuits[0]!.probes).toEqual([{ ref: 'A1/U1.1Q' }]);
    expect(editor.analyzer.channels.get()[0]!.problem).toBeUndefined();
    expect(editor.debug.addWatch('A2/Q')).toBeUndefined();
    step(ns(300));
    expect(editor.debug.watches.get().map((w) => [w.label, w.value])).toEqual([['A2/Q', '0']]);
    // Probing from the canvas works on the top only.
    editor.openCircuit('reg');
    expect(editor.analyzer.probes).toEqual([{ ref: 'A1/U1.1Q' }]);
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
