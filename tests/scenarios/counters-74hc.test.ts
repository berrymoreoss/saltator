/**
 * Counters and shift registers from real chips, as on a breadboard: two 74HC161s cascaded into
 * an 8-bit counter, the decoding glitch of a 74HC4040's ripple, two 74HC595s cascaded through
 * Q7S, and a 74HC165 sending a byte serially into a 74HC595 on one clock. Delays and minima are
 * the 74HC data sheets' (4.5 V): 161 CP→Q 22 ns, CP→TC 25, CET→TC 12, tsu CEP/CET 34; 4040
 * CP̅→Q0 17, 10 per stage; 595 SHCP→Q7S 19, tsu DS 10, th 3; 165 CP→Q7 19.
 */
import { describe, expect, it } from 'vitest';
import { isTimingViolation, ns, type Simulator, type Time, us } from '../../src/core';
import { levels, set, simulate } from './support';

const violations = (sim: Simulator) =>
  sim.diagnostics.entries.filter((d) => isTimingViolation(d.kind));

/** A value from nets `prefix0` (bit 0) …, or -1 while any bit is unknown. */
function value(sim: Simulator, nets: readonly string[]): number {
  const bits = levels(sim, ...nets);
  if (/[^01]/.test(bits)) return -1;
  return [...bits].reduce((v, bit, n) => v | (bit === '1' ? 1 << n : 0), 0);
}

const pulse = (sim: Simulator, driver: string, period: Time = ns(200)) => {
  set(sim, driver, 1);
  sim.runFor(period / 2);
  set(sim, driver, 0);
  sim.runFor(period / 2);
};

describe('an 8-bit counter from two 74HC161s', () => {
  /** Low counter's TC → high counter's CET (the data sheet's synchronous cascade). */
  function counter(): Simulator {
    return simulate((b) => {
      b.add('LO', '74xx/74hc161').add('HI', '74xx/74hc161');
      b.add('CLK', 'test/driver').add('CLR', 'test/driver').add('EN', 'test/driver');
      b.add('V', 'io/vcc');
      b.net('clk', 'CLK.Y', 'LO.CP', 'HI.CP');
      b.net('clr', 'CLR.Y', 'LO.MR', 'HI.MR');
      b.net('en', 'EN.Y', 'LO.CEP', 'LO.CET', 'HI.CEP');
      b.net('carry', 'LO.TC', 'HI.CET');
      b.connect('V.Y', 'LO.PE', 'HI.PE');
      for (let n = 0; n < 4; n++) {
        b.net(`q${n}`, `LO.Q${n}`);
        b.net(`q${n + 4}`, `HI.Q${n}`);
      }
      return b;
    });
  }
  const Q = Array.from({ length: 8 }, (_, n) => `q${n}`);

  it('counts 0 to 255 and wraps; the high counter steps exactly when the low one wraps', () => {
    const sim = counter();
    set(sim, 'CLK', 0);
    set(sim, 'EN', 1);
    set(sim, 'CLR', 0);
    sim.runFor(us(1));
    set(sim, 'CLR', 1);
    sim.runFor(us(1));
    for (let count = 1; count <= 260; count++) {
      pulse(sim, 'CLK');
      expect(value(sim, Q), `after ${count} clocks`).toBe(count & 255);
    }
    expect(levels(sim, 'HI.TC')).toBe('0');
    expect(violations(sim)).toEqual([]);
  });

  it('holds while the enable is LOW, the carry included', () => {
    const sim = counter();
    set(sim, 'CLK', 0);
    set(sim, 'EN', 1);
    set(sim, 'CLR', 0);
    sim.runFor(us(1));
    set(sim, 'CLR', 1);
    sim.runFor(us(1));
    for (let i = 0; i < 15; i++) pulse(sim, 'CLK');
    expect(levels(sim, 'carry')).toBe('1');
    set(sim, 'EN', 0);
    sim.runFor(us(1));
    expect(levels(sim, 'carry')).toBe('0');
    pulse(sim, 'CLK');
    expect(value(sim, Q)).toBe(15);
  });

  it('counts wrong when the clock beats the carry: CET set-up is reported, the count goes X', () => {
    // At 15 the carry rises 25 ns after the edge; a 50 ns period leaves 25 ns before the next
    // edge, less than tsu(CEP, CET to CP) = 34 ns.
    const sim = counter();
    set(sim, 'CLK', 0);
    set(sim, 'EN', 1);
    set(sim, 'CLR', 0);
    sim.runFor(us(1));
    set(sim, 'CLR', 1);
    sim.runFor(us(1));
    for (let i = 0; i < 14; i++) pulse(sim, 'CLK');
    pulse(sim, 'CLK', ns(50)); // 15: the carry rises 25 ns later
    pulse(sim, 'CLK', ns(50)); // the high counter's CET is late
    sim.runFor(us(1));
    expect(violations(sim).map((d) => d.message)).toEqual([
      'CET changed 25 ns before CP rose (setup time ≥ 34 ns)',
    ]);
    expect(value(sim, Q.slice(0, 4))).toBe(0);
    expect(levels(sim, 'q4')).toBe('X');
  });
});

describe('decoding a 74HC4040 ripple counter', () => {
  it('glitches: a NOR of Q0–Q2 sees count 0 for 10 ns on the way from 3 to 4', () => {
    const sim = simulate((b) => {
      b.add('U1', '74xx/74hc4040').add('N1', 'prim/nor', { inputs: 3, delay: ns(1) });
      b.add('CLK', 'test/driver').add('MR', 'test/driver');
      b.net('clk', 'CLK.Y', 'U1.CP').net('mr', 'MR.Y', 'U1.MR');
      b.net('q0', 'U1.Q0', 'N1.A').net('q1', 'U1.Q1', 'N1.B').net('q2', 'U1.Q2', 'N1.C');
      b.net('zero', 'N1.Y');
      return b;
    });
    set(sim, 'CLK', 1);
    set(sim, 'MR', 1);
    sim.runFor(us(1));
    set(sim, 'MR', 0);
    sim.runFor(us(1));
    expect(levels(sim, 'zero')).toBe('1');
    for (let i = 0; i < 3; i++) pulse(sim, 'CLK');
    expect(levels(sim, 'q2', 'q1', 'q0', 'zero')).toBe('0110');
    set(sim, 'CLK', 1);
    sim.runFor(us(1));
    const seen: string[] = [];
    const zero = sim.netIndex('zero');
    const start = sim.now;
    sim.onNetChange((t, net, level) => {
      if (net === zero) seen.push(`${(t - start) / 1000}=${'01XZ'[level]}`);
    });
    set(sim, 'CLK', 0); // 3 → 4: Q0 falls at 17 ns (2), Q1 at 27 (0), Q2 rises at 37 (4)
    sim.runFor(us(1));
    expect(seen).toEqual(['28=1', '38=0']);
    expect(levels(sim, 'q2', 'q1', 'q0')).toBe('100');
  });
});

describe('74HC595s', () => {
  it('cascade through Q7S: 16 bits shifted in, both latched at once', () => {
    const sim = simulate((b) => {
      b.add('U1', '74xx/74hc595').add('U2', '74xx/74hc595').add('G', 'io/gnd');
      b.add('DS', 'test/driver').add('SH', 'test/driver').add('ST', 'test/driver');
      b.add('MR', 'test/driver');
      b.net('ds', 'DS.Y', 'U1.DS').net('chain', 'U1.Q7S', 'U2.DS');
      b.net('sh', 'SH.Y', 'U1.SHCP', 'U2.SHCP').net('st', 'ST.Y', 'U1.STCP', 'U2.STCP');
      b.net('mr', 'MR.Y', 'U1.MR', 'U2.MR');
      b.connect('G.Y', 'U1.OE', 'U2.OE');
      for (let n = 0; n < 8; n++) b.net(`q${n}`, `U1.Q${n}`).net(`q${n + 8}`, `U2.Q${n}`);
      return b;
    });
    const Q = Array.from({ length: 16 }, (_, n) => `q${n}`);
    for (const d of ['SH', 'ST', 'DS']) set(sim, d, 0);
    set(sim, 'MR', 0);
    sim.runFor(us(1));
    set(sim, 'MR', 1);
    sim.runFor(us(1));
    const word = 0xb5_3c;
    for (let n = 15; n >= 0; n--) {
      set(sim, 'DS', (word >> n) & 1 ? 1 : 0);
      sim.runFor(ns(100));
      pulse(sim, 'SH');
    }
    expect(value(sim, Q)).toBe(-1); // nothing stored yet: X since power-on
    pulse(sim, 'ST');
    expect(value(sim, Q)).toBe(word);
    expect(violations(sim)).toEqual([]);
  });
});

describe('a 74HC165 sending a byte into a 74HC595', () => {
  it('on one clock: the 595 samples Q7 at the edge, before the 165 moves it on', () => {
    const sim = simulate((b) => {
      b.add('IN', '74xx/74hc165').add('OUT', '74xx/74hc595');
      b.add('G', 'io/gnd').add('V', 'io/vcc');
      b.add('CLK', 'test/driver').add('LOAD', 'test/driver').add('LATCH', 'test/driver');
      for (let n = 0; n < 8; n++) b.add(`D${n}`, 'test/driver').net(`d${n}`, `D${n}.Y`, `IN.D${n}`);
      b.net('clk', 'CLK.Y', 'IN.CP', 'OUT.SHCP').net('pl', 'LOAD.Y', 'IN.PL');
      b.net('serial', 'IN.Q7', 'OUT.DS').net('latch', 'LATCH.Y', 'OUT.STCP');
      b.connect('G.Y', 'IN.CE', 'IN.DS', 'OUT.OE').connect('V.Y', 'OUT.MR');
      for (let n = 0; n < 8; n++) b.net(`q${n}`, `OUT.Q${n}`);
      return b;
    });
    const byte = 0b1100_1010;
    for (let n = 0; n < 8; n++) set(sim, `D${n}`, (byte >> n) & 1 ? 1 : 0);
    set(sim, 'CLK', 0);
    set(sim, 'LATCH', 0);
    set(sim, 'LOAD', 0);
    sim.runFor(us(1));
    set(sim, 'LOAD', 1);
    sim.runFor(us(1));
    // D7 leaves first and ends in the 595's stage 7, D0 last in stage 0.
    for (let i = 0; i < 8; i++) pulse(sim, 'CLK', ns(100));
    pulse(sim, 'LATCH');
    expect(
      value(
        sim,
        Array.from({ length: 8 }, (_, n) => `q${n}`),
      ),
    ).toBe(byte);
    expect(violations(sim)).toEqual([]);
  });
});
