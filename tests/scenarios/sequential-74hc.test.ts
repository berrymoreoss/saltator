/**
 * Sequential circuits from real chips, as on a breadboard: a shift chain of 74HC74s, a ripple
 * counter of 74HC107s, a race between data and clock that the set-up check catches, and Ben
 * Eater's A register (two 74HC173s and a 74HC245 on a bus). Delays and minima are the 74HC data
 * sheets' (4.5 V): 74 tpd 17 ns, tsu 15, th 3, tW 20; 107 tpd 19; 08 tpd 9; 04 tpd 9.
 */
import { describe, expect, it } from 'vitest';
import {
  isTimingViolation,
  KernelDiagnosticKind,
  ns,
  type Simulator,
  type Time,
  TimingViolation,
  us,
} from '../../src/core';
import { levels, set, simulate } from './support';

const violations = (sim: Simulator) =>
  sim.diagnostics.entries.filter((d) => isTimingViolation(d.kind));

/** Every change of `net` as `time=level`, from now on. */
function watch(sim: Simulator, net: string): string[] {
  const seen: string[] = [];
  const index = sim.netIndex(net);
  sim.onNetChange((t, n, level) => {
    if (n === index) seen.push(`${t / 1000}=${'01XZ'[level]}`);
  });
  return seen;
}

describe('a shift register of 74HC74s on one clock', () => {
  /** Four flip-flops (two chips), Q → next D, a common clock from a driver. */
  function chain(): Simulator {
    return simulate((b) => {
      b.add('U1', '74xx/74hc74').add('U2', '74xx/74hc74').add('V', 'io/vcc');
      b.add('DIN', 'test/driver').add('CLK', 'test/driver').add('CLR', 'test/driver');
      const ff = ['U1.1', 'U1.2', 'U2.1', 'U2.2'];
      b.net('din', 'DIN.Y', `${ff[0]}D`);
      b.net('clk', 'CLK.Y', ...ff.map((f) => `${f}CP`));
      b.net('clr', 'CLR.Y', ...ff.map((f) => `${f}RD`));
      b.connect('V.Y', ...ff.map((f) => `${f}SD`));
      ff.forEach((f, i) => {
        b.net(`q${i}`, `${f}Q`, ...(i < 3 ? [`${ff[i + 1]}D`] : []));
      });
      return b;
    });
  }
  const tick = (sim: Simulator, period: Time) => {
    set(sim, 'CLK', 1);
    sim.runFor(period / 2);
    set(sim, 'CLK', 0);
    sim.runFor(period / 2);
  };

  it('shifts a 1 through, one stage per edge; Q changing 17 ns after the edge holds long enough', () => {
    const sim = chain();
    set(sim, 'DIN', 0);
    set(sim, 'CLK', 0);
    set(sim, 'CLR', 0);
    sim.runFor(us(1));
    set(sim, 'CLR', 1);
    sim.runFor(us(1));
    set(sim, 'DIN', 1);
    sim.runFor(us(1));
    tick(sim, us(1));
    set(sim, 'DIN', 0);
    sim.runFor(us(1)); // not at the edge: that would be a race
    const seen = [levels(sim, 'q0', 'q1', 'q2', 'q3')];
    for (let i = 0; i < 4; i++) {
      tick(sim, us(1));
      seen.push(levels(sim, 'q0', 'q1', 'q2', 'q3'));
    }
    expect(seen).toEqual(['1000', '0100', '0010', '0001', '0000']);
    // Each D changes tpd = 17 ns after the edge that clocks the next stage: th = 3 ns is met.
    expect(violations(sim)).toEqual([]);
  });

  it('at 30 MHz the clock pulses are too short for a 74HC74 (tW 20 ns): reported, data unknown', () => {
    const sim = chain();
    set(sim, 'DIN', 1);
    set(sim, 'CLK', 0);
    set(sim, 'CLR', 0);
    sim.runFor(us(1));
    set(sim, 'CLR', 1);
    sim.runFor(us(1));
    for (let i = 0; i < 4; i++) tick(sim, ns(33)); // 16.5 ns HIGH and LOW
    // Every clock pin is reported; the unknown data then races into the next stages' checks too.
    expect(violations(sim).map((d) => `${d.kind} ${d.component}.${d.pin}`)).toEqual(
      expect.arrayContaining([
        'pulse-width-violation U1.1CP',
        'pulse-width-violation U1.2CP',
        'pulse-width-violation U2.1CP',
        'pulse-width-violation U2.2CP',
      ]),
    );
    expect(levels(sim, 'q0')).toBe('X');
  });
});

describe('a ripple counter of 74HC107s', () => {
  it('counts on falling edges, each stage 19 ns after the one before it', () => {
    const sim = simulate((b) => {
      b.add('U1', '74xx/74hc107').add('U2', '74xx/74hc107').add('V', 'io/vcc');
      b.add('CLK', 'test/driver').add('CLR', 'test/driver');
      const ff = ['U1.1', 'U1.2', 'U2.1', 'U2.2'];
      for (const f of ff) b.connect('V.Y', `${f}J`, `${f}K`); // J = K = H: toggle
      b.net('clr', 'CLR.Y', ...ff.map((f) => `${f}R`));
      b.net('clk', 'CLK.Y', `${ff[0]}CP`);
      ff.forEach((f, i) => {
        b.net(`q${i}`, `${f}Q`, ...(i < 3 ? [`${ff[i + 1]}CP`] : []));
      });
      return b;
    });
    set(sim, 'CLK', 1);
    set(sim, 'CLR', 0);
    sim.runFor(us(1));
    set(sim, 'CLR', 1);
    sim.runFor(us(1));
    const count = () => Number.parseInt(levels(sim, 'q3', 'q2', 'q1', 'q0'), 2);
    const counts: number[] = [];
    for (let i = 0; i < 15; i++) {
      set(sim, 'CLK', 0);
      sim.runFor(us(1));
      counts.push(count());
      set(sim, 'CLK', 1);
      sim.runFor(us(1));
    }
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    // 15 → 0 ripples through all four stages: the outputs fall one after another, 19 ns apart,
    // passing through 14, 12 and 8 on the way (the glitches a ripple counter is known for).
    const t0 = sim.now;
    const q = [0, 1, 2, 3].map((n) => watch(sim, `q${n}`));
    set(sim, 'CLK', 0);
    sim.runFor(us(1));
    expect(count()).toBe(0);
    expect(q.map((changes) => changes.map((c) => Number(c.split('=')[0]) - t0 / 1000))).toEqual([
      [19],
      [38],
      [57],
      [76],
    ]);
    expect(violations(sim)).toEqual([]);
  });
});

describe('a race between data and clock', () => {
  /** One switch drives a 74HC74's D directly and its clock through `gates` 74HC08 ANDs. */
  function race(gates: number): Simulator {
    return simulate((b) => {
      b.add('U1', '74xx/74hc74')
        .add('U2', '74xx/74hc08')
        .add('V', 'io/vcc')
        .add('SW', 'test/driver');
      b.connect('V.Y', 'U1.1SD', 'U1.1RD', 'U2.1B', 'U2.2B', 'U2.3B', 'U2.4B');
      b.net('sw', 'SW.Y', 'U1.1D', 'U2.1A');
      for (let g = 1; g < gates; g++) b.connect(`U2.${g}Y`, `U2.${g + 1}A`);
      b.connect(`U2.${gates}Y`, 'U1.1CP');
      b.net('q', 'U1.1Q');
      return b;
    });
  }
  const flip = (sim: Simulator) => {
    set(sim, 'SW', 0);
    sim.runFor(us(1));
    set(sim, 'SW', 1);
    sim.runFor(us(1));
  };

  it('one AND (9 ns) is not enough set-up time (15 ns): reported, and the flip-flop is unknown', () => {
    const sim = race(1);
    flip(sim);
    expect(violations(sim)).toMatchObject([
      {
        kind: TimingViolation.SETUP,
        component: 'U1',
        pin: '1D',
        message: '1D changed 9 ns before 1CP rose (setup time ≥ 15 ns)',
      },
    ]);
    expect(levels(sim, 'q')).toBe('X');
  });

  it('two ANDs (18 ns) delay the clock enough: Q = 1, no violation', () => {
    const sim = race(2);
    flip(sim);
    expect(violations(sim)).toEqual([]);
    expect(levels(sim, 'q')).toBe('1');
  });
});

describe("Ben Eater's A register: two 74HC173s and a 74HC245 on a bus", () => {
  /**
   * Bus B0–B7 with pull-downs; switches put a value on it through a 245 (`SWOUT`); the register
   * loads from it on CLK when `LOAD` is LOW and drives it back through a second 245 when `OUT` is
   * LOW. The 173s' outputs are always enabled (M, N = OE1, OE2 to GND), CLR on MR.
   */
  function register(): Simulator {
    return simulate((b) => {
      b.add('U1', '74xx/74hc173').add('U2', '74xx/74hc173');
      b.add('U3', '74xx/74hc245').add('U4', '74xx/74hc245');
      b.add('G', 'io/gnd').add('V', 'io/vcc');
      for (const id of ['CLK', 'LOAD', 'CLR', 'OUT', 'SWOUT']) b.add(id, 'test/driver');
      b.net('clk', 'CLK.Y', 'U1.CP', 'U2.CP');
      b.net('load', 'LOAD.Y', 'U1.E1', 'U1.E2', 'U2.E1', 'U2.E2');
      b.net('clr', 'CLR.Y', 'U1.MR', 'U2.MR');
      b.connect('G.Y', 'U1.OE1', 'U1.OE2', 'U2.OE1', 'U2.OE2');
      b.connect('V.Y', 'U3.DIR', 'U4.DIR');
      b.net('out', 'OUT.Y', 'U4.OE');
      b.net('swout', 'SWOUT.Y', 'U3.OE');
      for (let n = 0; n < 8; n++) {
        const [chip, bit] = n < 4 ? ['U1', n] : ['U2', n - 4];
        b.add(`S${n}`, 'test/driver').add(`R${n}`, 'prim/pull', { direction: 'down' });
        b.net(`s${n}`, `S${n}.Y`, `U3.A${n}`);
        b.net(`B${n}`, `U3.B${n}`, `U4.B${n}`, `R${n}.Y`, `${chip}.D${bit}`);
        b.net(`A${n}`, `${chip}.Q${bit}`, `U4.A${n}`);
      }
      return b;
    });
  }
  const BUS = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `B${n}`).reverse();
  const REG = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `A${n}`).reverse();
  /** Switches set to `value` (8 bits, MSB first). */
  const switches = (sim: Simulator, value: string) => {
    for (const [n, bit] of [...value].reverse().entries()) set(sim, `S${n}`, bit === '1' ? 1 : 0);
  };
  const pulse = (sim: Simulator) => {
    set(sim, 'CLK', 1);
    sim.runFor(us(1));
    set(sim, 'CLK', 0);
    sim.runFor(us(1));
  };
  function cleared(): Simulator {
    const sim = register();
    for (const [id, v] of [
      ['CLK', 0],
      ['LOAD', 1],
      ['CLR', 1],
      ['OUT', 1],
      ['SWOUT', 1],
    ] as const)
      set(sim, id, v);
    switches(sim, '00000000');
    sim.runFor(us(1));
    set(sim, 'CLR', 0);
    sim.runFor(us(1));
    return sim;
  }

  it('loads the bus on a clock pulse with LOAD low, and puts it back on the bus with OUT low', () => {
    const sim = cleared();
    expect(levels(sim, ...REG)).toBe('00000000');
    expect(levels(sim, ...BUS)).toBe('00000000'); // pulled down: nobody drives it
    switches(sim, '10100101');
    set(sim, 'SWOUT', 0);
    sim.runFor(us(1));
    expect(levels(sim, ...BUS)).toBe('10100101');
    pulse(sim); // LOAD high: nothing
    expect(levels(sim, ...REG)).toBe('00000000');
    set(sim, 'LOAD', 0);
    sim.runFor(us(1));
    pulse(sim);
    set(sim, 'LOAD', 1);
    expect(levels(sim, ...REG)).toBe('10100101');
    set(sim, 'SWOUT', 1);
    switches(sim, '11111111');
    sim.runFor(us(1));
    expect(levels(sim, ...BUS)).toBe('00000000');
    set(sim, 'OUT', 0);
    sim.runFor(us(1));
    expect(levels(sim, ...BUS)).toBe('10100101'); // the register on the bus
    expect(violations(sim)).toEqual([]);
    expect(
      sim.diagnostics.entries.filter((d) => d.kind === KernelDiagnosticKind.CONTENTION),
    ).toEqual([]);
  });

  it('two drivers on the bus at once is contention', () => {
    const sim = cleared();
    switches(sim, '11111111');
    set(sim, 'SWOUT', 0);
    set(sim, 'OUT', 0);
    sim.runFor(us(1));
    expect(sim.diagnostics.entries.some((d) => d.kind === KernelDiagnosticKind.CONTENTION)).toBe(
      true,
    );
    expect(levels(sim, ...BUS)).toBe('XXXXXXXX');
  });
});
