import { describe, expect, it } from 'vitest';
import { addComponents, addWires, type Circuit, CircuitBuilder, updateComponent } from '../circuit';
import { type Level, levelChar, ms, ns } from '../core';
import { createDefaultRegistry } from '../library';
import { Editor } from './editor';
import { FakeClock } from './fake-clock';
import { selectionOf } from './selection';
import { ALL_SPEEDS, formatRate, MAX_SPEED, REAL_TIME, SPEEDS } from './simulation';
import { UNKNOWN_LIGHT } from './symbols';
import { SignalStyle } from './theme';

const registry = createDefaultRegistry();

/** SW1 → U1 (NAND, B tied high) → D1; X1 (clock) → D2; a 1 kHz clock by default. */
function hello(frequency = 1000): Circuit {
  return new CircuitBuilder(registry)
    .add('SW1', 'io/switch', { at: [0, 0] })
    .add('U1', 'prim/nand', { at: [10, 0] })
    .add('PWR1', 'io/vcc', { at: [7, -4] })
    .add('D1', 'io/led', { at: [20, 0] })
    .add('PWR2', 'io/gnd', { at: [26, 1] })
    .connect('SW1.Y', 'U1.A')
    .connect('PWR1.Y', 'U1.B', [8, 3])
    .connect('U1.Y', 'D1.A', [18, 2], [18, 1])
    .connect('D1.K', 'PWR2.Y')
    .add('X1', 'io/clock', { at: [0, 12], props: { frequency } })
    .add('D2', 'io/led', { at: [20, 12] })
    .add('PWR3', 'io/gnd', { at: [26, 13] })
    .connect('X1.Y', 'D2.A')
    .connect('D2.K', 'PWR3.Y')
    .build();
}

function setup(circuit = hello(), frameBudget?: number) {
  const clock = new FakeClock();
  const editor = new Editor(
    registry,
    circuit,
    {},
    {
      simulation: { clock, ...(frameBudget !== undefined && { frameBudget }) },
    },
  );
  return { clock, editor, simulation: editor.simulation };
}

const pin = (editor: Editor, component: string, name: string) =>
  levelChar(editor.simulation.simulator!.pinLevel(component, name));

describe('Simulation: run control', () => {
  it('starts stopped, powers on at t = 0 with Run and follows the wall clock', () => {
    const { clock, simulation } = setup();
    expect(simulation.state).toBe('stopped');
    expect(simulation.simulator).toBeUndefined();
    simulation.run();
    expect(simulation.state).toBe('running');
    expect(simulation.simulator!.now).toBe(0);
    clock.frame(16);
    expect(simulation.simulator!.now).toBe(ms(16));
    clock.frames(10, 20);
    expect(simulation.simulator!.now).toBe(ms(216));
    expect(simulation.status.get()).toMatchObject({ state: 'running', time: ms(216) });
    expect(simulation.status.get().actual).toBeCloseTo(1e12, -6); // real time
    expect(simulation.status.get().lagging).toBe(false);
  });

  it('runs at the chosen speed and never jumps more than 100 ms of wall time', () => {
    const { clock, simulation } = setup();
    simulation.setSpeed(SPEEDS.find((s) => s.id === '1us')!);
    simulation.run();
    clock.frame(50);
    expect(simulation.simulator!.now).toBe(ns(50));
    clock.frame(5000); // a background tab
    expect(simulation.simulator!.now).toBe(ns(150));
  });

  it('pause stops time; run goes on; stop discards the simulator; reset powers on again', () => {
    const { clock, simulation } = setup();
    simulation.run();
    clock.frame(30);
    simulation.pause();
    expect(simulation.state).toBe('paused');
    expect(clock.pending).toBe(0);
    clock.frame(30);
    expect(simulation.simulator!.now).toBe(ms(30));
    simulation.toggle();
    clock.frame(10);
    expect(simulation.simulator!.now).toBe(ms(40));
    simulation.reset();
    expect(simulation.state).toBe('running');
    expect(simulation.simulator!.now).toBe(0);
    simulation.stop();
    expect(simulation.state).toBe('stopped');
    expect(simulation.simulator).toBeUndefined();
    expect(simulation.signals.wires.size).toBe(0);
    expect(clock.pending).toBe(0);
    simulation.reset(); // nothing to reset
    expect(simulation.state).toBe('stopped');
  });

  it('steps to the next moment something happens', () => {
    const { simulation } = setup(hello(1e6)); // edges every 500 ns
    expect(simulation.step()).toBe(true); // powers on, runs t = 0
    expect(simulation.state).toBe('paused');
    expect(simulation.simulator!.now).toBe(0);
    simulation.step(); // the NAND's output settles after its delay
    expect(simulation.simulator!.now).toBe(ns(1));
    simulation.step();
    expect(simulation.simulator!.now).toBe(ns(500)); // the clock's first rising edge
    expect(simulation.status.get().time).toBe(ns(500));
  });

  it('a step with nothing pending does nothing', () => {
    const circuit = new CircuitBuilder(registry).add('SW1', 'io/switch', { at: [0, 0] }).build();
    const { simulation } = setup(circuit);
    simulation.step();
    expect(simulation.step()).toBe(false);
    expect(simulation.simulator!.now).toBe(0);
  });

  it('measures the actual speed when the kernel cannot keep up', () => {
    // A 100 MHz clock at real time: 3.2M edges per 16 ms frame; each kernel call "costs" 5 ms.
    const { clock, simulation } = setup(hello(1e8), 8);
    simulation.run();
    clock.cost = 5;
    clock.frames(8); // the status refreshes every 100 ms of wall time
    const status = simulation.status.get();
    const now = simulation.simulator!.now;
    expect(now).toBeGreaterThan(0);
    expect(now).toBeLessThan(ms(8 * 16));
    expect(status.lagging).toBe(true);
    expect(status.actual).toBeLessThan(1e12);
    expect(formatRate(1e9)).toBe('1 ms/s');
  });

  it('Max runs as far as the frame budget allows, and stops when nothing is pending', () => {
    const { clock, simulation } = setup(hello(1e6));
    simulation.setSpeed(MAX_SPEED);
    simulation.run();
    clock.cost = 5;
    clock.frame(16);
    expect(simulation.simulator!.now).toBeGreaterThan(ms(1));

    const idle = setup(
      new CircuitBuilder(registry).add('SW1', 'io/switch', { at: [0, 0] }).build(),
    );
    idle.simulation.setSpeed(MAX_SPEED);
    idle.simulation.run();
    idle.clock.frame(16);
    expect(idle.simulation.simulator!.now).toBe(0);
  });

  it('lists the speeds slowest first, real time and Max last', () => {
    expect(ALL_SPEEDS.map((s) => s.label)).toEqual([
      '1 ns/s',
      '10 ns/s',
      '100 ns/s',
      '1 µs/s',
      '10 µs/s',
      '100 µs/s',
      '1 ms/s',
      '10 ms/s',
      '100 ms/s',
      REAL_TIME.label,
      'Max',
    ]);
  });
});

describe('Simulation: actions', () => {
  it('applies an action at once while paused, and in the next frame while running', () => {
    const { clock, editor, simulation } = setup();
    expect(simulation.action('SW1', { type: 'toggle' })).toBe(false); // stopped
    simulation.step();
    expect(simulation.action('SW1', { type: 'toggle' })).toBe(true);
    expect(pin(editor, 'SW1', 'Y')).toBe('1'); // zero delay: right away
    expect(pin(editor, 'U1', 'Y')).not.toBe('0'); // the gate delay waits for time to move
    simulation.run();
    clock.frame(16);
    expect(pin(editor, 'U1', 'Y')).toBe('0');
    simulation.action('SW1', { type: 'toggle' });
    clock.frame(16);
    expect(pin(editor, 'U1', 'Y')).toBe('1');
  });

  it('refuses actions a part does not take', () => {
    const { simulation } = setup();
    simulation.run();
    expect(simulation.action('U1', { type: 'toggle' })).toBe(false);
    expect(simulation.action('NOPE', { type: 'toggle' })).toBe(false);
  });
});

describe('Simulation: following the document', () => {
  it('keeps the very same simulator when a part moves with its wires', () => {
    const { clock, editor, simulation } = setup();
    simulation.run();
    clock.frame(16);
    const before = simulation.simulator;
    const { circuit } = editor.state.get();
    editor.edit('Label', updateComponent(circuit, 'D2', { label: 'BLINK' }));
    expect(simulation.simulator).toBe(before);
    editor.setSelection({ parts: new Set(['D2', 'PWR3']), wires: new Set() });
    editor.nudge(0, 3);
    expect(editor.state.get().circuit).not.toBe(circuit);
    expect(simulation.simulator).toBe(before);
    // The moved wires still map to their nets.
    const wire = editor.scene.wires.find((w) => w.net === 'X1.Y')!;
    expect(simulation.signals.wires.get(wire.id)).toBe(before!.netIndex('X1.Y'));
  });

  it('keeps the simulator when a net label joins nothing new; colors labels by their net', () => {
    const { clock, editor, simulation } = setup();
    simulation.run();
    simulation.action('SW1', { type: 'toggle' });
    clock.frame(16);
    const before = simulation.simulator;
    const label = (id: string, name: string, at: [number, number]) => ({
      id,
      type: 'net/label',
      x: at[0],
      y: at[1],
      rotation: 0 as const,
      flip: false,
      props: { name },
    });
    // On the end of SW1's wire (U1.A at (10, 1)): it only names the net.
    editor.edit('Place', addComponents(editor.state.get().circuit, [label('NL1', 'IN', [10, 1])]));
    expect(simulation.simulator).toBe(before);
    const point = editor.scene.partById.get('NL1')!.pins[0]!.at;
    expect(simulation.signalView()!.point(point)).toBe(SignalStyle.L1);
    // A second IN far away, renamed: still nothing new joined.
    editor.edit('Place', addComponents(editor.state.get().circuit, [label('NL2', 'IN', [40, 40])]));
    editor.setPartProp('NL2', 'name', 'OTHER');
    expect(simulation.simulator).toBe(before);
    // A label IN on the clock's LED input joins two nets: the netlist changes.
    editor.edit('Place', addComponents(editor.state.get().circuit, [label('NL3', 'IN', [20, 13])]));
    expect(simulation.simulator).not.toBe(before);
  });

  it('continues in the recompiled netlist after a structural edit, carrying state', () => {
    const { clock, editor, simulation } = setup();
    simulation.run();
    simulation.action('SW1', { type: 'toggle' });
    clock.frame(16);
    const before = simulation.simulator!;
    const { circuit } = editor.state.get();
    const added = addComponents(circuit, [
      { id: 'D3', type: 'io/led', x: 40, y: 0, rotation: 0, flip: false, props: {} },
    ]);
    editor.edit('Place LED', added);
    const after = simulation.simulator!;
    expect(after).not.toBe(before);
    expect(after.now).toBe(ms(16));
    expect(after.stateOf('SW1')).toEqual({ on: true });
    expect(pin(editor, 'U1', 'Y')).toBe('0');
    clock.frame(16);
    expect(after.now).toBe(ms(32));
  });

  it('carries state across renames, their undo and redo', () => {
    const { clock, editor, simulation } = setup();
    simulation.run();
    simulation.action('SW1', { type: 'toggle' });
    clock.frame(16);
    expect(editor.renamePart('SW1', 'SW7')).toBeUndefined();
    expect(simulation.simulator!.stateOf('SW7')).toEqual({ on: true });
    editor.undo();
    expect(simulation.simulator!.stateOf('SW1')).toEqual({ on: true });
    editor.redo();
    expect(simulation.simulator!.stateOf('SW7')).toEqual({ on: true });
  });

  it('only remembers the document while stopped', () => {
    const { editor, simulation } = setup();
    editor.edit('Label', updateComponent(editor.state.get().circuit, 'D1', { label: 'X' }));
    expect(simulation.simulator).toBeUndefined();
    simulation.run();
    expect(simulation.simulator!.componentIndex('D1')).toBeGreaterThanOrEqual(0);
  });
});

describe('Simulation: oscillation and diagnostics', () => {
  /** A zero-delay NAND fed back to itself, enabled by a switch: oscillates once it is on. */
  function ring(): Circuit {
    return new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('U1', 'prim/nand', { at: [10, 0], props: { delay: 0 } })
      .connect('SW1.Y', 'U1.A')
      .connect('U1.Y', 'U1.B', [17, 2], [17, 5], [9, 5], [9, 3])
      .build();
  }

  it('halts on an oscillation; an edit or reset gets out', () => {
    const { clock, editor, simulation } = setup(ring());
    simulation.run();
    clock.frame(16);
    expect(simulation.state).toBe('running');
    simulation.action('SW1', { type: 'toggle' });
    clock.frame(16);
    expect(simulation.state).toBe('halted');
    expect(simulation.diagnostics.get().map((d) => d.kind)).toContain('oscillation');
    simulation.run(); // nothing: halted
    expect(simulation.state).toBe('halted');
    const { circuit } = editor.state.get();
    editor.edit('Delay', updateComponent(circuit, 'U1', { props: { delay: ns(1) } }));
    expect(simulation.state).toBe('paused');
    simulation.reset();
    expect(simulation.state).toBe('paused');
    expect(simulation.simulator!.now).toBe(0);
    expect(simulation.diagnostics.get()).toEqual([]);
  });

  it('publishes diagnostics with their counts, and clears them on stop', () => {
    const floating = new CircuitBuilder(registry).add('U1', 'prim/not', { at: [0, 0] }).build();
    const { clock, simulation } = setup(floating);
    simulation.run();
    clock.frames(10, 20);
    const [d] = simulation.diagnostics.get();
    expect(d).toMatchObject({ kind: 'floating-input', component: 'U1', pin: 'A', count: 1 });
    simulation.stop();
    expect(simulation.diagnostics.get()).toEqual([]);
  });
});

describe('Simulation: signals', () => {
  it('maps every wire to its net, and wires on no pin to −1', () => {
    const { circuit } = addWires(hello(), [
      [
        [40, 40],
        [44, 40],
      ],
    ]);
    const { simulation } = setup(circuit);
    simulation.run();
    const sim = simulation.simulator!;
    const { wires } = simulation.signals;
    const lone = circuit.wires.find((w) => w.from[0] === 40)!;
    expect(wires.get(lone.id)).toBe(-1);
    const levels = circuit.wires
      .filter((w) => w !== lone)
      .map((w) => wires.get(w.id)!)
      .map((n) => sim.levels[n] as Level);
    expect(levels.every((l) => l !== undefined)).toBe(true);
  });
});

describe('Simulation: signal view', () => {
  const wireOn = (editor: Editor, net: string) => editor.scene.wires.find((w) => w.net === net)!;

  it('is undefined when stopped; shows levels, weak levels and wires it does not know', () => {
    const circuit = new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('D1', 'io/led', { at: [10, 0] })
      .connect('SW1.Y', 'D1.A')
      .add('R1', 'prim/pull', { at: [0, 10], props: { direction: 'up' } })
      .add('D2', 'io/led', { at: [10, 10] })
      .connect('R1.Y', 'D2.A')
      .build();
    const { clock, editor, simulation } = setup(circuit);
    expect(simulation.signalView()).toBeUndefined();
    simulation.run();
    clock.frame(16);
    const view = simulation.signalView()!;
    expect(view.wire(wireOn(editor, 'SW1.Y').id)).toBe(SignalStyle.L0);
    expect(view.wire(wireOn(editor, 'R1.Y').id)).toBe(SignalStyle.WEAK_1);
    expect(view.wire('no-such-wire')).toBe(SignalStyle.NONE);
    expect(view.point(editor.scene.partById.get('D1')!.pins[1]!.at)).toBe(SignalStyle.Z); // K
    simulation.action('SW1', { type: 'toggle' });
    clock.frame(16);
    expect(simulation.signalView()!.wire(wireOn(editor, 'SW1.Y').id)).toBe(SignalStyle.L1);
  });

  it('flashes contention while running, redrawing on each phase', () => {
    // Two switches wired together: off/on disagree.
    const circuit = new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('SW2', 'io/switch', { at: [0, 6], props: { on: true } })
      .connect('SW1.Y', 'SW2.Y', [6, 1], [6, 7])
      .build();
    const { clock, editor, simulation } = setup(circuit);
    simulation.run();
    clock.frame(16);
    const id = editor.scene.wires[0]!.id;
    expect(simulation.signalView()!.wire(id)).toBe(SignalStyle.CONTENTION);
    const phases = new Set<boolean>();
    let redraws = 0;
    simulation.revision.subscribe(() => redraws++);
    for (let i = 0; i < 40; i++) {
      clock.frame(16);
      phases.add(simulation.signalView()!.flash);
    }
    expect(phases).toEqual(new Set([true, false]));
    expect(redraws).toBeGreaterThanOrEqual(2); // 640 ms: a phase every 250 ms
    simulation.pause();
    expect(simulation.signalView()!.flash).toBe(true);
  });

  it('does not redraw while nothing changes', () => {
    const circuit = new CircuitBuilder(registry).add('SW1', 'io/switch', { at: [0, 0] }).build();
    const { clock, simulation } = setup(circuit);
    simulation.run();
    clock.frame(16);
    let redraws = 0;
    simulation.revision.subscribe(() => redraws++);
    clock.frames(30);
    expect(redraws).toBe(0);
  });
});

describe('Simulation: buses', () => {
  /**
   * Switches SW1…SW4 with bus entries D0…D3 on their outputs, one bus line through the entries'
   * bus ends, labeled `name`; another bus line labeled Q[0..3] that nothing is named after.
   */
  function switches(name = 'D[0..3]') {
    const b = new CircuitBuilder(registry);
    for (let i = 0; i < 4; i++) {
      b.add(`SW${i + 1}`, 'io/switch', { at: [0, 3 * i] });
      b.add(`BE${i + 1}`, 'net/bus-entry', { at: b.pin(`SW${i + 1}.Y`), props: { name: `D${i}` } });
    }
    const [x, y] = b.pin('BE1.B');
    return b
      .bus([x, y], [x, 16])
      .add('NL1', 'net/label', { at: [x, 16], props: { name } })
      .bus([20, 0], [20, 6])
      .add('NL2', 'net/label', { at: [20, 6], props: { name: 'Q[0..3]' } })
      .build();
  }

  const busLine = (editor: Editor, bus: string) => editor.scene.wires.find((w) => w.net === bus)!;

  it('finds every member by name; members nothing is named after have no net', () => {
    const { simulation } = setup(switches('D[0..7]'));
    simulation.run();
    const members = [...simulation.signals.buses.get('D[0..7]')!];
    expect(members.slice(0, 4).every((n) => n >= 0)).toBe(true);
    expect(members.slice(4)).toEqual([-1, -1, -1, -1]);
    expect([...simulation.signals.buses.get('Q[0..3]')!]).toEqual([-1, -1, -1, -1]);
  });

  it('shows a bus in the bus color when every member is known, its value on the label', () => {
    const { clock, editor, simulation } = setup(switches());
    simulation.run();
    clock.frame(16);
    let view = simulation.signalView()!;
    expect(view.wire(busLine(editor, 'D[0..3]').id)).toBe(SignalStyle.BUS);
    expect(view.busPoint(editor.scene.partById.get('NL1')!.pins[0]!.at)).toBe(SignalStyle.BUS);
    expect(view.busValue('D[0..3]')).toBe('0x0');
    simulation.action('SW1', { type: 'toggle' });
    simulation.action('SW4', { type: 'toggle' });
    clock.frame(16);
    view = simulation.signalView()!;
    expect(view.busValue('D[0..3]')).toBe('0x9');
    // Nothing named after Q's members: they float.
    expect(view.wire(busLine(editor, 'Q[0..3]').id)).toBe(SignalStyle.Z);
    expect(view.busValue('Q[0..3]')).toBe('0xZ');
  });

  it('shows a bus with some members floating as unknown', () => {
    const { clock, editor, simulation } = setup(switches('D[0..7]'));
    simulation.run();
    clock.frame(16);
    const view = simulation.signalView()!;
    expect(view.wire(busLine(editor, 'D[0..7]').id)).toBe(SignalStyle.X);
    expect(view.busValue('D[0..7]')).toBe('0xZ0');
  });

  it('keeps the simulator when bus lines and bus labels change', () => {
    const { clock, editor, simulation } = setup(switches());
    simulation.run();
    clock.frame(16);
    const before = simulation.simulator;
    const { circuit } = addWires(
      editor.state.get().circuit,
      [
        [
          [20, 6],
          [30, 6],
        ],
      ],
      true,
    );
    editor.edit('Bus', circuit);
    editor.setPartProp('NL1', 'name', 'D[3..0]'); // the same members
    expect(simulation.simulator).toBe(before);
    // Q's bus line and its label, moved together.
    const q = editor.scene.wires.find((w) => w.net === 'Q[0..3]')!;
    editor.setSelection(selectionOf(['NL2'], [q.id]));
    editor.nudge(5, 0);
    expect(editor.scene.wires.find((w) => w.net === 'Q[0..3]')!.from[0]).toBe(q.from[0] + 5);
    expect(simulation.simulator).toBe(before);
    expect(simulation.signalView()!.busValue('D[3..0]')).toBe('0x0');
  });
});

describe('Simulation: lights', () => {
  const light = (simulation: Editor['simulation'], id: string, i = 0) =>
    simulation.signalView()!.part(id)!.light(i);

  it('shows an LED on a fast clock at its average brightness', () => {
    const { clock, simulation } = setup(hello(1e6)); // 1 MHz, 50 % duty
    simulation.run();
    clock.frame(16);
    expect(light(simulation, 'D2')).toBeCloseTo(0.5, 1);
    simulation.action('SW1', { type: 'toggle' }); // D1 goes dark
    clock.frame(16);
    expect(light(simulation, 'D1')).toBe(0);
    simulation.action('SW1', { type: 'toggle' });
    clock.frame(16);
    expect(light(simulation, 'D1')).toBeGreaterThan(0.9);
  });

  it('shows what a light does at this instant while paused or stepping', () => {
    const { simulation } = setup(hello(1e6));
    simulation.step(); // t = 0
    simulation.step(); // 1 ns: the NAND output rises, D1 lights
    expect(light(simulation, 'D1')).toBe(1);
    expect(light(simulation, 'D2')).toBe(0);
  });

  it('marks a light whose state is unknown', () => {
    const unknown = new CircuitBuilder(registry)
      .add('U1', 'prim/not', { at: [0, 0] }) // floating input: Y = X
      .add('D1', 'io/led', { at: [10, 0] })
      .add('PWR1', 'io/gnd', { at: [16, 1] })
      .connect('U1.Y', 'D1.A', [8, 1])
      .connect('D1.K', 'PWR1.Y')
      .build();
    const { clock, simulation } = setup(unknown);
    simulation.run();
    clock.frame(16);
    expect(light(simulation, 'D1')).toBe(UNKNOWN_LIGHT);
  });

  it('keeps brightness across an edit and starts over on reset', () => {
    const { clock, editor, simulation } = setup(hello(1e6));
    simulation.run();
    clock.frame(16);
    const { circuit } = editor.state.get();
    editor.edit(
      'Place LED',
      addComponents(circuit, [
        { id: 'D3', type: 'io/led', x: 40, y: 0, rotation: 0, flip: false, props: {} },
      ]),
    );
    clock.frame(16);
    expect(light(simulation, 'D2')).toBeCloseTo(0.5, 1);
    simulation.pause();
    simulation.reset();
    expect(light(simulation, 'D2')).toBe(0);
  });

  it('gives drawers the state and pin levels of a part', () => {
    const { clock, simulation } = setup();
    simulation.run();
    simulation.action('SW1', { type: 'toggle' });
    clock.frame(16);
    const sw = simulation.signalView()!.part('SW1')!;
    expect(sw.state).toEqual({ on: true });
    expect(levelChar(sw.level('Y'))).toBe('1');
    expect(levelChar(sw.level('NOPE'))).toBe('Z');
    expect(simulation.signalView()!.part('NOPE')).toBeUndefined();
  });
});

describe('Simulation: panels', () => {
  /** Two switches wired together: a contention as soon as they disagree. */
  const shorted = () =>
    new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('SW2', 'io/switch', { at: [0, 6], props: { on: true } })
      .connect('SW1.Y', 'SW2.Y', [6, 1], [6, 7])
      .build();

  it('finds the wires of a net a diagnostic names, and locates them', () => {
    const { clock, editor, simulation } = setup(shorted());
    expect(simulation.wiresOfNet('SW1.Y')).toEqual([]); // stopped
    simulation.run();
    clock.frames(10); // the list refreshes with the status, every 100 ms
    const [d] = simulation.diagnostics.get();
    expect(d).toMatchObject({ kind: 'contention', net: 'SW1.Y' });
    const wires = simulation.wiresOfNet(d!.net!);
    expect(wires.sort()).toEqual(editor.scene.wires.map((w) => w.id).sort());
    expect(simulation.wiresOfNet('nope')).toEqual([]);
    editor.locateNet('SW1.Y');
    expect([...editor.state.get().selection.wires].sort()).toEqual(wires.sort());
    editor.locateNet('SW2.Q'); // no such net: the part its id starts with
    expect(editor.state.get().selection.parts).toEqual(new Set(['SW2']));
  });

  it('clears the list; a problem that happens again comes back', () => {
    const { clock, simulation } = setup(shorted());
    simulation.run();
    clock.frames(10);
    expect(simulation.diagnostics.get()).toHaveLength(1);
    simulation.clearDiagnostics();
    expect(simulation.diagnostics.get()).toEqual([]);
    simulation.action('SW1', { type: 'toggle' }); // they agree: the short clears
    clock.frame(16);
    simulation.action('SW1', { type: 'toggle' }); // and starts again
    clock.frames(10);
    expect(simulation.diagnostics.get().map((d) => d.count)).toEqual([2]);
  });

  it('gives Properties the style of pins and wires, and ticks after actions', () => {
    const { editor, simulation } = setup();
    expect(simulation.pinStyle('SW1', 'Y')).toBeUndefined();
    simulation.step();
    expect(simulation.pinStyle('SW1', 'Y')).toBe(SignalStyle.L0);
    expect(simulation.pinStyle('SW1', 'NOPE')).toBeUndefined();
    const wire = editor.scene.wires.find((w) => w.net === 'SW1.Y')!;
    expect(simulation.wireStyle(wire.id)).toBe(SignalStyle.L0);
    const ticks = simulation.ticks.get();
    simulation.action('SW1', { type: 'toggle' });
    expect(simulation.ticks.get()).toBeGreaterThan(ticks);
    expect(simulation.wireStyle(wire.id)).toBe(SignalStyle.L1);
  });
});
