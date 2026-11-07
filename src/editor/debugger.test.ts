import { describe, expect, it } from 'vitest';
import { addComponents, type Circuit, CircuitBuilder } from '../circuit';
import { Level, ns, us } from '../core';
import { createDefaultRegistry } from '../library';
import {
  cellsReference,
  EMPTY_DEBUG_SETUP,
  formatCells,
  parseDebugSetup,
  signalMembers,
  termText,
} from './debugger';
import { Editor } from './editor';
import { FakeClock } from './fake-clock';
import { MAX_SPEED, SPEEDS } from './simulation';

const registry = createDefaultRegistry();

/**
 * X1 at 1 MHz (rises at 0.5 µs, 1.5 µs, …, falls at 1 µs, 2 µs, …), X2 at 500 kHz (rises at
 * 1 µs, 3 µs, …); U1 an AT28C16 holding A5 5A at 0 and 3C at 5; U2 a 6116 (powers on X).
 */
function circuit(): Circuit {
  return new CircuitBuilder(registry)
    .add('X1', 'io/clock', { at: [0, 0], props: { frequency: 1e6 } })
    .add('X2', 'io/clock', { at: [0, 10], props: { frequency: 5e5 } })
    .add('U1', 'mem/at28c16', { at: [20, 0], props: { contents: '0000:A55A 0005:3C' } })
    .add('U2', 'mem/6116', { at: [50, 0] })
    .build();
}

function setup(c = circuit()) {
  const clock = new FakeClock();
  const editor = new Editor(registry, c, {}, { simulation: { clock } });
  const { debug, simulation } = editor;
  simulation.setSpeed(SPEEDS.find((s) => s.id === '1us')!); // 16 ns a frame
  return { clock, editor, debug, simulation };
}

/** Runs frames until the host pauses (a breakpoint); throws if it doesn't within `frames`. */
function untilPaused(s: ReturnType<typeof setup>, frames = 10_000) {
  if (s.simulation.state !== 'running') s.simulation.run();
  for (let i = 0; s.simulation.state === 'running'; i++) {
    if (i > frames) throw new Error(`still running at ${s.simulation.simulator!.now} ps`);
    s.clock.frame(16);
  }
  return s.simulation.simulator!.now;
}

describe('Debugger: breakpoints', () => {
  it('pauses at every instant the condition holds anew, with the reason', () => {
    const s = setup();
    const id = s.debug.addBreakpoint([{ signal: 'X1.Y', kind: 'rise' }]);
    expect(id).toBe(1);
    expect(untilPaused(s)).toBe(ns(500));
    expect(s.simulation.status.get().reason).toBe('Breakpoint 1: X1.Y ↑');
    expect(untilPaused(s)).toBe(ns(1500));
    expect(s.debug.breakpoints.get()[0]).toMatchObject({ text: 'X1.Y ↑', hits: 2 });
  });

  it('ANDs terms, reads a group as one value, and stops at every speed', () => {
    for (const speed of [SPEEDS[3]!, MAX_SPEED]) {
      const s = setup();
      s.simulation.setSpeed(speed);
      // Both high: from 1.5 µs (X1 rises while X2 is high), then from 3.5 µs.
      s.debug.addBreakpoint([{ signal: 'X1.Y X2.Y', kind: 'equal', value: '3' }]);
      s.clock.cost = speed === MAX_SPEED ? 1 : 0;
      expect(untilPaused(s)).toBe(ns(1500));
      expect(untilPaused(s)).toBe(ns(3500));
    }
    const s = setup();
    s.debug.addBreakpoint([
      { signal: 'X1.Y', kind: 'rise' },
      { signal: 'X2.Y', kind: 'level', level: Level.L0 },
    ]);
    expect(untilPaused(s)).toBe(ns(500));
    expect(untilPaused(s)).toBe(ns(2500));
  });

  it('stops from the n-th hit on; a disabled breakpoint neither stops nor counts', () => {
    const s = setup();
    const id = s.debug.addBreakpoint([{ signal: 'X1.Y', kind: 'fall' }], 3) as number;
    expect(untilPaused(s)).toBe(us(3));
    expect(untilPaused(s)).toBe(us(4));
    expect(s.debug.updateBreakpoint(id, { enabled: false })).toBeUndefined();
    s.simulation.run();
    s.clock.frames(200); // 3.2 µs
    expect(s.simulation.state).toBe('running');
    expect(s.debug.breakpoints.get()[0]!.hits).toBe(4);
    s.debug.enableAll(true);
    s.debug.updateBreakpoint(id, { hitCount: undefined });
    expect(untilPaused(s)).toBe(us(8));
    s.debug.removeBreakpoint(id);
    expect(s.debug.breakpoints.get()).toEqual([]);
  });

  it('counts hits since power-on: Reset starts over', () => {
    const s = setup();
    s.debug.addBreakpoint([{ signal: 'X1.Y', kind: 'rise' }], 2);
    expect(untilPaused(s)).toBe(ns(1500));
    s.simulation.reset();
    expect(s.debug.breakpoints.get()[0]!.hits).toBe(0);
    expect(untilPaused(s)).toBe(ns(1500));
  });

  it('refuses terms that name nothing; shows why a loaded one does not resolve', () => {
    const s = setup();
    expect(s.debug.addBreakpoint([{ signal: 'NOPE', kind: 'rise' }])).toBe(
      'no part or net named NOPE',
    );
    expect(s.debug.addBreakpoint([{ signal: 'X1.Y X2.Y', kind: 'rise' }])).toBe(
      'X1.Y X2.Y is a value: an edge or level needs one signal',
    );
    expect(
      s.debug.addBreakpoint([
        { signal: 'X1.Y', kind: 'rise' },
        { signal: 'X2.Y', kind: 'fall' },
      ]),
    ).toBe('only one term may be an edge');
    expect(s.debug.addBreakpoint([])).toBe('the trigger has no condition');
    s.debug.load({
      ...EMPTY_DEBUG_SETUP,
      breakpoints: [{ id: 4, terms: [{ signal: 'U9.Y', kind: 'rise' }], enabled: true }],
    });
    expect(s.debug.breakpoints.get()[0]!.problem).toBe('no part U9');
    expect(s.debug.addBreakpoint([{ signal: 'X1.Y', kind: 'rise' }])).toBe(5);
  });

  it('goes on after a structural edit while running, and follows part renames', () => {
    const s = setup();
    s.debug.addBreakpoint([{ signal: 'X1.Y', kind: 'rise' }]);
    s.debug.addWatch('X1.Y');
    s.debug.addWatch('U1[5]');
    expect(untilPaused(s)).toBe(ns(500));
    const { circuit: c } = s.editor.state.get();
    const more = new CircuitBuilder(registry).add('X9', 'io/clock', { at: [0, 30] }).build();
    s.editor.edit('Add X9', addComponents(c, more.components));
    expect(untilPaused(s)).toBe(ns(1500));
    s.editor.renamePart('X1', 'X3');
    s.editor.renamePart('U1', 'U7');
    const setupNow = s.debug.setup.get();
    expect(setupNow.breakpoints[0]!.terms[0]!.signal).toBe('X3.Y');
    expect(setupNow.watches.map((w) => (w.kind === 'cells' ? w.part : w.signal))).toEqual([
      'X3.Y',
      'U7',
    ]);
    expect(untilPaused(s)).toBe(ns(2500));
    expect(s.simulation.status.get().reason).toBe('Breakpoint 1: X3.Y ↑');
  });
});

describe('Debugger: breaking on errors and warnings', () => {
  /** SW1 and SW2 drive one net: a fight once they differ; U1's input floats. */
  function fight(): Circuit {
    return new CircuitBuilder(registry)
      .add('SW1', 'io/switch', { at: [0, 0] })
      .add('SW2', 'io/switch', { at: [0, 10] })
      .connect('SW1.Y', 'SW2.Y', [8, 1], [8, 11])
      .add('U1', 'prim/not', { at: [20, 20] })
      .build();
  }

  it('pauses at each error occurrence when asked to', () => {
    const s = setup(fight());
    s.debug.setBreakOn({ errors: true });
    s.simulation.run();
    s.clock.frames(2);
    expect(s.simulation.state).toBe('running'); // a floating input is only a warning
    s.simulation.action('SW1', { type: 'toggle' });
    expect(untilPaused(s)).toBeGreaterThan(0);
    expect(s.simulation.status.get().reason).toMatch(/^Error: bus contention on net /);
    s.simulation.action('SW1', { type: 'toggle' }); // cleared
    s.simulation.run();
    s.clock.frames(2);
    s.simulation.action('SW1', { type: 'toggle' }); // again: a merged repeat
    untilPaused(s);
    expect(s.simulation.status.get().reason).toMatch(/^Error: bus contention/);
  });

  it('pauses at a warning when asked to, here at power-on', () => {
    const s = setup(fight());
    s.debug.setBreakOn({ warnings: true });
    s.simulation.run();
    expect(untilPaused(s)).toBe(0);
    expect(s.simulation.status.get().reason).toMatch(/^Warning: floating input: U1\.A/);
    s.debug.setBreakOn({ warnings: false });
    s.simulation.run();
    s.clock.frames(3);
    expect(s.simulation.state).toBe('running');
  });
});

describe('Debugger: steps', () => {
  it('Step Clock steps by the default clock: the net CLK, else the first clock part', () => {
    const s = setup();
    expect(s.debug.defaultClock()).toBe('X1.Y');
    expect(s.debug.stepClock()).toBeUndefined();
    const sim = s.simulation.simulator!;
    expect(s.simulation.state).toBe('paused');
    expect(sim.nextEventTime).toBe(ns(500));
    expect(s.simulation.status.get().reason).toBe('Step Clock (X1.Y ↑)');
    s.debug.stepClock();
    expect(sim.nextEventTime).toBe(ns(1500));
    expect(s.debug.setClock('X2.Y', 'fall')).toBeUndefined();
    s.debug.stepClock();
    expect(sim.nextEventTime).toBe(us(2)); // X2 falls at 2 µs
    expect(s.simulation.status.get().reason).toBe('Step Clock (X2.Y ↓)');
    expect(s.debug.setClock('NOPE')).toBe('no part or net named NOPE');
    expect(s.debug.setClock('X1.Y X2.Y')).toBe('The step clock is one signal.');
    expect(s.debug.setClock(undefined)).toBeUndefined();
    expect(s.debug.clock()).toMatchObject({ signal: 'X1.Y' });
  });

  it('Step Clock on a manual clock gives it one pulse and lets the circuit settle', () => {
    const s = setup(
      new CircuitBuilder(registry)
        .add('X1', 'io/clock', { at: [0, 0], props: { frequency: 1e6, mode: 'manual' } })
        .add('U1', 'prim/not', { at: [10, 0] })
        .connect('X1.Y', 'U1.A')
        .build(),
    );
    s.debug.addBreakpoint([{ signal: 'U1.Y', kind: 'fall' }], 99);
    expect(s.debug.stepClock()).toBeUndefined(); // from stopped: power-on and the low time
    expect(s.simulation.status.get().reason).toBe('Step Clock (X1 pulse)');
    expect(s.simulation.simulator!.now).toBe(ns(500));
    expect(s.debug.breakpoints.get()[0]!.hits).toBe(0);
    s.debug.stepClock(); // a pulse, high 500 ns then low 500 ns
    expect(s.simulation.simulator!.now).toBe(ns(1500));
    expect(s.debug.breakpoints.get()[0]!.hits).toBe(1);
    s.debug.stepClock();
    expect(s.debug.breakpoints.get()[0]!.hits).toBe(2);
    expect(s.simulation.diagnostics.get().map((d) => d.kind)).not.toContain(
      'pulse-width-violation',
    );
  });

  it('Step Clock on a manual clock stops at the press when the press breaks the run', () => {
    const s = setup(
      new CircuitBuilder(registry)
        .add('X1', 'io/clock', { at: [0, 0], props: { frequency: 1e6, mode: 'manual' } })
        .build(),
    );
    s.debug.stepClock(); // power-on and the low time: 500 ns
    s.debug.addBreakpoint([{ signal: 'X1.Y', kind: 'rise' }]);
    const breaks = s.simulation.breaks;
    s.debug.stepClock();
    expect(s.simulation.breaks).toBe(breaks + 1);
    expect(s.simulation.simulator!.now).toBe(ns(500));
    expect(s.simulation.status.get()).toMatchObject({
      state: 'paused',
      reason: 'Breakpoint 1: X1.Y ↑',
    });
  });

  it('says why there is no clock to step by', () => {
    const s = setup(new CircuitBuilder(registry).add('SW1', 'io/switch', { at: [0, 0] }).build());
    expect(s.debug.defaultClock()).toBeUndefined();
    expect(s.debug.stepClock()).toBe(
      'No clock to step by: name a net CLK or choose the step clock.',
    );
  });

  it('runs for its duration or to a time, and stops at a breakpoint on the way', () => {
    const s = setup();
    s.debug.setRunFor(ns(700));
    expect(s.debug.runFor()).toBeUndefined();
    expect(s.simulation.simulator!.now).toBe(ns(700));
    expect(s.simulation.status.get().reason).toBe('Run For 700 ns');
    expect(s.debug.runToTime(ns(100))).toBe('The simulation is at 700 ns already.');
    s.debug.addBreakpoint([{ signal: 'X2.Y', kind: 'rise' }]);
    s.debug.runToTime(us(5));
    expect(s.simulation.simulator!.now).toBe(us(1));
    expect(s.simulation.status.get().reason).toBe('Breakpoint 1: X2.Y ↑');
  });
});

describe('Debugger: watches', () => {
  it('shows signals, groups and memory cells; refuses what names nothing', () => {
    const s = setup();
    for (const text of ['X1.Y', 'X1.Y X2.Y', 'U1[0..1]', 'U1[5]', 'U2[0]']) {
      expect(s.debug.addWatch(text)).toBeUndefined();
    }
    expect(s.debug.addWatch('X1.Y')).toBe('X1.Y is watched already.');
    expect(s.debug.addWatch('U1[0..10]')).toBe('Watch at most 16 cells.');
    expect(s.debug.addWatch('U1')).toBe('U1 is a part: probe one of its pins');
    expect(s.debug.addWatch(' ')).toBe('Type a signal or memory cells (U5[1F]).');
    const values = () => s.debug.watches.get().map((w) => [w.label, w.value]);
    expect(s.debug.watches.get().map((w) => w.vector)).toEqual([false, true, true, true, true]);
    // Stopped: a ROM shows its image, the rest nothing yet.
    expect(values()).toEqual([
      ['X1.Y', ''],
      ['X1.Y X2.Y', ''],
      ['U1[0x00..0x01]', 'A5 5A'],
      ['U1[0x05]', '0x3C'],
      ['U2[0x00]', ''],
    ]);
    s.debug.runFor(us(1.2)); // X1 0 since 1 µs, X2 1 since 1 µs
    expect(values()).toEqual([
      ['X1.Y', '0'],
      ['X1.Y X2.Y', '0x2'],
      ['U1[0x00..0x01]', 'A5 5A'],
      ['U1[0x05]', '0x3C'],
      ['U2[0x00]', '0xXX'],
    ]);
    s.debug.updateWatch(2, { radix: 'dec', name: 'table' });
    s.debug.updateWatch(1, { radix: 'bin' });
    expect(values()[2]).toEqual(['table', '165 90']);
    expect(values()[1]).toEqual(['X1.Y X2.Y', '10']);
    s.debug.updateWatch(2, { name: '' });
    expect(values()[2]![0]).toBe('U1[0x00..0x01]');
    s.debug.removeWatch(0);
    expect(values()).toHaveLength(4);
  });

  it('marks what changed since the last stop', () => {
    const s = setup();
    s.debug.addWatch('X2.Y');
    s.debug.addWatch('U2[1]');
    const marks = () => s.debug.watches.get().map((w) => `${w.value}${w.changed ? '*' : ''}`);
    s.debug.setRunFor(ns(500));
    s.debug.runToTime(ns(250));
    expect(marks()).toEqual(['0', '0xXX']); // the first stop: nothing to compare with
    s.debug.runFor(); // 750 ns
    expect(marks()).toEqual(['0', '0xXX']);
    s.debug.runFor(); // 1250 ns: X2 rose at 1 µs
    expect(marks()).toEqual(['1*', '0xXX']);
    s.editor.memory.write('U2', 1, [0x42]); // a debug write while paused, against the stop before
    expect(marks()).toEqual(['1*', '0x42*']);
    s.debug.runFor(); // 1750 ns: the cell changed since the last stop
    expect(marks()).toEqual(['1', '0x42*']);
    s.debug.runFor(); // 2250 ns: X2 fell at 2 µs
    expect(marks()).toEqual(['0*', '0x42']);
  });
});

describe('Debugger: statistics', () => {
  it('counts since power-on and for the last run, with the wall time running', () => {
    const s = setup();
    s.simulation.run();
    s.clock.frames(10); // 160 ns in 160 ms
    s.simulation.pause();
    const first = s.debug.stats();
    expect(first.total.time).toBe(ns(160));
    expect(first.total.wall).toBeGreaterThanOrEqual(160);
    expect(first.total.events).toBeGreaterThan(0);
    s.simulation.run();
    s.clock.frames(5);
    s.simulation.pause();
    const { total, last } = s.debug.stats();
    expect(total.time).toBe(ns(240));
    expect(last.time).toBe(ns(80));
    expect(last.wall).toBeLessThan(total.wall);
    expect(last.events).toBe(total.events - first.total.events);
  });

  it('measures each net’s activity on request, across a structural edit', () => {
    const s = setup();
    s.simulation.setSpeed(MAX_SPEED);
    s.clock.cost = 1;
    s.debug.runToTime(us(2));
    s.debug.measureActivity(true);
    expect(s.debug.measuring).toBe(true);
    expect(s.debug.activityFrom).toBe(us(2));
    s.debug.runToTime(us(6));
    const { circuit: c } = s.editor.state.get();
    const more = new CircuitBuilder(registry).add('X9', 'io/clock', { at: [0, 30] }).build();
    s.editor.edit('Add X9', addComponents(c, more.components));
    s.debug.runToTime(us(12));
    const top = s.debug.activity(2);
    expect(top.map((a) => [a.net, a.changes])).toEqual([
      ['X1.Y', 20],
      ['X2.Y', 10],
    ]);
    expect(top[0]!.frequency).toBeCloseTo(1e6);
    s.debug.measureActivity(false);
    expect(s.debug.activity()).toEqual([]);
  });
});

describe('reading a stored setup', () => {
  it('keeps what has the expected shape and leaves the rest out', () => {
    expect(parseDebugSetup(undefined)).toBeUndefined();
    expect(parseDebugSetup('x')).toBeUndefined();
    expect(parseDebugSetup({})).toEqual(EMPTY_DEBUG_SETUP);
    const setup = parseDebugSetup({
      breakpoints: [
        { id: 1, terms: [{ signal: 'CLK', kind: 'rise' }], enabled: false, hitCount: 3 },
        { id: 2, terms: [{ signal: 'CLK', kind: 'jump' }] }, // unknown kind: dropped
        { id: 'x', terms: [] },
        { id: 3, terms: [{ signal: 'Q', kind: 'level', level: 1 }] },
      ],
      watches: [
        { kind: 'signal', signal: 'D[0..7]', radix: 'dec', name: 'data' },
        { kind: 'cells', part: 'U5', from: 16, to: 31, radix: 'octal' },
        { kind: 'cells', part: 'U5', from: 'a' },
        null,
      ],
      clock: 'CLK',
      edge: 'fall',
      runFor: -5,
      breakOnErrors: true,
      breakOnWarnings: 'yes',
    })!;
    expect(setup).toEqual({
      breakpoints: [
        { id: 1, terms: [{ signal: 'CLK', kind: 'rise' }], enabled: false, hitCount: 3 },
        { id: 3, terms: [{ signal: 'Q', kind: 'level', level: 1 }], enabled: true },
      ],
      watches: [
        { kind: 'signal', signal: 'D[0..7]', name: 'data', radix: 'dec' },
        { kind: 'cells', part: 'U5', from: 16, to: 31 },
      ],
      clock: 'CLK',
      edge: 'fall',
      runFor: EMPTY_DEBUG_SETUP.runFor,
      breakOnErrors: true,
      breakOnWarnings: false,
    });
  });
});

describe('debugger text', () => {
  it('writes terms, cells and members', () => {
    expect(termText({ signal: 'CLK', kind: 'rise' })).toBe('CLK ↑');
    expect(termText({ signal: 'CLK', kind: 'edge' })).toBe('CLK ↕');
    expect(termText({ signal: 'Q', kind: 'level', level: Level.X })).toBe('Q = X');
    expect(termText({ signal: 'D[0..7]', kind: 'notEqual', value: '2b' })).toBe('D[0..7] ≠ 2B');
    expect(cellsReference('U5', 0x1f, 0x1f)).toBe('U5[0x1F]');
    expect(cellsReference('U5', 0x100, 0x10f)).toBe('U5[0x100..0x10F]');
    expect(signalMembers(' U3.Q0, U3.Q1  U3.Q2 ')).toEqual(['U3.Q0', 'U3.Q1', 'U3.Q2']);
    const data = [0x41, 0x3f];
    expect(formatCells(data, [0, 0xf0], 8, 'hex')).toBe('41 XF');
    expect(formatCells(data, [0, 0], 8, 'ascii')).toBe('A?');
    expect(formatCells(data, [0, 1], 8, 'dec')).toBe('65 X');
    expect(formatCells([5], [0], 4, 'bin')).toBe('0101');
  });
});
