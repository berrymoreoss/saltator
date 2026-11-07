import { describe, expect, it } from 'vitest';
import { CircuitBuilder, type Point } from '../circuit';
import { createDefaultRegistry } from '../library';
import { Editor, type PointerInput } from './editor';
import { FakeClock } from './fake-clock';
import { probeSpotAt } from './probe-target';

// The default camera puts world (0, 0) at the canvas origin at 16 px per cell.
const registry = createDefaultRegistry();
const px = (p: Point): Point => [p[0] * 16, p[1] * 16];
const input = (p: Point, extra: Partial<PointerInput> = {}): PointerInput => ({
  at: px(p),
  button: 0,
  shift: false,
  ...extra,
});

/** SW1.Y (4, 1) ─w─ U1.A (10, 1); U1's body 11…15; U1.Y (16, 2) to a net label CLK at (20, 2). */
const circuit = new CircuitBuilder(registry)
  .add('SW1', 'io/switch', { at: [0, 0] })
  .add('U1', 'prim/nand', { at: [10, 0] })
  .add('NL1', 'net/label', { at: [20, 2], props: { name: 'CLK' } })
  .add('U2', 'prim/not', { at: [30, 10] })
  .connect('SW1.Y', 'U1.A')
  .connect('U1.Y', 'NL1.N')
  .build();

describe('probeSpotAt', () => {
  const editor = new Editor(registry, circuit);
  const spot = (p: Point) => probeSpotAt(editor.scene, registry, p, 0.5);
  const wiresOf = (net: string) => editor.scene.wires.filter((w) => w.net === net).map((w) => w.id);

  it('probes a wire by its net: its name, else the pin driving it', () => {
    const net = editor.scene.compiled.wireNets.get(editor.scene.wires[0]!.id)!;
    expect(spot([7, 1])).toEqual({ ref: 'SW1.Y', wires: wiresOf(net) });
    expect(spot([18, 2])).toMatchObject({ ref: 'CLK' });
  });

  it('probes a pin by its reference, and a net label by its name', () => {
    expect(spot([10.6, 1])).toMatchObject({ ref: 'U1.A', pin: [10, 1] });
    expect(spot([10, 1])).toMatchObject({ ref: 'U1.A' }); // the pin wins where the wire ends on it
    expect(spot([20.5, 2])).toMatchObject({ ref: 'CLK' }); // the label's flag
  });

  it('finds nothing on a part’s body or on empty canvas', () => {
    expect(spot([13, 2])).toBeUndefined();
    expect(spot([40, 40])).toBeUndefined();
  });
});

describe('the Probe tool', () => {
  const setup = () => {
    const clock = new FakeClock();
    const editor = new Editor(registry, circuit, {}, { simulation: { clock } });
    editor.setTool('probe');
    return { clock, editor };
  };
  const click = (editor: Editor, p: Point) => {
    editor.pointerMove(input(p));
    editor.pointerDown(input(p));
    editor.pointerUp(input(p));
  };

  it('adds what it clicks to the waveforms and removes it on a second click', () => {
    const { editor } = setup();
    click(editor, [7, 1]);
    expect(editor.analyzer.probes).toEqual([{ ref: 'SW1.Y' }]);
    expect(editor.requests.get()).toMatchObject({ kind: 'probed', ref: 'SW1.Y' });
    click(editor, [10.6, 1]);
    click(editor, [7, 1]);
    expect(editor.analyzer.probes).toEqual([{ ref: 'U1.A' }]);
    expect(editor.state.get().selection.parts.size).toBe(0); // the selection is left alone
  });

  it('pans on a drag instead, and says why where it can’t probe', () => {
    const { editor } = setup();
    const before = editor.view.get().camera;
    editor.pointerDown(input([7, 1]));
    editor.pointerMove(input([9, 3]));
    editor.pointerUp(input([9, 3]));
    expect(editor.analyzer.probes).toEqual([]);
    expect(editor.view.get().camera).not.toEqual(before);
  });

  it('stays armed when the simulation runs; Escape leaves it', () => {
    const { editor } = setup();
    editor.simulation.run();
    expect(editor.tool.get()).toBe('probe');
    click(editor, [7, 1]);
    expect(editor.analyzer.probes).toHaveLength(1);
    expect(editor.simulation.state).toBe('running');
    // A click on a switch probes nothing and doesn't flip it.
    const before = JSON.stringify(editor.simulation.simulator!.stateOf('SW1'));
    click(editor, [2, 1]);
    expect(JSON.stringify(editor.simulation.simulator!.stateOf('SW1'))).toBe(before);
    editor.escape();
    expect(editor.tool.get()).toBe('interact');
    editor.setTool('probe');
    editor.simulation.stop();
    editor.escape();
    expect(editor.tool.get()).toBe('select');
  });

  it('remembers what a right click pointed at, for the context menu', () => {
    const { editor } = setup();
    editor.setTool('select');
    editor.pointerDown(input([7, 1], { button: 2 }));
    expect(editor.contextProbe?.ref).toBe('SW1.Y');
    editor.toggleProbe(editor.contextProbe!.ref);
    expect(editor.analyzer.probes).toEqual([{ ref: 'SW1.Y' }]);
    editor.pointerDown(input([40, 40], { button: 2 }));
    expect(editor.contextProbe).toBeUndefined();
  });
});
