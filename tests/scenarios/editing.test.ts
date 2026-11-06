import { describe, expect, it } from 'vitest';
import { helloLed } from '../../src/app/examples';
import { type Circuit, compileCircuit, type Point } from '../../src/circuit';
import { Editor, type PointerInput } from '../../src/editor';
import { createDefaultRegistry } from '../../src/library';

// The M1 "Hello, LED" circuit drawn from an empty document with the editor's gestures only —
// place, wire, label, set a prop — must compile to the same nets as the example built in code.
const registry = createDefaultRegistry();

/** With the default camera a grid point (x, y) is at canvas pixel (16x, 16y). */
const input = (p: Point): PointerInput => ({ at: [p[0] * 16, p[1] * 16], button: 0, shift: false });

function click(editor: Editor, p: Point): void {
  editor.pointerMove(input(p));
  editor.pointerDown(input(p));
  editor.pointerUp(input(p));
}

function pin(editor: Editor, spec: string): Point {
  const [id, name] = spec.split('.');
  const found = editor.scene.partById.get(id!)?.pins.find((p) => p.name === name);
  if (!found) throw new Error(`no pin ${spec}`);
  return found.at;
}

/** Wire tool: click a pin, optional corners, then the other pin (which finishes the wire). */
function wire(editor: Editor, from: string, ...rest: (Point | string)[]): void {
  editor.setTool('wire');
  click(editor, pin(editor, from));
  for (const p of rest) click(editor, typeof p === 'string' ? pin(editor, p) : p);
  expect(editor.mode.get(), `wire ${from} → ${rest.at(-1)} finished`).toBe('idle');
}

function place(editor: Editor, type: string, at: Point): string {
  editor.placePart(type);
  click(editor, at);
  editor.escape();
  return [...editor.state.get().selection.parts][0]!;
}

/** Pins grouped by net (nets with more than one pin), sorted. */
function nets(c: Circuit): string[][] {
  return compileCircuit(c, registry)
    .nets.map((n) => n.pins.map((p) => `${p.component}.${p.pin}`).sort())
    .filter((pins) => pins.length > 1)
    .sort();
}

describe('editing scenario: Hello, LED by hand', () => {
  it('compiles to the same nets as the built-in example, with no design issues', () => {
    const editor = new Editor(registry);
    expect(place(editor, 'io/switch', [0, 0])).toBe('SW1');
    expect(place(editor, 'prim/nand', [12, 1])).toBe('U1');
    expect(place(editor, 'io/vcc', [6, -6])).toBe('PWR1');
    expect(place(editor, 'io/led', [24, 1])).toBe('D1');
    expect(place(editor, 'io/gnd', [30, 4])).toBe('PWR2');
    expect(place(editor, 'io/clock', [0, 14])).toBe('X1');
    expect(place(editor, 'io/led', [24, 14])).toBe('D2');
    expect(place(editor, 'io/gnd', [30, 17])).toBe('PWR3');

    wire(editor, 'SW1.Y', 'U1.A');
    wire(editor, 'PWR1.Y', 'U1.B');
    wire(editor, 'U1.Y', 'D1.A');
    wire(editor, 'D1.K', 'PWR2.Y');
    wire(editor, 'X1.Y', 'D2.A');
    wire(editor, 'D2.K', 'PWR3.Y');
    editor.escape();

    editor.setPartLabel('SW1', 'IN');
    editor.setPartLabel('D1', 'OUT');
    editor.setPartLabel('X1', '1 Hz');
    editor.setPartLabel('D2', 'BLINK');
    expect(editor.setPartProp('D1', 'color', 'green')).toBeUndefined();
    expect(editor.setPartProp('D1', 'color', 'mauve')).toMatch(/prop "color" must be one of/);

    const drawn = editor.state.get().circuit;
    const example = helloLed(registry);
    expect(nets(drawn)).toEqual(nets(example));
    expect(compileCircuit(drawn, registry).issues).toEqual([]);
    expect(drawn.components.map((c) => [c.id, c.type, c.label, c.props.color])).toEqual(
      example.components.map((c) => [c.id, c.type, c.label, c.props.color]),
    );

    // Every step is undoable, back to the empty document.
    let steps = 0;
    while (editor.undoLabel !== undefined) {
      editor.undo();
      steps++;
    }
    expect(steps).toBe(8 + 6 + 5);
    expect(editor.state.get().circuit.components).toEqual([]);
  });
});
