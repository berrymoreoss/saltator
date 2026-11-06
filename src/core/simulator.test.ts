import { describe, expect, it } from 'vitest';
import { defineComponent, type EvalContext } from './component';
import { Drive, Level, levelChar, not, strong } from './logic';
import { NetlistBuilder } from './netlist';
import { Registry } from './registry';
import { Simulator } from './simulator';
import { ns } from './time';

// Tiny inline parts; the real primitives live in src/library and are tested there.

/** Tri-state source set from outside: `sim.action(id, drive)`. */
const source = defineComponent({
  type: 'test/source',
  name: 'S',
  title: 'Source',
  pins: [{ name: 'Y', dir: 'tristate' }],
  props: [{ key: 'delay', label: 'Delay', type: 'time', default: 0 }],
  create: ({ delay }: { delay: number }) => ({
    action(ctx, payload) {
      ctx.drive(0, payload as Drive, delay);
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
  props: [{ key: 'delay', label: 'Delay', type: 'time', default: ns(1), min: 0 }],
  create: ({ delay }: { delay: number }) => ({
    evaluate(ctx) {
      ctx.drive(1, strong(not(ctx.read(0))), delay);
    },
  }),
});

type Log = { log: string[] };

/** Order of recorder callbacks across instances. */
const calls: string[] = [];

/** Records every callback with what it saw. */
const recorder = defineComponent<Record<string, never>, Log>({
  type: 'test/recorder',
  name: 'R',
  title: 'Recorder',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'B', dir: 'in' },
  ],
  create: () => {
    const note = (ctx: EvalContext<Log>, what: string) => {
      const pins = [0, 1]
        .map(
          (p) => `${levelChar(ctx.prev(p))}${ctx.changed(p) ? '>' : '='}${levelChar(ctx.read(p))}`,
        )
        .join(' ');
      ctx.state.log.push(`${ctx.now} ${ctx.id} ${what} ${pins}`);
      calls.push(`${ctx.id} ${what}`);
    };
    return {
      createState: () => ({ log: [] }),
      init: (ctx) => note(ctx, 'init'),
      evaluate: (ctx) => note(ctx, 'eval'),
      wake: (ctx, token) => note(ctx, `wake${token}`),
      action: (ctx, payload) => {
        note(ctx, 'action');
        ctx.wakeAfter(payload as number, 7);
      },
    };
  },
});

/** Records rose/fell on its clock input. */
const edges = defineComponent<Record<string, never>, { seen: string[] }>({
  type: 'test/edges',
  name: 'E',
  title: 'Edges',
  pins: [{ name: 'C', dir: 'in' }],
  create: () => ({
    createState: () => ({ seen: [] }),
    evaluate(ctx) {
      const kind = ctx.rose(0) ? 'rose' : ctx.fell(0) ? 'fell' : 'other';
      ctx.state.seen.push(`${levelChar(ctx.prev(0))}${levelChar(ctx.read(0))}:${kind}`);
    },
  }),
});

/** Free-running clock from timers: toggles every `half`. */
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

/** Indicator: observes its input through a sense pin and records what it saw. */
const lamp = defineComponent<Record<string, never>, { seen: string }>({
  type: 'test/lamp',
  name: 'L',
  title: 'Lamp',
  pins: [{ name: 'A', dir: 'in', sense: true }],
  create: () => ({
    createState: () => ({ seen: '' }),
    evaluate(ctx) {
      ctx.state.seen += levelChar(ctx.read(0));
    },
  }),
});

/** Misbehaving part for API error checks. */
const bad = defineComponent({
  type: 'test/bad',
  name: 'BAD',
  title: 'Bad',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'Y', dir: 'out' },
  ],
  create: () => ({
    action(ctx, what) {
      if (what === 'drive-input') ctx.drive(0, Drive.STRONG_1, 0);
      if (what === 'negative-delay') ctx.drive(1, Drive.STRONG_1, -1);
      if (what === 'bad-pin') ctx.read(5);
      if (what === 'bad-wake') ctx.wakeAfter(Number.NaN);
    },
  }),
});

const registry = new Registry([source, inverter, recorder, edges, clock, lamp, bad]);

const sim = (build: (b: NetlistBuilder) => NetlistBuilder, options = {}) =>
  new Simulator(build(new NetlistBuilder()).build(), registry, options);

const levels = (s: Simulator, ...nets: string[]) => nets.map((n) => levelChar(s.level(n))).join('');

describe('power-on', () => {
  it('out pins drive strong X, tri-state pins start released', () => {
    const s = sim((b) => b.add('S', 'test/source').add('I', 'test/inv').connect('S.Y', 'I.A'));
    expect(levels(s, 'S.Y', 'I.Y')).toBe('ZX');
    expect(s.drives[s.netIndex('I.Y')]).toBe(Drive.STRONG_X);
    expect(s.now).toBe(0);
  });

  it('evaluates every component once at t = 0, after init events were applied', () => {
    const s = sim((b) => b.add('S', 'test/source').add('I', 'test/inv').connect('S.Y', 'I.A'));
    s.action('S', Drive.STRONG_0); // scheduled at t = 0, before the first run
    expect(s.settle()).toBe('idle');
    expect(levels(s, 'S.Y', 'I.Y')).toBe('01');
    expect(s.now).toBe(ns(1));
    expect(s.diagnostics.entries).toEqual([]);
  });

  it('runs init in the constructor, with nothing changed', () => {
    const s = sim((b) => b.add('R', 'test/recorder'));
    expect((s.stateOf('R') as Log).log).toEqual(['0 R init Z=Z Z=Z']);
  });
});

describe('floating inputs', () => {
  it('reading Z through an input is reported once per floating period', () => {
    const s = sim((b) => b.add('S', 'test/source').add('I', 'test/inv').connect('S.Y', 'I.A'));
    s.settle();
    expect(s.diagnostics.entries.map((d) => [d.kind, d.component, d.pin])).toEqual([
      ['floating-input', 'I', 'A'],
    ]);
  });

  it('reading Z through a sense pin is not a floating input, but still evaluates', () => {
    const s = sim((b) => b.add('S', 'test/source').add('L', 'test/lamp').connect('S.Y', 'L.A'));
    s.settle();
    s.action('S', Drive.STRONG_1);
    s.settle();
    s.action('S', Drive.Z);
    s.settle();
    expect((s.stateOf('L') as { seen: string }).seen).toBe('Z1Z');
    expect(s.diagnostics.entries).toEqual([]);
  });
});

describe('propagation and inertial delay', () => {
  const chain = () =>
    sim((b) =>
      b
        .add('S', 'test/source')
        .add('I1', 'test/inv', { delay: ns(2) })
        .add('I2', 'test/inv', { delay: ns(3) })
        .net('a', 'S.Y', 'I1.A')
        .net('b', 'I1.Y', 'I2.A')
        .net('c', 'I2.Y'),
    );

  it('propagates through a chain with each gate delay', () => {
    const s = chain();
    const trace: string[] = [];
    s.onNetChange((t, net, level) =>
      trace.push(`${t / 1000}ns ${s.netId(net)}=${levelChar(level)}`),
    );
    s.action('S', Drive.STRONG_1);
    s.settle();
    expect(trace).toEqual(['0ns a=1', '2ns b=0', '5ns c=1']);
  });

  it('swallows a pulse shorter than the gate delay', () => {
    const s = chain();
    s.action('S', Drive.STRONG_1);
    s.settle();
    const trace: string[] = [];
    s.onNetChange((t, net, level) => trace.push(`${t} ${s.netId(net)}=${levelChar(level)}`));
    const t0 = s.now;
    s.action('S', Drive.STRONG_0);
    s.runFor(ns(1)); // 1 ns pulse into a 2 ns gate
    s.action('S', Drive.STRONG_1);
    s.settle();
    expect(trace).toEqual([`${t0} a=0`, `${t0 + ns(1)} a=1`]);
    expect(levels(s, 'a', 'b', 'c')).toBe('101');
  });

  it('passes a pulse at least as long as the gate delay', () => {
    const s = chain();
    s.action('S', Drive.STRONG_1);
    s.settle();
    const t0 = s.now;
    const trace: string[] = [];
    s.onNetChange((t, net, level) => trace.push(`${t - t0} ${s.netId(net)}=${levelChar(level)}`));
    s.action('S', Drive.STRONG_0);
    s.runFor(ns(2));
    s.action('S', Drive.STRONG_1);
    s.settle();
    // b pulses 1 for 2 ns; I2 (3 ns) swallows it.
    expect(trace).toEqual(['0 a=0', '2000 b=1', '2000 a=1', '4000 b=0']);
  });

  it('keeps a pending change when a re-evaluation confirms it (no postponing)', () => {
    const slow = defineComponent({
      type: 'test/follower',
      name: 'F',
      title: 'Follower',
      pins: [
        { name: 'A', dir: 'in' },
        { name: 'B', dir: 'in' },
        { name: 'Y', dir: 'out' },
      ],
      // Output = A, re-evaluated whenever A or B changes.
      create: () => ({ evaluate: (ctx) => ctx.drive(2, strong(ctx.read(0)), ns(5)) }),
    });
    const s = new Simulator(
      new NetlistBuilder()
        .add('SA', 'test/source')
        .add('SB', 'test/source')
        .add('F', 'test/follower')
        .net('a', 'SA.Y', 'F.A')
        .net('b', 'SB.Y', 'F.B')
        .net('y', 'F.Y')
        .build(),
      new Registry([source, slow]),
    );
    s.action('SA', Drive.STRONG_1);
    s.action('SB', Drive.STRONG_0);
    s.runFor(ns(3));
    s.action('SB', Drive.STRONG_1); // re-evaluates F at 3 ns: still wants 1
    s.settle();
    expect(s.now).toBe(ns(5));
    expect(levels(s, 'y')).toBe('1');
  });
});

describe('delta cycles and callbacks', () => {
  it('evaluates dirty components once per delta, in ascending index order', () => {
    const s = sim((b) =>
      b
        .add('S', 'test/source')
        .add('R2', 'test/recorder')
        .add('R1', 'test/recorder')
        .connect('S.Y', 'R1.A', 'R1.B', 'R2.B'),
    );
    s.settle(); // initial evaluation
    for (const id of ['R1', 'R2']) (s.stateOf(id) as Log).log.length = 0;
    calls.length = 0;
    s.action('S', Drive.STRONG_1);
    s.settle();
    expect(calls).toEqual(['R2 eval', 'R1 eval']); // R2 was added first → lower index
    expect((s.stateOf('R2') as Log).log).toEqual(['0 R2 eval Z=Z Z>1']);
    expect((s.stateOf('R1') as Log).log).toEqual(['0 R1 eval Z>1 Z>1']);
  });

  it('propagates zero-delay drives through delta cycles at the same time', () => {
    const s = sim((b) =>
      b
        .add('S', 'test/source')
        .add('I1', 'test/inv', { delay: 0 })
        .add('I2', 'test/inv', { delay: 0 })
        .net('a', 'S.Y', 'I1.A')
        .net('b', 'I1.Y', 'I2.A')
        .net('c', 'I2.Y'),
    );
    s.action('S', Drive.STRONG_0);
    expect(s.settle()).toBe('idle');
    expect(s.now).toBe(0);
    expect(levels(s, 'a', 'b', 'c')).toBe('010');
    // delta 1: a=0, evaluate I1 and I2 (initial; I2 still sees X); delta 2: b=1, evaluate I2;
    // delta 3: c=0, nobody reads it, so no evaluation.
    expect(s.stats.deltaCycles).toBe(2);
  });

  it('fires timers after their delay, with their token', () => {
    const s = sim((b) => b.add('R', 'test/recorder'));
    s.settle();
    const log = (s.stateOf('R') as Log).log;
    log.length = 0;
    s.action('R', ns(4)); // wakeAfter(4 ns, token 7)
    s.runFor(ns(4) - 1);
    expect(log).toEqual(['0 R action Z=Z Z=Z']);
    s.runFor(1);
    expect(log).toEqual(['0 R action Z=Z Z=Z', '4000 R wake7 Z=Z Z=Z']);
  });

  it('delivers wake and evaluate in the same delta in that order', () => {
    const s = sim((b) =>
      b
        .add('S', 'test/source', { delay: ns(4) })
        .add('R', 'test/recorder')
        .connect('S.Y', 'R.A'),
    );
    s.settle();
    const log = (s.stateOf('R') as Log).log;
    log.length = 0;
    s.action('S', Drive.STRONG_1); // lands at 4 ns
    s.action('R', ns(4)); // wake at 4 ns
    s.settle();
    expect(log).toEqual(['0 R action Z=Z Z=Z', '4000 R wake7 Z>1 Z=Z', '4000 R eval Z>1 Z=Z']);
  });
});

describe('scale', () => {
  it('orders large dirty sets and many timers in one delta', () => {
    const n = 80; // above the insertion-sort cutoff and the initial wake buffer
    const s = sim((b) => {
      b.add('S', 'test/source');
      for (let i = n - 1; i >= 0; i--) b.add(`R${i}`, 'test/recorder').connect('S.Y', `R${i}.A`);
      return b;
    });
    s.settle();
    calls.length = 0;
    for (let i = 0; i < n; i++) s.action(`R${i}`, ns(1));
    s.action('S', Drive.STRONG_1);
    s.runFor(0);
    // Components were added R79 … R0, so R79 has the lowest index and runs first.
    const order = (what: string) => Array.from({ length: n }, (_, i) => `R${n - 1 - i} ${what}`);
    expect(calls.slice(n)).toEqual(order('eval'));
    s.runFor(ns(1));
    expect(calls.slice(2 * n)).toEqual(order('wake7'));
  });
});

describe('edges', () => {
  it('rose/fell are strict 0↔1; prev() shows edges from X', () => {
    const s = sim((b) => b.add('S', 'test/source').add('E', 'test/edges').connect('S.Y', 'E.C'));
    for (const d of [
      Drive.STRONG_X,
      Drive.STRONG_1,
      Drive.STRONG_0,
      Drive.STRONG_1,
      Drive.Z,
      Drive.STRONG_0,
    ]) {
      s.action('S', d);
      s.runFor(ns(1));
    }
    expect((s.stateOf('E') as { seen: string[] }).seen).toEqual([
      'ZX:other', // initial evaluation, same delta as the first action
      'X1:other',
      '10:fell',
      '01:rose',
      '1Z:other',
      'Z0:other',
    ]);
  });
});

describe('running', () => {
  const clocked = () =>
    sim((b) => b.add('C', 'test/clock').add('E', 'test/edges').connect('C.Y', 'E.C'));

  it('runUntil processes events up to and including t, then sets now = t', () => {
    const s = clocked();
    expect(s.runUntil(ns(10))).toBe('reached');
    expect(s.now).toBe(ns(10));
    expect(levels(s, 'C.Y')).toBe('1');
    expect(s.runFor(ns(5))).toBe('reached');
    expect(s.now).toBe(ns(15));
    expect(levels(s, 'C.Y')).toBe('1');
    s.runUntil(ns(20));
    expect(levels(s, 'C.Y')).toBe('0');
  });

  it('runUntil returns idle when nothing is left and still advances time', () => {
    const s = sim((b) => b.add('S', 'test/source'));
    expect(s.runUntil(ns(100))).toBe('idle');
    expect(s.now).toBe(ns(100));
  });

  it('refuses to run backwards', () => {
    const s = clocked();
    s.runUntil(ns(10));
    expect(() => s.runUntil(ns(5))).toThrow('cannot run backwards: now 10 ns, until 5 ns');
  });

  it('settle stops at maxTime when the circuit never settles', () => {
    const s = clocked();
    expect(s.settle({ maxTime: ns(55) })).toBe('reached');
    expect(s.now).toBe(ns(55));
  });

  it('honours the event budget between timestamps', () => {
    const s = clocked();
    expect(s.runUntil(ns(1000), { maxEvents: 3 })).toBe('budget');
    expect(s.stats.events).toBeGreaterThanOrEqual(3);
    expect(s.now).toBeLessThan(ns(1000));
    expect(s.settle({ maxEvents: 2 })).toBe('budget');
  });

  it('counts events, delta cycles and evaluations', () => {
    const s = clocked();
    s.runUntil(ns(30));
    // t=0: clock drive + edges eval; 10, 20, 30 ns: wake + drive.
    expect(s.stats).toEqual({ events: 7, deltaCycles: 7, evaluations: 7 });
  });

  it('notifies listeners until unsubscribed', () => {
    const s = clocked();
    const seen: number[] = [];
    const off = s.onNetChange((t) => seen.push(t));
    s.runUntil(ns(10));
    off();
    off();
    s.runUntil(ns(30));
    expect(seen).toEqual([0, ns(10)]);
  });
});

describe('queries and errors', () => {
  it('looks up nets, components and pins', () => {
    const s = sim((b) => b.add('S', 'test/source').add('I', 'test/inv').net('in', 'S.Y', 'I.A'));
    expect(s.netCount).toBe(2);
    expect(s.componentCount).toBe(2);
    expect(s.netIndex('in')).toBe(0);
    expect(s.netId(1)).toBe('I.Y');
    expect(s.componentIndex('I')).toBe(1);
    expect(s.pinNet('I', 'A')).toBe(0);
    expect(s.pinLevel('I', 'Y')).toBe(Level.X);
    expect(s.level(0)).toBe(Level.Z);
    expect(() => s.netIndex('nope')).toThrow('unknown net "nope"');
    expect(() => s.componentIndex('U9')).toThrow('unknown component "U9"');
    expect(() => s.pinNet('I', 'Q')).toThrow('component "I" has no pin "Q"');
  });

  it('rejects actions on parts without an action handler', () => {
    const s = sim((b) => b.add('I', 'test/inv'));
    expect(() => s.action('I', 1)).toThrow('component "I" does not accept actions');
  });

  it.each([
    ['drive-input', 'B: pin A cannot drive'],
    ['negative-delay', 'B: invalid delay -1'],
    ['bad-pin', 'B: no pin #5'],
    ['bad-wake', 'B: invalid delay NaN'],
  ])('reports part bugs: %s', (what, message) => {
    const s = sim((b) => b.add('B', 'test/bad'));
    expect(() => s.action('B', what)).toThrow(message);
  });
});

describe('carry-over into a recompiled netlist', () => {
  type Build = (b: NetlistBuilder) => NetlistBuilder;
  const rebuild = (old: Simulator, build: Build, renames?: ReadonlyMap<string, string>) =>
    new Simulator(build(new NetlistBuilder()).build(), registry, {
      carry: old.carryOver(renames ? { renames } : {}),
    });
  /** Records `time net=level` for every change of `s`, into `out`. */
  const record = (s: Simulator, out: string[]) =>
    s.onNetChange((t, net, level) => out.push(`${t} ${s.netId(net)}=${levelChar(level)}`));

  const clocked: Build = (b) =>
    b
      .add('C', 'test/clock')
      .add('I', 'test/inv', { delay: ns(3) })
      .connect('C.Y', 'I.A');

  it('goes on at the same time with drives, pending changes and timers', () => {
    const plain = sim(clocked);
    const expected: string[] = [];
    record(plain, expected);
    plain.runUntil(ns(55));

    const first = sim(clocked);
    const seen: string[] = [];
    record(first, seen);
    first.runUntil(ns(21)); // the clock fell at 20 ns, the inverter rises at 23 ns
    const second = rebuild(first, clocked);
    record(second, seen);
    expect(second.now).toBe(ns(21));
    expect(levels(second, 'C.Y', 'I.Y')).toBe('00');
    second.runUntil(ns(55));
    expect(seen).toEqual(expected);
  });

  it('does not carry cancelled changes (a swallowed pulse stays swallowed)', () => {
    const build: Build = (b) =>
      b
        .add('S', 'test/source')
        .add('I', 'test/inv', { delay: ns(5) })
        .net('in', 'S.Y', 'I.A');
    const first = sim(build);
    first.action('S', Drive.STRONG_0);
    first.runUntil(ns(10));
    first.action('S', Drive.STRONG_1);
    first.runUntil(ns(11));
    first.action('S', Drive.STRONG_0); // the 1 → 0 at 16 ns is cancelled
    first.runUntil(ns(12));
    const second = rebuild(first, build);
    const seen: string[] = [];
    record(second, seen);
    second.runUntil(ns(40));
    expect(seen).toEqual([]);
    expect(levels(second, 'in', 'I.Y')).toBe('01');
  });

  it('keeps state and skips init for unchanged parts; renames carry them', () => {
    calls.length = 0;
    const first = sim((b) => b.add('R1', 'test/recorder'));
    first.runUntil(ns(5));
    first.action('R1', ns(10)); // a timer at 15 ns
    const second = rebuild(first, (b) => b.add('R2', 'test/recorder'), new Map([['R1', 'R2']]));
    second.runUntil(ns(20));
    const log = (second.stateOf('R2') as Log).log;
    expect(log).toEqual([
      '0 R1 init Z=Z Z=Z',
      '0 R1 eval Z=Z Z=Z',
      '5000 R1 action Z=Z Z=Z',
      '5000 R2 eval Z=Z Z=Z', // re-evaluated once at the carried time
      '15000 R2 wake7 Z=Z Z=Z',
    ]);
  });

  it('powers on parts with other props or a new id, but changed parts keep their outputs', () => {
    const first = sim((b) =>
      b.add('S', 'test/source').add('I', 'test/inv').net('in', 'S.Y', 'I.A'),
    );
    first.action('S', Drive.STRONG_1);
    first.runUntil(ns(5));
    expect(levels(first, 'I.Y')).toBe('0');

    const second = rebuild(first, (b) =>
      b
        .add('S', 'test/source')
        .add('I', 'test/inv', { delay: ns(4) }) // changed: no X glitch on its output
        .add('J', 'test/inv') // new: powers on at X
        .net('in', 'S.Y', 'I.A', 'J.A'),
    );
    const seen: string[] = [];
    record(second, seen);
    expect(levels(second, 'in', 'I.Y', 'J.Y')).toBe('10X');
    second.runUntil(ns(20));
    expect(seen).toEqual([`${ns(6)} J.Y=0`]);
  });

  it('powers on a part whose type changed under the same id', () => {
    const first = sim((b) => b.add('P', 'test/clock'));
    first.runUntil(ns(15));
    const second = rebuild(first, (b) => b.add('P', 'test/recorder'));
    second.runUntil(ns(16));
    expect((second.stateOf('P') as Log).log[0]).toBe(`${ns(15)} P init Z=Z Z=Z`);
  });

  it('evaluates everything once, so parts react to new connections', () => {
    const first = sim((b) => b.add('S', 'test/source').add('I', 'test/inv'));
    first.action('S', Drive.STRONG_1);
    first.runUntil(ns(5));
    expect(levels(first, 'I.Y')).toBe('X');
    const second = rebuild(first, (b) =>
      b.add('S', 'test/source').add('I', 'test/inv').net('in', 'S.Y', 'I.A'),
    );
    second.runUntil(ns(10));
    expect(levels(second, 'I.Y')).toBe('0');
  });

  it('continues the diagnostic log and the statistics', () => {
    const first = sim((b) => b.add('I', 'test/inv'));
    first.runUntil(ns(5));
    const events = first.stats.events;
    const second = rebuild(first, (b) => b.add('I', 'test/inv'));
    second.runUntil(ns(10));
    expect(second.diagnostics).toBe(first.diagnostics);
    expect(second.diagnostics.entries.map((d) => [d.kind, d.count])).toEqual([
      ['floating-input', 2],
    ]);
    expect(second.stats.events).toBeGreaterThanOrEqual(events);
  });

  it('reports contention a new connection causes, and exposes it per net', () => {
    const apart = (b: NetlistBuilder) => b.add('A', 'test/source').add('B', 'test/source');
    const first = sim(apart);
    first.action('A', Drive.STRONG_1);
    first.action('B', Drive.STRONG_0);
    first.runUntil(ns(1));
    const second = rebuild(first, (b) => apart(b).net('bus', 'A.Y', 'B.Y'));
    expect(second.contended[second.netIndex('bus')]).toBe(1);
    expect(second.diagnostics.entries.map((d) => d.kind)).toEqual(['contention']);
    second.action('B', Drive.Z);
    second.runUntil(ns(2));
    expect(second.contended[second.netIndex('bus')]).toBe(0);
    expect(levels(second, 'bus')).toBe('1');
  });
});
