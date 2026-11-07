import { describe, expect, it } from 'vitest';
import {
  type Level,
  levelChar,
  type Netlist,
  NetlistBuilder,
  ns,
  Simulator,
  type Time,
  us,
} from '../core';
import { createDefaultRegistry } from '../library';
import { comparePositions, Timeline, type TimelinePosition } from './timeline';

const registry = createDefaultRegistry();

/**
 * A 10 MHz clock into a 74HC161 counter cleared by SW1 (MR, active low), SW2 on CEP; BT1
 * clocks a second one, U2, so even a pulse within one instant counts.
 */
function counter(): Netlist {
  return new NetlistBuilder()
    .add('X1', 'io/clock', { frequency: 10e6 })
    .add('U1', '74xx/74hc161')
    .add('SW1', 'io/switch')
    .add('SW2', 'io/switch')
    .add('BT1', 'io/button')
    .add('V1', 'io/vcc')
    .connect('X1.Y', 'U1.CP')
    .connect('SW1.Y', 'U1.MR')
    .connect('SW2.Y', 'U1.CEP')
    .connect('V1.Y', 'U1.CET', 'U1.PE')
    .add('U2', '74xx/74hc161')
    .connect('BT1.Y', 'U2.CP')
    .connect('V1.Y', 'U2.MR', 'U2.CEP', 'U2.CET', 'U2.PE')
    .build();
}

const COUNT = ['U1.Q0', 'U1.Q1', 'U1.Q2', 'U1.Q3'];
/** The levels and what is still to come: the queue's head and the events so far. */
const levels = (sim: Simulator) =>
  `${Array.from(sim.levels, (l) => levelChar(l as Level)).join('')} ${sim.nextEventTime} ${sim.stats.events}`;

/** An action at a time, as the host delivers it (after running to the time). */
interface Act {
  readonly time: Time;
  readonly component: string;
  readonly payload: unknown;
  /** Delivered right after the previous act, without a run between them. */
  readonly sameFrame?: boolean;
}

const ACTS: readonly Act[] = [
  { time: us(1), component: 'SW1', payload: { type: 'toggle' } }, // MR high: counting
  { time: us(1), component: 'SW2', payload: { type: 'toggle' }, sameFrame: true }, // CEP high
  { time: us(3), component: 'SW2', payload: { type: 'toggle' } }, // stop counting
  { time: us(4), component: 'SW2', payload: { type: 'toggle' } },
  { time: us(5), component: 'BT1', payload: { type: 'press' } },
  { time: us(5), component: 'BT1', payload: { type: 'release' }, sameFrame: true },
  { time: us(6), component: 'BT1', payload: { type: 'press' } },
  { time: us(6), component: 'BT1', payload: { type: 'release' } }, // a run between: a pulse
];

/**
 * Runs a live simulator with a timeline as the host would — kernel calls in chunks of `chunk`,
 * `ran()` after each, actions with `acted` — until `end`. Also returns the levels a plain run
 * had at every chunk end and act, by position.
 */
function liveRun(end: Time, options: { interval?: number; budget?: number; chunk?: Time } = {}) {
  const netlist = counter();
  const sim = new Simulator(netlist, registry);
  const timeline = new Timeline(sim, { interval: options.interval ?? 40, ...options });
  const chunk = options.chunk ?? ns(250);
  const states = new Map<string, string>();
  const key = (p: TimelinePosition) => `${p.time}/${p.actions}`;
  let next = 0;
  for (let t = chunk; t <= end; t += chunk) {
    while (next < ACTS.length && ACTS[next]!.time <= t) {
      const act = ACTS[next]!;
      if (!act.sameFrame) {
        sim.runUntil(act.time);
        timeline.ran();
      }
      sim.action(act.component, act.payload);
      timeline.acted(act.component, act.payload);
      next++;
    }
    sim.runUntil(t);
    timeline.ran();
    states.set(key(timeline.position), levels(sim));
  }
  return { netlist, sim, timeline, states, key };
}

describe('Timeline', () => {
  it('reaches any chunk end again exactly, through actions in and between frames', () => {
    const { sim, timeline, states } = liveRun(us(8));
    expect(timeline.checkpointCount).toBeGreaterThan(5);
    expect(timeline.actions).toHaveLength(ACTS.length);
    expect(timeline.actions.map((a) => a.afterRun)).toEqual([
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      true,
    ]);
    const heard: number[] = [];
    sim.onNetChange((t) => heard.push(t));
    for (const [position, expected] of [...states].reverse()) {
      const [time, actions] = position.split('/').map(Number) as [number, number];
      timeline.reach({ time, actions });
      expect(levels(sim), position).toBe(expected);
      expect(sim.now).toBe(time);
      expect(timeline.position).toEqual({ time, actions });
    }
    expect(heard).toEqual([]); // replays run in the replica
  });

  it('counts while MR and CEP are high: the actions really happen', () => {
    const { sim, timeline } = liveRun(us(8));
    const count = () => COUNT.map((pin) => levelChar(sim.level(pin))).join('');
    expect(timeline.asEnded(us(3)).actions).toBe(3);
    expect(timeline.asEnded(us(3) - 1).actions).toBe(2);
    timeline.reach(timeline.asEnded(us(3)));
    expect(count()).not.toBe('XXXX');
    const atThree = count();
    timeline.reach(timeline.asEnded(us(3.5)));
    expect(count()).toBe(atThree); // CEP low: holds
    timeline.reach(timeline.asEnded(us(2)));
    expect(count()).not.toBe(atThree);
  });

  it('knows the present, and the actions a forward run must deliver again', () => {
    const { sim, timeline } = liveRun(us(8));
    expect(timeline.present).toEqual({ time: us(8), actions: ACTS.length });
    expect(timeline.hasFuture).toBe(false);
    const straight = levels(sim);
    timeline.reach(timeline.asEnded(us(2.5)));
    expect(timeline.hasFuture).toBe(true);
    expect(timeline.pending).toMatchObject({ time: us(3), component: 'SW2' });
    expect(timeline.applyPending()).toBe(false); // not due yet
    // Forward, as the host does: up to each pending action's instant, deliver it (those of one
    // frame back to back), on to the end.
    for (let action = timeline.pending; action; action = timeline.pending) {
      if (sim.now < action.time) {
        sim.runUntil(action.time);
        timeline.ran();
      }
      expect(timeline.applyPending()).toBe(true);
    }
    const count = timeline.checkpointCount;
    sim.runUntil(us(8));
    timeline.ran();
    expect(timeline.checkpointCount).toBe(count); // behind the present the old ones hold
    expect(levels(sim)).toBe(straight);
    expect(timeline.hasFuture).toBe(false);
    sim.runUntil(us(12));
    timeline.ran();
    expect(timeline.present.time).toBe(us(12));
    expect(timeline.checkpointCount).toBeGreaterThan(count);
  });

  it('acting behind the present starts a new future', () => {
    const { sim, timeline } = liveRun(us(8));
    const count = timeline.checkpointCount;
    timeline.reach(timeline.asEnded(us(3.5)));
    sim.action('SW1', { type: 'toggle' });
    timeline.acted('SW1', { type: 'toggle' });
    expect(timeline.actions.map((a) => a.time)).toEqual([us(1), us(1), us(3), us(3.5)]);
    expect(timeline.actions.at(-1)?.afterRun).toBe(true);
    expect(timeline.present).toEqual({ time: us(3.5), actions: 4 });
    expect(timeline.hasFuture).toBe(false);
    expect(timeline.checkpointCount).toBeLessThan(count);
    // The new future replays as it happened.
    sim.runUntil(us(5));
    timeline.ran();
    const atFive = levels(sim);
    sim.runUntil(us(6));
    timeline.ran();
    timeline.reach(timeline.asEnded(us(5)));
    expect(levels(sim)).toBe(atFive);
  });

  it('an action right after a replayed one, without a run, replays back to back', () => {
    const { sim, timeline } = liveRun(us(8));
    timeline.reach(timeline.asEnded(us(4.9)));
    sim.runUntil(us(5));
    timeline.ran();
    expect(timeline.applyPending()).toBe(true); // the press at 5 µs
    sim.action('BT1', { type: 'release' });
    timeline.acted('BT1', { type: 'release' }); // instead of the recorded release
    expect(timeline.actions.at(-1)).toMatchObject({ time: us(5), afterRun: false });
    expect(timeline.actions).toHaveLength(6);
    sim.runUntil(us(5.5));
    timeline.ran();
    const after = levels(sim);
    timeline.reach(timeline.asEnded(us(4)));
    timeline.reach(timeline.asEnded(us(5.5)));
    expect(levels(sim)).toBe(after);
  });

  it('stays within its budget: thins the older half, then the start moves on', () => {
    const { timeline } = liveRun(us(40), { interval: 20, budget: 40_000 });
    expect(timeline.bytes).toBeLessThanOrEqual(40_000);
    expect(timeline.start).toBeGreaterThan(0);
    const start = timeline.start;
    expect(timeline.reachable({ time: start - 1, actions: 0 })).toBe(false);
    expect(() => timeline.reach({ time: start - 1, actions: 0 })).toThrow(/out of reach/);
    expect(timeline.reachable(timeline.asEnded(us(39)))).toBe(true);
  });

  it('reaches as far back as its start after thinning, exactly', () => {
    const plain = liveRun(us(40), { interval: 20 });
    const thin = liveRun(us(40), { interval: 20, budget: 120_000 });
    expect(thin.timeline.checkpointCount).toBeLessThan(plain.timeline.checkpointCount);
    for (const [position, expected] of thin.states) {
      const [time, actions] = position.split('/').map(Number) as [number, number];
      if (!thin.timeline.reachable({ time, actions })) continue;
      thin.timeline.reach({ time, actions });
      expect(levels(thin.sim), position).toBe(expected);
    }
  });

  it('replays segments newest first for backward searches, with positions', () => {
    const { timeline } = liveRun(us(8));
    const before = timeline.asEnded(us(6.5));
    const segments = timeline.segmentsBefore(before);
    expect(segments[0]!.end).toEqual(before);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.end).toEqual(segments[i - 1]!.start);
    }
    expect(segments.at(-1)!.start).toEqual({ time: 0, actions: 0 });
    const instants: TimelinePosition[] = [];
    for (const segment of segments) {
      timeline.replaySegment(segment, (sim, at) => sim.onInstant((t) => instants.push(at(t))));
    }
    instants.sort(comparePositions);
    expect(instants[0]).toEqual({ time: 0, actions: 0 });
    expect(instants.at(-1)!.time).toBeLessThanOrEqual(us(6.5));
    // The press at 6 µs is counted once delivered.
    const atSix = instants.filter((p) => p.time === us(6));
    expect(atSix.map((p) => p.actions)).toContain(7);
  });
});
