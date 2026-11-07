import { describe, expect, it } from 'vitest';
import { addComponents, type Circuit, CircuitBuilder, type Probe } from '../circuit';
import { Level, ns, us } from '../core';
import { createDefaultRegistry } from '../library';
import { type AnalyzerChannel, formatValue, probeKey, probeLabel } from './analyzer';
import { Editor } from './editor';
import { FakeClock } from './fake-clock';
import { MAX_SPEED, SPEEDS } from './simulation';

const registry = createDefaultRegistry();

/** Clocks X1 at 1 MHz and X2 at 500 kHz: X1 rises at 0.5 µs, 1.5 µs, …; X2 at 1 µs, 3 µs, … */
function clocks(probes: readonly Probe[] = []): Circuit {
  const b = new CircuitBuilder(registry)
    .add('X1', 'io/clock', { at: [0, 0], props: { frequency: 1e6 } })
    .add('X2', 'io/clock', { at: [0, 10], props: { frequency: 5e5 } });
  for (const probe of probes) b.probe(probe);
  return b.build();
}

const COUNT: Probe = { name: 'CNT', members: ['X1.Y', 'X2.Y'] };

function setup(circuit = clocks([{ ref: 'X1.Y' }, { ref: 'X2.Y' }, COUNT])) {
  const clock = new FakeClock();
  const editor = new Editor(registry, circuit, {}, { simulation: { clock } });
  const { analyzer, simulation } = editor;
  analyzer.setWidth(1000);
  /** Runs at 1 µs of simulated time per wall second: 16 ns a frame. */
  simulation.setSpeed(SPEEDS.find((s) => s.id === '1us')!);
  return { clock, editor, analyzer, simulation };
}

const channel = (editor: Editor, label: string): AnalyzerChannel =>
  editor.analyzer.channels.get().find((c) => c.label === label)!;

/** Runs the simulation to `t` (frames of 16 ns at 1 µs/s, the last one shorter). */
function runTo(setupResult: ReturnType<typeof setup>, t: number) {
  const { clock, simulation } = setupResult;
  if (simulation.state === 'stopped') simulation.run();
  for (let frames = 0; simulation.simulator!.now < t; frames++) {
    if (simulation.state !== 'running' || frames > 10_000) {
      throw new Error(`runTo: ${simulation.state} at ${simulation.simulator!.now} ps`);
    }
    const left = t - simulation.simulator!.now;
    clock.frame(Math.min(16, left / 1000));
  }
}

describe('Analyzer: channels', () => {
  it('turns the probes into channels: signals, groups, and what doesn’t resolve', () => {
    const { editor } = setup(
      clocks([{ ref: 'X1.Y', name: 'clk' }, COUNT, { ref: 'D[0..7]' }, { ref: 'X1' }]),
    );
    const channels = editor.analyzer.channels.get();
    expect(channels.map((c) => [c.label, c.vector, c.bits.length, c.problem])).toEqual([
      ['clk', false, 1, undefined],
      ['CNT', true, 2, undefined],
      ['D[0..7]', true, 8, 'no net of D[0..7] is named on this circuit'],
      ['X1', false, 1, 'X1 is a part: probe one of its pins'],
    ]);
    expect(channels[1]!.reference).toBe('X1.Y X2.Y');
    expect(channels[1]!.radix).toBe('hex');
    expect(channels[1]!.bitLabels).toEqual(['X1.Y', 'X2.Y']);
    // A signal and a group member on the same pin share one recorder channel.
    expect(channels[1]!.bits[0]).toBe(channels[0]!.bits[0]);
    expect(probeKey(COUNT)).toBe('CNT{X1.Y,X2.Y}');
    expect(probeLabel({ ref: 'U1.Y' })).toBe('U1.Y');
  });
});

describe('Analyzer: editing probes', () => {
  it('adds, toggles, renames, reorders and removes probes as undoable edits', () => {
    const { editor } = setup(clocks());
    const { analyzer } = editor;
    expect(analyzer.addProbe({ ref: 'X1.Y' })).toBeUndefined();
    expect(editor.undoLabel).toBe('Add X1.Y to Waveforms');
    expect(analyzer.addProbe({ ref: 'X1.Y' })).toBe('X1.Y is probed already.');
    expect(analyzer.addProbe({ ref: 'X9.Y' })).toBe('no part X9');
    expect(analyzer.toggleProbe('X2.Y')).toBe('added');
    analyzer.updateProbe(1, { name: 'slow', radix: 'bin' });
    expect(analyzer.probes[1]).toEqual({ ref: 'X2.Y', name: 'slow', radix: 'bin' });
    analyzer.updateProbe(1, { name: '' });
    expect(analyzer.probes[1]).toEqual({ ref: 'X2.Y', radix: 'bin' });
    analyzer.moveProbe(1, 0);
    expect(analyzer.probes.map(probeLabel)).toEqual(['X2.Y', 'X1.Y']);
    expect(analyzer.recorder.channels).toHaveLength(2);
    expect(analyzer.toggleProbe('X2.Y')).toBe('removed');
    expect(analyzer.probes).toEqual([{ ref: 'X1.Y' }]);
    expect(analyzer.recorder.channels).toHaveLength(1); // its record is gone
    editor.undo();
    expect(analyzer.probes.map(probeLabel)).toEqual(['X2.Y', 'X1.Y']);
    expect(editor.undoLabel).toBe('Reorder Waveforms');
  });

  it('groups single signals into one value and splits a group again', () => {
    const { editor } = setup(clocks([{ ref: 'X1.Y' }, COUNT, { ref: 'X2.Y' }]));
    const { analyzer } = editor;
    expect(analyzer.groupProbes([0, 1], 'G')).toBe('Only single signals can be grouped.');
    expect(analyzer.groupProbes([0], 'G')).toBe('Pick at least two signals to group.');
    expect(analyzer.groupProbes([0, 2], ' ')).toBe('A group needs a name.');
    expect(analyzer.groupProbes([2, 0], 'PAIR')).toBeUndefined();
    expect(analyzer.probes).toEqual([{ name: 'PAIR', members: ['X2.Y', 'X1.Y'] }, COUNT]);
    analyzer.ungroup(1);
    expect(analyzer.probes).toEqual([
      { name: 'PAIR', members: ['X2.Y', 'X1.Y'] },
      { ref: 'X1.Y' },
      { ref: 'X2.Y' },
    ]);
  });

  it('keeps a running simulator when probes change', () => {
    const s = setup(clocks());
    runTo(s, ns(200));
    const sim = s.simulation.simulator;
    s.analyzer.addProbe({ ref: 'X1.Y' });
    expect(s.simulation.simulator).toBe(sim);
  });
});

describe('Analyzer: recording', () => {
  it('records the probes from power-on while running', () => {
    const s = setup();
    runTo(s, us(2.2));
    const { analyzer, editor } = s;
    const x1 = channel(editor, 'X1.Y');
    expect(analyzer.valueAt(x1, ns(400))).toBe('0');
    expect(analyzer.valueAt(x1, ns(600))).toBe('1');
    const count = channel(editor, 'CNT');
    // X1 is bit 0, X2 bit 1: 0.5 µs → 1, 1 µs → 2, 1.5 µs → 3, 2 µs → 0.
    expect([250, 750, 1250, 1750, 2100].map((t) => analyzer.valueAt(count, ns(t)))).toEqual([
      '0x0',
      '0x1',
      '0x2',
      '0x3',
      '0x0',
    ]);
    expect(analyzer.recorder.nextChange(x1.bits[0]!, 0)).toBe(ns(500));
    expect(analyzer.end).toBe(us(2.2));
  });

  it('starts a probe added while running at that instant', () => {
    const s = setup(clocks());
    runTo(s, ns(700));
    s.analyzer.addProbe({ ref: 'X1.Y' });
    runTo(s, ns(1200));
    const x1 = channel(s.editor, 'X1.Y');
    expect(s.analyzer.valueAt(x1, ns(600))).toBe('');
    expect(s.analyzer.valueAt(x1, ns(700))).toBe('1');
    expect(s.analyzer.valueAt(x1, ns(1100))).toBe('0');
  });

  it('goes on through structural edits and renames; Reset starts over', () => {
    const s = setup();
    runTo(s, ns(1200));
    const sim = s.simulation.simulator;
    const { circuit } = s.editor.state.get();
    s.editor.edit(
      'Add LED',
      addComponents(circuit, [
        { id: 'D9', type: 'io/led', x: 40, y: 0, rotation: 0, flip: false, props: {} },
      ]),
    );
    expect(s.simulation.simulator).not.toBe(sim); // a carry-over
    expect(s.editor.renamePart('X1', 'X5')).toBeUndefined();
    expect(s.analyzer.probes[0]).toEqual({ ref: 'X5.Y' });
    runTo(s, ns(1700));
    const x5 = channel(s.editor, 'X5.Y');
    expect(s.analyzer.valueAt(x5, ns(600))).toBe('1'); // from before the edits
    expect(s.analyzer.valueAt(x5, ns(1600))).toBe('1');
    expect(s.analyzer.recorder.nextChange(x5.bits[0]!, 0)).toBe(ns(500));

    s.simulation.reset();
    s.clock.frame(16);
    expect(s.analyzer.valueAt(x5, ns(600))).toBe('');
    expect(s.analyzer.valueAt(x5, ns(10))).toBe('0');
  });

  it('keeps the record after Stop until the next power-on, and forgets it for another file', () => {
    const s = setup();
    runTo(s, ns(800));
    s.simulation.stop();
    const x1 = channel(s.editor, 'X1.Y');
    expect(s.analyzer.end).toBe(ns(800));
    expect(s.analyzer.valueAt(x1, ns(600))).toBe('1');
    s.simulation.run();
    expect(s.analyzer.valueAt(x1, ns(600))).toBe('');
    s.clock.frame(16);
    s.simulation.stop();
    s.editor.setCircuit(clocks([{ ref: 'X1.Y' }]));
    expect(s.analyzer.valueAt(channel(s.editor, 'X1.Y'), ns(10))).toBe('');
  });
});

describe('formatValue', () => {
  const { L0, L1, X, Z } = Level;
  it('writes values in hex, decimal, binary and ASCII, bit 0 first in', () => {
    expect(formatValue([L1, L1, L1, L1, L1, L1, L0, L0], 'hex')).toBe('0x3F');
    expect(formatValue([L1, L1, L1, L1, L1, L1, L0, L0], 'dec')).toBe('63');
    expect(formatValue([L1, L0, L1], 'bin')).toBe('101');
    expect(formatValue([L1, L0, L0, L0, L0, L0, L1, L0], 'ascii')).toBe('A');
    expect(formatValue([L1, L0, L0, L0, L0, L0, L0, L0], 'ascii')).toBe('.');
    // 0x4241 in 15 bits: the high byte is 0x42.
    expect(formatValue([L1, L0, L0, L0, L0, L0, L1, L0, L0, L1, L0, L0, L0, L0, L1], 'ascii')).toBe(
      'BA',
    );
  });

  it('marks what isn’t known', () => {
    expect(formatValue([L1, X, L0, L0, Z, Z, Z, Z], 'hex')).toBe('0xZX');
    expect(formatValue([L1, X], 'dec')).toBe('X');
    expect(formatValue([L1, undefined, Z], 'bin')).toBe('ZX1');
    expect(formatValue([L1, X, L0, L0, L0, L0, L1, L0], 'ascii')).toBe('X');
    const wide = Array.from({ length: 64 }, () => L1);
    expect(formatValue(wide, 'dec')).toBe('18446744073709551615');
  });
});

describe('Analyzer: the view', () => {
  it('fits the whole record while it grows, until zoomed; then keeps now at the right edge', () => {
    const s = setup();
    runTo(s, us(1));
    // Scales are picoseconds a pixel: 1 µs over 1000 pixels is 1000.
    expect(s.analyzer.view.get()).toMatchObject({ start: 0, scale: 1000, mode: 'fit' });
    s.analyzer.zoom(2);
    expect(s.analyzer.view.get()).toMatchObject({ mode: 'follow', scale: 500, start: ns(500) });
    runTo(s, us(2));
    expect(s.analyzer.view.get()).toMatchObject({ start: us(1.5) });
    s.analyzer.pan(-100);
    expect(s.analyzer.view.get()).toMatchObject({ mode: 'free', start: ns(1450) });
    runTo(s, us(2.5));
    expect(s.analyzer.view.get().start).toBe(ns(1450));
    s.analyzer.followNow();
    expect(s.analyzer.view.get()).toMatchObject({ mode: 'follow', start: us(2) });
    s.analyzer.zoomToFit();
    expect(s.analyzer.view.get()).toMatchObject({ mode: 'fit', start: 0, scale: 2500 });
    expect(s.analyzer.timeAt(100)).toBe(ns(250));
    expect(s.analyzer.xOf(ns(250))).toBe(100);
  });

  it('zooms about a point while free, within its limits', () => {
    const s = setup();
    runTo(s, us(1));
    s.simulation.pause();
    s.analyzer.pan(0); // free
    s.analyzer.zoom(4, 200); // 200 px = 200 ns stays put
    expect(s.analyzer.view.get()).toMatchObject({ scale: 250, start: ns(150), mode: 'free' });
    s.analyzer.zoom(1e9);
    expect(s.analyzer.view.get().scale).toBe(0.02);
    s.analyzer.zoom(1e-20);
    expect(s.analyzer.view.get().scale).toBe(1e10);

    const stopped = setup();
    stopped.analyzer.zoom(2);
    expect(stopped.analyzer.view.get()).toMatchObject({ mode: 'free', scale: 500 });
  });

  it('places cursors, snaps them to edges and zooms to them', () => {
    const s = setup();
    runTo(s, us(2.2));
    s.simulation.pause();
    const { analyzer } = s;
    const x1 = channel(s.editor, 'X1.Y');
    expect(analyzer.snap(ns(503.4), x1)).toBe(ns(500)); // within 6 px at 2.2 ns a pixel
    expect(analyzer.snap(ns(520), x1)).toBe(ns(520));
    expect(analyzer.snap(ns(520.4), undefined)).toBe(ns(520.4));
    analyzer.setCursor('A', ns(500));
    analyzer.setCursor('B', ns(1500));
    analyzer.zoomToCursors();
    expect(analyzer.view.get()).toMatchObject({ start: ns(400), scale: 1200, mode: 'free' });
    analyzer.setCursor('B', undefined);
    expect(analyzer.view.get().cursorB).toBeUndefined();
    expect(analyzer.view.get().cursorA).toBe(ns(500));
  });

  it('steps cursor A from edge to edge of the selected channel', () => {
    const s = setup();
    runTo(s, us(2.2));
    s.simulation.pause();
    const { analyzer } = s;
    expect(analyzer.edge(1)).toBe(false); // nothing selected
    analyzer.select(1); // X2: 1 µs, 2 µs
    expect(analyzer.edge(1)).toBe(true);
    expect(analyzer.view.get().cursorA).toBe(us(1));
    analyzer.edge(1);
    expect(analyzer.view.get().cursorA).toBe(us(2));
    expect(analyzer.edge(1)).toBe(false);
    analyzer.edge(-1);
    expect(analyzer.view.get().cursorA).toBe(us(1));
    analyzer.edge(1, 'B');
    analyzer.edge(1, 'B');
    expect(analyzer.view.get()).toMatchObject({ cursorA: us(1), cursorB: us(2) });
    // An edge outside the window brings it into view.
    analyzer.scrollTo(us(1.8));
    analyzer.edge(1);
    expect(analyzer.view.get().start).toBe(us(1.8)); // 2 µs is in view
    analyzer.edge(-1);
    expect(analyzer.view.get().start).toBe(0);
  });
});

describe('Analyzer: trigger', () => {
  it('pauses the run the post-trigger time after the condition, with the trigger in view', () => {
    const s = setup();
    s.analyzer.zoom(1); // leave fit: the window is 1 µs (1000 pixels of 1 ns)
    const terms = [
      { probe: 'X1.Y', kind: 'rise' as const },
      { probe: 'X2.Y', kind: 'level' as const, level: Level.L1 },
    ];
    expect(s.analyzer.arm({ terms, position: 0.25 })).toBeUndefined();
    expect(s.analyzer.trigger.get()).toMatchObject({
      status: 'armed',
      condition: { window: us(1) },
    });
    s.simulation.setSpeed(MAX_SPEED);
    s.clock.cost = 1; // Max runs until the frame budget: let the fake wall clock move
    s.simulation.run();
    expect(s.analyzer.view.get().mode).toBe('follow'); // a new run follows at the chosen scale
    s.clock.frames(3);
    // X1 rises at 0.5 µs while X2 is low, at 1.5 µs while X2 is high.
    expect(s.analyzer.trigger.get()).toMatchObject({ status: 'triggered', time: us(1.5) });
    expect(s.simulation.state).toBe('paused');
    expect(s.simulation.simulator!.now).toBe(us(1.5) + ns(750));
    expect(s.analyzer.view.get()).toMatchObject({
      start: us(1.5) - ns(250),
      scale: 1000,
      mode: 'free',
    });
  });

  it('captures the window the condition asks for', () => {
    const s = setup();
    s.analyzer.arm({ terms: [{ probe: 'X2.Y', kind: 'rise' }], window: us(4), position: 0.5 });
    runTo(s, us(1) + ns(16));
    expect(s.simulation.pausesAt).toBe(us(3));
    expect(s.analyzer.view.get()).toMatchObject({ start: 0, scale: 4000 });
  });

  it('refuses conditions it can’t watch', () => {
    const { analyzer } = setup();
    expect(analyzer.arm({ terms: [] })).toBe('the trigger has no condition');
    expect(analyzer.arm({ terms: [{ probe: 'Q', kind: 'rise' }] })).toBe('Q is not probed');
    expect(analyzer.arm({ terms: [{ probe: 'CNT{X1.Y,X2.Y}', kind: 'rise' }] })).toBe(
      'CNT is a value: an edge or level needs one signal',
    );
    expect(analyzer.arm({ terms: [{ probe: 'CNT{X1.Y,X2.Y}', kind: 'equal', value: '7' }] })).toBe(
      "7 doesn't fit in 2 bits",
    );
    expect(analyzer.trigger.get().status).toBe('off');
  });

  it('triggers on a group’s value; disarm cancels the pause it asked for', () => {
    const s = setup();
    s.analyzer.zoom(1);
    s.analyzer.arm({ terms: [{ probe: 'CNT{X1.Y,X2.Y}', kind: 'equal', value: '3' }] });
    runTo(s, us(1.5) + ns(16));
    expect(s.analyzer.trigger.get()).toMatchObject({ status: 'triggered', time: us(1.5) });
    expect(s.simulation.pausesAt).toBe(us(1.5) + ns(900));
    s.analyzer.disarm();
    expect(s.simulation.pausesAt).toBeUndefined();
    s.clock.frames(80);
    expect(s.simulation.state).toBe('running');
  });

  it('stays armed across Reset, watching the new run from t = 0', () => {
    const s = setup();
    s.analyzer.zoom(1);
    s.analyzer.arm({ terms: [{ probe: 'X2.Y', kind: 'rise' }] });
    runTo(s, ns(500));
    s.simulation.reset();
    s.simulation.setSpeed(MAX_SPEED);
    s.clock.cost = 1;
    s.clock.frames(2);
    expect(s.analyzer.trigger.get()).toMatchObject({ status: 'triggered', time: us(1) });
    expect(s.simulation.simulator!.now).toBe(us(1) + ns(900));
  });
});
