import { describe, expect, it } from 'vitest';
import { defineComponent } from './component';
import { and, Drive, Level, levelChar, not, strong } from './logic';
import { NetlistBuilder } from './netlist';
import { NO_DATA, Recorder } from './recorder';
import { Registry } from './registry';
import { Simulator } from './simulator';
import { Trace } from './testing';
import { ns } from './time';

/** Toggles every `half` from 0 at t = 0. */
const clock = defineComponent<{ half: number }, { level: Level }>({
  type: 'test/clock',
  name: 'CLK',
  title: 'Clock',
  pins: [{ name: 'Y', dir: 'out' }],
  props: [{ key: 'half', label: 'Half period', type: 'time', default: ns(10) }],
  create: ({ half }) => ({
    createState: () => ({ level: Level.L0 }),
    init(ctx) {
      ctx.drive(0, Drive.STRONG_0, 0);
      ctx.wakeAfter(half);
    },
    wake(ctx) {
      ctx.state.level = not(ctx.state.level);
      ctx.drive(0, strong(ctx.state.level), 0);
      ctx.wakeAfter(half);
    },
  }),
});

/** Driven from outside: `sim.action(id, drive)`, at once. */
const source = defineComponent({
  type: 'test/source',
  name: 'S',
  title: 'Source',
  pins: [{ name: 'Y', dir: 'tristate' }],
  create: () => ({
    action(ctx, payload) {
      ctx.drive(0, payload as Drive, 0);
    },
  }),
});

const inverter = defineComponent({
  type: 'test/inv',
  name: 'INV',
  title: 'Inverter',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'Y', dir: 'out' },
  ],
  create: () => ({
    evaluate(ctx) {
      ctx.drive(1, strong(not(ctx.read(0))), 0);
    },
  }),
});

const andGate = defineComponent({
  type: 'test/and',
  name: 'AND',
  title: 'And',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'B', dir: 'in' },
    { name: 'Y', dir: 'out' },
  ],
  create: () => ({
    evaluate(ctx) {
      ctx.drive(2, strong(and(ctx.read(0), ctx.read(1))), 0);
    },
  }),
});

const registry = new Registry([clock, source, inverter, andGate]);

/** A clock on `CLK` (half period 10 ns) and a source on `S`. */
const circuit = (extra?: (b: NetlistBuilder) => NetlistBuilder) => {
  const b = new NetlistBuilder().add('C', 'test/clock').net('CLK', 'C.Y').add('S', 'test/source');
  b.net('SRC', 'S.Y');
  return (extra ? extra(b) : b).build();
};

/** The channel's changes as `time:level` text (`0:0 10000:1 …`; `-` for no data). */
const changes = (recorder: Recorder, channel: number) => {
  const out: string[] = [];
  for (let i = 0; i < recorder.changeCount(channel); i++) {
    const level = recorder.changeLevel(channel, i);
    out.push(
      `${recorder.changeTime(channel, i) / 1000}:${level === NO_DATA ? '-' : levelChar(level as Level)}`,
    );
  }
  return out.join(' ');
};

describe('Recorder', () => {
  it('records the level at attach and every change after it', () => {
    const sim = new Simulator(circuit(), registry);
    const recorder = new Recorder();
    const clk = recorder.addChannel();
    recorder.attach(sim, new Map([[clk, sim.netIndex('CLK')]]));
    sim.runUntil(ns(35));
    // Power-on X, then 0 at t = 0 collapse into the instant's last level.
    expect(changes(recorder, clk)).toBe('0:0 10:1 20:0 30:1');
    expect(recorder.size).toBe(4);
    expect(recorder.end).toBe(ns(35));
  });

  it('collapses an instant into its last level: a glitch within one instant leaves nothing', () => {
    // Y = A AND NOT A with zero delays: when A rises, Y is 1 for one delta cycle.
    const netlist = circuit((b) =>
      b
        .add('I', 'test/inv')
        .add('G', 'test/and')
        .connect('S.Y', 'I.A')
        .connect('S.Y', 'G.A')
        .connect('I.Y', 'G.B')
        .net('Y', 'G.Y'),
    );
    const sim = new Simulator(netlist, registry);
    const recorder = new Recorder();
    const y = recorder.addChannel();
    const src = recorder.addChannel();
    recorder.attach(
      sim,
      new Map([
        [y, sim.netIndex('Y')],
        [src, sim.netIndex('SRC')],
      ]),
    );
    sim.action('S', Drive.STRONG_0);
    sim.runUntil(ns(5));
    const trace = new Trace(sim);
    sim.action('S', Drive.STRONG_1);
    sim.runUntil(ns(10));
    expect(trace.of('Y').map(([, level]) => levelChar(level))).toEqual(['1', '0']); // it did glitch
    expect(changes(recorder, y)).toBe('0:0');
    expect(changes(recorder, src)).toBe('0:0 5:1');
  });

  it('answers levels and neighbouring changes by time', () => {
    const sim = new Simulator(circuit(), registry);
    const recorder = new Recorder();
    const clk = recorder.addChannel();
    const src = recorder.addChannel();
    recorder.attach(
      sim,
      new Map([
        [clk, sim.netIndex('CLK')],
        [src, sim.netIndex('SRC')],
      ]),
    );
    sim.runUntil(ns(15));
    sim.action('S', Drive.STRONG_1);
    sim.runUntil(ns(45));
    expect(recorder.level(clk, ns(9))).toBe(Level.L0);
    expect(recorder.level(clk, ns(10))).toBe(Level.L1);
    expect(recorder.level(clk, ns(45))).toBe(Level.L0); // the edge at 40 ns
    expect(recorder.level(clk, ns(46))).toBeUndefined(); // after the end
    expect(recorder.level(src, ns(14))).toBe(Level.Z);
    expect(recorder.indexAt(clk, ns(25))).toBe(2);
    expect(recorder.nextChange(clk, ns(10))).toBe(ns(20));
    expect(recorder.nextChange(clk, ns(40))).toBeUndefined();
    expect(recorder.prevChange(clk, ns(20))).toBe(ns(10));
    expect(recorder.prevChange(clk, 0)).toBeUndefined();
    expect(recorder.nextChangeOf([clk, src], ns(10))).toBe(ns(15));
    expect(recorder.prevChangeOf([clk, src], ns(19))).toBe(ns(15));
    expect(recorder.nextChangeOf([], 0)).toBeUndefined();
  });

  it('records one net into several channels; a channel without a net records nothing', () => {
    const sim = new Simulator(circuit(), registry);
    const recorder = new Recorder();
    const a = recorder.addChannel();
    const b = recorder.addChannel();
    const none = recorder.addChannel();
    const net = sim.netIndex('CLK');
    recorder.attach(
      sim,
      new Map([
        [a, net],
        [b, net],
      ]),
    );
    sim.runUntil(ns(20));
    expect(changes(recorder, a)).toBe('0:0 10:1 20:0');
    expect(changes(recorder, b)).toBe(changes(recorder, a));
    expect(changes(recorder, none)).toBe('');
    expect(recorder.level(none, ns(5))).toBeUndefined();
    expect(recorder.channels).toEqual([a, b, none]);
  });

  it('goes on in a carried-over simulator, by the nets the caller re-resolves', () => {
    const sim = new Simulator(circuit(), registry);
    const recorder = new Recorder();
    const clk = recorder.addChannel();
    const src = recorder.addChannel();
    recorder.attach(
      sim,
      new Map([
        [clk, sim.netIndex('CLK')],
        [src, sim.netIndex('SRC')],
      ]),
    );
    sim.runUntil(ns(15));
    // An edit adds a part, which renumbers the nets, and removes the source's net name.
    const edited = new NetlistBuilder()
      .add('A', 'test/source')
      .net('OTHER', 'A.Y')
      .add('C', 'test/clock')
      .net('CLK', 'C.Y')
      .add('S', 'test/source')
      .build();
    const next = new Simulator(edited, registry, { carry: sim.carryOver() });
    expect(next.netIndex('CLK')).not.toBe(sim.netIndex('CLK'));
    recorder.attach(next, new Map([[clk, next.netIndex('CLK')]]));
    next.runUntil(ns(35));
    expect(changes(recorder, clk)).toBe('0:0 10:1 20:0 30:1');
    expect(changes(recorder, src)).toBe('0:Z 15:-');
    expect(recorder.level(src, ns(16))).toBeUndefined();
    // The source's net comes back: its record resumes.
    recorder.attachChannel(src, next.pinNet('S', 'Y'));
    next.action('S', Drive.STRONG_1);
    next.runUntil(ns(40));
    expect(changes(recorder, src)).toBe('0:Z 15:- 35:1');
  });

  it('starts a channel added while running at that instant, and stops one removed', () => {
    const sim = new Simulator(circuit(), registry);
    const recorder = new Recorder();
    const clk = recorder.addChannel();
    recorder.attach(sim, new Map([[clk, sim.netIndex('CLK')]]));
    sim.runUntil(ns(15));
    const late = recorder.addChannel();
    recorder.attachChannel(late, sim.netIndex('CLK'));
    sim.runUntil(ns(25));
    // Its first level goes 1 ps before the instant: what goes into the rest of the instant.
    expect(changes(recorder, late)).toBe('14.999:1 20:0');
    recorder.removeChannel(clk);
    sim.runUntil(ns(35));
    expect(changes(recorder, late)).toBe('14.999:1 20:0 30:1');
    expect(recorder.channels).toEqual([late]);
    expect(recorder.size).toBe(3);
    expect(() => recorder.changeTime(clk, 0)).toThrow('recorder: no channel 0');
  });

  it('keeps a change made at the instant a channel was added apart from its first level', () => {
    const sim = new Simulator(circuit(), registry);
    sim.runUntil(ns(5)); // paused at 5 ns, the source floating
    const recorder = new Recorder();
    const src = recorder.addChannel();
    recorder.attach(sim, new Map([[src, sim.pinNet('S', 'Y')]]));
    sim.action('S', Drive.STRONG_1); // at the same instant, as a click while paused
    sim.runUntil(sim.now);
    expect(changes(recorder, src)).toBe('4.999:Z 5:1');
    expect(recorder.level(src, ns(5) - 1)).toBe(Level.Z);
  });

  it('listens to one simulator at a time', () => {
    const first = new Simulator(circuit(), registry);
    const second = new Simulator(circuit(), registry);
    const recorder = new Recorder();
    const clk = recorder.addChannel();
    recorder.attach(first, new Map([[clk, first.netIndex('CLK')]]));
    recorder.attach(second, new Map([[clk, second.netIndex('CLK')]]));
    first.runUntil(ns(25));
    expect(changes(recorder, clk)).toBe('0:X');
  });

  it('ends at the instant it was detached; clear forgets everything and detaches', () => {
    const sim = new Simulator(circuit(), registry);
    const recorder = new Recorder();
    const clk = recorder.addChannel();
    recorder.attach(sim, new Map([[clk, sim.netIndex('CLK')]]));
    sim.runUntil(ns(25));
    recorder.detach();
    sim.runUntil(ns(45));
    expect(recorder.attached).toBe(false);
    expect(recorder.end).toBe(ns(25));
    expect(changes(recorder, clk)).toBe('0:0 10:1 20:0');
    expect(recorder.level(clk, ns(25))).toBe(Level.L0);
    expect(recorder.level(clk, ns(30))).toBeUndefined();

    recorder.attach(sim, new Map([[clk, sim.netIndex('CLK')]]));
    recorder.clear();
    expect(recorder.attached).toBe(false);
    expect(recorder.size).toBe(0);
    expect(recorder.end).toBe(0);
    expect(changes(recorder, clk)).toBe('');
  });

  it('keeps to its budget: drops the oldest changes and moves its start forward', () => {
    const sim = new Simulator(circuit(), registry);
    const recorder = new Recorder({ budget: 16 });
    const clk = recorder.addChannel();
    const src = recorder.addChannel();
    recorder.attach(
      sim,
      new Map([
        [clk, sim.netIndex('CLK')],
        [src, sim.netIndex('SRC')],
      ]),
    );
    sim.action('S', Drive.STRONG_1);
    sim.runUntil(ns(1000)); // 101 clock changes
    expect(recorder.size).toBeLessThanOrEqual(16);
    expect(recorder.dropped).toBe(102 - recorder.size);
    expect(recorder.start).toBeGreaterThan(0);
    expect(recorder.level(clk, recorder.start - 1)).toBeUndefined();
    // Every channel still knows its level at the start: the slow source kept its one change.
    expect(recorder.level(src, recorder.start)).toBe(Level.L1);
    const start = recorder.start;
    expect(recorder.level(clk, start)).toBe(Math.floor(start / ns(10)) % 2 ? Level.L1 : Level.L0);
    expect(recorder.prevChange(clk, start)).toBeUndefined();
    expect(recorder.nextChange(clk, 0)).toBe(Math.ceil((start + 1) / ns(10)) * ns(10));
    expect(changes(recorder, clk).split(' ').at(-1)).toBe('1000:0');
  });
});

describe('Recorder across a rewind', () => {
  /** A clock and a glitching gate (Y = SRC and not SRC), recorded from power-on. */
  const setup = (budget?: number) => {
    const netlist = circuit((b) =>
      b
        .add('I', 'test/inv')
        .add('G', 'test/and')
        .connect('S.Y', 'I.A')
        .connect('S.Y', 'G.A')
        .connect('I.Y', 'G.B')
        .net('Y', 'G.Y'),
    );
    const sim = new Simulator(netlist, registry);
    const recorder = new Recorder(budget === undefined ? {} : { budget });
    const clk = recorder.addChannel();
    const y = recorder.addChannel();
    const src = recorder.addChannel();
    recorder.attach(
      sim,
      new Map([
        [clk, sim.netIndex('CLK')],
        [y, sim.netIndex('Y')],
        [src, sim.netIndex('SRC')],
      ]),
    );
    return { sim, recorder, clk, y, src };
  };

  it('keeps the record after the rewound instant as the future, and confirms it on replay', () => {
    const { sim, recorder, clk, y, src } = setup();
    sim.action('S', Drive.STRONG_0);
    sim.runUntil(ns(40));
    const snap = sim.snapshot();
    sim.runUntil(ns(55));
    sim.action('S', Drive.STRONG_1); // Y glitches within the instant
    sim.runUntil(ns(100));
    const before = [changes(recorder, clk), changes(recorder, y), changes(recorder, src)];
    const size = recorder.size;

    sim.restore(snap);
    recorder.seek(sim.now, ns(100));
    expect(recorder.replaying).toBe(true);
    expect(recorder.end).toBe(ns(100));
    expect(recorder.level(clk, ns(90))).toBe(Level.L1); // the future is still there
    expect(recorder.lastChange(clk)).toBe(ns(40));
    expect(recorder.lastChange(src)).toBe(0);

    // The same run again: nothing new recorded, `lastChange` follows the run.
    for (const t of [ns(45), ns(50), ns(55)]) {
      sim.runUntil(t);
      expect(recorder.lastChange(clk)).toBe(t === ns(45) ? ns(40) : ns(50));
    }
    sim.action('S', Drive.STRONG_1);
    sim.runUntil(ns(55));
    expect(recorder.lastChange(src)).toBe(ns(55));
    expect(recorder.lastChange(y)).toBe(0); // the glitch left nothing, then or now
    sim.runUntil(ns(100));
    expect([changes(recorder, clk), changes(recorder, y), changes(recorder, src)]).toEqual(before);
    expect(recorder.size).toBe(size);
    expect(recorder.lastChange(clk)).toBe(ns(100));

    // Past the present it records again.
    sim.runUntil(ns(115));
    expect(recorder.replaying).toBe(false);
    expect(changes(recorder, clk)).toBe(`${before[0]} 110:1`);
    expect(recorder.end).toBe(ns(115));
  });

  it('cuts the future where the run leaves it, and records the new one', () => {
    const { sim, recorder, clk, src } = setup();
    sim.action('S', Drive.STRONG_0);
    sim.runUntil(ns(20));
    const snap = sim.snapshot();
    sim.runUntil(ns(30));
    sim.action('S', Drive.STRONG_1);
    sim.runUntil(ns(60));
    sim.restore(snap);
    recorder.seek(sim.now, ns(60));
    sim.runUntil(ns(25));
    recorder.cut(sim.now); // another action here instead
    expect(recorder.replaying).toBe(false);
    expect(changes(recorder, src)).toBe('0:0');
    expect(changes(recorder, clk)).toBe('0:0 10:1 20:0');
    expect(recorder.end).toBe(ns(25));
    expect(recorder.size).toBe(5); // CLK 3, SRC 1, Y 1
    sim.action('S', Drive.STRONG_1);
    sim.runUntil(ns(35));
    expect(changes(recorder, src)).toBe('0:0 25:1');
    expect(changes(recorder, clk)).toBe('0:0 10:1 20:0 30:1');
    expect(recorder.lastChange(clk)).toBe(ns(30));
  });

  it('keeps the instant it is cut at, so a change still made then merges into it', () => {
    const { sim, recorder, src } = setup();
    sim.action('S', Drive.STRONG_0);
    sim.runUntil(ns(10));
    sim.action('S', Drive.STRONG_1);
    sim.runUntil(ns(10));
    const snap = sim.snapshot();
    sim.runUntil(ns(30));
    sim.restore(snap);
    recorder.seek(ns(10), ns(30));
    recorder.cut(ns(10));
    sim.action('S', Drive.STRONG_0); // back at the same instant: no change left at 10 ns
    sim.runUntil(ns(10));
    expect(changes(recorder, src)).toBe('0:0');
  });

  it('is not replaying when rewound to the present itself', () => {
    const { sim, recorder } = setup();
    sim.runUntil(ns(20));
    recorder.seek(sim.now, sim.now);
    expect(recorder.replaying).toBe(false);
  });

  it('trims a channel recording while replaying, never into the future', () => {
    const { sim, recorder, clk } = setup(30); // 23 changes by 200 ns: no trim yet
    sim.runUntil(ns(60));
    const snap = sim.snapshot();
    sim.runUntil(ns(200));
    const record = changes(recorder, clk);
    sim.restore(snap);
    recorder.seek(sim.now, ns(200));
    const late = recorder.addChannel(); // records CLK as well: past the budget while replaying
    recorder.attachChannel(late, sim.netIndex('CLK'));
    for (let t = ns(65); t <= ns(200); t += ns(10)) {
      sim.runUntil(t);
      expect(recorder.lastChange(clk), `at ${t}`).toBe(Math.floor(t / ns(10)) * ns(10));
    }
    expect(recorder.dropped).toBeGreaterThan(0);
    expect(record.endsWith(changes(recorder, clk))).toBe(true); // only the oldest went
    expect(recorder.level(clk, ns(195))).toBe(Level.L1);
    expect(recorder.replaying).toBe(true);
  });

  it('over the budget with a large future, drops only what is behind the run', () => {
    const { sim, recorder, clk } = setup(33);
    sim.runUntil(ns(20));
    const snap = sim.snapshot();
    sim.runUntil(ns(300)); // 31 changes of CLK: nearly the whole budget
    const record = changes(recorder, clk).split(' ');
    sim.restore(snap);
    recorder.seek(sim.now, ns(300));
    const late = recorder.addChannel();
    recorder.attachChannel(late, sim.netIndex('CLK'));
    for (let t = ns(25); t <= ns(300); t += ns(10)) {
      sim.runUntil(t);
      expect(recorder.lastChange(clk), `at ${t}`).toBe(Math.floor(t / ns(10)) * ns(10));
      const future = record.filter((c) => Number(c.split(':')[0]) * 1000 > t);
      expect(changes(recorder, clk).endsWith(future.join(' ')), `at ${t}`).toBe(true);
    }
  });

  it('records a channel added while replaying as usual', () => {
    const { sim, recorder } = setup();
    sim.runUntil(ns(20));
    const snap = sim.snapshot();
    sim.runUntil(ns(60));
    sim.restore(snap);
    recorder.seek(sim.now, ns(60));
    const late = recorder.addChannel();
    recorder.attachChannel(late, sim.netIndex('CLK'));
    sim.runUntil(ns(45));
    expect(changes(recorder, late)).toBe('19.999:0 30:1 40:0');
    expect(recorder.lastChange(late)).toBe(ns(40));
  });

  it('never trims into the future, and keeps its cursors through a trim', () => {
    const { sim, recorder, clk } = setup(16);
    sim.runUntil(ns(150));
    const snap = sim.snapshot();
    sim.runUntil(ns(300));
    sim.restore(snap);
    recorder.seek(sim.now, ns(300));
    const future = changes(recorder, clk)
      .split(' ')
      .filter((c) => Number(c.split(':')[0]) > 150);
    sim.runUntil(ns(300));
    expect(changes(recorder, clk).endsWith(future.join(' '))).toBe(true);
    sim.runUntil(ns(400)); // past the present: trims as before
    expect(recorder.size).toBeLessThanOrEqual(16);
    expect(recorder.lastChange(clk)).toBe(ns(400));
    expect(recorder.level(clk, ns(395))).toBe(Level.L1);
  });

  it('forgets a rewind on clear, and on detach keeps the record to the present', () => {
    const { sim, recorder, clk } = setup();
    sim.runUntil(ns(20));
    const snap = sim.snapshot();
    sim.runUntil(ns(60));
    sim.restore(snap);
    recorder.seek(sim.now, ns(60));
    recorder.detach();
    expect(recorder.replaying).toBe(false);
    expect(recorder.end).toBe(ns(60));
    expect(recorder.level(clk, ns(55))).toBe(Level.L1);
    recorder.clear();
    expect(recorder.end).toBe(0);
    expect(recorder.size).toBe(0);
  });
});

describe('Trigger across a rewind', () => {
  it('resyncs to the rewound instant and fires again where it fired after it', async () => {
    const { Trigger } = await import('./trigger');
    const sim = new Simulator(circuit(), registry);
    const recorder = new Recorder();
    const clk = recorder.addChannel();
    const src = recorder.addChannel();
    recorder.attach(
      sim,
      new Map([
        [clk, sim.netIndex('CLK')],
        [src, sim.netIndex('SRC')],
      ]),
    );
    sim.action('S', Drive.STRONG_1);
    const rises: number[] = [];
    const highs: number[] = [];
    const rise = new Trigger(recorder, [{ kind: 'rise', channel: clk }], (t) => rises.push(t), {
      repeat: true,
    });
    const high = new Trigger(
      recorder,
      [
        { kind: 'level', channel: clk, level: Level.L1 },
        { kind: 'level', channel: src, level: Level.L1 },
      ],
      (t) => highs.push(t),
      { repeat: true },
    );
    rise.attach(sim);
    high.attach(sim);
    sim.runUntil(ns(25));
    const snap = sim.snapshot(); // CLK low since 20 ns: the pattern doesn't hold
    sim.runUntil(ns(55)); // it held when last evaluated, at 50 ns
    expect(rises).toEqual([ns(10), ns(30), ns(50)]);
    expect(highs).toEqual([ns(10), ns(30), ns(50)]);
    sim.restore(snap);
    recorder.seek(sim.now, ns(55));
    rise.resync(sim.now);
    high.resync(sim.now); // false at 25 ns: true again at 30 ns is anew
    rises.length = 0;
    highs.length = 0;
    sim.runUntil(ns(55));
    expect(rises).toEqual([ns(30), ns(50)]);
    expect(highs).toEqual([ns(30), ns(50)]);
  });

  it('fires again at the instant it last fired, when rewound before it', async () => {
    const { Trigger } = await import('./trigger');
    const sim = new Simulator(circuit(), registry);
    const recorder = new Recorder();
    const clk = recorder.addChannel();
    recorder.attach(sim, new Map([[clk, sim.netIndex('CLK')]]));
    const fired: number[] = [];
    const rise = new Trigger(recorder, [{ kind: 'rise', channel: clk }], (t) => fired.push(t), {
      repeat: true,
    });
    rise.attach(sim);
    sim.runUntil(ns(5));
    const snap = sim.snapshot();
    sim.runUntil(ns(12));
    expect(fired).toEqual([ns(10)]);
    sim.restore(snap);
    recorder.seek(sim.now, ns(12));
    rise.resync(sim.now);
    sim.runUntil(ns(12));
    expect(fired).toEqual([ns(10), ns(10)]);
  });
});
