import { describe, expect, it } from 'vitest';
import { defineComponent } from './component';
import { type Diagnostic, DiagnosticLog } from './diagnostics';
import { and, Drive, Level, levelChar, not, strong } from './logic';
import { NetlistBuilder } from './netlist';
import { Registry } from './registry';
import { Simulator } from './simulator';
import { ns } from './time';

describe('DiagnosticLog', () => {
  it('merges repeats by kind, net, component and pin', () => {
    const log = new DiagnosticLog();
    log.add({ time: 1, kind: 'contention', message: 'a', net: 'n1' });
    log.add({ time: 5, kind: 'contention', message: 'b', net: 'n1' });
    log.add({ time: 6, kind: 'contention', message: 'c', net: 'n2' });
    log.add({ time: 7, kind: 'setup-violation', message: 'd', component: 'U1', pin: 'D' });
    log.add({ time: 8, kind: 'setup-violation', message: 'e', component: 'U1', pin: 'CLK' });
    expect(log.entries.map((d) => [d.kind, d.message, d.count, d.time, d.lastTime])).toEqual([
      ['contention', 'a', 2, 1, 5],
      ['contention', 'c', 1, 6, 6],
      ['setup-violation', 'd', 1, 7, 7],
      ['setup-violation', 'e', 1, 8, 8],
    ]);
  });

  it('caps distinct entries and counts the dropped ones', () => {
    const log = new DiagnosticLog(2);
    for (let i = 0; i < 5; i++) log.add({ time: i, kind: 'k', message: `${i}`, net: `n${i}` });
    log.add({ time: 9, kind: 'k', message: 'again', net: 'n0' });
    expect(log.max).toBe(2);
    expect(log.entries.map((d) => [d.message, d.count])).toEqual([
      ['0', 2],
      ['1', 1],
    ]);
    expect(log.dropped).toBe(3);
  });

  it('notifies subscribers of new entries only', () => {
    const log = new DiagnosticLog();
    const seen: string[] = [];
    const off = log.subscribe((d) => seen.push(d.message));
    log.add({ time: 0, kind: 'k', message: 'first' });
    log.add({ time: 1, kind: 'k', message: 'repeat' });
    off();
    off();
    log.add({ time: 2, kind: 'other', message: 'unseen' });
    expect(seen).toEqual(['first']);
  });
});

// --- Kernel diagnostics, wired into the simulator ----------------------------------------------

const source = defineComponent({
  type: 'test/source',
  name: 'S',
  title: 'Source',
  pins: [{ name: 'Y', dir: 'tristate' }],
  create: () => ({ action: (ctx, d) => ctx.drive(0, d as Drive, 0) }),
});

const pullDown = defineComponent({
  type: 'test/pull-down',
  name: 'PD',
  title: 'Pull-down',
  pins: [{ name: 'Y', dir: 'out' }],
  create: () => ({ init: (ctx) => ctx.drive(0, Drive.WEAK_0, 0) }),
});

const inverter = defineComponent({
  type: 'test/inv',
  name: 'INV',
  title: 'Inverter',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'Y', dir: 'out' },
  ],
  props: [{ key: 'delay', label: 'Delay', type: 'time', default: ns(1) }],
  create: ({ delay }: { delay: number }) => ({
    evaluate: (ctx) => ctx.drive(1, strong(not(ctx.read(0))), delay),
  }),
});

const nand = defineComponent({
  type: 'test/nand',
  name: 'NAND',
  title: 'NAND',
  pins: [
    { name: 'A', dir: 'in' },
    { name: 'B', dir: 'in' },
    { name: 'Y', dir: 'out' },
  ],
  props: [{ key: 'delay', label: 'Delay', type: 'time', default: ns(1) }],
  create: ({ delay }: { delay: number }) => ({
    evaluate: (ctx) => ctx.drive(2, strong(not(and(ctx.read(0), ctx.read(1)))), delay),
  }),
});

/** A transceiver-like part with a bidirectional pin: drives when told, reads always. */
const bidir = defineComponent<Record<string, never>, { seen: string }>({
  type: 'test/bidir',
  name: 'BD',
  title: 'Bidir',
  pins: [{ name: 'D', dir: 'bidir' }],
  create: () => ({
    createState: () => ({ seen: '' }),
    evaluate: (ctx) => {
      ctx.state.seen += levelChar(ctx.read(0));
    },
    action: (ctx, d) => ctx.drive(0, d as Drive, 0),
  }),
});

const reporter = defineComponent({
  type: 'test/reporter',
  name: 'REP',
  title: 'Reporter',
  pins: [{ name: 'D', dir: 'in' }],
  create: () => ({
    action: (ctx, message) =>
      ctx.report({ kind: 'setup-violation', message: String(message), pin: 0 }),
  }),
});

const registry = new Registry([source, pullDown, inverter, nand, bidir, reporter]);

const sim = (build: (b: NetlistBuilder) => NetlistBuilder, options = {}) =>
  new Simulator(build(new NetlistBuilder()).build(), registry, options);

const kinds = (s: Simulator) => s.diagnostics.entries.map((d) => d.kind);
const only = (s: Simulator, kind: string): Diagnostic[] =>
  s.diagnostics.entries.filter((d) => d.kind === kind);

describe('contention', () => {
  const bus = () =>
    sim((b) =>
      b
        .add('U1', 'test/source')
        .add('U2', 'test/source')
        .add('R1', 'test/pull-down')
        .add('U3', 'test/inv')
        .net('BUS', 'U1.Y', 'U2.Y', 'R1.Y', 'U3.A'),
    );

  it('idle bus with a pull-down reads weak 0; one driver wins over the pull', () => {
    const s = bus();
    s.settle();
    expect(s.level('BUS')).toBe(Level.L0);
    expect(s.drives[s.netIndex('BUS')]).toBe(Drive.WEAK_0);
    s.action('U1', Drive.STRONG_1);
    s.settle();
    expect(s.drives[s.netIndex('BUS')]).toBe(Drive.STRONG_1);
    expect(s.diagnostics.entries).toEqual([]);
  });

  it('two opposite strong drivers → X and a contention diagnostic naming them', () => {
    const s = bus();
    s.action('U1', Drive.STRONG_1);
    s.action('U2', Drive.STRONG_0);
    s.settle();
    expect(s.level('BUS')).toBe(Level.X);
    expect(s.level('U3.Y')).toBe(Level.X);
    expect(s.diagnostics.entries).toEqual([
      {
        time: 0,
        kind: 'contention',
        message:
          'bus contention on net "BUS": U1.Y drives strong 1, U2.Y drives strong 0, R1.Y drives weak 0',
        net: 'BUS',
        count: 1,
        lastTime: 0,
      },
    ]);
  });

  it('reports again (merged, counted) after the conflict cleared and came back', () => {
    const s = bus();
    s.action('U1', Drive.STRONG_1);
    s.action('U2', Drive.STRONG_0);
    s.runFor(ns(10));
    s.action('U2', Drive.Z);
    s.runFor(ns(10));
    expect(s.level('BUS')).toBe(Level.L1);
    s.action('U2', Drive.STRONG_0);
    s.runFor(ns(10));
    const [d] = only(s, 'contention');
    expect([d?.count, d?.time, d?.lastTime]).toEqual([2, 0, ns(20)]);
  });

  it('strong X meeting strong 0 is X without contention', () => {
    const s = bus();
    s.action('U1', Drive.STRONG_X);
    s.action('U2', Drive.STRONG_0);
    s.settle();
    expect(s.level('BUS')).toBe(Level.X);
    expect(kinds(s)).toEqual([]);
  });

  it('a bidirectional pin reads the resolved net, including its own drive', () => {
    const s = sim((b) => b.add('A', 'test/bidir').add('B', 'test/bidir').net('D', 'A.D', 'B.D'));
    s.action('A', Drive.STRONG_1);
    s.settle();
    s.action('B', Drive.STRONG_0);
    s.settle();
    expect((s.stateOf('A') as { seen: string }).seen).toBe('1X');
    expect((s.stateOf('B') as { seen: string }).seen).toBe('1X');
    expect(kinds(s)).toEqual(['contention']);
  });
});

describe('floating-input', () => {
  it('flags an unconnected input when it is read', () => {
    const s = sim((b) => b.add('U1', 'test/inv'));
    s.settle();
    expect(s.level('U1.Y')).toBe(Level.X);
    expect(s.diagnostics.entries).toEqual([
      {
        time: 0,
        kind: 'floating-input',
        message: 'floating input: U1.A is unconnected, which nothing drives (reads as X)',
        net: 'U1.A',
        component: 'U1',
        pin: 'A',
        count: 1,
        lastTime: 0,
      },
    ]);
  });

  it('flags a released bus only when a reader consumes it, once until it changes', () => {
    const s = sim((b) =>
      b
        .add('S', 'test/source')
        .add('U1', 'test/inv')
        .add('U2', 'test/inv')
        .net('BUS', 'S.Y', 'U1.A', 'U2.A'),
    );
    s.action('S', Drive.STRONG_1);
    s.settle();
    expect(kinds(s)).toEqual([]);
    s.action('S', Drive.Z);
    s.settle();
    // Both readers consumed Z in the same delta: one diagnostic for the net (per pin → U1 only).
    expect(only(s, 'floating-input').map((d) => [d.component, d.message, d.count])).toEqual([
      ['U1', 'floating input: U1.A reads net "BUS", which nothing drives (reads as X)', 1],
    ]);
    s.action('S', Drive.STRONG_0);
    s.settle();
    s.action('S', Drive.Z);
    s.settle();
    expect(only(s, 'floating-input').map((d) => d.count)).toEqual([2]);
  });

  it('does not flag output or tri-state pins on a released net', () => {
    const s = sim((b) =>
      b.add('S', 'test/source').add('T', 'test/source').net('BUS', 'S.Y', 'T.Y'),
    );
    s.settle();
    expect(s.level('BUS')).toBe(Level.Z);
    expect(kinds(s)).toEqual([]);
  });
});

describe('oscillation', () => {
  // NAND(EN, c) → a → INV → b → INV → c: three inverting stages, zero delay. EN = 0 holds it.
  const ring = (options = {}) =>
    sim(
      (b) =>
        b
          .add('S', 'test/source')
          .add('N1', 'test/nand', { delay: 0 })
          .add('I2', 'test/inv', { delay: 0 })
          .add('I3', 'test/inv', { delay: 0 })
          .net('EN', 'S.Y', 'N1.A')
          .net('a', 'N1.Y', 'I2.A')
          .net('b', 'I2.Y', 'I3.A')
          .net('c', 'I3.Y', 'N1.B'),
      options,
    );

  it('halts a zero-delay loop after maxDeltaCycles with a diagnostic', () => {
    const s = ring();
    s.action('S', Drive.STRONG_0);
    expect(s.settle()).toBe('idle');
    expect(['a', 'b', 'c'].map((n) => levelChar(s.level(n))).join('')).toBe('101');
    s.action('S', Drive.STRONG_1);
    expect(s.runFor(ns(1))).toBe('halted');
    expect(s.halted).toBe(true);
    expect(s.now).toBe(0);
    const [d] = only(s, 'oscillation');
    expect(d?.message).toMatch(
      /^oscillation: more than 1000 delta cycles at 0 ps \(a zero-delay loop\?\); still changing: [abc]=[01]\. Simulation halted\.$/,
    );
    expect(s.runFor(ns(1))).toBe('halted');
    expect(s.settle()).toBe('halted');
  });

  it('respects a custom maxDeltaCycles', () => {
    const s = ring({ maxDeltaCycles: 10 });
    s.action('S', Drive.STRONG_0);
    s.settle();
    const before = s.stats.deltaCycles;
    s.action('S', Drive.STRONG_1);
    expect(s.settle()).toBe('halted');
    expect(s.stats.deltaCycles - before).toBe(10);
    expect(only(s, 'oscillation')[0]?.message).toContain('more than 10 delta cycles');
  });

  it('a loop stuck at X is stable, not an oscillation (4-state pessimism)', () => {
    const s = ring();
    s.action('S', Drive.STRONG_1); // enabled from power-on: NAND(1, X) = X, nothing ever changes
    expect(s.settle()).toBe('idle');
    expect(['a', 'b', 'c'].map((n) => levelChar(s.level(n))).join('')).toBe('XXX');
    expect(kinds(s)).toEqual([]);
  });
});

describe('component diagnostics', () => {
  it('adds time, component and pin name', () => {
    const s = sim((b) => b.add('U7', 'test/reporter'));
    s.runFor(ns(3));
    s.action('U7', 'D changed 2 ns before CLK');
    s.action('U7', 'again');
    expect(only(s, 'setup-violation')).toEqual([
      {
        time: ns(3),
        kind: 'setup-violation',
        message: 'D changed 2 ns before CLK',
        component: 'U7',
        pin: 'D',
        count: 2,
        lastTime: ns(3),
      },
    ]);
  });

  it('caps diagnostics per simulator option', () => {
    const s = sim((b) => b.add('U1', 'test/inv').add('U2', 'test/inv').add('U3', 'test/inv'), {
      maxDiagnostics: 2,
    });
    s.settle();
    expect(s.diagnostics.entries).toHaveLength(2);
    expect(s.diagnostics.dropped).toBe(1);
  });
});
