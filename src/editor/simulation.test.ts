import { describe, expect, it } from 'vitest';
import { addComponents, addWires, type Circuit, CircuitBuilder, updateComponent } from '../circuit';
import { Level, levelChar, ms, ns } from '../core';
import { createDefaultRegistry, type Hd44780Controller } from '../library';
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

/** A zero-delay NAND fed back to itself, enabled by a switch: oscillates once it is on. */
function ring(): Circuit {
  return new CircuitBuilder(registry)
    .add('SW1', 'io/switch', { at: [0, 0] })
    .add('U1', 'prim/nand', { at: [10, 0], props: { delay: 0 } })
    .connect('SW1.Y', 'U1.A')
    .connect('U1.Y', 'U1.B', [17, 2], [17, 5], [9, 5], [9, 3])
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

  it('pauses at the instant the kernel was asked to break, at any speed', () => {
    for (const speed of [REAL_TIME, MAX_SPEED]) {
      const { clock, simulation } = setup(hello(1e6)); // first rising edge at 500 ns
      simulation.setSpeed(speed);
      simulation.run();
      const sim = simulation.simulator!;
      const net = sim.pinNet('X1', 'Y');
      sim.onNetChange((_, n, level) => {
        if (n === net && levelChar(level) === '1') sim.requestBreak();
      });
      clock.frame(16);
      expect(simulation.state).toBe('paused');
      expect(sim.now).toBe(ns(500));
      expect(simulation.status.get().time).toBe(ns(500));
      expect(clock.pending).toBe(0);
    }
  });

  it('pauses where pauseAt says, at real time and at Max', () => {
    for (const speed of [REAL_TIME, MAX_SPEED]) {
      const { clock, simulation } = setup(hello(1e6));
      simulation.setSpeed(speed);
      simulation.run();
      simulation.pauseAt(ns(1234));
      expect(simulation.pausesAt).toBe(ns(1234));
      clock.frame(16);
      expect(simulation.state).toBe('paused');
      expect(simulation.simulator!.now).toBe(ns(1234));
      expect(simulation.pausesAt).toBeUndefined();
    }
  });

  it('runs on past a break to a pending pauseAt within the same frame', () => {
    const { clock, simulation } = setup(hello(1e6)); // first rising edge at 500 ns
    simulation.run();
    const sim = simulation.simulator!;
    const net = sim.pinNet('X1', 'Y');
    const off = sim.onNetChange((time, n, level) => {
      if (n !== net || levelChar(level) !== '1') return;
      sim.requestBreak(); // a trigger: break here, then run on for 300 ns
      simulation.pauseAt(time + ns(300));
      off();
    });
    clock.frame(16);
    expect(simulation.state).toBe('paused');
    expect(sim.now).toBe(ns(800));
  });

  it('at Max, pauses when nothing is left to happen before pauseAt', () => {
    const idle = setup(
      new CircuitBuilder(registry).add('SW1', 'io/switch', { at: [0, 0] }).build(),
    );
    idle.simulation.setSpeed(MAX_SPEED);
    idle.simulation.run();
    idle.simulation.pauseAt(ms(1));
    idle.clock.frame(16);
    expect(idle.simulation.state).toBe('paused');
  });

  it('forgets pauseAt on pause and on power-on', () => {
    const { clock, simulation } = setup();
    simulation.run();
    simulation.pauseAt(ms(500));
    simulation.pause();
    expect(simulation.pausesAt).toBeUndefined();
    simulation.run();
    simulation.pauseAt(ms(500));
    simulation.reset();
    expect(simulation.pausesAt).toBeUndefined();
    clock.frames(3);
    expect(simulation.state).toBe('running');
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

describe('Simulation: steps', () => {
  /** The 1 MHz clock's net (rises at 500 ns, falls at 1 µs, …) as a Step Clock goal. */
  const stepClock = (simulation: ReturnType<typeof setup>['simulation']) => {
    const sim = simulation.simulator!;
    const net = sim.netId(sim.pinNet('X1', 'Y'));
    return { kind: 'edge', net, level: Level.L1, label: 'Step Clock' } as const;
  };
  const powered = (frequency = 1e6) => {
    const s = setup(hello(frequency));
    s.simulation.step(); // t = 0, paused
    return s;
  };

  it('runs a time step at Max, whatever the speed, and pauses exactly there', () => {
    const { simulation } = powered();
    simulation.setSpeed(SPEEDS[0]!); // 1 ns/s
    expect(simulation.runTo({ kind: 'time', until: ns(1234), label: 'Run For 1.234 µs' })).toBe(
      true,
    );
    expect(simulation.state).toBe('paused');
    expect(simulation.simulator!.now).toBe(ns(1234));
    expect(simulation.status.get()).toMatchObject({ time: ns(1234), reason: 'Run For 1.234 µs' });
    expect(simulation.status.get().goal).toBeUndefined();
  });

  it('powers on for a step from stopped', () => {
    const { editor, simulation } = setup(hello(1e6));
    simulation.runTo({ kind: 'time', until: ns(700), label: 'Run To' });
    expect(simulation.state).toBe('paused');
    expect(simulation.simulator!.now).toBe(ns(700));
    expect(pin(editor, 'X1', 'Y')).toBe('1');
  });

  it('Step Clock pauses right before the next rising edge, the cycle settled', () => {
    const { editor, simulation } = powered();
    const goal = stepClock(simulation);
    const sim = simulation.simulator!;
    simulation.runTo(goal);
    expect(simulation.status.get()).toMatchObject({ state: 'paused', reason: 'Step Clock' });
    expect(sim.now).toBeLessThan(ns(500));
    expect(sim.nextEventTime).toBe(ns(500)); // the edge is the next instant
    expect(pin(editor, 'X1', 'Y')).toBe('0');
    simulation.runTo(goal); // through that edge, right before the next one
    expect(sim.now).toBe(ns(1000)); // the fall was the last thing to happen
    expect(sim.nextEventTime).toBe(ns(1500));
    simulation.step(); // F10 steps into the edge
    expect(pin(editor, 'X1', 'Y')).toBe('1');
    expect(simulation.status.get().reason).toBeUndefined();
    simulation.runTo({ kind: 'time', until: ns(1700), label: 'Run For' }); // mid-cycle
    simulation.runTo(goal);
    expect(sim.nextEventTime).toBe(ns(2500));
  });

  it('Step Clock passes the edge it paused before, even after an action queued instants', () => {
    const { editor, simulation } = powered();
    const goal = stepClock(simulation);
    const sim = simulation.simulator!;
    simulation.runTo(goal);
    expect(sim.nextEventTime).toBe(ns(500));
    // A switch flipped right before the edge: its gate's change comes first.
    simulation.action('SW1', { type: 'toggle' });
    expect(sim.nextEventTime).toBeLessThan(ns(500));
    simulation.runTo(goal);
    expect(simulation.status.get()).toMatchObject({ state: 'paused', reason: 'Step Clock' });
    expect(sim.now).toBe(ns(1000)); // through the edge and the fall, before the next edge
    expect(sim.nextEventTime).toBe(ns(1500));
    expect(pin(editor, 'U1', 'Y')).toBe('0');
  });

  it('Step Clock from stopped pauses before the first edge', () => {
    const { simulation } = setup(hello(1e6));
    simulation.runTo({ kind: 'edge', net: 'X1.Y', level: Level.L1, label: 'Step Clock' });
    expect(simulation.state).toBe('paused');
    expect(simulation.simulator!.nextEventTime).toBe(ns(500));
  });

  it('pauses at power-on when a pause is asked for there, before starting the step', () => {
    const { simulation } = setup(hello(1e6));
    const seen = new Set<unknown>();
    // Tools attach to each new simulator when the state changes, before its first instant.
    simulation.status.subscribe(() => {
      const sim = simulation.simulator;
      if (!sim || seen.has(sim)) return;
      seen.add(sim);
      sim.onInstant((t) => {
        if (t === 0) simulation.requestPause('At power-on');
      });
    });
    simulation.runTo({ kind: 'time', until: ns(700), label: 'Run To' });
    expect(simulation.status.get()).toMatchObject({ state: 'paused', reason: 'At power-on' });
    expect(simulation.simulator!.now).toBe(0);
  });

  it('settles: runs until nothing is left to happen', () => {
    const { editor, simulation } = setup(
      new CircuitBuilder(registry)
        .add('X1', 'io/clock', { at: [0, 0], props: { frequency: 1e6, mode: 'manual' } })
        .build(),
    );
    simulation.step();
    simulation.action('X1', { type: 'step' }); // a 500 ns pulse
    simulation.runTo({ kind: 'settle', label: 'Settle' });
    expect(simulation.status.get()).toMatchObject({ state: 'paused', reason: 'Settle' });
    expect(simulation.simulator!.now).toBe(ns(500));
    expect(pin(editor, 'X1', 'Y')).toBe('0');
  });

  it('says so when no edge is coming or the net is gone', () => {
    const { simulation } = setup(
      new CircuitBuilder(registry).add('SW1', 'io/switch', { at: [0, 0] }).build(),
    );
    simulation.step();
    const sim = simulation.simulator!;
    const net = sim.netId(sim.pinNet('SW1', 'Y'));
    simulation.runTo({ kind: 'edge', net, level: Level.L1, label: 'Step Clock' });
    expect(simulation.status.get().reason).toBe('Step Clock: nothing left to happen');
    simulation.runTo({ kind: 'edge', net: 'NOPE', level: Level.L1, label: 'Step Clock' });
    expect(simulation.status.get().reason).toBe('Step Clock: no net NOPE');
  });

  it('spreads a long step over frames; Pause cancels it, Run makes it a normal run', () => {
    const { clock, simulation } = powered();
    clock.cost = 1; // 8 kernel calls a frame
    const sim = simulation.simulator!;
    const never = { kind: 'edge', net: sim.netId(sim.pinNet('U1', 'A')), level: Level.L1 } as const;
    simulation.runTo({ ...never, label: 'Step Clock' });
    expect(simulation.status.get()).toMatchObject({ state: 'running', goal: 'Step Clock' });
    const first = sim.now;
    clock.frames(8); // the status refreshes every 100 ms
    expect(sim.now).toBeGreaterThan(first);
    expect(simulation.status.get()).toMatchObject({ goal: 'Step Clock', lagging: false });
    simulation.pause();
    expect(simulation.status.get().goal).toBeUndefined();
    expect(simulation.status.get().reason).toBeUndefined();
    simulation.run(); // from paused: a normal run, the step forgotten
    expect(simulation.status.get().goal).toBeUndefined();
    simulation.pause();
    simulation.runTo({ ...never, label: 'Step Clock' });
    clock.cost = 0; // (every clock call would count as wall time passing)
    simulation.run();
    expect(simulation.status.get()).toMatchObject({ state: 'running' });
    expect(simulation.status.get().goal).toBeUndefined();
    const at = sim.now;
    clock.frame(16);
    expect(sim.now).toBe(at + ms(16)); // real time again
  });

  it('a requested pause wins over a step and over a pending pauseAt, with its reason', () => {
    const breakAtRise = (simulation: ReturnType<typeof setup>['simulation']) => {
      const sim = simulation.simulator!;
      const net = sim.pinNet('X1', 'Y');
      return sim.onNetChange((_, n, level) => {
        if (n !== net || levelChar(level) !== '1') return;
        simulation.requestPause('Breakpoint 1');
        simulation.requestPause('Breakpoint 2'); // the first of an instant wins
      });
    };
    const stepping = powered();
    breakAtRise(stepping.simulation);
    stepping.simulation.runTo({ kind: 'time', until: ns(5000), label: 'Run For' });
    expect(stepping.simulation.simulator!.now).toBe(ns(500));
    expect(stepping.simulation.status.get().reason).toBe('Breakpoint 1');

    const { clock, simulation } = setup(hello(1e6));
    simulation.setSpeed(MAX_SPEED);
    simulation.run();
    simulation.pauseAt(ns(5000), 'Triggered');
    breakAtRise(simulation);
    clock.frame(16);
    expect(simulation.state).toBe('paused');
    expect(simulation.simulator!.now).toBe(ns(500));
    expect(simulation.status.get().reason).toBe('Breakpoint 1');
    expect(simulation.pausesAt).toBeUndefined();
    simulation.run(); // Run clears the reason
    expect(simulation.status.get().reason).toBeUndefined();
  });

  it('gives the reason of a pauseAt, and of a pause asked for during a step or an action', () => {
    const { clock, simulation } = setup(hello(1e6));
    simulation.run();
    simulation.pauseAt(ns(1234), 'Triggered at 1 µs');
    clock.frame(16);
    expect(simulation.status.get().reason).toBe('Triggered at 1 µs');

    // A trigger firing during a step: its post-trigger end comes first.
    const triggered = powered();
    const host = triggered.simulation;
    const sim0 = host.simulator!;
    const clk = sim0.pinNet('X1', 'Y');
    const off = sim0.onNetChange((time, n, level) => {
      if (n !== clk || levelChar(level) !== '1') return;
      sim0.requestBreak();
      host.pauseAt(time + ns(300), 'Triggered');
      off();
    });
    host.runTo({ kind: 'time', until: ns(5000), label: 'Run For' });
    expect(sim0.now).toBe(ns(800));
    expect(host.status.get().reason).toBe('Triggered');

    const paused = powered();
    const sim = paused.simulation.simulator!;
    const net = sim.pinNet('X1', 'Y');
    sim.onNetChange((_, n, level) => {
      if (n === net && levelChar(level) === '1') paused.simulation.requestPause('Breakpoint 2');
    });
    while (sim.now < ns(500)) paused.simulation.step();
    expect(sim.now).toBe(ns(500));
    expect(paused.simulation.status.get().reason).toBe('Breakpoint 2');
    paused.simulation.step();
    expect(paused.simulation.status.get().reason).toBeUndefined();
  });

  it('forgets a pause asked for outside a run at power-on', () => {
    const { clock, simulation } = powered();
    simulation.requestPause('Stale'); // no run takes it
    simulation.reset();
    simulation.run();
    const sim = simulation.simulator!;
    const clk = sim.pinNet('X1', 'Y');
    const off = sim.onNetChange((time, n, level) => {
      if (n !== clk || levelChar(level) !== '1') return;
      sim.requestBreak(); // a trigger: it runs on
      simulation.pauseAt(time + ns(300), 'Triggered');
      off();
    });
    clock.frame(16);
    expect(sim.now).toBe(ns(800));
    expect(simulation.status.get().reason).toBe('Triggered');
  });

  it('does not step a halted simulation; a step that halts says so', () => {
    const { clock, simulation } = setup(ring());
    simulation.step();
    simulation.action('SW1', { type: 'toggle' });
    expect(simulation.state).toBe('halted');
    expect(simulation.runTo({ kind: 'time', until: ns(1), label: 'Run For' })).toBe(false);
    simulation.reset();
    expect(simulation.runTo({ kind: 'time', until: Number.NaN, label: 'Run For' })).toBe(false);
    expect(simulation.state).toBe('running');
    simulation.pause();
    simulation.runTo({ kind: 'time', until: ms(1), label: 'Run For' });
    simulation.action('SW1', { type: 'toggle' });
    clock.frame(16);
    expect(simulation.state).toBe('halted');
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
  it('finds the simulator net of a scene net by its id, through a pin on it', () => {
    const { simulation } = setup();
    expect(simulation.netOf('X1.Y')).toBeUndefined(); // stopped
    simulation.step();
    expect(simulation.netOf('X1.Y')).toBe(simulation.simulator!.pinNet('X1', 'Y'));
    expect(simulation.netOf('nothing')).toBeUndefined();
  });

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

describe('Simulation: animated parts', () => {
  it('redraws a blinking LCD at every blink phase though nothing else happens', () => {
    const lcd = new CircuitBuilder(registry).add('DS1', 'periph/hd44780', { at: [0, 0] }).build();
    const { clock, simulation } = setup(lcd);
    simulation.run();
    clock.frame(16);
    const bumps = (frames: number) => {
      const before = simulation.revision.get();
      for (let i = 0; i < frames; i++) clock.frame(16);
      return simulation.revision.get() - before;
    };
    const ctl = (simulation.simulator!.stateOf('DS1') as { ctl: Hd44780Controller }).ctl;
    expect(bumps(60)).toBe(0); // display off: nothing changes
    ctl.d = 1;
    ctl.b = 1;
    // 379.3 ms a phase at 270 kHz: about 960 ms of frames cross two or three.
    expect(bumps(60)).toBeGreaterThanOrEqual(2);
    ctl.b = 0;
    bumps(1);
    expect(bumps(60)).toBe(0);
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

/** The scene's net id of X1's output (what the resolver gives a step goal). */
function editor_net(simulation: {
  signals: { nets: ReadonlyMap<string, number> };
  simulator: unknown;
}) {
  const sim = simulation.simulator as { pinNet(c: string, p: string): number };
  const index = sim.pinNet('X1', 'Y');
  for (const [id, n] of simulation.signals.nets) if (n === index) return id;
  throw new Error('no net for X1.Y');
}

describe('Simulation: rewinding', () => {
  /** A host with a short checkpoint interval, so the history has several. */
  function rewinding(circuit = hello(), options: { frameBudget?: number; interval?: number } = {}) {
    const clock = new FakeClock();
    const { interval = 30, ...rest } = options;
    const editor = new Editor(
      registry,
      circuit,
      {},
      { simulation: { clock, history: { interval }, ...rest } },
    );
    return { clock, editor, simulation: editor.simulation };
  }
  const now = (simulation: { simulator: { now: number } | undefined }) => simulation.simulator!.now;
  /** The levels of every net, as text. */
  const all = (simulation: { simulator: { levels: Uint8Array } | undefined }) =>
    Array.from(simulation.simulator!.levels, (l) => levelChar(l as Level)).join('');

  it('Step Back goes to the instant with events before the last one; Step comes back', () => {
    const { clock, simulation } = rewinding();
    simulation.run();
    clock.frames(5);
    simulation.pause();
    simulation.step();
    const at = { time: now(simulation), levels: all(simulation) };
    expect(simulation.stepBack()).toBe(true);
    expect(simulation.state).toBe('paused');
    expect(simulation.status.get().reason).toBe('Step Back');
    expect(now(simulation)).toBeLessThan(at.time);
    expect(now(simulation) % ns(500)).toBe(0); // the clock's half periods: 0.5 ms
    simulation.step();
    expect({ time: now(simulation), levels: all(simulation) }).toEqual(at);
    expect(simulation.history.get().behind).toBe(false);
  });

  it('rewinds to a time, as a straight run had it, and tells the tools', () => {
    const { clock, simulation } = rewinding();
    const heard: { time: number; present: number }[] = [];
    simulation.onRewind((event) => heard.push(event));
    simulation.run();
    clock.frames(10);
    simulation.pause();
    const present = now(simulation);
    const lit = () => simulation.signalView()!.part('D2')!.light(0);
    const litAtEnd = lit();
    expect(simulation.rewindTo(ms(37.2))).toBe(true);
    expect(now(simulation)).toBe(ms(37.2));
    expect(simulation.status.get()).toMatchObject({
      state: 'paused',
      reason: 'Rewound to 37.2 ms',
    });
    expect(heard).toEqual([{ time: ms(37.2), present }]);
    expect(simulation.history.get()).toEqual({ start: 0, present, behind: true });
    const plain = rewinding();
    plain.simulation.runTo({ kind: 'time', until: ms(37.2), label: 'Run To' });
    clock.frames(1);
    expect(all(simulation)).toBe(all(plain.simulation));
    // The LED shows what it showed then, whatever it showed at the end.
    const clockHigh = () => levelChar(simulation.simulator!.pinLevel('X1', 'Y')) === '1';
    expect(lit()).toBe(clockHigh() ? 1 : 0);
    const before = lit();
    simulation.rewindTo(ms(37.7));
    expect(lit()).toBe(clockHigh() ? 1 : 0);
    expect(lit()).not.toBe(before);
    expect([0, 1]).toContain(litAtEnd);
    expect(simulation.rewindTo(present + 1)).toBe(false); // the future isn't recorded
    expect(simulation.rewindTo(-1)).toBe(false);
  });

  it('replays the recording forward: the actions happen again at their instants', () => {
    const { clock, simulation } = rewinding();
    simulation.run();
    clock.frames(3);
    simulation.action('SW1', { type: 'toggle' }); // at 48 ms
    const toggled = now(simulation);
    clock.frames(3);
    simulation.action('SW1', { type: 'toggle' }); // and back at 96 ms
    clock.frames(3);
    simulation.pause();
    const end = { time: now(simulation), levels: all(simulation) };
    simulation.rewindTo(ms(10));
    const switchBefore = levelChar(simulation.simulator!.pinLevel('U1', 'A'));
    expect(simulation.timeline!.pending).toMatchObject({ time: toggled, component: 'SW1' });
    // Forward at the chosen speed (real time): the same run.
    simulation.run();
    clock.frames(3);
    expect(now(simulation)).toBe(ms(58));
    expect(levelChar(simulation.simulator!.pinLevel('U1', 'A'))).not.toBe(switchBefore);
    simulation.runTo({ kind: 'time', until: end.time, label: 'Run To' });
    expect({ time: now(simulation), levels: all(simulation) }).toEqual(end);
    expect(simulation.history.get().behind).toBe(false);
  });

  it('replays at Max too, where nothing happens between the actions', () => {
    // No clock: at Max the kernel goes idle, and time jumps to the next recorded action.
    const quiet = new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('U1', 'prim/nand', { at: [10, 0] })
      .add('PWR1', 'io/vcc', { at: [7, -4] })
      .connect('SW1.Y', 'U1.A')
      .connect('PWR1.Y', 'U1.B', [8, 3])
      .build();
    const { clock, simulation } = rewinding(quiet);
    simulation.run();
    clock.frames(2);
    simulation.pause();
    simulation.runTo({ kind: 'time', until: ms(5), label: 'Run To' });
    simulation.action('SW1', { type: 'toggle' }); // at 5 ms
    simulation.runTo({ kind: 'time', until: ms(9), label: 'Run To' });
    simulation.action('SW1', { type: 'toggle' }); // at 9 ms
    simulation.runTo({ kind: 'time', until: ms(12), label: 'Run To' });
    const y = () => levelChar(simulation.simulator!.pinLevel('U1', 'Y'));
    const end = { y: y(), events: simulation.simulator!.stats.events };
    simulation.rewindTo(ms(1));
    simulation.setSpeed(MAX_SPEED);
    simulation.run();
    clock.frame(16);
    expect(simulation.timeline!.pending).toBeUndefined();
    expect(simulation.timeline!.actions.map((a) => a.time)).toEqual([ms(5), ms(9)]);
    expect({ y: y(), events: simulation.simulator!.stats.events }).toEqual(end);
  });

  it('Step delivers a recorded action at its instant', () => {
    const quiet = new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('U1', 'prim/nand', { at: [10, 0] })
      .add('PWR1', 'io/vcc', { at: [7, -4] })
      .connect('SW1.Y', 'U1.A')
      .connect('PWR1.Y', 'U1.B', [8, 3])
      .build();
    const { simulation } = rewinding(quiet);
    simulation.step();
    simulation.runTo({ kind: 'time', until: ms(5), label: 'Run To' });
    simulation.action('SW1', { type: 'toggle' });
    simulation.runTo({ kind: 'time', until: ms(6), label: 'Run To' });
    simulation.rewindTo(ms(1));
    expect(simulation.step()).toBe(true); // nothing before 5 ms but the toggle
    expect(now(simulation)).toBe(ms(5));
    expect(levelChar(simulation.simulator!.pinLevel('U1', 'A'))).toBe('1');
    expect(simulation.timeline!.pending).toBeUndefined();
  });

  it('acting behind the present starts a new future, and the tools hear of it first', () => {
    const { clock, simulation } = rewinding();
    const diverged: number[] = [];
    simulation.onDiverge((time) => diverged.push(time));
    simulation.run();
    clock.frames(3);
    simulation.action('SW1', { type: 'toggle' });
    clock.frames(3);
    simulation.pause();
    simulation.rewindTo(ms(20));
    expect(simulation.action('SW1', { type: 'toggle' })).toBe(true);
    expect(diverged).toEqual([ms(20)]);
    expect(simulation.history.get()).toMatchObject({ present: ms(20), behind: false });
    expect(simulation.timeline!.actions.map((a) => a.time)).toEqual([ms(20)]);
    simulation.action('SW1', { type: 'toggle' }); // at the present: nothing to drop
    expect(diverged).toEqual([ms(20)]);
  });

  it('Go to Present comes back to the end of the recording', () => {
    const { clock, simulation } = rewinding();
    simulation.run();
    clock.frames(4);
    simulation.pause();
    const end = { time: now(simulation), levels: all(simulation) };
    expect(simulation.toPresent()).toBe(false);
    simulation.rewindTo(ms(3));
    expect(simulation.toPresent()).toBe(true);
    expect({ time: now(simulation), levels: all(simulation) }).toEqual(end);
    expect(simulation.status.get().reason).toBe('Present');
  });

  it('Run To a past time rewinds', () => {
    const { clock, simulation } = rewinding();
    simulation.run();
    clock.frames(4);
    simulation.pause();
    expect(simulation.runTo({ kind: 'time', until: ms(5), label: 'Run To 5 ms' })).toBe(true);
    expect(now(simulation)).toBe(ms(5));
    expect(simulation.status.get().reason).toBe('Run To 5 ms');
  });

  it('searches over frames when the budget runs out, saying so; Pause cancels it', () => {
    const { clock, simulation } = rewinding(hello(), { frameBudget: 1 });
    simulation.run();
    clock.frames(10);
    simulation.pause();
    const at = now(simulation);
    let segments = 0;
    clock.cost = 2; // every look at the clock takes 2 ms: one segment a frame
    simulation.searchBack({
      label: 'Find',
      notFound: 'nothing',
      watch: () => {
        segments++;
        return () => {};
      },
      target: () => undefined,
    });
    expect(segments).toBe(1);
    expect(simulation.status.get()).toMatchObject({ state: 'running', goal: 'Find' });
    clock.frame(16);
    expect(segments).toBe(2);
    simulation.pause();
    expect(simulation.state).toBe('paused');
    expect(now(simulation)).toBe(at);
    clock.frames(3);
    expect(segments).toBe(2);
    clock.cost = 0;
    simulation.run(); // a plain run again, no search
    clock.frame(16);
    expect(segments).toBe(2);
    expect(now(simulation)).toBeGreaterThan(at);
  });

  it('Step Back skips instants where only cancelled changes were due', () => {
    // SW1 into a slow inverter: toggled twice 2 ns apart, its change 10 ns later is cancelled.
    const slow = new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('U1', 'prim/not', { at: [10, 0], props: { delay: ns(10) } })
      .connect('SW1.Y', 'U1.A')
      .build();
    const { simulation } = rewinding(slow);
    simulation.runTo({ kind: 'time', until: ms(1), label: 'Run To' });
    simulation.action('SW1', { type: 'toggle' });
    simulation.runTo({ kind: 'time', until: ms(1) + ns(2), label: 'Run To' });
    simulation.action('SW1', { type: 'toggle' });
    simulation.runTo({ kind: 'time', until: ms(2), label: 'Run To' });
    expect(simulation.stepBack()).toBe(true);
    expect(now(simulation)).toBe(ms(1)); // not 1 ms + 2 ns: the stale instant at +10 ns is none
  });

  it('Step Back counts an instant processed again after an action at it once', () => {
    // A checkpoint after every run: one right before the action, one right after it.
    const { clock, simulation } = rewinding(hello(), { interval: 1 });
    simulation.run();
    clock.frames(2);
    simulation.pause();
    simulation.step(); // onto a clock edge
    const edge = now(simulation);
    simulation.action('SW1', { type: 'toggle' }); // processed again at the same instant
    expect(simulation.stepBack()).toBe(true);
    expect(now(simulation)).toBeLessThan(edge);
  });

  it('Step Clock behind the present passes the edge even with a recorded action before it', () => {
    const { simulation } = rewinding();
    simulation.runTo({ kind: 'time', until: ms(10.1), label: 'Run To' });
    simulation.runTo({ kind: 'time', until: ms(10.3), label: 'Run To' });
    simulation.action('SW1', { type: 'toggle' }); // between the stop and the edge at 10.5 ms
    simulation.runTo({ kind: 'time', until: ms(14), label: 'Run To' });
    simulation.rewindTo(ms(10.1));
    const net = editor_net(simulation);
    simulation.runTo({ kind: 'edge', net, level: Level.L1, label: 'Step Clock' });
    expect(simulation.status.get().reason).toBe('Step Clock');
    expect(now(simulation)).toBeGreaterThan(ms(10.5));
    expect(now(simulation)).toBeLessThan(ms(11.5));
  });

  it('goes to the start of the history when a search finds nothing', () => {
    const { clock, simulation } = rewinding();
    simulation.run();
    clock.frames(4);
    simulation.pause();
    simulation.searchBack({
      label: 'Find',
      notFound: 'nothing earlier',
      watch: () => () => {},
      target: () => undefined,
    });
    expect(simulation.status.get()).toMatchObject({
      state: 'paused',
      reason: 'Find: nothing earlier',
    });
    expect(now(simulation)).toBe(0);
    expect(simulation.stepBack()).toBe(true); // nothing before the power-on instant
    expect(simulation.status.get().reason).toBe('Step Back: the start of the history');
    expect(now(simulation)).toBe(0);
  });

  it('a search sees the instants in order, with positions, and goes where it says', () => {
    const { clock, simulation } = rewinding();
    simulation.run();
    clock.frames(2);
    simulation.action('SW1', { type: 'toggle' });
    clock.frames(2);
    simulation.pause();
    // The last time D1's anode net went low (SW1 toggled on: the NAND's output falls).
    const net = simulation.simulator!.pinNet('U1', 'Y');
    let last: number | undefined;
    simulation.searchBack({
      label: 'Last fall',
      notFound: 'none',
      watch: (sim, at) =>
        sim.onNetChange((time, n, level) => {
          if (n === net && level === Level.L0) last = at(time).time;
        }),
      target: () => last,
    });
    expect(simulation.status.get().reason).toBe('Last fall');
    expect(levelChar(simulation.simulator!.pinLevel('U1', 'Y'))).toBe('0');
    expect(now(simulation)).toBe(last);
    expect(last).toBeGreaterThan(ms(32));
  });

  it('rewinds out of an oscillation halt, which comes back at the same instant', () => {
    const { clock, simulation } = rewinding(ring());
    simulation.run();
    clock.frames(2);
    simulation.action('SW1', { type: 'toggle' });
    clock.frames(2);
    expect(simulation.state).toBe('halted');
    const at = now(simulation);
    expect(simulation.rewindTo(ms(10))).toBe(true);
    expect(simulation.state).toBe('paused');
    expect(simulation.simulator!.halted).toBe(false);
    simulation.run();
    clock.frames(3);
    expect(simulation.state).toBe('halted');
    expect(now(simulation)).toBe(at);
  });

  it('an edit behind the present continues from there; the history starts anew', () => {
    const { clock, editor, simulation } = rewinding();
    const diverged: number[] = [];
    simulation.onDiverge((time) => diverged.push(time));
    simulation.run();
    clock.frames(4);
    simulation.pause();
    simulation.rewindTo(ms(30));
    editor.edit(
      'Speed',
      updateComponent(editor.state.get().circuit, 'X1', { props: { frequency: 2000 } }),
    );
    expect(diverged).toEqual([ms(30)]);
    expect(now(simulation)).toBe(ms(30));
    expect(simulation.history.get()).toEqual({ start: ms(30), present: ms(30), behind: false });
    expect(simulation.rewindTo(ms(20))).toBe(false);
  });

  it('a test script edit is no edit of the circuit: the run and its history go on', () => {
    const { clock, editor, simulation } = rewinding();
    simulation.run();
    clock.frames(4);
    simulation.pause();
    simulation.rewindTo(ms(30));
    const { simulator, timeline } = simulation;
    const history = simulation.history.get();
    expect(history.behind).toBe(true);
    expect(editor.setTestScript('main', "bench('blinks', (b) => {});")).toBe(true);
    expect(simulation.simulator).toBe(simulator);
    expect(simulation.timeline).toBe(timeline);
    expect(simulation.history.get()).toEqual(history);
    expect(now(simulation)).toBe(ms(30));
    expect(simulation.rewindTo(ms(20))).toBe(true);
  });

  it('forgets the history on Stop and starts a new one at every power-on', () => {
    const { clock, simulation } = rewinding();
    simulation.run();
    clock.frames(3);
    simulation.stop();
    expect(simulation.timeline).toBeUndefined();
    expect(simulation.history.get()).toEqual({ start: 0, present: 0, behind: false });
    expect(simulation.rewindTo(0)).toBe(false);
    expect(simulation.stepBack()).toBe(false);
    simulation.run();
    clock.frames(2);
    simulation.reset();
    expect(simulation.timeline!.present.time).toBe(0);
  });
});
