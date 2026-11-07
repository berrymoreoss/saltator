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
