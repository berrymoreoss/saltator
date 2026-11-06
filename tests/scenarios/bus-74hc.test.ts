/**
 * A 4-bit bus built from real chips, as in a breadboard computer: two 74HC244s take turns
 * driving bus D, and a 74HC245 connects it to bus Q in either direction. Delays are the 74HC
 * data sheets' typical values at 4.5 V (244: tpd 11, ten 13, tdis 14 ns; 245: tpd 9, ten 11,
 * tdis 15 ns).
 */
import { describe, expect, it } from 'vitest';
import { KernelDiagnosticKind, ns, type Simulator } from '../../src/core';
import { levels, set, simulate } from './support';

const BITS = [0, 1, 2, 3];

function bus(): Simulator {
  return simulate((b) => {
    b.add('U1', '74xx/74hc244').add('U2', '74xx/74hc244').add('U3', '74xx/74hc245');
    for (const id of ['EA', 'EB', 'DIR', 'OE']) b.add(id, 'test/driver');
    b.net('ea', 'EA.Y', 'U1.1OE').net('eb', 'EB.Y', 'U2.1OE');
    b.net('dir', 'DIR.Y', 'U3.DIR').net('oe', 'OE.Y', 'U3.OE');
    for (const n of BITS) {
      b.add(`A${n}`, 'test/driver').add(`B${n}`, 'test/driver').add(`Q${n}`, 'test/driver');
      b.net(`a${n}`, `A${n}.Y`, `U1.1A${n}`);
      b.net(`b${n}`, `B${n}.Y`, `U2.1A${n}`);
      b.net(`D${n}`, `U1.1Y${n}`, `U2.1Y${n}`, `U3.A${n}`);
      b.net(`Q${n}`, `U3.B${n}`, `Q${n}.Y`);
    }
    // The 245's unused upper bits and the 244s' second halves are tied off, as on a real board.
    for (const n of [4, 5, 6, 7]) b.add(`G${n}`, 'io/gnd').connect(`G${n}.Y`, `U3.A${n}`);
    b.add('V1', 'io/vcc').connect('V1.Y', 'U1.2OE', 'U2.2OE');
    for (const n of BITS) b.connect('V1.Y', `U1.2A${n}`, `U2.2A${n}`);
    return b;
  });
}

/** Puts `value` (4 bits, bit 0 first) on a driver bank. */
function put(sim: Simulator, bank: string, value: string): void {
  for (const n of BITS) set(sim, `${bank}${n}`, value[n] === '1' ? 1 : 0);
}

const D = BITS.map((n) => `D${n}`);
const Q = BITS.map((n) => `Q${n}`);
const contention = (sim: Simulator) =>
  sim.diagnostics.entries.filter((d) => d.kind === KernelDiagnosticKind.CONTENTION);

/** U1 drives 1010 on D, U2 holds 0110 disabled, the 245 passes D → Q. */
function running(): Simulator {
  const sim = bus();
  put(sim, 'A', '1010');
  put(sim, 'B', '0110');
  set(sim, 'EA', 0);
  set(sim, 'EB', 1);
  set(sim, 'DIR', 1);
  set(sim, 'OE', 0);
  for (const n of BITS) set(sim, `Q${n}`, 'Z');
  sim.settle();
  return sim;
}

describe('a 4-bit bus of 74HC244s and a 74HC245', () => {
  it('one 244 drives the bus, the 245 passes it on', () => {
    const sim = running();
    expect(levels(sim, ...D)).toBe('1010');
    expect(levels(sim, ...Q)).toBe('1010');
    expect(contention(sim)).toEqual([]);
  });

  it('data reaches Q after the 244 enables (13 ns) and the 245 passes it (9 ns)', () => {
    const sim = running();
    set(sim, 'EA', 1); // nobody drives D: Q follows to X
    sim.settle();
    const start = sim.now;
    set(sim, 'EA', 0);
    sim.runUntil(start + ns(13) - 1);
    expect(levels(sim, 'D0')).toBe('Z');
    sim.runUntil(start + ns(13));
    expect(levels(sim, 'D0', 'Q0')).toBe('1X');
    sim.runUntil(start + ns(22));
    expect(levels(sim, 'Q0')).toBe('1');
  });

  it('two enabled 244s with different data fight: X and contention on the differing bits', () => {
    const sim = running();
    set(sim, 'EB', 0);
    sim.settle();
    expect(levels(sim, ...D)).toBe('XX10');
    expect(levels(sim, ...Q)).toBe('XX10');
    expect(
      contention(sim)
        .map((d) => d.net)
        .sort(),
    ).toEqual(['D0', 'D1']);
  });

  it('handing the bus over at one instant fights for 1 ns: ten (13 ns) < tdis (14 ns)', () => {
    const sim = running();
    const start = sim.now;
    set(sim, 'EA', 1);
    set(sim, 'EB', 0);
    sim.settle();
    expect(levels(sim, ...D)).toBe('0110');
    const fights = contention(sim);
    expect(fights.map((d) => d.net).sort()).toEqual(['D0', 'D1']);
    expect(fights.every((d) => d.time === start + ns(13))).toBe(true);
  });

  it('the 245 turned round drives D from Q', () => {
    const sim = running();
    set(sim, 'EA', 1); // free bus D
    set(sim, 'DIR', 0);
    put(sim, 'Q', '0011');
    sim.settle();
    expect(levels(sim, ...D)).toBe('0011');
  });
});
