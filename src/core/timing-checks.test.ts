import { describe, expect, it } from 'vitest';
import { defineComponent, type PinDef } from './component';
import { Level, strong, toInput } from './logic';
import { NetlistBuilder } from './netlist';
import { Registry } from './registry';
import { Simulator } from './simulator';
import { Bench, testDriver } from './testing';
import { ns, type Time } from './time';
import {
  type Edge,
  isTimingViolation,
  type PinTimes,
  TimingChecks,
  TimingViolation,
} from './timing-checks';

const MIN = {
  'tsu(Dn to CP)': ns(6),
  'th(Dn to CP)': ns(2),
  'tW(CP)': ns(10),
  'tW(RN)': ns(8),
  'trec(RN to CP)': ns(5),
};
const TPD = ns(3);

interface FlipFlopState {
  q: Level[];
  times: PinTimes;
}

/**
 * A two-bit D flip-flop with an active-low reset, the way a 74xx part uses the checks: a late or
 * early data bit becomes `X`; a short clock or reset pulse or an early edge makes both bits `X`.
 */
function flipFlop(edge: Edge) {
  const pins: PinDef[] = [
    { name: 'D0', dir: 'in' },
    { name: 'D1', dir: 'in' },
    { name: 'CP', dir: 'in', clock: true },
    { name: 'RN', dir: 'in', activeLow: true },
    { name: 'Q0', dir: 'out' },
    { name: 'Q1', dir: 'out' },
  ];
  const checks = new TimingChecks(pins, MIN);
  const data = checks.setupHold({
    data: 'D0, D1',
    clock: 'CP',
    edge,
    setup: 'tsu(Dn to CP)',
    hold: 'th(Dn to CP)',
  });
  const clockWidth = checks.pulseWidth({ pin: 'CP', level: 'both', width: 'tW(CP)' });
  const resetWidth = checks.pulseWidth({ pin: 'RN', level: 'low', width: 'tW(RN)' });
  const recovery = checks.recovery({
    pin: 'RN',
    active: 'low',
    clock: 'CP',
    edge,
    recovery: 'trec(RN to CP)',
  });
  return defineComponent<Record<string, never>, FlipFlopState>({
    type: `test/dff-${edge}`,
    name: 'FF',
    title: 'Test flip-flop',
    pins,
    create: () => ({
      createState: () => ({ q: [Level.X, Level.X], times: checks.createTimes() }),
      evaluate(ctx) {
        const { q, times } = ctx.state;
        // Held in reset, the flip-flop ignores its clock: no clock checks then.
        const armed = toInput(ctx.read(3)) !== Level.L0;
        const late = data.setup(ctx, times, armed);
        const early = data.hold(ctx, times, armed);
        const unsure =
          clockWidth.check(ctx, times, armed) ||
          resetWidth.check(ctx, times) ||
          recovery.check(ctx, times);
        const active = edge === 'rise' ? ctx.rose(2) : ctx.fell(2);
        if (toInput(ctx.read(3)) === Level.L0) {
          q[0] = Level.L0;
          q[1] = Level.L0;
        } else {
          for (let n = 0; n < 2; n++) {
            if (active) q[n] = toInput(ctx.read(n));
            if (((late | early) >> n) & 1 || unsure) q[n] = Level.X;
          }
        }
        ctx.drive(4, strong(q[0]!), TPD);
        ctx.drive(5, strong(q[1]!), TPD);
        checks.track(ctx, times);
      },
    }),
  });
}

const rising = flipFlop('rise');

/** A bench with RN high, D = 00, CP low, settled long ago (no phase or change counts). */
function bench(definition = rising, clock: 0 | 1 = 0): Bench {
  const b = new Bench(definition);
  b.set({ RN: 1, D0: 0, D1: 0, CP: clock }).settle();
  b.run(ns(100));
  return b;
}

const kinds = (b: Bench) => b.diagnostics.map((d) => `${d.kind} ${d.pin}`);

/** Raises CP `after` the data change made by `data`. */
function clockAfter(b: Bench, data: Record<string, 0 | 1>, after: Time) {
  b.set(data);
  b.run(after);
  b.set({ CP: 1 });
  b.run(ns(20));
}

describe('TimingChecks setup', () => {
  it('is silent when data is stable for the setup time', () => {
    const b = bench();
    clockAfter(b, { D0: 1 }, ns(6));
    b.expect({ Q0: 1, Q1: 0 }).expectNoDiagnostics();
  });

  it('reports a late data bit and only that bit goes X', () => {
    const b = bench();
    clockAfter(b, { D0: 1 }, ns(5));
    expect(b.diagnostics).toMatchObject([
      {
        kind: TimingViolation.SETUP,
        pin: 'D0',
        component: 'DUT',
        message: 'D0 changed 5 ns before CP rose (setup time ≥ 6 ns)',
      },
    ]);
    b.expect({ Q0: 'X', Q1: 0 });
  });

  it('treats data and clock changing at the same instant as one setup violation', () => {
    const b = bench();
    b.set({ D1: 1, CP: 1 });
    b.run(ns(20));
    expect(kinds(b)).toEqual(['setup-violation D1']);
    expect(b.diagnostics[0]!.message).toBe(
      'D1 changed at the same time as CP rose (setup time ≥ 6 ns)',
    );
    b.expect({ Q0: 0, Q1: 'X' });
  });

  it('ignores data changes away from the active edge', () => {
    const b = bench();
    b.set({ CP: 1 });
    b.run(ns(20));
    b.set({ D0: 1 }); // changes 20 ns after the edge, long before the next one
    b.run(ns(20));
    b.set({ CP: 0 });
    b.run(ns(20));
    b.expect({ Q0: 0 }).expectNoDiagnostics();
  });

  it('checks a falling-edge part on the falling edge', () => {
    const b = bench(flipFlop('fall'), 1);
    b.set({ D0: 1 });
    b.run(ns(4));
    b.set({ CP: 0 });
    b.run(ns(20));
    expect(b.diagnostics[0]!.message).toBe('D0 changed 4 ns before CP fell (setup time ≥ 6 ns)');
    b.expect({ Q0: 'X' });
  });
});

describe('TimingChecks hold', () => {
  it('is silent when data holds for the hold time', () => {
    const b = bench();
    b.set({ D0: 1 });
    b.run(ns(20));
    b.set({ CP: 1 });
    b.run(ns(2));
    b.set({ D0: 0 });
    b.run(ns(20));
    b.expect({ Q0: 1 }).expectNoDiagnostics();
  });

  it('reports data changing too soon after the edge and makes the loaded bit X', () => {
    const b = bench();
    b.set({ D0: 1 });
    b.run(ns(20));
    b.set({ CP: 1 });
    b.run(ns(1));
    b.set({ D0: 0 });
    b.run(ns(20));
    expect(b.diagnostics).toMatchObject([
      {
        kind: TimingViolation.HOLD,
        pin: 'D0',
        message: 'D0 changed 1 ns after CP rose (hold time ≥ 2 ns)',
      },
    ]);
    b.expect({ Q0: 'X', Q1: 0 });
  });
});

describe('TimingChecks pulse width', () => {
  it('reports a clock phase shorter than the minimum, HIGH or LOW', () => {
    const b = bench();
    b.set({ CP: 1 });
    b.run(ns(9));
    b.set({ CP: 0 });
    b.run(ns(9));
    b.set({ CP: 1 });
    b.run(ns(20));
    expect(b.diagnostics.map((d) => d.message)).toEqual([
      'CP was HIGH for only 9 ns (pulse width ≥ 10 ns)',
    ]);
    // Merged: the LOW phase was reported under the same kind, part and pin.
    expect(b.diagnostics[0]).toMatchObject({ kind: TimingViolation.PULSE_WIDTH, count: 2 });
    b.expect({ Q0: 'X', Q1: 'X' });
  });

  it('is silent at exactly the minimum', () => {
    const b = bench();
    b.set({ CP: 1 });
    b.run(ns(10));
    b.set({ CP: 0 });
    b.run(ns(10));
    b.set({ CP: 1 });
    b.run(ns(20));
    b.expectNoDiagnostics();
  });

  it.each([0, 1] as const)('does not count a phase that began from Z (CP = %s first)', (level) => {
    const b = new Bench(rising);
    b.set({ RN: 1, D0: 0, D1: 0 });
    b.run(ns(20));
    b.set({ CP: level }); // CP was Z until now: this phase has no start
    b.run(ns(5));
    b.set({ CP: level === 0 ? 1 : 0 });
    b.run(ns(20));
    b.expectNoDiagnostics();
  });

  it('reports a reset pulse that is too short; only the checked level counts', () => {
    const b = bench();
    b.set({ RN: 0 });
    b.run(ns(7));
    b.set({ RN: 1 });
    b.run(ns(1)); // HIGH phases of RN are not checked
    b.set({ RN: 0 });
    b.run(ns(20));
    expect(b.diagnostics).toMatchObject([
      {
        kind: TimingViolation.PULSE_WIDTH,
        pin: 'RN',
        message: 'RN was LOW for only 7 ns (pulse width ≥ 8 ns)',
        count: 1,
      },
    ]);
  });
});

/** A part that only checks the cycle time of its pin `E` (rising edges); `ARM` low disarms. */
const cycler = (() => {
  const pins: PinDef[] = [
    { name: 'E', dir: 'in' },
    { name: 'ARM', dir: 'in' },
  ];
  const checks = new TimingChecks(pins, { tcycE: ns(500) });
  const cycle = checks.cycle({ pin: 'E', edge: 'rise', cycle: 'tcycE' });
  return defineComponent<Record<string, never>, PinTimes>({
    type: 'test/cycle',
    name: 'CYC',
    title: 'Test cycle check',
    pins,
    create: () => ({
      createState: () => checks.createTimes(),
      evaluate(ctx) {
        cycle.check(ctx, ctx.state, toInput(ctx.read(1)) !== Level.L0);
        checks.track(ctx, ctx.state);
      },
    }),
  });
})();

/** Pulses E: HIGH for `high`, then LOW for `low`. */
function pulse(b: Bench, high: Time, low: Time) {
  b.set({ E: 1 });
  b.run(high);
  b.set({ E: 0 });
  b.run(low);
}

describe('TimingChecks cycle', () => {
  it('is silent at exactly the cycle time and reports a shorter one', () => {
    const b = new Bench(cycler);
    b.set({ E: 0, ARM: 1 }).settle();
    pulse(b, ns(250), ns(250)); // the first edge has nothing before it
    pulse(b, ns(250), ns(249));
    b.expectNoDiagnostics();
    pulse(b, ns(250), ns(250));
    expect(b.diagnostics).toMatchObject([
      {
        kind: TimingViolation.CYCLE,
        pin: 'E',
        message: 'E rose again 499 ns after it last rose (cycle time ≥ 500 ns)',
      },
    ]);
  });

  it('only counts the active edge and skips while disarmed', () => {
    const b = new Bench(cycler);
    b.set({ E: 1, ARM: 1 }).settle();
    b.run(ns(1000));
    b.set({ E: 0 }); // a fall is not a cycle
    b.run(ns(10));
    pulse(b, ns(100), ns(100)); // 1st rise
    b.set({ ARM: 0 });
    pulse(b, ns(100), ns(100)); // 200 ns after it, disarmed
    b.expectNoDiagnostics();
  });

  it('does not count an edge from Z or X', () => {
    const b = new Bench(cycler);
    b.set({ ARM: 1 });
    b.run(ns(10));
    b.set({ E: 1 }); // from Z
    b.run(ns(10));
    b.set({ E: 'X' });
    b.run(ns(10));
    b.set({ E: 1 }); // from X
    b.run(ns(10));
    b.expectNoDiagnostics();
  });
});

describe('TimingChecks recovery', () => {
  it('reports a clock edge too soon after the reset is released', () => {
    const b = bench();
    b.set({ RN: 0 });
    b.run(ns(20));
    b.set({ RN: 1, D0: 1 });
    b.run(ns(20)); // data stable; the edge comes in time for setup
    expect(b.diagnostics).toEqual([]);
    b.set({ RN: 0 });
    b.run(ns(20));
    b.set({ RN: 1 });
    b.run(ns(4));
    b.set({ CP: 1 });
    b.run(ns(20));
    expect(b.diagnostics).toMatchObject([
      {
        kind: TimingViolation.RECOVERY,
        pin: 'RN',
        message: 'CP rose 4 ns after RN was released (recovery time ≥ 5 ns)',
      },
    ]);
    b.expect({ Q0: 'X', Q1: 'X' });
  });

  it('is silent at exactly the recovery time and reports a release at the same instant', () => {
    const b = bench();
    b.set({ RN: 0 });
    b.run(ns(20));
    b.set({ RN: 1 });
    b.run(ns(5));
    b.set({ CP: 1 });
    b.run(ns(20));
    b.expectNoDiagnostics();
    b.set({ CP: 0, RN: 0 });
    b.run(ns(20));
    b.set({ RN: 1, CP: 1 });
    b.run(ns(20));
    expect(b.diagnostics.map((d) => d.message)).toEqual([
      'CP rose at the same time as RN was released (recovery time ≥ 5 ns)',
    ]);
  });
});

describe('TimingChecks armed', () => {
  it('skips the clock checks while the part ignores its clock', () => {
    const b = bench();
    b.set({ RN: 0 }).run(ns(20));
    b.set({ D0: 1, CP: 1 }).run(ns(1)); // data with the edge, in reset: no setup violation
    b.set({ D1: 1 }).run(ns(1)); // nor hold
    b.set({ CP: 0 }).run(ns(20)); // nor pulse width
    b.expect({ Q0: 0, Q1: 0 }).expectNoDiagnostics();
  });
});

describe('TimingChecks observe', () => {
  it("doesn't read the pins it watches: a floating data input away from an edge isn't used", () => {
    // `ctx.rose`/`ctx.fell` read the pin; `track` must not use them (regression).
    const b = bench();
    b.set({ D0: 'Z' }).run(ns(20));
    b.expectNoDiagnostics();
    b.set({ CP: 1 }).run(ns(20)); // the edge reads D0: now it is reported
    expect(b.diagnostics.map((d) => `${d.kind} ${d.net}`)).toEqual(['floating-input D0']);
  });
});

describe('TimingChecks across a carry-over', () => {
  const registry = new Registry([rising, testDriver]);
  const netlist = (() => {
    const b = new NetlistBuilder().add('FF', rising.type);
    for (const pin of ['D0', 'D1', 'CP', 'RN']) {
      b.add(pin, testDriver.type).net(pin, `${pin}.Y`, `FF.${pin}`);
    }
    return b.build();
  })();
  const set = (sim: Simulator, values: Record<string, 0 | 1>) => {
    for (const [pin, value] of Object.entries(values)) sim.action(pin, strong(value));
  };

  it('keeps the change times, and the forced evaluation records nothing', () => {
    let sim = new Simulator(netlist, registry);
    set(sim, { RN: 1, D0: 0, D1: 0, CP: 0 });
    sim.runFor(ns(100));
    set(sim, { D0: 1 });
    sim.runFor(ns(3));
    // Recompile between the data change and the edge: the new simulator must still know when D0
    // changed, and its forced evaluation must not count as a change.
    sim = new Simulator(netlist, registry, { carry: sim.carryOver() });
    sim.runFor(ns(2));
    set(sim, { CP: 1 });
    sim.runFor(ns(20));
    expect(sim.diagnostics.entries.map((d) => d.message)).toEqual([
      'D0 changed 5 ns before CP rose (setup time ≥ 6 ns)',
    ]);
  });
});

/**
 * Two clocks, the 74HC595's way: SH rising must come `tsu(SH to ST)` before ST rises, except at
 * the same instant (tied clocks); and the 193's: CPD must stay HIGH `th(CPU to CPD)` after CPU
 * rose (hold only). LATE and EARLY show the masks of the last check that fired.
 */
const clocks = (() => {
  const pins: PinDef[] = [
    { name: 'SH', dir: 'in', clock: true },
    { name: 'ST', dir: 'in', clock: true },
    { name: 'CPU', dir: 'in', clock: true },
    { name: 'CPD', dir: 'in', clock: true },
    { name: 'LATE', dir: 'out' },
    { name: 'EARLY', dir: 'out' },
  ];
  const checks = new TimingChecks(pins, { 'tsu(SH to ST)': ns(15), 'th(CPU to CPD)': ns(16) });
  const shift = checks.setupHold({
    data: 'SH',
    clock: 'ST',
    edge: 'rise',
    setup: 'tsu(SH to ST)',
    dataEdge: 'rise',
    sameInstantAllowed: true,
  });
  const held = checks.setupHold({
    data: 'CPD',
    clock: 'CPU',
    edge: 'rise',
    hold: 'th(CPU to CPD)',
    dataEdge: 'fall',
  });
  return defineComponent<Record<string, never>, { times: PinTimes }>({
    type: 'test/clocks',
    name: 'CLK',
    title: 'Test clocks',
    pins,
    create: () => ({
      createState: () => ({ times: checks.createTimes() }),
      evaluate(ctx) {
        const { times } = ctx.state;
        const late = shift.setup(ctx, times) | held.setup(ctx, times);
        const early = shift.hold(ctx, times) | held.hold(ctx, times);
        if (ctx.rose(1)) ctx.drive(4, strong(late ? Level.L1 : Level.L0), TPD);
        if (ctx.changed(3)) ctx.drive(5, strong(early ? Level.L1 : Level.L0), TPD);
        checks.track(ctx, times);
      },
    }),
  });
})();

function clockBench(): Bench {
  const b = new Bench(clocks);
  b.set({ SH: 0, ST: 0, CPU: 1, CPD: 1 }).settle();
  b.run(ns(100));
  return b;
}

const messages = (b: Bench) => b.diagnostics.map((d) => d.message);

describe('TimingChecks edge to edge', () => {
  it("measures from the data pin's edge, not from any change", () => {
    const b = clockBench();
    b.set({ SH: 1 });
    b.run(ns(20));
    b.set({ SH: 0 }); // the falling edge right before ST doesn't count
    b.run(ns(5));
    b.set({ ST: 1 });
    b.run(ns(20));
    b.expect({ LATE: 0 }).expectNoDiagnostics();
  });

  it('reports the data edge too close before the clock edge, naming the edge', () => {
    const b = clockBench();
    b.set({ SH: 1 });
    b.run(ns(14));
    b.set({ ST: 1 });
    b.run(ns(20));
    b.expect({ LATE: 1 });
    expect(messages(b)).toEqual(['SH rose 14 ns before ST rose (setup time ≥ 15 ns)']);
    expect(kinds(b)).toEqual([`${TimingViolation.SETUP} SH`]);
  });

  it('is silent at exactly the setup time and at the same instant (tied clocks)', () => {
    const b = clockBench();
    b.set({ SH: 1 });
    b.run(ns(15));
    b.set({ ST: 1 });
    b.run(ns(20));
    b.set({ SH: 0, ST: 0 });
    b.run(ns(100));
    b.set({ SH: 1, ST: 1 });
    b.run(ns(20));
    b.expect({ LATE: 0 }).expectNoDiagnostics();
  });

  it('counts a same-instant edge from an earlier delta as allowed too', () => {
    const b = clockBench();
    b.set({ SH: 1 });
    b.settle(); // SH's change is evaluated in its own delta, ST rises in a later one at that time
    b.set({ ST: 1 });
    b.run(ns(20));
    b.expectNoDiagnostics();
  });
});

describe('TimingChecks hold only', () => {
  it('never checks a setup time', () => {
    const b = clockBench();
    b.set({ CPD: 0 });
    b.run(ns(1));
    b.set({ CPD: 1 });
    b.run(ns(1));
    b.set({ CPU: 0 });
    b.run(ns(50));
    b.set({ CPU: 1 }); // CPD rose 52 ns ago and changed 1 ns before: no setup time to break
    b.run(ns(50));
    b.expectNoDiagnostics();
  });

  it('reports the other clock falling too soon after the counting edge, not rising', () => {
    const b = clockBench();
    b.set({ CPU: 0 });
    b.run(ns(50));
    b.set({ CPU: 1 });
    b.run(ns(16));
    b.set({ CPD: 0 }); // exactly the hold time: fine
    b.run(ns(50));
    b.set({ CPD: 1, CPU: 0 });
    b.run(ns(50));
    b.set({ CPU: 1 });
    b.run(ns(10));
    b.set({ CPD: 0 });
    b.run(ns(20));
    b.expect({ EARLY: 1 });
    expect(messages(b)).toEqual(['CPD fell 10 ns after CPU rose (hold time ≥ 16 ns)']);
  });

  it('ignores a rise of the data pin within the hold time', () => {
    const b = clockBench();
    b.set({ CPD: 0 });
    b.run(ns(50));
    b.set({ CPU: 0 });
    b.run(ns(50));
    b.set({ CPU: 1 });
    b.run(ns(5));
    b.set({ CPD: 1 });
    b.run(ns(20));
    b.expect({ EARLY: 0 }).expectNoDiagnostics();
  });
});

describe('TimingChecks definition', () => {
  const pins: PinDef[] = [
    { name: 'D', dir: 'in' },
    { name: 'CP', dir: 'in' },
  ];

  it('throws on an unknown pin or a missing minimum', () => {
    const checks = new TimingChecks(pins, { tsu: ns(1) });
    expect(() => checks.setupHold({ data: 'Q', clock: 'CP', edge: 'rise', setup: 'tsu' })).toThrow(
      /no pin "Q"/,
    );
    expect(() => checks.setupHold({ data: 'D', clock: 'CP', edge: 'rise', setup: 'th' })).toThrow(
      'missing minimum "th"',
    );
  });

  it('needs a setup or a hold time', () => {
    const checks = new TimingChecks(pins, {});
    expect(() => checks.setupHold({ data: 'D', clock: 'CP', edge: 'rise' })).toThrow(
      'setup/hold check on D without a setup or hold time',
    );
  });

  it('allows a zero minimum, which never fires', () => {
    const checks = new TimingChecks(pins, { tsu: ns(1), th: 0 });
    expect(() =>
      checks.setupHold({ data: 'D', clock: 'CP', edge: 'rise', setup: 'tsu', hold: 'th' }),
    ).not.toThrow();
  });

  it('starts every time at -Infinity', () => {
    const times = new TimingChecks(pins).createTimes();
    expect(times).toHaveLength(6);
    expect([...times].every((t) => t === -Infinity)).toBe(true);
  });

  it('tells timing violations from other diagnostics', () => {
    for (const kind of Object.values(TimingViolation)) expect(isTimingViolation(kind)).toBe(true);
    expect(isTimingViolation('contention')).toBe(false);
  });
});
