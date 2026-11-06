import { describe, expect, it } from 'vitest';
import { type Circuit, CircuitBuilder, compileCircuit, type Point } from '../circuit';
import { createDefaultRegistry } from '../library';
import { Editor, type PointerInput } from './editor';
import { selectionOf } from './selection';

// Gestures driven through `PointerInput`s, without a canvas. The default camera puts world (0, 0)
// at the canvas origin at 16 px per cell, so a grid point (x, y) is at (16x, 16y).
const registry = createDefaultRegistry();
const px = (p: Point): Point => [p[0] * 16, p[1] * 16];
const input = (p: Point, extra: Partial<PointerInput> = {}): PointerInput => ({
  at: px(p),
  button: 0,
  shift: false,
  ...extra,
});

function drag(editor: Editor, from: Point, ...to: Point[]): void {
  editor.pointerDown(input(from));
  for (const p of to) editor.pointerMove(input(p));
  editor.pointerUp(input(to.at(-1) ?? from));
}

function click(editor: Editor, at: Point): void {
  editor.pointerMove(input(at));
  editor.pointerDown(input(at));
  editor.pointerUp(input(at));
}

/** Pins grouped by net, for nets with more than one pin. */
function nets(c: Circuit): string[][] {
  return compileCircuit(c, registry)
    .nets.map((n) => n.pins.map((p) => `${p.component}.${p.pin}`).sort())
    .filter((pins) => pins.length > 1)
    .sort();
}

const connected = new CircuitBuilder(registry)
  .add('SW1', 'io/switch', { at: [0, 0] }) // Y (4, 1)
  .add('U1', 'prim/nand', { at: [10, 0] }) // A (10, 1), B (10, 3), body 11…15
  .connect('SW1.Y', 'U1.A')
  .build();

const apart = new CircuitBuilder(registry)
  .add('SW1', 'io/switch', { at: [0, 0] }) // Y (4, 1)
  .add('U1', 'prim/nand', { at: [10, 4] }) // A (10, 5)
  .build();

describe('moving by drag', () => {
  it('drags a part with its wire following, as one undo step', () => {
    const editor = new Editor(registry, connected);
    drag(editor, [13, 2], [13, 3], [13, 5]);
    const { circuit, selection } = editor.state.get();
    expect(circuit.components[1]).toMatchObject({ id: 'U1', x: 10, y: 3 });
    expect([...selection.parts]).toEqual(['U1']);
    expect(nets(circuit)).toEqual([['SW1.Y', 'U1.A']]);
    expect(editor.undoLabel).toBe('Move');
    editor.undo();
    expect(editor.state.get().circuit).toBe(connected);
  });

  it('shows the move while dragging and cancels it with Escape', () => {
    const editor = new Editor(registry, connected);
    editor.pointerDown(input([13, 2]));
    editor.pointerMove(input([16, 2]));
    expect(editor.mode.get()).toBe('moving');
    expect(editor.displayed.components[1]).toMatchObject({ x: 13 });
    expect(editor.state.get().circuit).toBe(connected);
    editor.escape();
    editor.pointerUp(input([16, 2]));
    expect(editor.state.get().circuit).toBe(connected);
    expect(editor.undoLabel).toBeUndefined();
    expect(editor.mode.get()).toBe('idle');
  });

  it('a click without a drag only selects', () => {
    const editor = new Editor(registry, connected);
    click(editor, [13, 2]);
    expect([...editor.state.get().selection.parts]).toEqual(['U1']);
    expect(editor.undoLabel).toBeUndefined();
  });

  it('nudges with coalesced undo', () => {
    const editor = new Editor(registry, connected);
    editor.setSelection(selectionOf(['U1']));
    editor.nudge(1, 0);
    editor.nudge(1, 0);
    expect(editor.state.get().circuit.components[1]).toMatchObject({ x: 12 });
    editor.undo();
    expect(editor.state.get().circuit).toBe(connected);
  });
});

describe('drawing wires', () => {
  it('Wire tool: click to start, click corners, a click on a pin finishes', () => {
    const editor = new Editor(registry, apart);
    editor.setTool('wire');
    click(editor, [4, 1]); // SW1.Y
    expect(editor.mode.get()).toBe('wiring');
    click(editor, [7, 1]);
    editor.pointerMove(input([10, 5]));
    // The preview shows the L to the pointer: vertical first, at a right angle to the last leg.
    expect(editor.displayed.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      '4,1-7,1',
      '7,1-7,5',
      '7,5-10,5',
    ]);
    click(editor, [10, 5]); // U1.A: finishes
    expect(editor.mode.get()).toBe('idle');
    const { circuit } = editor.state.get();
    expect(circuit.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      '4,1-7,1',
      '7,1-7,5',
      '7,5-10,5',
    ]);
    expect(nets(circuit)).toEqual([['SW1.Y', 'U1.A']]);
    expect(editor.undoLabel).toBe('Wire');
    expect(editor.tool.get()).toBe('wire'); // stays armed
  });

  it('Tab swaps the bend; Delete takes back a corner; double-click ends anywhere', () => {
    const editor = new Editor(registry, apart);
    editor.setTool('wire');
    click(editor, [20, 0]);
    editor.pointerMove(input([24, 3]));
    expect(editor.displayed.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      '20,0-24,0',
      '24,0-24,3',
    ]);
    editor.swapWirePosture();
    expect(editor.displayed.wires.map((w) => `${w.from}-${w.to}`)).toEqual([
      '20,0-20,3',
      '20,3-24,3',
    ]);
    click(editor, [24, 3]);
    click(editor, [24, 8]);
    editor.deleteSelection(); // back to the corner at (24, 3)
    editor.pointerMove(input([28, 3]));
    editor.pointerDown(input([28, 3]));
    editor.pointerDown(input([28, 3])); // the second press of a double-click
    const { circuit } = editor.state.get();
    expect(circuit.wires.map((w) => `${w.from}-${w.to}`)).toEqual(['20,0-20,3', '20,3-28,3']);
  });

  it('Escape cancels the wire, then leaves the Wire tool', () => {
    const editor = new Editor(registry, apart);
    editor.setTool('wire');
    click(editor, [20, 0]);
    editor.pointerMove(input([24, 0]));
    editor.escape();
    expect(editor.state.get().circuit).toBe(apart);
    expect(editor.tool.get()).toBe('wire');
    editor.escape();
    expect(editor.tool.get()).toBe('select');
  });

  it('Select tool: dragging from a pin tip draws one L-shaped wire', () => {
    const editor = new Editor(registry, apart);
    drag(editor, [4, 1], [6, 1], [10, 5]);
    const { circuit, selection } = editor.state.get();
    expect(nets(circuit)).toEqual([['SW1.Y', 'U1.A']]);
    expect(circuit.components).toBe(apart.components);
    expect(selection.parts.size).toBe(0);
    // A click on a pin tip selects its part instead.
    click(editor, [4, 1]);
    expect([...editor.state.get().selection.parts]).toEqual(['SW1']);
  });
});

describe('placing parts', () => {
  it('shows a ghost with the next designator and places copies until Escape', () => {
    const editor = new Editor(registry, connected);
    editor.placePart('prim/nand');
    editor.pointerMove(input([30, 10]));
    expect(editor.displayed.components.map((c) => c.id)).toEqual(['SW1', 'U1', 'U2']);
    expect(editor.state.get().circuit).toBe(connected);
    click(editor, [30, 10]);
    click(editor, [40, 10]);
    const { circuit, selection } = editor.state.get();
    // Centered on the click: a NAND's bounds are 6 × 4.
    expect(circuit.components.slice(2)).toMatchObject([
      { id: 'U2', type: 'prim/nand', x: 27, y: 8, props: { inputs: 2, delay: 1000 } },
      { id: 'U3', x: 37, y: 8 },
    ]);
    expect([...selection.parts]).toEqual(['U3']);
    expect(editor.undoLabel).toBe('Place NAND');
    editor.escape();
    expect(editor.tool.get()).toBe('select');
    expect(editor.displayed).toBe(editor.state.get().circuit);
  });

  it('R and F orient the part before it is placed; designators fill gaps', () => {
    const editor = new Editor(registry, connected);
    editor.placePart('io/led');
    editor.rotate(true);
    editor.flip('horizontal');
    click(editor, [30, 10]);
    expect(editor.state.get().circuit.components[2]).toMatchObject({
      id: 'D1',
      rotation: 270,
      flip: true,
    });
  });

  it('drops a part dragged from the panel', () => {
    const editor = new Editor(registry, connected);
    editor.dragPart('io/probe', px([20, 20]));
    expect(editor.displayed.components.map((c) => c.id)).toContain('TP1');
    editor.dropPart('io/probe', px([20, 20]));
    expect(editor.state.get().circuit.components.map((c) => c.id)).toEqual(['SW1', 'U1', 'TP1']);
    expect(editor.tool.get()).toBe('select');
  });
});

describe('copy, paste, duplicate', () => {
  it('pastes floating items that drop where clicked, renumbered', () => {
    const editor = new Editor(registry, connected);
    editor.setSelection(selectionOf(['U1']));
    const text = editor.copySelection()!;
    expect(text).toContain('"prim/nand"');
    expect(editor.pasteText(text)).toBe(true);
    expect(editor.mode.get()).toBe('floating');
    editor.pointerMove(input([33, 2]));
    expect(editor.displayed.components.map((c) => c.id)).toEqual(['SW1', 'U1', 'U2']);
    click(editor, [33, 2]);
    const { circuit, selection } = editor.state.get();
    expect(circuit.components[2]).toMatchObject({ id: 'U2', x: 30, y: 0 });
    expect([...selection.parts]).toEqual(['U2']);
    expect(editor.undoLabel).toBe('Paste');
    expect(editor.pasteText('not a document')).toBe(false);
  });

  it('duplicates the selection with its wires; Escape cancels a float', () => {
    const editor = new Editor(registry, connected);
    editor.selectAll();
    editor.duplicate();
    editor.escape();
    expect(editor.state.get().circuit).toBe(connected);
    editor.duplicate();
    editor.rotate(true); // turns the floating copy, not the selection
    click(editor, [8, 20]);
    const { circuit } = editor.state.get();
    expect(circuit.components.map((c) => c.id)).toEqual(['SW1', 'U1', 'SW2', 'U2']);
    expect(circuit.components.slice(2).map((c) => c.rotation)).toEqual([90, 90]);
    expect(nets(circuit)).toEqual([
      ['SW1.Y', 'U1.A'],
      ['SW2.Y', 'U2.A'],
    ]);
  });

  it('cuts', () => {
    const editor = new Editor(registry, connected);
    editor.setSelection(selectionOf(['U1'], ['w1']));
    expect(editor.cutSelection()).toContain('"U1"');
    expect(editor.state.get().circuit.components.map((c) => c.id)).toEqual(['SW1']);
    expect(editor.undoLabel).toBe('Cut');
  });
});

describe('requests to the UI', () => {
  it('right-click selects the item and asks for a context menu', () => {
    const editor = new Editor(registry, connected);
    editor.pointerDown(input([13, 2], { button: 2, client: [500, 300] }));
    expect([...editor.state.get().selection.parts]).toEqual(['U1']);
    expect(editor.requests.get()).toMatchObject({
      kind: 'context-menu',
      client: [500, 300],
      hit: { kind: 'part', id: 'U1' },
    });
    editor.pointerDown(input([40, 40], { button: 2 }));
    expect(editor.requests.get()).toMatchObject({ kind: 'context-menu', seq: 2 });
    expect(editor.requests.get()).not.toHaveProperty('hit');
  });

  it('double-click on a part asks to edit its properties', () => {
    const editor = new Editor(registry, connected);
    editor.doubleClick(input([2, 1]));
    expect(editor.requests.get()).toMatchObject({ kind: 'edit-properties' });
    expect([...editor.state.get().selection.parts]).toEqual(['SW1']);
  });
});
