/**
 * The kernel's lookahead (R14, `stopBefore`) on real clock sources: a run stops right before a
 * clock's next rising edge — the next instant processed is the edge — with the cycle before it
 * settled, as the debugger's Step Clock pauses. An `io/clock` gated through a 74HC08 drives a
 * 74HC161 (CP→Qn 22 ns typical, Nexperia 74HC161, 4.5 V); an NE555 runs astable.
 */
import { describe, expect, it } from 'vitest';
import { Level, ns, type Simulator, us } from '../../src/core';
import { levels, set, simulate } from './support';

/** Runs until right before `net` next rises; then the next instant processed must be the edge. */
function toEdge(sim: Simulator, net: string, limit: number): void {
  const stopBefore = { net: sim.netIndex(net), level: Level.L1 };
  expect(sim.runUntil(limit, { stopBefore })).toBe('before');
  expect(levels(sim, net)).not.toBe('1');
  sim.runUntil(sim.nextEventTime);
  expect(levels(sim, net)).toBe('1');
}

const count = (sim: Simulator) =>
  [0, 1, 2, 3].reduce((n, bit) => n | (sim.level(`Q${bit}`) === Level.L1 ? 1 << bit : 0), 0);

describe('stopping before a clock edge', () => {
  it('sees a gated io/clock one gate delay ahead; the counter has settled at every stop', () => {
    const sim = simulate((b) => {
      b.add('X1', 'io/clock', { frequency: 1e6 }).add('U1', '74xx/74hc08');
      b.add('U2', '74xx/74hc161').add('EN', 'test/driver').add('CLR', 'test/driver');
      b.add('V', 'io/vcc');
      b.net('OSC', 'X1.Y', 'U1.1A').net('ENABLE', 'EN.Y', 'U1.1B').net('CLK', 'U1.1Y', 'U2.CP');
      b.net('MR', 'CLR.Y', 'U2.MR').connect('V.Y', 'U2.PE', 'U2.CEP', 'U2.CET');
      for (let n = 0; n < 4; n++) b.net(`Q${n}`, `U2.Q${n}`);
      return b;
    });
    set(sim, 'EN', 1);
    set(sim, 'CLR', 0);
    sim.runFor(ns(100));
    set(sim, 'CLR', 1);
    const stops: string[] = [];
    for (let i = 0; i < 4; i++) {
      const stop = { net: sim.netIndex('CLK'), level: Level.L1 };
      expect(sim.runUntil(us(10), { stopBefore: stop })).toBe('before');
      // OSC rose here; the AND gate's output follows it one delay later.
      stops.push(`${sim.now / 1000} ns: ${levels(sim, 'OSC', 'CLK')} count ${count(sim)}`);
      sim.runUntil(sim.nextEventTime);
      expect(levels(sim, 'CLK')).toBe('1');
    }
    expect(stops).toEqual([
      '500 ns: 10 count 0',
      '1500 ns: 10 count 1',
      '2500 ns: 10 count 2',
      '3500 ns: 10 count 3',
    ]);
  });

  it('sees an astable NE555 ahead of each rising edge', () => {
    const sim = simulate((b) =>
      b
        .add('U1', 'timer/ne555', { mode: 'astable', ra: 1000, rb: 1000, c: 1e-9 })
        .add('V', 'io/vcc')
        .connect('V.Y', 'U1.RESET')
        .net('OUT', 'U1.OUT'),
    );
    for (let i = 0; i < 3; i++) toEdge(sim, 'OUT', us(20));
  });
});
